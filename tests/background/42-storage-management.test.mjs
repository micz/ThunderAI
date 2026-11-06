// Spec 01 "Per-Message Data Storage", what #956 added for the storage management page
// (js/mzta-storage.js, taStorage):
//  - `failed` on every record, 1 or 0, computed by buildRecord() (so the mirror holds it and the
//    rebuild keeps it): a summary or a translation with `error`, a spam report with spamValue
//    SPAM_ERROR_VALUE (-999, also what taSpamReport.buildError() uses); a skipped translation
//    (translation_status "-1") is a valid result;
//  - the `failed_createdAt` index ([failed, createdAt]): the error queries are ranges on it;
//  - cleanup(): per type, the error rule (errors older than errorMaxAgeDays), then the age rule,
//    then the count rule; 0 disables a rule;
//  - previewCleanup(limits, now): what cleanup() would remove, from counts only, nothing deleted;
//    the same numbers cleanup() then removes;
//  - deleteErrors(), deleteOlderThan(days), removeEntries(), getEntryKeys(), getStats(),
//    fillMetadata(), getLastCleanup();
//  - the mirror helper of every bulk removal: after the database transaction, a targeted get of
//    the mirror keys, and only those still holding the createdAt seen are removed;
//  - LAST_CLEANUP_KEY is { time, removed }, written by the scheduled run only; the manual run
//    (cleanup() called directly) writes nothing; startCleanupSchedule() does nothing while
//    message_storage_cleanup_auto is off, and the background's listener on that key stops or
//    starts the schedule;
//  - buildMessageMetadata(), shared by the background and the page.

import assert from 'node:assert/strict';
import {
    bgContext,
    flush,
    ROOTS
} from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const DAY = 24 * 60 * 60 * 1000;
const ctx = await bgContext({
    local: { do_debug: false, connection_type: 'ollama_api' },
    roots: [...ROOTS, 'setupCleanupScheduleListener'],
});
const {
    taStorage,
    LAST_CLEANUP_KEY,
    SPAM_ERROR_VALUE,
    INDEX_FAILED_CREATED_AT,
    MESSAGE_DB_NAME,
    buildMessageMetadata,
    mirrorKey,
    putNewerRecords
} = await import('../../js/mzta-storage.js');
const { taSpamReport } = await import('../../js/mzta-spamreport.js');
const k = caseTests('42-storage-management');
const local = () => ctx.ctl.localData();
const clearAll = () => taStorage.clearAllRecords();

const DATA = {
    spam: { ok: { spamValue: 40, explanation: 'fine' }, err: { spamValue: -999, explanation: 'broken' } },
    summary: { ok: { summary: 'S' }, err: { error: true, message: 'broken' } },
    translation: { ok: { translated_text: 'T', translation_status: '1' }, err: { error: true, message: 'broken' } },
};

/** Put a record in both places, the mirror and the database, with a given createdAt. */
async function seed(type, id, data, createdAt) {
    const record = taStorage.buildRecord(type, id, data, createdAt);
    await ctx.ctl.browser.storage.local.set({ [mirrorKey(type, id)]: record });
    await putNewerRecords([{ type, record }]);
    return record;
}

/** Every record of a store, read with the raw IndexedDB API. */
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
const ids = async type => (await rawAll(type)).map(r => r.messageId).sort();

/**
 * One store's records for the cleanup tests: `days` is how many days old each one is (plus a
 * second, so it is strictly older than a cutoff of that many days); `err` the ids holding an error.
 */
async function seedDays(type, now, spec) {
    for (const [id, days, err] of spec) {
        await seed(type, id, err ? DATA[type].err : DATA[type].ok, now - days * DAY - 1000);
    }
}

// --- failed -------------------------------------------------------------------------------------

k.test('failed-field', 'buildRecord() stores failed 1 for an error and 0 for a result, for every type; a skipped translation is a result', () => {
    const f = (type, data) => taStorage.buildRecord(type, 'f@x', data, 1).failed;
    assert.equal(f('summary', { summary: 'S' }), 0);
    assert.equal(f('summary', { error: true, message: 'x' }), 1);
    assert.equal(f('translation', { translated_text: 'T', translation_status: '1' }), 0);
    assert.equal(f('translation', { translated_text: '', translation_status: '-1' }), 0, 'skipped: not an error');
    assert.equal(f('translation', { error: true, message: 'x' }), 1);
    assert.equal(f('spam', { spamValue: 0 }), 0);
    assert.equal(f('spam', { spamValue: 100 }), 0);
    assert.equal(f('spam', { spamValue: -999 }), 1);
    assert.equal(SPAM_ERROR_VALUE, -999);
    assert.equal(new taSpamReport(false).buildError('e@x', 'boom').spamValue, SPAM_ERROR_VALUE);
});

