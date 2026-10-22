// The setup wizard on a fresh install (nothing stored, so no connection selected), no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)": step 0 (six provider cards, names and tags;
// nothing preselected, nothing persisted by opening the page, "Continue" disabled until a card
// is picked and enabled by that first click), the tint of the panel and the done badge, the
// provider-dependent sequence walked by position (an API provider through "Pick your tools",
// ChatGPT Web skipping it; "Finish setup" on the second-to-last position), "Navigation chrome"
// (Back, the done step, the step indicator, "Run again"), "Connect step header", the Connect step
// (the injected connection UI showing only the chosen provider, the advanced rows moved below
// the disclosure and collapsed on a provider change), the connection test strip (visible per
// provider, ok / error / idle reset, saves nothing; the network scripted with scriptFetch()),
// "Pick your tools" (the four API features only, persisted as booleans), "Persistence" (the
// same keys as the options page; picking a provider writes no feature flag; navigating writes
// nothing). The connection test also covers the rejected key, the refused permission, another
// HTTP error with its detail, an answer that is not JSON, the ~10 s time-out (on held timers,
// holdLongTimers()) and, for Ollama, the capability re-probe after a success.
// Spec 04 "ChatGPT Web" (its rows injected once, with unprefixed ids, in the wizard).
//
// The tests run in order on one page: the user picks Gemini, walks to "Pick your tools", comes
// back and switches to ChatGPT Web, which goes on to the done step, then "Run again", and
// last tests an Ollama connection.

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
    userSets,
    writtenSince,
    holdLongTimers,
} from '../../ui/dom-helpers.mjs';

const permissions = {};
const ctx = await openPage('setup-wizard', { permissions });
after(() => ctx.close());
const net = scriptFetch(ctx);
const k = uiTests('setup-wizard', '01');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
const S_TEST = 'spec 05 "Connection Settings Panel — Connection Test Status Strip"';
const S_WEB = 'spec 04 "ChatGPT Web"';

const PROVIDERS = ['chatgpt_web', 'chatgpt_api', 'google_gemini_api', 'anthropic_api', 'ollama_api', 'openai_comp_api'];
const NAME_KEY = {
    chatgpt_web: 'prefs_Connection_type_ChatGPT_Web',
    chatgpt_api: 'prefs_Connection_type_ChatGPT_API',
    google_gemini_api: 'prefs_Connection_type_Google_Gemini_API',
    anthropic_api: 'prefs_Connection_type_Anthropic_API',
    ollama_api: 'prefs_Connection_type_Ollama_API',
    openai_comp_api: 'prefs_Connection_type_OpenAI_Comp_API',
};
const FEATURES = ['add_tags', 'spamfilter', 'summarize', 'translate'];
const STEPS = { provider: '#wiz_step_provider', connect: '#wiz_step_connect', tools: '#wiz_step_tools', done: '#wiz_step_done' };

const card = id => $(`.wiz_provider_card[data-provider="${id}"]`);
const next = () => $('#wiz_next');
const back = () => $('#wiz_back');
/** The one step shown, by name. */
const current = () => {
    const open = Object.entries(STEPS).filter(([, sel]) => !$(sel).classList.contains('hidden')).map(([n]) => n);
    assert.equal(open.length, 1, 'steps shown: ' + open.join(', '));
    return open[0];
};
const tints = el => [...el.classList].filter(c => c.startsWith('tint_'));
const rowShown = tr => tr.style.display !== 'none';
const strip = () => $('#mzta_conn_test');
const runTest = async () => {
    await ctx.click($('#mzta_conn_test_link'));
    await until(ctx, () => strip().getAttribute('data-state') !== 'loading', 'the test to end');
};
/** The step indicator: each dot's text, and which dots / lines are on. */
const indicator = () => ({
    dots: ctx.$$('#wiz_steps .wiz_dot').map(d => d.textContent),
    on: ctx.$$('#wiz_steps .wiz_dot').map(d => d.classList.contains('wiz_dot_on')),
    lines: ctx.$$('#wiz_steps .wiz_line').map(l => l.classList.contains('wiz_line_on')),
});
const backShown = () => !back().classList.contains('hidden');
/** Run `fn` and return the storage.local writes it made. */
const writesDuring = async fn => {
    const since = ctx.ctl.calls.length;
    await fn();
    return ctx.localWrites(since);
};
const GEMINI_MODELS = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?key=/;

