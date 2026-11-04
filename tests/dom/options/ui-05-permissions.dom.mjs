// The options page's permission-gated switches, Add Tags and Spam Filter, with no policy [#962].
//
// Spec 05 "Permission-gated toggles": each switch requests exactly its mapped permissions
// (FEATURE_PERMISSIONS) as the first API call of the change, writes true only once granted -
// never before, and never through the page's saveOptions() - and on a refusal or a failed request
// goes back off with an alert naming the feature (feature_permission_denied / _error), writing
// nothing. Switched off, it writes false. The Manage button follows the switch.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';
import {
    S_PERM,
    permissionToggleTests,
    featureAlerts
} from '../../ui/permission-toggle.mjs';

const permissions = {};       // .request swapped by a test (the harness reads it per call)
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', add_tags: false, spamfilter: false },
    permissions,
});
after(() => ctx.close());
const k = uiTests('options', '05');

permissionToggleTests(ctx, k, { key: 'add_tags', permissions, ...featureAlerts('prefs_OptionText_add_tags') });
permissionToggleTests(ctx, k, { key: 'spamfilter', permissions, ...featureAlerts('prefs_OptionText_spamfilter') });

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
