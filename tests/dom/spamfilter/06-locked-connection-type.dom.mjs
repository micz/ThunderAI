// Spec 08 "A locked per-feature connection type" (and "No seeding from policy values"): a
// locked {prefix}_connection_type is shown as the policy enforces it, not as the special prompt
// or the global connection would seed it, and it is never written into the prompt - where it
// would outlive the policy - even though initializeSpecificIntegrationUI() rewrites the prompt on
// page open while the specific integration is on.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';

const ctx = await openPage('spamfilter', {
    policy: {
        spamfilter_connection_type: 'openai_comp_api',
    },
    local: {
        connection_type: 'chatgpt_api',
        spamfilter_use_specific_integration: true,
        spamfilter_connection_type: 'chatgpt_api', // the user's own value, overridden by the lock
    },
});
after(() => ctx.close());
const storedPrompt = () => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === 'prompt_spamfilter');

test('the select shows the enforced connection type, disabled', () => {
    const select = ctx.$('#spamfilter_connection_type');
    assert.equal(select.value, 'openai_comp_api');
    assert.equal(select.disabled, true);
    assert.equal(select.dataset.mztaManaged, '1');
});

test('the prompt written on page open does not carry the enforced connection type', () => {
    const p = storedPrompt();
    assert.ok(p, 'the page did not write prompt_spamfilter (specific integration is on)');
    assert.notEqual(p.api_type, 'openai_comp_api');
});

test('the stored user value is left alone', () => {
    assert.equal(ctx.ctl.localData().spamfilter_connection_type, 'chatgpt_api');
});

// Values only: the prompt's property names include "openai_comp_api_key".
const holds = (v, target) => v === target
    || (v !== null && typeof v === 'object' && Object.values(v).some(x => holds(x, target)));

test('nothing in storage holds the enforced value', () => {
    assert.equal(holds(ctx.ctl.localData(), 'openai_comp_api'), false);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
