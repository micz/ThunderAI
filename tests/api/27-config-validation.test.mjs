// Spec 04 "Configuration Validation" and "Web Worker Pattern", in mzta_specialCommand
// (js/mzta-special-commands.js):
//  - for special prompts, required fields are validated in initWorker() BEFORE the worker is
//    created; an empty required field throws an Error with isConfigError = true. Required:
//      chatgpt_api        chatgpt_api_key, chatgpt_model
//      google_gemini_api  google_gemini_api_key, google_gemini_model
//      ollama_api         ollama_host, ollama_model
//      openai_comp_api    openai_comp_host, openai_comp_model
//      anthropic_api      anthropic_api_key, anthropic_model, anthropic_version
//  - validation is skipped when use_specific_api is true (config.api_type non-empty: the
//    credentials come from the prompt config, not the global prefs);
//  - one module Web Worker per provider: js/workers/model-worker-<provider>.js, created in
//    initWorker() once the configuration has passed ("Worker Lifecycle & Timeout").
//
// Reached at level 1 without touching shipped code: a background context (the module reads the
// preferences through mztaPrefs, so the core browser mock is installed - this is not a worker
// file), and a fake global `Worker` that records its construction and the messages posted to it.
// The worker itself never runs here.

import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/api.mjs';

const created = [];
class FakeWorker {
    constructor(url, options) {
        this.url = String(url);
        this.options = options;
        this.posted = [];
        this.terminated = false;
        created.push(this);
    }
    postMessage(m) { this.posted.push(structuredClone(m)); }
    terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;

const ctx = await startBackground({ policy: null });
const { mzta_specialCommand } = await import('../../js/mzta-special-commands.js');
const k = caseTests('27-config-validation');

const REQUIRED = {
    chatgpt_api: ['chatgpt_api_key', 'chatgpt_model'],
    google_gemini_api: ['google_gemini_api_key', 'google_gemini_model'],
    ollama_api: ['ollama_host', 'ollama_model'],
    openai_comp_api: ['openai_comp_host', 'openai_comp_model'],
    anthropic_api: ['anthropic_api_key', 'anthropic_model', 'anthropic_version'],
};
const FILE = {
    chatgpt_api: 'model-worker-openai_responses.js',
    google_gemini_api: 'model-worker-google_gemini.js',
    ollama_api: 'model-worker-ollama.js',
    openai_comp_api: 'model-worker-openai_comp.js',
    anthropic_api: 'model-worker-anthropic.js',
};
const VALUE = { chatgpt_api_key: 'sk-FAKE', google_gemini_api_key: 'FAKE-KEY', anthropic_api_key: 'sk-ant-FAKE',
    ollama_host: 'http://localhost:11434', openai_comp_host: 'https://api.example.test', anthropic_version: '2023-06-01' };

/** Global prefs with every required field of every provider filled, then `override` on top. */
async function setPrefs(override = {}) {
    const all = {};
    for (const fields of Object.values(REQUIRED)) for (const f of fields) all[f] = VALUE[f] ?? 'some-model';
    await ctx.ctl.browser.storage.local.set({ ...all, ...override });
}

for (const [llm, fields] of Object.entries(REQUIRED)) {
    for (const field of fields) {
        k.test(`missing-${field.replace(/_/g, '-')}`, `${llm}: an empty ${field} throws isConfigError, and no init is posted`, async () => {
            await setPrefs({ [field]: '' });
            const cmd = new mzta_specialCommand({ llm, config: {} });
            await assert.rejects(cmd.initWorker(), e => e instanceof Error && e.isConfigError === true);
            assert.equal(cmd.worker, null, 'no worker, so nothing was posted to one');
        });
    }

    k.test(`valid-${llm.replace(/_/g, '-')}`, `${llm}: with every required field set, the init message carries the prefixed fields`, async () => {
        await setPrefs();
        const cmd = new mzta_specialCommand({ llm, config: {} });
        await cmd.initWorker();
        const init = cmd.worker.posted[0];
        assert.equal(init.type, 'init');
        for (const f of fields) assert.equal(init[f], VALUE[f] ?? 'some-model', f);
    });

    k.test(`worker-${llm.replace(/_/g, '-')}`, `${llm}: one module worker, js/workers/${FILE[llm]}, created by initWorker()`, async () => {
        await setPrefs();
        const before = created.length;
        const cmd = new mzta_specialCommand({ llm, config: {} });
        assert.equal(created.length, before, 'not in the constructor');
        await cmd.initWorker();
        assert.equal(created.length, before + 1);
        const w = created.at(-1);
        assert.equal(cmd.worker, w);
        assert.ok(w.url.endsWith('/js/workers/' + FILE[llm]), w.url);
        assert.equal(w.options?.type, 'module');
    });
}

k.test('before-worker-created', 'the configuration is validated before the worker is created', async () => {
    await setPrefs({ chatgpt_api_key: '' });
    const before = created.length;
    let err = null;
    try {
        const cmd = new mzta_specialCommand({ llm: 'chatgpt_api', config: {} });
        await cmd.initWorker();
    } catch (e) {
        err = e;
    }
    assert.equal(err?.isConfigError, true, 'a config error');
    assert.equal(created.length, before, 'no Worker exists when the config error is thrown');
});

k.test('specific-api-skips', 'use_specific_api (config.api_type set): no validation of the global prefs', async () => {
    await setPrefs({ ollama_host: '', ollama_model: '' });
    const cmd = new mzta_specialCommand({
        llm: 'ollama_api',
        config: { api_type: 'ollama_api', ollama_host: 'http://gpu-box:11434', ollama_model: 'qwen3:8b' },
    });
    await cmd.initWorker();
    const init = cmd.worker.posted[0];
    assert.equal(init.ollama_host, 'http://gpu-box:11434');
    assert.equal(init.ollama_model, 'qwen3:8b');
});

k.coverage();
