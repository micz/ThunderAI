// claude-spec/10-smartbar.md "Storage" (js/mzta-smartbar-store.js, the smartbar store of
// js/mzta-storage.js) and spec 01 "Per-Message Data Storage" for the store itself:
//  - one record per instruction, keyed by an auto-increment id, indexes messageId, sessionId,
//    createdAt, size, failed_createdAt, state, state_failed_createdAt; failed and size computed on write;
//  - the record state derived from its operations (running, pending_confirmation, error, done),
//    replaced / interrupted kept; a replaced record's unfinished operations cancelled;
//    rawResponse and answer capped;
//  - NOT mirrored: no write touches storage.local, the reconcile leaves it alone;
//  - a record removed meanwhile is not put back by a later save;
//  - the newest record of a message; the distinct recent instructions (history);
//  - at startup every running record becomes interrupted, its unfinished operations cancelled;
//  - the cleanup applies the three rules of the other types (smartbar_retention_error_days first,
//    then smartbar_retention_days, then smartbar_retention_max_records) and never removes a
//    running record, not even with clear(); previewCleanup() counts the same.

import assert from 'node:assert/strict';
import { smartbarContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/smartbar.mjs';

const DAY = 24 * 60 * 60 * 1000;
const ctx = await smartbarContext();
const { store: S, storage: { taStorage, MESSAGE_DB_NAME } } = ctx;
const k = caseTests('03-store');
// The module creates the database (with its four stores) before any raw access below.
await taStorage.getStats();

/** Every record of the smartbar store, read with the raw IndexedDB API. */
function rawAll() {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(MESSAGE_DB_NAME);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const req = db.transaction('smartbar', 'readonly').objectStore('smartbar').getAll();
            req.onsuccess = () => { db.close(); resolve(req.result); };
            req.onerror = () => { db.close(); reject(req.error); };
        };
    });
}
/** Empty the smartbar store with the raw IndexedDB API (clear() keeps the running records). */
function reset() {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(MESSAGE_DB_NAME);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('smartbar', 'readwrite');
            tx.objectStore('smartbar').clear();
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}
const localSets = since => ctx.ctl.calls.slice(since).filter(c => c.area === 'local' && (c.op === 'set' || c.op === 'remove'));
const record = (over = {}) => ({
    ...S.newRecord({ messageId: 'm@x', sessionId: 's1', groupId: 'g1', instruction: 'summarize', metadata: { subject: ['S'] } }),
    ...over,
});
const op = (state, over = {}) => ({ index: 0, id: 'summarize', params: {}, state, ...over });

k.test('new-record', 'newRecord(): state running, the reserved phase-3 fields null', () => {
    const r = S.newRecord({ messageId: 'm@x', sessionId: 's', groupId: 'g', instruction: 'tag it',
        metadata: { subject: ['S'], from: ['F'], message_date: new Date(0) }, now: 5 });
    assert.equal(r.state, 'running');
    assert.equal(r.createdAt, 5);
    assert.equal(r.source, 'bar');
    assert.equal(r.message_date, '1970-01-01T00:00:00.000Z');
    assert.deepEqual([r.answer, r.draft, r.unrecognized, r.errorType], [null, null, null, null]);
    assert.deepEqual(r.operations, []);
    assert.notEqual(S.newId(), S.newId());
});

k.test('record-operation', 'recordOperation(): a queued line is stored running; rawResponse capped', () => {
    const o = S.recordOperation({ index: 1, id: 'tag', params: { tags: ['a'] }, state: 'queued', dependsOn: [0],
        rawResponse: 'r'.repeat(S.RAW_RESPONSE_CAP + 1) });
    assert.equal(o.state, 'running');
    assert.equal(o.rawResponse.length, S.RAW_RESPONSE_CAP);
    assert.deepEqual(o.dependsOn, [0]);
    assert.equal(o.finishedAt, null);
});

