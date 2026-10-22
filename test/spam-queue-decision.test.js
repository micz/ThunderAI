/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the batch queue decision (js/mzta-spam-batch.js).
 *
 *  Run with: node --test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { spamQueueDecision } = await import('../js/mzta-spam-batch.js');

const decide = (overrides = {}) => spamQueueDecision({
    existingReport: null,
    cachedSpam: null,
    senderCacheEnabled: true,
    senderEmail: 'sender@example.com',
    ...overrides,
});

describe('spam queue decision', () => {
    test('a mail without verdict and cache is queued for the AI', () => {
        assert.equal(decide(), 'queue');
    });

    test('a stored verdict skips the mail', () => {
        assert.equal(decide({ existingReport: { spamValue: 85, explanation: 'junk' } }), 'skip');
    });

    test('a stored "not spam" verdict (0) also skips the mail', () => {
        assert.equal(decide({ existingReport: { spamValue: 0, explanation: 'ok' } }), 'skip');
    });

    test('an error report (spamValue < 0) does not skip the mail', () => {
        assert.equal(decide({ existingReport: { spamValue: -999, explanation: 'boom' } }), 'queue');
    });

    test('a cached sender verdict is applied without an AI call', () => {
        assert.equal(decide({ cachedSpam: { spamValue: 90, explanation: 'cached' } }), 'cached');
    });

    test('a cache hit is ignored when the sender cache is disabled', () => {
        assert.equal(decide({ cachedSpam: { spamValue: 90 }, senderCacheEnabled: false }), 'queue');
    });

    test('a cache hit is ignored without a sender address', () => {
        assert.equal(decide({ cachedSpam: { spamValue: 90 }, senderEmail: '' }), 'queue');
    });

    test('a stored verdict wins over a cache hit', () => {
        assert.equal(decide({ existingReport: { spamValue: 10 }, cachedSpam: { spamValue: 90 } }), 'skip');
    });

    test('an error report loses against a cache hit', () => {
        assert.equal(decide({ existingReport: { spamValue: -999 }, cachedSpam: { spamValue: 90 } }), 'cached');
    });
});
