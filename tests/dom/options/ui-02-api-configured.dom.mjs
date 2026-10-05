// The options page of a user who configured OpenAI API and changed most preferences, no policy.
//
// Spec 05 "Global Integration Settings", "UI & Feature Preferences" (stored values shown at
// load), "Special Prompt Integration Overrides" (the "Using <provider>" pill, at load and from
// storage.onChanged), "Feature 'Manage settings' Links — Hidden vs. Disabled", "Connection
// Settings Panel — Advanced Options Disclosure" (JSON field validation on restore, the idle
// reset bound to both tables), "Connection Settings Panel — Connection Test Status Strip" and
// "Connection Settings Panel — 'Update list' Model Fetch Buttons" (a missing credential
// disables, never clears), with the network scripted
// in this file (tests/ui/dom-helpers.mjs, scriptFetch()).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    scriptFetch,
    json,
    until,
    shown,
    userSets,
} from '../../ui/dom-helpers.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    chatgpt_api_key: 'sk-stored-1',
    chatgpt_model: 'gpt-4o',
    chatgpt_extra_body: '{"a": 1,',
    // a model kept with no host: the empty credential must not erase it
    ollama_model: 'llama3:8b',
    default_sign_name: 'Ann',
    default_chatgpt_lang: 'German',
    reply_type: 'reply_sender',
    diff_granularity: 'sentences',
    chatgpt_win_height: 600,
    chatgpt_win_width: 500,
    max_prompt_length: 12345,
    special_command_timeout: 30000,
    batch_max_concurrency: 4,
    do_debug: true,
    hide_thinking: false,
    chat_show_usage_data: false,
    dynamic_menu_force_enter: true,
    placeholders_use_default_value: true,
    chatgpt_win_save_position: true,
    summarize: true,
    translate: true,
    // in progress: the flag on, no provider picked yet -> no pill
    add_tags_use_specific_integration: true,
    add_tags_connection_type: '',
    // a provider left behind with the flag off -> no pill
    spamfilter_use_specific_integration: false,
    spamfilter_connection_type: 'anthropic_api',
    translate_use_specific_integration: true,
    translate_connection_type: 'anthropic_api',
};

const permissions = {};
const ctx = await openPage('options', { local: STORED, permissions });
after(() => ctx.close());
const net = scriptFetch(ctx);
const k = uiTests('options', '02');
const $ = ctx.$;

const S_GLOBAL = 'spec 05 "Global Integration Settings"';
const S_UI = 'spec 05 "UI & Feature Preferences"';
const S_OVERRIDES = 'spec 05 "Special Prompt Integration Overrides"';
const S_MANAGE = 'spec 05 "Feature \'Manage settings\' Links — Hidden vs. Disabled"';
const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
const S_TEST = 'spec 05 "Connection Settings Panel — Connection Test Status Strip"';
const S_FETCH = 'spec 05 "Connection Settings Panel — \'Update list\' Model Fetch Buttons"';

const OPENAI_MODELS = 'https://api.openai.com/v1/models';
const OLLAMA = 'http://ollama.example:11434';
const strip = () => $('#mzta_conn_test');
const stripText = () => $('#mzta_conn_test_text').textContent;
const stripLink = () => $('#mzta_conn_test_link');
const runTest = async () => {
    await ctx.click(stripLink());
    await until(ctx, () => strip().getAttribute('data-state') !== 'loading', 'the test to end');
};
const writesDuring = async (fn) => {
    const since = ctx.ctl.calls.length;
    await fn();
    return ctx.localWrites(since);
};

// ---- at load ---------------------------------------------------------------------------

k.test('restore-connection', S_GLOBAL, 'the stored provider, key and model are shown', () => {
    assert.equal($('#connection_type').value, 'chatgpt_api');
    assert.equal($('#chatgpt_api_key').value, 'sk-stored-1');
    assert.equal($('#chatgpt_model').value, 'gpt-4o');
    assert.equal($('#no_connection_banner').classList.contains('shown'), false);
});

k.test('restore-ui', S_UI, 'every stored preference is shown at load', () => {
    for (const id of ['default_sign_name', 'default_chatgpt_lang', 'reply_type', 'diff_granularity']) {
        assert.equal($('#' + id).value, STORED[id], id);
    }
    for (const id of ['chatgpt_win_height', 'chatgpt_win_width', 'max_prompt_length', 'special_command_timeout', 'batch_max_concurrency']) {
        assert.equal($('#' + id).valueAsNumber, STORED[id], id);
    }
    for (const id of ['do_debug', 'hide_thinking', 'chat_show_usage_data', 'dynamic_menu_force_enter', 'placeholders_use_default_value', 'chatgpt_win_save_position']) {
        assert.equal($('#' + id).checked, STORED[id], id);
    }
});

