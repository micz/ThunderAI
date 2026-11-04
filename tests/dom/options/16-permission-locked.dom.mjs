// Permission-gated switches locked by the policy, on the options page [#962].
//
// Spec 08c "Controls with their own load/save logic: data-mzta-pref" (the permission-gated
// switches) and spec 05 "Permission-gated toggles": a locked switch, re-enabled from the developer
// tools and changed, gets its enforced state back with no permission prompt and no write. Locked
// ON while Thunderbird has not granted its permissions, it gets a note in its .feature_info
// (feature_permission_missing_managed): the background skips locked keys and the user cannot
// switch it, so only the administrator can fix it. Locked on WITH its permissions: no note.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/dom-page.mjs';

// add_tags lacks messagesTags; the spam filter's permissions are granted.
const ctx = await openPage('options', {
    policy: { add_tags: true, spamfilter: true },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own', add_tags: false, spamfilter: false },
    permissions: { contains: q => !(q.permissions || []).includes('messagesTags') },
});
after(() => ctx.close());
const note = key => ctx.$('#' + key).closest('.feature_row').querySelector('[data-mzta-permission-warning]');

test('locked on without its permissions: the switch shows the policy value and a note saying to contact the administrator', () => {
    assert.equal(ctx.$('#add_tags').checked, true);
    assert.equal(ctx.$('#add_tags').disabled, true);
    assert.ok(note('add_tags'), 'the note is there');
    assert.equal(note('add_tags').textContent, msg('feature_permission_missing_managed', [msg('prefs_OptionText_add_tags')]));
    assert.ok(note('add_tags').classList.contains('shown'));
});

test('locked on with its permissions: no note', () => {
    assert.equal(ctx.$('#spamfilter').checked, true);
    assert.equal(note('spamfilter'), null);
});

test('the locked switch, re-enabled and changed, asks for no permission and writes nothing', async () => {
    const since = ctx.ctl.calls.length;
    const cb = ctx.$('#add_tags');
    cb.disabled = false;
    await ctx.click(cb);
    assert.equal(cb.checked, true, 'the enforced state is put back');
    assert.deepEqual(ctx.apiCalls('browser.permissions.request'), []);
    assert.deepEqual(ctx.localWrites(since).filter(w => 'add_tags' in w.items), []);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
