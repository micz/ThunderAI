// Spec 01 "Batch cancellation (taBatchController)" and spec 04 "Batch cancellation (user-triggered
// stop)", the controller itself (js/mzta-batch-controller.js):
//  - beginBatch() returns the batch's token {cancelled}, kept in a set of active batches;
//    endBatch(batch) removes it. The notice state and `processed` are reset only when the LAST
//    active batch exits;
//  - requestCancel(reason = 'user', retryAfterMs = null) flags every batch active at that moment;
//    a batch begun after the request is not affected; isCancelled(batch) reads one batch's flag;
//  - retryAfterMs: the longest one kept; a 'rate_limit' reason is never overwritten by a later
//    'user' one;
//  - tick() / processed: the "N processed" counter;
//  - isWorking() / getStatus(): {working, processed, cancelRequested, cancelReason};
//    cancelRequested is true only when every active batch is cancelled;
//  - endBatch() returns {lastExit, cancelled, processed, reason, retryAfterMs}, a snapshot taken
//    before the reset;
//  - isWorking() tracks its own active batches, NOT taWorkingStatus.WorkingLevel.
// One file, one context: the scenario runs in order and every batch begun is ended.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

await moduleContext();
const { taBatchController: bc } = await import('../../js/mzta-batch-controller.js');
const { taWorkingStatus } = await import('../../js/mzta-working-status.js');
const k = caseTests('02-batch-controller');

k.test('idle', 'with no batch: not working, nothing processed, no cancel requested', () => {
    assert.equal(bc.isWorking(), false);
    assert.deepEqual(bc.getStatus(), { working: false, processed: 0, cancelRequested: false, cancelReason: null });
});

k.test('token', 'beginBatch() returns a token that is not cancelled, and the controller is working', () => {
    const b = bc.beginBatch();
    assert.equal(b.cancelled, false);
    assert.equal(bc.isCancelled(b), false);
    assert.equal(bc.isWorking(), true);
    const r = bc.endBatch(b);
    assert.deepEqual(r, { lastExit: true, cancelled: false, processed: 0, reason: null, retryAfterMs: null });
    assert.equal(bc.isWorking(), false);
});

k.test('tick-and-reset', 'tick() counts; endBatch() of the last batch returns the count taken before the reset, then resets it', () => {
    const b = bc.beginBatch();
    bc.tick(); bc.tick(); bc.tick();
    assert.equal(bc.getStatus().processed, 3);
    const r = bc.endBatch(b);
    assert.equal(r.processed, 3, 'the snapshot holds the count');
    assert.equal(bc.getStatus().processed, 0, 'and the counter is reset on the last exit');
});

k.test('cancel-flags-active', 'requestCancel() flags every batch active at that moment', () => {
    const a = bc.beginBatch();
    const b = bc.beginBatch();
    bc.requestCancel();
    assert.equal(bc.isCancelled(a), true);
    assert.equal(bc.isCancelled(b), true);
    assert.deepEqual(bc.getStatus(), { working: true, processed: 0, cancelRequested: true, cancelReason: 'user' });
    const ra = bc.endBatch(a);
    assert.equal(ra.lastExit, false, 'b is still active');
    assert.equal(ra.cancelled, true);
    const rb = bc.endBatch(b);
    assert.deepEqual(rb, { lastExit: true, cancelled: true, processed: 0, reason: 'user', retryAfterMs: null });
    assert.deepEqual(bc.getStatus(), { working: false, processed: 0, cancelRequested: false, cancelReason: null }, 'reset on the last exit');
});

k.test('later-batch-unaffected', 'a batch begun after the cancel request is not cancelled by it', () => {
    const old = bc.beginBatch();
    bc.requestCancel();
    const fresh = bc.beginBatch();
    assert.equal(bc.isCancelled(old), true);
    assert.equal(bc.isCancelled(fresh), false, 'a manual action started while a stopped batch winds down still runs');
    assert.equal(bc.getStatus().cancelRequested, false, 'not every active batch is stopping: Stop is still offered');
    bc.endBatch(old);
    const r = bc.endBatch(fresh);
    assert.equal(r.lastExit, true);
    assert.equal(bc.isCancelled(fresh), false);
});

k.test('overlap-one-notice', 'overlapping batches: the processed count spans them and only the last exit reports lastExit', () => {
    const a = bc.beginBatch();
    const b = bc.beginBatch();
    bc.tick();
    bc.tick();
    bc.requestCancel();
    const ra = bc.endBatch(a);
    assert.equal(ra.lastExit, false);
    assert.equal(bc.getStatus().processed, 2, 'not reset while b runs');
    const rb = bc.endBatch(b);
    assert.equal(rb.lastExit, true);
    assert.equal(rb.processed, 2);
    assert.equal(rb.cancelled, true);
});

k.test('cancel-does-not-leak', 'a cancel never leaks into a batch that starts after the last exit', () => {
    const a = bc.beginBatch();
    bc.requestCancel('rate_limit', 5000);
    bc.endBatch(a);
    const b = bc.beginBatch();
    assert.equal(bc.isCancelled(b), false);
    const r = bc.endBatch(b);
    assert.deepEqual(r, { lastExit: true, cancelled: false, processed: 0, reason: null, retryAfterMs: null });
});

k.test('rate-limit-wins', "a 'rate_limit' reason is never overwritten by a later 'user' one", () => {
    const a = bc.beginBatch();
    bc.requestCancel('rate_limit');
    bc.requestCancel('user');
    assert.equal(bc.getStatus().cancelReason, 'rate_limit');
    assert.equal(bc.endBatch(a).reason, 'rate_limit');
});

k.test('retry-after-longest', 'retryAfterMs: the longest wait asked for is kept', () => {
    const a = bc.beginBatch();
    bc.requestCancel('rate_limit', 60000);
    bc.requestCancel('rate_limit', 3600000);
    bc.requestCancel('rate_limit', 1000);
    bc.requestCancel('rate_limit', null);
    assert.equal(bc.endBatch(a).retryAfterMs, 3600000);
});

k.test('retry-after-none', 'with no wait given, retryAfterMs stays null', () => {
    const a = bc.beginBatch();
    bc.requestCancel('rate_limit');
    bc.requestCancel('rate_limit', NaN);
    assert.equal(bc.endBatch(a).retryAfterMs, null);
});

k.test('cancel-without-batch', 'a cancel with no active batch flags nothing: the next batch runs', () => {
    bc.requestCancel();
    const a = bc.beginBatch();
    assert.equal(bc.isCancelled(a), false);
    bc.endBatch(a);
});

k.test('is-cancelled-no-token', 'isCancelled() of no token is false', () => {
    assert.equal(bc.isCancelled(undefined), false);
    assert.equal(bc.isCancelled(null), false);
});

k.test('not-working-level', 'isWorking() follows the batches, not taWorkingStatus.WorkingLevel', () => {
    taWorkingStatus.startWorking();
    assert.equal(bc.isWorking(), false, 'a standalone AI call is not a batch: no Stop button');
    taWorkingStatus.stopWorking();
    const a = bc.beginBatch();
    assert.equal(taWorkingStatus.WorkingLevel, 0);
    assert.equal(bc.isWorking(), true);
    bc.endBatch(a);
});

k.coverage();
