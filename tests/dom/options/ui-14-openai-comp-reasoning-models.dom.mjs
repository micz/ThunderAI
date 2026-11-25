// The options page of a user on an OpenAI-compatible connection, no policy: the two options
// added for Mistral's reasoning models [#1044].
//
// Spec 04 "OpenAI-Compatible (openai_comp_api)":
//  - "Show only chat models" off: "Update list" adds the models in the order the server sent,
//    all of them; on: the models marked capabilities.completion_chat false or with a past
//    deprecation date are left out, the "-latest" aliases come first;
//  - a preset's `defaults` (Mistral: chat_models_only on) fill a field still at its default, and
//    are stored like a change of the user; a value the user set is never overwritten, and a
//    preset without defaults (DeepSeek) leaves the options alone; a preset not confirmed changes
//    nothing.
// The network is scripted in this file (tests/ui/dom-helpers.mjs, scriptFetch()).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    json,
    scriptFetch,
    until,
    userSets,
    writtenSince,
} from '../../ui/dom-helpers.mjs';

const HOST = 'https://api.mistral.ai';
const MODELS = HOST + '/v1/models';
const STORED = {
    connection_type: 'openai_comp_api',
    openai_comp_host: HOST,
    openai_comp_model: 'mistral-small-2603',
    openai_comp_api_key: 'mistral-FAKE-key',
    openai_comp_use_v1: true,
};
// Each entry as Mistral's /v1/models describes it (only the fields read here).
const SERVER_MODELS = [
    { id: 'mistral-embed', capabilities: { completion_chat: false }, deprecation: null },
    { id: 'mistral-small-2603', capabilities: { completion_chat: true }, deprecation: null },
    { id: 'open-mistral-7b', capabilities: { completion_chat: true }, deprecation: '2025-03-30T12:00:00Z' },
    { id: 'mistral-large-latest', capabilities: { completion_chat: true }, deprecation: null },
    { id: 'mistral-large-4', capabilities: { completion_chat: true }, deprecation: null },
    { id: 'mistral-small-latest', capabilities: { completion_chat: true }, deprecation: null },
];

const ctx = await openPage('options', { local: STORED });
after(() => ctx.close());
const net = scriptFetch(ctx);
const k = uiTests('options', '14');
const $ = ctx.$;
const S_COMP = 'spec 04 "OpenAI-Compatible (openai_comp_api)"';

// The fetched entries of the list, in order: the stored model, kept by the page wherever it
// puts it, is left out.
const optionValues = () => [...$('#openai_comp_model').options].map(o => o.value)
    .filter(v => v !== '' && v !== STORED.openai_comp_model);
const status = () => $('#openai_comp_model_fetch_status');

async function updateList() {
    net.answer(MODELS, () => json({ object: 'list', data: SERVER_MODELS }));
    const before = ctx.fetchCalls.length;
    await ctx.click($('#btnUpdateOpenAICompModels'));
    await until(ctx, () => ctx.fetchCalls.length > before && !status().hidden, 'the model list');
}

async function applyPreset(id) {
    const select = $('#openai_comp_services_shortcut');
    select.value = id;
    await ctx.fire(select, 'change');
}

k.test('controls-at-load', S_COMP, 'both options at their default: reasoning effort not set, the filter off', () => {
    assert.equal($('#openai_comp_reasoning_effort').value, '');
    assert.deepEqual([...$('#openai_comp_reasoning_effort').options].map(o => o.value), ['', 'none', 'low', 'medium', 'high']);
    assert.equal($('#openai_comp_chat_models_only').checked, false);
});

// "Update list" merges the fetched models into the list: the filtered fetch runs first, then
// the unfiltered one adds what it left out.
k.test('filter-on', S_COMP, 'the filter on: no non-chat or deprecated model, the "-latest" aliases first', async () => {
    await userSets(ctx, $('#openai_comp_chat_models_only'), true);
    try {
        await updateList();
        assert.deepEqual(optionValues(), ['mistral-large-latest', 'mistral-small-latest', 'mistral-large-4']);
    } finally {
        await userSets(ctx, $('#openai_comp_chat_models_only'), false);
    }
});

k.test('filter-off', S_COMP, 'the filter off: every model, in the order the server sent', async () => {
    await updateList();
    assert.deepEqual(optionValues(), ['mistral-large-latest', 'mistral-small-latest', 'mistral-large-4',
        'mistral-embed', 'open-mistral-7b']);
});

k.test('preset-not-confirmed', S_COMP, 'a preset not confirmed changes nothing', async () => {
    const hosts = [ctx.window, globalThis];
    const saved = hosts.map(h => h.confirm);
    hosts.forEach(h => { h.confirm = () => false; });
    try {
        await applyPreset('mistral');
        assert.equal($('#openai_comp_chat_models_only').checked, false);
        assert.equal($('#openai_comp_host').value, HOST);
    } finally {
        hosts.forEach((h, i) => { h.confirm = saved[i]; });
    }
});

k.test('preset-fills-default', S_COMP, 'Mistral fills "Show only chat models", stored, and leaves the reasoning effort the user set', async () => {
    await userSets(ctx, $('#openai_comp_reasoning_effort'), 'high');
    const since = ctx.ctl.calls.length;
    await applyPreset('mistral');
    await ctx.settle();
    assert.equal($('#openai_comp_host').value, HOST);
    assert.equal($('#openai_comp_chat_models_only').checked, true);
    assert.equal($('#openai_comp_reasoning_effort').value, 'high');
    const written = writtenSince(ctx, since);
    assert.equal(written.openai_comp_chat_models_only, true);
    assert.equal('openai_comp_reasoning_effort' in written, false, 'the reasoning effort was rewritten');
});

k.test('preset-without-defaults', S_COMP, 'a preset without defaults (DeepSeek) leaves both options as they are', async () => {
    await applyPreset('deepseek');
    await ctx.settle();
    assert.equal($('#openai_comp_host').value, 'https://api.deepseek.com');
    assert.equal($('#openai_comp_chat_models_only').checked, true);
    assert.equal($('#openai_comp_reasoning_effort').value, 'high');
});

k.test('harness-clean', S_COMP, 'no uncaught error, no console error', () => {
    assertHarnessClean(ctx);
});

k.coverage();
