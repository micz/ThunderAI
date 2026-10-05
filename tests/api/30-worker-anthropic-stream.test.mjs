// Spec 04, the Anthropic model worker (js/workers/model-worker-anthropic.js), one instance for
// the whole file (a module singleton: these tests are the turns of one chat window, in order):
//  - "Web Worker Pattern": init maps the anthropic_* fields of the init message into the client
//    configuration; chatMessage streams the answer back;
//  - "Thinking output in the webchat UI": content_block_delta with delta.type 'thinking_delta' ->
//    newThinkingToken (delta.thinking), accumulated and sent on tokensDone; text deltas ->
//    newToken;
//  - "Per-provider support" (anthropic) + "Wiring in the workers": message_start carries the input
//    and cache counters, message_delta the output, combined with mergeUsageData(); usage never
//    pushed into conversationHistory;
//  - "Emitting to the chat window": {type:'usage', messageId, payload} posted immediately BEFORE
//    tokensDone, the id bound to the response (one per response);
//  - "Workers and UI": onRetry posts {type:'newRetryAttempt', payload: {attempt, maxRetries,
//    delayMs, status, reason}};
//  - "Logging" / "Wiring in the workers": with debug on, never the API key in the console.
// Stream input: the documented Messages API events (fixtures/api/anthropic.json), cut so that an
// event is split across two chunks and one chunk holds several events. Realm: worker-realm.mjs -
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
    cutAt,
    jsonResponse,
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('30-worker-anthropic-stream');
const w = await loadWorker('model-worker-anthropic');

const KEY = 'sk-ant-FAKE-WORKER-0000';
const MSG_URL = 'https://api.anthropic.com/v1/messages';
const FX = apiFixture('anthropic.json');
const wire = events => events.map(e => sse(e.data, e.event)).join('');

await w.send(initMessage({
    anthropic_api_key: KEY,
    anthropic_model: 'claude-sonnet-4-5',
    anthropic_version: '2023-06-01',
    anthropic_max_tokens: 4096,
    anthropic_system_prompt: '',
    anthropic_temperature: '',
    anthropic_extended_thinking_budget: 2048,
    anthropic_effort: '',
}, { do_debug: true, chat_show_usage_data: true, i18nStrings: { anthropic_api_request_failed: 'Claude API request failed' } }));

const usageTokens = u => ({ input: u.input_tokens, output: u.output_tokens, total: u.total_tokens, cached: u.cached_input_tokens, creation: u.cache_creation_tokens });

k.test('turn1', 'turn 1 (thinking stream): thinking and text tokens in stream order, usage, then tokensDone with the thinking', async () => {
    const text = wire(FX.stream_thinking.events);
    const a = text.indexOf('"thinking_delta"') + 5;                                   // inside a data line
    const b = text.indexOf('event: content_block_start', text.indexOf('signature_delta')) + 9;  // inside an event line
    const chunks = cutAt(text, a, b);
    assert.equal(chunks.length, 3);
    net.expect({ method: 'POST', url: MSG_URL }, () => streamResponse(chunks));
    const t = startTurn(w, 'What is the GCD of 1071 and 462?');
    await t.done;
    assert.deepEqual(shape(t.posted()), [
        ['newThinkingToken', 'I need to find the GCD of 1071 and 462.\n\n'],
        ['newThinkingToken', '1071 = 2 × 462 + 147'],
        ['newToken', 'The GCD is **21**.'],
        ['usage', 'msg_1'],
        ['tokensDone', 'I need to find the GCD of 1071 and 462.\n\n1071 = 2 × 462 + 147'],
    ]);
    assert.ok(t.posted().some(m => m.type === 'messageSent'));
    const usage = t.posted().find(m => m.type === 'usage').payload;
    assert.deepEqual(usageTokens(usage), { input: 40, output: 87, total: 127, cached: null, creation: null });
    assert.equal(consoleText(con).includes(KEY), false, 'the key never reaches the console');
});

k.test('turn2', 'turn 2 (text stream with cache counters): init mapping, the whole history sent, usage bound to the second response', async () => {
    const text = wire(FX.stream_text.events);
    const chunks = cutAt(text, text.indexOf('text_delta') + 3, text.indexOf('message_delta'));
    net.expect({ method: 'POST', url: MSG_URL }, () => streamResponse(chunks));
    const t = startTurn(w, 'Say hello');
    await t.done;
    const req = net.calls[0];
    assert.equal(req.headers['x-api-key'], KEY);
    const body = req.json();
    assert.equal(body.model, 'claude-sonnet-4-5');
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.stream, true, 'the worker always streams');
    assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 2048 }, 'anthropic_extended_thinking_budget reached the client');
    assert.deepEqual(body.messages, [
        { role: 'user', content: 'What is the GCD of 1071 and 462?' },
        { role: 'assistant', content: 'The GCD is **21**.' },
        { role: 'user', content: 'Say hello' },
    ], 'the answer text only: no thinking, no usage in the history');
    assert.deepEqual(shape(t.posted()), [
        ['newToken', 'Hello'],
        ['newToken', '! How can I help?'],
        ['usage', 'msg_2'],
        ['tokensDone', ''],
    ]);
    // message_start: 25 + 3000 + 1200 input; message_delta: 15 output.
    assert.deepEqual(usageTokens(t.posted().find(m => m.type === 'usage').payload),
        { input: 4225, output: 15, total: 4240, cached: 3000, creation: 1200 });
});

k.test('retry-forwarded', 'a retried 529 is forwarded as newRetryAttempt before the answer', async (t) => {
    const timers = fakeTime(t);
    net.expect(MSG_URL, () => jsonResponse(FX.error_529.body, { status: 529 }))
        .expect(MSG_URL, () => streamResponse([wire(FX.stream_text.events)]));
    const turn = startTurn(w, 'Again');
    await drive(turn.done, timers);
    const retry = turn.posted().find(m => m.type === 'newRetryAttempt');
    assert.deepEqual({ ...retry.payload, delayMs: undefined },
        { attempt: 1, maxRetries: 5, delayMs: undefined, status: 529, reason: 'http' });
    assert.ok(retry.payload.delayMs >= 4000 && retry.payload.delayMs <= 5000, 'the first backoff, 5 s with jitter');
    const types = turn.posted().map(m => m.type);
    assert.ok(types.indexOf('newRetryAttempt') < types.indexOf('newToken'));
    assert.equal(turn.posted().find(m => m.type === 'usage').messageId, 'msg_3');
    assert.equal(consoleText(con).includes(KEY), false);
});

k.test('no-browser', 'the worker ran three turns with no browser global', () => {
    assertNoBrowser();
});

k.coverage();
