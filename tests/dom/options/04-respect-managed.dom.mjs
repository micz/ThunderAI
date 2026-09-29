// Spec 08 "Marker placement and inertness": page logic that reassigns `disabled` goes through
// setDisabledRespectingManaged(), so it can never re-enable a policy-locked control, and
// lockControl() keeps a locked switch inert even once its input is re-enabled. Also
// "Interaction points" (_reconcileFeatureFlags): a policy-enabled feature with an unusable
// connection STAYS ON - the page must not show it switched off.
//
// Only the dependent controls are locked; the connection that drives disable_ApiFeature(),
// disable_MaxPromptLength() and disable_GetCalendarEvent() stays the user's, and is changed
// both through the page's own select and through storage.onChanged.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';
import { REASONS } from '../../helpers/dom-known-issues.mjs';

const LOCKED = ['spamfilter', 'summarize', 'get_task', 'max_prompt_length'];
const ctx = await openPage('options', {
    policy: { spamfilter: true, summarize: true, get_task: true, max_prompt_length: 5000 },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own' },
});
after(() => ctx.close());

const allStillLocked = where => {
    for (const id of LOCKED) {
        const el = ctx.$('#' + id);
        assert.equal(el.disabled, true, `${id} re-enabled ${where}`);
        assert.equal(el.dataset.mztaManaged, '1', `${id} lost its mark ${where}`);
    }
};

test('the locked controls start disabled', () => allStillLocked('at page open'));

test('switching the connection in the page never re-enables them', async () => {
    const select = ctx.$('#connection_type');
    for (const value of ['chatgpt_web', 'anthropic_api', 'ollama_api', 'chatgpt_api']) {
        select.value = value;
        await ctx.fire(select, 'change');
        allStillLocked('after connection_type = ' + value);
    }
});

test('a storage.onChanged refresh never re-enables them', async () => {
    for (const value of ['google_gemini_api', 'chatgpt_web', 'chatgpt_api']) {
        await ctx.ctl.browser.storage.local.set({ connection_type: value });
        await ctx.settle();
        allStillLocked('after storage.onChanged connection_type = ' + value);
    }
});

test('a locked switch cannot be flipped by clicking its track, even when re-enabled by hand', async () => {
    const input = ctx.$('#spamfilter');
    const label = input.closest('.mzta_switch');
    assert.ok(label, 'the toggle is a .mzta_switch');
    const before = input.checked;
    await ctx.click(label);
    assert.equal(input.checked, before, 'flipped while disabled');
    input.disabled = false;
    await ctx.click(label);
    assert.equal(input.checked, before, 'flipped after being re-enabled by hand');
    assert.equal(ctx.ctl.localData().spamfilter, undefined, 'spamfilter reached storage');
    input.disabled = true;
});

test('with no connection selected, locked controls stay disabled', async () => {
    const select = ctx.$('#connection_type');
    select.value = '';
    await ctx.fire(select, 'change');
    allStillLocked('with no connection selected');
});

test('with no connection selected, a policy-enabled feature is still shown on', { todo: REASONS.lockedFeatureShownOff }, () => {
    for (const id of ['spamfilter', 'summarize']) {
        assert.equal(ctx.$('#' + id).checked, true, id + ' shown switched off, the policy says on');
    }
});

test('no locked value reached storage', () => {
    const local = ctx.ctl.localData();
    for (const id of LOCKED) assert.equal(local[id], undefined, id);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
