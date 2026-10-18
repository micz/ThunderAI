// Spec 08 "_disable_setup_wizard", popup row: the setup_wizard_prompt panel replaces the
// prompt list when no connection is configured, so it cannot simply be hidden - "the link
// text becomes the explanation, so the user learns the connection is configured centrally
// rather than clicking a dead end".

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await openPage('popup', { policy: loadFixture('disable-setup-wizard.json') });
after(() => ctx.close());

test('with no connection, the wizard invitation is shown', () => {
    assert.equal(ctx.$('#setup_wizard_prompt').style.display, 'block');
});

test('its link has become the explanation, with no href', () => {
    const link = ctx.$('#btn_popup_setup_wizard');
    assert.equal(link.textContent, msg('managed_restriction_wizard'));
    assert.equal(link.hasAttribute('href'), false);
    assert.equal(link.classList.contains('managed_disabled'), true);
});

test('clicking it opens nothing and keeps the popup open', async () => {
    await ctx.click(ctx.$('#btn_popup_setup_wizard'));
    assert.deepEqual(ctx.apiCalls('browser.tabs.create'), []);
    assert.equal(ctx.dialogs.filter(d => d.kind === 'close').length, 0);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
