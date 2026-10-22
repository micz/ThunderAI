// The spam filter page's permission-gated switch, the address book check, with no policy [#962].
//
// Spec 05 "Permission-gated toggles" and the `spamfilter_skip_addressbook` row of "Feature
// Flags": the shared flow, with the page's own alerts (addressbook_permission_denied / _error).

import { after } from 'node:test';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    S_PERM,
    permissionToggleTests
} from '../../ui/permission-toggle.mjs';

const permissions = {};
const ctx = await openPage('spamfilter', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', spamfilter: true, spamfilter_skip_addressbook: false },
    permissions,
});
after(() => ctx.close());
const k = uiTests('spamfilter', '03');

permissionToggleTests(ctx, k, {
    key: 'spamfilter_skip_addressbook',
    slug: 'addressbook',
    permissions,
    deniedMsg: msg('addressbook_permission_denied'),
    errorMsg: msg('addressbook_permission_error'),
});

k.test('harness-clean', S_PERM, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
