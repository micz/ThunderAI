// Spec 01 "Per-Message Data Storage", taStorage (js/mzta-storage.js):
//  - the per-message data (spam reports, summaries, translations) lives in IndexedDB: database
//    `thunderai-message-data`, version 1, one object store per type (`spam`, `summary`,
//    `translation`), keyPath `messageId` (the header Message-ID alone: a new translation replaces
//    the previous one whatever its language), indexes `createdAt` and `size`;
//  - a record holds messageId, createdAt (the time of the write), size (the bytes of its JSON
//    without size), subject / from / message_date, and the fields of its type; never `ts`;
//  - getRecord() reads the three stores and returns { spam, summary, translation }, each key
//    present only when that store holds a record; deleting one type deletes that record only;
//    deleteRecord() the three;
//  - getPage(type, {offset, limit}) newest first (offset 0 included), count(type);
//  - clear(type), clearAllRecords(), the cleanup routine: by maximum age, then by maximum count,
//    per type, 0 = no limit, all under the `thunderai-storage-cleanup` lock;
//  - the size total of the three stores;
//  - saving disabled for a type: writes skipped, what is saved still read; an empty Message-ID is
//    never saved; a failed write is logged and rejects;
//  - the scheduled cleanup: at once when the last one is more than 24 hours old (or none), else 2
//    hours after the start; then every 24 hours, one timer; its time stored in storage.local;
//  - eviction (a best-effort, rebuildable cache): a deleted database answers as empty and is
//    created again; one without its three stores is deleted and created again; a database that
//    cannot be opened gives null / [] / 0 to the reads, a resolved delete and a rejected write;
//    an aborted transaction leaves no unhandled rejection.
// And spec 05: the preferences live in storage.local, which none of this touches but for the
// time of the last cleanup.
// The field contents of each type are the stores' business (05-stores); here the storage itself.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const DAY = 24 * 60 * 60 * 1000;
const ctx = await moduleContext({
    local: {
        do_debug: false,
        connection_type: 'ollama_api',
    },
});
const {
    taStorage,
    MESSAGE_DB_NAME,
    LAST_CLEANUP_KEY,
    CLEANUP_LOCK_NAME
} = await import('../../js/mzta-storage.js');
const { getMessageStorageUsedSpace } = await import('../../js/mzta-utils.js');
const st = new taStorage(false);
const k = caseTests('04-storage');

/** Every record of a store, read with the raw IndexedDB API (not through the module). */
function rawAll(store) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(MESSAGE_DB_NAME);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const req = db.transaction(store, 'readonly').objectStore(store).getAll();
            req.onsuccess = () => { db.close(); resolve(req.result); };
            req.onerror = () => { db.close(); reject(req.error); };
        };
    });
}
const raw = async (store, id) => (await rawAll(store)).find(r => r.messageId === id);
const clearAll = () => taStorage.clearAllRecords();

k.test('schema', 'the database: its name, version 1, the three stores keyed on messageId, the createdAt and size indexes', async () => {
    await st.writeSummary('schema@x', { summary: 'S' });
    const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('thunderai-message-data');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    try {
        assert.equal(db.version, 1);
        assert.deepEqual([...db.objectStoreNames].sort(), ['spam', 'summary', 'translation']);
        const tx = db.transaction(['spam', 'summary', 'translation'], 'readonly');
        for (const name of ['spam', 'summary', 'translation']) {
            const store = tx.objectStore(name);
            assert.equal(store.keyPath, 'messageId', name);
            assert.deepEqual([...store.indexNames].sort(), ['createdAt', 'size'], name);
            assert.equal(store.index('createdAt').keyPath, 'createdAt');
            assert.equal(store.index('size').keyPath, 'size');
        }
    } finally {
        db.close();
    }
});

k.test('record-fields', 'a record holds messageId, createdAt, size, subject / from / message_date and its fields, and no ts', async () => {
    const before = Date.now();
    await st.writeSpam('rf@x', { spamValue: 80, explanation: 'e', subject: ['s'], from: ['f@x'], message_date: new Date('2026-01-01T00:00:00Z'), moved: false, SpamThreshold: 70 });
    const rec = await raw('spam', 'rf@x');
    assert.equal(rec.messageId, 'rf@x');
    assert.ok(rec.createdAt >= before && rec.createdAt <= Date.now(), 'createdAt is the time of the write');
    assert.deepEqual(rec.subject, ['s']);
    assert.deepEqual(rec.from, ['f@x']);
    assert.equal(rec.message_date, '2026-01-01T00:00:00.000Z', 'a Date is stored as an ISO string');
    assert.equal(rec.spamValue, 80);
    assert.equal('ts' in rec, false);
});

