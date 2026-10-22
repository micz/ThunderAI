// Spec 02 "Enabled-to-show_in Migration": migrateEnabledToShowIn(), guarded by the one-shot flag
// _migrated_enabled_to_showin (in the PREFS_AREA, storage.local: spec 05 "Preference access"),
// applies normalizeEnabledToShowIn() to every prompt of the three stores (_default_prompts_properties,
// _custom_prompt, _special_prompts): enabled 0 / "0" -> show_in "none" (the previous show_in
// discarded), then enabled deleted; otherwise just deleted. Idempotent: after it no enabled key
// remains, and the flag short-circuits a rerun. "Reachability": the result is what decides whether
// a prompt is in a menu.
//
// It runs once on a real user's data: every other field must come through unchanged.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('14-migration-enabled');

const STORED = {
    _default_prompts_properties: {
        prompt_reply: { position_display: 1, position_compose: 1, position_context: 1, need_custom_text: '0', show_in: 'both', enabled: 0 },
        prompt_classify: { position_display: 2, position_compose: 2, position_context: 2, need_custom_text: '1', show_in: 'context', enabled: '1' },
        prompt_this: { position_display: 3, position_compose: 3, position_context: 3, need_custom_text: '0', enabled: '0' },
        prompt_rewrite_formal: { position_display: 4, position_compose: 4, position_context: 4, need_custom_text: '0', show_in: 'popup' },
    },
    _custom_prompt: [
        { id: 'prompt_off', name: 'Off', text: 'Off {%mail_subject%}', type: '0', action: '0', is_default: '0', is_special: '0',
          show_in: 'popup', enabled: 0, api_type: 'ollama_api', ollama_model: 'llama3' },
        { id: 'prompt_on', name: 'On', text: 'On', type: '1', action: '1', is_default: '0', is_special: '0',
          show_in: 'context', enabled: 1 },
        { id: 'prompt_plain', name: 'Plain', text: 'Plain', type: '2', action: '2', is_default: '0', is_special: '0',
          show_in: 'both' },
    ],
    _special_prompts: [
        { id: 'prompt_spamfilter', name: '__MSG_prompt_spamfilter__', text: 'Spam text spamValue explanation {%mail_text_body%}',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'context', enabled: '0' },
        { id: 'prompt_add_tags', name: '__MSG_prompt_add_tags__', text: 'Tags text tags {%mail_text_body%}',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'both', enabled: 1 },
    ],
};

let ctx, p;

before(async () => {
    ctx = await startBackground({ policy: null, local: structuredClone(STORED) });
    p = ctx.prompts;
    await p.migrateEnabledToShowIn();
});

const local = key => ctx.ctl.localData()[key];
const custom = id => local('_custom_prompt').find(x => x.id === id);
const special = id => local('_special_prompts').find(x => x.id === id);

k.test('flag-set', 'the one-shot flag is set, in storage.local', () => {
    assert.equal(local('_migrated_enabled_to_showin'), true);
});

k.test('no-enabled-left', 'no enabled key remains in any of the three stores', () => {
    for (const entry of Object.values(local('_default_prompts_properties'))) assert.equal('enabled' in entry, false);
    for (const prompt of local('_custom_prompt')) assert.equal('enabled' in prompt, false, prompt.id);
    for (const prompt of local('_special_prompts')) assert.equal('enabled' in prompt, false, prompt.id);
});

k.test('default-props', 'built-in prompts: off -> "none", on / absent -> show_in kept', () => {
    const props = local('_default_prompts_properties');
    assert.equal(props.prompt_reply.show_in, 'none', 'enabled 0, show_in "both" discarded');
    assert.equal(props.prompt_this.show_in, 'none', 'enabled "0" with no show_in');
    assert.equal(props.prompt_classify.show_in, 'context');
    assert.equal(props.prompt_rewrite_formal.show_in, 'popup');
});

k.test('default-props-other-fields', 'built-in prompts: every other stored property unchanged', () => {
    const props = local('_default_prompts_properties');
    for (const [id, entry] of Object.entries(STORED._default_prompts_properties)) {
        const { enabled, show_in, ...rest } = entry;
        const { show_in: _s, ...after } = props[id];
        assert.deepEqual(after, rest, id);
    }
});

k.test('custom', 'custom prompts: off -> "none", on -> show_in kept, absent -> unchanged', () => {
    assert.equal(custom('prompt_off').show_in, 'none');
    assert.equal(custom('prompt_on').show_in, 'context');
    assert.equal(custom('prompt_plain').show_in, 'both');
});

k.test('custom-other-fields', 'custom prompts: text, override and every other field unchanged', () => {
    for (const original of STORED._custom_prompt) {
        const { enabled, show_in, ...rest } = original;
        const { show_in: _s, ...after } = custom(original.id);
        assert.deepEqual(after, rest, original.id);
    }
});

k.test('special', 'special prompts: off -> "none", on -> show_in kept, text untouched', () => {
    assert.equal(special('prompt_spamfilter').show_in, 'none');
    assert.equal(special('prompt_spamfilter').text, 'Spam text spamValue explanation {%mail_text_body%}');
    assert.equal(special('prompt_add_tags').show_in, 'both');
    assert.equal(special('prompt_add_tags').text, 'Tags text tags {%mail_text_body%}');
});

k.test('reachability', 'a prompt that was disabled is in no menu afterwards; an enabled one still is', async () => {
    const reachable = (await p.getPrompts(true, [], true)).map(x => x.id);
    for (const id of ['prompt_reply', 'prompt_this', 'prompt_off', 'prompt_spamfilter']) assert.ok(!reachable.includes(id), id);
    for (const id of ['prompt_classify', 'prompt_on', 'prompt_plain', 'prompt_add_tags', 'prompt_rewrite_formal']) assert.ok(reachable.includes(id), id);
});

k.test('runs-once', 'with the flag set a rerun touches nothing, even a new enabled key', async () => {
    const prompts = local('_custom_prompt');
    prompts[0].enabled = 0;
    prompts[0].show_in = 'both';
    await ctx.ctl.browser.storage.local.set({ _custom_prompt: prompts });
    const snapshot = ctx.ctl.localData();
    await p.migrateEnabledToShowIn();
    assert.deepEqual(ctx.ctl.localData(), snapshot);
});

k.coverage();
