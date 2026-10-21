// Spec 08 "Strict mode": with "_lock_unlisted": true and nothing else, every allowlisted
// preference is enforced at its prefs_default value - the same lock an explicit policy value
// gets: write guard, shadowed stored value, sent to the pages - except the
// *_enabled_accounts_match keys, whose default means "not managed". The excluded keys stay the
// user's. The stored values are never touched, so a start without strict mode restores them.
// A key locked at its default '' reaches a settings page as '', never as MANAGED_SECRET_MARKER.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';
import { extractManagedValuesListener } from '../helpers/background-handler.mjs';

const EXCLUDED = key =>
    /^chatgpt_win_/.test(key) || /_enabled_accounts$/.test(key) ||
    key === 'api_webchat_font_scale' || key === 'custom_prompts_view';
const ACCOUNT_MATCH = key => /_enabled_accounts_match$/.test(key);

const STORED = {
    default_sign_name: 'My own name',
    do_debug: true,
    chatgpt_api_key: 'sk-user-own',
    api_webchat_font_scale: 1.4,
};

let ctx, expected;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('lock-unlisted.json'), local: STORED });
    expected = Object.keys(ctx.prefs_default).filter(k => !EXCLUDED(k) && !ACCOUNT_MATCH(k)).sort();
});

test('every allowlisted key except the account matchers is locked, at its default', () => {
    assert.deepEqual(ctx.mztaManaged.getLockedKeys().sort(), expected);
    for (const key of expected) {
        assert.deepEqual(ctx.mztaManaged.getManagedValue(key), ctx.prefs_default[key], key);
        assert.equal(ctx.mztaManaged.isLockedByDefault(key), true, key);
    }
});

test('the excluded keys and the account matchers are not held by the policy', () => {
    for (const key of Object.keys(ctx.prefs_default).filter(k => EXCLUDED(k) || ACCOUNT_MATCH(k))) {
        assert.equal(ctx.mztaManaged.hasManagedValue(key), false, key);
    }
});

test('a stored user value is shadowed on read, and an excluded key keeps it', async () => {
    assert.equal(await ctx.mztaPrefs.getPref('default_sign_name'), '');
    assert.equal(await ctx.mztaPrefs.getPref('do_debug'), false);
    assert.equal(await ctx.mztaPrefs.getPref('api_webchat_font_scale'), 1.4);
});

test('the write guard refuses a key locked at its default, and storage keeps the user value', async () => {
    await ctx.mztaPrefs.setPref('default_sign_name', 'Changed');
    assert.equal(ctx.ctl.localData().default_sign_name, 'My own name');
    await ctx.mztaPrefs.setPref('api_webchat_font_scale', 1.2);
    assert.equal(ctx.ctl.localData().api_webchat_font_scale, 1.2);
});

test('the policy is active, and a valid strict mode warns about nothing at load', () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
    assert.deepEqual(ctx.con.warnings().filter(w => w.includes('Policy:')), []);
});

test('a start without strict mode restores every stored user value', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'readPrefs',
        ['default_sign_name', 'do_debug', 'chatgpt_api_key']);
    assert.deepEqual(r.result, {
        default_sign_name: 'My own name', do_debug: true, chatgpt_api_key: 'sk-user-own',
    });
});

test('get_managed_values: an API key locked at its default is empty for every page, never the marker', async () => {
    const listener = extractManagedValuesListener({
        browser: ctx.ctl.browser,
        mztaManaged: ctx.mztaManaged,
        MANAGED_SECRET_MARKER: ctx.MANAGED_SECRET_MARKER,
        prefs_default: ctx.prefs_default,
    });
    const keys = expected.filter(k => k.endsWith('_api_key'));
    assert.ok(keys.length > 0);
    for (const sender of [SENDERS.options, SENDERS.popup, SENDERS.webchat]) {
        const reply = await listener({ command: 'get_managed_values' }, sender);
        for (const key of keys) assert.equal(reply.values[key], '', key + ' for ' + sender.url);
        assert.deepEqual([...reply.lockedKeys].sort(), expected);
    }
});
