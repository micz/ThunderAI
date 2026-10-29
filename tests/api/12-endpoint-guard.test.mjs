// Spec 04 "Custom endpoint policy" [#1000], the last line of defence in the classes of the two
// custom endpoints (js/api/ollama.js, js/api/openai_comp.js):
//  - every request method checks the host with checkEndpoint() against approved_insecure_origins
//    (a constructor option) BEFORE fetch(): a refused endpoint sends nothing and gives the
//    network-failure result {ok:false, is_exception:true, is_aborted:false, error}, plus
//    endpoint_problem;
//  - the workers pass the init message's approved_insecure_origins to the class: a worker has no
//    UI, it only knows what the window or the background approved;
//  - "Redirects": a failed redirect is reported by the workers with i18nStrings.api_error_redirect,
//    and every redirect outcome of a request is posted as an 'endpoint_redirect' message (the host
//    and the outcome, never the API key) for the owner of the worker to save.
// The other providers have fixed https hosts: the rule does not apply to them.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import {
    NET,
    redirectedTo
} from './fetch-model.mjs';
import {
    assertNoBrowser,
    initMessage,
    loadWorker,
    startTurn
} from './worker-realm.mjs';
import {
    jsonResponse,
    ndjson,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('12-endpoint-guard');
const { Ollama } = await import('../../js/api/ollama.js');
const { OpenAIComp } = await import('../../js/api/openai_comp.js');
const { ENDPOINT_PROBLEM } = await import('../../js/mzta-endpoint-policy.js');

const LAN = 'http://192.168.1.10:11434';

const CLIENTS = {
    ollama: {
        make: (host, approved) => new Ollama({ host, model: 'm', approved_insecure_origins: approved }),
        calls: c => [c.fetchResponse([], { maxRetries: 0 }), c.fetchModels({ maxRetries: 0 }),
            c.fetchVersion(), c.fetchModelInfo('m'), c.fetchRunningModels()],
        modelsUrl: host => host + '/api/tags',
    },
    openai_comp: {
        make: (host, approved) => new OpenAIComp({ host, model: 'm', approved_insecure_origins: approved }),
        calls: c => [c.fetchResponse([], 0, { maxRetries: 0 }), c.fetchModels({ maxRetries: 0 })],
        modelsUrl: host => host + '/v1/models',
    },
};

const REFUSED = [
    [LAN, ENDPOINT_PROBLEM.INSECURE],
    ['https://user:s3cr3t@api.example.test', ENDPOINT_PROBLEM.CREDENTIALS],
    ['http://:s3cr3t@localhost:11434', ENDPOINT_PROBLEM.CREDENTIALS],
    ['ftp://files.example.test', ENDPOINT_PROBLEM.SCHEME],
    ['', ENDPOINT_PROBLEM.INVALID],
];

for (const [id, C] of Object.entries(CLIENTS)) {
    const slug = id.replace('_', '-');
    k.test(slug + '-refused', `${id}: an unusable endpoint is refused by every method, with no fetch`, async () => {
        for (const [host, problem] of REFUSED) {
            for (const r of await Promise.all(C.calls(C.make(host, [])))) {
                assert.equal(r instanceof Response, false, host);
                assert.equal(r.ok, false, host);
                assert.equal(r.is_exception, true, host);
                assert.equal(r.is_aborted, false, host);
                assert.equal(r.endpoint_problem, problem, host);
                assert.equal(typeof r.error, 'string', host);
                assert.equal(r.error.includes('s3cr3t'), false, host + ': no credentials in the error');
            }
        }
        assert.equal(net.calls.length, 0, 'nothing was sent');
    });

    k.test(slug + '-approved', `${id}: an approved unencrypted origin is used`, async () => {
        net.expect(C.modelsUrl(LAN), () => jsonResponse(id === 'ollama' ? { models: [] } : { data: [] }));
        const r = await C.make(LAN, [LAN]).fetchModels({ maxRetries: 0 });
        assert.equal(r.ok, true);
    });

    k.test(slug + '-other-origin', `${id}: an approval of another origin does not count`, async () => {
        const r = await C.make(LAN, ['http://192.168.1.10:8080']).fetchModels({ maxRetries: 0 });
        assert.equal(r.endpoint_problem, ENDPOINT_PROBLEM.INSECURE);
        assert.equal(net.calls.length, 0);
    });
}

// ---- the Ollama worker: the init message carries the approvals ----------------------------

const w = await loadWorker('model-worker-ollama');
const FAILED = 'Ollama API request failed';
const REDIRECT = 'REDIRECT TEXT';
const strings = { ollama_api_request_failed: FAILED, error_connection_interrupted: 'cut', api_error_redirect: REDIRECT };
const errorOf = t => t.posted().filter(m => m.type === 'error');

k.test('worker-not-approved', 'worker: an origin missing from approved_insecure_origins fails the turn, nothing sent', async () => {
    await w.send(initMessage({ ollama_host: LAN, ollama_model: 'm', ollama_system_prompt: '' }, { i18nStrings: strings }));
    const turn = startTurn(w, 'q');
    await assert.rejects(turn.done);
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('not sent'), err.payload);
    assert.equal(net.calls.length, 0);
});

