// Spec 04 "OpenAI-Compatible (openai_comp_api)", "Extra body data", "Per-provider support"
// (openai_comp) and "Automatic Retry Handling" (js/api/openai_comp.js fetchResponse):
//  - openai_comp_extra_body is spread at the top level of the body, FIRST, so model, messages,
//    stream, temperature and max_tokens always win; a parameter ThunderAI leaves empty is not
//    sent, so an extra entry for it does reach the API;
//  - while streaming, the request includes stream_options: {include_usage: true} (the usage frame
//    exists only then);
//  - OpenAI-compatible chat requests use a 300 s per-attempt timeout (OPENAI_COMP_CHAT_TIMEOUT_MS).
//  - "Extra headers": openai_comp_extra_headers is sent with every request, the models one
//    (fetchModels) and the chat one (fetchResponse); the headers ThunderAI sets (Content-Type,
//    Authorization when a key is set) win whatever the case of the extra names, and are never
//    duplicated; with no extra headers the request is unchanged.
// Request: <host>[/v1]/chat/completions (openai_comp_use_v1 keeps the v1 path segment), the API
// key as `Authorization: Bearer` as in the OpenAI API they are compatible with
// (https://platform.openai.com/docs/api-reference/authentication), only when a key is set.

import assert from 'node:assert/strict';
import {
    areaFile,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import { flush } from './worker-realm.mjs';
import { jsonResponse } from './wire.mjs';

const { k, net } = areaFile('24-openai-comp-request');
const { OpenAIComp } = await import('../../js/api/openai_comp.js');

const HOST = 'https://api.deepseek.com';
const KEY = 'sk-FAKE-COMP-0000';
const MESSAGES = [{ role: 'user', content: 'Hi' }];

async function send(cfg, maxTokens = 0) {
    net.expect(u => u.method === 'POST' && u.url.endsWith('/chat/completions'), () => jsonResponse({ choices: [] }));
    await new OpenAIComp({ host: HOST, model: 'deepseek-chat', apiKey: KEY, stream: true, ...cfg }).fetchResponse(MESSAGES, maxTokens, { maxRetries: 0 });
    return net.calls.at(-1).json();
}

k.test('url-v1', 'use_v1: <host>/v1/chat/completions', async () => {
    await send({ use_v1: true });
    assert.equal(net.calls[0].url, HOST + '/v1/chat/completions');
});

k.test('url-no-v1', 'use_v1 off: <host>/chat/completions', async () => {
    await send({ use_v1: false });
    assert.equal(net.calls[0].url, HOST + '/chat/completions');
});

k.test('bearer', 'a key is sent as Authorization: Bearer, never in the URL', async () => {
    await send({});
    assert.equal(net.calls[0].headers.authorization, 'Bearer ' + KEY);
    assert.equal(net.calls[0].url.includes(KEY), false);
});

k.test('no-key', 'no key, no Authorization header (local servers)', async () => {
    await send({ apiKey: '' });
    assert.equal('authorization' in net.calls[0].headers, false);
});

k.test('base-body-stream', 'streaming: model, messages, stream and stream_options.include_usage', async () => {
    assert.deepEqual(await send({}), { model: 'deepseek-chat', messages: MESSAGES, stream: true, stream_options: { include_usage: true } });
});

k.test('no-stream-no-options', 'not streaming: no stream_options', async () => {
    assert.deepEqual(await send({ stream: false }), { model: 'deepseek-chat', messages: MESSAGES, stream: false });
});

k.test('temperature', 'temperature sent when set, 0 included; not when empty', async () => {
    assert.equal((await send({ temperature: '0.3' })).temperature, 0.3);
    assert.equal((await send({ temperature: '0' })).temperature, 0);
    assert.equal('temperature' in await send({ temperature: '' }), false);
});

k.test('max-tokens', 'max_tokens only when > 0', async () => {
    assert.equal((await send({}, 300)).max_tokens, 300);
    assert.equal('max_tokens' in await send({}, 0), false);
});

k.test('extra-top-level', 'the extra body goes at the top level', async () => {
    const b = await send({ extra_body: JSON.stringify({ top_p: 0.8, thinking: { type: 'disabled' } }) });
    assert.equal(b.top_p, 0.8);
    assert.deepEqual(b.thinking, { type: 'disabled' });
});

k.test('extra-protected', 'model, messages, stream, temperature and max_tokens win over the extra body', async () => {
    const b = await send({
        temperature: '0.3',
        extra_body: JSON.stringify({ model: 'evil', messages: [], stream: false, temperature: 2, max_tokens: 1 }),
    }, 300);
    assert.equal(b.model, 'deepseek-chat');
    assert.deepEqual(b.messages, MESSAGES);
    assert.equal(b.stream, true);
    assert.equal(b.temperature, 0.3);
    assert.equal(b.max_tokens, 300);
});

k.test('extra-unmanaged-honoured', 'an extra entry for a parameter ThunderAI leaves empty reaches the API', async () => {
    const b = await send({ temperature: '', extra_body: '{"temperature": 0.9, "max_tokens": 64}' }, 0);
    assert.equal(b.temperature, 0.9);
    assert.equal(b.max_tokens, 64);
});

k.test('extra-invalid', 'an invalid extra body is ignored', async () => {
    assert.deepEqual(await send({ extra_body: '{"a":' }), { model: 'deepseek-chat', messages: MESSAGES, stream: true, stream_options: { include_usage: true } });
});

async function sendModels(cfg) {
    net.expect(u => u.method === 'GET' && u.url.endsWith('/models'), () => jsonResponse({ data: [] }));
    await new OpenAIComp({ host: HOST, apiKey: KEY, ...cfg }).fetchModels({ maxRetries: 0 });
    return net.calls.at(-1).headers;
}

const EXTRA_HEADERS = JSON.stringify({ 'x-opencode-session': 'thunderai-abc123', 'api-key': 'azure-FAKE' });

k.test('headers-chat', 'the extra headers are sent with the chat completions request', async () => {
    await send({ extra_headers: EXTRA_HEADERS });
    const h = net.calls[0].headers;
    assert.equal(h['x-opencode-session'], 'thunderai-abc123');
    assert.equal(h['api-key'], 'azure-FAKE');
    assert.equal(h['content-type'], 'application/json');
    assert.equal(h.authorization, 'Bearer ' + KEY);
});

k.test('headers-models', 'the extra headers are sent with the models request', async () => {
    const h = await sendModels({ extra_headers: EXTRA_HEADERS });
    assert.equal(h['x-opencode-session'], 'thunderai-abc123');
    assert.equal(h['api-key'], 'azure-FAKE');
    assert.equal(h.authorization, 'Bearer ' + KEY);
});

k.test('headers-managed-win', 'Content-Type and Authorization win over the extra headers, whatever their case, never duplicated', async () => {
    const extra_headers = JSON.stringify({ authorization: 'Bearer evil', 'CONTENT-TYPE': 'text/plain', 'x-a': '1' });
    await send({ extra_headers });
    for (const h of [net.calls.at(-1).headers, await sendModels({ extra_headers })]) {
        // A duplicate would reach the wire combined, as "Bearer evil, Bearer <key>".
        assert.equal(h.authorization, 'Bearer ' + KEY);
        assert.equal(h['content-type'], 'application/json');
        assert.equal(h['x-a'], '1');
    }
});

k.test('headers-unmanaged-honoured', 'with no key, an extra Authorization header is sent: ThunderAI sets none', async () => {
    await send({ apiKey: '', extra_headers: '{"Authorization": "Bearer own"}' });
    assert.equal(net.calls[0].headers.authorization, 'Bearer own');
});

k.test('headers-none', 'no extra headers, or unusable ones: the headers are unchanged', async () => {
    for (const extra_headers of [undefined, '', '{"a":', '{"Host": "evil.example", "x-n": 1}']) {
        await send({ extra_headers });
        assert.deepEqual(net.calls.at(-1).headers, { 'content-type': 'application/json', authorization: 'Bearer ' + KEY });
        assert.deepEqual(await sendModels({ extra_headers }), { 'content-type': 'application/json', authorization: 'Bearer ' + KEY });
    }
});

k.test('chat-timeout-300s', 'a chat request waits 300 s for the headers, not the default 60 s', async (t) => {
    const timers = fakeTime(t);
    net.expect(HOST + '/v1/chat/completions', NET.hang);
    const p = new OpenAIComp({ host: HOST, model: 'm' }).fetchResponse(MESSAGES, 0, { maxRetries: 0 });
    await flush();
    timers.tick(299999);
    assert.equal(net.calls[0].signal.aborted, false, 'still waiting just before 300 s');
    timers.tick(1);
    const r = await p;
    assert.equal(net.calls[0].signal.aborted, true);
    assert.equal(r.is_exception, true);
});

k.coverage();
