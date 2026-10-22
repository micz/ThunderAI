// The calendar event page's permission-gated switch, the clipboard event, with no policy [#962].
//
// Spec 05 "Permission-gated toggles" and the `get_calendar_event_from_clipboard` row of "Feature
// Flags": the shared flow, with the page's own alerts (clipboard_permission_denied / _error). The
// page no longer writes true through saveOptions() and rolls it back on a refusal: nothing is
// written until the permission is granted. The menus are reloaded after every outcome.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';
import {
    S_PERM,
    permissionToggleTests
} from '../../ui/permission-toggle.mjs';

const permissions = {};
const ctx = await openPage('get-calendar-event', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', get_calendar_event: true, get_calendar_event_from_clipboard: false },
    permissions,
});
after(() => ctx.close());
const k = uiTests('get-calendar-event', '03');
const reloads = () => ctx.ctl.sent.filter(m => m?.command === 'reload_menus').length;

permissionToggleTests(ctx, k, {
    key: 'get_calendar_event_from_clipboard',
    slug: 'clipboard',
    permissions,
    deniedMsg: msg('clipboard_permission_denied'),
    errorMsg: msg('clipboard_permission_error'),
});

k.test('reload-on-refusal', S_PERM, 'a refusal still reloads the menus', async () => {
    permissions.request = () => false;
    try {
        const before = reloads();
        await userSets(ctx, ctx.$('#get_calendar_event_from_clipboard'), true);
        assert.equal(reloads(), before + 1);
    } finally {
        delete permissions.request;
    }
});

k.test('harness-clean', S_PERM, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
