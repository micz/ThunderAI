// The startup sequence (./sequence.mjs) when the preference copy fails.
//
// Spec 05 / 02: the one-shot flags dynamic_menu_order_alphabet and _migrated_enabled_to_showin
// must be in storage.local before the migrations that read them run, because their defaults mean
// "not yet run": read from an area the copy did not fill, migrateMenuOrderAlphabetic() would
// overwrite the user's custom menu ordering. So when the copy fails the migrations guarded by it
// must be SKIPPED, not re-run destructively - and the next start, with storage working again,
// must end where a clean upgrade ends. Nothing the user configured may be lost on the way.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    PAYLOAD_KEYS,
    profile,
    expectedPrefs
} from './expect.mjs';

const k = caseTests('11-sequence-failure');
const run = 'sequence';
const P = profile('5.0');
const OLD = profile('pre-129');

// The flags the guarded migrations write when they run.
const GUARDED_FLAGS = ['_migrated_calendar_no_selection', '_migrated_ollama_think_level'];

const clean = startup({ run, sync: P.sync, local: P.local });

// The copy's set() fails once: the rest of storage works.
const copyFails = startup({ run, sync: P.sync, local: P.local, faults: [{ area: 'local', op: 'set', nth: 1 }] });
const retry = copyFails.then(r => startup({ run, sync: r.sync, local: r.local }));
retry.catch(() => {});

// storage.sync.get() fails once (the copy's read), on the oldest profile: the #129 migrations
// still run (their own read works), the guarded ones must not.
const syncOnce = startup({ run, sync: OLD.sync, local: OLD.local, faults: [{ area: 'sync', op: 'get', nth: 1 }] });
const syncOnceRetry = syncOnce.then(r => startup({ run, sync: r.sync, local: r.local }));
const syncOnceThird = syncOnceRetry.then(r => startup({ run, sync: r.sync, local: r.local }));
syncOnceRetry.catch(() => {});
syncOnceThird.catch(() => {});
// The same profile through clean starts, for comparison.
const oldClean = startup({ run, sync: OLD.sync, local: OLD.local });
const oldClean2 = oldClean.then(r => startup({ run, sync: r.sync, local: r.local }));
oldClean2.catch(() => {});

// storage.sync.get() keeps failing.
const syncAlways = startup({ run, sync: P.sync, local: P.local, faults: [{ area: 'sync', op: 'get', count: Infinity }] });

// --- The copy's write fails ----------------------------------------------------------------------

k.test('copy-fails-reported', 'a failed copy is reported to the sequence as not done', async () => {
    const r = await copyFails;
    assert.equal(r.value && r.value._prefs_migration_ok, false);
});

k.test('copy-fails-guarded-skipped', 'the migrations guarded by the copy do not run', async () => {
    const r = await copyFails;
    for (const flag of GUARDED_FLAGS) assert.ok(!(flag in r.local), flag + ' written: its migration ran');
    assert.ok(!('dynamic_menu_order_alphabet' in r.local), 'the menu order migration ran without its flag');
});

k.test('copy-fails-nothing-lost', 'storage.local and storage.sync are exactly as before: nothing renumbered, nothing lost', async () => {
    const r = await copyFails;
    assert.deepEqual(r.local, P.local);
    assert.deepEqual(r.sync, P.sync);
});

k.test('copy-fails-retry', 'the next start ends exactly where a clean upgrade ends', async () => {
    const r = await retry;
    assert.equal(r.error, null);
    assert.equal(r.value._prefs_migration_ok, true);
    assert.deepEqual(r.local, (await clean).local);
    for (const [key, value] of Object.entries(expectedPrefs(P))) assert.deepEqual(r.local[key], value, key);
});

// --- The copy's read of storage.sync fails once ------------------------------------------------

k.test('sync-once-guarded-skipped', 'pre-#129 profile, sync read fails once: the guarded migrations do not run', async () => {
    const r = await syncOnce;
    assert.equal(r.value && r.value._prefs_migration_ok, false);
    for (const flag of [...GUARDED_FLAGS, '_migrated_enabled_to_showin', 'dynamic_menu_order_alphabet']) {
        assert.ok(!(flag in r.local), flag + ' written');
    }
});

k.test('sync-once-payloads-safe', 'the prompt payloads are in one of the two areas, unchanged', async () => {
    const r = await syncOnce;
    for (const key of PAYLOAD_KEYS) {
        const before = OLD.local[key] ?? OLD.sync[key];
        if (before === undefined) continue;
        const now = r.local[key] ?? r.sync[key];
        assert.deepEqual(now, before, key);
    }
});

k.test('sync-once-converges', 'two more starts end where two clean starts end', async () => {
    const r = await syncOnceThird;
    assert.equal(r.error, null);
    const ref = await oldClean2;
    const strip = local => { const o = { ...local }; delete o[MARKER]; return o; };
    assert.deepEqual(strip(r.local), strip(ref.local));
    assert.deepEqual(r.sync, ref.sync);
});

// --- storage.sync keeps failing ------------------------------------------------------------------

k.test('sync-always-nothing-lost', 'storage.sync unreadable at every call: nothing in storage.local is touched', async () => {
    const r = await syncAlways;
    assert.deepEqual(r.local, P.local);
});

k.test('sync-always-guarded-skipped', 'storage.sync unreadable: the guarded migrations do not run', async () => {
    const r = await syncAlways;
    for (const flag of GUARDED_FLAGS) assert.ok(!(flag in r.local), flag + ' written');
});

k.coverage();
