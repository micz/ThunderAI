/*
 *  Spec 08 "UI": showManagedBanner() fills #managed_config_banner's .managed_banner_text and
 *  reveals it (.shown) whenever a policy is active, naming the organization when _org_name is
 *  set (managed_banner_org) and generically otherwise (managed_banner). The markers follow
 *  the same rule (managed_marker_org / managed_marker).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from './dom-page.mjs';

export async function bannerScenario(page, orgName) {
    const policy = { connection_type: 'chatgpt_api' };
    if (orgName) policy._org_name = orgName;
    const ctx = await openPage(page, { policy });
    after(() => ctx.close());

    test('the banner is shown', () => {
        assert.equal(ctx.$('#managed_config_banner').classList.contains('shown'), true);
    });

    test(orgName ? 'the banner names the organization' : 'without _org_name the banner is generic', () => {
        assert.equal(ctx.$('#managed_config_banner .managed_banner_text').textContent,
            orgName ? msg('managed_banner_org', [orgName]) : msg('managed_banner'));
    });

    test(orgName ? 'the markers name the organization' : 'without _org_name the markers are generic', () => {
        const markers = ctx.$$('.managed_marker');
        assert.ok(markers.length > 0, 'no marker on the locked connection_type');
        for (const m of markers) {
            assert.equal(m.textContent, orgName ? msg('managed_marker_org', [orgName]) : msg('managed_marker'));
        }
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