k.test('restore-flags', S_MANAGE, 'stored-on features show checked with their Manage button', () => {
    for (const [p, btn] of [['summarize', 'btnManageSummarizeInfo'], ['translate', 'btnManageTranslateInfo']]) {
        assert.equal($('#' + p).checked, true, p);
        assert.notEqual($('#' + btn).style.display, 'none', btn);
        assert.equal($('#' + btn).disabled, false, btn);
    }
});

k.test('nothing-written-at-load', S_FETCH, 'opening the page with an empty credential writes nothing', () => {
    assert.deepEqual(ctx.localWrites(0), []);
    assert.equal(ctx.ctl.localData().ollama_model, 'llama3:8b');
});

k.test('empty-credential-keeps-model', S_FETCH, 'an empty host disables the model select but keeps its model', () => {
    const sel = $('#ollama_model');
    assert.equal(sel.disabled, true);
    assert.equal($('#btnUpdateOllamaModels').disabled, true);
    assert.equal(sel.value, 'llama3:8b');
});

k.test('usage-row', S_UI, 'with an API that reports usage the usage-data row is shown, without the OpenAI Comp note', () => {
    assert.notEqual($('#chat_show_usage_data_tr').style.display, 'none');
    assert.equal($('#chat_show_usage_data_openai_comp_note').style.display, 'none');
});

k.test('pill-load', S_OVERRIDES, 'only a feature with the flag on AND a provider shows "Using <provider>"', () => {
    const pill = $('#translate_specific_api_indicator');
    assert.equal(pill.textContent, msg('prefs_specific_api_indicator', [msg('prefs_Connection_type_Anthropic_API')]));
    assert.notEqual(pill.style.display, 'none');
    for (const p of ['add_tags', 'spamfilter', 'summarize']) {
        assert.equal($('#' + p + '_specific_api_indicator').style.display, 'none', p);
    }
});

k.test('json-on-restore', S_ADV, 'a malformed stored *_extra_body shows its red border and reason without being touched', () => {
    const field = $('#chatgpt_extra_body');
    assert.equal(field.value, STORED.chatgpt_extra_body);
    assert.match(field.style.border, /red/);
    const box = $('#chatgpt_extra_body_error');
    assert.equal(box.hidden, false);
    assert.ok(box.textContent.startsWith(msg('prefs_extra_body_error_invalid')), box.textContent);
});

k.test('json-saved-anyway', S_GLOBAL, 'a malformed extra body is still saved as typed (advisory validation)', async () => {
    const w = await writesDuring(() => userSets(ctx, $('#chatgpt_extra_body'), '{"b": '));
    assert.equal(w.at(-1)?.items.chatgpt_extra_body, '{"b":');
    assert.match($('#chatgpt_extra_body').style.border, /red/);
});

k.test('adv-provider-rows', S_ADV, 'the advanced table shows only the stored provider\'s rows', () => {
    const rows = ctx.$$('#connection_ui_adv_table tr[class*="conntype_"]');
    assert.ok(rows.some(tr => tr.classList.contains('conntype_chatgpt_api')));
    for (const tr of rows) assert.equal(tr.style.display !== 'none', tr.classList.contains('conntype_chatgpt_api'), tr.className);
});

k.test('pill-onchanged', S_OVERRIDES, 'a per-feature integration set in another tab updates the pill', async () => {
    await ctx.ctl.browser.storage.local.set({ spamfilter_use_specific_integration: true });
    await ctx.settle();
    const pill = $('#spamfilter_specific_api_indicator');
    assert.equal(pill.textContent, msg('prefs_specific_api_indicator', [msg('prefs_Connection_type_Anthropic_API')]));
    assert.notEqual(pill.style.display, 'none');
});

// ---- connection test ---------------------------------------------------------------------

k.test('test-ok', S_TEST, 'a reachable provider: loading, then "Connected", link "Re-test"', async () => {
    net.answer(OPENAI_MODELS, () => json({ data: [{ id: 'gpt-4o' }] }));
    const asked = ctx.apiCalls('browser.permissions.request').length;
    const w = await writesDuring(runTest);
    assert.equal(strip().getAttribute('data-state'), 'ok');
    assert.equal(stripText(), msg('connTest_ok', [msg('prefs_Connection_type_ChatGPT_API')]));
    assert.equal(stripLink().textContent, msg('connTest_link_retest'));
    assert.deepEqual(ctx.apiCalls('browser.permissions.request').slice(asked).map(c => c.args[0].origins),
        [['https://*.openai.com/*']]);
    assert.deepEqual(w, [], 'the test saves nothing');
    assert.deepEqual(net.pending(), []);
});

