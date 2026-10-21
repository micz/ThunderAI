// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the options page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the setup wizard entry points work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('options');

test('the setup wizard buttons are live and open the wizard', async () => {
    for (const id of ['btn_setup_wizard', 'btn_options_setup_wizard']) {
        const a = ctx.$('#' + id);
        assert.equal(a.hasAttribute('href'), true, id + ' href');
        assert.equal(a.getAttribute('aria-disabled'), null, id + ' aria-disabled');
    }
    const before = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click(ctx.$('#btn_setup_wizard'));
    const opened = ctx.apiCalls('browser.tabs.create').slice(before);
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /setup-wizard/);
});

test('the API key fields keep their eye toggle', () => {
    for (const f of ['chatgpt_api_key', 'google_gemini_api_key', 'openai_comp_api_key', 'anthropic_api_key']) {
        assert.equal(ctx.$('#toggle_' + f).classList.contains('managed_secret'), false, f);
        assert.match(ctx.$('#pwd-icon_' + f).getAttribute('src'), /pwd-show/, f);
    }
});
