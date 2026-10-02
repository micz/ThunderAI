// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Implied
// preferences and conflicts", and its order against the locked-off overlay:
//  - an explicit {prefix}_use_specific_integration: false in the same policy, locked or initial,
//    wins: the connection entry is skipped with a warning and the feature uses the global
//    connection; with a LOCKED false the locked-off overlay applies, and never both;
//  - an explicit initial true is upgraded to enforced, with a warning;
//  - an explicit {prefix}_connection_type that differs, or is only initial, is replaced by the
//    entry's api_type, locked, with a warning.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('special-prompts-connection-conflict.json');
const sp = (id, extra) => ({ id, text: 'text of ' + id + ' spamValue explanation tags summary subject body status',
    is_default: '1', is_special: '1', show_in: 'context', custom_icon: '', ...extra });
const STORED = {
    connection_type: 'chatgpt_api',
    _special_prompts: [
        sp('prompt_spamfilter', { api_type: 'chatgpt_api', chatgpt_model: 'gpt-user' }),
        sp('prompt_add_tags', { api_type: 'anthropic_api', anthropic_model: 'claude-user' }),
    ],
};

let ctx;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
});

const warned = re => ctx.con.warnings().some(w => re.test(w));
const byId = (list, id) => list.find(p => p.id === id);

test('an explicit false skips the entry, locked or initial', () => {
    assert.deepEqual(Object.keys(ctx.mztaManaged.getSpecialPromptsConnection()).sort(), ['get_task', 'translate']);
    assert.ok(warned(/\["spamfilter"\] is skipped: "spamfilter_use_specific_integration" is set to false \(locked\)/));
    assert.ok(warned(/\["add_tags"\] is skipped: "add_tags_use_specific_integration" is set to false \(initial\)/));
    // The explicit value is left exactly as the administrator wrote it.
    assert.equal(ctx.mztaManaged.getManagedValue('add_tags_use_specific_integration'), false);
    assert.equal(ctx.mztaManaged.isManagedLocked('add_tags_use_specific_integration'), false);
    assert.equal(ctx.mztaManaged.hasManagedValue('spamfilter_connection_type'), false);
});

test('a locked false: the locked-off overlay applies, the connection one does not', async () => {
    const spam = byId(await ctx.prompts.getSpecialPrompts(), 'prompt_spamfilter');
    assert.equal(spam.api_type, '');
    assert.equal('chatgpt_model' in spam, false);
    assert.equal('ollama_host' in spam, false);
    assert.equal(spam._connection_by_policy, undefined);
});

test('an initial false: the user\'s own override stays in effect', async () => {
    const tags = byId(await ctx.prompts.getSpecialPrompts(), 'prompt_add_tags');
    assert.equal(tags.api_type, 'anthropic_api');
    assert.equal(tags.anthropic_model, 'claude-user');
    assert.equal(tags._connection_by_policy, undefined);
});

test('an initial true is upgraded to enforced', () => {
    assert.ok(warned(/"translate_use_specific_integration" is an initial value, but .* it is enforced \(true\)/));
    assert.equal(ctx.mztaManaged.isManagedLocked('translate_use_specific_integration'), true);
    assert.equal(ctx.mztaManaged.getManagedValue('translate_use_specific_integration'), true);
});

test('a different connection type is replaced by the entry\'s api_type, locked', () => {
    assert.ok(warned(/"translate_connection_type" is "chatgpt_api" \(locked\), but .* enforces "ollama_api"/));
    assert.equal(ctx.mztaManaged.getManagedValue('translate_connection_type'), 'ollama_api');
    assert.equal(ctx.mztaManaged.isManagedLocked('translate_connection_type'), true);
});

test('the same connection type given as an initial value becomes enforced', () => {
    assert.ok(warned(/"get_task_connection_type" is "ollama_api" \(initial\), but .* enforces "ollama_api"/));
    assert.equal(ctx.mztaManaged.isManagedLocked('get_task_connection_type'), true);
});

test('the accepted entries are overlaid', async () => {
    const list = await ctx.prompts.getSpecialPrompts();
    for (const id of ['prompt_translate_this', 'prompt_get_task']) {
        assert.equal(byId(list, id).api_type, 'ollama_api', id);
        assert.equal(byId(list, id).ollama_host, 'http://ollama.example.org:11434', id);
    }
});
