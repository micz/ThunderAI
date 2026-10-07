// migratePrefsToLocal() on its own (js/mzta-prefs-migration.js), from spec 05 (opening paragraphs,
// "dynamic_menu_order_alphabet" row, "Preference access") and spec 01 "Storage": it copies every
// key storage.sync still holds into storage.local, never overwrites a key already present in
// local, leaves the sync copy in place, carries the one-shot flags across, and writes the marker
// _prefs_migrated_from_sync - in the same set() as the copy - once sync holds nothing any migration
// still needs. Every later start returns on that single read.
//
// Each case is one Thunderbird start in a fresh context (./context.mjs). They are started together
// at load and awaited by their test.

import assert from 'node:assert/strict';
import { prefs_default } from '../../options/mzta-options-default.js';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    PAYLOAD_KEYS,
    profile,
    keyNames,
    writesOf,
    callsTo
} from './expect.mjs';

const k = caseTests('01-prefs-to-local');
const run = 'migratePrefsToLocal';
const P = profile('5.0');

const TYPES = {
    t_false: false, t_zero: 0, t_empty: '', t_null: null,
    t_array: [1, '', false, [], { x: 0 }],
    t_object: { a: { b: [{ c: 0, d: '' }], e: false }, f: null },
};

const OLD = profile('pre-129');

const starts = {
    upgrade: startup({ run, sync: P.sync, local: P.local }),
    fresh: startup({ run, sync: {}, local: {} }),
    steady: startup({ run, sync: P.sync, local: { ...P.local, ...P.sync, [MARKER]: true } }),
    // Back from a downgrade: the older version changed settings in sync after the upgrade.
    downgraded: startup({ run, sync: { ...P.sync, connection_type: 'ollama_api', chatgpt_model: 'changed-while-downgraded' },
        local: { ...P.local, ...P.sync, [MARKER]: true } }),
    conflict: startup({ run, sync: { a: 'sync', b: 'sync', c: 'sync', d: 'sync', e: 'sync' },
        local: { a: 'local', b: false, c: 0, d: null, e: '' } }),
    types: startup({ run, sync: TYPES, local: {} }),
    payloads: startup({ run, sync: OLD.sync, local: OLD.local }),
    failSyncGet: startup({ run, sync: P.sync, local: P.local, faults: [{ area: 'sync', op: 'get' }] }),
    failLocalSet: startup({ run, sync: P.sync, local: P.local, faults: [{ area: 'local', op: 'set' }] }),
    failLocalRead: startup({ run, sync: P.sync, local: P.local, faults: [{ area: 'local', op: 'get' }] }),
};

// The marker withheld while a payload is in sync, then set at the next start once the #129
// migrations (the ones that drain it) have run in between.
const withheld = (async () => {
    const first = await starts.payloads;
    const custom = await startup({ run: 'migrateCustomPromptsStorage', sync: first.sync, local: first.local });
    const dpp = await startup({ run: 'migrateDefaultPromptsPropStorage', sync: custom.sync, local: custom.local });
    const next = await startup({ run, sync: dpp.sync, local: dpp.local });
    return { first, drained: dpp, next };
})();
withheld.catch(() => {});

// --- Upgrade from 5.0.x -----------------------------------------------------------------------

k.test('upgrade-copies-every-key', 'an upgrade copies every key storage.sync holds, with its value', async () => {
    const r = await starts.upgrade;
    assert.equal(r.error, null);
    assert.equal(r.value, true, 'returns true once the preferences are in storage.local');
    for (const [key, value] of Object.entries(P.sync)) {
        assert.ok(key in r.local, key + ' was not copied');
        assert.deepEqual(r.local[key], value, key);
    }
});

k.test('upgrade-keeps-sync', 'the sync copy is left in place (a downgrade still finds the settings)', async () => {
    const r = await starts.upgrade;
    assert.deepEqual(r.sync, P.sync);
    assert.deepEqual(callsTo(writesOf(r.calls), 'sync'), [], 'nothing written to or removed from sync');
});

k.test('upgrade-keeps-local', 'what storage.local held before is untouched (payloads, records)', async () => {
    const r = await starts.upgrade;
    for (const [key, value] of Object.entries(P.local)) assert.deepEqual(r.local[key], value, key);
});

k.test('upgrade-marker-same-set', 'the marker is written in the same set() as the copy, and only once', async () => {
    const r = await starts.upgrade;
    assert.equal(r.local[MARKER], true);
    const writes = writesOf(r.calls);
    assert.equal(writes.length, 1, 'one single write: ' + JSON.stringify(writes.map(w => keyNames(w.items))));
    assert.equal(writes[0].area, 'local');
    assert.equal(writes[0].op, 'set');
    assert.equal(writes[0].items[MARKER], true, 'the marker rides in the copy itself');
    for (const key of Object.keys(P.sync)) assert.ok(key in writes[0].items, key + ' is not in the one set()');
});

k.test('upgrade-undeclared-keys', 'keys absent from prefs_default are copied too', async () => {
    const r = await starts.upgrade;
    const undeclared = Object.keys(P.sync).filter(key => !(key in prefs_default));
    // The fixture must exercise the rule: the legacy keys and the one-shot flags.
    for (const key of ['legacy_removed_option', 'legacy_nested', 'dynamic_menu_order_alphabet', '_migrated_enabled_to_showin']) {
        assert.ok(undeclared.includes(key), key + ' should be absent from prefs_default');
    }
    for (const key of undeclared) assert.deepEqual(r.local[key], P.sync[key], key);
});

