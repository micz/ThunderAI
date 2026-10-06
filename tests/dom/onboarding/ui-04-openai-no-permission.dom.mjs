// The welcome page of a user who chose OpenAI API without granting its host permission, no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", "Blue wizard banner vs. red permission banner"
// (the chosen provider's red banner only) and the "Onboarding banner" entry point (the red
// banner's click requests that provider's permission; granted, the "permission granted" notice
// replaces it). The refused case and the notice closing the tab are ui-02, for ChatGPT Web.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('onboarding', {
    local: { connection_type: 'chatgpt_api' },
    permissions: { contains: () => false, request: () => true },
});
after(() => ctx.close());
const k = uiTests('onboarding', '04');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';

k.test('red-banner', S_WIZ, 'the OpenAI API red permission banner is shown, the other two are not', () => {
    assert.equal($('#openai_api_permission').style.display, 'block');
    assert.notEqual($('#chatgpt_web_permission').style.display, 'block');
    assert.notEqual($('#anthropic_api_permission').style.display, 'block');
    assert.deepEqual(ctx.apiCalls('browser.permissions.contains').map(c => c.args[0].origins), [['https://*.openai.com/*']]);
});

k.test('click-granted', S_WIZ, 'a click requests the OpenAI API permission; granted, the notice replaces the banner', async () => {
    await ctx.click($('#openai_api_permission'));
    assert.deepEqual(ctx.apiCalls('browser.permissions.request').map(c => c.args[0].origins), [['https://*.openai.com/*']]);
    assert.equal($('#openai_api_permission').style.display, 'none');
    assert.equal($('#integration_permission_ok').style.display, 'block');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
