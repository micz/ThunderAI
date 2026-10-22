// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Secrets", in the
// API chat window: it runs a feature's connection itself (api_webchat/controller.js loads the
// special prompt with loadPrompt() and applies its fields when prompt.api_type === llm), so,
// like the global key, it hydrates the REAL policy key, and the overlay hands it to the page.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startPage({ policy: loadFixture('special-prompts-connection.json'), sender: SENDERS.webchat });
});

test('loadPrompt() in the chat window carries the real policy key and the policy connection', async () => {
    const sum = await ctx.prompts.loadPrompt('prompt_summarize');
    assert.equal(sum.api_type, 'anthropic_api');
    assert.equal(sum.anthropic_api_key, 'sk-ant-org-SECRET-sum');
    assert.equal(sum.anthropic_model, 'claude-org-sum');
    assert.notEqual(sum.anthropic_api_key, ctx.MANAGED_SECRET_MARKER);
});

test('the implied connection type is what the window compares api_type with', async () => {
    const prefs = await ctx.mztaPrefs.getAllPrefs();
    assert.equal(ctx.utils.getConnectionType(prefs, await ctx.prompts.loadPrompt('prompt_summarize')), 'anthropic_api');
});
