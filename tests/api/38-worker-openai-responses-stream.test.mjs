// Spec 04, the OpenAI Responses model worker (js/workers/model-worker-openai_responses.js), one
// instance for the file, chatgpt_store at its default (off):
//  - "Web Worker Pattern": init maps the chatgpt_* fields into the client, streaming on;
//  - "Thinking output in the webchat UI": response.reasoning_summary_text.delta and
//    response.reasoning_text.delta -> newThinkingToken; as a fallback the concatenated
//    item.summary[].text of a response.output_item.done whose item.type is 'reasoning', ONLY while
//    the thinking accumulator is still empty (never emitted twice); item.encrypted_content always
//    ignored;
//  - "Per-provider support" (openai_responses): the usage only on response.completed, under
//    event.response.usage;
//  - "Emitting to the chat window": usage immediately before tokensDone, one id per response;
//  - "Rendering in the chat window" ("Conversation figures"): the workers resend the whole
//    history on the next request.
// Turn 1 replays the CAPTURE captured/openai-responses-stream.txt (gpt-4.1-nano, no reasoning);
// turns 2 and 3 the documented reasoning events of fixtures/api/openai_responses.json. Each event
// is sent with its `event:` line, as the API does. Realm: no browser global.

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
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('38-worker-openai-responses-stream');
const w = await loadWorker('model-worker-openai_responses');

const URL_ = 'https://api.openai.com/v1/responses';
const KEY = 'sk-FAKE-OPENAI-WORKER-0000';
const FX = apiFixture('openai_responses.json');
const CAPTURED = capturedLines('openai-responses-stream.txt');
const wire = events => events.map(e => sse(e, e.type)).join('');

await w.send(initMessage({
    chatgpt_api_key: KEY,
    chatgpt_model: 'gpt-4.1-nano',
    chatgpt_developer_messages: '',
    chatgpt_temperature: '',
    chatgpt_store: false,
    chatgpt_reasoning_summary: '',
    chatgpt_reasoning_effort: '',
    chatgpt_extra_body: '',
    chatgpt_max_output_tokens: 0,
}, { do_debug: true, chat_show_usage_data: true, i18nStrings: { chatgpt_api_request_failed: 'OpenAI ChatGPT API request failed' } }));

const usageTokens = u => ({ input: u.input_tokens, output: u.output_tokens, total: u.total_tokens, cached: u.cached_input_tokens, reasoning: u.reasoning_tokens });
const CAPTURED_OBJ = CAPTURED.map(l => JSON.parse(l));
const DELTAS_1 = CAPTURED_OBJ.filter(e => e.type === 'response.output_text.delta').map(e => e.delta);
const ANSWER_1 = DELTAS_1.join('');
let turn2Request = null;

k.test('turn1-captured', 'turn 1 (captured): the output_text deltas in order, usage from response.completed, tokensDone', async () => {
    const text = CAPTURED.map(l => sse(l, JSON.parse(l).type)).join('');
    const third = Math.floor(text.length / 3);
    net.expect({ method: 'POST', url: URL_ }, () => streamResponse(cutAt(text, 100, third, 2 * third)));
    const t = startTurn(w, 'Classify this text');
    await t.done;
    const req = net.calls[0];
    assert.equal(req.headers.authorization, 'Bearer ' + KEY);
    const body = req.json();
    assert.equal(body.model, 'gpt-4.1-nano');
    assert.equal(body.stream, true);
    assert.ok(JSON.stringify(body.input).includes('Classify this text'));
    assert.equal(ANSWER_1, 'Politeness: 95%  \nWarmth: 85%  \nFormalità: 100%  \nAssertività: 60%  \nOffensività: 0%');
    assert.deepEqual(shape(t.posted()), [...DELTAS_1.map(d => ['newToken', d]), ['usage', 'msg_1'], ['tokensDone', '']]);
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 333, output: 37, total: 370, cached: 0, reasoning: 0 });
    assert.equal(consoleText(con).includes(KEY), false);
});

k.test('turn2-reasoning', 'turn 2: summary deltas are thinking, the reasoning item that repeats them is not emitted again', async () => {
    net.expect({ method: 'POST', url: URL_ }, () => streamResponse([wire(FX.reasoning_stream.events)]));
    const t = startTurn(w, 'Say hi');
    await t.done;
    turn2Request = net.calls[0].json();
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', '**Greeting** The user says hi.'],
        ['newThinkingToken', ' I will greet back.'],
        ['newToken', 'Hi'],
        ['newToken', '!'],
        ['usage', 'msg_2'],
        ['tokensDone', '**Greeting** The user says hi. I will greet back.'],
    ]);
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload), { input: 20, output: 120, total: 140, cached: 8, reasoning: 100 });
});

k.test('turn2-history', 'turn 2 resends the whole history: the first question, its answer, the new question', () => {
    assert.ok(turn2Request, 'turn 2 ran');
    const sent = JSON.stringify(turn2Request.input);
    assert.ok(sent.includes('Say hi'), 'the new question');
    assert.ok(sent.includes('Classify this text'), 'the first question');
    assert.ok(sent.includes(JSON.stringify(ANSWER_1).slice(1, -1)), 'the first answer');
});

k.test('turn3-item-fallback', 'turn 3: a summary delivered only in the reasoning item is emitted once; encrypted_content never', async () => {
    net.expect({ method: 'POST', url: URL_ }, () => streamResponse([wire(FX.reasoning_item_only.events)]));
    const t = startTurn(w, 'Finish');
    await t.done;
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', 'First part. Second part.'],
        ['newToken', 'Done.'],
        ['usage', 'msg_3'],
        ['tokensDone', 'First part. Second part.'],
    ]);
    assert.equal(JSON.stringify(t.posted()).includes('gAAAA'), false, 'the opaque reasoning never reaches the window');
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
