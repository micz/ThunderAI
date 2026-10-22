/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the spam report index and index-based truncation (js/mzta-spamreport.js).
 *
 *  Run with: node --test
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal storage stubs. mzta-storage.js talks to messenger.storage.local,
// mzta-spamreport.js to browser.storage.local/session — both share one store.
const localStore = new Map();
const sessionStore = new Map();

const localApi = {
    async get(keys) {
        const out = {};
        if (keys === null) {
            for (const [k, v] of localStore) out[k] = v;
            return out;
        }
        if (Array.isArray(keys)) {
            for (const key of keys) {
                if (localStore.has(key)) out[key] = localStore.get(key);
            }
            return out;
        }
        if (typeof keys === 'string') {
            if (localStore.has(keys)) out[keys] = localStore.get(keys);
            return out;
        }
        // Object form: stored values, falling back to the given defaults.
        for (const key of Object.keys(keys)) {
            out[key] = localStore.has(key) ? localStore.get(key) : keys[key];
        }
        return out;
    },
    async set(obj) {
        for (const [key, value] of Object.entries(obj)) localStore.set(key, value);
    },
    async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) localStore.delete(key);
    },
};

globalThis.browser = {
    storage: {
        local: localApi,
        session: {
            async get(keys) {
                const out = {};
                if (keys === null) {
                    for (const [k, v] of sessionStore) out[k] = v;
                    return out;
                }
                if (Array.isArray(keys)) {
                    for (const key of keys) {
                        if (sessionStore.has(key)) out[key] = sessionStore.get(key);
                    }
                    return out;
                }
                if (typeof keys === 'string') {
                    if (sessionStore.has(keys)) out[keys] = sessionStore.get(keys);
                    return out;
                }
                for (const key of Object.keys(keys)) {
                    out[key] = sessionStore.has(key) ? sessionStore.get(key) : keys[key];
                }
                return out;
            },
            async set(obj) {
                for (const [key, value] of Object.entries(obj)) sessionStore.set(key, value);
            },
            async remove(keys) {
                for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key);
            },
        },
    },
};
globalThis.messenger = { storage: { local: localApi } };

const { taSpamReport } = await import('../js/mzta-spamreport.js');
const { taStorage } = await import('../js/mzta-storage.js');

const report = new taSpamReport(false);
const INDEX_KEY = 'spam_index';

const makeReportData = (id, spamValue = 50) => ({
    report_date: new Date(),
    headerMessageId: id,
    spamValue,
    explanation: 'test',
    subject: 'Sub',
    from: ['a@example.com'],
    message_date: new Date(),
    moved: false,
    SpamThreshold: 70,
});

describe('spam report index', () => {
    beforeEach(() => {
        localStore.clear();
        sessionStore.clear();
    });

    test('saveReportData maintains the index and loadReportData round-trips', async () => {
        await report.saveReportData(makeReportData('id-1'), 'id-1');
        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        assert.ok(index['id-1'] > 0, 'index entry written');
        const loaded = await report.loadReportData('id-1');
        assert.equal(loaded.spamValue, 50);
        assert.equal(loaded.headerMessageId, 'id-1');
    });

    test('truncReportData does nothing while below the limit', async () => {
        report._max_reports = 5;
        for (let i = 0; i < 5; i++) {
            await report.saveReportData(makeReportData('id-' + i), 'id-' + i);
        }
        await report.truncReportData();
        const all = await report.getAllReportData();
        assert.equal(Object.keys(all).length, 5);
    });

    test('truncReportData deletes the oldest reports and prunes the index', async () => {
        report._max_reports = 3;
        for (let i = 0; i < 5; i++) {
            await report.saveReportData(makeReportData('id-' + i), 'id-' + i);
        }
        // Make the ordering deterministic regardless of save timing.
        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        Object.keys(index).forEach((id, i) => { index[id] = 1000 + i; });
        await browser.storage.local.set({ [INDEX_KEY]: index });

        await report.truncReportData();

        const all = await report.getAllReportData();
        assert.deepEqual(Object.keys(all).sort(), ['id-2', 'id-3', 'id-4'], 'newest kept');
        const prunedIndex = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        assert.deepEqual(Object.keys(prunedIndex).sort(), ['id-2', 'id-3', 'id-4'], 'index pruned');
        // The record of a deleted report is gone entirely when nothing else remains.
        assert.equal(await report.loadReportData('id-0'), null);
    });

    test('truncReportData keeps records that also hold other fields', async () => {
        report._max_reports = 1;
        await report.saveReportData(makeReportData('id-a'), 'id-a');
        await report.saveReportData(makeReportData('id-b'), 'id-b');
        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        index['id-a'] = 1;   // oldest
        index['id-b'] = 2;
        await browser.storage.local.set({ [INDEX_KEY]: index });
        // id-a also carries a summary — the record must survive the truncation.
        await messenger.storage.local.set({
            ['msg:id-a']: { v: 1, ts: 1, spam: { spamValue: 1, ts: 1 }, summary: { summary: 'text', ts: 1 } },
        });

        await report.truncReportData();

        const record = await (new taStorage(false)).getRecord('id-a');
        assert.equal(record.spam, undefined, 'spam field removed');
        assert.equal(record.summary.summary, 'text', 'summary field kept');
        assert.equal(await report.loadReportData('id-b').then(r => r.spamValue), 50, 'newest kept');
    });

    test('truncReportData seeds the index from a store without one', async () => {
        report._max_reports = 1;
        const storage = new taStorage(false);
        // Raw records written before the index existed.
        await browser.storage.local.set({
            'msg:old-1': { v: 1, ts: 1, spam: { spamValue: 10, ts: 1 } },
            'msg:old-2': { v: 1, ts: 2, spam: { spamValue: 20, ts: 2 } },
            unrelated_key: { not: 'a record' },
        });

        await report.truncReportData();

        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        assert.deepEqual(Object.keys(index).sort(), ['old-2'], 'oldest truncated, index seeded');
        assert.equal(await storage.getRecord('old-1'), null);
        assert.notEqual(await storage.getRecord('old-2'), null);
    });

    test('removeReportData drops the record and the index entry', async () => {
        await report.saveReportData(makeReportData('id-1'), 'id-1');
        await report.removeReportData('id-1');
        assert.equal(await report.loadReportData('id-1'), null);
        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        assert.equal(index['id-1'], undefined);
    });

    test('clearReportData empties records and resets the index', async () => {
        await report.saveReportData(makeReportData('id-1'), 'id-1');
        await report.saveReportData(makeReportData('id-2'), 'id-2');
        await report.clearReportData();
        const all = await report.getAllReportData();
        assert.equal(Object.keys(all).length, 0);
        const index = (await browser.storage.local.get({ [INDEX_KEY]: {} }))[INDEX_KEY];
        assert.deepEqual(index, {});
    });
});
