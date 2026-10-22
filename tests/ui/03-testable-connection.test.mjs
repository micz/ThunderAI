// Spec 05 "Connection Settings Panel — Connection Test Status Strip", the test logic shared by
// every host (js/mzta-connection-test.js): which connection types have a testable endpoint
// (isTestableConnection() / getTestableConnection(), every type but chatgpt_web, and nothing for
// the empty "inherit" value), the registry entry of each (its display name, the optional
// `testMethod`, fetchVersion for Ollama only), and the field-id prefix both callbacks receive:
// `makeClient` and `requestPermission` read the fields of the form they are given ('' on the
// options page and in the wizard, `<feature>_` on a feature page with its own connection), never
// another form's. Spec 04 "Optional Permissions" for the origins of the two cloud providers it
// names. And what runConnectionTest() reports for an HTTP error (spec 05 "Test logic": a rejected
// key, a 403, the provider's message, the status of an empty answer).
//
// What the page shows and stores for each outcome is in the DOM files (options/ui-02,
// setup-wizard/ui-01, translate/ui-03); what the clients do with an answer is the api area's.
//
// Level 1: nothing imported here reaches jsdom. The form is a minimal `document` with
// getElementById(), the only thing the module reads from it; fetch is recorded and answers 200.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';

let ctx, ct, valid_connection_types;
const requests = [];
const fetches = [];
let nextAnswer = null;      // () => Response for the next fetch only
const realFetch = globalThis.fetch;