k.test('test-reads-form', S_TEST, 'the test uses the current, unsaved key', () => {
    const call = ctx.fetchCalls.findLast(c => c.url === OPENAI_MODELS);
    assert.equal(new Headers(call.init.headers).get('authorization'), 'Bearer sk-stored-1');
});

k.test('idle-on-edit', S_TEST, 'editing a core field resets the strip to idle', async () => {
    const key = $('#chatgpt_api_key');
    key.value = 'sk-typed-2';
    await ctx.fire(key, 'input');
    assert.equal(strip().getAttribute('data-state'), 'idle');
    assert.equal(stripText(), msg('connTest_idle'));
});

k.test('test-auth', S_TEST, 'a rejected key: red "Retry" with the authentication message', async () => {
    net.answer(OPENAI_MODELS, () => json({ error: { message: 'Incorrect API key provided' } }, { status: 401, statusText: 'Unauthorized' }));
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal(stripText(), msg('connTest_error', [msg('connTest_error_auth')]));
    assert.equal(stripLink().textContent, msg('connTest_link_retry'));
    const call = ctx.fetchCalls.findLast(c => c.url === OPENAI_MODELS);
    assert.equal(new Headers(call.init.headers).get('authorization'), 'Bearer sk-typed-2', 'the unsaved key');
});

k.test('idle-on-adv-edit', S_TEST, 'editing an advanced field resets the strip to idle too', async () => {
    const t = $('#chatgpt_extra_body');
    t.value = '{}';
    await ctx.fire(t, 'input');
    assert.equal(strip().getAttribute('data-state'), 'idle');
});

k.test('test-network', S_TEST, 'an unreachable endpoint: the network message', async () => {
    net.fail(OPENAI_MODELS);
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal(stripText(), msg('connTest_error', [msg('connTest_error_network')]));
});

k.test('test-denied', S_TEST, 'a denied host permission: no request, the permission message', async () => {
    const fetches = ctx.fetchCalls.length;
    permissions.request = () => false;
    try {
        await runTest();
    } finally {
        delete permissions.request;
    }
    assert.equal(ctx.fetchCalls.length, fetches, 'a request was sent');
    assert.equal(stripText(), msg('connTest_error', [msg('Optional_Permission_Denied_Model_Fetching')]));
});

// ---- "Update list" -----------------------------------------------------------------------

const btn = () => $('#btnUpdateChatGPTModels');
const loading = () => $('#chatgpt_model_fetch_loading');
const status = () => $('#chatgpt_model_fetch_status');
const optionValues = () => [...$('#chatgpt_model').options].map(o => o.value);

k.test('fetch-ok', S_FETCH, 'a successful fetch merges the list, brings the button back and shows the green "done"', async () => {
    net.answer(OPENAI_MODELS, () => json({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] }));
    await ctx.click(btn());
    await until(ctx, () => !status().hidden, 'the status');
    assert.ok(optionValues().includes('gpt-5'), optionValues().join());
    assert.equal(optionValues().filter(v => v === 'gpt-4o').length, 1, 'gpt-4o duplicated');
    assert.notEqual(btn().style.display, 'none');
    assert.equal(loading().style.display, 'none');
    assert.equal(status().textContent, msg('Models_Fetch_Done'));
    assert.equal(status().classList.contains('is_ok'), true);
    assert.equal(status().getAttribute('role'), 'status');
    assert.equal(status().getAttribute('aria-live'), 'polite');
});

k.test('fetch-keeps-model', S_FETCH, 'the selected model is kept', () => {
    assert.equal($('#chatgpt_model').value, 'gpt-4o');
});

k.test('fetch-error', S_FETCH, 'an HTTP error: the button is back and the reason is shown in red, no "done"', async () => {
    net.answer(OPENAI_MODELS, () => json({ error: { message: 'quota exceeded' } }, { status: 429, statusText: 'Too Many Requests' }));
    const from = ctx.fetchCalls.length;
    await ctx.click(btn());
    await until(ctx, () => !status().classList.contains('is_ok') && status().textContent !== '', 'the error');
    assert.equal(status().hidden, false);
    assert.equal(status().textContent, msg('ChatGPT_Models_Error_fetching') + ': quota exceeded');
    assert.notEqual(btn().style.display, 'none');
    assert.equal(loading().style.display, 'none');
    assert.equal(ctx.dialogs.filter(d => d.kind === 'alert').length, 0, 'an alert() instead of the status box');
    await ctx.settle();
    assert.equal(ctx.fetchCalls.length - from, 1, 'a retryable 429 was retried: the user is waiting on the button');
});

