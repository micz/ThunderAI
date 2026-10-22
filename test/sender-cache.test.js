/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the sender-based result cache (js/mzta-sender-cache.js).
 *
 *  Run with: node --test
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal storage.local stub (data survives within a single test file run).
const localStore = new Map();
globalThis.browser = {
    storage: {
        local: {
            async get(defaults) {
                const out = {};
                for (const key of Object.keys(defaults)) {
                    out[key] = localStore.has(key) ? localStore.get(key) : defaults[key];
                }
                return out;
            },
            async set(obj) {
                for (const [key, value] of Object.entries(obj)) localStore.set(key, value);
            },
        },
    },
};

const { getCachedSenderData, setCachedSenderData, clearSenderCache, SENDER_CACHE_TTL_DAYS } =
    await import('../js/mzta-sender-cache.js');

describe('sender cache', () => {
    beforeEach(async () => {
        await clearSenderCache();
    });

    test('stores and returns data per sender and kind', async () => {
        await setCachedSenderData('spammer@example.com', 'spam', { spamValue: 95, explanation: 'junk' });
        const verdict = await getCachedSenderData('spammer@example.com', 'spam');
        assert.equal(verdict.spamValue, 95);
        assert.equal(verdict.explanation, 'junk');
        assert.equal(await getCachedSenderData('spammer@example.com', 'tags'), null);
        assert.equal(await getCachedSenderData('other@example.com', 'spam'), null);
    });

    test('lookups are case-insensitive', async () => {
        await setCachedSenderData('News@Example.COM', 'tags', { tags: ['newsletter'] });
        const tags = await getCachedSenderData('news@example.com', 'tags');
        assert.deepEqual(tags.tags, ['newsletter']);
    });

    test('expired entries return null', async () => {
        await setCachedSenderData('old@example.com', 'spam', { spamValue: 10, explanation: 'ok' });
        // Backdate the entry beyond the TTL.
        const store = (await browser.storage.local.get({ sender_cache: {} })).sender_cache;
        store['old@example.com'].spam.decidedAt = Date.now() - (SENDER_CACHE_TTL_DAYS + 1) * 24 * 60 * 60 * 1000;
        await browser.storage.local.set({ sender_cache: store });
        assert.equal(await getCachedSenderData('old@example.com', 'spam'), null);
    });

    test('ttl is configurable', async () => {
        await setCachedSenderData('fresh@example.com', 'spam', { spamValue: 1, explanation: 'x' });
        const store = (await browser.storage.local.get({ sender_cache: {} })).sender_cache;
        store['fresh@example.com'].spam.decidedAt = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days old
        await browser.storage.local.set({ sender_cache: store });
        assert.equal(await getCachedSenderData('fresh@example.com', 'spam', { ttl_days: 5 }), null);
        assert.ok(await getCachedSenderData('fresh@example.com', 'spam', { ttl_days: 30 }));
    });

    test('invalid input is ignored', async () => {
        await setCachedSenderData('', 'spam', { spamValue: 1 });
        await setCachedSenderData(null, 'tags', { tags: [] });
        await setCachedSenderData('x@example.com', 'spam', null);
        assert.equal((await browser.storage.local.get({ sender_cache: {} })).sender_cache['x@example.com'], undefined);
    });

    test('cache is capped to the most recent senders', async () => {
        for (let i = 0; i < 600; i++) {
            await setCachedSenderData(`user${i}@example.com`, 'spam', { spamValue: i, explanation: '' });
        }
        const cache = (await browser.storage.local.get({ sender_cache: {} })).sender_cache;
        assert.equal(Object.keys(cache).length, 500);
        assert.ok(cache['user599@example.com'], 'newest entry kept');
        assert.equal(cache['user0@example.com'], undefined, 'oldest entry pruned');
    });
});
