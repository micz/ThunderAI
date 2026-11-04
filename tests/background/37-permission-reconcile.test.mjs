// The permission rule of the flag repair, and the permissions.onRemoved listener [#962].
//
// Spec 01 "Feature permissions" (and "Background Preference Snapshot and Menu Invalidation", the
// flag repair):
//  - FEATURE_PERMISSIONS (js/mzta-feature-permissions.js) maps each permission-gated preference to
//    the optional API permissions it needs: add_tags, spamfilter, spamfilter_skip_addressbook,
//    get_calendar_event_from_clipboard;
//  - _reconcileFeatureFlags() turns OFF every one of them that is true while its permissions are
//    missing (true -> false only), at startup and on every storage change that names one of
//    them; it leaves it on when they are granted; it skips the keys the policy locks;
//  - none of the exceptions of the connection rule applies: a feature with its own integration,
//    or a Sparks feature with Sparks absent, is still judged on its permissions alone - and the
//    clipboard flag is not turned off because Sparks is absent;
//  - the sub-option (spamfilter_skip_addressbook) is turned off alone, the spam filter stays on;
//  - permissions.onRemoved turns off exactly the preferences that need a removed permission
//    (messagesUpdate is shared by add_tags and the spam filter), addressBooks and clipboardRead
//    included, and skips locked keys.
//
// The area runs with no policy (README): a locked key is simulated by stubbing the two questions
// the code asks js/mzta-managed.js (isManagedLocked / getManagedValue), for one test.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { mztaManaged } from '../../js/mzta-managed.js';
import { FEATURE_PERMISSIONS } from '../../js/mzta-feature-permissions.js';
import { DEFAULT_PERMISSIONS } from './apis.mjs';

const GATED = Object.keys(FEATURE_PERMISSIONS);

// Started with every gated feature on, add_tags on its own integration, and only the address
// book and clipboard permissions granted: add_tags and the spam filter lack theirs.
const ctx = await bgContext({
    local: {
        ...API,
        add_tags: true,
        add_tags_auto: true,
        add_tags_use_specific_integration: true,
        add_tags_connection_type: 'openai_comp_api',
        spamfilter: true,
        spamfilter_skip_addressbook: true,
        get_calendar_event: true,
        get_calendar_event_from_clipboard: true,
        summarize: false,
        translate: false,
    },
    mail: { permissions: ['addressBooks', 'clipboardRead'] },
});
const k = caseTests('37-permission-reconcile');
const stored = async (keys = GATED) => ctx.ctl.browser.storage.local.get(keys);
const grantAll = () => DEFAULT_PERMISSIONS.forEach(p => ctx.m.permissions.add(p));
const removedListener = () => {
    const listeners = ctx.ctl.browser.permissions.onRemoved._listeners;
    assert.equal(listeners.length, 1, 'one permissions.onRemoved listener');
    return listeners[0];
};
/** Lock `locked` (key -> enforced value) for the rest of test t. */
const lock = (t, locked) => {
    const isLocked = mztaManaged.isManagedLocked.bind(mztaManaged);
    const value = mztaManaged.getManagedValue.bind(mztaManaged);
    t.mock.method(mztaManaged, 'isManagedLocked', key => (key in locked) || isLocked(key));
    t.mock.method(mztaManaged, 'getManagedValue', key => (key in locked) ? locked[key] : value(key));
};

k.test('map', 'the map lists the four permission-gated preferences and their permissions', () => {
    assert.deepEqual(FEATURE_PERMISSIONS, {
        add_tags: ['messagesTags', 'messagesUpdate'],
        spamfilter: ['messagesMove', 'messagesUpdate'],
        spamfilter_skip_addressbook: ['addressBooks'],
        get_calendar_event_from_clipboard: ['clipboardRead'],
    });
    assert.deepEqual([...new Set(Object.values(FEATURE_PERMISSIONS).flat())].sort(), [...DEFAULT_PERMISSIONS].sort(),
        'the default permissions of the API model are the union of the map');
});

k.test('startup-missing-off', 'at startup a feature whose permissions are missing is turned off', async () => {
    const s = await stored();
    assert.equal(s.add_tags, false);
    assert.equal(s.spamfilter, false);
});

k.test('startup-granted-on', 'at startup a feature whose permissions are granted is left on', async () => {
    const s = await stored();
    assert.equal(s.spamfilter_skip_addressbook, true, 'the sub-option is judged on its own permission');
    assert.equal(s.get_calendar_event_from_clipboard, true, 'not turned off because Sparks is absent');
});

k.test('specific-integration', 'the permission rule applies to a feature on its own integration (the connection rule does not)', async () => {
    const s = await stored(['add_tags', 'add_tags_use_specific_integration']);
    assert.equal(s.add_tags_use_specific_integration, true);
    assert.equal(s.add_tags, false);
});

