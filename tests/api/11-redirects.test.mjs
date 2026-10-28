// Spec 04 "Redirects" [#1000], in js/api/api-retry.js and the provider classes:
//  - every API request follows redirects: no redirect mode is set, on any provider;
//  - with onRedirect (Ollama and OpenAI Comp only) the outcome of the call is reported: a followed
//    redirect with its final address (failed when the answer is an error, which then throws a
//    RedirectFailedError at once, with no retry), a success with no redirect, nothing for an error
//    with no redirect;
//  - with onRedirect, the first network failure of a call (not a timeout, not a user abort) is
//    checked once, before the first retry, with a bare GET (redirect: 'manual', credentials:
//    'omit', no headers, no body, 2 s limit): a 3xx answer (or an 'opaqueredirect' one, as a
//    browser reports it) throws a RedirectFailedError at once, with no retry; anything else lets
//    the original error go on as before (retried, then rethrown). Without onRedirect, no check;
//  - fetchDirect(), the single fetch() of Ollama's direct probes, tracks redirects the same way;
//  - the two classes keep the outcome in redirect_info and flag a failed redirect with
//    is_redirect; OpenAI, Claude and Gemini do neither, and never check.
// All timing on node:test mock timers (fakeTime): nothing here waits in real time.

import assert from 'node:assert/strict';
import {
    areaFile,
    consoleText,
    drive,
    fakeTime
} from './harness.mjs';
import {
    NET,
    redirectedTo
} from './fetch-model.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import {
    jsonResponse,
    textResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net, con } = areaFile('11-redirects');
const {
    fetchWithRetry,
    fetchDirect,
    RedirectFailedError,
    isRedirectFailed,
} = await import('../../js/api/api-retry.js');
const { taLogger } = await import('../../js/mzta-logger.js');
const { Ollama } = await import('../../js/api/ollama.js');
const { OpenAIComp } = await import('../../js/api/openai_comp.js');
const { OpenAI } = await import('../../js/api/openai_responses.js');
const { Anthropic } = await import('../../js/api/anthropic.js');
const { GoogleGemini } = await import('../../js/api/google_gemini.js');

const URL_ = 'https://api.example.test/v1/chat';
const FINAL = 'https://new.example.test/v1/chat';
const CHECK = { method: 'GET', url: URL_ };
const OK = () => jsonResponse({ ok: true });
const moved = (status = 301) => () => new Response(null, { status, headers: { location: 'https://elsewhere.example/' } });

// The outcomes onRedirect receives, in order.
function recorder() {
    const seen = [];
    return { seen, onRedirect: info => seen.push(info) };
}

// ---- fetchWithRetry(): redirects followed -----------------------------------------------------

k.test('follow-mode', 'no redirect mode is set: fetch() follows redirects, with or without onRedirect', async () => {
    net.expect(URL_, OK).expect(URL_, OK);
    await fetchWithRetry(URL_, { method: 'POST', body: '{}' }, { maxRetries: 0 });
    await fetchWithRetry(URL_, { method: 'POST', body: '{}' }, { maxRetries: 0, onRedirect: () => {} });
    assert.deepEqual(net.calls.map(c => c.redirect), [null, null]);
});

k.test('followed-ok', 'a followed redirect that succeeds: reported with the final and the requested address, the response returned, no check', async () => {
    const r = recorder();
    net.expect(URL_, () => redirectedTo(FINAL, jsonResponse({ ok: true })));
    const res = await fetchWithRetry(URL_, { method: 'POST' }, { maxRetries: 0, onRedirect: r.onRedirect });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(r.seen, [{ redirected: true, url: FINAL, from: URL_, method: 'POST', failed: false }]);
    assert.equal(net.calls.length, 1);
});

for (const status of [404, 405, 503]) {
    k.test('followed-error-' + status, `a followed redirect ending in a ${status}: RedirectFailedError at once, failed with the final address, no retry`, async (t) => {
        const timers = fakeTime(t);
        const r = recorder();
        const retries = [];
        net.expect(URL_, () => redirectedTo(FINAL, textResponse('Method Not Allowed', { status })));
        const p = fetchWithRetry(URL_, { method: 'POST', body: '{"mail":"text"}' },
            { onRedirect: r.onRedirect, onRetry: info => retries.push(info) });
        await assert.rejects(drive(p, timers), e => e instanceof RedirectFailedError && isRedirectFailed(e));
        assert.deepEqual(r.seen, [{ redirected: true, url: FINAL, from: URL_, method: 'POST', failed: true }]);
        assert.equal(retries.length, 0);
        assert.equal(net.calls.length, 1);
    });
}