k.test('record-size', 'size is the byte length of the JSON of the record without size', async () => {
    await st.writeSummary('sz@x', { summary: 'héllo wörld €' });
    const rec = await raw('summary', 'sz@x');
    const { size, ...rest } = rec;
    assert.equal(size, new TextEncoder().encode(JSON.stringify(rest)).byteLength);
    assert.ok(size > JSON.stringify(rest).length, 'bytes, not characters');
});

k.test('created-at-rewritten', 'createdAt is overwritten when the record is rewritten', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-05-01T00:00:00Z') });
    await st.writeSummary('ca@x', { summary: 'first' });
    t.mock.timers.setTime(Date.parse('2026-05-02T00:00:00Z'));
    await st.writeSummary('ca@x', { summary: 'second' });
    const rec = await raw('summary', 'ca@x');
    assert.equal(rec.summary, 'second');
    assert.equal(rec.createdAt, Date.parse('2026-05-02T00:00:00Z'));
});

k.test('separate-stores', 'each type is stored in its own store: writing one keeps the others', async () => {
    await st.writeSpam('b@x', { spamValue: 80, explanation: 'e' });
    await st.writeSummary('b@x', { summary: 'S' });
    await st.writeTranslation('b@x', { translated_text: 'T', lang: 'it' });
    assert.equal((await raw('spam', 'b@x')).spamValue, 80);
    assert.equal((await raw('summary', 'b@x')).summary, 'S');
    assert.equal((await raw('translation', 'b@x')).translated_text, 'T');
});

k.test('get-record', 'getRecord() combines the three stores, each key only when that store has a record; null when none has', async () => {
    const rec = await st.getRecord('b@x');
    assert.deepEqual(Object.keys(rec).sort(), ['spam', 'summary', 'translation']);
    assert.deepEqual(rec.summary, await raw('summary', 'b@x'), 'each sub-object is the stored record');
    await st.writeSummary('only-sum@x', { summary: 'S' });
    assert.deepEqual(Object.keys(await st.getRecord('only-sum@x')), ['summary']);
    assert.equal(await st.getRecord('nothing@x'), null);
});

k.test('has-field', 'hasField() tells which types a record holds', async () => {
    const rec = await st.getRecord('only-sum@x');
    assert.equal(st.hasField(rec, 'summary'), true);
    assert.equal(st.hasField(rec, 'spam'), false);
    assert.equal(st.hasField(null, 'summary'), false);
});

k.test('key-message-id-only', 'the key is the Message-ID alone: a translation into another language replaces the previous one', async () => {
    await st.writeTranslation('lang@x', { translated_text: 'Ciao', lang: 'Italian' });
    await st.writeTranslation('lang@x', { translated_text: 'Hallo', lang: 'German' });
    const all = (await rawAll('translation')).filter(r => r.messageId === 'lang@x');
    assert.equal(all.length, 1);
    assert.equal(all[0].lang, 'German');
});

k.test('no-force', 'with force = false an existing record is kept, a missing one written', async () => {
    await st.writeTranslation('c@x', { translated_text: 'one' });
    await st.writeTranslation('c@x', { translated_text: 'two' }, false);
    assert.equal((await raw('translation', 'c@x')).translated_text, 'one');
    await st.writeSpam('c@x', { spamValue: 1 }, false);
    assert.equal((await raw('spam', 'c@x')).spamValue, 1);
});

k.test('delete-field', 'deleting one type deletes that record only', async () => {
    await st.deleteSummaryField('b@x');
    assert.equal(await raw('summary', 'b@x'), undefined);
    assert.ok(await raw('spam', 'b@x'));
    assert.ok(await raw('translation', 'b@x'));
    await st.deleteSpamField('nothing@x');
});

