// Spec 08 "Strict mode", rule 2: a key the policy sets keeps the policy's value and lock - an
// explicit locked value, an initial value (":locked": false), and the pair implied by
// _special_prompts_connection - and a _user_editable entry naming one is warned about, the
// policy winning. Strict mode is applied after the per-feature connections, so it cannot
// cancel one by filling {prefix}_use_specific_integration with its default false.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({
        policy: loadFixture('lock-unlisted-explicit.json'),
        local: { chatgpt_model: 'gpt-user', translate_lang: 'Italian', reply_type: 'reply_sender' },
    });
});

const state = key => ({
    managed: ctx.mztaManaged.hasManagedValue(key),
    value: ctx.mztaManaged.getManagedValue(key),
    locked: ctx.mztaManaged.isManagedLocked(key),
    byDefault: ctx.mztaManaged.isLockedByDefault(key),
});

test('an explicit value keeps its value and lock', () => {
    assert.deepEqual(state('connection_type'), { managed: true, value: 'chatgpt_api', locked: true, byDefault: false });
    assert.deepEqual(state('default_sign_name'), { managed: true, value: 'ACME Staff', locked: true, byDefault: false });
});

test('an initial value stays an initial value: the stored user value wins', async () => {
    assert.deepEqual(state('chatgpt_model'), { managed: true, value: 'gpt-org', locked: false, byDefault: false });
    assert.equal(await ctx.mztaPrefs.getPref('chatgpt_model'), 'gpt-user');
});

test('the per-feature connection still applies: its implied pair is locked to it, not to the defaults', () => {
    assert.deepEqual(state('summarize_use_specific_integration'), { managed: true, value: true, locked: true, byDefault: false });
    assert.deepEqual(state('summarize_connection_type'), { managed: true, value: 'ollama_api', locked: true, byDefault: false });
    assert.equal(ctx.mztaManaged.getSpecialPromptConnection('summarize').api_type, 'ollama_api');
});

test('a _user_editable entry the policy also sets is warned about, the policy winning', () => {
    const w = ctx.con.warnings();
    for (const key of ['default_sign_name', 'chatgpt_model', 'summarize_use_specific_integration']) {
        assert.ok(w.some(m => m.includes('_user_editable') && m.includes('"' + key + '"') && m.includes('policy value wins')),
            'no warning for ' + key);
    }
    assert.equal(w.some(m => m.includes('"translate_lang"')), false);
});

test("a _user_editable key the policy does not set stays the user's", async () => {
    assert.equal(state('translate_lang').managed, false);
    assert.equal(await ctx.mztaPrefs.getPref('translate_lang'), 'Italian');
});

test('every other key is locked at its default, over the stored user value', async () => {
    assert.deepEqual(state('reply_type'), { managed: true, value: 'reply_all', locked: true, byDefault: true });
    assert.equal(await ctx.mztaPrefs.getPref('reply_type'), 'reply_all');
    assert.equal(ctx.ctl.localData().reply_type, 'reply_sender');
});
