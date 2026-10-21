// The setup wizard's permission-gated switches, Add Tags and Spam Filter, with no policy: the
// direct fix of #962, where the wizard saved them through saveOptions() without ever asking for
// their Thunderbird permissions.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", step 2, and "Permission-gated toggles": the
// same flow as the options page - exactly the mapped permissions requested first, true written
// only once granted, a refusal or a failed request turning the switch back off with an alert and
// writing nothing, false written when switched off. Summarize and Translate are not gated: they
// are saved on change and ask for nothing.

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

const permissions = {};
const ctx = await openPage('setup-wizard', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key' },
    permissions,
});
after(() => ctx.close());
const k = uiTests('setup-wizard', '03');

permissionToggleTests(ctx, k, { key: 'add_tags', permissions, ...featureAlerts('prefs_OptionText_add_tags') });
permissionToggleTests(ctx, k, { key: 'spamfilter', permissions, ...featureAlerts('prefs_OptionText_spamfilter') });

k.test('not-gated', S_PERM, 'Summarize is not gated: saved on change, nothing requested', async () => {
    const since = ctx.ctl.calls.length;
    const n = ctx.apiCalls('browser.permissions.request').length;
    await userSets(ctx, ctx.$('#summarize'), !ctx.$('#summarize').checked);
    assert.equal(ctx.apiCalls('browser.permissions.request').length, n);
    assert.strictEqual(writtenSince(ctx, since).summarize, ctx.$('#summarize').checked);
});

k.test('harness-clean', S_PERM, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