k.test('fetch-denied', S_FETCH, 'a denied optional permission: the reason in the status box, no request', async () => {
    const fetches = ctx.fetchCalls.length;
    permissions.request = () => false;
    try {
        await ctx.click(btn());
        await until(ctx, () => status().textContent === msg('Optional_Permission_Denied_Model_Fetching'), 'the message');
    } finally {
        delete permissions.request;
    }
    assert.equal(ctx.fetchCalls.length, fetches);
    assert.notEqual(btn().style.display, 'none');
});

k.test('fetch-network', S_FETCH, 'a network exception is reported in the status box', async () => {
    net.fail(OPENAI_MODELS);
    await ctx.click(btn());
    await until(ctx, () => status().textContent.startsWith(msg('ChatGPT_Models_Error_fetching')), 'the error');
    assert.equal(status().classList.contains('is_ok'), false);
    assert.notEqual(btn().style.display, 'none');
});

k.test('key-emptied-and-retyped', S_FETCH, 'emptying the key and typing it back never loses the model', async () => {
    const key = $('#chatgpt_api_key');
    const model = $('#chatgpt_model');
    const typed = key.value;
    const since = ctx.ctl.calls.length;
    await userSets(ctx, key, '');
    assert.equal(model.disabled, true, 'the model select stays enabled with no key');
    assert.equal(btn().disabled, true, 'Update list stays enabled with no key');
    assert.equal(model.value, 'gpt-4o', 'the model was cleared');
    await userSets(ctx, key, typed);
    assert.equal(model.disabled, false);
    assert.equal(model.value, 'gpt-4o');
    const models = ctx.localWrites(since).filter(w => 'chatgpt_model' in w.items);
    assert.deepEqual(models, [], 'the model was rewritten');
});

// ---- Ollama ------------------------------------------------------------------------------

k.test('ollama-test-version', S_TEST, 'the Ollama test probes /api/version, then re-reads the model capabilities', async () => {
    const sel = $('#connection_type');
    sel.value = 'ollama_api';
    await ctx.fire(sel, 'change');
    const host = $('#ollama_host');
    host.value = OLLAMA;
    await ctx.fire(host, 'input');      // typed, not committed: no capability probe for this host yet
    const from = ctx.fetchCalls.length;
    net.answer(OLLAMA + '/api/version', () => json({ version: '0.6.0' }));
    net.answer(OLLAMA + '/api/show', () => json({ capabilities: ['completion'], model_info: {} }));
    const asked = ctx.apiCalls('browser.permissions.request').length;
    await runTest();
    await until(ctx, () => ctx.fetchCalls.length > from + 1, 'the capability probe');
    assert.equal(strip().getAttribute('data-state'), 'ok');
    assert.equal(stripText(), msg('connTest_ok', [msg('prefs_Connection_type_Ollama_API')]));
    assert.deepEqual(ctx.fetchCalls.slice(from).map(c => c.url), [OLLAMA + '/api/version', OLLAMA + '/api/show']);
    assert.deepEqual(ctx.apiCalls('browser.permissions.request').slice(asked).map(c => c.args[0].origins),
        [[OLLAMA + '/*']]);
});

k.test('ollama-fetch-empty', S_FETCH, 'Ollama with no model pulled: "no models" in red', async () => {
    await ctx.fire($('#ollama_host'), 'change');    // the user leaves the host field
    assert.equal($('#btnUpdateOllamaModels').disabled, false);
    assert.equal($('#ollama_model').value, 'llama3:8b', 'the model kept through the empty host');
    net.answer(OLLAMA + '/api/tags', () => json({ models: [] }));
    await ctx.click($('#btnUpdateOllamaModels'));
    const st = $('#ollama_model_fetch_status');
    await until(ctx, () => st.textContent !== '', 'the error');
    assert.equal(st.textContent, msg('Ollama_Models_Error_fetching') + ': ' + msg('API_Models_Error_NoModels'));
    assert.equal(st.classList.contains('is_ok'), false);
});

k.test('strip-web-hidden', S_TEST, 'switching to ChatGPT Web hides the strip and resets it', async () => {
    const sel = $('#connection_type');
    sel.value = 'chatgpt_web';
    await ctx.fire(sel, 'change');
    assert.equal(shown(strip()), false);
    assert.equal(strip().getAttribute('data-state'), 'idle');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
