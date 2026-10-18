// Spec 08 "Controls with their own load/save logic: data-mzta-pref": lockCompanions() marks
// the Save button, so the "unsaved changes" input handler - which now uses
// setDisabledRespectingManaged() - keeps it disabled; every save path and the
// spamfilter_skip_addressbook change handler return early on a locked key, "so neither a
// write nor the permission prompt can be triggered from a control re-enabled in the
// developer tools".

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';

const ctx = await openPage('spamfilter', {
    policy: { spamfilter_skip_addresses: ['noreply@acme.example'], spamfilter_skip_addressbook: false },
    local: {
        connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own',
        spamfilter_skip_addresses: ['friend@user.example'], spamfilter_skip_addressbook: true,
    },
});
after(() => ctx.close());

test('typing in the locked list never enables its Save button, even once re-enabled by hand', async () => {
    const ta = ctx.$('#spamfilter_skip_addresses');
    const save = ctx.$('#btn_save_skip_addresses');
    ta.value = 'typed@user.example';
    await ctx.fire(ta, 'input');
    assert.equal(save.disabled, true, 'Save enabled by the input handler');
    ta.disabled = false;
    ta.value = 'typed-again@user.example';
    await ctx.fire(ta, 'input');
    assert.equal(save.disabled, true, 'Save enabled by the input handler after re-enabling');
});

test('a Save button re-enabled by hand still writes nothing', async () => {
    const save = ctx.$('#btn_save_skip_addresses');
    save.disabled = false;
    await ctx.click(save);
    assert.deepEqual(ctx.ctl.localData().spamfilter_skip_addresses, ['friend@user.example']);
});

test('the locked address-book checkbox, re-enabled and changed, asks for no permission and writes nothing', async () => {
    const cb = ctx.$('#spamfilter_skip_addressbook');
    assert.equal(cb.checked, false, 'shows the policy value');
    cb.disabled = false;
    cb.checked = true;
    await ctx.fire(cb, 'change');
    assert.equal(cb.checked, false, 'the enforced state is put back');
    assert.deepEqual(ctx.apiCalls('browser.permissions.request'), []);
    assert.equal(ctx.ctl.localData().spamfilter_skip_addressbook, true, 'stored user value changed');
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