k.test('delete-record', 'deleteRecord() removes the records of the three types', async () => {
    await st.writeSummary('b@x', { summary: 'again' });
    await st.deleteRecord('b@x');
    assert.equal(await st.getRecord('b@x'), null);
    for (const store of ['spam', 'summary', 'translation']) assert.equal(await raw(store, 'b@x'), undefined, store);
});

k.test('concurrent-types', 'three types written to one message at the same moment: all three are stored', async () => {
    await Promise.all([
        st.writeSummary('race@x', { summary: 'S' }),
        st.writeTranslation('race@x', { translated_text: 'T' }),
        st.writeSpam('race@x', { spamValue: 1 }),
    ]);
    assert.deepEqual(Object.keys(await st.getRecord('race@x')).sort(), ['spam', 'summary', 'translation']);
});

k.test('empty-message-id', 'an empty or missing Message-ID is never saved, and it is logged', async () => {
    const counts = async () => Promise.all(['spam', 'summary', 'translation'].map(s => taStorage.count(s)));
    const before = await counts();
    ctx.con.clear();
    for (const id of ['', null, undefined]) {
        assert.equal(await st.writeSummary(id, { summary: 'x' }), null);
        assert.equal(await st.writeSpam(id, { spamValue: 1 }), null);
        assert.equal(await st.writeTranslation(id, { translated_text: 'x' }), null);
    }
    assert.deepEqual(await counts(), before);
    assert.match(ctx.con.all().join(' | '), /empty Message-ID/);
});

k.test('saving-disabled', 'saving disabled for a type: its writes are skipped, what it saved is still read, the other types are saved', async () => {
    await st.writeSummary('dis@x', { summary: 'before' });
    await ctx.mztaPrefs.setPref('summarize_storage_enabled', false);
    try {
        assert.equal(await st.writeSummary('dis@x', { summary: 'after' }), null);
        assert.equal(await st.writeSummary('dis2@x', { summary: 'new' }), null);
        assert.equal((await st.getRecord('dis@x')).summary.summary, 'before', 'the saved summary is still read');
        assert.equal(await st.getRecord('dis2@x'), null);
        await st.writeTranslation('dis@x', { translated_text: 'T' });
        assert.equal((await st.getRecord('dis@x')).translation.translated_text, 'T', 'another type is still saved');
    } finally {
        await ctx.mztaPrefs.setPref('summarize_storage_enabled', true);
    }
});

k.test('saving-disabled-each', 'each type has its own switch', async () => {
    for (const [key, write, store] of [
        ['spamfilter_storage_enabled', id => st.writeSpam(id, { spamValue: 1 }), 'spam'],
        ['summarize_storage_enabled', id => st.writeSummary(id, { summary: 's' }), 'summary'],
        ['translate_storage_enabled', id => st.writeTranslation(id, { translated_text: 't' }), 'translation'],
    ]) {
        await ctx.mztaPrefs.setPref(key, false);
        await write('each-' + store + '@x');
        assert.equal(await raw(store, 'each-' + store + '@x'), undefined, key);
        await ctx.mztaPrefs.setPref(key, true);
        await write('each-' + store + '@x');
        assert.ok(await raw(store, 'each-' + store + '@x'), key + ' back on');
    }
});

k.test('write-failure', 'a failed write is logged and rejects, so the caller can tell the user', async (t) => {
    const { IDBObjectStore } = globalThis;
    t.mock.method(IDBObjectStore.prototype, 'put', function () { throw new DOMException('disk full', 'QuotaExceededError'); });
    ctx.con.clear();
    await assert.rejects(st.writeSummary('fail@x', { summary: 'x' }), /disk full/);
    await assert.rejects(st.writeSpam('fail@x', { spamValue: 1 }), /disk full/);
    await assert.rejects(st.writeTranslation('fail@x', { translated_text: 'x' }), /disk full/);
    t.mock.restoreAll();
    assert.match(ctx.con.all().join(' | '), /disk full/);
    assert.equal(await st.getRecord('fail@x'), null);
});

// --- Pages, counts, size ------------------------------------------------------------------------

