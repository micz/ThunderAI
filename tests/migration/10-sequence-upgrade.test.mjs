// The startup migration sequence of mzta-background.js, run as it stands in the file (cut by
// ./sequence.mjs, see README), on a 5.0.x profile: the upgrade every 5.0.x user makes to 5.1.0,
// then the second and third start.
//
// Spec: 05 opening ("runs first", local wins, sync left in place, the marker), 01 "Storage",
// 02 "Alphabetic-to-Position Migration" / "Enabled-to-show_in Migration" (one-shot flags carried
// across, so neither re-runs and the custom menu order and show_in survive), 04 (ollama_think in
// level form, global only), 05 row calendar_no_selection (aligned once to the stored
// need_selected), 04 "When a policy locks the override off" (the migration block runs before
// loadManaged() and must not make the background message itself), 01 "Per-Message Data Storage"
// (the msg: records moved to their storage.local mirror keys and to IndexedDB, storage.local
// scanned only at the first start of a version, with nothing left behind; a database evicted
// between two starts rebuilt from the mirror by the next start).
//
// The invariant above all: the user's settings survive.

import assert from 'node:assert/strict';
import { prefs_default } from '../../options/mzta-options-default.js';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import { backgroundSource } from '../helpers/core/background-source.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import { readFileSync } from 'node:fs';
import {
    topLevelStatements,
    topLevelIdentifiers
} from './sequence.mjs';
import {
    MARKER,
    PAYLOAD_KEYS,
    profile,
    expectedPrefs,
    writesOf,
    callsTo,
    keyNames,
    messageRecords,
    mirrorRecords
} from './expect.mjs';

const k = caseTests('10-sequence-upgrade');
const MANIFEST_VERSION = JSON.parse(readFileSync(repoPath('manifest.json'), 'utf8')).version;
const run = 'sequence';
const P = profile('5.0');
const EXPECTED = expectedPrefs(P);
const DECLARED = Object.keys(EXPECTED).filter(key => key in prefs_default);
const read = { prefs: DECLARED, specialPrompts: true };

const first = startup({ run, sync: P.sync, local: P.local, read });
const second = first.then(r => startup({ run, sync: r.sync, local: r.local, idb: r.idb }));
const third = second.then(r => startup({ run, sync: r.sync, local: r.local, idb: r.idb }));
second.catch(() => {});
third.catch(() => {});

// Thunderbird evicted the add-on's IndexedDB between the second and the third start: storage.local
// (the mirror) survives, the database does not. Then one more start, with the rebuilt database.
const evicted = second.then(r => startup({ run, sync: r.sync, local: r.local }));
const afterEviction = evicted.then(r => startup({ run, sync: r.sync, local: r.local, idb: r.idb }));
evicted.catch(() => {});
afterEviction.catch(() => {});
const fullScans = calls => calls.filter(c => c.area === 'local' && c.op === 'get' && keyNames(c.keys) === null);

// The stored need_selected "1" disagrees with calendar_no_selection true in sync: the alignment
// must see the COPIED preference, so the copy has to have run before it.
const CAL = profile('5.0');
CAL.local._special_prompts.find(p => p.id === 'prompt_get_calendar_event').need_selected = '1';
const calendar = startup({ run, sync: CAL.sync, local: CAL.local, read });

// --- Where the copy sits ------------------------------------------------------------------------

// Spec 01 "Storage": migratePrefsToLocal() is the first await and the first storage access of
// mzta-background.js; only synchronous listener registrations, which touch no storage, come before.
k.test('copy-first', 'nothing before the preference copy awaits or touches storage', () => {
    const statements = topLevelStatements(backgroundSource()).filter(st => !/^import\b/.test(st.text));
    const at = statements.findIndex(st => topLevelIdentifiers(st.text).has('migratePrefsToLocal'));
    assert.ok(at >= 0, 'migratePrefsToLocal() is not called at the top level');
    for (const st of statements.slice(0, at)) {
        const ids = topLevelIdentifiers(st.text);
        const head = st.text.slice(0, 80).replace(/\s+/g, ' ');
        assert.ok(!ids.has('await'), 'awaits before the copy: ' + head);
        assert.ok(!ids.has('storage'), 'touches storage before the copy: ' + head);
    }
});

// --- The first start -----------------------------------------------------------------------------

k.test('runs-clean', 'the sequence completes, with the preference copy reported as done', async () => {
    const r = await first;
    assert.equal(r.error, null);
    assert.equal(r.value._prefs_migration_ok, true);
});

k.test('prefs-survive', 'every preference is in storage.local with the value the spec gives it', async () => {
    const r = await first;
    for (const [key, value] of Object.entries(EXPECTED)) assert.deepEqual(r.local[key], value, key);
});

k.test('prefs-read-back', 'every declared preference reads back through mztaPrefs with that value', async () => {
    const r = await first;
    for (const key of DECLARED) assert.deepEqual(r.read.prefs[key], EXPECTED[key], key);
});

k.test('payloads-intact', 'the prompt payloads are byte for byte what they were', async () => {
    const r = await first;
    for (const key of PAYLOAD_KEYS) assert.deepEqual(r.local[key], P.local[key], key);
});

k.test('message-data-moved', 'the stored msg: record is moved to IndexedDB, its key and the migration flag gone from storage.local', async () => {
    const r = await first;
    assert.equal('msg:42' in r.local, false);
    assert.equal('_message_data_migrating' in r.local, false);
    const db = r.idb.find(d => d.name === 'thunderai-message-data');
    const summary = db.stores.find(s => s.name === 'summary').records.map(x => x.value);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].messageId, '42');
    assert.equal(summary[0].summary, P.local['msg:42'].summary.summary);
    assert.equal(summary[0].createdAt, P.local['msg:42'].summary.ts);
});

