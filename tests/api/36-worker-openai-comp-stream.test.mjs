// Spec 04, the OpenAI-compatible model worker (js/workers/model-worker-openai_comp.js), one
// instance for the file:
//  - "Web Worker Pattern": init maps the openai_comp_* fields into the client, streaming on (so
//    stream_options.include_usage is requested);
//  - "Thinking output in the webchat UI": the reasoning token is the FIRST PRESENT of
//    delta.reasoning_content (DeepSeek, vLLM, SGLang), delta.reasoning (OpenRouter - a string or
//    an object with .text), delta.thinking (llama.cpp / LM Studio);
//  - "Per-provider support" (openai_comp): the usage frame has an empty choices array and is read
//    before the choices guard; a server that never sends usage gives none;
//  - "Emitting to the chat window": usage immediately before tokensDone, one id per response,
//    nothing emitted when the provider reported nothing.
// Inputs: fixtures/api/openai_comp.json (DeepSeek and OpenRouter streams, a server without usage),
// plus deltas built from the field names spec 04 lists. Realm: no browser global.

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
    cutAt,
    sse,
    splitInsideChar,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('36-worker-openai-comp-stream');
const w = await loadWorker('model-worker-openai_comp');

const HOST = 'https://api.deepseek.com';
const KEY = 'sk-FAKE-COMP-WORKER-0000';
const FX = apiFixture('openai_comp.json');
const CHAT = HOST + '/chat/completions';
const DONE = 'data: [DONE]\n\n';

await w.send(initMessage({
    openai_comp_host: HOST,
    openai_comp_model: 'deepseek-reasoner',
    openai_comp_api_key: KEY,
    openai_comp_use_v1: false,
    openai_comp_chat_name: 'DeepSeek',
    openai_comp_temperature: '',
    openai_comp_extra_body: '',
}, { do_debug: true, chat_show_usage_data: true, i18nStrings: { OpenAIComp_api_request_failed: 'OpenAI Comp API request failed' } }));

const usageTokens = u => ({ input: u.input_tokens, output: u.output_tokens, total: u.total_tokens, cached: u.cached_input_tokens, reasoning: u.reasoning_tokens });

k.test('turn1-deepseek', 'turn 1 (DeepSeek): reasoning_content tokens, content tokens, the usage frame, [DONE]', async () => {
    const text = FX.deepseek_reasoner_stream.chunks.map(c => sse(c)).join('') + DONE;
    net.expect({ method: 'POST', url: CHAT }, () => streamResponse(cutAt(text, text.indexOf('The user greets') + 4, text.indexOf('"usage"'))));
    const t = startTurn(w, 'Hello!');
    await t.done;
    const req = net.calls[0];
    assert.equal(req.headers.authorization, 'Bearer ' + KEY);
    const body = req.json();
    assert.equal(body.model, 'deepseek-reasoner');
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello!' }]);
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', 'The user greets me.'],
        ['newThinkingToken', ' Answer briefly.'],
        ['newToken', 'Hi'],
        ['newToken', ' there!'],
        ['usage', 'msg_1'],
        ['tokensDone', 'The user greets me. Answer briefly.'],
    ]);
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 13, output: 200, total: 213, cached: 0, reasoning: 150 });
    assert.equal(consoleText(con).includes(KEY), false);
});

k.test('turn2-openrouter', 'turn 2 (OpenRouter): the processing comments are skipped, delta.reasoning is thinking, the whole history is sent', async () => {
    const text = FX.openrouter_stream.comment + '\n\n' + FX.openrouter_stream.comment + '\n\n'
        + FX.openrouter_stream.chunks.map(c => sse(c)).join('') + DONE;
    net.expect({ method: 'POST', url: CHAT }, () => streamResponse([text]));
    const t = startTurn(w, 'Again');
    await t.done;
    assert.deepEqual(net.calls[0].json().messages, [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Again' },
    ]);
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', 'Thinking about it.'],
        ['newToken', 'Hello'],
        ['usage', 'msg_2'],
        ['tokensDone', 'Thinking about it.'],
    ]);
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 10, output: 20, total: 30, cached: null, reasoning: null });
});

k.test('turn3-no-usage', 'turn 3 (a server that ignores include_usage): the answer, and no usage message', async () => {
    net.expect({ method: 'POST', url: CHAT }, () => streamResponse([FX.plain_stream_no_usage.chunks.map(c => sse(c)).join('') + DONE]));
    const t = startTurn(w, 'Ciao');
    await t.done;
    assert.deepEqual(shape(t.posted()), [['newToken', 'Ciao'], ['tokensDone', '']]);
});

k.test('turn4-field-priority', 'reasoning_content before reasoning before thinking; reasoning as an object with .text', async () => {
    const chunk = delta => ({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] });
    const text = [
        chunk({ reasoning_content: 'A', reasoning: 'B', thinking: 'C' }),
        chunk({ reasoning: { text: 'X' } }),
        chunk({ thinking: 'T' }),
        chunk({ content: 'ok' }),
    ].map(c => sse(c)).join('') + DONE;
    net.expect({ method: 'POST', url: CHAT }, () => streamResponse([text]));
    const t = startTurn(w, 'q');
    await t.done;
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', 'A'],
        ['newThinkingToken', 'X'],
        ['newThinkingToken', 'T'],
        ['newToken', 'ok'],
        ['tokensDone', 'AXT'],
    ]);
});

k.test('utf8-split', 'a multi-byte character split across two chunks arrives whole ("Reading the stream")', async () => {
    const text = 'Formalità: 95%';
    const chunk = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'deepseek-reasoner', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
    net.expect({ method: 'POST', url: CHAT }, () => streamResponse([...splitInsideChar(sse(chunk), 'à'), DONE]));
    const t = startTurn(w, 'utf8');
    await t.done;
    assert.deepEqual(t.posted().filter(m => m.type === 'newToken').map(m => m.payload.token), [text]);
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
