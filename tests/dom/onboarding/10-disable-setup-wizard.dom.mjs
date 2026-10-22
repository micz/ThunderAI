// Spec 08 "_disable_setup_wizard", onboarding row: wizard_banner is hidden - "it exists only
// to lead there" - and its link is disabled through disableForManagedRestriction(). The click
// handler returns early as well, because a restriction must not depend on a control staying
// disabled.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await openPage('onboarding', { policy: loadFixture('disable-setup-wizard.json') });
after(() => ctx.close());

test('the wizard banner is hidden, and not flagged urgent', () => {
    assert.equal(ctx.$('#wizard_banner').style.display, 'none');
    assert.equal(ctx.$('#wizard_banner').classList.contains('wizard_banner_urgent'), false);
});

test('its link is disabled by the restriction', () => {
    const a = ctx.$('#btn_launch_wizard');
    assert.equal(a.dataset.mztaManaged, '1');
    assert.equal(a.hasAttribute('href'), false);
    assert.equal(a.getAttribute('aria-disabled'), 'true');
    assert.equal(a.classList.contains('managed_disabled'), true);
    assert.equal(a.title, msg('managed_restriction_tooltip'));
});

test('clicking it - even with the swallowers bypassed - opens nothing', async () => {
    const a = ctx.$('#btn_launch_wizard');
    await ctx.click(a);
    // Dispatched on the element itself: a capturing swallower on the element does not stop
    // its own non-capturing listener, so this reaches the page handler's early return.
    a.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: false, cancelable: true }));
    await ctx.settle();
    assert.deepEqual(ctx.apiCalls('browser.tabs.create'), []);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