k.test('page-order', 'getPage() returns the records newest first; count() their number', async (t) => {
    await clearAll();
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    for (let i = 0; i < 7; i++) {
        t.mock.timers.setTime(1000 + i * 10);
        await st.writeSpam('p' + i + '@x', { spamValue: i });
    }
    assert.equal(await taStorage.count('spam'), 7);
    const all = await taStorage.getPage('spam', { offset: 0, limit: 50 });
    assert.deepEqual(all.map(r => r.messageId), ['p6@x', 'p5@x', 'p4@x', 'p3@x', 'p2@x', 'p1@x', 'p0@x']);
});

k.test('page-paging', 'offset and limit page through them; offset 0 is the first page; past the end is empty', async () => {
    assert.deepEqual((await taStorage.getPage('spam', { offset: 0, limit: 3 })).map(r => r.messageId), ['p6@x', 'p5@x', 'p4@x']);
    assert.deepEqual((await taStorage.getPage('spam', { offset: 3, limit: 3 })).map(r => r.messageId), ['p3@x', 'p2@x', 'p1@x']);
    assert.deepEqual((await taStorage.getPage('spam', { offset: 6, limit: 3 })).map(r => r.messageId), ['p0@x']);
    assert.deepEqual(await taStorage.getPage('spam', { offset: 7, limit: 3 }), []);
    assert.deepEqual(await taStorage.getPage('summary', { offset: 0, limit: 3 }), [], 'an empty store');
    assert.equal(await taStorage.count('summary'), 0);
});

k.test('size-total', 'the size total is the sum of the size of every record of the three stores', async () => {
    await st.writeSummary('size@x', { summary: 'a summary' });
    await st.writeTranslation('size@x', { translated_text: 'una traduzione' });
    let expected = 0;
    for (const store of ['spam', 'summary', 'translation']) for (const r of await rawAll(store)) expected += r.size;
    assert.ok(expected > 0);
    assert.equal(await taStorage.getTotalSize(), expected);
    assert.match(await getMessageStorageUsedSpace(), /^\d+\.\d\d (Bytes|KB|MB)$/);
});

k.test('size-empty', 'with nothing saved the size is 0 Bytes', async () => {
    await clearAll();
    assert.equal(await taStorage.getTotalSize(), 0);
    assert.equal(await getMessageStorageUsedSpace(), '0 Bytes');
});

// --- Bulk removal -------------------------------------------------------------------------------

k.test('clear-type', 'clear(type) empties that store only, and returns how many records it removed', async () => {
    await st.writeSpam('cl@x', { spamValue: 1 });
    await st.writeSummary('cl@x', { summary: 'S' });
    await st.writeSummary('cl2@x', { summary: 'S' });
    assert.equal(await taStorage.clear('summary'), 2);
    assert.equal(await taStorage.count('summary'), 0);
    assert.equal(await taStorage.count('spam'), 1);
    await assert.rejects(taStorage.clear('nothing'));
});

k.test('clear-all', 'clearAllRecords() empties the three stores, returns the count, and keeps the preferences', async () => {
    await st.writeTranslation('cl@x', { translated_text: 'T' });
    const n = await taStorage.clearAllRecords();
    assert.equal(n, 2);
    for (const store of ['spam', 'summary', 'translation']) assert.equal(await taStorage.count(store), 0, store);
    const data = ctx.ctl.localData();
    assert.equal(data.connection_type, 'ollama_api');
    assert.equal(data.do_debug, false);
});

k.test('under-lock', 'clear(), clearAllRecords() and the cleanup run under the thunderai-storage-cleanup lock', async (t) => {
    const names = [];
    const real = navigator.locks.request.bind(navigator.locks);
    t.mock.method(navigator.locks, 'request', (name, ...rest) => { names.push(name); return real(name, ...rest); });
    await taStorage.clear('spam');
    await taStorage.clearAllRecords();
    await taStorage.cleanup({});
    assert.deepEqual(names, [CLEANUP_LOCK_NAME, CLEANUP_LOCK_NAME, CLEANUP_LOCK_NAME]);
    assert.equal(CLEANUP_LOCK_NAME, 'thunderai-storage-cleanup');
});

