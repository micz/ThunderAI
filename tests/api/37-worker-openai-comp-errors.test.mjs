// Spec 04, the OpenAI-compatible model worker on its failure paths, one instance for the file,
// usage display OFF:
//  - "Workers and UI": Stop before the answer -> requestAborted, the message removed from the
//    history; Stop once streaming -> the stopStreaming loop closes the turn;
//  - "Error contract between js/api/* and workers": the error_text forms, rateLimited (an
//    insufficient_quota 429, returned at once, is rateLimited; is_exception is not), the same
//    text posted and thrown.
// Inputs: fixtures/api/openai_comp.json and the OpenAI error bodies compatible servers return
// (fixtures/api/openai_responses.json). Realm: no browser global.

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
const { k, net } = areaFile('37-worker-openai-comp-errors');
const w = await loadWorker('model-worker-openai_comp');

const HOST = 'http://localhost:1234';
const CHAT = HOST + '/v1/chat/completions';
const FX = apiFixture('openai_comp.json');
const OA = apiFixture('openai_responses.json');
const FAILED = 'OpenAI Comp API request failed';
const INTERRUPTED = 'The connection to the server was unexpectedly interrupted';
const DONE = 'data: [DONE]\n\n';

await w.send(initMessage({ openai_comp_host: HOST, openai_comp_model: 'local-model', openai_comp_api_key: '', openai_comp_use_v1: true },
    { chat_show_usage_data: false, i18nStrings: { OpenAIComp_api_request_failed: FAILED, error_connection_interrupted: INTERRUPTED } }));

const errorOf = t => t.posted().filter(m => m.type === 'error');

k.test('abort-before-response', 'Stop before any answer: requestAborted, no error', async () => {
    net.expect(CHAT, NET.hang);
    const t = startTurn(w, 'LOST QUESTION');
    await until(() => net.calls.length === 1, 'the request');
    await w.send({ type: 'stop' });
    await t.done;
    assert.ok(t.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(t), []);
});

k.test('after-abort', 'the next turn does not resend the aborted message; with the option off no usage is posted', async () => {
    net.expect(CHAT, () => streamResponse([FX.deepseek_reasoner_stream.chunks.map(c => sse(c)).join('') + DONE]));
    const t = startTurn(w, 'Second question');
    await t.done;
    assert.deepEqual(net.calls[0].json().messages, [{ role: 'user', content: 'Second question' }]);
    assert.equal(t.posted().some(m => m.type === 'usage'), false, 'the usage frame was there, the option is off');
    assert.equal(shape(t.posted()).at(-1)[0], 'tokensDone');
});

k.test('stop-mid-stream', 'Stop once streaming: the stream is cancelled and the turn closes with tokensDone', async () => {
    const s = manualStream();
    net.expect(CHAT, () => s.response);
    const t = startTurn(w, 'Long answer');
    const [c0, c1] = FX.plain_stream_no_usage.chunks;
    s.push(sse(c0));
    await until(() => t.posted().some(m => m.type === 'newToken'), 'the first token');
    await w.send({ type: 'stop' });
    s.push(sse(c1));
    await t.done;
    assert.equal(s.cancelled, true);
    const types = t.posted().map(m => m.type);
    assert.equal(types.filter(x => x === 'tokensDone').length, 1);
    assert.equal(types.at(-1), 'tokensDone');
});

k.test('http-401', 'a 401: status, statusText and the provider message in the error text', async () => {
    net.expect(CHAT, () => jsonResponse(FX.error_401.body, { status: 401, statusText: 'Unauthorized' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done, e => e.message.endsWith(errorOf(t)[0].payload));
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 401 Unauthorized, Detail: Incorrect API key provided: sk-fake***********1234.'), err.payload);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('insufficient-quota', 'an insufficient_quota 429: returned at once, rateLimited', async () => {
    net.expect(CHAT, () => jsonResponse(OA.error_429_insufficient_quota.body, { status: 429, statusText: 'Too Many Requests' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    assert.equal(t.posted().some(m => m.type === 'newRetryAttempt'), false);
    assert.equal(errorOf(t)[0].rateLimited, true);
});

k.test('network', 'a network failure after the retries: the exception text as is, not rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(CHAT, NET.networkError('NetworkError when attempting to fetch resource.'));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('NetworkError when attempting to fetch resource.'));
    assert.match(err.payload, /OpenAI Comp/);
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.payload.split('request failed').length - 1, 1);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('stream-cut', 'a connection cut mid-stream: one error, connection interrupted, no tokensDone', async () => {
    const partial = FX.deepseek_reasoner_stream.chunks.slice(0, 4);      // reasoning, then the content "Hi"
    net.expect(CHAT, () => streamResponse([partial.map(c => sse(c)).join('')], { errorAfter: 1 }));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, INTERRUPTED + ': Error in input stream');
    assert.notEqual(errs[0].rateLimited, true);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

k.test('history-after-errors', 'failed turns leave nothing in the history: no failed question, no partial answer', async () => {
    net.expect(CHAT, () => streamResponse([FX.plain_stream_no_usage.chunks.map(c => sse(c)).join('') + DONE]));
    const t = startTurn(w, 'After the errors');
    await t.done;
    const msgs = net.calls[0].json().messages;
    assert.deepEqual(msgs.at(-1), { role: 'user', content: 'After the errors' });
    assert.equal(msgs.filter(m => m.role === 'user' && m.content === 'q').length, 0, 'no failed question resent');
    assert.equal(msgs.some(m => m.role === 'assistant' && m.content === 'Hi'), false, 'no partial answer');
    msgs.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant', 'roles alternate at ' + i));
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
