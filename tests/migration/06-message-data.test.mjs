// migrateMessageDataToIndexedDB() (js/mzta-storage-migration.js) alone: the move of the per-message
// data from the msg: records of storage.local to their mirror keys and to IndexedDB.
//
// Spec 01 "Per-Message Data Storage", the migration:
//  - it scans storage.local only when the add-on version it last completed for
//    (_message_data_migration_version) is not the running one, or a migration flag is left: once
//    per version (an update after a downgrade brings the msg: keys the old version wrote again);
//    any other start is one targeted read, and writes nothing;
//  - the sequence: read the legacy keys, set the migration flag, open the database, write the
//    mirror keys, write the records, remove the legacy keys only once that transaction has
//    committed, remove the flag, store the version;
//  - each legacy field (spam, summary, translation) becomes a record of its store, the same record
//    under its mirror key (spam:, summary:, translation:<Message-ID>); createdAt is the field's ts,
//    else the record's ts, else the time of the migration; ts itself is not copied; size is
//    computed; subject / from / message_date stay empty when the record had none;
//  - a record the mirror or IndexedDB already holds with a newer createdAt is never overwritten;
//  - a failure keeps the legacy keys and the old version, for the next start; a failure to open or
//    write the database or the mirror sets the flag to 'failed' (the pages stop announcing a move
//    nobody is making), and the next start sets it back to true before trying again;
//  - a field that is not an object cannot be migrated: logged and dropped with its key (decision
//    of the maintainer for #955).
// Each start runs in its own worker (context.mjs), IndexedDB handed from one start to the next.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    writesOf,
    keyNames,
    messageRecords,
    mirrorRecords
} from './expect.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import { readFileSync } from 'node:fs';

const k = caseTests('06-message-data');
const run = 'migrateMessageDataToIndexedDB';
const FLAG = '_message_data_migrating';
const VERSION_KEY = '_message_data_migration_version';
const VERSION = JSON.parse(readFileSync(repoPath('manifest.json'), 'utf8')).version;
const isMirror = key => /^(spam|summary|translation):/.test(key);
const fullScans = calls => calls.filter(c => c.area === 'local' && c.op === 'get' && keyNames(c.keys) === null);
const T1 = Date.parse('2025-02-01T00:00:00Z');
const T2 = Date.parse('2025-02-02T00:00:00Z');

const LEGACY = {
    connection_type: 'chatgpt_api',
    _custom_prompt: [{ id: 'prompt_custom_x', name: 'X', text: 'x' }],
    // Every field with its own ts, metadata in the spam field.
    'msg:full@x': {
        v: 1, ts: T2,
        spam: { spamValue: 85, explanation: 'Phishing', subject: ['Win'], from: ['x@spam.test'], message_date: '2025-01-31T00:00:00.000Z', moved: true, SpamThreshold: 70, ts: T1 },
        summary: { summary: 'S', summary_html: '<p>S</p>', error: false, message: '', summary_date: '2025-02-01T00:00:00.000Z', ts: T1 + 1 },
        translation: { translated_text: 'T', translated_subject: 'Oggetto', translation_status: '1', lang: 'it', error: false, message: '', ts: T1 + 2 },
    },
    // A field without its own ts: the record's.
    'msg:rec-ts@x': { v: 1, ts: T2, summary: { summary: 'record ts' } },
    // No ts anywhere: the time of the migration.
    'msg:no-ts@x': { v: 1, translation: { translated_text: 'no ts' } },
    // A field that is not an object, beside a good one.
    'msg:bad@x': { v: 1, ts: T1, summary: 'not an object', spam: { spamValue: 3, ts: T1 } },
};

const before = Date.now();
const first = startup({ run, local: LEGACY });
const second = first.then(r => startup({ run, local: r.local, idb: r.idb }));
second.catch(() => {});

k.test('runs', 'the migration completes and reports what it moved and dropped', async () => {
    const r = await first;
    assert.equal(r.error, null);
    assert.deepEqual(r.value, { migrated: 6, skipped: 0, dropped: 1 });
});