k.test('failed-size', 'size counts failed too: it is the byte length of the record without size', () => {
    const { size, ...rest } = taStorage.buildRecord('summary', 's@x', { error: true, message: 'x' }, 5);
    assert.equal(rest.failed, 1);
    assert.equal(size, new TextEncoder().encode(JSON.stringify(rest)).byteLength);
});

k.test('failed-stored', 'the written record and its mirror value hold failed; the rebuild from the mirror keeps it', async () => {
    await clearAll();
    const st = new taStorage(false);
    await st.writeSummary('w-err@x', { error: true, message: 'x' });
    await st.writeTranslation('w-skip@x', { translated_text: '', translation_status: '-1' });
    await new taSpamReport(false).saveError('w-spam@x', 'boom');
    assert.equal(local()['summary:w-err@x'].failed, 1);
    assert.equal(local()['translation:w-skip@x'].failed, 0);
    assert.equal(local()['spam:w-spam@x'].failed, 1);
    // An IndexedDB record lost: the realignment puts the mirror value back, failed included.
    const db = await taStorage.openDB();
    await db.delete('summary', 'w-err@x');
    await taStorage.reconcileWithMirror();
    assert.equal((await rawAll('summary')).find(r => r.messageId === 'w-err@x').failed, 1);
});

k.test('error-index', 'the failed_createdAt index answers the error queries with a range, never a scan', async () => {
    await clearAll();
    await seed('summary', 'a@x', DATA.summary.ok, 100);
    await seed('summary', 'b@x', DATA.summary.err, 200);
    await seed('summary', 'c@x', DATA.summary.err, 300);
    const db = await taStorage.openDB();
    const index = db.transaction('summary').store.index(INDEX_FAILED_CREATED_AT);
    assert.equal(await index.count(IDBKeyRange.bound([1, -Infinity], [1, Infinity])), 2);
    assert.equal(await index.count(IDBKeyRange.bound([1, -Infinity], [1, 250], false, true)), 1);
    assert.equal(await index.count(IDBKeyRange.bound([0, -Infinity], [0, Infinity])), 1);
});

// --- Statistics ---------------------------------------------------------------------------------

k.test('stats', 'getStats(): count, errors, size, oldest and newest of each type; an empty type answers zeros and null dates', async () => {
    await clearAll();
    const a = await seed('summary', 'a@x', DATA.summary.ok, 1000);
    const b = await seed('summary', 'b@x', DATA.summary.err, 3000);
    const c = await seed('summary', 'c@x', DATA.summary.ok, 2000);
    const s = await seed('spam', 's@x', DATA.spam.err, 500);
    const stats = await taStorage.getStats();
    assert.deepEqual(stats.summary, { count: 3, errors: 1, size: a.size + b.size + c.size, oldest: 1000, newest: 3000 });
    assert.deepEqual(stats.spam, { count: 1, errors: 1, size: s.size, oldest: 500, newest: 500 });
    assert.deepEqual(stats.translation, { count: 0, errors: 0, size: 0, oldest: null, newest: null });
});

k.test('stats-unreachable', 'getStats() on a database that cannot be opened answers every type as empty', async (t) => {
    t.mock.method(taStorage, 'openDB', () => Promise.reject(new Error('no database')));
    const stats = await taStorage.getStats();
    for (const type of ['spam', 'summary', 'translation']) {
        assert.deepEqual(stats[type], { count: 0, errors: 0, size: 0, oldest: null, newest: null });
    }
});

