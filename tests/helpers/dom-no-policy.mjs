/*
 *  Spec 08 Overview: "With no policy installed the behaviour is byte-for-byte what it was
 *  before this existed." Seen from a page: the managed code must leave no trace at all -
 *  nothing disabled or marked by it, no banner, no padlock, no restriction note, no warning.
 *
 *  Shared by every tests/dom/<page>/01-no-policy.dom.mjs, so all pages get the same checks.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, managedArtifacts, managedControls, controlKey } from './dom-page.mjs';
import { REPO } from './load.mjs';

/**
 * @param {string} page
 * @param {object} o
 *   local          storage.local for the page
 *   accounts       what accounts.list() returns
 *   usesManagedUi  whether the page asks the background for the managed state
 */
export async function noPolicyScenario(page, { local = {}, accounts, usesManagedUi = true } = {}) {
    const ctx = await openPage(page, { policy: null, local, accounts });
    after(() => ctx.close());

    test('no control is disabled or marked by the managed code', () => {
        const a = managedArtifacts(ctx.document);
        assert.deepEqual(a.marked, [], 'elements with data-mzta-managed');
        assert.equal(ctx.$$('[data-mzta-managed-lock]').length, 0, 'inertness handlers installed');
        for (const el of managedControls(ctx.document)) {
            if (!controlKey(el)) continue;
            assert.equal(el.dataset.mztaManaged, undefined, controlKey(el));
        }
    });

    test('no marker, no padlock, no disabled link', () => {
        const a = managedArtifacts(ctx.document);
        assert.equal(a.markers, 0, '.managed_marker');
        assert.equal(a.secrets, 0, '.managed_secret');
        assert.equal(a.disabledLinks, 0, '.managed_disabled');
        assert.equal(ctx.$$('img[src*="pwd-locked"]').length, 0, 'padlock image');
    });

    test('no managed banner and no restriction note', () => {
        const a = managedArtifacts(ctx.document);
        assert.equal(a.bannerShown, false, 'banner shown');
        assert.equal(a.restrictionNotes, 0, 'restriction note shown');
        const banner = ctx.$('#managed_config_banner');
        if (banner) assert.equal(banner.textContent.trim(), '', 'banner text filled in');
    });

    if (usesManagedUi) {
        test('the page sees an inactive, empty managed state', async () => {
            const ui = await import(new URL('pages/_lib/managed-ui.js', REPO).href);
            const state = await ui.getManagedState();
            assert.equal(state.active, false);
            assert.equal(state.orgName, '');
            assert.deepEqual(state.lockedKeys, []);
            assert.equal(ui.isPromptManagementDisabled(), false);
            assert.equal(ui.areDefaultPromptsDisabled(), false);
            assert.equal(ui.isSetupWizardDisabled(), false);
        });
    }

    test('hydration found nothing to apply, silently', () => {
        assert.equal(ctx.mods.mztaManaged.isManagedActive(), false);
        assert.deepEqual(ctx.mods.mztaManaged.getLockedKeys(), []);
        assert.deepEqual(ctx.con.warnings(), [], 'console warnings');
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