k.test('worker-approved', 'worker: with the origin in approved_insecure_origins the request goes out', async () => {
    await w.send(initMessage({ ollama_host: LAN, ollama_model: 'm', ollama_system_prompt: '',
        approved_insecure_origins: [LAN] }, { i18nStrings: strings }));
    net.expect(LAN + '/api/chat', () => jsonResponse({ error: 'stop here' }, { status: 404 }));
    const turn = startTurn(w, 'q');
    await assert.rejects(turn.done);
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].redirect, null, 'redirects are followed');
});

const redirectsOf = t => t.posted().filter(m => m.type === 'endpoint_redirect');
const KEYED = { ollama_host: 'http://localhost:11434/', ollama_model: 'm', ollama_system_prompt: '', ollama_api_key: 'ol-SECRET' };
const CHAT = 'http://localhost:11434/api/chat';

k.test('worker-redirect', 'worker: a redirect that could not be followed is reported with i18nStrings.api_error_redirect, and posted', async () => {
    await w.send(initMessage(KEYED, { i18nStrings: strings }));
    net.expect(CHAT, NET.networkError())
        .expect({ method: 'GET', url: CHAT }, () => new Response(null, { status: 301, headers: { location: 'https://x.example/' } }));
    const turn = startTurn(w, 'q');
    await assert.rejects(turn.done);
    assert.deepEqual(errorOf(turn).map(m => m.payload), [REDIRECT]);
    assert.deepEqual(redirectsOf(turn).map(m => m.payload),
        [{ host: 'http://localhost:11434', info: { redirected: true, url: '', failed: true } }]);
});

k.test('worker-redirect-followed', 'worker: a followed redirect is posted with its final address, and the answer flows', async () => {
    await w.send(initMessage(KEYED, { i18nStrings: strings }));
    net.expect(CHAT, () => redirectedTo('http://127.0.0.1:11434/api/chat',
        streamResponse([ndjson({ message: { role: 'assistant', content: 'hi' }, done: false }), ndjson({ done: true })])));
    const turn = startTurn(w, 'q');
    await turn.done;
    assert.deepEqual(errorOf(turn), []);
    const [msg] = redirectsOf(turn);
    assert.deepEqual(msg.payload, { host: 'http://localhost:11434', info: { redirected: true, url: 'http://127.0.0.1:11434/api/chat', from: CHAT, method: 'POST', failed: false } });
    assert.equal(JSON.stringify(msg).includes('ol-SECRET'), false, 'never the API key');
    assert.ok(turn.posted().findIndex(m => m.type === 'endpoint_redirect') < turn.posted().findIndex(m => m.type === 'messageSent'),
        'posted before messageSent');
});

k.test('worker-no-redirect', 'worker: a success with no redirect is posted too (the owner forgets the stored redirect); an HTTP error is not', async () => {
    await w.send(initMessage(KEYED, { i18nStrings: strings }));
    net.expect(CHAT, () => streamResponse([ndjson({ message: { role: 'assistant', content: 'hi' }, done: false }), ndjson({ done: true })]));
    const ok = startTurn(w, 'q');
    await ok.done;
    assert.deepEqual(redirectsOf(ok).map(m => m.payload.info), [{ redirected: false }]);
    net.expect(CHAT, () => jsonResponse({ error: 'no model' }, { status: 404 }));
    const failed = startTurn(w, 'q2');
    await assert.rejects(failed.done);
    assert.deepEqual(redirectsOf(failed), []);
});

k.coverage();