k.test('entry-keys', 'getEntryKeys(): every { messageId, createdAt } of a type, oldest first, from a key cursor (no record loaded)', async (t) => {
    await clearAll();
    await seed('translation', 'n@x', DATA.translation.ok, 3000);
    await seed('translation', 'o@x', DATA.translation.ok, 1000);
    await seed('translation', 'm@x', DATA.translation.err, 2000);
    const cursors = t.mock.method(globalThis.IDBIndex.prototype, 'openCursor');
    const gets = t.mock.method(globalThis.IDBObjectStore.prototype, 'getAll');
    assert.deepEqual(await taStorage.getEntryKeys('translation'), [
        { messageId: 'o@x', createdAt: 1000 },
        { messageId: 'm@x', createdAt: 2000 },
        { messageId: 'n@x', createdAt: 3000 },
    ]);
    assert.equal(cursors.mock.callCount(), 0);
    assert.equal(gets.mock.callCount(), 0);
});

// --- The cleanup and its preview ----------------------------------------------------------------

k.test('cleanup-error-rule', 'the error rule: the errors older than their maximum age go; a recent error and an old result stay', async () => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedDays('summary', now, [['old-err@x', 10, true], ['new-err@x', 2, true], ['old-ok@x', 30, false]]);
    const removed = await taStorage.cleanup({ summary: { errorMaxAgeDays: 5 } }, now);
    assert.deepEqual(removed, { spam: 0, summary: 1, translation: 0, smartbar: 0 });
    assert.deepEqual(await ids('summary'), ['new-err@x', 'old-ok@x']);
    assert.equal('summary:old-err@x' in local(), false, 'its mirror key too');
    assert.ok('summary:new-err@x' in local());
});

k.test('cleanup-order', 'per type: the error rule, then the age rule, then the count rule on what is left', async () => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedDays('translation', now, [
        ['d0@x', 0, false], ['d1@x', 1, true], ['d2@x', 2, false], ['d3@x', 3, false], ['d4@x', 4, true], ['d6@x', 6, false],
    ]);
    // Error rule (3 days): d4. Age rule (5 days): d6. Count rule (2): of d0..d3, the oldest two, d3
    // and d2. A count rule applied first would have kept d0 and d1 too, but removed d4 and d6
    // instead of d2 and d3.
    const removed = await taStorage.cleanup({ translation: { errorMaxAgeDays: 3, maxAgeDays: 5, maxEntries: 2 } }, now);
    assert.equal(removed.translation, 4);
    assert.deepEqual(await ids('translation'), ['d0@x', 'd1@x']);
    for (const id of ['d2@x', 'd3@x', 'd4@x', 'd6@x']) assert.equal(('translation:' + id) in local(), false, id);
});

k.test('cleanup-zero', 'a limit of 0 disables its rule, the error rule too', async () => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedDays('spam', now, [['e@x', 400, true], ['o@x', 400, false]]);
    assert.deepEqual(await taStorage.cleanup({ spam: { errorMaxAgeDays: 0, maxAgeDays: 0, maxEntries: 0 } }, now),
        { spam: 0, summary: 0, translation: 0, smartbar: 0 });
    assert.equal(await taStorage.count('spam'), 2);
});

/** A mixed data set: per type, results and errors from 0 to 9 days old. */
async function seedMixed(now) {
    await clearAll();
    for (const type of ['spam', 'summary', 'translation']) {
        const spec = [];
        for (let d = 0; d < 10; d++) spec.push([type + d + '@x', d, d % 3 === 1]);
        await seedDays(type, now, spec);
    }
}

const PREVIEW_CASES = [
    { name: 'no rule', limits: {} },
    { name: 'errors only', limits: { spam: { errorMaxAgeDays: 2 }, summary: { errorMaxAgeDays: 5 }, translation: { errorMaxAgeDays: 20 } } },
    { name: 'age only', limits: { summary: { maxAgeDays: 4 } } },
    { name: 'count only', limits: { translation: { maxEntries: 3 } } },
    { name: 'error newer than age', limits: { summary: { errorMaxAgeDays: 2, maxAgeDays: 6 } } },
    { name: 'error older than age', limits: { summary: { errorMaxAgeDays: 8, maxAgeDays: 3 } } },
    { name: 'all three', limits: { spam: { errorMaxAgeDays: 2, maxAgeDays: 7, maxEntries: 3 }, summary: { errorMaxAgeDays: 1, maxAgeDays: 9, maxEntries: 5 }, translation: { maxEntries: 20, maxAgeDays: 2 } } },
    { name: 'count above what is left', limits: { spam: { errorMaxAgeDays: 3, maxAgeDays: 5, maxEntries: 8 } } },
];

