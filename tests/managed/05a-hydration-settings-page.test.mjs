// Spec 08 "Hydration in every other context" and "Policy-supplied API keys", seen from a
// settings page. The page never reads storage.managed: its first preference READ sends one
// {command: 'get_managed_values'} and fills values / lockedKeys / specialPromptsText, so
// every read resolves as in the background and the write guard is live in the page.
// A policy-supplied API key reaches a settings page only as MANAGED_SECRET_MARKER.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('hydration.json');
const STORED = { connection_type: 'ollama_api', chatgpt_api_key: 'sk-user-own' };

let ctx, sentBeforeRead, managedReadsBeforeRead;

before(async () => {
    ctx = await startPage({ policy: POLICY, local: STORED, sender: SENDERS.options });
    sentBeforeRead = ctx.ctl.sent.length;
    managedReadsBeforeRead = ctx.ctl.calls.filter(c => c.area === 'managed').length;
});

const hydrationMessages = () => ctx.ctl.sent.filter(m => m && m.command === 'get_managed_values');

test('importing the modules starts nothing: no message before the first read', () => {
    assert.equal(sentBeforeRead, 0);
    assert.equal(ctx.mztaManaged.hasLoaded(), false, 'the page never ran loadManaged()');
});

test('the first read hydrates once, over sendMessage, and later reads do not repeat it', async () => {
    assert.equal(await ctx.mztaPrefs.getPref('connection_type'), 'chatgpt_api');
    await ctx.mztaPrefs.getPrefs(['chatgpt_model', 'default_sign_name']);
    await ctx.mztaPrefs.getAllPrefs();
    assert.equal(hydrationMessages().length, 1);
    assert.deepEqual(hydrationMessages()[0], { command: 'get_managed_values' });
});

test('the page itself never touched storage.managed', () => {
    // The one read is the background instance's loadManaged(), made before the page ran.
    assert.equal(managedReadsBeforeRead, 1);
    assert.equal(ctx.ctl.calls.filter(c => c.area === 'managed').length, 1);
});

test('the page resolves locked > stored > unlocked > default like the background', async () => {
    assert.deepEqual(await ctx.mztaPrefs.getPrefs(['connection_type', 'chatgpt_model', 'default_sign_name', 'reply_type']), {
        connection_type: 'chatgpt_api',          // locked beats the stored ollama_api
        chatgpt_model: 'gpt-org',                // locked
        default_sign_name: 'ACME Staff',         // unlocked initial value, nothing stored
        reply_type: ctx.prefs_default.reply_type,
    });
});

test('lock state is hydrated', () => {
    assert.deepEqual(ctx.mztaManaged.getLockedKeys().sort(), ctx.bgManaged.getLockedKeys().sort());
    assert.equal(ctx.mztaManaged.isManagedLocked('connection_type'), true);
    assert.equal(ctx.mztaManaged.isManagedLocked('default_sign_name'), false);
});

test('policy API keys, locked or not, arrive as MANAGED_SECRET_MARKER, never as the key', async () => {
    const M = ctx.MANAGED_SECRET_MARKER;
    assert.equal(typeof M, 'string');
    assert.ok(M.length > 0, 'the marker is non-empty so presence checks see a configured key');
    assert.equal(await ctx.mztaPrefs.getPref('chatgpt_api_key'), M);
    assert.equal(await ctx.mztaPrefs.getPref('google_gemini_api_key'), M);
    const all = JSON.stringify(await ctx.mztaPrefs.getAllPrefs());
    assert.equal(all.includes('sk-org-SECRET-hydration'), false);
    assert.equal(all.includes('AIza-org-UNLOCKED-hydration'), false);
});

test('the write guard is live in the page', async () => {
    await ctx.mztaPrefs.setPref('connection_type', 'anthropic_api');
    await ctx.mztaPrefs.setPrefs({ chatgpt_model: 'mine', chatgpt_temperature: '1' });
    const local = ctx.ctl.localData();
    assert.equal(local.connection_type, 'ollama_api');
    assert.equal('chatgpt_model' in local, false);
    assert.equal(local.chatgpt_temperature, '1');
});

test('saving the marker back is refused; typing an own key over an unlocked policy key wins', async () => {
    await ctx.mztaPrefs.setPref('google_gemini_api_key', ctx.MANAGED_SECRET_MARKER);
    assert.equal('google_gemini_api_key' in ctx.ctl.localData(), false);
    await ctx.mztaPrefs.setPref('google_gemini_api_key', 'AIza-user-own');
    assert.equal(await ctx.mztaPrefs.getPref('google_gemini_api_key'), 'AIza-user-own');
});

test('the enforced special prompt texts are hydrated and overlaid in the page too', async () => {
    const spam = (await ctx.prompts.getSpecialPrompts()).find(p => p.id === 'prompt_spamfilter');
    assert.equal(spam.text, POLICY._special_prompts_text.prompt_spamfilter);
    assert.equal(spam._text_by_policy, true);
});

test('hydration succeeded without a warning', () => {
    assert.deepEqual(ctx.con.warnings().filter(w => w.includes('hydrate')), []);
});
