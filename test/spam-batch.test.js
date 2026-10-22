/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the batched spam check helpers (js/mzta-spam-batch.js).
 *
 *  Run with: node --test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// mzta-utils.js pulls in mzta-prefs.js, which touches browser.storage at import
// time → provide a minimal stub before any module import.
globalThis.browser = {
  i18n: { getMessage: (key) => key },
  storage: {
    local: { async get() { return {}; }, async set() {}, async remove() {} },
    sync: { async get() { return {}; }, async set() {} },
    onChanged: { addListener() {} },
  },
};
const { buildSpamBatchEmailBlock, buildSpamBatchEmails, parseSpamBatchResponse, SPAM_BATCH_BODY_MAX_CHARS } =
    await import('../js/mzta-spam-batch.js');

const makeItem = (i, extra = {}) => ({
    message: { author: 'Sender ' + i + ' <sender' + i + '@example.com>', date: '2026-01-01T10:00:00Z' },
    fullMessage: { headers: { from: 'Sender ' + i + ' <sender' + i + '@example.com>', subject: 'Subject ' + i } },
    body_text: 'Body text ' + i,
    ...extra,
});

describe('buildSpamBatchEmails', () => {
    test('numbers the blocks and includes headers and body', () => {
        const out = buildSpamBatchEmails([makeItem(1), makeItem(2)]);
        assert.match(out, /### EMAIL 1/);
        assert.match(out, /### EMAIL 2/);
        assert.match(out, /From: Sender 1 <sender1@example\.com>/);
        assert.match(out, /Subject: Subject 2/);
        assert.match(out, /Body:\nBody text 2/);
    });

    test('body excerpts are truncated to SPAM_BATCH_BODY_MAX_CHARS', () => {
        const item = makeItem(1, { body_text: 'x'.repeat(SPAM_BATCH_BODY_MAX_CHARS + 5000) });
        const out = buildSpamBatchEmailBlock(item, 0);
        const body = out.split('Body:\n')[1];
        assert.equal(body.length, SPAM_BATCH_BODY_MAX_CHARS);
    });

    test('tolerates missing headers and empty bodies', () => {
        const out = buildSpamBatchEmails([{ message: {}, fullMessage: null, body_text: '' }]);
        assert.match(out, /### EMAIL 1/);
        assert.match(out, /From: /);
        assert.match(out, /Body:\n$/);
    });
});

describe('parseSpamBatchResponse', () => {
    test('parses a clean JSON response', () => {
        const map = parseSpamBatchResponse('{"results":[{"index":1,"spamValue":95,"explanation":"spam"},{"index":2,"spamValue":3,"explanation":"ham"}]}');
        assert.equal(map.get(1).spamValue, 95);
        assert.equal(map.get(1).explanation, 'spam');
        assert.equal(map.get(2).spamValue, 3);
    });

    test('extracts the JSON object from surrounding text', () => {
        const map = parseSpamBatchResponse('Here is the analysis:\n{"results":[{"index":1,"spamValue":50,"explanation":"maybe"}]}\nDone.');
        assert.equal(map.get(1).spamValue, 50);
    });

    test('clamps out-of-range spam values and rounds fractions', () => {
        const map = parseSpamBatchResponse('{"results":[{"index":1,"spamValue":250,"explanation":""},{"index":2,"spamValue":-7,"explanation":""},{"index":3,"spamValue":49.6,"explanation":""}]}');
        assert.equal(map.get(1).spamValue, 100);
        assert.equal(map.get(2).spamValue, 0);
        assert.equal(map.get(3).spamValue, 50);
    });

    test('returns null for unparsable responses', () => {
        assert.equal(parseSpamBatchResponse('I cannot analyze these emails.'), null);
        assert.equal(parseSpamBatchResponse('{"foo":1}'), null);
        assert.equal(parseSpamBatchResponse('{"results":[]}'), null);
        assert.equal(parseSpamBatchResponse(''), null);
        assert.equal(parseSpamBatchResponse(null), null);
    });

    test('skips invalid entries but keeps valid ones', () => {
        const map = parseSpamBatchResponse('{"results":[{"index":0,"spamValue":10,"explanation":""},{"index":"x","spamValue":10,"explanation":""},{"index":2,"spamValue":null,"explanation":""},{"index":3,"spamValue":88,"explanation":"ok"}]}');
        assert.equal(map.size, 1);
        assert.equal(map.get(3).spamValue, 88);
    });
});