k.test('preview-matches', 'previewCleanup() gives, for every combination of rules, exactly what cleanup() then removes', async () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    for (const { name, limits } of PREVIEW_CASES) {
        await seedMixed(now);
        const preview = await taStorage.previewCleanup(limits, now);
        const removed = await taStorage.cleanup(limits, now);
        assert.deepEqual(preview, removed, name);
    }
});

k.test('preview-reads-only', 'previewCleanup(): counts only, no record loaded, nothing deleted, no lock', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedMixed(now);
    const cursors = t.mock.method(globalThis.IDBIndex.prototype, 'openCursor');
    const deletes = t.mock.method(globalThis.IDBObjectStore.prototype, 'delete');
    const locks = t.mock.method(globalThis.navigator.locks, 'request');
    const preview = await taStorage.previewCleanup({ spam: { maxAgeDays: 1, maxEntries: 2, errorMaxAgeDays: 1 } }, now);
    assert.ok(preview.spam > 0);
    assert.equal(cursors.mock.callCount(), 0);
    assert.equal(deletes.mock.callCount(), 0);
    assert.equal(locks.mock.callCount(), 0);
    assert.equal(await taStorage.count('spam'), 10);
});

// --- Bulk removals ------------------------------------------------------------------------------

k.test('delete-errors', 'deleteErrors(): every record holding an error, of every type, with its mirror key; the results stay', async () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedMixed(now);
    assert.deepEqual(await taStorage.deleteErrors(), { spam: 3, summary: 3, translation: 3, smartbar: 0 });
    for (const type of ['spam', 'summary', 'translation']) {
        assert.equal((await rawAll(type)).filter(r => r.failed === 1).length, 0, type);
        assert.equal(await taStorage.count(type), 7);
        assert.equal(Object.keys(local()).filter(key => key.startsWith(type + ':')).length, 7, type + ' mirror');
    }
});

k.test('delete-older', 'deleteOlderThan(days): every record older than that, of every type, with its mirror key', async () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedMixed(now);
    assert.deepEqual(await taStorage.deleteOlderThan(6, now), { spam: 4, summary: 4, translation: 4, smartbar: 0 });
    assert.deepEqual(await ids('spam'), ['spam0@x', 'spam1@x', 'spam2@x', 'spam3@x', 'spam4@x', 'spam5@x']);
    assert.equal('spam:spam6@x' in local(), false);
    await assert.rejects(taStorage.deleteOlderThan(0), /Invalid number of days/);
});

k.test('bulk-under-lock', 'deleteErrors(), deleteOlderThan(), removeEntries(), fillMetadata(), the writes and the deletes take the cleanup lock', async (t) => {
    await clearAll();
    await seed('summary', 'one@x', DATA.summary.ok, 1);
    const names = [];
    const real = globalThis.navigator.locks.request.bind(globalThis.navigator.locks);
    t.mock.method(globalThis.navigator.locks, 'request', (name, fn) => { names.push(name); return real(name, fn); });
    const st = new taStorage(false);
    for (const op of [
        () => taStorage.deleteErrors(),
        () => taStorage.deleteOlderThan(3),
        () => taStorage.removeEntries([{ type: 'summary', messageId: 'one@x', createdAt: 1 }]),
        () => taStorage.fillMetadata('summary', 'none@x', 1, {}),
        () => st.writeSummary('w@x', { summary: 'S' }),
        () => st.deleteSummaryField('w@x'),
        () => st.deleteRecord('w@x'),
    ]) {
        const before = names.length;
        await op();
        assert.ok(names.length > before, String(op));
    }
    assert.ok(names.every(n => n === 'thunderai-storage-cleanup'));
});

