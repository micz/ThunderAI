// The options page's permission-gated switches, Add Tags, Spam Filter and the persistent storage of
// the advanced section, with no policy [#962, #955].
//
// Spec 05 "Permission-gated toggles": each switch requests exactly its mapped permissions
// (FEATURE_PERMISSIONS) as the first API call of the change, writes true only once granted -
// never before, and never through the page's saveOptions() - and on a refusal or a failed request
// goes back off with an alert naming the feature (feature_permission_denied / _error), writing
// nothing. Switched off, it writes false. The Manage button follows the switch.
// Spec 05 `storage_persistent` row: switched off, it also gives the unlimitedStorage permission
// back (permissions.remove); refused, there is nothing to give back.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    userSets,
    writtenSince
} from '../../ui/dom-helpers.mjs';
import {
    S_PERM,
    permissionToggleTests,
    featureAlerts
} from '../../ui/permission-toggle.mjs';

const permissions = {};       // .request swapped by a test (the harness reads it per call)
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', add_tags: false, spamfilter: false, storage_persistent: false },
    permissions,
});
after(() => ctx.close());
const k = uiTests('options', '05');

permissionToggleTests(ctx, k, { key: 'add_tags', permissions, ...featureAlerts('prefs_OptionText_add_tags') });
permissionToggleTests(ctx, k, { key: 'spamfilter', permissions, ...featureAlerts('prefs_OptionText_spamfilter') });
permissionToggleTests(ctx, k, { key: 'storage_persistent', slug: 'persistent', permissions, ...featureAlerts('prefs_OptionText_storage_persistent') });

const removed = () => ctx.apiCalls('browser.permissions.remove');

k.test('persistent-off-removes', S_PERM, 'storage_persistent switched off: false is stored and unlimitedStorage is given back', async () => {
    await userSets(ctx, ctx.$('#storage_persistent'), true);
    const n = removed().length;
    const since = ctx.ctl.calls.length;
    await userSets(ctx, ctx.$('#storage_persistent'), false);
    assert.strictEqual(writtenSince(ctx, since).storage_persistent, false);
    const calls = removed().slice(n);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[0], { permissions: ['unlimitedStorage'] });
});

k.test('persistent-denied-no-remove', S_PERM, 'storage_persistent refused: no permission to give back, nothing removed', async () => {
    permissions.request = () => false;
    permissions.contains = () => false;
    try {
        const n = removed().length;
        await userSets(ctx, ctx.$('#storage_persistent'), true);
        assert.equal(ctx.$('#storage_persistent').checked, false);
        assert.equal(removed().length, n);
    } finally {
        delete permissions.request;
        delete permissions.contains;
    }
});

k.test('manage-follows', S_PERM, 'the Manage button shows once granted, and stays hidden after a refusal', async () => {
    const btn = ctx.$('#btnManageTagsInfo');
    await userSets(ctx, ctx.$('#add_tags'), true);
    assert.notEqual(btn.style.display, 'none');
    await userSets(ctx, ctx.$('#add_tags'), false);
    assert.equal(btn.style.display, 'none');
    permissions.request = () => false;
    try {
        await userSets(ctx, ctx.$('#add_tags'), true);
        assert.equal(btn.style.display, 'none');
        assert.equal(btn.disabled, true);
    } finally {
        delete permissions.request;
    }
});

k.test('harness-clean', S_PERM, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