// ---- step 0, at load -------------------------------------------------------------------

k.test('six-cards', S_WIZ, 'step 0 offers six provider cards in the wizard\'s order, named and tagged', () => {
    const cards = ctx.$$('.wiz_provider_card');
    assert.deepEqual(cards.map(c => c.dataset.provider), PROVIDERS);
    for (const id of PROVIDERS) {
        assert.equal(card(id).querySelector('.wiz_provider_name').textContent, msg(NAME_KEY[id]), id);
        assert.equal(card(id).querySelector('.wiz_provider_tag').textContent, msg('wizard_provider_tag_' + id), id);
    }
});

k.test('nothing-preselected', S_WIZ, 'no card is marked selected and the hidden select is left unset', () => {
    assert.deepEqual(ctx.$$('.wiz_provider_card.wiz_selected'), []);
    assert.equal($('#connection_type').selectedIndex, -1);
    assert.equal(current(), 'provider');
});

k.test('nothing-persisted', S_WIZ, 'opening the wizard persists no connection_type', () => {
    assert.equal(ctx.localWrites(0).some(w => 'connection_type' in w.items), false);
    assert.equal(ctx.ctl.localData().connection_type ?? '', '');
});

k.test('continue-disabled', S_WIZ, '"Continue" is disabled and does not leave step 0 while no provider is chosen', async () => {
    assert.equal(next().disabled, true);
    assert.equal(next().textContent, msg('wizard_continue'));
    await ctx.fire(next(), 'click');
    assert.equal(current(), 'provider');
});

// ---- picking a provider ------------------------------------------------------------------

k.test('first-click-enables', S_WIZ, 'the first card click marks it and enables "Continue", still on step 0', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click(card('google_gemini_api'));
    assert.deepEqual(ctx.$$('.wiz_provider_card.wiz_selected').map(c => c.dataset.provider), ['google_gemini_api']);
    assert.equal(next().disabled, false);
    assert.equal(current(), 'provider');
    assert.deepEqual(writtenSince(ctx, since), { connection_type: 'google_gemini_api' }, 'only the provider is written');
});

k.test('tint', S_WIZ, 'the choice tints the connection panel and the done badge with that provider only', () => {
    assert.deepEqual(tints($('#mzta_conn_panel')), ['tint_google_gemini_api']);
    assert.deepEqual(tints($('#wiz_step_done')), ['tint_google_gemini_api']);
});

// ---- Connect -----------------------------------------------------------------------------

k.test('to-connect', S_WIZ, '"Continue" leads to Connect, writing nothing; the label stays "Continue" (not second-to-last)', async () => {
    assert.deepEqual(await writesDuring(() => ctx.click(next())), []);
    assert.equal(current(), 'connect');
    assert.equal(next().textContent, msg('wizard_continue'));
});

k.test('connect-chrome', S_WIZ, 'on Connect: Back shown, four dots (an API provider), the first two on', () => {
    assert.equal(backShown(), true);
    assert.equal($('#wiz_nav').classList.contains('wiz_nav_back_hidden'), false);
    assert.equal(next().classList.contains('hidden'), false);
    assert.deepEqual(indicator(), {
        dots: ['1', '2', '3', '✓'],
        on: [true, true, false, false],
        lines: [true, false, false, false],
    });
});

k.test('connect-header', S_WIZ, 'the Connect header names the provider: heading, API subtitle, pill', () => {
    const name = msg(NAME_KEY.google_gemini_api);
    assert.equal($('#wiz_connect_heading').textContent, msg('wizard_connect_heading', [name]));
    assert.equal($('#wiz_connect_sub').textContent, msg('wizard_step_connect_sub'));
    assert.equal($('#mzta_conn_pill_name').textContent, name);
});

k.test('connect-rows', S_WIZ, 'the injected panel shows only the chosen provider\'s core rows', () => {
    const rows = ctx.$$('#connection_ui_table tr[class*="conntype_"]');
    assert.ok(rows.some(tr => tr.classList.contains('conntype_google_gemini_api')));
    for (const tr of rows) assert.equal(rowShown(tr), tr.classList.contains('conntype_google_gemini_api'), tr.className);
});

