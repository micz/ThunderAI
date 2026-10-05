// Spec 04, the OpenAI Responses model worker on its failure paths, one instance for the file,
// usage display OFF:
//  - "Workers and UI": Stop before the answer -> requestAborted, the message removed from the
//    history; Stop once streaming -> the stopStreaming loop closes the turn;
//  - "Error contract between js/api/* and workers": the error_text forms, rateLimited (OpenAI
//    rate_limit_exceeded / insufficient_quota are 429s: true; is_exception: false), the same text
//    posted and thrown; the mid-stream error post (response.failed) does not set rateLimited.
// Inputs: fixtures/api/openai_responses.json. Realm: no browser global.

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
    jsonResponse,
    manualStream,
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('39-worker-openai-responses-errors');
const w = await loadWorker('model-worker-openai_responses');

const URL_ = 'https://api.openai.com/v1/responses';
const FX = apiFixture('openai_responses.json');
const FAILED = 'OpenAI ChatGPT API request failed';
const wire = events => events.map(e => sse(e, e.type)).join('');

await w.send(initMessage({ chatgpt_api_key: 'sk-FAKE-0000', chatgpt_model: 'gpt-4.1-nano', chatgpt_store: false },
    { chat_show_usage_data: false, i18nStrings: { chatgpt_api_request_failed: FAILED } }));

const errorOf = t => t.posted().filter(m => m.type === 'error');

k.test('abort-before-response', 'Stop before any answer: requestAborted, no error', async () => {
    net.expect(URL_, NET.hang);
    const t = startTurn(w, 'LOST QUESTION');
    await until(() => net.calls.length === 1, 'the request');
    await w.send({ type: 'stop' });
    await t.done;
    assert.ok(t.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(t), []);
});

k.test('after-abort', 'the next turn does not resend the aborted message; with the option off no usage is posted', async () => {
    net.expect(URL_, () => streamResponse([wire(FX.reasoning_item_only.events)]));
    const t = startTurn(w, 'Second question');
    await t.done;
    const sent = JSON.stringify(net.calls[0].json().input);
    assert.ok(sent.includes('Second question'));
    assert.equal(sent.includes('LOST QUESTION'), false);
    assert.equal(t.posted().some(m => m.type === 'usage'), false);
    assert.equal(shape(t.posted()).at(-1)[0], 'tokensDone');
});

k.test('stop-mid-stream', 'Stop once streaming: the stream is cancelled and the turn closes with tokensDone', async () => {
    const s = manualStream();
    net.expect(URL_, () => s.response);
    const t = startTurn(w, 'Long answer');
    const ev = FX.reasoning_stream.events;
    s.push(wire(ev.slice(0, 4)));
    await until(() => t.posted().some(m => m.type === 'newThinkingToken'), 'the first thinking token');
    await w.send({ type: 'stop' });
    s.push(wire([ev[4]]));
    await t.done;
    assert.equal(s.cancelled, true);
    const types = t.posted().map(m => m.type);
    assert.equal(types.filter(x => x === 'tokensDone').length, 1);
    assert.equal(types.at(-1), 'tokensDone');
    const thoughts = t.posted().filter(m => m.type === 'newThinkingToken').map(m => m.payload.token).join('');
    assert.equal(t.posted().at(-1).payload.thinking, thoughts);
});

k.test('http-401', 'a 401: status, statusText and the provider message in the error text', async () => {
    net.expect(URL_, () => jsonResponse(FX.error_401.body, { status: 401, statusText: 'Unauthorized' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done, e => e.message.endsWith(errorOf(t)[0].payload));
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 401 Unauthorized, Detail: Incorrect API key provided: sk-fake***********1234.'), err.payload);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('response-failed', 'response.failed mid-stream: an error carrying the provider message, not rateLimited', async () => {
    net.expect(URL_, () => streamResponse([wire(FX.failed_stream.events)]));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.ok(errs[0].payload.startsWith(FAILED), errs[0].payload);
    assert.ok(errs[0].payload.includes('The model failed to generate a response.'));
    assert.notEqual(errs[0].rateLimited, true);
});

k.test('rate-limit-429', 'a rate_limit_exceeded 429 still failing after the retries: rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(URL_, () => jsonResponse(FX.error_429_rate_limit.body, { status: 429, statusText: 'Too Many Requests' }));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    assert.equal(turn.posted().filter(m => m.type === 'newRetryAttempt').length, 5);
    assert.equal(errorOf(turn)[0].rateLimited, true);
});

k.test('insufficient-quota', 'an insufficient_quota 429: returned at once, rateLimited', async () => {
    net.expect(URL_, () => jsonResponse(FX.error_429_insufficient_quota.body, { status: 429, statusText: 'Too Many Requests' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    assert.equal(t.posted().some(m => m.type === 'newRetryAttempt'), false);
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 429 Too Many Requests, Detail: You exceeded your current quota'), err.payload);
    assert.equal(err.rateLimited, true);
});

k.test('network', 'a network failure after the retries: the exception text as is, not rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(URL_, NET.networkError('NetworkError when attempting to fetch resource.'));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('NetworkError when attempting to fetch resource.'));
    assert.match(err.payload, /OpenAI/);
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.payload.split('request failed').length - 1, 1);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
