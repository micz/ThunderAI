// The startup sequence on real data: every storage.sync dump of tests/fixtures/migration/captured/
// (./captures.mjs), through two starts (the second is where a withheld marker lands). Spec as for
// 10-sequence-upgrade: every preference reads back, through the real accessor js/mzta-prefs.js,
// with the value it had in sync - or the one the spec converts it to (ollama_think, spec 04;
// calendar_no_selection, spec 05) - and every prompt payload is intact.
//
// Keys absent from prefs_default are not preferences mztaPrefs knows: they are compared on the raw
// storage.local, where the copy must have put them unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefs_default } from '../../options/mzta-options-default.js';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    captures,
    isFakeSecret,
    apiKeys
} from './captures.mjs';
import {
    PAYLOAD_KEYS,
    profile,
    expectedPrefs,
    payloadsOf
} from './expect.mjs';

const k = caseTests('20-captured');
const run = 'sequence';
const list = captures();

const runs = list.map(c => {
    const local = c.local ?? profile('5.0').local;
    const expected = expectedPrefs({ sync: c.sync, local });
    const declared = Object.keys(expected).filter(key => key in prefs_default);
    const first = startup({ run, sync: c.sync, local });
    const second = first.then(r => startup({ run, sync: r.sync, local: r.local, read: { prefs: declared } }));
    second.catch(() => {});
    return { ...c, seed: local, expected, declared, first, second };
});

k.test('fake-secrets', 'every API key in a capture is a fake', () => {
    for (const c of list) {
        for (const [at, v] of [...apiKeys(c.sync), ...apiKeys(c.local ?? {})]) {
            assert.ok(isFakeSecret(v), c.name + ': ' + at + ' looks like a real key - replace it with zeros');
        }
    }
});

if (list.length === 0) {
    test('no captured dump in tests/fixtures/migration/captured/', { skip: 'nothing to run on' }, () => {});
}

k.test('sequence-runs', 'the sequence completes on every capture', async () => {
    for (const c of runs) {
        const r = await c.first;
        assert.equal(r.error, null, c.name);
        assert.equal(r.value._prefs_migration_ok, true, c.name);
        assert.equal((await c.second).error, null, c.name + ' (second start)');
    }
});

k.test('prefs-read-back', 'every declared preference reads back through mztaPrefs with its sync value', async () => {
    for (const c of runs) {
        const r = await c.second;
        for (const key of c.declared) assert.deepEqual(r.read.prefs[key], c.expected[key], c.name + ': ' + key);
    }
});

k.test('undeclared-kept', 'every key absent from prefs_default is in storage.local, unchanged', async () => {
    for (const c of runs) {
        const r = await c.second;
        for (const [key, value] of Object.entries(c.expected)) {
            if (key in prefs_default) continue;
            assert.deepEqual(r.local[key], value, c.name + ': ' + key);
        }
    }
});

k.test('payloads-intact', 'every prompt payload is intact', async () => {
    for (const c of runs) {
        const r = await c.second;
        const before = payloadsOf({ sync: c.sync, local: c.seed });
        for (const key of PAYLOAD_KEYS) {
            if (!(key in before)) continue;
            // The payloads of these profiles have been through the enabled and alphabetic
            // migrations already (their flags are set): nothing may change them.
            if (c.sync._migrated_enabled_to_showin === true && c.sync.dynamic_menu_order_alphabet === false) {
                assert.deepEqual(r.local[key], before[key], c.name + ': ' + key);
            } else {
                assert.ok(key in r.local, c.name + ': ' + key + ' missing');
            }
        }
    }
});

k.test('sync-left', 'storage.sync keeps every preference (a downgrade still finds them)', async () => {
    for (const c of runs) {
        const r = await c.second;
        for (const [key, value] of Object.entries(c.sync)) {
            if (PAYLOAD_KEYS.includes(key)) continue;
            assert.deepEqual(r.sync[key], value, c.name + ': ' + key);
        }
    }
});

k.coverage();
