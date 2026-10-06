// The welcome page of a user who chose ChatGPT Web without granting its host permission, no
// policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Onboarding banner" (always
// visible, not urgent once a connection is selected) and "Blue wizard banner vs. red permission
// banner" (the red banner of the chosen provider only: "you chose this provider but haven't
// granted its host permission").

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('onboarding', {
    local: { connection_type: 'chatgpt_web' },
    permissions: { contains: () => false },
});
after(() => ctx.close());
const k = uiTests('onboarding', '02');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';

k.test('banner-calm', S_WIZ, 'the wizard banner stays visible, without the urgent emphasis', () => {
    assert.notEqual($('#wizard_banner').style.display, 'none');
    assert.equal($('#wizard_banner').classList.contains('wizard_banner_urgent'), false);
});

k.test('red-banner', S_WIZ, 'the chosen provider\'s red permission banner is shown, the other two are not', () => {
    assert.equal($('#chatgpt_web_permission').style.display, 'block');
    assert.notEqual($('#anthropic_api_permission').style.display, 'block');
    assert.notEqual($('#openai_api_permission').style.display, 'block');
    assert.deepEqual(ctx.apiCalls('browser.permissions.contains').map(c => c.args[0].origins), [['https://*.chatgpt.com/*']]);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
