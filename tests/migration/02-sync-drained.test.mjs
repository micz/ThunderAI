// isSyncDrained() (js/mzta-prefs-migration.js), from spec 05 (opening paragraph): it reads the
// marker _prefs_migrated_from_sync, which means "storage.sync is drained", not merely "the
// preferences were copied", and lets mzta-background.js skip the two #129 migrations. It is
// therefore false while the marker is withheld (a payload still in sync), and false whenever the
// marker cannot be confirmed - not true, or the read failing - never true on a failure.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    profile,
    keyNames,
    callsTo
} from './expect.mjs';

const k = caseTests('02-sync-drained');
const run = 'isSyncDrained';
const OLD = profile('pre-129');
const P = profile('5.0');

const starts = {
    marked: startup({ run, sync: P.sync, local: { [MARKER]: true } }),
    notTrue: startup({ run, sync: P.sync, local: { [MARKER]: 'true' } }),
    unreadable: startup({ run, sync: P.sync, local: { [MARKER]: true }, faults: [{ area: 'local', op: 'get' }] }),
    unmarked: startup({ run, sync: P.sync, local: P.local }),
    // After the preference copy of a pre-#129 profile: the marker is withheld.
    withheld: (async () => {
        const copy = await startup({ run: 'migratePrefsToLocal', sync: OLD.sync, local: OLD.local });
        return startup({ run, sync: copy.sync, local: copy.local });
    })(),
    // After the preference copy of a 5.0.x profile: sync holds no payload, the marker is set.
    upgraded: (async () => {
        const copy = await startup({ run: 'migratePrefsToLocal', sync: P.sync, local: P.local });
        return startup({ run, sync: copy.sync, local: copy.local });
    })(),
};
for (const p of Object.values(starts)) p.catch(() => {});

k.test('marked', 'true when the marker is in storage.local', async () => {
    const r = await starts.marked;
    assert.equal(r.error, null);
    assert.equal(r.value, true);
});

k.test('unmarked', 'false before the preference migration has run', async () => {
    const r = await starts.unmarked;
    assert.equal(r.value, false);
});

k.test('withheld', 'false while a #129 payload is still in sync (the #129 migrations must run)', async () => {
    const r = await starts.withheld;
    assert.equal(r.value, false);
});

k.test('upgraded', 'true right after a 5.0.x upgrade, whose sync holds no payload', async () => {
    const r = await starts.upgraded;
    assert.equal(r.value, true);
});

k.test('not-true', 'false for a marker that is not the boolean true', async () => {
    const r = await starts.notTrue;
    assert.equal(r.value, false);
});

k.test('unreadable', 'false, without throwing, when the marker cannot be read', async () => {
    const r = await starts.unreadable;
    assert.equal(r.error, null);
    assert.equal(r.value, false);
});

k.test('single-read', 'it reads the one marker key of storage.local, never storage.sync, and writes nothing', async () => {
    const r = await starts.marked;
    assert.equal(r.calls.length, 1, JSON.stringify(r.calls));
    assert.equal(r.calls[0].area, 'local');
    assert.deepEqual(keyNames(r.calls[0].keys), [MARKER]);
    assert.deepEqual(callsTo(r.calls, 'sync'), []);
});

k.coverage();
