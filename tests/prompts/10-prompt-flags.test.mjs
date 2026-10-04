// Spec 02 "Prompt Properties": "The five boolean flags are normalized on read"
// (normalizePromptFlags(prompt, fallbacks): 1 / "1" / true -> "1", 0 / "0" -> "0", every key
// present, mutating, idempotent, single-prompt; the fallbacks for an out-of-domain value),
// isPromptFlagOn() (strict: a corrupted value never turns a behaviour on), normalizePromptFields()
// (custom prompts: no built-in, so out of domain means off; show_in defaults to "popup",
// custom_icon to ""), "Enabled-to-show_in Migration" (normalizeEnabledToShowIn()), and "Missing
// special prompts" with nothing stored (the shipped set, nothing written).

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('10-prompt-flags');

const FLAGS = ['need_selected', 'need_signature', 'need_custom_text', 'define_response_lang', 'use_diff_viewer'];

let p;

before(async () => {
    p = (await startBackground({ policy: null })).prompts;
});

k.test('the-five-flags', 'promptBooleanFlags are exactly the five flags of the spec', () => {
    assert.deepEqual([...p.promptBooleanFlags].sort(), [...FLAGS].sort());
});

// --- isPromptFlagOn() ---------------------------------------------------------------------------

k.test('flag-on-values', 'isPromptFlagOn() is true for 1, "1" and true', () => {
    for (const v of [1, '1', true]) assert.equal(p.isPromptFlagOn(v), true, JSON.stringify(v));
});

k.test('flag-off-values', 'isPromptFlagOn() is false for everything else', () => {
    for (const v of [0, '0', false, '', undefined, null, 'undefined', 'true', 2, '2', ' 1', [], {}]) {
        assert.equal(p.isPromptFlagOn(v), false, JSON.stringify(v));
    }
});

// --- normalizePromptFlags() ---------------------------------------------------------------------

k.test('normalize-on', '1 / "1" / true become "1"', () => {
    for (const v of [1, '1', true]) {
        const prompt = Object.fromEntries(FLAGS.map(f => [f, v]));
        p.normalizePromptFlags(prompt);
        for (const f of FLAGS) assert.equal(prompt[f], '1', `${f} = ${JSON.stringify(v)}`);
    }
});

k.test('normalize-off', '0 / "0" / false become "0", whatever the fallback says', () => {
    for (const v of [0, '0', false]) {
        const prompt = Object.fromEntries(FLAGS.map(f => [f, v]));
        p.normalizePromptFlags(prompt, Object.fromEntries(FLAGS.map(f => [f, '1'])));
        for (const f of FLAGS) assert.equal(prompt[f], '0', `${f} = ${JSON.stringify(v)}`);
    }
});

k.test('normalize-out-of-domain-off', 'out of domain with no fallback is "0"', () => {
    for (const v of ['', undefined, null, 'undefined', 'yes', 2]) {
        const prompt = Object.fromEntries(FLAGS.map(f => [f, v]));
        p.normalizePromptFlags(prompt);
        for (const f of FLAGS) assert.equal(prompt[f], '0', `${f} = ${JSON.stringify(v)}`);
    }
});

k.test('normalize-out-of-domain-fallback', 'out of domain takes the fallback (the built-in definition)', () => {
    const prompt = { need_selected: '', need_signature: undefined, need_custom_text: '',
        define_response_lang: null, use_diff_viewer: 'undefined' };
    p.normalizePromptFlags(prompt, { need_selected: '1', need_signature: '0', need_custom_text: '1',
        define_response_lang: 1, use_diff_viewer: true });
    assert.deepEqual(prompt, { need_selected: '1', need_signature: '0', need_custom_text: '1',
        define_response_lang: '1', use_diff_viewer: '1' });
});

k.test('normalize-fallback-out-of-domain', 'a fallback that is itself out of domain means "0"', () => {
    const prompt = { need_custom_text: '' };
    p.normalizePromptFlags(prompt, { need_custom_text: '' });
    assert.equal(prompt.need_custom_text, '0');
});

k.test('normalize-every-key', 'every one of the five keys is present afterwards', () => {
    const prompt = { id: 'x' };
    p.normalizePromptFlags(prompt);
    for (const f of FLAGS) assert.equal(prompt[f], '0', f);
    assert.equal(prompt.id, 'x', 'other properties are untouched');
});

k.test('normalize-mutating-idempotent', 'it mutates the prompt it is given, and a second run changes nothing', () => {
    const prompt = { need_selected: 1, need_signature: 0, need_custom_text: true, define_response_lang: '', use_diff_viewer: '1' };
    const ret = p.normalizePromptFlags(prompt, { define_response_lang: '1' });
    assert.equal(ret, undefined, 'mutating, like normalizeEnabledToShowIn()');
    const once = structuredClone(prompt);
    p.normalizePromptFlags(prompt);
    assert.deepEqual(prompt, once);
    assert.deepEqual(once, { need_selected: '1', need_signature: '0', need_custom_text: '1', define_response_lang: '1', use_diff_viewer: '1' });
});