k.test('mirror-helper-rewritten', 'a record rewritten between the cursor and the mirror removal keeps its new mirror key; the others go; never get(null)', async (t) => {
    await clearAll();
    const now = Date.parse('2026-06-10T12:00:00Z');
    await seedDays('summary', now, [['race@x', 10, false], ['gone@x', 10, false]]);
    const storageLocal = ctx.ctl.browser.storage.local;
    const realGet = storageLocal.get.bind(storageLocal);
    let newer = null;
    t.mock.method(storageLocal, 'get', async (keys) => {
        // The background saves a new summary of race@x after the cursor removed the old one.
        if (Array.isArray(keys) && keys.includes('summary:race@x') && !newer) {
            newer = taStorage.buildRecord('summary', 'race@x', { summary: 'new' }, now);
            await storageLocal.set({ 'summary:race@x': newer });
        }
        return realGet(keys);
    });
    ctx.ctl.calls.length = 0;
    assert.deepEqual(await taStorage.cleanup({ summary: { maxAgeDays: 5 } }, now), { spam: 0, summary: 2, translation: 0, smartbar: 0 });
    assert.deepEqual(local()['summary:race@x'], newer, 'the new value is kept');
    assert.equal('summary:gone@x' in local(), false);
    assert.equal(ctx.ctl.calls.some(c => c.area === 'local' && c.op === 'get' && c.keys === null), false, 'no get(null)');
});

k.test('remove-entries', 'removeEntries(): each record only while it still has the createdAt given, its mirror key with it', async () => {
    await clearAll();
    await seed('spam', 'a@x', DATA.spam.ok, 100);
    await seed('summary', 'b@x', DATA.summary.ok, 200);
    await seed('summary', 'c@x', DATA.summary.ok, 999);
    const removed = await taStorage.removeEntries([
        { type: 'spam', messageId: 'a@x', createdAt: 100 },
        { type: 'summary', messageId: 'b@x', createdAt: 200 },
        // Rewritten since it was listed (300 then, 999 now): kept.
        { type: 'summary', messageId: 'c@x', createdAt: 300 },
        { type: 'translation', messageId: 'missing@x', createdAt: 1 },
    ]);
    assert.deepEqual(removed, { spam: 1, summary: 1, translation: 0 });
    assert.deepEqual(await ids('summary'), ['c@x']);
    assert.equal('spam:a@x' in local(), false);
    assert.equal('summary:b@x' in local(), false);
    assert.equal(local()['summary:c@x'].createdAt, 999);
});

// --- Metadata fill ------------------------------------------------------------------------------

const META = { subject: ['Hello'], from: ['Alice <a@x>'], message_date: new Date('2026-01-02T03:04:05Z') };

k.test('fill-metadata', 'fillMetadata(): empty metadata filled, createdAt kept, size recomputed, the mirror and the database the same record', async () => {
    await clearAll();
    const before = await seed('translation', 'fm@x', { translated_text: 'T', lang: 'Italian' }, 4242);
    assert.equal(await taStorage.fillMetadata('translation', 'fm@x', 4242, META), true);
    const after = (await rawAll('translation')).find(r => r.messageId === 'fm@x');
    assert.equal(after.createdAt, 4242);
    assert.deepEqual(after.subject, ['Hello']);
    assert.deepEqual(after.from, ['Alice <a@x>']);
    assert.equal(after.message_date, '2026-01-02T03:04:05.000Z');
    assert.equal(after.translated_text, 'T');
    assert.equal(after.lang, 'Italian');
    assert.equal(after.failed, 0);
    const { size, ...rest } = after;
    assert.equal(size, new TextEncoder().encode(JSON.stringify(rest)).byteLength);
    assert.ok(size > before.size);
    assert.deepEqual(local()['translation:fm@x'], after);
});

k.test('fill-metadata-skipped', 'fillMetadata() changes nothing when the createdAt changed (mirror or database) or the metadata is already there', async () => {
    await clearAll();
    // createdAt changed since the entry was listed.
    await seed('summary', 'moved@x', DATA.summary.ok, 2000);
    assert.equal(await taStorage.fillMetadata('summary', 'moved@x', 1000, META), false);
    // The database has another createdAt than the mirror.
    const rec = await seed('summary', 'db@x', DATA.summary.ok, 1000);
    const db = await taStorage.openDB();
    await db.put('summary', { ...rec, createdAt: 1500 });
    assert.equal(await taStorage.fillMetadata('summary', 'db@x', 1000, META), false);
    // Metadata already there.
    await seed('summary', 'full@x', { summary: 'S', subject: ['Kept'] }, 1000);
    assert.equal(await taStorage.fillMetadata('summary', 'full@x', 1000, META), false);
    // No metadata to give.
    await seed('summary', 'none@x', DATA.summary.ok, 1000);
    assert.equal(await taStorage.fillMetadata('summary', 'none@x', 1000, {}), false);
    assert.deepEqual(local()['summary:moved@x'].subject, []);
    assert.deepEqual(local()['summary:db@x'].subject, []);
    assert.deepEqual((await rawAll('summary')).find(r => r.messageId === 'db@x').subject, []);
    assert.deepEqual(local()['summary:full@x'].subject, ['Kept']);
    assert.deepEqual(local()['summary:none@x'].subject, []);
});

