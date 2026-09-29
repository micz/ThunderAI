// Spec 08 "Policy-supplied API keys": a settings page only ever receives
// MANAGED_SECRET_MARKER for a policy key. The field shows it, the eye toggle is replaced by
// the grey padlock (.managed_secret, images/pwd-locked.svg, managed_marker_tooltip) and
// cannot reveal anything, the "Fetch models" handlers return early, and runConnectionTest()
// answers connTest_managed_api_key instead of sending the marker to the provider.
//
// All four provider keys locked; connection_type is only an initial value, so the test can
// switch providers to test each one.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { REASONS } from '../../helpers/dom-known-issues.mjs';

const FETCH_TODO = {
    openai_comp_api_key: REASONS.fetchEnabledByHostCheck,
    anthropic_api_key: REASONS.fetchEnabledByVersionCheck,
};

const KEYS = {
    chatgpt_api_key: { conn: 'chatgpt_api', fetch: 'btnUpdateChatGPTModels' },
    google_gemini_api_key: { conn: 'google_gemini_api', fetch: 'btnUpdateGoogleGeminiModels' },
    openai_comp_api_key: { conn: 'openai_comp_api', fetch: 'btnUpdateOpenAICompModels' },
    anthropic_api_key: { conn: 'anthropic_api', fetch: 'btnUpdateAnthropicModels' },
};
const ctx = await openPage('options', {
    policy: {
        connection_type: 'chatgpt_api', 'connection_type:locked': false,
        chatgpt_api_key: 'sk-org-SECRET-1',
        google_gemini_api_key: 'AIza-org-SECRET-2',
        openai_comp_api_key: 'sk-org-SECRET-3',
        anthropic_api_key: 'sk-ant-org-SECRET-4',
    },
    local: { openai_comp_host: 'http://llm.user.example:8080', ollama_host: 'http://ollama.user.example:11434' },
});
after(() => ctx.close());
const { MANAGED_SECRET_MARKER } = ctx.mods;

test('the real key never reached the page', () => {
    const html = ctx.document.documentElement.outerHTML;
    for (const secret of ['SECRET-1', 'SECRET-2', 'SECRET-3', 'SECRET-4']) {
        assert.equal(html.includes(secret), false, secret + ' in the DOM');
    }
    const sent = JSON.stringify(ctx.fetchCalls);
    assert.equal(sent.includes('SECRET'), false, 'a policy key was sent over fetch');
});

for (const [key, { fetch }] of Object.entries(KEYS)) {
    test(`${key}: shows MANAGED_SECRET_MARKER, disabled and marked`, () => {
        const input = ctx.$('#' + key);
        assert.equal(input.value, MANAGED_SECRET_MARKER);
        assert.equal(input.disabled, true);
        assert.equal(input.dataset.mztaManaged, '1');
        assert.equal(input.type, 'password');
    });

    test(`${key}: the eye toggle is the padlock and reveals nothing`, async () => {
        const toggle = ctx.$('#toggle_' + key);
        const img = ctx.$('#pwd-icon_' + key);
        assert.equal(toggle.classList.contains('managed_secret'), true, '.managed_secret');
        assert.match(img.getAttribute('src'), /pwd-locked\.svg$/);
        assert.equal(toggle.title, msg('managed_marker_tooltip'));
        await ctx.click(toggle);
        await ctx.click(img);
        assert.equal(ctx.$('#' + key).type, 'password', 'the toggle revealed the field');
        assert.match(img.getAttribute('src'), /pwd-locked\.svg$/, 'the padlock turned back into an eye');
    });

    test(`${key}: "Fetch models" is disabled`, { todo: FETCH_TODO[key] }, () => {
        assert.equal(ctx.$('#' + fetch).disabled, true, fetch + ' enabled');
    });

    test(`${key}: "Fetch models" refuses the marker even when re-enabled by hand`, async () => {
        const btn = ctx.$('#' + fetch);
        const fetches = ctx.fetchCalls.length;
        const requests = ctx.apiCalls('browser.permissions.request').length;
        btn.disabled = false;
        await ctx.click(btn);
        assert.equal(ctx.fetchCalls.length, fetches, 'a model fetch was attempted with the marker');
        assert.equal(ctx.apiCalls('browser.permissions.request').length, requests, 'a permission was requested');
    });
}

test('the connection test refuses to use the marker, for every keyed provider', async () => {
    const select = ctx.$('#connection_type');
    for (const { conn } of Object.values(KEYS)) {
        select.value = conn;
        await ctx.fire(select, 'change');
        const fetches = ctx.fetchCalls.length;
        await ctx.click(ctx.$('#mzta_conn_test_link'));
        assert.equal(ctx.$('#mzta_conn_test').getAttribute('data-state'), 'error', conn);
        assert.equal(ctx.$('#mzta_conn_test_text').textContent,
            msg('connTest_error', [msg('connTest_managed_api_key')]), conn);
        assert.equal(ctx.fetchCalls.length, fetches, conn + ': the test sent a request');
    }
});

test('no key - and no marker - was ever written to storage', () => {
    const local = ctx.ctl.localData();
    for (const key of Object.keys(KEYS)) assert.equal(local[key], undefined, key);
    assert.equal(JSON.stringify(local).includes(MANAGED_SECRET_MARKER), false);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