// --- normalizePromptFields() ------------------------------------------------------------------

k.test('fields-defaults', 'a custom prompt missing every optional field gets its canonical shape', () => {
    const prompt = { id: 'prompt_user', name: 'Mine', text: 'Do it', type: '0', action: '0', is_default: '0', is_special: '0' };
    const ret = p.normalizePromptFields(prompt);
    assert.equal(ret, prompt, 'in place, and returned');
    assert.equal(prompt.show_in, 'popup');
    assert.equal(prompt.custom_icon, '');
    assert.equal(prompt.api_type, '');
    for (const f of FLAGS) assert.equal(prompt[f], '0', f);
});

k.test('fields-kept', 'fields that are present are kept', () => {
    const prompt = { id: 'u', show_in: 'none', custom_icon: 'star.png', api_type: 'ollama_api', need_signature: 1 };
    p.normalizePromptFields(prompt);
    assert.equal(prompt.show_in, 'none');
    assert.equal(prompt.custom_icon, 'star.png');
    assert.equal(prompt.api_type, 'ollama_api');
    assert.equal(prompt.need_signature, '1');
});

k.test('fields-no-fallback', 'a custom prompt has no built-in: an out-of-domain flag is off', () => {
    const prompt = { id: 'u', need_custom_text: '' };
    p.normalizePromptFields(prompt);
    assert.equal(prompt.need_custom_text, '0');
});

// --- normalizeEnabledToShowIn() ---------------------------------------------------------------

k.test('enabled-off-to-none', 'enabled 0 / "0" / false sets show_in "none" (the previous one discarded) and drops enabled', () => {
    for (const enabled of [0, '0', false]) {
        for (const show_in of ['both', 'context', 'popup', undefined]) {
            const prompt = { id: 'x', enabled, show_in };
            p.normalizeEnabledToShowIn(prompt);
            assert.deepEqual(prompt, { id: 'x', show_in: 'none' }, `${JSON.stringify(enabled)} / ${show_in}`);
        }
    }
});

k.test('enabled-on-dropped', 'enabled 1 / "1" is just dropped, show_in kept', () => {
    for (const enabled of [1, '1']) {
        const prompt = { id: 'x', enabled, show_in: 'context' };
        p.normalizeEnabledToShowIn(prompt);
        assert.deepEqual(prompt, { id: 'x', show_in: 'context' }, JSON.stringify(enabled));
    }
});

k.test('enabled-absent', 'no enabled: nothing changes', () => {
    const prompt = { id: 'x', show_in: 'both' };
    p.normalizeEnabledToShowIn(prompt);
    assert.deepEqual(prompt, { id: 'x', show_in: 'both' });
});

k.test('enabled-idempotent', 'a second run changes nothing', () => {
    const prompt = { id: 'x', enabled: 0, show_in: 'both' };
    p.normalizeEnabledToShowIn(prompt);
    p.normalizeEnabledToShowIn(prompt);
    assert.deepEqual(prompt, { id: 'x', show_in: 'none' });
});

// --- Spec 02 "Missing special prompts": nothing stored ------------------------------------------

k.test('special-none-stored-not-written', 'with no special prompt stored, a read returns the shipped set and writes nothing', async () => {
    const local = globalThis.browser.storage.local;
    const before = JSON.stringify(await local.get(null));
    const list = await p.getSpecialPrompts();
    assert.equal(list.length, 9);
    assert.equal(JSON.stringify(await local.get(null)), before);
    assert.equal((await local.get('_special_prompts'))._special_prompts, undefined);
});

// Spec 02 "User Properties": the positions of a built-in prompt with nothing stored. This context
// has no _default_prompts_properties at all.
// The defaultPrompts array, in its order.
const DEFAULT_ORDER = ['prompt_reply', 'prompt_reply_advanced', 'prompt_reply_custom_command', 'prompt_rewrite_polite',
    'prompt_rewrite_formal', 'prompt_classify', 'prompt_proofread_this', 'prompt_this'];

k.test('positions-nothing-stored', 'no stored properties: positions 1..8 in array order, the three equal', async () => {
    const list = await p.getPrompts();
    DEFAULT_ORDER.forEach((id, i) => {
        const prompt = list.find(x => x.id === id);
        assert.deepEqual([prompt.position_display, prompt.position_compose, prompt.position_context], [i + 1, i + 1, i + 1], id);
    });
});

k.test('stored-false-stays-off', 'a special prompt stored with false reads "0", even where the built-in is "1"', async () => {
    await globalThis.browser.storage.local.set({ _special_prompts: [
        { id: 'prompt_get_task', name: '__MSG_prompt_get_task__', text: 'Task {%selected_text%} summary', type: '1', action: '0',
          is_default: '1', is_special: '1', show_in: 'popup', need_selected: false },
    ] });
    const task = (await p.getSpecialPrompts()).find(x => x.id === 'prompt_get_task');
    assert.equal(task.need_selected, '0', 'the built-in need_selected of prompt_get_task is "1"');
});

k.coverage();
