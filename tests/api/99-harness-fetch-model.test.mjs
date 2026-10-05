// The harness itself, not the spec: the fetch model (fetch-model.mjs) and the worker realm
// (worker-realm.mjs). No network, ever: an unscripted call is recorded, rejected with an error
// naming its URL, and fails the guarded test at once - even when the code under test swallows
// the rejection, and even when fetchWithRetry() would otherwise retry it after a long backoff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    installFetchModel,
    NET,
    UnscriptedFetchError
} from './fetch-model.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import { jsonResponse } from './wire.mjs';

const net = installFetchModel();
test.after(() => net.restore());

test('the model is the global fetch', () => {
    assert.equal(typeof globalThis.fetch, 'function');
    assert.equal(globalThis.fetch.name, 'fetchModel');
});

test('an unscripted call is recorded and rejected, naming the URL', async () => {
    net.reset();
    await assert.rejects(fetch('https://nowhere.test/x?key=FAKE'),
        e => e instanceof UnscriptedFetchError && e.message.includes('https://nowhere.test/x'));
    assert.equal(net.violations.length, 1);
    assert.equal(net.calls.length, 1);
});

test('a call that does not match the head of the script is a violation', async () => {
    net.reset();
    net.expect('https://a.test/', () => jsonResponse({}));
    await assert.rejects(fetch('https://b.test/'), UnscriptedFetchError);
    net.reset();
});

test('guard() fails the test at once on a swallowed violation, without waiting for anything', async () => {
    const guarded = net.guard(async () => {
        try { await fetch('https://swallowed.test/'); } catch { /* the client swallows it */ }
        await new Promise(() => {});   // would hang forever (a retry backoff on real timers)
    });
    await assert.rejects(guarded({}), e => e instanceof UnscriptedFetchError);
});

test('guard() fails when a scripted answer is never consumed', async () => {
    const guarded = net.guard(async () => { net.expect('https://never.test/', () => jsonResponse({})); });
    await assert.rejects(guarded({}), /never consumed/);
});

test('guard() passes a well-scripted test', async () => {
    const guarded = net.guard(async () => {
        net.expect({ method: 'POST', url: /\/ok$/ }, () => jsonResponse({ a: 1 }));
        const r = await fetch('https://x.test/ok', { method: 'POST', body: '{"q":1}', headers: { 'X-Api-Key': 'k' } });
        assert.deepEqual(await r.json(), { a: 1 });
        assert.deepEqual(net.calls[0].json(), { q: 1 });
        assert.equal(net.calls[0].headers['x-api-key'], 'k', 'headers recorded lower-cased');
    });
    await guarded({});
});

test('an already aborted signal rejects with its reason; a hang rejects on abort', async () => {
    net.reset();
    const c1 = new AbortController();
    c1.abort(new Error('r1'));
    net.expect('https://a.test/', () => jsonResponse({}));
    await assert.rejects(fetch('https://a.test/', { signal: c1.signal }), /r1/);
    const c2 = new AbortController();
    net.expect('https://a.test/', NET.hang);
    const p = fetch('https://a.test/', { signal: c2.signal });
    c2.abort(new Error('r2'));
    await assert.rejects(p, /r2/);
    net.reset();
});

test('a scripted answer that is not a Response is a violation', async () => {
    net.reset();
    net.expect('https://a.test/', () => ({ ok: true }));
    await assert.rejects(fetch('https://a.test/'), /not a Response/);
    assert.equal(net.violations.length, 1);
    net.reset();
});

test('this level-1 process has no browser global', () => {
    assertNoBrowser();
});
