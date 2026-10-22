// Permission-gated switches locked by the policy, in the setup wizard [#962].
//
// Spec 08c "Controls with their own load/save logic: data-mzta-pref" (the permission-gated
// switches), spec 05 "Permission-gated toggles": the same as on the options page - a locked switch
// changed by hand gets its enforced state back with no prompt and no write; locked on without its
// permissions it shows feature_permission_missing_managed; with them, no note.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/dom-page.mjs';

// The spam filter lacks messagesMove; add_tags' permissions are granted.
const ctx = await openPage('setup-wizard', {
    policy: { add_tags: true, spamfilter: true },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own' },
    permissions: { contains: q => !(q.permissions || []).includes('messagesMove') },
});
after(() => ctx.close());
const note = key => ctx.$('#' + key).closest('.feature_row').querySelector('[data-mzta-permission-warning]');

test('locked on without its permissions: a note saying to contact the administrator', () => {
    assert.equal(ctx.$('#spamfilter').checked, true);
    assert.equal(ctx.$('#spamfilter').disabled, true);
    assert.equal(note('spamfilter')?.textContent, msg('feature_permission_missing_managed', [msg('prefs_OptionText_spamfilter')]));
});

test('locked on with its permissions: no note', () => {
    assert.equal(ctx.$('#add_tags').checked, true);
    assert.equal(note('add_tags'), null);
});

test('the locked switch, re-enabled and changed, asks for no permission and writes nothing', async () => {
    const since = ctx.ctl.calls.length;
    const cb = ctx.$('#spamfilter');
    cb.disabled = false;
    await ctx.click(cb);
    assert.equal(cb.checked, true, 'the enforced state is put back');
    assert.deepEqual(ctx.apiCalls('browser.permissions.request'), []);
    assert.deepEqual(ctx.localWrites(since).filter(w => 'spamfilter' in w.items), []);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
