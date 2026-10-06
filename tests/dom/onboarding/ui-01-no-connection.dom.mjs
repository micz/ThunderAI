// The welcome page on a fresh install (no connection selected), every host permission missing,
// no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Onboarding banner" (always
// visible; `.wizard_banner_urgent` when no connection is selected) and "Blue wizard banner vs.
// red permission banner" (the red banners are keyed on an explicitly selected provider, so an
// empty `connection_type` never triggers them, even with every permission missing).
// The banner's link opening the wizard is managed's onboarding/01-no-policy.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('onboarding', { permissions: { contains: () => false } });
after(() => ctx.close());
const k = uiTests('onboarding', '01');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const RED = ['chatgpt_web_permission', 'anthropic_api_permission', 'openai_api_permission'];

k.test('banner-urgent', S_WIZ, 'with no connection selected the wizard banner is shown with `.wizard_banner_urgent`', () => {
    assert.notEqual($('#wizard_banner').style.display, 'none');
    assert.equal($('#wizard_banner').classList.contains('wizard_banner_urgent'), true);
});

k.test('no-red-banner', S_WIZ, 'no red permission banner, though every host permission is missing', () => {
    for (const id of RED) assert.notEqual($('#' + id).style.display, 'block', id);
    assert.deepEqual(ctx.apiCalls('browser.permissions.contains'), [], 'a permission was checked for no provider');
});

k.test('nothing-written', S_WIZ, 'opening the page writes nothing', () => {
    assert.deepEqual(ctx.localWrites(0), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
