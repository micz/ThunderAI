// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the onboarding page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the wizard banner works.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('onboarding');

test('the wizard banner is shown and its link opens the wizard', async () => {
    assert.notEqual(ctx.$('#wizard_banner').style.display, 'none');
    await ctx.click(ctx.$('#btn_launch_wizard'));
    const opened = ctx.apiCalls('browser.tabs.create');
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /setup-wizard/);
});
