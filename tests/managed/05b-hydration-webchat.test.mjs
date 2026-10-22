// Spec 08 "Policy-supplied API keys": the API chat window (api_webchat/, decided by the
// background from sender.url) receives the REAL key - it calls the provider itself.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('hydration.json');

let ctx;

before(async () => {
    ctx = await startPage({ policy: POLICY, local: { chatgpt_api_key: 'sk-user-own' }, sender: SENDERS.webchat });
});

test('the chat window resolves the policy key, model and connection', async () => {
    assert.deepEqual(await ctx.mztaPrefs.getPrefs(['connection_type', 'chatgpt_api_key', 'chatgpt_model']), {
        connection_type: 'chatgpt_api',
        chatgpt_api_key: 'sk-org-SECRET-hydration',
        chatgpt_model: 'gpt-org',
    });
});

test('an unlocked policy key is also delivered as the real key', async () => {
    assert.equal(await ctx.mztaPrefs.getPref('google_gemini_api_key'), 'AIza-org-UNLOCKED-hydration');
});

test('no marker anywhere in the chat window', async () => {
    const all = JSON.stringify(await ctx.mztaPrefs.getAllPrefs());
    assert.equal(all.includes(ctx.MANAGED_SECRET_MARKER), false);
});
