// Spec 04 "Error contract between js/api/* and workers", for the five provider classes:
//  - network-level exception (unreachable, DNS, CORS, per-attempt timeout once the retries are
//    used up): fetchResponse() returns a plain object {ok: false, is_exception: true, is_aborted,
//    error} with NO status and NO statusText, `error` already including the provider name;
//  - user abort before any response: the same shape with is_aborted: true;
//  - HTTP error: a real Response, status/statusText/JSON body available.
// And spec 04 "Automatic Retry Handling": every provider class uses fetchWithRetry() for
// fetchResponse() AND fetchModels(), both taking an optional trailing retryConfig.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { NET } from './fetch-model.mjs';
import { flush } from './worker-realm.mjs';
import {
    apiFixture,
    jsonResponse
} from './wire.mjs';

const { k, net } = areaFile('26-client-error-contract');
const { Anthropic } = await import('../../js/api/anthropic.js');
const { GoogleGemini } = await import('../../js/api/google_gemini.js');
const { Ollama } = await import('../../js/api/ollama.js');
const { OpenAIComp } = await import('../../js/api/openai_comp.js');
const { OpenAI } = await import('../../js/api/openai_responses.js');

const MSG = [{ role: 'user', content: 'Hi' }];

const PROVIDERS = {
    anthropic: {
        name: /Claude|Anthropic/,
        make: () => new Anthropic({ apiKey: 'sk-ant-FAKE', version: '2023-06-01', model: 'claude-sonnet-4-5' }),
        chat: (c, rc) => c.fetchResponse(MSG, rc),
        chatUrl: 'https://api.anthropic.com/v1/messages',
        modelsUrl: 'https://api.anthropic.com/v1/models',
        models: apiFixture('anthropic.json').models.body,
        error: apiFixture('anthropic.json').error_401.body,
    },
    google_gemini: {
        name: /Gemini/,
        make: () => new GoogleGemini({ apiKey: 'FAKE-KEY', model: 'gemini-2.5-flash', stream: true }),
        chat: (c, rc) => c.fetchResponse([{ role: 'user', parts: [{ text: 'Hi' }] }], rc),
        chatUrl: /:streamGenerateContent\?/,
        modelsUrl: /\/v1beta\/models\?key=/,
        models: apiFixture('google_gemini.json').models.body,
        error: apiFixture('google_gemini.json').error_400_key.body,
    },
    ollama: {
        name: /Ollama/,
        make: () => new Ollama({ host: 'http://localhost:11434', model: 'llama3.2', stream: true }),
        chat: (c, rc) => c.fetchResponse(MSG, rc),
        chatUrl: 'http://localhost:11434/api/chat',
        modelsUrl: 'http://localhost:11434/api/tags',
        models: { models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] },
        error: apiFixture('ollama.json').error_404_model.body,
    },
    openai_comp: {
        name: /OpenAI Comp/,
        make: () => new OpenAIComp({ host: 'https://api.example.test', model: 'm', apiKey: 'sk-FAKE', stream: true }),
        chat: (c, rc) => c.fetchResponse(MSG, 0, rc),
        chatUrl: 'https://api.example.test/v1/chat/completions',
        modelsUrl: 'https://api.example.test/v1/models',
        models: { object: 'list', data: [{ id: 'm', object: 'model' }] },
        error: apiFixture('openai_comp.json').error_401.body,
    },
    openai_responses: {
        name: /OpenAI/,
        make: () => new OpenAI({ apiKey: 'sk-FAKE', model: 'gpt-4.1-nano', stream: true }),
        chat: (c, rc) => c.fetchResponse(MSG, null, rc),
        chatUrl: 'https://api.openai.com/v1/responses',
        modelsUrl: 'https://api.openai.com/v1/models',
        models: { object: 'list', data: [{ id: 'gpt-4.1-nano', object: 'model', created: 1, owned_by: 'system' }] },
        error: apiFixture('openai_responses.json').error_401.body,
    },
};

