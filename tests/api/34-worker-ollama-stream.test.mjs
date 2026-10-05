// Spec 04, the Ollama model worker (js/workers/model-worker-ollama.js), one instance for the file:
//  - "Ollama": ollama_system_prompt is prepended by the WORKER, in the init branch, ONCE - not per
//    chatMessage (conversationHistory survives every turn); ollama_api_key sent as
//    Authorization: Bearer; the worker must never log config or any header map built from it;
//  - "Thinking output in the webchat UI": message.thinking -> newThinkingToken, accumulated and
//    sent on tokensDone; message.content -> newToken;
//  - "Per-provider support" (ollama): the final chunk (done === true) carries the counters, total
//    computed, tokens_per_second from eval_count / eval_duration, null when no duration;
//  - "Emitting to the chat window": usage immediately before tokensDone, one id per response.
// Turn 1 replays the CAPTURE captured/ollama-thinking-stream.txt (a cloud model: thinking, then
// content, a final chunk without eval_duration); turn 2 the documented chunks of
// fixtures/api/ollama.json. A line is split across two chunks and chunks hold several lines. The
// expected tokens are the captured message.thinking / message.content values, in order - the
// spec's mapping applied to the input, not the code's output. Realm: no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    consoleText
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
    capturedLines,
    cutAt,
    ndjson,
    splitInsideChar,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('34-worker-ollama-stream');
const w = await loadWorker('model-worker-ollama');

const HOST = 'http://localhost:11434';
const KEY = 'FAKE-OLLAMA-WORKER-KEY-0000';
const SYSTEM = 'Rispondi in italiano.';
const FX = apiFixture('ollama.json');
const CAPTURED = capturedLines('ollama-thinking-stream.txt');
const CAPTURED_OBJ = CAPTURED.map(l => JSON.parse(l));

await w.send(initMessage({
    ollama_host: HOST,
    ollama_api_key: KEY,
    ollama_model: 'glm-5.3-flash:cloud',
    ollama_num_ctx: 0,
    ollama_temperature: '',
    ollama_think: '',
    ollama_keep_alive: '',
    ollama_system_prompt: SYSTEM,
    ollama_extra_options: '',
}, { do_debug: true, chat_show_usage_data: true, i18nStrings: { ollama_api_request_failed: 'Ollama API request failed' } }));

const usageTokens = u => ({ input: u.input_tokens, output: u.output_tokens, total: u.total_tokens, tps: u.tokens_per_second });

/** The spec's mapping of a list of chunks: thinking -> newThinkingToken, content -> newToken. */
function expectedTokens(objs) {
    const out = [];
    for (const o of objs) {
        if (o.message?.thinking) out.push(['newThinkingToken', o.message.thinking]);
        if (o.message?.content) out.push(['newToken', o.message.content]);
    }
    return out;
}
const ANSWER_1 = CAPTURED_OBJ.map(o => o.message?.content || '').join('');
const THINKING_1 = CAPTURED_OBJ.map(o => o.message?.thinking || '').join('');

k.test('turn1-captured', 'turn 1 (captured): system prompt then user, thinking and content tokens in order, usage, tokensDone', async () => {
    const text = CAPTURED.map(ndjson).join('');
    const third = Math.floor(text.length / 3);
    net.expect({ method: 'POST', url: HOST + '/api/chat' }, () => streamResponse(cutAt(text, 50, third, 2 * third), { contentType: 'application/x-ndjson' }));
    const t = startTurn(w, 'Classifica questo testo');
    await t.done;
    const req = net.calls[0];
    assert.equal(req.headers.authorization, 'Bearer ' + KEY);
    const body = req.json();
    assert.equal(body.model, 'glm-5.3-flash:cloud');
    assert.equal(body.stream, true);
    assert.equal('think' in body, false, "ollama_think '' omits the field");
    assert.deepEqual(body.messages, [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Classifica questo testo' }]);
    assert.ok(THINKING_1.length > 0 && ANSWER_1.length > 0, 'the capture has both');
    assert.deepEqual(shape(t.posted()), [...expectedTokens(CAPTURED_OBJ), ['usage', 'msg_1'], ['tokensDone', THINKING_1]]);
    // Final chunk: 359 prompt, 389 eval, no eval_duration (a cloud model).
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 359, output: 389, total: 748, tps: null });
    assert.equal(consoleText(con).includes(KEY), false, 'neither config nor headers are logged');
});

k.test('turn2-history', 'turn 2: exactly one system message, then the whole history; tokens_per_second from the durations', async () => {
    const objs = [...FX.content_chunks.chunks, FX.final_chunk_with_durations.chunk];
    net.expect({ method: 'POST', url: HOST + '/api/chat' }, () => streamResponse([objs.map(ndjson).join('')]));
    const t = startTurn(w, 'Perché il cielo è blu?');
    await t.done;
    assert.deepEqual(net.calls[0].json().messages, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: 'Classifica questo testo' },
        { role: 'assistant', content: ANSWER_1 },
        { role: 'user', content: 'Perché il cielo è blu?' },
    ], 'the system prompt is not stacked again, and the history holds the answer text only');
    assert.deepEqual(shape(t.posted()), [['newToken', 'The'], ['newToken', ' sky is blue.'], ['usage', 'msg_2'], ['tokensDone', '']]);
    // 282 / 4.535599 s = 62.17... -> 62.2
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 26, output: 282, total: 308, tps: 62.2 });
    assert.equal(consoleText(con).includes(KEY), false);
});

k.test('utf8-split', 'a multi-byte character split across two chunks arrives whole ("Reading the stream")', async () => {
    const text = 'Formalità: 95%';
    const line = { model: 'llama3.2', created_at: '2026-10-06T08:29:22.171151497Z', message: { role: 'assistant', content: text }, done: false };
    net.expect({ method: 'POST', url: HOST + '/api/chat' }, () => streamResponse(splitInsideChar(ndjson(line), 'à'), { contentType: 'application/x-ndjson' }));
    const t = startTurn(w, 'utf8');
    await t.done;
    assert.deepEqual(t.posted().filter(m => m.type === 'newToken').map(m => m.payload.token), [text]);
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