k.test('build-metadata', 'buildMessageMetadata(): the MIME headers first, the MessageHeader fields as the fallback', () => {
    const message = { subject: 'Header subject', author: 'Bob <b@x>', date: '2026-02-03T04:05:06Z' };
    assert.deepEqual(buildMessageMetadata(message, { headers: { subject: ['Mime'], from: ['Mime <m@x>'] } }),
        { subject: ['Mime'], from: ['Mime <m@x>'], message_date: new Date('2026-02-03T04:05:06Z') });
    assert.deepEqual(buildMessageMetadata(message, null),
        { subject: ['Header subject'], from: ['Bob <b@x>'], message_date: new Date('2026-02-03T04:05:06Z') });
    assert.deepEqual(buildMessageMetadata(null, null), { subject: undefined, from: undefined, message_date: undefined });
});

// --- The last cleanup and the schedule ----------------------------------------------------------

k.test('last-cleanup', 'getLastCleanup(): null when there is none or not of the { time, removed } shape, else the stored value', async () => {
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    assert.equal(await taStorage.getLastCleanup(), null);
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: 12345 });
    assert.equal(await taStorage.getLastCleanup(), null, 'a number is not read');
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: { time: 5, removed: { spam: 1, summary: 2, translation: 3 } } });
    assert.deepEqual(await taStorage.getLastCleanup(), { time: 5, removed: { spam: 1, summary: 2, translation: 3 } });
});

k.test('manual-cleanup-no-stamp', 'cleanup() called directly (the page\'s "Apply rules now") stores no last cleanup and sets no timer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-08-01T00:00:00Z') });
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    taStorage.stopCleanupSchedule();
    const runs = t.mock.method(taStorage, 'cleanup');
    await taStorage.cleanup({});
    assert.equal(LAST_CLEANUP_KEY in local(), false);
    t.mock.timers.tick(48 * DAY);
    await flush();
    assert.equal(runs.mock.callCount(), 1, 'nothing scheduled');
});

k.test('schedule-auto-off', 'message_storage_cleanup_auto off: startCleanupSchedule() runs nothing and sets no timer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-08-02T00:00:00Z') });
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    await ctx.ctl.browser.storage.local.set({ message_storage_cleanup_auto: false });
    try {
        const runs = t.mock.method(taStorage, 'cleanup', async () => ({}));
        await taStorage.startCleanupSchedule();
        t.mock.timers.tick(48 * DAY);
        await flush();
        assert.equal(runs.mock.callCount(), 0);
        assert.equal(LAST_CLEANUP_KEY in local(), false);
    } finally {
        await ctx.ctl.browser.storage.local.remove('message_storage_cleanup_auto');
        taStorage.stopCleanupSchedule();
    }
});

k.test('schedule-switch-listener', 'the background listens to message_storage_cleanup_auto: off stops the pending run, on starts the schedule again', async (t) => {
    const now = Date.parse('2026-08-03T00:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    ctx.bg.setupCleanupScheduleListener();
    const runs = [];
    t.mock.method(taStorage, 'cleanup', async () => { runs.push(Date.now()); return { spam: 0, summary: 0, translation: 0 }; });
    // A recent cleanup: the next run is 2 hours away.
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: { time: now - 60 * 60 * 1000, removed: {} } });
    await taStorage.startCleanupSchedule();
    await ctx.ctl.browser.storage.local.set({ message_storage_cleanup_auto: false });
    await flush();
    t.mock.timers.tick(3 * 60 * 60 * 1000);
    await flush();
    assert.deepEqual(runs, [], 'off: the pending run is gone');
    // On again, with the last cleanup now more than 24 hours old: it runs at once.
    await ctx.ctl.browser.storage.local.set({ [LAST_CLEANUP_KEY]: { time: now - 30 * 60 * 60 * 1000, removed: {} } });
    await ctx.ctl.browser.storage.local.set({ message_storage_cleanup_auto: true });
    await flush();
    assert.equal(runs.length, 1, 'on: the schedule starts again');
    t.mock.timers.tick(DAY);
    await flush();
    assert.equal(runs.length, 2, 'and goes on every 24 hours');
    // Other keys do not touch it.
    await ctx.ctl.browser.storage.local.set({ summarize_storage_max_entries: 3 });
    await flush();
    assert.equal(runs.length, 2);
    taStorage.stopCleanupSchedule();
    await ctx.ctl.browser.storage.local.remove(['message_storage_cleanup_auto', 'summarize_storage_max_entries']);
});