for (const [id, P] of Object.entries(PROVIDERS)) {
    k.test(id + '-network', `${id}: a network exception gives {ok:false, is_exception:true, is_aborted:false, error} and no status`, async () => {
        net.expect(P.chatUrl, NET.networkError('NetworkError when attempting to fetch resource.'));
        const r = await P.chat(P.make(), { maxRetries: 0 });
        assert.equal(r instanceof Response, false);
        assert.equal(r.ok, false);
        assert.equal(r.is_exception, true);
        assert.equal(r.is_aborted, false);
        assert.equal('status' in r, false, 'no status');
        assert.equal('statusText' in r, false, 'no statusText');
        assert.equal(typeof r.error, 'string');
        assert.match(r.error, P.name, 'the provider name is already in error');
        assert.ok(r.error.includes('NetworkError when attempting to fetch resource.'), 'with the underlying failure');
    });

    k.test(id + '-abort', `${id}: a user abort before any response gives is_aborted: true`, async () => {
        const ctrl = new AbortController();
        net.expect(P.chatUrl, NET.hang);
        const p = P.chat(P.make(), { signal: ctrl.signal });
        await flush();
        ctrl.abort();
        const r = await p;
        assert.equal(r.ok, false);
        assert.equal(r.is_exception, true);
        assert.equal(r.is_aborted, true);
        assert.equal('status' in r, false);
        assert.equal(net.calls.length, 1, 'not retried');
    });

    k.test(id + '-http', `${id}: an HTTP error comes back as the real Response, body readable`, async () => {
        net.expect(P.chatUrl, () => jsonResponse(P.error, { status: 401, statusText: 'Unauthorized' }));
        const r = await P.chat(P.make(), { maxRetries: 0 });
        assert.ok(r instanceof Response);
        assert.equal(r.status, 401);
        assert.equal(r.statusText, 'Unauthorized');
        assert.deepEqual(await r.json(), P.error);
    });

    k.test(id + '-models-retry', `${id}: fetchModels() goes through the retry and takes a trailing retryConfig`, async () => {
        const retries = [];
        net.expect(P.modelsUrl, () => jsonResponse({ error: { message: 'busy' } }, { status: 503 }))
            .expect(P.modelsUrl, () => jsonResponse(P.models));
        const r = await P.make().fetchModels({ retryDelaysMs: [0], onRetry: i => retries.push(i) });
        assert.equal(r.ok, true);
        assert.equal(retries.length, 1);
        assert.equal(retries[0].status, 503);
    });

    // Spec 04 "Error contract between js/api/* and workers", "fetchModels() and fetchVersion()": a
    // success carries the model list; a 200 whose JSON has none is an exception. OpenAI Comp turns
    // it into an empty list instead (spec 05 "Update list"); Ollama's /api/tags answer is passed on
    // as it is, and the page reports "no models".
    k.test(id + '-models-http', `${id}: fetchModels() on an HTTP error gives {ok:false, error: <body>, status, statusText}`, async () => {
        net.expect(P.modelsUrl, () => jsonResponse(P.error, { status: 401, statusText: 'Unauthorized' }));
        const r = await P.make().fetchModels({ maxRetries: 0 });
        assert.equal(r.ok, false);
        assert.equal(r.is_exception, undefined);
        assert.deepEqual(JSON.parse(r.error), P.error);
        assert.equal(r.status, 401);
        assert.equal(r.statusText, 'Unauthorized');
    });

    k.test(id + '-models-no-list', `${id}: fetchModels() on a 200 with no model list`, async () => {
        net.expect(P.modelsUrl, () => jsonResponse({}));
        const r = await P.make().fetchModels({ maxRetries: 0 });
        if (id === 'openai_comp') {
            assert.deepEqual(r, { ok: true, response: [] });
        } else if (id === 'ollama') {
            assert.equal(r.ok, true);
            assert.deepEqual(r.response, {});
        } else {
            assert.equal(r.ok, false, JSON.stringify(r));
            assert.equal(r.is_exception, true);
            assert.match(r.error, P.name);
        }
    });
}

k.test('ollama-version-no-version', 'ollama: fetchVersion() on a 200 with no version string is an exception', async () => {
    net.expect('http://localhost:11434/api/version', () => jsonResponse({}));
    const r = await PROVIDERS.ollama.make().fetchVersion();
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.is_exception, true);
    assert.match(r.error, /Ollama/);
});

k.test('ollama-version-http', 'ollama: fetchVersion() on an HTTP error carries the status', async () => {
    net.expect('http://localhost:11434/api/version', () => new Response('', { status: 502, statusText: 'Bad Gateway' }));
    const r = await PROVIDERS.ollama.make().fetchVersion();
    assert.deepEqual(r, { ok: false, error: '', status: 502, statusText: 'Bad Gateway' });
});

k.test('ollama-version-ok', 'ollama: fetchVersion() with a version string succeeds and passes the answer on', async () => {
    net.expect('http://localhost:11434/api/version', () => jsonResponse({ version: '0.12.0' }));
    const r = await PROVIDERS.ollama.make().fetchVersion();
    assert.deepEqual(r, { ok: true, response: { version: '0.12.0' } });
});

k.coverage();