k.test('logged', 'the reason is logged, apart from the connection rule', () => {
    const text = ctx.con.all().join(' | ');
    assert.match(text, /Disabling features missing their Thunderbird permission: add_tags \(messagesTags, messagesUpdate\), spamfilter \(messagesMove, messagesUpdate\)/);
});

k.test('granted-stays-on', 'with every permission granted, turning the features on keeps them on', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, { add_tags: true, spamfilter: true });
    const s = await stored();
    for (const key of GATED) assert.equal(s[key], true, key);
});

for (const key of GATED) {
    k.test('missing-' + key, key + ': true with its permissions missing is turned off on the next storage change', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        grantAll();
        await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
        ctx.m.permissions.delete(FEATURE_PERMISSIONS[key].find(p => !['messagesUpdate'].includes(p)));
        await setPrefs(t, ctx, { [key]: true });
        const s = await stored();
        assert.equal(s[key], false, key + ' turned off');
        for (const other of GATED.filter(k2 => k2 !== key)) assert.equal(s[other], true, other + ' left on');
    });
}

k.test('sub-option-alone', 'the address book sub-option is turned off alone: the spam filter stays on', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, { spamfilter: true, spamfilter_skip_addressbook: true });
    ctx.m.permissions.delete('addressBooks');
    await setPrefs(t, ctx, { spamfilter_skip_addressbook: true });
    const s = await stored(['spamfilter', 'spamfilter_skip_addressbook']);
    assert.deepEqual(s, { spamfilter: true, spamfilter_skip_addressbook: false });
});

k.test('locked-skipped', 'a key the policy locks on is left alone even without its permissions', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, { spamfilter: true, add_tags: true });
    lock(t, { spamfilter: true });
    ctx.m.permissions.delete('messagesMove');
    const sets = [];
    const realSet = ctx.ctl.browser.storage.local.set;
    t.mock.method(ctx.ctl.browser.storage.local, 'set', (items) => { sets.push(items); return realSet.call(ctx.ctl.browser.storage.local, items); });
    await ctx.bg._computeActiveSpecialIds();
    assert.equal(sets.some(s => 'spamfilter' in s), false, 'no write of the locked key');
    assert.equal((await stored(['add_tags'])).add_tags, true, 'add_tags keeps its own permissions');
});

k.test('removed-shared', 'onRemoved messagesUpdate: add_tags and the spam filter, and only them, are turned off', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
    ctx.m.permissions.delete('messagesUpdate');
    await removedListener()({ permissions: ['messagesUpdate'], origins: [] });
    const s = await stored();
    assert.deepEqual(s, { add_tags: false, spamfilter: false, spamfilter_skip_addressbook: true, get_calendar_event_from_clipboard: true });
});

k.test('removed-addressbooks', 'onRemoved addressBooks: only the address book sub-option is turned off', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
    ctx.m.permissions.delete('addressBooks');
    await removedListener()({ permissions: ['addressBooks'], origins: [] });
    const s = await stored();
    assert.deepEqual(s, { add_tags: true, spamfilter: true, spamfilter_skip_addressbook: false, get_calendar_event_from_clipboard: true });
});

k.test('removed-clipboard', 'onRemoved clipboardRead: only the calendar clipboard flag is turned off', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
    ctx.m.permissions.delete('clipboardRead');
    await removedListener()({ permissions: ['clipboardRead'], origins: [] });
    const s = await stored();
    assert.deepEqual(s, { add_tags: true, spamfilter: true, spamfilter_skip_addressbook: true, get_calendar_event_from_clipboard: false });
});

k.test('removed-origins-only', 'onRemoved of host permissions only: no feature preference is written', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
    const sets = [];
    const realSet = ctx.ctl.browser.storage.local.set;
    t.mock.method(ctx.ctl.browser.storage.local, 'set', (items) => { sets.push(items); return realSet.call(ctx.ctl.browser.storage.local, items); });
    await removedListener()({ permissions: [], origins: ['https://*.openai.com/*'] });
    assert.deepEqual(sets, []);
});

k.test('removed-locked', 'onRemoved skips a locked key', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    grantAll();
    await setPrefs(t, ctx, Object.fromEntries(GATED.map(k2 => [k2, true])));
    lock(t, { add_tags: true });
    const sets = [];
    const realSet = ctx.ctl.browser.storage.local.set;
    t.mock.method(ctx.ctl.browser.storage.local, 'set', (items) => { sets.push(items); return realSet.call(ctx.ctl.browser.storage.local, items); });
    ctx.m.permissions.delete('messagesUpdate');
    await removedListener()({ permissions: ['messagesUpdate'], origins: [] });
    assert.deepEqual(sets, [{ spamfilter: false }]);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