k.test('followed-no-tracking', 'without onRedirect a followed redirect ending in an error is an ordinary error response', async () => {
    net.expect(URL_, () => redirectedTo(FINAL, textResponse('nope', { status: 405 })));
    const res = await fetchWithRetry(URL_, { method: 'POST' }, { maxRetries: 0 });
    assert.equal(res.status, 405);
});

k.test('direct-ok', 'a success with no redirect is reported as {redirected: false}', async () => {
    const r = recorder();
    net.expect(URL_, OK);
    await fetchWithRetry(URL_, {}, { maxRetries: 0, onRedirect: r.onRedirect });
    assert.deepEqual(r.seen, [{ redirected: false }]);
});

k.test('direct-error', 'an error with no redirect reports nothing', async () => {
    const r = recorder();
    net.expect(URL_, () => jsonResponse({ error: 'no' }, { status: 401 }));
    const res = await fetchWithRetry(URL_, {}, { maxRetries: 0, onRedirect: r.onRedirect });
    assert.equal(res.status, 401);
    assert.deepEqual(r.seen, []);
});

k.test('callback-throws', 'a failing onRedirect never breaks the request', async () => {
    net.expect(URL_, OK);
    const res = await fetchWithRetry(URL_, {}, { maxRetries: 0, onRedirect: () => { throw new Error('boom'); } });
    assert.equal(res.status, 200);
});

// ---- fetchWithRetry(): the check after a network failure ----------------------------------------

for (const status of [301, 302, 307, 308]) {
    k.test('probe-' + status, `a ${status} found by the check ends the call at once: RedirectFailedError, no retry, no destination`, async (t) => {
        const timers = fakeTime(t);
        const r = recorder();
        const retries = [];
        net.expect(URL_, NET.networkError()).expect(CHECK, moved(status));
        const p = fetchWithRetry(URL_, { method: 'POST', headers: { 'x-api-key': 'sk-FAKE' }, body: '{"mail":"text"}' },
            { onRedirect: r.onRedirect, onRetry: info => retries.push(info) });
        await assert.rejects(drive(p, timers), e => e instanceof RedirectFailedError && isRedirectFailed(e));
        assert.deepEqual(r.seen, [{ redirected: true, url: '', failed: true }]);
        assert.equal(retries.length, 0);
        assert.equal(net.calls.length, 2);
    });
}

k.test('check-is-bare', 'the check is a GET with redirect: manual and credentials: omit, without headers or body', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError()).expect(CHECK, moved());
    const p = fetchWithRetry(URL_, { method: 'POST', headers: { 'x-api-key': 'sk-FAKE' }, body: '{"mail":"text"}' },
        { onRedirect: () => {} });
    await assert.rejects(drive(p, timers), RedirectFailedError);
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
    await assert.rejects(drive(fetchWithRetry(URL_, {}, { onRedirect: () => {} }), timers), RedirectFailedError);
});

k.test('not-a-redirect', 'any other answer to the check: the original error goes on, retried, then rethrown; checked once per call', async (t) => {
    const timers = fakeTime(t);
    const r = recorder();
    const retries = [];
    net.expect(URL_, NET.networkError('first')).expect(CHECK, () => textResponse('nope', { status: 405 }))
        .expect(URL_, NET.networkError('second'))
        .expect(URL_, NET.networkError('last'));
    const p = fetchWithRetry(URL_, { method: 'POST' },
        { maxRetries: 2, onRedirect: r.onRedirect, onRetry: info => retries.push(info) });
    await assert.rejects(drive(p, timers), e => e instanceof TypeError && e.message === 'last');
    assert.equal(retries.length, 2);
    assert.equal(retries[0].reason, 'network');
    assert.equal(net.calls.length, 4, 'the check runs once, before the first retry, not after every failure');
    assert.equal(net.calls[1].redirect, 'manual');
    assert.deepEqual(r.seen, []);
});

k.test('check-limit', 'a check that does not answer within 2 s means "not a redirect"', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError()).expect(CHECK, NET.hang).expect(URL_, OK);
    const p = fetchWithRetry(URL_, {}, { maxRetries: 1, retryDelaysMs: [0], onRedirect: () => {} });
    const res = await drive(p, timers);
    assert.equal(res.status, 200);
    assert.equal(net.calls[2].t - net.calls[1].t, 2000);
});

k.test('no-check-without-tracking', 'without onRedirect a network failure is never checked', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.networkError()).expect(URL_, OK);
    const res = await drive(fetchWithRetry(URL_, {}, { maxRetries: 1 }), timers);
    assert.equal(res.status, 200);
    assert.equal(net.calls.length, 2);
    assert.equal(net.calls[1].redirect, null);
});

