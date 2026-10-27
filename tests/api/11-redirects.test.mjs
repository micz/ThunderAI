// Spec 04 "Redirects" [#1000], in js/api/api-retry.js and the provider classes:
//  - every API request is sent with redirect: 'error', through fetchWithRetry() or, for the
//    direct probes, fetchNoRedirect(): a redirect is never followed;
//  - a refused redirect surfaces as a network error (TypeError). After the first one of a call
//    the URL is checked once with a bare GET (redirect: 'manual', credentials: 'omit', no
//    headers, no body): a 3xx answer (or an 'opaqueredirect' one, as a browser reports it)
//    throws a RedirectRefusedError at once, with no retry; anything else lets the original
//    error go on as before (retried, then rethrown);
//  - the classes flag the error result with is_redirect, and a redirect is logged without the URL.
// All timing on node:test mock timers (fakeTime): nothing here waits in real time.

import assert from 'node:assert/strict';
import {
    areaFile,
    consoleText,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import {
    jsonResponse,
    textResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('11-redirects');
const {
    fetchWithRetry,
    fetchNoRedirect,
    RedirectRefusedError,
    isRedirectRefused,
} = await import('../../js/api/api-retry.js');
const { taLogger } = await import('../../js/mzta-logger.js');
const { Ollama } = await import('../../js/api/ollama.js');
const { OpenAIComp } = await import('../../js/api/openai_comp.js');
const { Anthropic } = await import('../../js/api/anthropic.js');
const { GoogleGemini } = await import('../../js/api/google_gemini.js');

const URL_ = 'https://api.example.test/v1/chat';
const CHECK = { method: 'GET', url: URL_ };
const OK = () => jsonResponse({ ok: true });
const moved = (status = 301) => () => new Response(null, { status, headers: { location: 'https://elsewhere.example/' } });

k.test('redirect-error-mode', 'fetchWithRetry() sends every request with redirect: error', async () => {
    net.expect(URL_, OK);
    await fetchWithRetry(URL_, { method: 'POST', body: '{}', redirect: 'follow' }, { maxRetries: 0 });
    assert.equal(net.calls[0].redirect, 'error', 'a caller cannot turn it back on');
});

for (const status of [301, 302, 307, 308]) {
    k.test('redirect-' + status, `a ${status} found by the check ends the call at once: RedirectRefusedError, no retry`, async (t) => {
        const timers = fakeTime(t);
        const retries = [];
        net.expect(URL_, NET.networkError()).expect(CHECK, moved(status));
        const p = fetchWithRetry(URL_, { method: 'POST', headers: { 'x-api-key': 'sk-FAKE' }, body: '{"mail":"text"}' },
            { onRetry: info => retries.push(info) });
        await assert.rejects(drive(p, timers), e => e instanceof RedirectRefusedError && isRedirectRefused(e));
        assert.equal(retries.length, 0);
        assert.equal(net.calls.length, 2);
    });
}

k.test('check-is-bare', 'the check is a GET with redirect: manual and credentials: omit, without headers or body', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError()).expect(CHECK, moved());
    const p = fetchWithRetry(URL_, { method: 'POST', headers: { 'x-api-key': 'sk-FAKE' }, body: '{"mail":"text"}' });
    await assert.rejects(drive(p, timers), RedirectRefusedError);
    const check = net.calls[1];
    assert.equal(check.method, 'GET');
    assert.equal(check.redirect, 'manual');
    assert.equal(check.credentials, 'omit');
    assert.deepEqual(check.headers, {});
    assert.equal(check.body, undefined);
});

k.test('opaque-redirect', 'a browser\'s opaqueredirect answer counts as a redirect', async (t) => {
    const timers = fakeTime(t);
    // Node's Response cannot be built as one: its type is set on a bodiless 200, so only the
    // type can make it count.
    const opaque = () => Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' });
    net.expect(URL_, NET.networkError()).expect(CHECK, opaque);
    await assert.rejects(drive(fetchWithRetry(URL_, {}), timers), RedirectRefusedError);
});

k.test('not-a-redirect', 'any other answer to the check: the original error goes on, retried, then rethrown', async (t) => {
    const timers = fakeTime(t);
    const retries = [];
    net.expect(URL_, NET.networkError('first')).expect(CHECK, () => textResponse('nope', { status: 405 }))
        .expect(URL_, NET.networkError('last'));
    const p = fetchWithRetry(URL_, { method: 'POST' }, { maxRetries: 1, onRetry: info => retries.push(info) });
    await assert.rejects(drive(p, timers), e => e instanceof TypeError && e.message === 'last');
    assert.equal(retries.length, 1);
    assert.equal(retries[0].reason, 'network');
});