k.test('derive-state', 'deriveState() from the operations; replaced and interrupted kept', () => {
    const d = (ops, over = {}) => S.deriveState(record({ operations: ops, ...over }));
    assert.equal(d([]), 'done');
    assert.equal(d([op('done'), op('running')]), 'running');
    assert.equal(d([op('error'), op('pending_confirmation')]), 'pending_confirmation');
    assert.equal(d([op('done'), op('error'), op('cancelled')]), 'error');
    assert.equal(d([op('done'), op('cancelled')]), 'done');
    assert.equal(d([], { errorType: 'json' }), 'error');
    assert.equal(d([op('running')], { state: 'replaced' }), 'replaced');
    assert.equal(d([op('running')], { state: 'interrupted' }), 'interrupted');
});

k.test('finish-caps', 'finishRecord() caps rawResponse and answer, derives the state unless keepState', () => {
    const r = record({ rawResponse: 'x'.repeat(S.RAW_RESPONSE_CAP + 9), answer: 'a'.repeat(S.ANSWER_CAP + 9),
        operations: [op('done', { rawResponse: 'y'.repeat(S.RAW_RESPONSE_CAP + 1) })] });
    const out = S.finishRecord(r);
    assert.equal(out.rawResponse.length, S.RAW_RESPONSE_CAP);
    assert.equal(out.answer.length, S.ANSWER_CAP);
    assert.equal(out.operations[0].rawResponse.length, S.RAW_RESPONSE_CAP);
    assert.equal(out.state, 'done');
    assert.equal(S.finishRecord(r, { keepState: true }).state, 'running');
});

k.test('mark-replaced', 'markReplaced(): replaced, the unfinished operations cancelled, the final ones kept', () => {
    const out = S.markReplaced(record({ operations: [op('done'), op('running'), op('pending_confirmation'), op('error')] }), 7);
    assert.equal(out.state, 'replaced');
    assert.deepEqual(out.operations.map(o => o.state), ['done', 'cancelled', 'cancelled', 'error']);
    assert.equal(out.operations[1].finishedAt, 7);
    assert.ok(S.hasErrors(out));
    assert.ok(!S.hasErrors(record()));
    assert.ok(S.hasErrors(record({ errorType: 'json' })));
});

k.test('not-mirrored', 'create / save / delete never write storage.local; failed and size computed', async () => {
    await reset();
    const since = ctx.ctl.calls.length;
    const created = await S.taSmartbarStore.create(record());
    assert.equal(typeof created.id, 'number');
    assert.equal(created.failed, 0);
    assert.ok(created.size > 0);
    const saved = await S.taSmartbarStore.save({ ...created, operations: [op('error', { error: 'x', errorType: 'api' })] });
    assert.equal(saved.state, 'error');
    assert.equal(saved.failed, 1);
    assert.deepEqual(await S.taSmartbarStore.get(created.id), saved);
    await taStorage.clear('smartbar');
    assert.deepEqual(localSets(since), []);
    assert.ok(!Object.keys(ctx.ctl.localData()).some(key => key.startsWith('smartbar')));
});

k.test('save-gone', 'a save after the record was removed does not put it back', async () => {
    await reset();
    const created = await S.taSmartbarStore.create(record({ state: 'done' }));
    await taStorage.clear('smartbar');
    assert.equal(await S.taSmartbarStore.save(created), null);
    assert.deepEqual(await rawAll(), []);
});

k.test('reconcile-ignores', 'the mirror reconcile neither removes nor reports the smartbar records', async () => {
    await reset();
    await S.taSmartbarStore.create(record());
    const counts = await taStorage.reconcileWithMirror();
    assert.ok(!('smartbar' in counts));
    assert.equal((await rawAll()).length, 1);
});

k.test('latest-and-history', 'latest(messageId) is the newest record of the message; recentInstructions() distinct, newest first', async () => {
    await reset();
    const now = Date.now();
    await S.taSmartbarStore.create(record({ instruction: 'one', createdAt: now - 3000 }));
    await S.taSmartbarStore.create(record({ messageId: 'other@x', instruction: 'two', createdAt: now - 2000 }));
    const last = await S.taSmartbarStore.create(record({ instruction: 'one', createdAt: now - 1000 }));
    await S.taSmartbarStore.create(record({ messageId: 'other@x', instruction: '  ', createdAt: now }));
    assert.equal((await S.taSmartbarStore.latest('m@x')).id, last.id);
    assert.equal(await S.taSmartbarStore.latest('none@x'), null);
    assert.equal(await S.taSmartbarStore.latest(''), null);
    assert.deepEqual(await S.taSmartbarStore.recentInstructions(5), ['one', 'two']);
    assert.deepEqual(await S.taSmartbarStore.recentInstructions(1), ['one']);
    assert.deepEqual(await S.taSmartbarStore.recentInstructions(0), []);
});