k.test('timeout-not-checked', 'a per-attempt timeout is not a redirect: no check', async (t) => {
    const timers = fakeTime(t);
    net.expect(URL_, NET.hang).expect(URL_, OK);
    const r = await drive(fetchWithRetry(URL_, {}, { timeoutMs: 1000, onRedirect: () => {} }), timers);
    assert.equal(r.status, 200);
    assert.equal(net.calls.length, 2);
});

k.test('abort-not-checked', 'a user abort is not a redirect: no check', async (t) => {
    const timers = fakeTime(t);
    const ctrl = new AbortController();
    net.expect(URL_, () => { ctrl.abort(new DOMException('stopped', 'AbortError')); throw new TypeError('aborted'); });
    const p = fetchWithRetry(URL_, {}, { signal: ctrl.signal, onRedirect: () => {} });
    await assert.rejects(drive(p, timers));
    assert.equal(net.calls.length, 1);
});

k.test('log-no-url', 'the redirect is logged without the URL (and the key in its query string)', async (t) => {
    const timers = fakeTime(t);
    const KEY = 'FAKE-KEY-IN-QUERY';
    const url = 'https://llm.example.test/v1/models?key=' + KEY;
    net.expect(url, NET.networkError()).expect(url, moved());
    const logger = new taLogger('model-worker-openai_comp', true);
    await assert.rejects(drive(fetchWithRetry(url, {}, { logger, label: 'OpenAI Comp', onRedirect: () => {} }), timers),
        RedirectFailedError);
    const text = consoleText(con);
    assert.ok(text.includes('redirect'), 'the redirect was logged');
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes('llm.example.test'), false);
});

// ---- fetchDirect(): the single fetch() of Ollama's probes -------------------------------------

k.test('direct-probe', 'fetchDirect(): redirects followed and reported, the same check, no retry', async () => {
    const r = recorder();
    net.expect(URL_, OK);
    await fetchDirect(URL_, { method: 'GET' }, { onRedirect: r.onRedirect });
    assert.equal(net.calls[0].redirect, null);
    net.expect(URL_, () => redirectedTo(FINAL, jsonResponse({ version: '1' })));
    assert.equal((await fetchDirect(URL_, { method: 'GET' }, { onRedirect: r.onRedirect })).status, 200);
    net.expect(URL_, () => redirectedTo(FINAL, textResponse('nope', { status: 405 })));
    await assert.rejects(fetchDirect(URL_, { method: 'GET' }, { onRedirect: r.onRedirect }), RedirectFailedError);
    net.expect(URL_, NET.networkError()).expect(CHECK, moved(302));
    await assert.rejects(fetchDirect(URL_, { method: 'GET' }, { onRedirect: r.onRedirect }), RedirectFailedError);
    net.expect(URL_, NET.networkError('down')).expect(CHECK, NET.networkError());
    await assert.rejects(fetchDirect(URL_, { method: 'GET' }, { onRedirect: r.onRedirect }),
        e => e instanceof TypeError && e.message === 'down');
    assert.deepEqual(r.seen, [
        { redirected: false },
        { redirected: true, url: FINAL, from: URL_, method: 'GET', failed: false },
        { redirected: true, url: FINAL, from: URL_, method: 'GET', failed: true },
        { redirected: true, url: '', failed: true },
    ]);
});

// ---- the classes: redirect_info and is_redirect -------------------------------------------

const OLLAMA = 'http://localhost:11434';
const COMP = 'https://api.example.test';

