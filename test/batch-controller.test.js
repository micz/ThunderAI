/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the spam progress sessions of the batch controller
 *  (js/mzta-batch-controller.js).
 *
 *  Run with: node --test
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { taBatchController } = await import('../js/mzta-batch-controller.js');

describe('batch controller spam progress', () => {
    beforeEach(() => {
        taBatchController._cancelRequested = false;
        taBatchController._activeBatches = 0;
        taBatchController.processed = 0;
        taBatchController._spamSessions.clear();
    });

    test('a session tracks done and total independently', () => {
        const session = taBatchController.beginSpamProgress(10);
        taBatchController.spamTick(session);
        taBatchController.spamTick(session);
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 2, total: 10 });
        assert.equal(taBatchController.getStatus().spamDone, 2);
        assert.equal(taBatchController.getStatus().spamTotal, 10);
    });

    test('overlapping sessions are aggregated, not overwritten', () => {
        const big = taBatchController.beginSpamProgress(1432);
        const small = taBatchController.beginSpamProgress(1);
        for (let i = 0; i < 100; i++) taBatchController.spamTick(big);
        taBatchController.spamTick(small);
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 101, total: 1433 });
    });

    test('ending a session removes only it from the aggregate', () => {
        const a = taBatchController.beginSpamProgress(5);
        const b = taBatchController.beginSpamProgress(7);
        taBatchController.spamTick(a);
        taBatchController.endSpamProgress(a);
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 0, total: 7 });
        taBatchController.spamTick(b);
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 1, total: 7 });
    });

    test('spamTick tolerates a missing session', () => {
        assert.doesNotThrow(() => taBatchController.spamTick(null));
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 0, total: 0 });
    });

    test('endBatch no longer touches the spam sessions', () => {
        taBatchController.beginBatch();
        const session = taBatchController.beginSpamProgress(3);
        taBatchController.spamTick(session);
        taBatchController.endBatch();
        assert.deepEqual(taBatchController.getSpamProgress(), { done: 1, total: 3 });
    });
});
