// Spec 04 "Automatic Retry Handling": fetchWithRetry(url, options, retryConfig) in
// js/api/api-retry.js.
//  - Retryable: RETRYABLE_STATUSES, network exceptions and per-attempt timeouts; every other
//    status is returned at once.
//  - Result: always a Response or a throw. Retries used up on a retryable status: the last
//    Response, unread. On an exception: the last error rethrown.
//  - Backoff: retryDelaysMs[attempt], the last entry reused, with jitter (random 80-100%).
//  - Retry-After replaces the backoff (delta-seconds and HTTP-date); without it, Gemini's
//    RetryInfo.retryDelay in the body is used the same way. A wait longer than retryAfterCapMs is
//    not retried: the response is returned at once with response.retryAfterMs.
//  - 429s that retrying cannot fix (classifyRateLimitBody) are returned at once, body unread.
//  - The per-attempt timeout covers the headers only: cleared as soon as fetch() resolves, so a
//    slow stream is not a timeout.
//  - A user abort is never retried, also during the backoff wait.
//  - onRetry(info) gets {attempt, maxRetries, delayMs, status, reason}, reason 'http' | 'network'
//    | 'timeout', status null for the last two.
//  - "Logging": each retry through taLogger.log(); a retried HTTP status ends with
//    " - server message: ..." and is followed by "<label> response body: <whole body>"; the
//    request URL is never logged.
// All timing on node:test mock timers (fakeTime): nothing here waits in real time.

import assert from 'node:assert/strict';
import {
    areaFile,
    consoleText,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import {
    apiFixture,
    capturedEntry,
    jsonResponse,
    manualStream,
    textResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('10-fetch-with-retry');
const { fetchWithRetry, RETRYABLE_STATUSES } = await import('../../js/api/api-retry.js');
const { taLogger } = await import('../../js/mzta-logger.js');

const URL_ = 'https://api.example.test/v1/chat';
const OK = () => jsonResponse({ ok: true });
const status = (s, body = { error: { message: 'status ' + s } }, headers = {}) => () => jsonResponse(body, { status: s, headers });

/** fetchWithRetry with onRetry recorded (with the mocked time of each call). */
function run(timers, cfg = {}) {
    const retries = [];
    const p = fetchWithRetry(URL_, { method: 'POST', body: '{}' }, {
        onRetry: info => retries.push({ ...info, at: Date.now() }),
        ...cfg,
    });
    return { retries, result: drive(p, timers) };
}

const gaps = () => net.calls.slice(1).map((c, i) => c.t - net.calls[i].t);

// ---- which failures are retried -------------------------------------------------------------

for (const s of RETRYABLE_STATUSES) {
    k.test('retry-' + s, `HTTP ${s} is retried`, async (t) => {
        const timers = fakeTime(t);
        net.expect(URL_, status(s)).expect(URL_, OK);
        const { retries, result } = run(timers);
        const r = await result;
        assert.equal(r.status, 200);
        assert.equal(net.calls.length, 2);
        assert.equal(retries.length, 1);
        assert.equal(retries[0].status, s);
        assert.equal(retries[0].reason, 'http');
    });
}

for (const s of [400, 401, 403, 404, 422]) {
    k.test('no-retry-' + s, `HTTP ${s} is returned at once, unread`, async (t) => {
        const timers = fakeTime(t);
        net.expect(URL_, status(s));
        const { retries, result } = run(timers);
        const r = await result;
        assert.equal(r.status, s);
        assert.equal(r.bodyUsed, false);
        assert.equal(net.calls.length, 1);
        assert.equal(retries.length, 0);
    });
}

k.test('network-retried', 'a network exception is retried: reason network, status null', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError()).expect(URL_, OK);
    const { retries, result } = run(timers);
    assert.equal((await result).status, 200);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].reason, 'network');
    assert.equal(retries[0].status, null);
});

k.test('network-rethrown', 'after the last attempt the last network error is rethrown', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError('first')).expect(URL_, NET.networkError('last'));
    const { result } = run(timers, { maxRetries: 1 });
    await assert.rejects(result, e => e instanceof TypeError && e.message === 'last');
    assert.equal(net.calls.length, 2);
});

