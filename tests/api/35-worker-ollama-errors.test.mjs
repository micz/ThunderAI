// Spec 04, the Ollama model worker on its failure paths, one instance for the file, usage display
// OFF:
//  - "Workers and UI": Stop before the answer (also during the body read of a retried 429: no
//    newRetryAttempt) -> requestAborted, the message removed from the
//    history; Stop once streaming -> the stopStreaming loop closes the turn;
//  - "Error contract between js/api/* and workers": for an HTTP error, error_message extracted
//    from the JSON body, error_text = i18n + ": " + status + " " + statusText + ", Detail: " +
//    error_message [+ " " + errorDetail] - the contract exists so that no literal "undefined"
//    reaches the user; Ollama's documented error body is {"error": "<message>"};
//    is_exception -> its own text, not rateLimited; the mid-stream error posts (Ollama stream
//    errors) do not set rateLimited.
// Inputs: fixtures/api/ollama.json (docs/api.md "Errors"). Realm: no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import {
    assertNoBrowser,
    flush,
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
    ndjson,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('35-worker-ollama-errors');
const w = await loadWorker('model-worker-ollama');

const HOST = 'http://localhost:11434';
const CHAT = HOST + '/api/chat';
const FX = apiFixture('ollama.json');
const FAILED = 'Ollama API request failed';
const INTERRUPTED = 'The connection to the server was unexpectedly interrupted';

await w.send(initMessage({ ollama_host: HOST, ollama_model: 'llama3.2', ollama_system_prompt: '' }, {
    chat_show_usage_data: false,
    i18nStrings: { ollama_api_request_failed: FAILED, error_connection_interrupted: INTERRUPTED },
}));

const errorOf = t => t.posted().filter(m => m.type === 'error');
const content = objs => streamResponse([objs.map(ndjson).join('')], { contentType: 'application/x-ndjson' });
// A content line of the documented shape with a text no successful turn produces, so a partial
// answer left in the history would be recognisable.
const PARTIAL = { ...FX.content_chunks.chunks[0], message: { role: 'assistant', content: 'PARTIAL' } };

k.test('abort-before-response', 'Stop before any answer: requestAborted, no error', async () => {
    net.expect(CHAT, NET.hang);
    const t = startTurn(w, 'LOST QUESTION');
    await until(() => net.calls.length === 1, 'the request');
    await w.send({ type: 'stop' });
    await t.done;
    assert.ok(t.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(t), []);
});

k.test('abort-during-body-read', 'Stop while the body of a retried 429 is read (the 429 inspection): requestAborted, no newRetryAttempt, no error', async (t) => {
    fakeTime(t);   // no timer ever fires: the turn must end on the Stop alone
    const s = manualStream({ status: 429, contentType: 'application/json' });
    s.push('{"error": {"message": "never fini');
    net.expect(CHAT, () => s.response);
    const turn = startTurn(w, 'LOST DURING THE BODY READ');
    await until(() => net.calls.length === 1, 'the request');
    await flush();   // the response is in, its body being read
    await w.send({ type: 'stop' });
    await turn.done;
    const types = turn.posted().map(m => m.type);
    assert.ok(types.includes('requestAborted'));
    assert.equal(types.includes('newRetryAttempt'), false, 'no retry announced after Stop');
    assert.deepEqual(errorOf(turn), []);
    assert.equal(net.calls.length, 1, 'no further attempt');
    assert.equal(s.cancelled, true, 'the body was cancelled');
    // after-abort, next, checks that this message left the history too.
});

k.test('after-abort', 'the next turn does not resend the aborted message; with the option off no usage is posted', async () => {
    net.expect(CHAT, () => content([...FX.content_chunks.chunks, FX.final_chunk_with_durations.chunk]));
    const t = startTurn(w, 'Second question');
    await t.done;
    assert.deepEqual(net.calls[0].json().messages, [{ role: 'user', content: 'Second question' }]);
    assert.deepEqual(shape(t.posted()), [['newToken', 'The'], ['newToken', ' sky is blue.'], ['tokensDone', '']]);
});

k.test('stop-mid-stream', 'Stop once streaming: the stream is cancelled and the turn closes with tokensDone', async () => {
    const s = manualStream({ contentType: 'application/x-ndjson' });
    net.expect(CHAT, () => s.response);
    const t = startTurn(w, 'Long answer');
    s.push(ndjson(FX.content_chunks.chunks[0]));
    await until(() => t.posted().some(m => m.type === 'newToken'), 'the first token');
    await w.send({ type: 'stop' });
    s.push(ndjson(FX.content_chunks.chunks[1]));
    await t.done;
    assert.equal(s.cancelled, true);
    const types = t.posted().map(m => m.type);
    assert.equal(types.filter(x => x === 'tokensDone').length, 1);
    assert.equal(types.at(-1), 'tokensDone');
    assert.deepEqual(errorOf(t), []);
});

k.test('http-404-string-error', "an HTTP error with Ollama's documented body: the server's message in the detail, no \"undefined\"", async () => {
    net.expect(CHAT, () => jsonResponse(FX.error_404_model.body, { status: 404, statusText: 'Not Found' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 404 Not Found, Detail: model "llama3.9" not found, try pulling it first'), err.payload);
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.rateLimited, false);
});

k.test('mid-stream-error', "an error line mid-stream: one error with the server's message, no tokensDone, not rateLimited", async () => {
    net.expect(CHAT, () => content([PARTIAL, FX.stream_error_line.chunk]));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, FAILED + ': ' + FX.stream_error_line.chunk.error);
    assert.notEqual(errs[0].rateLimited, true);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

k.test('stream-cut', 'a connection cut mid-stream: one error, connection interrupted, no tokensDone', async () => {
    net.expect(CHAT, () => streamResponse([ndjson(PARTIAL)], { errorAfter: 1, contentType: 'application/x-ndjson' }));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, INTERRUPTED + ': Error in input stream');
    assert.notEqual(errs[0].rateLimited, true);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

k.test('network', 'a network failure after the retries: the exception text as is, not rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(CHAT, NET.networkError('NetworkError when attempting to fetch resource.'));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('NetworkError when attempting to fetch resource.'));
    assert.match(err.payload, /Ollama/);
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.payload.split('request failed').length - 1, 1);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('history-after-errors', 'failed turns leave nothing in the history: no failed question, no partial answer', async () => {
    net.expect(CHAT, () => content([...FX.content_chunks.chunks, FX.final_chunk_with_durations.chunk]));
    const t = startTurn(w, 'After the errors');
    await t.done;
    const msgs = net.calls[0].json().messages;
    assert.deepEqual(msgs.at(-1), { role: 'user', content: 'After the errors' });
    assert.equal(msgs.filter(m => m.role === 'user' && m.content === 'q').length, 0, 'no failed question resent');
    assert.equal(msgs.some(m => m.content === 'PARTIAL'), false, 'no partial answer');
    msgs.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant', 'roles alternate at ' + i));
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