k.test('adv-moved', S_ADV, 'the advanced rows sit below the disclosure, collapsed, only the provider\'s shown', () => {
    assert.deepEqual(ctx.$$('#connection_ui_table tr.conn_adv'), []);
    const adv = ctx.$$('#connection_ui_adv_table tr[class*="conntype_"]');
    assert.ok(adv.some(tr => tr.classList.contains('conntype_google_gemini_api')));
    for (const tr of adv) assert.equal(rowShown(tr), tr.classList.contains('conntype_google_gemini_api'), tr.className);
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'false');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
});

k.test('adv-toggle', S_ADV, 'the disclosure opens and closes the advanced table, persisting nothing', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#mzta_conn_adv_btn'));
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'true');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), false);
    await ctx.click($('#mzta_conn_adv_btn'));
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'false');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('web-rows-once', S_WEB, 'the ChatGPT Web rows are injected once, with their unprefixed ids', () => {
    for (const id of ['chatgpt_web_model', 'chatgpt_web_project', 'chatgpt_web_custom_gpt', 'chatgpt_web_tempchat',
        'chatgpt_web_load_wait_time', 'btnChatGPTWeb_Tab']) {
        assert.equal(ctx.$$('#' + id).length, 1, id);
    }
});

k.test('field-saved', S_WIZ, 'a connection field is persisted under the options page\'s key', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#google_gemini_api_key'), 'gemini-typed-key');
    assert.equal(writtenSince(ctx, since).google_gemini_api_key, 'gemini-typed-key');
});

k.test('strip-shown', S_TEST, 'an API provider shows the test strip, idle', () => {
    assert.notEqual(strip().style.display, 'none');
    assert.equal(strip().getAttribute('data-state'), 'idle');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_idle'));
});

k.test('test-ok', S_TEST, 'a reachable provider: "Connected", the form\'s key used, nothing saved', async () => {
    net.answer(GEMINI_MODELS, () => json({ models: [{ name: 'models/gemini-2.5-pro' }] }));
    const since = ctx.ctl.calls.length;
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'ok');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_ok', [msg(NAME_KEY.google_gemini_api)]));
    assert.equal($('#mzta_conn_test_link').textContent, msg('connTest_link_retest'));
    assert.match(ctx.fetchCalls.at(-1).url, /key=gemini-typed-key$/);
    assert.deepEqual(ctx.localWrites(since), []);
    assert.deepEqual(net.pending(), []);
});

k.test('test-idle-on-edit', S_TEST, 'editing a connection field resets the strip to idle', async () => {
    const key = $('#google_gemini_api_key');
    key.value = 'gemini-typed-key-2';
    await ctx.fire(key, 'input');
    assert.equal(strip().getAttribute('data-state'), 'idle');
});

k.test('test-network', S_TEST, 'an unreachable endpoint: red, with the network message and "Retry"', async () => {
    net.fail(GEMINI_MODELS);
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('connTest_error_network')]));
    assert.equal($('#mzta_conn_test_link').textContent, msg('connTest_link_retry'));
});

k.test('test-auth', S_TEST, 'a rejected key: red, with the authentication message', async () => {
    net.answer(GEMINI_MODELS, () => json({ error: { message: 'API key not valid. Please pass a valid API key.' } },
        { status: 400, statusText: 'Bad Request' }));
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('connTest_error_auth')]));
});

k.test('test-denied', S_TEST, 'a refused host permission: no request sent, the permission message', async () => {
    const fetches = ctx.fetchCalls.length;
    permissions.request = () => false;
    try {
        await runTest();
    } finally {
        delete permissions.request;
    }
    assert.equal(ctx.fetchCalls.length, fetches, 'a request was sent');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('Optional_Permission_Denied_Model_Fetching')]));
});

k.test('test-http-detail', S_TEST, 'another HTTP error: red, with the provider\'s own message as the detail', async () => {
    net.answer(GEMINI_MODELS, () => json({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } },
        { status: 404, statusText: 'Not Found' }));
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', ['Requested entity was not found.']));
});

