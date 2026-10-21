// Spec 08 "Strict mode", rule 3 and the _user_editable validation: a listed key stays the
// user's (the stored value, else prefs_default), and its writes go through; an entry that is
// not a string, names no preference, or names an excluded key (always user-editable anyway)
// is warned about and skipped; every other key is locked at its default.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('user-editable.json'), local: { do_debug: true } });
});

test('a listed key is not held by the policy: the stored value wins', async () => {
    assert.equal(ctx.mztaManaged.hasManagedValue('do_debug'), false);
    assert.equal(await ctx.mztaPrefs.getPref('do_debug'), true);
});

test('a listed key with nothing stored reads its default, and the user can change it', async () => {
    assert.equal(ctx.mztaManaged.hasManagedValue('default_sign_name'), false);
    assert.equal(await ctx.mztaPrefs.getPref('default_sign_name'), '');
    await ctx.mztaPrefs.setPref('default_sign_name', 'Mine');
    assert.equal(ctx.ctl.localData().default_sign_name, 'Mine');
    assert.equal(await ctx.mztaPrefs.getPref('default_sign_name'), 'Mine');
});

test('the invalid entries are warned about one by one', () => {
    const w = ctx.con.warnings();
    assert.ok(w.some(m => m.includes('"_user_editable"[2]') && m.includes('no_such_preference')));
    assert.ok(w.some(m => m.includes('"_user_editable"[3]') && m.includes('api_webchat_font_scale')));
    assert.ok(w.some(m => m.includes('"_user_editable"[4]') && m.includes('number')));
    assert.equal(w.some(m => m.includes('"do_debug"') || m.includes('"default_sign_name"')), false);
});

test('strict mode still applies to everything else', async () => {
    assert.equal(ctx.mztaManaged.isLockedByDefault('translate'), true);
    assert.equal(ctx.mztaManaged.isLockedByDefault('reply_type'), true);
    assert.equal(ctx.mztaManaged.hasManagedValue('api_webchat_font_scale'), false);
    await ctx.mztaPrefs.setPref('reply_type', 'reply_sender');
    assert.equal(ctx.ctl.localData().reply_type, undefined);
});
