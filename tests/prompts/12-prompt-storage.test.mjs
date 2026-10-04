// Spec 02, the storage writers, read back through the mock: setDefaultPromptsProperties()
// ("Organization prompts (the fourth set)": _default_prompts_properties holds only the nine display
// keys, never the prompt text; "The five boolean flags are normalized on read": it never emits "",
// and need_custom_text is the only one of the five it persists; "User Properties": show_in defaults
// to "popup"), setCustomPrompts() (it replaces _custom_prompt entirely), setSpecialPrompts(), and
// saveSpecialPromptTexts() (a load-modify-save on a FRESH read, texts only). No policy: the
// managed gates of these writers are spec 08a/08b, tested by the managed area.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('12-prompt-storage');

let ctx, p;

before(async () => {
    ctx = await startBackground({
        policy: null,
        local: {
            _custom_prompt: [
                { id: 'prompt_old', name: 'Old', text: 'Old', type: '0', action: '0', is_default: '0', is_special: '0', show_in: 'popup' },
            ],
        },
    });
    p = ctx.prompts;
});

const local = key => ctx.ctl.localData()[key];
const byId = (list, id) => list.find(x => x.id === id);

// --- setDefaultPromptsProperties() ------------------------------------------------------------

const DISPLAY = { position_display: 4, position_compose: 5, position_context: 6, show_in: 'both', custom_icon: 'star.png' };

k.test('default-props-keyed-no-text', 'one entry per prompt id, never the prompt text or name', async () => {
    const defaults = (await p.getPrompts()).filter(x => x.is_default === '1');
    await p.setDefaultPromptsProperties(defaults.map(x => ({ ...x, ...DISPLAY })));
    const stored = local('_default_prompts_properties');
    assert.deepEqual(Object.keys(stored).sort(), defaults.map(x => x.id).sort());
    for (const [id, entry] of Object.entries(stored)) {
        for (const key of ['text', 'name', 'id', 'type', 'action', 'is_default', 'is_special']) {
            assert.equal(key in entry, false, `${id}.${key}`);
        }
    }
});

k.test('default-props-nine-keys', 'each entry holds only the nine display keys', () => {
    for (const [id, entry] of Object.entries(local('_default_prompts_properties'))) {
        assert.equal(Object.keys(entry).length, 9, `${id}: ${Object.keys(entry).join(', ')}`);
    }
});

k.test('default-props-one-flag', 'need_custom_text is the only one of the five flags persisted', () => {
    for (const [id, entry] of Object.entries(local('_default_prompts_properties'))) {
        assert.ok('need_custom_text' in entry, id);
        for (const f of ['need_selected', 'need_signature', 'define_response_lang', 'use_diff_viewer']) {
            assert.equal(f in entry, false, `${id}.${f}`);
        }
    }
});

k.test('default-props-canonical-flag', 'need_custom_text is stored as "0"/"1", never ""', async () => {
    const cases = [['', '0'], [undefined, '0'], ['undefined', '0'], [0, '0'], ['0', '0'], [1, '1'], ['1', '1'], [true, '1']];
    await p.setDefaultPromptsProperties(cases.map(([v], i) => ({ id: 'prompt_case_' + i, need_custom_text: v })));
    const stored = local('_default_prompts_properties');
    cases.forEach(([v, expected], i) => assert.equal(stored['prompt_case_' + i].need_custom_text, expected, JSON.stringify(v)));
});

k.test('default-props-show-in-default', 'a missing show_in is stored as "popup"', async () => {
    await p.setDefaultPromptsProperties([{ id: 'prompt_reply' }]);
    assert.equal(local('_default_prompts_properties').prompt_reply.show_in, 'popup');
});

k.test('default-props-read-back', 'what was stored is what the built-in prompt reads', async () => {
    await p.setDefaultPromptsProperties([{ id: 'prompt_classify', ...DISPLAY, need_custom_text: '1' }]);
    const classify = byId(await p.getPrompts(), 'prompt_classify');
    assert.deepEqual(
        [classify.position_display, classify.position_compose, classify.position_context, classify.show_in, classify.custom_icon, classify.need_custom_text],
        [4, 5, 6, 'both', 'star.png', '1']);
    assert.equal(classify.text, ctx.ctl.browser.i18n.getMessage('prompt_classify_full_text'), 'the text is still the shipped one');
});