k.test('test-not-json', S_TEST, 'an answer that is not JSON: red, the network message', async () => {
    net.answer(GEMINI_MODELS, () => new Response('<!DOCTYPE html><title>Sign in</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'error');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('connTest_error_network')]));
});

k.test('test-timeout', S_TEST, 'no answer: loading, the link hidden, until ~10 s, then the time-out message and "Retry"', async () => {
    const req = net.hang(GEMINI_MODELS);
    const clock = holdLongTimers(ctx);
    try {
        await ctx.click($('#mzta_conn_test_link'));
        assert.equal(strip().getAttribute('data-state'), 'loading');
        assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_testing'));
        assert.equal($('#mzta_conn_test_link').style.display, 'none');
        await clock.advance(9999);
        assert.equal(strip().getAttribute('data-state'), 'loading', 'ended before ~10 s');
        await clock.advance(1);
        await until(ctx, () => strip().getAttribute('data-state') !== 'loading', 'the time-out');
        assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('connTest_error_timeout')]));
        assert.equal($('#mzta_conn_test_link').textContent, msg('connTest_link_retry'));
        assert.equal(req.aborted, true, 'the request outlived the test');
    } finally {
        clock.uninstall();
    }
});

// ---- Pick your tools ---------------------------------------------------------------------

k.test('to-tools', S_WIZ, 'an API provider goes on to "Pick your tools", whose button reads "Finish setup"', async () => {
    assert.deepEqual(await writesDuring(() => ctx.click(next())), []);
    assert.equal(current(), 'tools');
    assert.equal(next().textContent, msg('wizard_finish'));
});

k.test('tools-chrome', S_WIZ, 'on "Pick your tools" the first three dots are on, Back still shown', () => {
    assert.equal(backShown(), true);
    assert.deepEqual(indicator().on, [true, true, true, false]);
});

k.test('tools-four', S_WIZ, 'only the four API-driven features are offered, each showing its flag (the defaults here)', () => {
    const toggles = ctx.$$('#wiz_step_tools input[type="checkbox"]');
    assert.deepEqual(toggles.map(t => t.id), FEATURES);
    for (const t of toggles) assert.equal(t.checked, ctx.mods.prefs_default[t.id], t.id);
    assert.equal($('#get_calendar_event'), null);
    assert.equal($('#get_task'), null);
});

k.test('tools-saved', S_WIZ, 'a toggle is persisted as a boolean under the feature flag', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#summarize'));
    assert.deepEqual(writtenSince(ctx, since), { summarize: true });
    await ctx.click($('#summarize'));
    assert.strictEqual(ctx.ctl.localData().summarize, false);
    await ctx.click($('#translate'));
    assert.strictEqual(ctx.ctl.localData().translate, false);
});

// ---- back, and ChatGPT Web ---------------------------------------------------------------

k.test('back-by-position', S_WIZ, 'Back walks the sequence: tools, Connect, then the provider step, writing nothing', async () => {
    assert.deepEqual(await writesDuring(() => ctx.click(back())), []);
    assert.equal(current(), 'connect');
    assert.deepEqual(await writesDuring(() => ctx.click(back())), []);
    assert.equal(current(), 'provider');
});

k.test('first-chrome', S_WIZ, 'on the first position Back is hidden and the nav says so; only the first dot is on', () => {
    assert.equal(backShown(), false);
    assert.equal($('#wiz_nav').classList.contains('wiz_nav_back_hidden'), true);
    assert.deepEqual(indicator().on, [true, false, false, false]);
});

k.test('switch-collapses', S_ADV, 'opened, the disclosure collapses when the provider changes', async () => {
    await ctx.click(next());
    await ctx.click($('#mzta_conn_adv_btn'));
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'true');
    await ctx.click(back());
    await ctx.click(card('chatgpt_web'));
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'false');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
});

k.test('switch-persisted', S_WIZ, 'the new choice is persisted and re-tints panel and badge', () => {
    assert.equal(ctx.ctl.localData().connection_type, 'chatgpt_web');
    assert.deepEqual(ctx.$$('.wiz_provider_card.wiz_selected').map(c => c.dataset.provider), ['chatgpt_web']);
    assert.deepEqual(tints($('#mzta_conn_panel')), ['tint_chatgpt_web']);
    assert.deepEqual(tints($('#wiz_step_done')), ['tint_chatgpt_web']);
});

