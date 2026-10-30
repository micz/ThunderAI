// Spec 02 "Prompt ids": every shipped id starts with prompt_ (RESERVED_PROMPT_ID_PREFIX), and a
// custom prompt must never have a shipped id. isReservedPromptId() / isShippedPromptId() ignore case.
// renameCollidingPromptIds() renames only an exact shipped id (ignoring case): the shipped id without
// prompt_, made unique with _2, _3, ... (uniquePromptId()) against every listed id and every shipped
// id. migrateCustomPromptIdCollisions() applies it to every entry of _custom_prompt at every startup,
// writing only when it renames something. preparePromptsForImport() applies it to the custom entries
// of a file before the merge; a built-in entry (its exact id, no is_default) still merges.
// A custom id that only starts with prompt_ is kept, both in storage and on import.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('17-prompt-ids');

const custom = (id, extra = {}) => ({
    id, name: 'Name of ' + id, text: 'Text of ' + id, type: '0', action: '0',
    is_default: '0', is_special: '0', show_in: 'both', ...extra,
});

// Processed in this order: prompt_summarize finds summarize taken, so it gets summarize_2.
const STORED = [
    custom('prompt_summarize', { api_type: 'ollama_api', ollama_model: 'llama3' }),
    custom('Prompt_Reply'),
    custom('summarize'),
    custom('prompt_reply_copy'),
    custom('my_prompt'),
];

let ctx, p, renamed, writesAfterFirstRun;

before(async () => {
    ctx = await startBackground({ policy: null, local: { _custom_prompt: structuredClone(STORED) } });
    p = ctx.prompts;
    renamed = await p.migrateCustomPromptIdCollisions();
    writesAfterFirstRun = ctx.ctl.calls.filter(c => c.op === 'set').length;
});

const stored = () => ctx.ctl.localData()._custom_prompt;
const storedById = id => stored().find(x => x.id === id);

// --- The helpers ------------------------------------------------------------------------------------

k.test('reserved-prefix', 'isReservedPromptId(): the prompt_ start, ignoring case, and nothing else', () => {
    assert.equal(p.RESERVED_PROMPT_ID_PREFIX, 'prompt_');
    for (const id of ['prompt_reply', 'prompt_x', 'Prompt_X', 'PROMPT_', 'prompt_reply_copy']) assert.equal(p.isReservedPromptId(id), true, id);
    for (const id of ['prompts', 'prompt', 'my_prompt_x', 'org_acme_prompt_x', '', undefined, null]) assert.equal(p.isReservedPromptId(id), false, String(id));
});

k.test('shipped-ids', 'isShippedPromptId(): every default and special id, ignoring case, and only those', () => {
    for (const id of ['prompt_reply', 'prompt_this', 'prompt_summarize', 'prompt_summarize_email_template', 'PROMPT_ADD_TAGS']) {
        assert.equal(p.isShippedPromptId(id), true, id);
    }
    for (const id of ['prompt_reply_copy', 'prompt_x', 'reply', '', undefined]) assert.equal(p.isShippedPromptId(id), false, String(id));
});

k.test('unique-id', 'uniquePromptId(): the base, else base_2, base_3, ...', () => {
    assert.equal(p.uniquePromptId('a', new Set()), 'a');
    assert.equal(p.uniquePromptId('a', new Set(['a'])), 'a_2');
    assert.equal(p.uniquePromptId('a', new Set(['a', 'a_2'])), 'a_3');
});

k.test('rename-only-custom', 'renameCollidingPromptIds() leaves a prompt alone when isCustom() says it is not the user\'s', () => {
    const list = [{ id: 'prompt_reply' }, { id: 'prompt_summarize' }];
    const out = p.renameCollidingPromptIds(list, x => x.id === 'prompt_summarize');
    assert.deepEqual(list.map(x => x.id), ['prompt_reply', 'summarize']);
    assert.deepEqual(out, [{ from: 'prompt_summarize', to: 'summarize' }]);
});

k.test('rename-unique-against-taken', 'the new id avoids the taken ids, the shipped ids and the other ids of the list', () => {
    const list = [{ id: 'prompt_reply' }, { id: 'reply_2' }];
    p.renameCollidingPromptIds(list, () => true, new Set(['reply']));
    assert.equal(list[0].id, 'reply_3');
});

// --- At startup -------------------------------------------------------------------------------------

k.test('startup-renamed', 'only the exact shipped ids are renamed, ignoring case', () => {
    assert.deepEqual(renamed, [
        { from: 'prompt_summarize', to: 'summarize_2' },
        { from: 'Prompt_Reply', to: 'reply' },
    ]);
    assert.deepEqual(stored().map(x => x.id), ['summarize_2', 'reply', 'summarize', 'prompt_reply_copy', 'my_prompt']);
});

k.test('startup-fields-kept', 'a renamed prompt keeps every other field, its override included', () => {
    const { id, ...rest } = STORED[0];
    const { id: _id, ...after } = storedById('summarize_2');
    for (const [key, value] of Object.entries(rest)) assert.equal(after[key], value, key);
    assert.equal(storedById('reply').text, 'Text of Prompt_Reply');
});

k.test('startup-prefix-kept', 'a custom id that only starts with prompt_ is kept', () => {
    assert.ok(storedById('prompt_reply_copy'));
});

k.test('startup-one-write', 'the store is written once, and nothing else', () => {
    const sets = ctx.ctl.calls.filter(c => c.op === 'set');
    assert.equal(sets.length, 1);
});

k.test('startup-no-clash-left', 'afterwards the invocation view has no two prompts with one id', async () => {
    const ids = (await p.getPrompts(false, [], true)).map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

k.test('startup-rerun', 'the next start finds nothing to rename and writes nothing', async () => {
    const snapshot = ctx.ctl.localData();
    assert.deepEqual(await p.migrateCustomPromptIdCollisions(), []);
    assert.equal(ctx.ctl.calls.filter(c => c.op === 'set').length, writesAfterFirstRun);
    assert.deepEqual(ctx.ctl.localData(), snapshot);
});

// --- On import --------------------------------------------------------------------------------------

k.test('import', 'a custom entry with a shipped id is renamed; a built-in entry still merges', async () => {
    const imported = await p.preparePromptsForImport([
        { id: 'prompt_reply', position_display: 5, position_compose: 5, position_context: 5 },
        custom('prompt_reply', { name: 'File reply' }),
        custom('prompt_summarize', { is_default: 0 }),
        custom('prompt_from_file'),
        { id: 'PROMPT_CLASSIFY', name: 'Shouting', text: 'S', type: '0', action: '0' },
    ]);
    const all = id => imported.filter(x => x.id === id);
    assert.equal(all('prompt_reply').length, 1, 'one prompt_reply');
    assert.equal(all('prompt_reply')[0].is_default, '1', 'still the built-in row');
    assert.equal(all('prompt_reply')[0].position_display, 5, 'the built-in entry merged');
    assert.equal(all('reply_2')[0]?.name, 'File reply', 'reply is taken by the stored prompt');
    assert.equal(all('summarize_3').length, 1, 'summarize and summarize_2 are taken');
    assert.equal(all('classify')[0]?.name, 'Shouting', 'an id that is shipped only ignoring case is a custom one');
    assert.equal(all('prompt_from_file').length, 1, 'a prompt_ id that is not shipped is kept');
    for (const prompt of imported.filter(x => x.is_default !== '1')) {
        assert.equal(p.isShippedPromptId(prompt.id), false, prompt.id);
    }
});

k.coverage();