k.test('upgrade-one-shot-flags', 'the one-shot flags dynamic_menu_order_alphabet and _migrated_enabled_to_showin are carried across', async () => {
    const r = await starts.upgrade;
    assert.equal(r.local.dynamic_menu_order_alphabet, false);
    assert.equal(r.local._migrated_enabled_to_showin, true);
});

// --- Fresh install, steady state -----------------------------------------------------------------

k.test('fresh-install', 'a fresh install (empty sync) writes the marker and nothing else', async () => {
    const r = await starts.fresh;
    assert.equal(r.error, null);
    assert.equal(r.value, true);
    assert.deepEqual(r.local, { [MARKER]: true });
    assert.deepEqual(r.sync, {});
});

k.test('steady-single-read', 'once migrated, a start costs a single-key read of storage.local, and writes nothing', async () => {
    const r = await starts.steady;
    assert.equal(r.value, true);
    assert.equal(r.calls.length, 1, 'storage calls: ' + JSON.stringify(r.calls));
    assert.equal(r.calls[0].area, 'local');
    assert.equal(r.calls[0].op, 'get');
    assert.deepEqual(keyNames(r.calls[0].keys), [MARKER]);
});

k.test('downgraded-changes-stay', 'settings changed in sync while downgraded are not carried back, deliberately', async () => {
    const r = await starts.downgraded;
    assert.equal(r.value, true);
    assert.equal(r.local.connection_type, P.sync.connection_type);
    assert.equal(r.local.chatgpt_model, P.sync.chatgpt_model);
    assert.deepEqual(writesOf(r.calls), []);
});

// --- Conflicts and values ----------------------------------------------------------------------------

k.test('local-wins', 'a key already present in storage.local keeps its value, false / 0 / null / "" included', async () => {
    const r = await starts.conflict;
    assert.equal(r.value, true);
    assert.equal(r.local.a, 'local');
    assert.equal(r.local.b, false);
    assert.equal(r.local.c, 0);
    assert.equal(r.local.d, null);
    assert.equal(r.local.e, '');
});

k.test('local-wins-marker', 'with nothing left to copy and no payload in sync, the marker is written', async () => {
    const r = await starts.conflict;
    assert.equal(r.local[MARKER], true);
});

k.test('value-types', 'every value type survives exactly: false, 0, "", null, arrays, nested objects', async () => {
    const r = await starts.types;
    assert.equal(r.error, null);
    for (const [key, value] of Object.entries(TYPES)) {
        assert.ok(key in r.local, key + ' was not copied');
        assert.deepEqual(r.local[key], value, key);
    }
});

// --- The payloads belong to the #129 migrations ---------------------------------------------------

k.test('payloads-not-copied', 'the prompt payloads in sync are left to the #129 migrations: not copied, not removed', async () => {
    const r = await starts.payloads;
    assert.equal(r.value, true);
    for (const key of PAYLOAD_KEYS) {
        if (!(key in OLD.sync)) continue;
        assert.ok(!(key in r.local), key + ' was copied by the preference migration');
        assert.deepEqual(r.sync[key], OLD.sync[key], key + ' changed in sync');
    }
    assert.deepEqual(r.local._special_prompts, OLD.local._special_prompts, 'the local special prompts are untouched');
});

k.test('payloads-prefs-copied', 'the preferences beside the payloads are copied all the same', async () => {
    const r = await starts.payloads;
    for (const [key, value] of Object.entries(OLD.sync)) {
        if (PAYLOAD_KEYS.includes(key)) continue;
        assert.deepEqual(r.local[key], value, key);
    }
});

k.test('marker-withheld', 'the marker is withheld while a payload is still in sync', async () => {
    const { first } = await withheld;
    assert.ok(!(MARKER in first.local), 'marker written with _custom_prompt still in sync');
});

k.test('marker-next-start', 'once the #129 migrations have drained sync, the next start writes the marker', async () => {
    const { drained, next } = await withheld;
    for (const key of PAYLOAD_KEYS) assert.ok(!(key in drained.sync), key + ' still in sync after the #129 migrations');
    assert.equal(next.value, true);
    assert.equal(next.local[MARKER], true);
});

// --- Failures ----------------------------------------------------------------------------------------

k.test('fail-sync-get', 'a failing storage.sync.get(): false, nothing written anywhere', async () => {
    const r = await starts.failSyncGet;
    assert.equal(r.error, null, 'the failure must not escape');
    assert.equal(r.value, false);
    assert.deepEqual(writesOf(r.calls), []);
    assert.deepEqual(r.local, P.local);
    assert.deepEqual(r.sync, P.sync);
});

k.test('fail-local-set', 'a failing storage.local.set(): false, and neither a preference nor the marker lands', async () => {
    const r = await starts.failLocalSet;
    assert.equal(r.error, null, 'the failure must not escape');
    assert.equal(r.value, false);
    assert.deepEqual(r.local, P.local, 'storage.local changed');
    assert.ok(!(MARKER in r.local));
    assert.deepEqual(r.sync, P.sync, 'sync must keep everything for the retry');
});

k.test('fail-local-read', 'a failing read of storage.local: false, nothing written', async () => {
    const r = await starts.failLocalRead;
    assert.equal(r.error, null, 'the failure must not escape');
    assert.equal(r.value, false);
    assert.deepEqual(writesOf(r.calls), []);
});

k.coverage();
