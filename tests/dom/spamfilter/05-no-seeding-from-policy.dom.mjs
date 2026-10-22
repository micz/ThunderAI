// Spec 08 "No seeding from policy values" (and the prompt-storage half of "Policy-supplied API
// keys"): a feature page seeds its per-feature connection fields from the global value when
// the special prompt has none, and initializeSpecificIntegrationUI() writes those fields into
// the prompt on page open. A seed must never come from a policy-supplied value -
// seedFromGlobal() returns prefs_default[key] for those - or the policy value would outlive
// the policy in _special_prompts, and the marker would be sent to the provider as the key.
// A global value the user set themselves still seeds, exactly as before.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';

const ctx = await openPage('spamfilter', {
    policy: {
        chatgpt_api_key: 'sk-org-SECRET',
        chatgpt_model: 'gpt-org-model',
        chatgpt_temperature: '0.1', 'chatgpt_temperature:locked': false,
    },
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_store: true, // the user's own global value
        spamfilter_use_specific_integration: true,
        spamfilter_connection_type: 'chatgpt_api',
    },
});
after(() => ctx.close());
const { MANAGED_SECRET_MARKER, prefs_default } = ctx.mods;
const storedPrompt = () => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === 'prompt_spamfilter');

test('the per-feature fields start from prefs_default, not from the policy values', () => {
    assert.equal(ctx.$('#spamfilter_chatgpt_api_key').value, prefs_default.chatgpt_api_key);
    assert.equal(ctx.$('#spamfilter_chatgpt_model').value, prefs_default.chatgpt_model);
    assert.equal(ctx.$('#spamfilter_chatgpt_temperature').value, prefs_default.chatgpt_temperature);
});

test('a global value the user set still seeds its per-feature field', () => {
    assert.equal(ctx.$('#spamfilter_chatgpt_store').checked, true);
});

test('the prompt written on page open carries no policy value and no marker', () => {
    const p = storedPrompt();
    assert.ok(p, 'the page did not write prompt_spamfilter (specific integration is on)');
    assert.equal(p.api_type, 'chatgpt_api');
    assert.notEqual(p.chatgpt_api_key, MANAGED_SECRET_MARKER);
    assert.notEqual(p.chatgpt_model, 'gpt-org-model');
    assert.notEqual(p.chatgpt_temperature, '0.1');
});

test('nothing in storage holds a policy value or the marker', () => {
    const all = JSON.stringify(ctx.ctl.localData());
    for (const v of [MANAGED_SECRET_MARKER, 'sk-org-SECRET', 'gpt-org-model']) {
        assert.equal(all.includes(v), false, JSON.stringify(v) + ' in storage.local');
    }
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
