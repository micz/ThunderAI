// The clipboard event locked ON by the policy while Thunderbird has not granted clipboardRead
// [#962].
//
// Spec 08c "Controls with their own load/save logic: data-mzta-pref" (the permission-gated
// switches) and spec 05 "Permission-gated toggles": the switch shows the enforced value with a
// note (feature_permission_missing_managed); changed by hand it is put back, with no prompt, no
// write and no menu reload.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/dom-page.mjs';

const ctx = await openPage('get-calendar-event', {
    policy: { get_calendar_event_from_clipboard: true },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own', get_calendar_event: true, get_calendar_event_from_clipboard: false },
    permissions: { contains: q => !(q.permissions || []).includes('clipboardRead') },
});
after(() => ctx.close());
const cb = () => ctx.$('#get_calendar_event_from_clipboard');
const note = () => cb().closest('.feature_row').querySelector('[data-mzta-permission-warning]');

test('locked on without clipboardRead: the enforced value, and a note saying to contact the administrator', () => {
    assert.equal(cb().checked, true);
    assert.equal(cb().disabled, true);
    assert.equal(note()?.textContent, msg('feature_permission_missing_managed', [msg('prefs_OptionText_get_calendar_event_from_clipboard')]));
});

test('re-enabled and changed by hand: put back, no permission prompt, nothing written, no menu reload', async () => {
    const since = ctx.ctl.calls.length;
    const reloads = ctx.ctl.sent.filter(m => m?.command === 'reload_menus').length;
    cb().disabled = false;
    await ctx.click(cb());
    assert.equal(cb().checked, true);
    assert.deepEqual(ctx.apiCalls('browser.permissions.request'), []);
    assert.deepEqual(ctx.localWrites(since).filter(w => 'get_calendar_event_from_clipboard' in w.items), []);
    assert.equal(ctx.ctl.sent.filter(m => m?.command === 'reload_menus').length, reloads);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