k.test('timeout-retried', 'a per-attempt timeout is retried: reason timeout, status null, fired after timeoutMs', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.hang).expect(URL_, OK);
    const { retries, result } = run(timers, { timeoutMs: 60000 });
    assert.equal((await result).status, 200);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].reason, 'timeout');
    assert.equal(retries[0].status, null);
    assert.equal(retries[0].at - net.calls[0].t, 60000, 'the attempt was given exactly timeoutMs');
    assert.equal(net.calls[0].signal.aborted, true, 'the hung attempt was aborted');
});

k.test('timeout-rethrown', 'per-attempt timeouts up to the last attempt end in a throw', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.hang).expect(URL_, NET.hang);
    const { result } = run(timers, { maxRetries: 1, timeoutMs: 1000 });
    await assert.rejects(result);
    assert.equal(net.calls.length, 2);
});

// ---- the attempt limit and the result -------------------------------------------------------

k.test('limit', 'maxRetries 5: six attempts, then the last Response returned unread', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(URL_, status(503, { error: { message: 'attempt ' + (i + 1) } }));
    const { retries, result } = run(timers);
    const r = await result;
    assert.ok(r instanceof Response);
    assert.equal(r.status, 503);
    assert.equal(r.bodyUsed, false);
    assert.deepEqual(await r.json(), { error: { message: 'attempt 6' } }, 'the last one');
    assert.equal(net.calls.length, 6);
    assert.deepEqual(retries.map(x => [x.attempt, x.maxRetries]), [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
});

k.test('max-retries-0', 'maxRetries 0 (the connection test): one attempt only', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503));
    const { retries, result } = run(timers, { maxRetries: 0 });
    assert.equal((await result).status, 503);
    assert.equal(retries.length, 0);
});

// ---- backoff --------------------------------------------------------------------------------

for (const [id, random] of [['low', 0], ['high', 0.9999]]) {
    k.test('backoff-' + id, `backoff 5, 10, 20, 30, 30 s with jitter in 80-100% (Math.random ${random})`, async (t) => {
        const timers = fakeTime(t, { random });
        for (let i = 0; i < 5; i++) net.expect(URL_, status(503));
        net.expect(URL_, OK);
        const { retries, result } = run(timers);
        assert.equal((await result).status, 200);
        const bases = [5000, 10000, 20000, 30000, 30000];
        retries.forEach((r, i) => {
            assert.ok(r.delayMs >= 0.8 * bases[i] && r.delayMs <= bases[i], `retry ${i + 1}: ${r.delayMs} ms for a ${bases[i]} ms base`);
        });
        assert.deepEqual(gaps(), retries.map(r => r.delayMs), 'the wait before each attempt is the delay announced');
    });
}

k.test('backoff-custom', 'retryDelaysMs overrides the schedule, the last entry reused', async (t) => {
    const timers = fakeTime(t, { random: 0.9999 });
    for (let i = 0; i < 3; i++) net.expect(URL_, status(500));
    net.expect(URL_, OK);
    const { retries, result } = run(timers, { retryDelaysMs: [100, 200] });
    await result;
    const bases = [100, 200, 200];
    retries.forEach((r, i) => assert.ok(r.delayMs >= 0.8 * bases[i] && r.delayMs <= bases[i], `retry ${i + 1}: ${r.delayMs}`));
});

// ---- Retry-After and the body hint ----------------------------------------------------------

k.test('retry-after-delta', 'Retry-After (delta-seconds) replaces the backoff', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503, {}, { 'Retry-After': '7' })).expect(URL_, OK);
    const { retries, result } = run(timers);
    await result;
    assert.equal(retries[0].delayMs, 7000);
    assert.deepEqual(gaps(), [7000]);
});

k.test('retry-after-date', 'Retry-After (HTTP-date) replaces the backoff', async (t) => {
    const timers = fakeTime(t);
    const when = new Date(Date.now() + 12000).toUTCString();
    net.expect(URL_, status(429, {}, { 'Retry-After': when })).expect(URL_, OK);
    const { retries, result } = run(timers);
    await result;
    assert.equal(retries[0].delayMs, 12000);
});

k.test('body-hint', "without the header, Gemini's RetryInfo.retryDelay is the wait", async (t) => {
    const timers = fakeTime(t);
    const body = apiFixture('google_gemini.json').error_429_minute.body;
    net.expect(URL_, status(429, body)).expect(URL_, OK);
    const { retries, result } = run(timers);
    await result;
    assert.equal(retries[0].delayMs, 34000);
    assert.deepEqual(gaps(), [34000]);
});

