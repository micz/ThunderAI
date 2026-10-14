/*
 *  The tests of a permission-gated switch, shared by the pages that show one [#962].
 *
 *  Spec 05 "Permission-gated toggles" (and spec 01 "Feature permissions"): every switch of a
 *  preference in FEATURE_PERMISSIONS (js/mzta-feature-permissions.js) goes through
 *  bindPermissionToggle() (pages/_lib/permission-toggle.js):
 *    - checked: permissions.request() with exactly the mapped permissions is the first API call
 *      of the change; true is written only once it resolved to true, never before;
 *    - refused or failed: the switch goes back off, an alert names the feature, nothing written;
 *    - unchecked: false is written, nothing requested.
 *
 *  Not a test file (no .dom.mjs suffix). The page must be opened with a `permissions` object the
 *  test can give a `request` (the harness reads it per call), and the switch must start off.
 */

import assert from 'node:assert/strict';
import { msg } from '../helpers/core/dom-harness.mjs';
import { FEATURE_PERMISSIONS } from '../../js/mzta-feature-permissions.js';
import { userSets } from './dom-helpers.mjs';

export const S_PERM = 'spec 05 "Permission-gated toggles"';

/** The values the page wrote for `key` since `since` (an index into ctx.ctl.calls). */
const writesOf = (ctx, since, key) => ctx.localWrites(since).map(c => c.items[key]).filter(v => v !== undefined);

/**
 * Declare the tests of one switch.
 *
 * @param {object} ctx           the page
 * @param {object} k             uiTests() of the file
 * @param {object} o
 *   key            the preference (the switch's id is the key)
 *   permissions    the `permissions` object given to openPage()
 *   deniedMsg      the alert on a refusal; errorMsg the alert on a failed request
 *   slug           prefix of the case ids (default: the key, kebab-case)
 */
export function permissionToggleTests(ctx, k, { key, permissions, deniedMsg, errorMsg, slug = key.replace(/_/g, '-') }) {
    const el = () => ctx.$('#' + key);
    const asked = () => ctx.apiCalls('browser.permissions.request');
    // Read when the tests are declared: the page is loaded, no test has run yet.
    const askedOnLoad = asked().length;

    k.test(slug + '-starts-off', S_PERM, key + ': the switch starts off and the page asked for nothing on load', () => {
        assert.equal(el().checked, false);
        assert.equal(el().disabled, false);
        assert.equal(askedOnLoad, 0);
    });

    k.test(slug + '-held', S_PERM, key + ': while the request is pending, true is not written and the request was the first API call of the change', async () => {
        let release;
        permissions.request = () => new Promise(r => { release = r; });
        try {
            const since = ctx.ctl.calls.length;
            const before = ctx.apiCalls().length;
            el().click();
            for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
            const after = ctx.apiCalls().slice(before);
            assert.ok(after.length > 0, 'something was called');
            assert.equal(after[0].api, 'browser.permissions.request', 'the first API call of the change');
            assert.deepEqual([...after[0].args[0].permissions].sort(), [...FEATURE_PERMISSIONS[key]].sort());
            assert.deepEqual(writesOf(ctx, since, key), [], 'nothing written before the answer');
            release(true);
            await ctx.settle();
            assert.deepEqual(writesOf(ctx, since, key), [true], 'true once granted, written once');
            assert.equal(el().checked, true);
        } finally {
            delete permissions.request;
        }
    });

    k.test(slug + '-off', S_PERM, key + ': switched off, false is written and nothing is requested', async () => {
        const since = ctx.ctl.calls.length;
        const n = asked().length;
        await userSets(ctx, el(), false);
        assert.equal(asked().length, n);
        assert.deepEqual(writesOf(ctx, since, key), [false]);
    });

    k.test(slug + '-granted', S_PERM, key + ': granted at once, true is written', async () => {
        const since = ctx.ctl.calls.length;
        const n = asked().length;
        await userSets(ctx, el(), true);
        const req = asked().slice(n);
        assert.equal(req.length, 1);
        assert.deepEqual([...req[0].args[0].permissions].sort(), [...FEATURE_PERMISSIONS[key]].sort());
        assert.deepEqual(writesOf(ctx, since, key), [true]);
        await userSets(ctx, el(), false);
    });

    k.test(slug + '-denied', S_PERM, key + ': refused, the switch goes back off with an alert and nothing is written', async () => {
        permissions.request = () => false;
        try {
            const since = ctx.ctl.calls.length;
            const dialogs = ctx.dialogs.length;
            await userSets(ctx, el(), true);
            assert.equal(el().checked, false);
            assert.deepEqual(writesOf(ctx, since, key), []);
            assert.notStrictEqual(ctx.ctl.localData()[key], true);
            assert.deepEqual(ctx.dialogs.slice(dialogs), [{ kind: 'alert', args: [deniedMsg] }]);
        } finally {
            delete permissions.request;
        }
    });

    k.test(slug + '-error', S_PERM, key + ': a failed request turns the switch back off with its alert, nothing written', async () => {
        permissions.request = () => { throw new Error('request failed'); };
        try {
            const since = ctx.ctl.calls.length;
            const dialogs = ctx.dialogs.length;
            await userSets(ctx, el(), true);
            assert.equal(el().checked, false);
            assert.deepEqual(writesOf(ctx, since, key), []);
            assert.deepEqual(ctx.dialogs.slice(dialogs), [{ kind: 'alert', args: [errorMsg] }]);
        } finally {
            delete permissions.request;
        }
    });

    k.test(slug + '-no-warning', S_PERM, key + ': unlocked, no missing-permission note is shown', () => {
        assert.equal(el().closest('.feature_row').querySelector('[data-mzta-permission-warning]'), null);
    });
}

/** The default alerts, which name the feature by the label of its switch. */
export const featureAlerts = (labelKey) => ({
    deniedMsg: msg('feature_permission_denied', [msg(labelKey)]),
    errorMsg: msg('feature_permission_error', [msg(labelKey)]),
});