k.test('mark-interrupted', 'at startup the running records become interrupted, their unfinished operations cancelled', async () => {
    await reset();
    const running = await S.taSmartbarStore.create(record({ operations: [op('done'), op('running'), op('pending_confirmation')] }));
    const done = await S.taSmartbarStore.create(record({ state: 'done', operations: [op('done')] }));
    assert.equal(await S.taSmartbarStore.markInterrupted(), 1);
    const after = await S.taSmartbarStore.get(running.id);
    assert.equal(after.state, 'interrupted');
    assert.deepEqual(after.operations.map(o => o.state), ['done', 'cancelled', 'cancelled']);
    assert.deepEqual(await S.taSmartbarStore.get(done.id), done);
    assert.equal(await S.taSmartbarStore.markInterrupted(), 0);
});

k.test('cleanup-rules', 'the cleanup applies age and count, never removes a running record; the preview counts the same', async () => {
    await reset();
    const now = Date.now();
    const add = (age, state) => S.taSmartbarStore.create(record({ createdAt: now - age, state, instruction: state + age }));
    await add(40 * DAY, 'running');     // too old, but running: kept
    await add(40 * DAY, 'done');        // too old: removed by age
    await add(3 * DAY, 'done');         // oldest of the young ones: removed by count
    await add(2 * DAY, 'error');
    await add(1 * DAY, 'done');
    const limits = { smartbar: { maxAgeDays: 30, maxEntries: 3 } };
    const preview = await taStorage.previewCleanup(limits, now);
    const removed = await taStorage.cleanup(limits, now);
    assert.equal(removed.smartbar, 2);
    assert.equal(preview.smartbar, 2);
    assert.deepEqual((await rawAll()).map(r => r.instruction).sort(), ['done' + DAY, 'error' + 2 * DAY, 'running' + 40 * DAY].sort());
});

k.test('cleanup-errors', 'the error rule removes the errors older than its age first, never a running record', async () => {
    await reset();
    const now = Date.now();
    const failedOp = [op('error', { error: 'x', errorType: 'api' })];
    const add = (age, state, operations = []) => S.taSmartbarStore.create(record({ createdAt: now - age, state, operations, instruction: state + age }));
    await add(10 * DAY, 'error', failedOp);     // an error older than 7 days: removed
    await add(3 * DAY, 'error', failedOp);      // a young error: kept
    await add(10 * DAY, 'done');                // not an error: kept
    await add(10 * DAY, 'running', [...failedOp, op('running')]);  // holds an error, but still running: kept
    const limits = { smartbar: { errorMaxAgeDays: 7 } };
    assert.equal((await taStorage.previewCleanup(limits, now)).smartbar, 1);
    assert.equal((await taStorage.cleanup(limits, now)).smartbar, 1);
    assert.deepEqual((await rawAll()).map(r => r.instruction).sort(), ['done' + 10 * DAY, 'error' + 3 * DAY, 'running' + 10 * DAY].sort());
});

k.test('cleanup-prefs', 'the cleanup reads the three smartbar retention preferences', async () => {
    const limits = await taStorage.readLimits();
    assert.deepEqual(limits.smartbar, { maxAgeDays: 30, maxEntries: 500, errorMaxAgeDays: 7 });
    const keys = ['smartbar_retention_days', 'smartbar_retention_max_records', 'smartbar_retention_error_days'];
    await ctx.ctl.browser.storage.local.set({ smartbar_retention_days: 9, smartbar_retention_max_records: 0, smartbar_retention_error_days: 2 });
    try {
        assert.deepEqual((await taStorage.readLimits()).smartbar, { maxAgeDays: 9, maxEntries: 0, errorMaxAgeDays: 2 });
    } finally {
        await ctx.ctl.browser.storage.local.remove(keys);
    }
});

k.coverage();
