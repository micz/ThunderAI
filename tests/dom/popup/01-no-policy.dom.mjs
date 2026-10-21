// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the popup page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the setup wizard link works.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';
import { msg } from '../../helpers/dom-page.mjs';

const ctx = await noPolicyScenario('popup');

test('with no connection, the popup offers a working setup wizard link', async () => {
    assert.equal(ctx.$('#setup_wizard_prompt').style.display, 'block');
    const link = ctx.$('#btn_popup_setup_wizard');
    assert.equal(link.hasAttribute('href'), true);
    assert.notEqual(link.textContent, msg('managed_restriction_wizard'));
    await ctx.click(link);
    const opened = ctx.apiCalls('browser.tabs.create');
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /setup-wizard/);
});