k.test('field-mapping', 'each legacy field becomes a record of its store, with its own fields, without ts', async () => {
    const r = await first;
    const spam = messageRecords(r.idb, 'spam')['full@x'];
    assert.equal(spam.spamValue, 85);
    assert.equal(spam.explanation, 'Phishing');
    assert.deepEqual(spam.subject, ['Win']);
    assert.deepEqual(spam.from, ['x@spam.test']);
    assert.equal(spam.message_date, '2025-01-31T00:00:00.000Z');
    assert.equal(spam.moved, true);
    assert.equal(spam.SpamThreshold, 70);
    const summary = messageRecords(r.idb, 'summary')['full@x'];
    assert.equal(summary.summary, 'S');
    assert.equal(summary.summary_html, '<p>S</p>');
    assert.equal(summary.summary_date, '2025-02-01T00:00:00.000Z');
    const translation = messageRecords(r.idb, 'translation')['full@x'];
    assert.deepEqual([translation.translated_text, translation.translated_subject, translation.translation_status, translation.lang],
        ['T', 'Oggetto', '1', 'it']);
    for (const rec of [spam, summary, translation]) {
        assert.equal(rec.messageId, 'full@x');
        assert.equal('ts' in rec, false, 'ts is not copied');
    }
});

k.test('mirror-keys', 'each record is also written to storage.local under its mirror key: the very record IndexedDB holds', async () => {
    const r = await first;
    for (const store of ['spam', 'summary', 'translation']) {
        assert.deepEqual(mirrorRecords(r.local, store), messageRecords(r.idb, store), store);
    }
    assert.deepEqual(Object.keys(r.local).filter(isMirror).sort(),
        ['spam:bad@x', 'spam:full@x', 'summary:full@x', 'summary:rec-ts@x', 'translation:full@x', 'translation:no-ts@x']);
});

k.test('created-at', 'createdAt is the field\'s ts', async () => {
    const r = await first;
    assert.equal(messageRecords(r.idb, 'spam')['full@x'].createdAt, T1);
    assert.equal(messageRecords(r.idb, 'summary')['full@x'].createdAt, T1 + 1);
    assert.equal(messageRecords(r.idb, 'translation')['full@x'].createdAt, T1 + 2);
});

k.test('created-at-record-ts', 'a field without its own ts takes the record\'s ts', async () => {
    const r = await first;
    assert.equal(messageRecords(r.idb, 'summary')['rec-ts@x'].createdAt, T2);
});

k.test('created-at-now', 'with no ts at all, createdAt is the time of the migration', async () => {
    const r = await first;
    const t = messageRecords(r.idb, 'translation')['no-ts@x'].createdAt;
    assert.ok(t >= before && t <= Date.now(), String(t));
});

k.test('size', 'every migrated record has its size: the bytes of its JSON without size', async () => {
    const r = await first;
    for (const store of ['spam', 'summary', 'translation']) {
        for (const rec of Object.values(messageRecords(r.idb, store))) {
            const { size, ...rest } = rec;
            assert.equal(size, new TextEncoder().encode(JSON.stringify(rest)).byteLength, store + ' ' + rec.messageId);
        }
    }
});

k.test('metadata-empty', 'a summary or translation has no subject, sender or date to bring: they are empty, never looked up', async () => {
    const r = await first;
    const s = messageRecords(r.idb, 'summary')['rec-ts@x'];
    assert.deepEqual([s.subject, s.from, s.message_date], [[], [], '']);
    assert.deepEqual(r.sent, [], 'no message query, no runtime message');
});

k.test('malformed-dropped', 'a field that is not an object is dropped and logged; the good field of the same record is moved', async () => {
    const r = await first;
    assert.equal(messageRecords(r.idb, 'summary')['bad@x'], undefined);
    assert.equal(messageRecords(r.idb, 'spam')['bad@x'].spamValue, 3);
    assert.ok(r.logs.some(e => /msg:bad@x/.test(e.msg) && /not an object/.test(e.msg)), 'logged');
    assert.equal('msg:bad@x' in r.local, false, 'its key goes with the others');
});