k.test('message-data-mirrored', 'the moved record is also in storage.local, under its mirror key, the very record IndexedDB holds', async () => {
    const r = await first;
    assert.deepEqual(mirrorRecords(r.local, 'summary'), messageRecords(r.idb, 'summary'));
    assert.deepEqual(Object.keys(mirrorRecords(r.local, 'summary')), ['42']);
    assert.equal(r.local._message_data_migration_version, MANIFEST_VERSION, 'the version it ran for');
});

k.test('menu-order-kept', 'the custom menu order is kept: no prompt renumbered', async () => {
    const r = await first;
    const pos = p => [p.position_display, p.position_compose, p.position_context];
    assert.deepEqual(r.local._custom_prompt.map(p => [p.id, pos(p)]),
        [['prompt_custom_zeta', [3, 1, 2]], ['prompt_custom_alpha', [1, 3, 1]]]);
    assert.deepEqual(pos(r.local._default_prompts_properties.prompt_reply), [2, 2, 3]);
    assert.deepEqual(pos(r.local._default_prompts_properties.prompt_this), [4, 4, 4]);
    assert.deepEqual(pos(r.local._special_prompts.find(p => p.id === 'prompt_spamfilter')), [5, 5, 5]);
});

k.test('show-in-kept', 'show_in is kept on every prompt, "none" included', async () => {
    const r = await first;
    assert.deepEqual(r.local._custom_prompt.map(p => p.show_in), ['context', 'none']);
    assert.equal(r.local._default_prompts_properties.prompt_this.show_in, 'none');
    assert.deepEqual(r.local._special_prompts.map(p => p.show_in), ['both', 'context']);
});

k.test('connections-kept', 'the connection settings and the per-feature override are kept', async () => {
    const r = await first;
    for (const key of ['connection_type', 'chatgpt_api_key', 'chatgpt_model', 'add_tags_use_specific_integration',
        'add_tags_connection_type', 'add_tags_anthropic_api_key', 'add_tags_anthropic_model']) {
        assert.deepEqual(r.local[key], P.sync[key], key);
    }
    const spam = r.read.specialPrompts.find(p => p.id === 'prompt_spamfilter');
    assert.equal(spam.api_type, 'ollama_api');
    assert.equal(spam.ollama_model, 'llama3');
});

k.test('ollama-think', 'ollama_think arrives in level form, the per-feature copy untouched', async () => {
    const r = await first;
    assert.equal(r.local.ollama_think, 'false');
    assert.equal(r.local.add_tags_ollama_think, true);
});

k.test('sync-left', 'storage.sync is left exactly as it was', async () => {
    const r = await first;
    assert.deepEqual(r.sync, P.sync);
});

k.test('marker', 'the marker is set: storage.sync held no payload', async () => {
    const r = await first;
    assert.equal(r.local[MARKER], true);
});

k.test('no-self-message', 'the migrations send no runtime message (the background would message itself)', async () => {
    const r = await first;
    assert.deepEqual(r.sent, []);
});

k.test('calendar-after-copy', 'calendar_no_selection is aligned against the copied preference', async () => {
    const r = await calendar;
    assert.equal(r.error, null);
    assert.equal(r.local.calendar_no_selection, false, 'stored need_selected "1": the prompt asked for a selection');
    const cal = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(String(cal.need_selected), '1');
});

// --- Second and third start ----------------------------------------------------------------------

k.test('no-scan-after-upgrade', 'the second start never enumerates storage.local: the move ran for this version, the database is not new', async () => {
    const r = await second;
    assert.deepEqual(fullScans(r.calls), []);
});

for (const [id, startP, prevP] of [['second', second, first], ['third', third, second]]) {
    k.test(id + '-writes-nothing', `the ${id} start writes nothing and never touches storage.sync`, async () => {
        const r = await startP;
        assert.equal(r.error, null);
        assert.equal(r.value._prefs_migration_ok, true);
        assert.deepEqual(writesOf(r.calls), []);
        assert.deepEqual(callsTo(r.calls, 'sync'), []);
    });

    k.test(id + '-same-storage', `after the ${id} start storage is exactly what the previous one left`, async () => {
        const r = await startP;
        const prev = await prevP;
        assert.deepEqual(r.local, prev.local);
        assert.deepEqual(r.sync, prev.sync);
        assert.deepEqual(r.idb, prev.idb);
    });
}

// --- A database evicted between two starts -------------------------------------------------------

k.test('evicted-rebuilt', 'a start after an eviction rebuilds the database from the mirror: every record back as it was', async () => {
    const r = await evicted;
    const prev = await second;
    assert.equal(r.error, null);
    assert.deepEqual(r.idb, prev.idb);
    assert.equal(messageRecords(r.idb, 'summary')['42'].summary, P.local['msg:42'].summary.summary);
});

k.test('evicted-storage-local-untouched', 'the rebuild reads storage.local once, and writes nothing to it: the mirror already holds every record', async () => {
    const r = await evicted;
    const prev = await second;
    assert.equal(fullScans(r.calls).length, 1);
    assert.deepEqual(writesOf(r.calls), []);
    assert.deepEqual(r.local, prev.local);
});

k.test('after-eviction-quiet', 'the start after the rebuild finds the database as it was: nothing read in full, nothing written', async () => {
    const r = await afterEviction;
    const prev = await evicted;
    assert.equal(r.error, null);
    assert.deepEqual(fullScans(r.calls), []);
    assert.deepEqual(writesOf(r.calls), []);
    assert.deepEqual(r.idb, prev.idb);
});

k.coverage();