k.test('header-wins', 'the Retry-After header wins over the body hint', async (t) => {
    const timers = fakeTime(t);
    const body = apiFixture('google_gemini.json').error_429_minute.body;
    net.expect(URL_, status(429, body, { 'Retry-After': '2' })).expect(URL_, OK);
    const { retries, result } = run(timers);
    await result;
    assert.equal(retries[0].delayMs, 2000);
});

k.test('over-cap', 'a wait longer than retryAfterCapMs is not retried: returned at once with retryAfterMs', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503, { error: { message: 'busy' } }, { 'Retry-After': '3600' }));
    const { retries, result } = run(timers);
    const r = await result;
    assert.equal(r.status, 503);
    assert.equal(r.retryAfterMs, 3600000);
    assert.equal(r.bodyUsed, false);
    assert.equal(net.calls.length, 1);
    assert.equal(retries.length, 0);
});

k.test('over-cap-body', 'the same for a body hint longer than the cap', async (t) => {
    const timers = fakeTime(t);
    const body = structuredClone(apiFixture('google_gemini.json').error_429_minute.body);
    body.error.details.find(d => d['@type'].endsWith('RetryInfo')).retryDelay = '120s';
    net.expect(URL_, status(429, body));
    const { retries, result } = run(timers);
    const r = await result;
    assert.equal(r.retryAfterMs, 120000);
    assert.equal(retries.length, 0);
});

k.test('at-cap', 'a wait equal to the cap is still retried', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503, {}, { 'Retry-After': '60' })).expect(URL_, OK);
    const { retries, result } = run(timers);
    assert.equal((await result).status, 200);
    assert.equal(retries[0].delayMs, 60000);
});

for (const [id, file, key] of [
    ['terminal-openai', 'openai_responses.json', 'error_429_insufficient_quota'],
    ['terminal-anthropic', 'anthropic.json', 'error_429_spend_limit'],
    ['terminal-gemini', 'google_gemini.json', 'error_429_daily'],
]) {
    k.test(id, `a 429 retrying cannot fix (${key}) is returned at once, its body unread for the worker`, async (t) => {
        const timers = fakeTime(t);
        const body = apiFixture(file)[key].body;
        net.expect(URL_, status(429, body));
        const { retries, result } = run(timers);
        const r = await result;
        assert.equal(r.status, 429);
        assert.equal(retries.length, 0);
        assert.equal(net.calls.length, 1);
        assert.deepEqual(await r.json(), body, 'the worker still reads the original body');
    });
}

k.test('unreadable-429', 'a 429 with an unreadable body is retried as before', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, () => textResponse('<html>Too Many Requests</html>', { status: 429 })).expect(URL_, OK);
    const { retries, result } = run(timers);
    assert.equal((await result).status, 200);
    assert.equal(retries.length, 1);
});

// ---- the per-attempt timeout covers the headers only ----------------------------------------

k.test('slow-stream', 'once the headers arrive a slow body is not cut by the timeout', async (t) => {
    const timers = fakeTime(t);
    const s = manualStream();
    net.expect(URL_, () => s.response);
    const r = await drive(fetchWithRetry(URL_, {}, { timeoutMs: 1000 }), timers);
    timers.tick(10000);
    assert.equal(net.calls[0].signal.aborted, false, 'the attempt signal is not aborted after 10 x timeoutMs');
    s.push('data: one\n\n');
    timers.tick(10000);
    s.push('data: two\n\n');
    s.close();
    assert.equal(await r.text(), 'data: one\n\ndata: two\n\n');
});

// ---- user abort -----------------------------------------------------------------------------

k.test('abort-before', 'an already aborted signal: no request at all, its reason propagates', async (t) => {
    const timers = fakeTime(t);
    const ctrl = new AbortController();
    const reason = new DOMException('stopped by the user', 'AbortError');
    ctrl.abort(reason);
    const { result } = run(timers, { signal: ctrl.signal });
    await assert.rejects(result, e => e === reason);
    assert.equal(net.calls.length, 0);
});

k.test('abort-during-fetch', 'an abort while waiting for the headers is not retried', async (t) => {
    const timers = fakeTime(t);
    const ctrl = new AbortController();
    const reason = new DOMException('stopped by the user', 'AbortError');
    net.expect(URL_, NET.hang);
    const retries = [];
    const p = fetchWithRetry(URL_, {}, { signal: ctrl.signal, onRetry: i => retries.push(i) });
    const settled = p.then(() => 'resolved', e => e);
    await new Promise(r => setImmediate(r));
    ctrl.abort(reason);
    assert.equal(await settled, reason);
    assert.equal(net.calls.length, 1);
    assert.equal(retries.length, 0);
    void timers;
});