k.test('keys-and-flag-removed', 'afterwards no msg: key and no flag are left; the preferences and payloads are untouched', async () => {
    const r = await first;
    assert.deepEqual(Object.keys(r.local).filter(key => key.startsWith('msg:')), []);
    assert.equal(FLAG in r.local, false);
    assert.equal(r.local.connection_type, 'chatgpt_api');
    assert.deepEqual(r.local._custom_prompt, LEGACY._custom_prompt);
});

k.test('order', 'the flag is set first, then the mirror keys; the legacy keys removed after the records were written, the flag removed, the version stored last', async () => {
    const r = await first;
    const writes = writesOf(r.calls);
    assert.equal(writes.length, 5);
    assert.deepEqual(writes[0], { area: 'local', op: 'set', items: { [FLAG]: true } });
    assert.equal(writes[1].op, 'set');
    assert.deepEqual(Object.keys(writes[1].items).sort(), Object.keys(r.local).filter(isMirror).sort(), 'every mirror key in one set()');
    assert.equal(writes[2].op, 'remove');
    assert.deepEqual([...writes[2].keys].sort(), Object.keys(LEGACY).filter(key => key.startsWith('msg:')).sort());
    assert.deepEqual(writes[3], { area: 'local', op: 'remove', keys: FLAG });
    assert.deepEqual(writes[4], { area: 'local', op: 'set', items: { [VERSION_KEY]: VERSION } });
});

k.test('second-start-nothing', 'the next start (same version): one targeted read, storage.local never enumerated, nothing written, IndexedDB as it was', async () => {
    const r = await second;
    assert.equal(r.error, null);
    assert.deepEqual(writesOf(r.calls), []);
    assert.deepEqual(r.calls.map(c => c.op), ['get']);
    assert.deepEqual(fullScans(r.calls), []);
    assert.deepEqual(r.local, (await first).local);
    assert.deepEqual(r.idb, (await first).idb);
});

// --- Failures -----------------------------------------------------------------------------------

const LEGACY_ONE = { 'msg:one@x': { v: 1, ts: T1, summary: { summary: 'one', ts: T1 } } };
const openFails = startup({ run, local: LEGACY_ONE, idbFault: 'open' });
const openRetry = openFails.then(r => startup({ run, local: r.local }));
const writeFails = startup({ run, local: LEGACY_ONE, idbFault: 'write' });
openRetry.catch(() => {});

k.test('open-fails-kept', 'IndexedDB cannot be opened: the migration rejects, the legacy keys stay, the flag says it failed', async () => {
    const r = await openFails;
    assert.match(r.error, /IndexedDB unavailable/);
    assert.deepEqual(r.local['msg:one@x'], LEGACY_ONE['msg:one@x']);
    assert.equal(r.local[FLAG], 'failed', 'the pages show the failure, not a move in progress');
    assert.deepEqual(writesOf(r.calls).map(c => Object.keys(c.items)), [[FLAG], ['summary:one@x'], [FLAG]],
        'the flag true, the mirror key (written before the database is opened), the flag failed');
    assert.equal(writesOf(r.calls)[2].items[FLAG], 'failed');
    assert.equal(mirrorRecords(r.local, 'summary')['one@x'].summary, 'one', 'the durable copy stays');
});

k.test('write-fails-kept', 'a write fails: no legacy key is removed before a committed transaction, and the flag says it failed', async () => {
    const r = await writeFails;
    assert.match(r.error, /IndexedDB write failed/);
    assert.deepEqual(r.local['msg:one@x'], LEGACY_ONE['msg:one@x']);
    assert.equal(r.local[FLAG], 'failed');
    assert.deepEqual(writesOf(r.calls).map(c => c.op), ['set', 'set', 'set'], 'the flag true, the mirror key, the flag failed');
    assert.deepEqual(messageRecords(r.idb, 'summary'), {}, 'nothing half-written in the database');
    assert.equal(mirrorRecords(r.local, 'summary')['one@x'].summary, 'one', 'the mirror key, written first, stays: the durable copy');
    assert.equal(VERSION_KEY in r.local, false, 'the version is not stored: the next start scans again');
});

