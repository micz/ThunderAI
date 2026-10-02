// Spec 08 "_disable_setup_wizard", options row: btn_setup_wizard and btn_options_setup_wizard
// are disabled in place (disableForManagedRestriction(): for an <a>, no href, aria-disabled,
// .managed_disabled), and openSetupWizard() returns early too - "a restriction must not depend
// on a control staying disabled". A restriction-only policy still shows the banner.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await openPage('options', { policy: loadFixture('disable-setup-wizard.json') });
after(() => ctx.close());

for (const id of ['btn_setup_wizard', 'btn_options_setup_wizard']) {
    test(`${id} is disabled by the restriction`, () => {
        const a = ctx.$('#' + id);
        assert.equal(a.dataset.mztaManaged, '1');
        assert.equal(a.hasAttribute('href'), false);
        assert.equal(a.getAttribute('aria-disabled'), 'true');
        assert.equal(a.classList.contains('managed_disabled'), true);
        assert.equal(a.title, msg('managed_restriction_tooltip'));
    });

    test(`${id}: clicking it - even past the swallowers - opens nothing`, async () => {
        const a = ctx.$('#' + id);
        await ctx.click(a);
        a.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: false, cancelable: true }));
        await ctx.settle();
        assert.deepEqual(ctx.apiCalls('browser.tabs.create'), []);
    });
}

test('a restriction-only policy is active: the banner explains the disabled buttons', () => {
    assert.equal(ctx.$('#managed_config_banner').classList.contains('shown'), true);
    assert.equal(ctx.$('#managed_config_banner .managed_banner_text').textContent, msg('managed_banner'));
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