k.test('lock-serializes', 'a cleanup and a clear asked together never overlap', async () => {
    const order = [];
    let release;
    const held = navigator.locks.request(CLEANUP_LOCK_NAME, async () => {
        order.push('holder start');
        await new Promise(r => { release = r; });
        order.push('holder end');
    });
    await new Promise(r => setImmediate(r));
    const cleared = taStorage.clearAllRecords().then(() => order.push('cleared'));
    await new Promise(r => setImmediate(r));
    assert.deepEqual(order, ['holder start'], 'the clear waits for the lock');
    release();
    await held;
    await cleared;
    assert.deepEqual(order, ['holder start', 'holder end', 'cleared']);
});

// --- Cleanup ------------------------------------------------------------------------------------

/** Seed n records of a type, one a day back from `now` (index 0 the newest). */
async function seedDays(t, type, n, now) {
    const write = { spam: (id) => st.writeSpam(id, { spamValue: 1 }), summary: (id) => st.writeSummary(id, { summary: 's' }), translation: (id) => st.writeTranslation(id, { translated_text: 't' }) }[type];
    for (let i = n - 1; i >= 0; i--) {
        t.mock.timers.setTime(now - i * DAY - 1000);
        await write(type + i + '@x');
    }
    t.mock.timers.setTime(now);
}
const ids = async type => (await taStorage.getPage(type, { offset: 0, limit: 1000 })).map(r => r.messageId);

k.test('cleanup-age', 'by age: the records older than the maximum age go, the others stay', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'summary', 6, now);
    const removed = await taStorage.cleanup({ summary: { maxAgeDays: 3, maxEntries: 0 } }, now);
    assert.equal(removed.summary, 3);
    assert.deepEqual(await ids('summary'), ['summary0@x', 'summary1@x', 'summary2@x']);
});

k.test('cleanup-count', 'by count: the oldest records beyond the maximum count go', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'spam', 5, now);
    const removed = await taStorage.cleanup({ spam: { maxAgeDays: 0, maxEntries: 2 } }, now);
    assert.equal(removed.spam, 3);
    assert.deepEqual(await ids('spam'), ['spam0@x', 'spam1@x']);
});

k.test('cleanup-age-then-count', 'age first, then count', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'translation', 6, now);
    const removed = await taStorage.cleanup({ translation: { maxAgeDays: 4, maxEntries: 2 } }, now);
    assert.equal(removed.translation, 4);
    assert.deepEqual(await ids('translation'), ['translation0@x', 'translation1@x']);
});

k.test('cleanup-zero', 'a limit of 0 is no limit: nothing goes', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'spam', 4, now);
    assert.deepEqual(await taStorage.cleanup({ spam: { maxAgeDays: 0, maxEntries: 0 } }, now), { spam: 0, summary: 0, translation: 0 });
    assert.equal(await taStorage.count('spam'), 4);
});

k.test('cleanup-per-type', 'each type has its own limits: one type cleaned, the others untouched', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'spam', 3, now);
    await seedDays(t, 'summary', 3, now);
    await seedDays(t, 'translation', 3, now);
    const removed = await taStorage.cleanup({ spam: { maxEntries: 1 }, summary: { maxAgeDays: 1 }, translation: {} }, now);
    assert.deepEqual(removed, { spam: 2, summary: 2, translation: 0 });
    assert.deepEqual(await ids('spam'), ['spam0@x']);
    assert.deepEqual(await ids('summary'), ['summary0@x']);
    assert.equal(await taStorage.count('translation'), 3);
});

k.test('cleanup-prefs', 'without explicit limits the cleanup reads the preferences of each type', async (t) => {
    await clearAll();
    const now = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'spam', 4, now);
    await seedDays(t, 'summary', 4, now);
    await ctx.ctl.browser.storage.local.set({ spamfilter_storage_max_entries: 1, summarize_storage_max_age_days: 2 });
    try {
        const removed = await taStorage.cleanup();
        assert.deepEqual(removed, { spam: 3, summary: 2, translation: 0 });
    } finally {
        await ctx.ctl.browser.storage.local.remove(['spamfilter_storage_max_entries', 'summarize_storage_max_age_days']);
    }
});

k.test('cleanup-defaults', 'with the default preferences (every limit 0) the cleanup removes nothing', async (t) => {
    await clearAll();
    const now = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now });
    await seedDays(t, 'spam', 3, now - 400 * DAY);
    assert.deepEqual(await taStorage.cleanup(), { spam: 0, summary: 0, translation: 0 });
    assert.equal(await taStorage.count('spam'), 3);
});