k.test('retry', 'the next start retries and completes: the flag back to true first, then the record moved, key and flag gone', async () => {
    const r = await openRetry;
    assert.equal(r.error, null);
    assert.deepEqual(writesOf(r.calls)[0], { area: 'local', op: 'set', items: { [FLAG]: true } });
    assert.equal(messageRecords(r.idb, 'summary')['one@x'].summary, 'one');
    assert.equal('msg:one@x' in r.local, false);
    assert.equal(FLAG in r.local, false);
    assert.equal(mirrorRecords(r.local, 'summary')['one@x'].summary, 'one');
    assert.equal(r.local[VERSION_KEY], VERSION);
});

// Thunderbird closing at each write of the migration, then a normal start.
for (const n of [1, 2, 3, 4, 5]) {
    const crashed = startup({ run, local: LEGACY_ONE, crashAtWrite: n });
    const after = crashed.then(r => startup({ run, local: r.local, idb: r.idb }));
    after.catch(() => {});
    k.test('crash-' + n, `closed at write ${n} of 5: the next start ends with the record in IndexedDB and in the mirror, no key, no flag, the version stored`, async () => {
        const c = await crashed;
        assert.equal(c.crashed, true);
        const r = await after;
        assert.equal(r.error, null);
        assert.equal(messageRecords(r.idb, 'summary')['one@x'].summary, 'one');
        assert.deepEqual(mirrorRecords(r.local, 'summary'), messageRecords(r.idb, 'summary'));
        assert.deepEqual(Object.keys(r.local).filter(key => key.startsWith('msg:') || key === FLAG), []);
        assert.equal(r.local[VERSION_KEY], VERSION);
    });
}

// --- Downgrade and upgrade again ----------------------------------------------------------------

// The user went back to an older version, which wrote msg: records again, then updated to a newer
// version: the version the move last ran for is no longer the running one (modelled by storing an
// older one, since the running version is manifest.json's). IndexedDB and the mirror still hold
// what the previous upgrade moved, and what this version wrote since.
const NEWER = Date.parse('2026-01-10T00:00:00Z');
const OLDER = Date.parse('2026-01-01T00:00:00Z');
const downgrade = first.then(r => ({
    local: {
        ...r.local,
        [VERSION_KEY]: '0.0.0-before-the-update',
        // Older than what IndexedDB holds for it (written by this version after the old one).
        'msg:kept@x': { v: 1, ts: OLDER, summary: { summary: 'old version', ts: OLDER } },
        // Newer than what IndexedDB holds (the old version regenerated it).
        'msg:full@x': { v: 1, ts: NEWER, summary: { summary: 'regenerated', ts: NEWER } },
        // New since: only the old version saw it.
        'msg:new@x': { v: 1, ts: NEWER, spam: { spamValue: 1, ts: NEWER } },
    },
    idb: r.idb,
}));
const reupgrade = downgrade.then(async ({ local, idb }) => {
    // What this version wrote for kept@x before the downgrade, newer than the old version's copy:
    // in IndexedDB and in the mirror, as every write does.
    const keptRecord = {
        messageId: 'kept@x', createdAt: NEWER, subject: ['Kept'], from: [], message_date: '', summary: 'this version', summary_html: '',
        error: false, message: '', size: 1,
    };
    const withKept = structuredClone(idb);
    const db = withKept.find(d => d.name === 'thunderai-message-data');
    db.stores.find(s => s.name === 'summary').records.push({ key: 'kept@x', value: keptRecord });
    return startup({ run, local: { ...local, 'summary:kept@x': keptRecord }, idb: withKept });
});
reupgrade.catch(() => {});

