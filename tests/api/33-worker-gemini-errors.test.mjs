// Spec 04, the Google Gemini model worker on its failure paths, one instance for the file, usage
// display OFF:
//  - "Workers and UI": Stop before the answer -> requestAborted, the unanswered message removed
//    from the history; Stop once streaming -> the stopStreaming loop closes the turn;
//  - "Error contract between js/api/* and workers": the error_text forms, rateLimited (a 429 -
//    Gemini RESOURCE_EXHAUSTED - true; 503 after the retries false; is_exception false),
//    retryAfterMs, the same text posted and thrown;
//  - "Automatic Retry Handling": a daily-quota 429 is returned at once, no retry.
// Inputs: the captured 503 body (captured/gemini-503-retry-then-stream.txt) and the documented
// error bodies of fixtures/api/google_gemini.json. Realm: worker-realm.mjs - no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import {
    assertNoBrowser,
    initMessage,
    loadWorker,
    shape,
    startTurn,
    until
} from './worker-realm.mjs';
import {
    apiFixture,
    capturedEntry,
    jsonResponse,
    manualStream,
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('33-worker-gemini-errors');
const w = await loadWorker('model-worker-google_gemini');

const FX = apiFixture('google_gemini.json');
const FAILED = 'Google Gemini API request failed';
const isStream = c => c.url.includes(':streamGenerateContent');

await w.send(initMessage({ google_gemini_api_key: 'FAKE-KEY', google_gemini_model: 'gemini-2.5-flash' },
    { chat_show_usage_data: false, i18nStrings: { google_gemini_api_request_failed: FAILED } }));

const errorOf = t => t.posted().filter(m => m.type === 'error');

k.test('abort-before-response', 'Stop before any answer: requestAborted, no error', async () => {
    net.expect(isStream, NET.hang);
    const t = startTurn(w, 'LOST QUESTION');
    await until(() => net.calls.length === 1, 'the request');
    await w.send({ type: 'stop' });
    await t.done;
    assert.ok(t.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(t), []);
});

k.test('after-abort', 'the next turn does not resend the aborted message; with the option off no usage is posted', async () => {
    net.expect(isStream, () => streamResponse(FX.stream_thoughts.chunks.map(c => sse(c))));
    const t = startTurn(w, 'Second question');
    await t.done;
    assert.deepEqual(net.calls[0].json().contents, [{ role: 'user', parts: [{ text: 'Second question' }] }]);
    assert.equal(t.posted().some(m => m.type === 'usage'), false);
    assert.equal(shape(t.posted()).at(-1)[0], 'tokensDone');
});

k.test('stop-mid-stream', 'Stop once streaming: the stream is cancelled and the turn closes with tokensDone', async () => {
    const s = manualStream();
    net.expect(isStream, () => s.response);
    const t = startTurn(w, 'Long answer');
    const [c0, c1, c2] = FX.stream_thoughts.chunks;
    s.push(sse(c0) + sse(c1));
    await until(() => t.posted().some(m => m.type === 'newToken'), 'the first token');
    await w.send({ type: 'stop' });
    s.push(sse(c2));
    await t.done;
    assert.equal(s.cancelled, true);
    const types = t.posted().map(m => m.type);
    assert.equal(types.filter(x => x === 'tokensDone').length, 1);
    assert.equal(types.at(-1), 'tokensDone');
    const done = t.posted().at(-1);
    const thoughts = t.posted().filter(m => m.type === 'newThinkingToken').map(m => m.payload.token).join('');
    assert.equal(done.payload.thinking, thoughts, 'tokensDone carries the thinking received so far');
});

k.test('http-400', 'a 400: status, statusText and the provider message in the error text', async () => {
    net.expect(isStream, () => jsonResponse(FX.error_400_key.body, { status: 400, statusText: 'Bad Request' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done, e => e.message.endsWith(errorOf(t)[0].payload));
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 400 Bad Request, Detail: API key not valid. Please pass a valid API key.'), err.payload);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('daily-quota', 'a daily-quota 429: returned at once (no retry), rateLimited', async () => {
    net.expect(isStream, () => jsonResponse(FX.error_429_daily.body, { status: 429, statusText: 'Too Many Requests' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    assert.equal(t.posted().some(m => m.type === 'newRetryAttempt'), false);
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 429 Too Many Requests, Detail: You exceeded your current quota'), err.payload);
    assert.equal(err.rateLimited, true);
    assert.equal(err.retryAfterMs, null);
});

k.test('overloaded-captured', 'the captured 503 still failing after the retries: not rateLimited', async (t) => {
    const timers = fakeTime(t);
    const body = capturedEntry('gemini-503-retry-then-stream.txt', 'response body: ');
    for (let i = 0; i < 6; i++) net.expect(isStream, () => jsonResponse(body, { status: 503, statusText: 'Service Unavailable' }));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    assert.equal(turn.posted().filter(m => m.type === 'newRetryAttempt').length, 5);
    const [err] = errorOf(turn);
    assert.ok(err.payload.startsWith(FAILED + ': 503 Service Unavailable, Detail: This model is currently experiencing high demand.'), err.payload);
    assert.equal(err.rateLimited, false);
});

k.test('network', 'a network failure after the retries: the exception text as is, not rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(isStream, NET.networkError('NetworkError when attempting to fetch resource.'));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('NetworkError when attempting to fetch resource.'));
    assert.match(err.payload, /Gemini/);
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.payload.split('request failed').length - 1, 1);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
