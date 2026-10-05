// Spec 04, the Ollama model worker on its failure paths, one instance for the file, usage display
// OFF:
//  - "Workers and UI": Stop before the answer -> requestAborted, the message removed from the
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

await w.send(initMessage({ ollama_host: HOST, ollama_model: 'llama3.2', ollama_system_prompt: '' }, {
    chat_show_usage_data: false,
    i18nStrings: { ollama_api_request_failed: FAILED, error_connection_interrupted: 'The connection to the server was unexpectedly interrupted' },
}));

const errorOf = t => t.posted().filter(m => m.type === 'error');
const content = objs => streamResponse([objs.map(ndjson).join('')], { contentType: 'application/x-ndjson' });

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

k.test('mid-stream-error', 'an error line mid-stream: an error is posted, not flagged rateLimited', async () => {
    net.expect(CHAT, () => content([FX.content_chunks.chunks[0], FX.stream_error_line.chunk]));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.notEqual(errs[0].rateLimited, true);
});

k.test('stream-cut', 'a connection cut mid-stream: an error is posted', async () => {
    net.expect(CHAT, () => streamResponse([ndjson(FX.content_chunks.chunks[0])], { errorAfter: 1, contentType: 'application/x-ndjson' }));
    const t = startTurn(w, 'q');
    await t.done;
    assert.equal(errorOf(t).length, 1);
    assert.notEqual(errorOf(t)[0].rateLimited, true);
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

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
