// claude-spec/10-smartbar.md "Activity" and "Badge": what the Activity tab and the badge read
// from the smartbar store (js/mzta-smartbar-store.js over js/mzta-storage.js), and the pure rules:
//  - list(): newest first (highest id first), the records of the states asked (all when none),
//    at most `limit`, `more` when there are others, the next page after `beforeId`;
//  - byState(): the records in one state;
//  - remove(): one record, never a running one (null then, and for a record that is not there);
//  - removeErrors(): every record in error but those named (the ones the background is
//    retrying), with their { id, messageId };
//  - badgeCounts(): the running operations (the router at work as one) and the operations in
//    error (the instruction-level error as one); a pending confirmation, a dismissed error and a
//    Stop (aborted) are not counted; a record replaced, interrupted or done counts nothing;
//  - the Activity tab's default filter (pages/smartbar/mzta-smartbar-activity.js): Running when
//    something runs, else Errors when there is an error, else All.

import assert from 'node:assert/strict';
import { smartbarContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/smartbar.mjs';

const ctx = await smartbarContext();
const { store: S, storage: { taStorage, MESSAGE_DB_NAME } } = ctx;
const { defaultFilter } = await import('../../pages/smartbar/mzta-smartbar-activity.js');
const k = caseTests('07-activity');
await taStorage.getStats();

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
const record = (over = {}) => ({
    ...S.newRecord({ messageId: 'm@x', sessionId: 's1', groupId: 'g1', instruction: 'summarize' }),
    ...over,
});
/** Store records in the given states, in order (ids ascending); returns their ids. */
async function seed(states) {
    const ids = [];
    for (const [i, state] of states.entries()) {
        const r = await S.taSmartbarStore.create(record({ messageId: 'm' + i + '@x', state,
            errorType: state === 'error' ? 'api' : null }));
        ids.push(r.id);
    }
    return ids;
}

k.test('list-order', 'list(): newest first, every state when none is asked', async () => {
    await reset();
    const ids = await seed(['done', 'error', 'running', 'replaced']);
    const { records, more } = await S.taSmartbarStore.list();
    assert.deepEqual(records.map(r => r.id), [...ids].reverse());
    assert.equal(more, false);
});

k.test('list-states', 'list(): only the states asked', async () => {
    await reset();
    const ids = await seed(['done', 'error', 'running', 'error', 'pending_confirmation']);
    const errors = await S.taSmartbarStore.list({ states: ['error'] });
    assert.deepEqual(errors.records.map(r => r.id), [ids[3], ids[1]]);
    const running = await S.taSmartbarStore.list({ states: ['running', 'pending_confirmation'] });
    assert.deepEqual(running.records.map(r => r.id), [ids[4], ids[2]]);
});

k.test('list-pages', 'list(): at most `limit`, `more` when there are others, the next page after beforeId', async () => {
    await reset();
    const ids = await seed(['done', 'done', 'error', 'done', 'done']);
    const first = await S.taSmartbarStore.list({ limit: 2 });
    assert.deepEqual(first.records.map(r => r.id), [ids[4], ids[3]]);
    assert.equal(first.more, true);
    const next = await S.taSmartbarStore.list({ limit: 2, beforeId: ids[3] });
    assert.deepEqual(next.records.map(r => r.id), [ids[2], ids[1]]);
    assert.equal(next.more, true);
    const last = await S.taSmartbarStore.list({ limit: 2, beforeId: ids[1] });
    assert.deepEqual(last.records.map(r => r.id), [ids[0]]);
    assert.equal(last.more, false);
    // A filtered page counts only the records of its states.
    const done = await S.taSmartbarStore.list({ states: ['done'], limit: 4 });
    assert.equal(done.records.length, 4);
    assert.equal(done.more, false);
});

k.test('by-state', 'byState(): the records in one state', async () => {
    await reset();
    const ids = await seed(['done', 'error', 'error']);
    assert.deepEqual((await S.taSmartbarStore.byState('error')).map(r => r.id).sort(), [ids[1], ids[2]]);
    assert.deepEqual(await S.taSmartbarStore.byState('interrupted'), []);
});

k.test('remove', 'remove(): one record; a running one is kept (null), and so is a missing one', async () => {
    await reset();
    const ids = await seed(['done', 'running']);
    const removed = await S.taSmartbarStore.remove(ids[0]);
    assert.equal(removed.id, ids[0]);
    assert.equal(removed.messageId, 'm0@x');
    assert.equal(await S.taSmartbarStore.get(ids[0]), null);
    assert.equal(await S.taSmartbarStore.remove(ids[1]), null);
    assert.ok(await S.taSmartbarStore.get(ids[1]), 'a running record was removed');
    assert.equal(await S.taSmartbarStore.remove(9999), null);
});

k.test('remove-errors', 'removeErrors(): every record in error but those named; the others kept', async () => {
    await reset();
    const ids = await seed(['error', 'done', 'error', 'error', 'running']);
    const removed = await S.taSmartbarStore.removeErrors([ids[3]]);
    assert.deepEqual(removed.map(r => r.id).sort(), [ids[0], ids[2]]);
    assert.deepEqual(removed.map(r => r.messageId).sort(), ['m0@x', 'm2@x']);
    const left = (await S.taSmartbarStore.list()).records.map(r => r.id).sort();
    assert.deepEqual(left, [ids[1], ids[3], ids[4]]);
});

k.test('badge-running', 'badgeCounts(): the router at work counts as one; then each running operation', () => {
    assert.deepEqual(S.badgeCounts(record({ state: 'running' })), { running: 1, errors: 0 });
    const r = record({ state: 'running', operations: [
        { index: 0, id: 'summarize', state: 'running' },
        { index: 1, id: 'translate', state: 'running' },
        { index: 2, id: 'tag', state: 'done' },
        { index: 3, id: 'compose', state: 'pending_confirmation' },
    ] });
    assert.deepEqual(S.badgeCounts(r), { running: 2, errors: 0 });
});

k.test('badge-errors', 'badgeCounts(): the operations in error and the instruction-level error, not dismissed, not a Stop', () => {
    assert.deepEqual(S.badgeCounts(record({ state: 'error', errorType: 'json' })), { running: 0, errors: 1 });
    assert.deepEqual(S.badgeCounts(record({ state: 'error', errorType: 'json', dismissed: { error: true } })), { running: 0, errors: 0 });
    assert.deepEqual(S.badgeCounts(record({ state: 'error', errorType: 'aborted' })), { running: 0, errors: 0 });
    const r = record({ state: 'error', operations: [
        { index: 0, id: 'summarize', state: 'error', errorType: 'api' },
        { index: 1, id: 'translate', state: 'error', errorType: 'rate_limit', dismissed: true },
        { index: 2, id: 'tag', state: 'error', errorType: 'aborted' },
        { index: 3, id: 'compose', state: 'error', errorType: 'json' },
    ] });
    assert.deepEqual(S.badgeCounts(r), { running: 0, errors: 2 });
    // Running and in error at once (an instruction still at work).
    const mixed = record({ state: 'running', operations: [
        { index: 0, id: 'summarize', state: 'running' },
        { index: 1, id: 'translate', state: 'error', errorType: 'api' },
    ] });
    assert.deepEqual(S.badgeCounts(mixed), { running: 1, errors: 1 });
});

k.test('badge-history', 'badgeCounts(): a pending confirmation, a done, replaced or interrupted record counts nothing', () => {
    for (const state of ['pending_confirmation', 'done', 'replaced', 'interrupted']) {
        const r = record({ state, errorType: state === 'replaced' ? 'api' : null,
            operations: [{ index: 0, id: 'summarize', state: state === 'pending_confirmation' ? 'pending_confirmation' : 'cancelled' }] });
        assert.deepEqual(S.badgeCounts(r), { running: 0, errors: 0 }, state);
    }
    assert.deepEqual(S.badgeCounts(null), { running: 0, errors: 0 });
});

k.test('default-filter', 'the Activity tab opens on Running when something runs, else Errors when any, else All', () => {
    assert.equal(defaultFilter({ running: 1, errors: 3 }), 'running');
    assert.equal(defaultFilter({ running: 0, errors: 3 }), 'errors');
    assert.equal(defaultFilter({ running: 0, errors: 0 }), 'all');
    assert.equal(defaultFilter(undefined), 'all');
});

k.coverage();