k.test('abort-during-backoff', 'an abort during the backoff wait stops at once, no further attempt', async (t) => {
    fakeTime(t);
    const ctrl = new AbortController();
    const reason = new DOMException('stopped by the user', 'AbortError');
    net.expect(URL_, status(503));
    const retries = [];
    const p = fetchWithRetry(URL_, {}, { signal: ctrl.signal, onRetry: i => retries.push(i) });
    const settled = p.then(() => 'resolved', e => e);
    for (let i = 0; i < 50 && retries.length === 0; i++) await new Promise(r => setImmediate(r));
    assert.equal(retries.length, 1, 'waiting before the second attempt');
    ctrl.abort(reason);
    assert.equal(await settled, reason, 'rejected with the reason without the timer firing');
    assert.equal(net.calls.length, 1);
});

// ---- onRetry --------------------------------------------------------------------------------

k.test('on-retry-shape', 'onRetry receives exactly {attempt, maxRetries, delayMs, status, reason}', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(502)).expect(URL_, OK);
    const infos = [];
    await drive(fetchWithRetry(URL_, {}, { onRetry: i => infos.push(i), maxRetries: 3 }), timers);
    assert.equal(infos.length, 1);
    assert.deepEqual(Object.keys(infos[0]).sort(), ['attempt', 'delayMs', 'maxRetries', 'reason', 'status']);
    assert.deepEqual({ ...infos[0], delayMs: typeof infos[0].delayMs }, { attempt: 1, maxRetries: 3, delayMs: 'number', status: 502, reason: 'http' });
});

k.test('on-retry-throws', 'an onRetry that throws does not stop the retry', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503)).expect(URL_, OK);
    const r = await drive(fetchWithRetry(URL_, {}, { onRetry: () => { throw new Error('ui gone'); } }), timers);
    assert.equal(r.status, 200);
});

// ---- logging --------------------------------------------------------------------------------

const KEY = 'FAKE-GEMINI-KEY-0000';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=' + KEY;

k.test('log-server-message', 'a retried status logs " - server message: ..." and then the whole body (captured 503)', async (t) => {
    const timers = fakeTime(t);
    const body = capturedEntry('gemini-503-retry-then-stream.txt', 'response body: ');
    net.expect(GEMINI_URL, () => jsonResponse(body, { status: 503 })).expect(GEMINI_URL, OK);
    const logger = new taLogger('model-worker-google_gemini', true);
    await drive(fetchWithRetry(GEMINI_URL, {}, { logger, label: 'Google Gemini' }), timers);
    const logs = con.entries.filter(e => e.level === 'log').map(e => e.msg);
    const i = logs.findIndex(l => l.includes('Google Gemini request failed (HTTP 503)'));
    assert.ok(i >= 0, logs.join('\n'));
    assert.ok(logs[i].endsWith(' - server message: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'), logs[i]);
    assert.ok(logs[i + 1].endsWith('Google Gemini response body: ' + body), 'the next line carries the body as received');
});

k.test('log-no-url', 'the request URL (and the key in its query string) is never logged', async (t) => {
    const timers = fakeTime(t);
    net.expect(GEMINI_URL, status(503)).expect(GEMINI_URL, NET.networkError()).expect(GEMINI_URL, NET.hang)
        .expect(GEMINI_URL, status(429, apiFixture('google_gemini.json').error_429_daily.body));
    const logger = new taLogger('model-worker-google_gemini', true);
    await drive(fetchWithRetry(GEMINI_URL, {}, { logger, label: 'Google Gemini', timeoutMs: 1000 }), timers);
    const text = consoleText(con);
    assert.ok(text.length > 0, 'debug was on, something was logged');
    assert.equal(text.includes(KEY), false, 'no key');
    assert.equal(text.includes('generativelanguage.googleapis.com'), false, 'no URL');
});

k.test('log-debug-only', 'with debug off the retries log nothing through console.log', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, status(503)).expect(URL_, OK);
    await drive(fetchWithRetry(URL_, {}, { logger: new taLogger('x', false) }), timers);
    assert.deepEqual(con.entries.filter(e => e.level === 'log'), []);
});

k.coverage();