k.test('schedule-stop-during-run', 'a run in progress when the schedule is stopped does not set its next run', async (t) => {
    const now = Date.parse('2026-08-04T00:00:00Z');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    await ctx.ctl.browser.storage.local.remove(LAST_CLEANUP_KEY);
    let release;
    let n = 0;
    t.mock.method(taStorage, 'cleanup', () => { n++; return new Promise(r => { release = () => r({}); }); });
    const started = taStorage.startCleanupSchedule();
    await flush();
    taStorage.stopCleanupSchedule();
    release();
    await started;
    t.mock.timers.tick(2 * DAY);
    await flush();
    assert.equal(n, 1);
    taStorage.stopCleanupSchedule();
});

// --- Lots ---------------------------------------------------------------------------------------

/** Run fn() with message_storage_batch_size stored as `size` (removed after). */
async function withBatchSize(size, fn) {
    await ctx.ctl.browser.storage.local.set({ message_storage_batch_size: size });
    try { return await fn(); } finally { await ctx.ctl.browser.storage.local.remove('message_storage_batch_size'); }
}

/** Count the holds of the cleanup lock during fn(). */
async function countHolds(t, fn) {
    let holds = 0;
    const real = globalThis.navigator.locks.request.bind(globalThis.navigator.locks);
    t.mock.method(globalThis.navigator.locks, 'request', (name, cb) => { holds++; return real(name, cb); });
    await fn();
    t.mock.restoreAll();
    return holds;
}

k.test('lots-size', 'a bulk removal works in lots of message_storage_batch_size, one lock hold each; an invalid size is the default, 100', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    const old = n => Array.from({ length: n }, (_, i) => ['o' + i + '@x', 10, false]);
    await clearAll();
    await seedDays('summary', now, old(150));
    // 150 summaries in lots of 50: three full lots, then one that finds nothing; the two empty
    // types one lot each, and the empty smartbar store one lot.
    assert.equal(await withBatchSize(50, () => countHolds(t, () => taStorage.deleteOlderThan(5, now))), 4 + 1 + 1 + 1);
    assert.equal(await taStorage.count('summary'), 0);
    await clearAll();
    await seedDays('summary', now, old(150));
    // 0 is not a valid size: the default, 100 (one lot of 100, one of 50).
    const holds = await withBatchSize(0, () => countHolds(t, () => taStorage.deleteOlderThan(5, now)));
    assert.equal(holds, 2 + 1 + 1 + 1);
    assert.equal(await taStorage.count('summary'), 0);
});

k.test('lots-same-result', 'in lots of 2, the cleanup removes exactly what previewCleanup() counted, for every combination of rules', async () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await withBatchSize(2, async () => {
        for (const { name, limits } of PREVIEW_CASES) {
            await seedMixed(now);
            const preview = await taStorage.previewCleanup(limits, now);
            assert.deepEqual(await taStorage.cleanup(limits, now), preview, name);
        }
    });
});

/**
 * Start a bulk removal and, while its first lot holds the lock (on that lot's targeted read of
 * the mirror keys), ask for a write of the background. The write gets the lock before the second
 * lot: it ends before the operation does. Returns the order of the two ends.
 */
async function writeDuringFirstLot(t, op, write) {
    const storageLocal = ctx.ctl.browser.storage.local;
    const realGet = storageLocal.get.bind(storageLocal);
    const ends = [];
    let writing = null;
    t.mock.method(storageLocal, 'get', (keys) => {
        if (!writing && Array.isArray(keys) && keys.length > 0) {
            writing = write().then(() => ends.push('write'));
        }
        return realGet(keys);
    });
    await op();
    ends.push('operation');
    await writing;
    t.mock.restoreAll();
    return ends;
}

