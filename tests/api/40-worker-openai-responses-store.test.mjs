// Spec 04 "OpenAI API (chatgpt_api)", "Chaining turns (chatgpt_store)": with chatgpt_store ON the
// worker keeps the id of response.created and, on the next turn, sends just the new user message
// with previous_response_id (the earlier turns are stored on the server). The store-off case
// (whole history every time) is in 38-worker-openai-responses-stream. A fresh worker instance,
// hence its own file. Turn 1 replays the CAPTURE captured/openai-responses-stream.txt.
// Realm: no browser global.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import {
    assertNoBrowser,
    initMessage,
    loadWorker,
    startTurn
} from './worker-realm.mjs';
import {
    capturedLines,
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('40-worker-openai-responses-store');
const w = await loadWorker('model-worker-openai_responses');

const URL_ = 'https://api.openai.com/v1/responses';
const CAPTURED = capturedLines('openai-responses-stream.txt');
const RESPONSE_ID = JSON.parse(CAPTURED[0]).response.id;
const stream = () => streamResponse([CAPTURED.map(l => sse(l, JSON.parse(l).type)).join('')]);

await w.send(initMessage({ chatgpt_api_key: 'sk-FAKE-0000', chatgpt_model: 'gpt-4.1-nano', chatgpt_store: true },
    { chat_show_usage_data: false, i18nStrings: { chatgpt_api_request_failed: 'OpenAI ChatGPT API request failed' } }));

k.test('turn1-no-previous', 'turn 1: the message, store on, no previous_response_id yet', async () => {
    net.expect(URL_, stream);
    await startTurn(w, 'Classify this text').done;
    const body = net.calls[0].json();
    assert.equal(body.store, true);
    assert.equal('previous_response_id' in body, false);
    assert.ok(JSON.stringify(body.input).includes('Classify this text'));
});

k.test('turn2-chained', 'turn 2: only the new message, with the id of response.created as previous_response_id', async () => {
    net.expect(URL_, stream);
    await startTurn(w, 'Explain the scores').done;
    const body = net.calls[0].json();
    assert.equal(body.previous_response_id, RESPONSE_ID);
    const sent = JSON.stringify(body.input);
    assert.ok(sent.includes('Explain the scores'));
    assert.equal(sent.includes('Classify this text'), false, 'the earlier turn is on the server, not resent');
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
