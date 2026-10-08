// Spec 05 "Connection Settings Panel — Connection Test Status Strip", the test logic shared by
// every host (js/mzta-connection-test.js): which connection types have a testable endpoint
// (isTestableConnection() / getTestableConnection(), every type but chatgpt_web, and nothing for
// the empty "inherit" value), the registry entry of each (its display name, the optional
// `testMethod`, fetchVersion for Ollama only), and the field-id prefix both callbacks receive:
// `makeClient` and `requestPermission` read the fields of the form they are given ('' on the
// options page and in the wizard, `<feature>_` on a feature page with its own connection), never
// another form's. Spec 04 "Optional Permissions" for the origins of the two cloud providers it
// names.
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