k.test('write-between-lots', 'a write asked during a bulk removal runs between two lots, not after the whole operation, and keeps its record in both places', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await clearAll();
    await seedDays('translation', now, Array.from({ length: 9 }, (_, i) => ['t' + i + '@x', 10, false]));
    const st = new taStorage(false);
    const ends = await withBatchSize(2, () => writeDuringFirstLot(t,
        () => taStorage.deleteOlderThan(5, now),
        () => st.writeTranslation('t4@x', { translated_text: 'new' })));
    assert.deepEqual(ends, ['write', 'operation']);
    // t4@x was rewritten now: not older than 5 days any more, kept in both places.
    assert.deepEqual(await ids('translation'), ['t4@x']);
    assert.equal(local()['translation:t4@x'].translated_text, 'new');
});

k.test('clear-keeps-new', 'an emptying started before a write keeps the record written while it runs, in both places', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await clearAll();
    for (let i = 0; i < 7; i++) await seed('spam', 'c' + i + '@x', DATA.spam.ok, now - 1000 * (i + 1));
    const st = new taStorage(false);
    const ends = await withBatchSize(2, () => writeDuringFirstLot(t,
        () => taStorage.clearAllRecords(),
        () => { t.mock.timers.setTime(now + 5000); return st.writeSpam('during@x', { spamValue: 3 }); }));
    assert.deepEqual(ends, ['write', 'operation']);
    assert.deepEqual(await ids('spam'), ['during@x']);
    assert.deepEqual(Object.keys(local()).filter(key => key.startsWith('spam:')), ['spam:during@x']);
});

k.test('delete-errors-keeps-new', 'deleteErrors() leaves an error saved after it started', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await clearAll();
    for (let i = 0; i < 5; i++) await seed('summary', 'e' + i + '@x', DATA.summary.err, now - 1000 * (i + 1));
    const st = new taStorage(false);
    await withBatchSize(2, () => writeDuringFirstLot(t,
        () => taStorage.deleteErrors(now),
        () => { t.mock.timers.setTime(now + 5000); return st.writeSummary('late@x', { error: true, message: 'x' }); }));
    assert.deepEqual(await ids('summary'), ['late@x']);
});

k.test('lots-partial-failure', 'a failure in a later lot leaves the lots done, and the error says what was removed before it', async (t) => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    await clearAll();
    await seedDays('summary', now, Array.from({ length: 5 }, (_, i) => ['f' + i + '@x', 10, false]));
    const real = globalThis.IDBCursor.prototype.delete;
    let calls = 0;
    t.mock.method(globalThis.IDBCursor.prototype, 'delete', function (...a) {
        if (++calls === 3) throw new DOMException('disk failure', 'UnknownError');
        return real.apply(this, a);
    });
    const error = await withBatchSize(2, () => taStorage.deleteOlderThan(5, now).then(() => null, e => e));
    t.mock.restoreAll();
    assert.match(String(error), /disk failure/);
    assert.deepEqual(error.removed, { spam: 0, summary: 2, translation: 0, smartbar: 0 });
    assert.equal(await taStorage.count('summary'), 3);
});

k.test('reconcile-lots', 'the realignment reads in one hold, then puts and removes in lots; the counts are the totals', async (t) => {
    await clearAll();
    for (let i = 0; i < 5; i++) {
        await ctx.ctl.browser.storage.local.set({ ['summary:m' + i + '@x']: taStorage.buildRecord('summary', 'm' + i + '@x', { summary: 'S' }, 100 + i) });
    }
    const db = await taStorage.openDB();
    await db.put('summary', taStorage.buildRecord('summary', 'db-only@x', { summary: 'S' }, 50));
    let result;
    const holds = await withBatchSize(2, () => countHolds(t, async () => { result = await taStorage.reconcileWithMirror(); }));
    assert.equal(holds, 1 + 3, 'the read, then three lots (2 + 2 + 1 puts, the removal in the first)');
    assert.deepEqual(result.summary, { restored: 5, removed: 1 });
    assert.deepEqual(await ids('summary'), ['m0@x', 'm1@x', 'm2@x', 'm3@x', 'm4@x']);
});

k.coverage();