k.test('class-ollama-followed', 'Ollama fetchResponse(): a followed redirect leaves redirect_info, the response goes on', async () => {
    const ollama = new Ollama({ host: OLLAMA, model: 'm' });
    assert.equal(ollama.redirect_info, null);
    net.expect(OLLAMA + '/api/chat', () => redirectedTo('http://127.0.0.1:11434/api/chat', jsonResponse({ done: true })));
    const r = await ollama.fetchResponse([], { maxRetries: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(ollama.redirect_info, { redirected: true, url: 'http://127.0.0.1:11434/api/chat', from: OLLAMA + '/api/chat', method: 'POST', failed: false });
    net.expect(OLLAMA + '/api/chat', () => jsonResponse({ done: true }));
    await ollama.fetchResponse([], { maxRetries: 0 });
    assert.deepEqual(ollama.redirect_info, { redirected: false }, 'each call reports its own outcome');
});

k.test('class-ollama-probe', 'Ollama fetchResponse(): a redirect found by the check gives is_redirect and no destination', async () => {
    const ollama = new Ollama({ host: OLLAMA, model: 'm' });
    net.expect(OLLAMA + '/api/chat', NET.networkError()).expect({ method: 'GET', url: OLLAMA + '/api/chat' }, moved());
    const r = await ollama.fetchResponse([], { maxRetries: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.is_exception, true);
    assert.equal(r.is_redirect, true);
    assert.deepEqual(ollama.redirect_info, { redirected: true, url: '', failed: true });
});

k.test('class-ollama-version', 'Ollama fetchVersion(), a direct probe: a redirect ending in an error gives is_redirect', async () => {
    const ollama = new Ollama({ host: OLLAMA });
    net.expect(OLLAMA + '/api/version', () => redirectedTo('https://ollama.example/api/version', textResponse('', { status: 404 })));
    const r = await ollama.fetchVersion();
    assert.equal(net.calls[0].redirect, null);
    assert.equal(r.is_redirect, true);
    assert.deepEqual(ollama.redirect_info, { redirected: true, url: 'https://ollama.example/api/version', from: OLLAMA + '/api/version', method: 'GET', failed: true });
});

k.test('class-comp-models', 'OpenAI Comp fetchModels(): is_redirect; a plain network error is not one', async () => {
    const models = COMP + '/v1/models';
    const comp = new OpenAIComp({ host: COMP });
    net.expect(models, NET.networkError()).expect({ method: 'GET', url: models }, moved(308));
    const r = await comp.fetchModels({ maxRetries: 0 });
    assert.equal(r.is_redirect, true);
    net.expect(models, NET.networkError()).expect({ method: 'GET', url: models }, NET.networkError());
    const r2 = await comp.fetchModels({ maxRetries: 0 });
    assert.equal(r2.is_exception, true);
    assert.equal(r2.is_redirect, false);
    assert.equal(comp.redirect_info, null, 'a network failure that is not a redirect says nothing');
});

k.test('class-comp-chat', 'OpenAI Comp fetchResponse(): a followed redirect ending in a 405 gives is_redirect, not the HTTP error', async () => {
    const chat = COMP + '/v1/chat/completions';
    const comp = new OpenAIComp({ host: COMP, model: 'm' });
    net.expect(chat, () => redirectedTo('https://other.example/v1/chat/completions', textResponse('Method Not Allowed', { status: 405 })));
    const r = await comp.fetchResponse([], 0, { maxRetries: 0 });
    assert.equal(r instanceof Response, false);
    assert.equal(r.is_redirect, true);
    assert.equal(comp.redirect_info.failed, true);
});

k.test('official-no-check', 'OpenAI, Claude and Gemini: a network failure is never checked, and no redirect is flagged', async () => {
    const cases = [
        [/api\.openai\.com\/v1\/responses/, () => new OpenAI({ apiKey: 'sk-FAKE', model: 'gpt-4.1-nano' }).fetchResponse([], null, { maxRetries: 0 })],
        [/api\.anthropic\.com\/v1\/messages/, () => new Anthropic({ apiKey: 'sk-ant-FAKE', version: '2023-06-01', model: 'c' }).fetchResponse([], { maxRetries: 0 })],
        [/generativelanguage\.googleapis\.com/, () => new GoogleGemini({ apiKey: 'FAKE-KEY', model: 'g' }).fetchResponse([], { maxRetries: 0 })],
    ];
    for (const [url, call] of cases) {
        net.reset();
        net.expect(url, NET.networkError());
        const r = await call();
        assert.equal(r.is_exception, true);
        assert.equal('is_redirect' in r, false);
        assert.equal(net.calls.length, 1, 'no check after the failure');
    }
});

k.test('official-followed', 'OpenAI, Claude and Gemini follow a redirect silently: no redirect mode, the error response returned as is', async () => {
    net.expect(/api\.openai\.com\/v1\/models/, () => redirectedTo('https://elsewhere.example/', textResponse('nope', { status: 404 })));
    const r = await new OpenAI({ apiKey: 'sk-FAKE' }).fetchModels({ maxRetries: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.equal('is_redirect' in r, false);
    net.expect(/api\.anthropic\.com\/v1\/models\//, () => jsonResponse({ max_input_tokens: 1 }));
    await new Anthropic({ apiKey: 'sk-ant-FAKE', version: '2023-06-01' }).fetchModelInfo('claude-x');
    net.expect(/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-x/, () => jsonResponse({ inputTokenLimit: 1 }));
    await new GoogleGemini({ apiKey: 'FAKE-KEY' }).fetchModelInfo('gemini-x');
    assert.deepEqual(net.calls.map(c => c.redirect), [null, null, null]);
});

k.coverage();
