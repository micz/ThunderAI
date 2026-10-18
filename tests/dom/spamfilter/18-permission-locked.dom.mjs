// The address book check locked ON by the policy while Thunderbird has not granted addressBooks
// [#962].
//
// Spec 08c "Controls with their own load/save logic: data-mzta-pref" and spec 05 "Permission-gated
// toggles": the switch shows the enforced value with a note (feature_permission_missing_managed),
// since neither the background (which skips locked keys) nor the user can fix it; changed by hand
// it is put back, with no prompt and no write. (04-respect-managed covers it locked OFF.)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/dom-page.mjs';

const ctx = await openPage('spamfilter', {
    policy: { spamfilter_skip_addressbook: true },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own', spamfilter: true, spamfilter_skip_addressbook: false },
    permissions: { contains: q => !(q.permissions || []).includes('addressBooks') },
});
after(() => ctx.close());
const cb = () => ctx.$('#spamfilter_skip_addressbook');
const note = () => cb().closest('.feature_row').querySelector('[data-mzta-permission-warning]');

test('locked on without addressBooks: the enforced value, and a note saying to contact the administrator', () => {
    assert.equal(cb().checked, true);
    assert.equal(cb().disabled, true);
    assert.equal(note()?.textContent, msg('feature_permission_missing_managed', [msg('prefs_OptionText_spamfilter_skip_addressbook')]));
});

test('re-enabled and changed by hand: put back, no permission prompt, nothing written', async () => {
    const since = ctx.ctl.calls.length;
    cb().disabled = false;
    await ctx.click(cb());
    assert.equal(cb().checked, true);
    assert.deepEqual(ctx.apiCalls('browser.permissions.request'), []);
    assert.deepEqual(ctx.localWrites(since).filter(w => 'spamfilter_skip_addressbook' in w.items), []);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
