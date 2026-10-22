// Spec 04, the Google Gemini model worker (js/workers/model-worker-google_gemini.js), one instance
// for the file:
//  - "Web Worker Pattern": init maps the google_gemini_* fields into the client;
//  - "Thinking output in the webchat UI": ALL parts[] are iterated, a part with thought === true
//    is a newThinkingToken (a thought part may come first, it is never mixed into the answer);
//  - "Per-provider support" (google_gemini): usageMetadata is cumulative, the last non-empty one
//    replaces the previous; it can ride on a chunk with no candidates, so it is read before the
//    candidates guard; output = candidates + thoughts;
//  - "Emitting to the chat window": usage immediately before tokensDone, one id per response;
//  - "Workers and UI": a retried status is forwarded as newRetryAttempt;
//  - "Logging": the key is in the request URL, and neither the key nor the URL is logged.
// Turn 1 replays the CAPTURE captured/gemini-503-retry-then-stream.txt: the 503 with its body,
// then the four SSE data lines as Gemini sent them. Turn 2 uses the documented thought parts
// (fixtures/api/google_gemini.json). CRLF line endings, as SSE allows. Realm: worker-realm.mjs -
// no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    consoleText,
    drive,
    fakeTime
} from './harness.mjs';
import {
    assertNoBrowser,
    initMessage,
    loadWorker,
    shape,
    startTurn
} from './worker-realm.mjs';
import {
    apiFixture,
    capturedEntry,
    capturedLines,
    cutAt,
    jsonResponse,
    sse,
    splitInsideChar,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('32-worker-gemini-stream');
const w = await loadWorker('model-worker-google_gemini');

const KEY = 'FAKE-GEMINI-WORKER-KEY-0000';
const CAPTURE = 'gemini-503-retry-then-stream.txt';
const FX = apiFixture('google_gemini.json');
const isStream = c => c.url.includes(':streamGenerateContent');
const crlf = s => sse(s, null, '\r\n');

await w.send(initMessage({
    google_gemini_api_key: KEY,
    google_gemini_model: 'gemini-flash-latest',
    google_gemini_system_instruction: '',
    google_gemini_thinking_budget: '1024',
    google_gemini_temperature: '',
    google_gemini_max_output_tokens: 0,
}, { do_debug: true, chat_show_usage_data: true, i18nStrings: { google_gemini_api_request_failed: 'Google Gemini API request failed' } }));

const usageTokens = u => ({ input: u.input_tokens, output: u.output_tokens, total: u.total_tokens, cached: u.cached_input_tokens, reasoning: u.reasoning_tokens });
const ANSWER_1 = 'Cortesia: 98%\nCalore: 45%\nFormalità: 95%\nAssertività: 40%\nOffensività: 0%';

k.test('turn1-captured', 'turn 1 (captured): the 503 is retried and forwarded, then the answer tokens, usage, tokensDone', async (t) => {
    const timers = fakeTime(t);
    const body = capturedEntry(CAPTURE, 'response body: ');
    const lines = capturedLines(CAPTURE);
    assert.equal(lines.length, 4);
    const text = lines.map(crlf).join('');
    const chunks = cutAt(text, Math.floor(lines[0].length / 2), crlf(lines[0]).length + 3);
    net.expect(isStream, () => jsonResponse(body, { status: 503, statusText: 'Service Unavailable' }))
        .expect(isStream, () => streamResponse(chunks));
    const turn = startTurn(w, 'Classify this text');
    await drive(turn.done, timers);
    assert.deepEqual(shape(turn.posted()), [
        ['newRetryAttempt', 503],
        ['newToken', 'Cortesia: 98%\nCalore: '],
        ['newToken', '45%\nFormalità: 95%\nAssertività: 40%\nOffensività:'],
        ['newToken', ' 0%'],
        ['usage', 'msg_1'],
        ['tokensDone', ''],
    ]);
    const retry = turn.posted().find(m => m.type === 'newRetryAttempt').payload;
    assert.equal(retry.reason, 'http');
    assert.equal(retry.attempt, 1);
    // The last chunk: 321 prompt, 39 candidates + 597 thoughts, 957 total, no cache reported.
    assert.deepEqual(usageTokens(turn.posted().find(m => m.type === 'usage').payload),
        { input: 321, output: 636, total: 957, cached: null, reasoning: 597 });
    const logs = consoleText(con);
    assert.ok(logs.includes('server message: This model is currently experiencing high demand.'), 'the retry was logged (debug on)');
    assert.equal(logs.includes(KEY), false, 'no key in the console');
    assert.equal(logs.includes('generativelanguage.googleapis.com'), false, 'no request URL in the console');
});

k.test('turn2-thoughts', 'turn 2: thought parts first, a thought and an answer part in one chunk, usage from a chunk without candidates', async () => {
    const chunks = [...FX.stream_thoughts.chunks, FX.usage_only_chunk.chunk].map(crlf);
    const all = chunks.join('');
    net.expect(isStream, () => streamResponse(cutAt(all, 40, chunks[0].length + chunks[1].length + 10)));
    const t = startTurn(w, 'Say hello');
    await t.done;
    const req = net.calls[0];
    const u = new URL(req.url);
    assert.equal(u.searchParams.get('key'), KEY, 'google_gemini_api_key reached the client');
    assert.ok(u.pathname.endsWith('/models/gemini-flash-latest:streamGenerateContent'), 'google_gemini_model too, streaming on');
    const body = req.json();
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 1024, includeThoughts: true });
    assert.deepEqual(body.contents, [
        { role: 'user', parts: [{ text: 'Classify this text' }] },
        { role: 'model', parts: [{ text: ANSWER_1 }] },
        { role: 'user', parts: [{ text: 'Say hello' }] },
    ], 'the whole history, answer text only');
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', '**Planning the answer**\nThe user asks for a greeting.'],
        ['newThinkingToken', ' Keeping it short.'],
        ['newToken', 'Hello'],
        ['newToken', ' there!'],
        ['usage', 'msg_2'],
        ['tokensDone', '**Planning the answer**\nThe user asks for a greeting. Keeping it short.'],
    ]);
    // The usage-only chunk came last and replaces the cumulative value: 12 prompt, 5 + 43 output.
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload),
        { input: 12, output: 48, total: 60, cached: null, reasoning: 43 });
    const logs = consoleText(con);
    assert.ok(logs.length > 0, 'debug is on');
    assert.equal(logs.includes(KEY), false, 'no key in the console');
    assert.equal(logs.includes('generativelanguage.googleapis.com'), false, 'no request URL in the console');
});

k.test('utf8-split', 'a multi-byte character split across two chunks arrives whole ("Reading the stream")', async () => {
    const text = 'Formalità: 95%';
    const chunk = { candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }], modelVersion: 'gemini-2.5-flash' };
    net.expect(isStream, () => streamResponse(splitInsideChar(crlf(chunk), 'à')));
    const t = startTurn(w, 'utf8');
    await t.done;
    assert.deepEqual(t.posted().filter(m => m.type === 'newToken').map(m => m.payload.token), [text]);
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