// --- setCustomPrompts() ---------------------------------------------------------------------

k.test('custom-replaces-store', 'setCustomPrompts() replaces _custom_prompt entirely', async () => {
    await p.setCustomPrompts([
        { id: 'prompt_new', name: 'New', text: 'New {%mail_subject%}', type: '1', action: '1', is_default: '0', is_special: '0',
          need_signature: 1, show_in: 'context' },
    ]);
    assert.deepEqual(local('_custom_prompt').map(x => x.id), ['prompt_new']);
});

k.test('custom-read-back', 'the stored custom prompt reads back with its fields, flags canonical', async () => {
    const prompt = byId(await p.getPrompts(), 'prompt_new');
    assert.equal(prompt.text, 'New {%mail_subject%}');
    assert.equal(prompt.show_in, 'context');
    assert.equal(prompt.need_signature, '1');
    assert.equal(byId(await p.getPrompts(), 'prompt_old'), undefined);
});

k.test('custom-input-untouched', 'setCustomPrompts() does not change the objects it is handed', async () => {
    const list = [{ id: 'prompt_new', name: 'New', text: 'T', is_default: '0', is_special: '0', idnum: 5 }];
    const copy = structuredClone(list);
    await p.setCustomPrompts(list);
    assert.deepEqual(list, copy);
});

// --- setSpecialPrompts() / saveSpecialPromptTexts() ---------------------------------------------

k.test('special-stored', 'setSpecialPrompts() stores the special prompts it is handed', async () => {
    const specials = await p.getSpecialPrompts();
    byId(specials, 'prompt_spamfilter').text = 'Spam? {%mail_text_body%} spamValue explanation';
    byId(specials, 'prompt_spamfilter').custom_icon = 'shield.png';
    await p.setSpecialPrompts(specials);
    const stored = byId(local('_special_prompts'), 'prompt_spamfilter');
    assert.equal(stored.text, 'Spam? {%mail_text_body%} spamValue explanation');
    assert.equal(stored.custom_icon, 'shield.png');
    assert.equal(local('_special_prompts').length, specials.length);
});

k.test('save-texts-only-text', 'saveSpecialPromptTexts() changes the texts named, nothing else', async () => {
    const before = structuredClone(local('_special_prompts'));
    await p.saveSpecialPromptTexts({ prompt_add_tags: 'Tags {%mail_text_body%} tags' });
    const after = local('_special_prompts');
    for (const prompt of after) {
        const old = byId(before, prompt.id);
        if (prompt.id === 'prompt_add_tags') {
            assert.equal(prompt.text, 'Tags {%mail_text_body%} tags');
            assert.deepEqual({ ...prompt, text: null }, { ...old, text: null });
        } else {
            assert.deepEqual(prompt, old, prompt.id);
        }
    }
});

k.test('save-texts-fresh-read', 'saveSpecialPromptTexts() keeps a change saved after the caller loaded its copy', async () => {
    const stale = await p.getSpecialPrompts();         // a feature page loads at page open...
    const spam = await p.loadPrompt('prompt_spamfilter');
    spam.api_type = 'ollama_api';                       // ...the connection panel saves an override...
    spam.ollama_model = 'llama3';
    await p.savePrompt(spam);
    await p.saveSpecialPromptTexts({ prompt_spamfilter: 'New spam text spamValue explanation' });  // ...then Save
    const stored = byId(local('_special_prompts'), 'prompt_spamfilter');
    assert.equal(stored.text, 'New spam text spamValue explanation');
    assert.equal(stored.api_type, 'ollama_api', 'the override saved in between is kept');
    assert.equal(stored.ollama_model, 'llama3');
    assert.ok(byId(stale, 'prompt_spamfilter').api_type !== 'ollama_api', 'the stale copy did not have it');
});

k.test('save-texts-unknown-id', 'an id that is not a special prompt is ignored', async () => {
    const before = structuredClone(local('_special_prompts'));
    await p.saveSpecialPromptTexts({ prompt_nope: 'x' });
    assert.deepEqual(local('_special_prompts'), before);
});

k.coverage();