before(async () => {
    ctx = await startBackground();
    ({ valid_connection_types } = await import(new URL('options/mzta-options-default.js', REPO).href));
    ctx.ctl.browser.permissions = {
        async request(q) { requests.push(q.origins); return true; },
    };
    ct = await import(new URL('js/mzta-connection-test.js', REPO).href);
    globalThis.fetch = async (input, init = {}) => {
        fetches.push({ url: String(input), headers: new Headers(init.headers) });
        if (nextAnswer) { const a = nextAnswer; nextAnswer = null; return a(); }
        return new Response(JSON.stringify({ data: [], models: [], version: '0.6.0' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
});
after(() => {
    globalThis.fetch = realFetch;
    delete globalThis.document;
});

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const API_TYPES = ['chatgpt_api', 'google_gemini_api', 'anthropic_api', 'ollama_api', 'openai_comp_api'];

// ---- which types are testable ---------------------------------------------------------------

test('every connection type but chatgpt_web is testable, and the list covers every valid type', () => {
    assert.deepEqual([...valid_connection_types].sort(), ['chatgpt_web', ...API_TYPES].sort(),
        'a connection type was added: decide whether it is testable and add it here');
    for (const type of API_TYPES) {
        assert.equal(ct.isTestableConnection(type), true, type);
        assert.ok(ct.getTestableConnection(type), type);
    }
    assert.equal(ct.isTestableConnection('chatgpt_web'), false);
    assert.equal(ct.getTestableConnection('chatgpt_web'), null);
});

test('the empty "inherit" value, a missing and an unknown type are not testable', () => {
    for (const type of ['', null, undefined, 'no_such_api']) {
        assert.equal(ct.isTestableConnection(type), false, String(type));
        assert.equal(ct.getTestableConnection(type), null, String(type));
    }
});

test('each entry names the provider with the catalogue\'s label', () => {
    const LABEL = {
        chatgpt_api: 'prefs_Connection_type_ChatGPT_API',
        google_gemini_api: 'prefs_Connection_type_Google_Gemini_API',
        anthropic_api: 'prefs_Connection_type_Anthropic_API',
        ollama_api: 'prefs_Connection_type_Ollama_API',
        openai_comp_api: 'prefs_Connection_type_OpenAI_Comp_API',
    };
    for (const type of API_TYPES) {
        const { nameKey } = ct.getTestableConnection(type);
        assert.equal(nameKey, LABEL[type], type);
        assert.notEqual(msg(nameKey), '', type);
    }
});

test('`testMethod`: Ollama probes with fetchVersion; every other provider keeps the default, fetchModels', () => {
    for (const type of API_TYPES) {
        const { testMethod } = ct.getTestableConnection(type);
        assert.equal(testMethod ?? 'fetchModels', type === 'ollama_api' ? 'fetchVersion' : 'fetchModels', type);
    }
});

// ---- the field-id prefix ---------------------------------------------------------------------

// Two forms on the same "page": the unprefixed one (options page / wizard) and a feature's own
// connection. Every value differs, so a request tells which form it was read from.
const FIELDS = {};
for (const [prefix, tag] of [['', 'global'], ['summarize_', 'feature']]) {
    Object.assign(FIELDS, {
        [prefix + 'chatgpt_api_key']: { value: 'sk-' + tag },
        [prefix + 'google_gemini_api_key']: { value: 'gm-' + tag },
        [prefix + 'anthropic_api_key']: { value: 'ant-' + tag },
        [prefix + 'anthropic_version']: { value: tag === 'global' ? '2023-01-01' : '2023-06-01' },
        [prefix + 'ollama_host']: { value: `http://ollama-${tag}.example:11434` },
        [prefix + 'ollama_api_key']: { value: 'ol-' + tag },
        [prefix + 'openai_comp_host']: { value: `https://llm-${tag}.example` },
        [prefix + 'openai_comp_api_key']: { value: 'oc-' + tag },
        [prefix + 'openai_comp_use_v1']: { checked: true },
    });
}
const useForm = () => { globalThis.document = { getElementById: id => FIELDS[id] ?? null }; };

/** Run the entry's probe for `prefix` and return the one request it sent. */
async function probe(type, prefix) {
    useForm();
    const entry = ct.getTestableConnection(type);
    const from = fetches.length;
    const result = await entry.makeClient(prefix)[entry.testMethod || 'fetchModels']({ maxRetries: 0, timeoutMs: 1000 });
    assert.equal(result.ok, true, type + ': ' + JSON.stringify(result));
    assert.equal(fetches.length - from, 1, type);
    return fetches.at(-1);
}

for (const [prefix, tag] of [['', 'global'], ['summarize_', 'feature']]) {
    const other = tag === 'global' ? 'feature' : 'global';
    const form = prefix ? `the "${prefix}" fields` : 'the unprefixed fields';

    test(`makeClient("${prefix}"): the OpenAI and Gemini keys come from ${form}`, async () => {
        const openai = await probe('chatgpt_api', prefix);
        assert.equal(openai.headers.get('authorization'), 'Bearer sk-' + tag);
        const gemini = await probe('google_gemini_api', prefix);
        assert.equal(new URL(gemini.url).searchParams.get('key'), 'gm-' + tag);
    });

    test(`makeClient("${prefix}"): Claude's key and API version come from ${form}`, async () => {
        const req = await probe('anthropic_api', prefix);
        assert.equal(req.headers.get('x-api-key'), 'ant-' + tag);
        assert.equal(req.headers.get('anthropic-version'), FIELDS[prefix + 'anthropic_version'].value);
    });

    test(`makeClient("${prefix}"): the Ollama and OpenAI Comp hosts and keys come from ${form}`, async () => {
        const ollama = await probe('ollama_api', prefix);
        assert.ok(ollama.url.startsWith(`http://ollama-${tag}.example:11434/`), ollama.url);
        assert.equal(ollama.headers.get('authorization'), 'Bearer ol-' + tag);
        const comp = await probe('openai_comp_api', prefix);
        assert.ok(comp.url.startsWith(`https://llm-${tag}.example/`), comp.url);
        assert.equal(comp.headers.get('authorization'), 'Bearer oc-' + tag);
        for (const r of [ollama, comp]) assert.ok(!r.url.includes(other), r.url);
    });

    test(`requestPermission("${prefix}"): a self-hosted provider asks for the host of ${form}`, async () => {
        useForm();
        for (const [type, host] of [['ollama_api', `http://ollama-${tag}.example:11434`], ['openai_comp_api', `https://llm-${tag}.example`]]) {
            const from = requests.length;
            assert.equal(await ct.getTestableConnection(type).requestPermission(prefix), true, type);
            const asked = requests.slice(from);
            assert.equal(asked.length, 1, type);
            assert.equal(asked[0].length, 1, type);
            assert.ok(asked[0][0].startsWith(host), `${type}: ${asked[0][0]}`);
        }
    });
}

test('requestPermission(): the two cloud providers spec 04 names ask for their origin, whatever the prefix', async () => {
    useForm();
    for (const prefix of ['', 'summarize_']) {
        for (const [type, origin] of [['chatgpt_api', 'https://*.openai.com/*'], ['anthropic_api', 'https://*.anthropic.com/*']]) {
            const from = requests.length;
            await ct.getTestableConnection(type).requestPermission(prefix);
            assert.deepEqual(requests.slice(from), [[origin]], `${type} "${prefix}"`);
        }
    }
});

// ---- what an HTTP error shows ---------------------------------------------------------------
// Spec 05 "Connection Test Status Strip", "Test logic": a rejected key is a 401, or a message
// about the key that is not a 403 (Gemini answers a wrong key with a 400); a 403 is a valid key
// without access, shown with the provider's message; a body with nothing to say shows the status,
// never "unreachable". runConnectionTest() on the unprefixed form, one answer per case.

const body = (status, statusText, text, type = 'application/json') =>
    () => new Response(text, { status, statusText, headers: { 'Content-Type': type } });
const errJson = (status, statusText, error) => body(status, statusText, JSON.stringify({ error }));

const HTTP_CASES = [
    ['a 401 whatever its message', 'openai_comp_api', errJson(401, 'Unauthorized', { message: 'invalid token' }), 'auth'],
    ['a 400 about the key (Gemini)', 'google_gemini_api',
        errJson(400, 'Bad Request', { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' }), 'auth'],
    ['a 403 mentioning the key (Claude permission_error)', 'anthropic_api',
        body(403, 'Forbidden', JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' } })),
        'Your API key does not have permission to use the specified resource.'],
    ['a 403 with no body', 'chatgpt_api', body(403, 'Forbidden', ''), 'HTTP 403 Forbidden'],
    ['a 404 with Ollama\'s {"error": "<message>"}', 'ollama_api', errJson(404, 'Not Found', 'model not found'), 'model not found'],
    ['a 502 with no body', 'openai_comp_api', body(502, 'Bad Gateway', ''), 'HTTP 502 Bad Gateway'],
    ['a 500 with a plain-text body', 'openai_comp_api', body(500, 'Internal Server Error', 'upstream crashed', 'text/plain'), 'upstream crashed'],
];

for (const [name, type, answer, expected] of HTTP_CASES) {
    test(`runConnectionTest(): ${name} -> ${expected === 'auth' ? 'the authentication message' : JSON.stringify(expected)}`, async () => {
        useForm();
        nextAnswer = answer;
        const r = await ct.runConnectionTest(type, '');
        assert.equal(nextAnswer, null, 'the scripted answer was not used');
        assert.deepEqual(r, { status: 'error', message: expected === 'auth' ? msg('connTest_error_auth') : expected });
    });
}

// ---- the host permission -------------------------------------------------------------------
// Spec 04 "Optional Permissions", what is requested at run time: Gemini's origin; for Ollama and
// OpenAI Comp a localhost host asks for <all_urls>, another host for its own origin; an empty
// host asks for nothing, and the test reports a refused permission.

test('requestPermission(): Gemini asks for its API origin', async () => {
    useForm();
    const from = requests.length;
    assert.equal(await ct.getTestableConnection('google_gemini_api').requestPermission(''), true);
    assert.deepEqual(requests.slice(from), [['https://generativelanguage.googleapis.com/*']]);
});

const HOSTS = [
    ['http://localhost:11434', '<all_urls>'],
    ['http://127.0.0.1:1234', '<all_urls>'],
    ['https://llm.example.com:8443', 'https://llm.example.com:8443/*'],
    ['https://llm.example.com/', 'https://llm.example.com/*'],
];
for (const [type, field] of [['ollama_api', 'ollama_host'], ['openai_comp_api', 'openai_comp_host']]) {
    for (const [host, origin] of HOSTS) {
        test(`requestPermission(): ${type} with the host ${host} asks for ${origin}`, async () => {
            useForm();
            const saved = FIELDS[field].value;
            FIELDS[field].value = host;
            try {
                const from = requests.length;
                await ct.getTestableConnection(type).requestPermission('');
                assert.deepEqual(requests.slice(from), [[origin]]);
            } finally {
                FIELDS[field].value = saved;
            }
        });
    }

    test(`runConnectionTest(): ${type} with an empty host asks for nothing, sends nothing, and reports a refused permission`, async () => {
        useForm();
        const saved = FIELDS[field].value;
        FIELDS[field].value = '  ';
        try {
            const asked = requests.length;
            const sent = fetches.length;
            const r = await ct.runConnectionTest(type, '');
            assert.deepEqual(r, { status: 'error', message: msg('Optional_Permission_Denied_Model_Fetching') });
            assert.equal(requests.length, asked);
            assert.equal(fetches.length, sent);
        } finally {
            FIELDS[field].value = saved;
        }
    });
}
