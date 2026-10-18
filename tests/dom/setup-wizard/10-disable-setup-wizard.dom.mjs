// Spec 08 "_disable_setup_wizard", the page itself: reaching the wizard means it was opened by
// its direct URL, so it "renders #wiz_blocked instead of the wizard"; the check runs before
// anything is built or injected.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await openPage('setup-wizard', {
    policy: { _org_name: 'ACME', ...loadFixture('disable-setup-wizard.json') },
});
after(() => ctx.close());

test('#wiz_blocked is shown, the steps and the navigation are not', () => {
    assert.equal(ctx.$('#wiz_blocked').classList.contains('hidden'), false);
    assert.equal(ctx.$('#wiz_steps').classList.contains('hidden'), true);
    assert.equal(ctx.$('#wiz_nav').classList.contains('hidden'), true);
    for (const body of ctx.$$('.wiz_step_body')) assert.equal(body.classList.contains('hidden'), true);
});

test('nothing was built or injected: no connection panel, no provider cards', () => {
    assert.equal(ctx.$('#connection_type'), null);
    assert.equal(ctx.$$('.wiz_provider_card').length, 0);
});

test('the banner says who configured it', () => {
    assert.equal(ctx.$('#managed_config_banner').classList.contains('shown'), true);
    assert.equal(ctx.$('#managed_config_banner .managed_banner_text').textContent, msg('managed_banner_org', ['ACME']));
});

test('nothing was written', () => {
    assert.deepEqual(ctx.localWrites(), []);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