k.test('timeout-not-checked', 'a per-attempt timeout is not a redirect: no check', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.hang).expect(URL_, OK);
    const r = await drive(fetchWithRetry(URL_, {}, { timeoutMs: 1000 }), timers);
    assert.equal(r.status, 200);
    assert.equal(net.calls.length, 2);
});

k.test('log-no-url', 'the redirect is logged without the URL (and the key in its query string)', async (t) => {
    const timers = fakeTime(t);
    const KEY = 'FAKE-KEY-IN-QUERY';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + KEY;
    net.expect(url, NET.networkError()).expect(url, moved());
    const logger = new taLogger('model-worker-google_gemini', true);
    await assert.rejects(drive(fetchWithRetry(url, {}, { logger, label: 'Google Gemini' }), timers), RedirectRefusedError);
    const text = consoleText(con);
    assert.ok(text.includes('redirect'), 'the redirect was logged');
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes('googleapis'), false);
});

k.test('no-redirect-direct', 'fetchNoRedirect(): redirect: error, the same check, no retry', async () => {
    net.expect(URL_, OK);
    await fetchNoRedirect(URL_, { method: 'GET' });
    assert.equal(net.calls[0].redirect, 'error');
    net.expect(URL_, NET.networkError()).expect(CHECK, moved(302));
    await assert.rejects(fetchNoRedirect(URL_, { method: 'GET' }), RedirectRefusedError);
    net.expect(URL_, NET.networkError('down')).expect(CHECK, NET.networkError());
    await assert.rejects(fetchNoRedirect(URL_, { method: 'GET' }), e => e instanceof TypeError && e.message === 'down');
});

// ---- the classes: is_redirect on the error result -----------------------------------------

const OLLAMA = 'http://localhost:11434';
const COMP = 'https://api.example.test';

k.test('class-ollama-chat', 'Ollama fetchResponse(): a redirect gives {ok:false, is_exception, is_redirect}', async () => {
    net.expect(OLLAMA + '/api/chat', NET.networkError()).expect({ method: 'GET', url: OLLAMA + '/api/chat' }, moved());
    const r = await new Ollama({ host: OLLAMA, model: 'm' }).fetchResponse([], { maxRetries: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.is_exception, true);
    assert.equal(r.is_redirect, true);
});

k.test('class-ollama-version', 'Ollama fetchVersion(), a direct probe: redirect: error, and is_redirect', async () => {
    net.expect(OLLAMA + '/api/version', NET.networkError()).expect({ method: 'GET', url: OLLAMA + '/api/version' }, moved());
    const r = await new Ollama({ host: OLLAMA }).fetchVersion();
    assert.equal(net.calls[0].redirect, 'error');
    assert.equal(r.is_redirect, true);
});

k.test('class-comp-models', 'OpenAI Comp fetchModels(): is_redirect; a plain network error is not one', async () => {
    const models = COMP + '/v1/models';
    net.expect(models, NET.networkError()).expect({ method: 'GET', url: models }, moved(308));
    const r = await new OpenAIComp({ host: COMP }).fetchModels({ maxRetries: 0 });
    assert.equal(r.is_redirect, true);
    net.expect(models, NET.networkError()).expect({ method: 'GET', url: models }, NET.networkError());
    const r2 = await new OpenAIComp({ host: COMP }).fetchModels({ maxRetries: 0 });
    assert.equal(r2.is_exception, true);
    assert.equal(r2.is_redirect, false);
});

k.test('class-model-info', 'the model info of Claude and Gemini is fetched with redirect: error', async () => {
    net.expect(/api\.anthropic\.com\/v1\/models\//, () => jsonResponse({ max_input_tokens: 1 }));
    await new Anthropic({ apiKey: 'sk-ant-FAKE', version: '2023-06-01' }).fetchModelInfo('claude-x');
    net.expect(/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-x/, () => jsonResponse({ inputTokenLimit: 1 }));
    await new GoogleGemini({ apiKey: 'FAKE-KEY' }).fetchModelInfo('gemini-x');
    assert.deepEqual(net.calls.map(c => c.redirect), ['error', 'error']);
});

k.coverage();
