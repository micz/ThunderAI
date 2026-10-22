// Spec 04 "Ollama (ollama_api)", "Extra body data" and "Automatic Retry Handling"
// (js/api/ollama.js):
//  - ollama_think is a level with distinct states: '' -> field omitted, 'false' -> think: false,
//    'true' -> think: true, low/medium/high/max -> think: "<level>"; a legacy boolean true/false
//    is coerced at construction to 'true' / 'false' (never to '');
//  - keep_alive sent as a top-level string, omitted when empty;
//  - ollama_extra_options is spread into the `options` object (not the top level), FIRST, so
//    num_ctx and temperature (the managed ones) win;
//  - the system prompt is not put in the body by the class (the worker prepends it);
//  - ollama_api_key is optional and sent as `Authorization: Bearer <key>` on every endpoint;
//  - fetchModelInfo(model) is POST /api/show; fetchVersion/fetchModelInfo use plain fetch, the
//    chat request and fetchModels go through fetchWithRetry;
//  - Ollama chat requests use a 300 s per-attempt timeout (OLLAMA_CHAT_TIMEOUT_MS).

import assert from 'node:assert/strict';
import {
    areaFile,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import { flush } from './worker-realm.mjs';
import { jsonResponse } from './wire.mjs';

const { k, net } = areaFile('23-ollama-request');
const { Ollama } = await import('../../js/api/ollama.js');

const HOST = 'http://localhost:11434';
const KEY = 'FAKE-OLLAMA-KEY-0000';
const MESSAGES = [{ role: 'user', content: 'Hi' }];

async function send(cfg) {
    net.expect({ method: 'POST', url: HOST + '/api/chat' }, () => jsonResponse({ done: true }));
    await new Ollama({ host: HOST, model: 'llama3.2', stream: true, ...cfg }).fetchResponse(MESSAGES, { maxRetries: 0 });
    return net.calls.at(-1).json();
}

k.test('base-body', 'defaults: model, messages, stream, and no think, format, keep_alive or options', async () => {
    assert.deepEqual(await send({}), { model: 'llama3.2', messages: MESSAGES, stream: true });
});

for (const [stored, sent] of [['false', false], ['true', true], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['max', 'max']]) {
    k.test('think-' + stored, `ollama_think '${stored}' sends think: ${JSON.stringify(sent)}`, async () => {
        const b = await send({ think: stored });
        assert.ok('think' in b);
        assert.equal(b.think, sent);
    });
}

k.test('think-empty', "ollama_think '' omits the field (the model default)", async () => {
    assert.equal('think' in await send({ think: '' }), false);
});

k.test('think-legacy-true', 'a legacy boolean true is sent as think: true', async () => {
    assert.equal((await send({ think: true })).think, true);
});

k.test('think-legacy-false', 'a legacy boolean false is sent as think: false, never omitted', async () => {
    const b = await send({ think: false });
    assert.ok('think' in b, 'unticking the box meant "do not think"');
    assert.equal(b.think, false);
});

k.test('keep-alive', 'keep_alive is a top-level string, omitted when empty', async () => {
    assert.equal((await send({ keep_alive: '30m' })).keep_alive, '30m');
    assert.equal((await send({ keep_alive: '-1' })).keep_alive, '-1');
    assert.equal('keep_alive' in await send({ keep_alive: '' }), false);
});

k.test('format-json', 'format_json sends format: "json"', async () => {
    assert.equal((await send({ format_json: true })).format, 'json');
    assert.equal('format' in await send({ format_json: false }), false);
});

k.test('options-managed', 'num_ctx and temperature go in options', async () => {
    assert.deepEqual((await send({ num_ctx: 8192, temperature: '0.2' })).options, { num_ctx: 8192, temperature: 0.2 });
});

k.test('extra-in-options', 'the extra options go INTO options, not the top level', async () => {
    const b = await send({ extra_options: JSON.stringify({ top_p: 0.9, seed: 42, stop: ['END'] }) });
    assert.deepEqual(b.options, { top_p: 0.9, seed: 42, stop: ['END'] });
    for (const f of ['top_p', 'seed', 'stop']) assert.equal(f in b, false, f + ' not at the top level');
});

k.test('extra-managed-win', 'num_ctx and temperature win over the extra options', async () => {
    const b = await send({ num_ctx: 4096, temperature: '0.2', extra_options: JSON.stringify({ num_ctx: 128, temperature: 1.9, top_k: 20 }) });
    assert.deepEqual(b.options, { num_ctx: 4096, temperature: 0.2, top_k: 20 });
});

k.test('extra-unmanaged-honoured', 'an extra entry for a parameter ThunderAI leaves empty reaches the API', async () => {
    assert.deepEqual((await send({ temperature: '', num_ctx: 0, extra_options: '{"temperature": 0.7}' })).options, { temperature: 0.7 });
});

k.test('extra-invalid', 'invalid extra options are ignored', async () => {
    assert.equal('options' in await send({ extra_options: '[1,2]' }), false);
});

k.test('system-not-in-body', 'the class does not put the system prompt in the body', async () => {
    const b = await send({ system_prompt: 'Be brief.' });
    assert.deepEqual(b.messages, MESSAGES);
    assert.equal(JSON.stringify(b).includes('Be brief.'), false);
});

// ---- auth on every endpoint -----------------------------------------------------------------

async function everyEndpoint(api_key) {
    const o = new Ollama({ host: HOST, model: 'llama3.2', api_key });
    const ok = () => jsonResponse({});
    net.expect({ method: 'POST', url: HOST + '/api/chat' }, ok)
        .expect({ method: 'GET', url: HOST + '/api/tags' }, () => jsonResponse({ models: [] }))
        .expect({ method: 'GET', url: HOST + '/api/version' }, () => jsonResponse({ version: '0.12.0' }))
        .expect({ method: 'POST', url: HOST + '/api/show' }, ok)
        .expect({ method: 'GET', url: HOST + '/api/ps' }, () => jsonResponse({ models: [] }));
    await o.fetchResponse(MESSAGES, { maxRetries: 0 });
    await o.fetchModels({ maxRetries: 0 });
    await o.fetchVersion();
    await o.fetchModelInfo('llama3.2');
    await o.fetchRunningModels();
    return net.calls;
}

k.test('bearer-everywhere', 'with an API key every endpoint sends Authorization: Bearer <key>', async () => {
    const calls = await everyEndpoint(KEY);
    assert.equal(calls.length, 5);
    for (const c of calls) assert.equal(c.headers.authorization, 'Bearer ' + KEY, c.url);
});

k.test('no-key-no-header', 'without a key no endpoint sends an Authorization header', async () => {
    for (const c of await everyEndpoint('')) assert.equal('authorization' in c.headers, false, c.url);
});

k.test('model-info-show', 'fetchModelInfo(model) is POST /api/show for that model', async () => {
    net.expect({ method: 'POST', url: HOST + '/api/show' }, () => jsonResponse({ capabilities: ['completion', 'thinking'] }));
    const r = await new Ollama({ host: HOST }).fetchModelInfo('qwen3:8b');
    assert.equal(r.ok, true);
    assert.deepEqual(r.response, { capabilities: ['completion', 'thinking'] });
    assert.equal(net.calls[0].json().model, 'qwen3:8b');
});

// ---- the 300 s per-attempt timeout ----------------------------------------------------------

k.test('chat-timeout-300s', 'a chat request waits 300 s for the headers, not the default 60 s', async (t) => {
    const timers = fakeTime(t);
    net.expect(HOST + '/api/chat', NET.hang);
    const p = new Ollama({ host: HOST, model: 'llama3.2' }).fetchResponse(MESSAGES, { maxRetries: 0 });
    await flush();
    timers.tick(60000);
    assert.equal(net.calls[0].signal.aborted, false, 'still waiting after 60 s');
    timers.tick(300000 - 60000 - 1);
    assert.equal(net.calls[0].signal.aborted, false, 'still waiting just before 300 s');
    timers.tick(1);
    const r = await p;
    assert.equal(net.calls[0].signal.aborted, true, 'aborted at 300 s');
    assert.equal(r.is_exception, true);
});

k.coverage();