k.test('remigrate', 'after a downgrade the msg: keys written again are migrated at the next start', async () => {
    const r = await reupgrade;
    assert.equal(r.error, null);
    assert.equal(messageRecords(r.idb, 'spam')['new@x'].spamValue, 1);
    assert.deepEqual(Object.keys(r.local).filter(key => key.startsWith('msg:') || key === FLAG), []);
});

k.test('remigrate-newer-kept', 'a record IndexedDB holds with a newer createdAt is not overwritten', async () => {
    const r = await reupgrade;
    const kept = messageRecords(r.idb, 'summary')['kept@x'];
    assert.equal(kept.summary, 'this version');
    assert.equal(kept.createdAt, NEWER);
    assert.equal(mirrorRecords(r.local, 'summary')['kept@x'].summary, 'this version', 'nor in the mirror');
});

k.test('remigrate-older-replaced', 'a record IndexedDB holds with an older createdAt is replaced by the newer legacy one', async () => {
    const r = await reupgrade;
    const full = messageRecords(r.idb, 'summary')['full@x'];
    assert.equal(full.summary, 'regenerated');
    assert.equal(full.createdAt, NEWER);
    assert.equal(messageRecords(r.idb, 'spam')['full@x'].spamValue, 85, 'the other types of the message untouched');
    assert.deepEqual(mirrorRecords(r.local, 'summary')['full@x'], full, 'the mirror key replaced too');
});

// The same downgrade, then the very version that ran before (the version stored is the running
// one): the move does not scan, so the msg: keys wait for the next version (spec 01, "Migration").
const sameVersion = downgrade.then(({ local, idb }) => startup({ run, local: { ...local, [VERSION_KEY]: VERSION }, idb }));
sameVersion.catch(() => {});

k.test('same-version-no-scan', 'with the running version stored and no flag, storage.local is not enumerated: one read of two keys, nothing written', async () => {
    const r = await sameVersion;
    assert.equal(r.error, null);
    assert.deepEqual(r.calls.map(c => c.op), ['get']);
    assert.deepEqual([...keyNames(r.calls[0].keys)].sort(), [FLAG, VERSION_KEY].sort());
    assert.deepEqual(writesOf(r.calls), []);
    assert.ok('msg:new@x' in r.local, 'the legacy key is left for the next version');
});

// A flag left behind with the running version stored (Thunderbird closed during a move): it scans.
const flagLeft = startup({ run, local: { ...LEGACY_ONE, [VERSION_KEY]: VERSION, [FLAG]: true } });

k.test('flag-forces-scan', 'a migration flag left behind makes the move scan even when the version stored is the running one', async () => {
    const r = await flagLeft;
    assert.equal(r.error, null);
    assert.equal(messageRecords(r.idb, 'summary')['one@x'].summary, 'one');
    assert.deepEqual(Object.keys(r.local).filter(key => key.startsWith('msg:') || key === FLAG), []);
});

// --- Nothing to migrate -------------------------------------------------------------------------

const none = startup({ run, local: { connection_type: 'ollama_api' } });
const staleFlag = startup({ run, local: { connection_type: 'ollama_api', [FLAG]: true } });

k.test('none', 'no msg: key: only the version is stored, no flag, no database created', async () => {
    const r = await none;
    assert.equal(r.error, null);
    assert.deepEqual(writesOf(r.calls), [{ area: 'local', op: 'set', items: { [VERSION_KEY]: VERSION } }]);
    assert.equal(FLAG in r.local, false);
    assert.deepEqual(r.idb, []);
});

k.test('stale-flag', 'no msg: key but a flag left by a start that closed before removing it: the flag is removed, the version stored', async () => {
    const r = await staleFlag;
    assert.equal(FLAG in r.local, false);
    assert.deepEqual(writesOf(r.calls), [
        { area: 'local', op: 'remove', keys: FLAG },
        { area: 'local', op: 'set', items: { [VERSION_KEY]: VERSION } },
    ]);
});

k.coverage();