k.test('switch-indicator', S_WIZ, 'the step indicator follows the new provider at once, still on step 0', () => {
    assert.deepEqual(indicator(), { dots: ['1', '2', '✓'], on: [true, false, false], lines: [false, false, false] });
});

k.test('web-strip-hidden', S_TEST, 'ChatGPT Web has no testable endpoint: the strip hides', () => {
    assert.equal(strip().style.display, 'none');
});

k.test('web-sequence', S_WIZ, 'ChatGPT Web skips "Pick your tools": Connect is second-to-last ("Finish setup")', async () => {
    await ctx.click(next());
    assert.equal(current(), 'connect');
    assert.equal(next().textContent, msg('wizard_finish'));
    const rows = ctx.$$('#connection_ui_table tr[class*="conntype_"]');
    for (const tr of rows) assert.equal(rowShown(tr), tr.classList.contains('conntype_chatgpt_web'), tr.className);
    assert.deepEqual(indicator().dots, ['1', '2', '✓'], 'three positions for ChatGPT Web');
});

k.test('web-header', S_WIZ, 'the Connect header follows the new provider, with the ChatGPT Web subtitle', () => {
    const name = msg(NAME_KEY.chatgpt_web);
    assert.equal($('#wiz_connect_heading').textContent, msg('wizard_connect_heading', [name]));
    assert.equal($('#wiz_connect_sub').textContent, msg('wizard_step_connect_sub_web'));
    assert.equal($('#mzta_conn_pill_name').textContent, name);
});

k.test('done-chrome', S_WIZ, '"Finish setup" saves nothing more; the done step has no navigation: Back and "Continue" hidden, every dot on', async () => {
    assert.deepEqual(await writesDuring(() => ctx.click(next())), []);
    assert.equal(current(), 'done');
    assert.equal(backShown(), false);
    assert.equal(next().classList.contains('hidden'), true);
    assert.deepEqual(indicator(), { dots: ['1', '2', '✓'], on: [true, true, true], lines: [true, true, false] });
});

k.test('run-again', S_WIZ, '"Run again" returns to step 0, the provider still chosen, nothing reset or written', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#wiz_restart'));
    assert.equal(current(), 'provider');
    assert.deepEqual(ctx.$$('.wiz_provider_card.wiz_selected').map(c => c.dataset.provider), ['chatgpt_web']);
    assert.equal(next().disabled, false);
    assert.equal(next().classList.contains('hidden'), false);
    assert.deepEqual(ctx.localWrites(since), []);
    assert.equal(ctx.ctl.localData().connection_type, 'chatgpt_web');
});

k.test('web-flags-untouched', S_WIZ, 'the wizard never writes the feature flags itself: only the toggled ones are stored', () => {
    const flagWrites = ctx.localWrites(0).flatMap(w => Object.keys(w.items)).filter(key => FEATURES.includes(key));
    assert.deepEqual([...new Set(flagWrites)].sort(), ['summarize', 'translate']);
});

// ---- Ollama ------------------------------------------------------------------------------

const OLLAMA = 'http://ollama.example:11434';

k.test('ollama-reprobe', S_TEST, 'a successful Ollama test probes /api/version, then re-reads the model capabilities', async () => {
    await ctx.click(card('ollama_api'));
    await ctx.click(next());
    assert.equal(current(), 'connect');
    // typed, not committed: no capability probe has run for this host and model yet
    $('#ollama_host').value = OLLAMA;
    const model = $('#ollama_model');
    model.appendChild(new ctx.window.Option('llama3:8b', 'llama3:8b'));
    model.value = 'llama3:8b';
    const from = ctx.fetchCalls.length;
    net.answer(OLLAMA + '/api/version', () => json({ version: '0.6.0' }));
    net.answer(OLLAMA + '/api/show', () => json({ capabilities: ['completion'], model_info: {} }));
    await runTest();
    await until(ctx, () => ctx.fetchCalls.length > from + 1, 'the capability probe');
    assert.equal(strip().getAttribute('data-state'), 'ok');
    assert.deepEqual(ctx.fetchCalls.slice(from).map(c => c.url), [OLLAMA + '/api/version', OLLAMA + '/api/show']);
    assert.deepEqual(net.pending(), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