// --- The schedule -------------------------------------------------------------------------------

k.test('schedule-first', 'no cleanup ever: it runs at once, its time is stored, the next one is 24 hours later', async (t) => {
    const now = Date.parse('2026-07-01T08:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    const runs = [];
    const real = taStorage.cleanup;
    t.mock.method(taStorage, 'cleanup', async (...a) => { runs.push(Date.now()); return real.apply(taStorage, a); });
    await taStorage.startCleanupSchedule();
    assert.deepEqual(runs, [now], 'at once');
    assert.equal(ctx.ctl.localData()[LAST_CLEANUP_KEY], now);
    t.mock.timers.tick(24 * 60 * 60 * 1000 - 1);
    assert.equal(runs.length, 1);
    t.mock.timers.tick(1);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(runs.length, 2, '24 hours later');
    taStorage.stopCleanupSchedule();
});

k.test('schedule-recent', 'a cleanup less than 24 hours ago: nothing at once, the next one 2 hours after the start', async (t) => {
    const now = Date.parse('2026-07-02T08:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: now - 3 * 60 * 60 * 1000 });
    const runs = [];
    t.mock.method(taStorage, 'cleanup', async () => { runs.push(Date.now()); return {}; });
    await taStorage.startCleanupSchedule();
    assert.deepEqual(runs, []);
    t.mock.timers.tick(2 * 60 * 60 * 1000 - 1);
    assert.deepEqual(runs, []);
    t.mock.timers.tick(1);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(runs.length, 1, '2 hours after the start');
    assert.equal(ctx.ctl.localData()[LAST_CLEANUP_KEY], now + 2 * 60 * 60 * 1000);
    taStorage.stopCleanupSchedule();
});

k.test('schedule-old', 'a cleanup more than 24 hours ago: it runs at once', async (t) => {
    const now = Date.parse('2026-07-03T08:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: now - 25 * 60 * 60 * 1000 });
    const runs = [];
    t.mock.method(taStorage, 'cleanup', async () => { runs.push(Date.now()); return {}; });
    await taStorage.startCleanupSchedule();
    assert.deepEqual(runs, [now]);
    taStorage.stopCleanupSchedule();
});

k.test('schedule-one-timer', 'only one timer at any time: starting again replaces it, and a run sets just the next one', async (t) => {
    const now = Date.parse('2026-07-04T08:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: now });
    const runs = [];
    t.mock.method(taStorage, 'cleanup', async () => { runs.push(Date.now()); return {}; });
    await taStorage.startCleanupSchedule();
    await taStorage.startCleanupSchedule();
    t.mock.timers.tick(2 * 60 * 60 * 1000);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(runs.length, 1, 'one run, not two');
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(runs.length, 2);
    taStorage.stopCleanupSchedule();
});

k.test('schedule-failure', 'a failed cleanup is logged and still sets the next one; its time is not stored', async (t) => {
    const now = Date.parse('2026-07-05T08:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    let n = 0;
    t.mock.method(taStorage, 'cleanup', async () => { n++; throw new Error('broken'); });
    ctx.con.clear();
    await taStorage.startCleanupSchedule();
    assert.equal(n, 1);
    assert.equal(ctx.ctl.localData()[LAST_CLEANUP_KEY], undefined);
    assert.match(ctx.con.all().join(' | '), /broken/);
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(n, 2);
    taStorage.stopCleanupSchedule();
});

// --- Eviction: a best-effort cache -------------------------------------------------------------

/** Delete the database with the raw API, as an eviction would: the module's connection closes. */
function rawDelete() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(MESSAGE_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/** Create the database at version 1 with only the given stores, then close it. */
function rawCreate(stores) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(MESSAGE_DB_NAME, 1);
        open.onupgradeneeded = () => { for (const name of stores) open.result.createObjectStore(name, { keyPath: 'messageId' }); };
        open.onsuccess = () => { open.result.close(); resolve(); };
        open.onerror = () => reject(open.error);
    });
}

/** The object store names of the database, read with the raw API. */
function rawStoreNames() {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(MESSAGE_DB_NAME);
        open.onsuccess = () => { const names = [...open.result.objectStoreNames].sort(); open.result.close(); resolve(names); };
        open.onerror = () => reject(open.error);
    });
}

k.test('evicted-recreated', 'a database deleted under the add-on (eviction): an empty cache, then created again by the next write', async () => {
    await st.writeSummary('ev@x', { summary: 'S' });
    await rawDelete();
    assert.equal(await st.getRecord('ev@x'), null);
    assert.equal(await taStorage.count('summary'), 0);
    await st.writeSummary('ev2@x', { summary: 'S2' });
    assert.equal((await st.getRecord('ev2@x')).summary.summary, 'S2');
    assert.deepEqual(await rawStoreNames(), ['spam', 'summary', 'translation']);
});

k.test('missing-stores-recreated', 'a database at version 1 without its stores is deleted and created again, empty, with a warning', async () => {
    await rawDelete();
    await rawCreate(['spam']);
    ctx.con.clear();
    assert.equal(await st.getRecord('ms@x'), null);
    assert.match(ctx.con.all().join(' | '), /no summary, translation object store/);
    assert.deepEqual(await rawStoreNames(), ['spam', 'summary', 'translation']);
    await st.writeTranslation('ms@x', { translated_text: 'T' });
    assert.equal((await st.getRecord('ms@x')).translation.translated_text, 'T');
    const db = await taStorage.openDB();
    const tx = db.transaction('summary', 'readonly');
    assert.deepEqual([...tx.store.indexNames].sort(), ['createdAt', 'size'], 'the indexes too');
    await tx.done;
});

k.test('open-fails-empty', 'the database cannot be opened: reads answer as an empty cache, deletes resolve, a write rejects', async (t) => {
    await st.writeSpam('of@x', { spamValue: 1 });
    await rawDelete();
    t.mock.method(indexedDB, 'open', () => { throw new DOMException('IndexedDB unavailable', 'UnknownError'); });
    ctx.con.clear();
    assert.equal(await st.getRecord('of@x'), null);
    assert.deepEqual(await taStorage.getPage('spam'), []);
    assert.equal(await taStorage.count('spam'), 0);
    assert.equal(await taStorage.getTotalSize(), 0);
    assert.equal(await getMessageStorageUsedSpace(), '0 Bytes');
    await st.deleteSpamField('of@x');
    await st.deleteSummaryField('of@x');
    await st.deleteTranslationField('of@x');
    await st.deleteRecord('of@x');
    await assert.rejects(st.writeSummary('of@x', { summary: 'x' }), /IndexedDB unavailable/);
    assert.match(ctx.con.all().join(' | '), /IndexedDB unavailable/, 'logged');
    t.mock.restoreAll();
    await st.writeSummary('of2@x', { summary: 'back' });
    assert.equal((await st.getRecord('of2@x')).summary.summary, 'back', 'the next open succeeds');
});

k.test('aborted-tx-handled', 'a transaction aborted under a read: null, and no unhandled rejection of its done', async (t) => {
    await st.writeSummary('ab@x', { summary: 'S' });
    const unhandled = [];
    const onUnhandled = e => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
        const { IDBObjectStore } = globalThis;
        const realGet = IDBObjectStore.prototype.get;
        // Aborted once the three reads are issued (the last store of MESSAGE_STORES): every request
        // fails with an AbortError, and so does the transaction's done.
        t.mock.method(IDBObjectStore.prototype, 'get', function (...args) {
            const req = realGet.apply(this, args);
            if (this.name === 'translation') this.transaction.abort();
            return req;
        });
        assert.equal(await st.getRecord('ab@x'), null);
        t.mock.restoreAll();
        for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
    assert.equal((await st.getRecord('ab@x')).summary.summary, 'S', 'the record is still there');
});

k.test('prefs-untouched','the storage writes nothing to storage.local but the time of the last cleanup', () => {
    const writes = ctx.ctl.calls.filter(c => c.area === 'local' && c.op === 'set').flatMap(c => Object.keys(c.items));
    const own = writes.filter(key => key !== LAST_CLEANUP_KEY);
    // The preference writes of this file's own setup (setPref / storage.local.set above).
    assert.deepEqual([...new Set(own)].sort(), ['spamfilter_storage_enabled', 'spamfilter_storage_max_entries', 'summarize_storage_enabled',
        'summarize_storage_max_age_days', 'translate_storage_enabled'].sort());
});

k.coverage();
