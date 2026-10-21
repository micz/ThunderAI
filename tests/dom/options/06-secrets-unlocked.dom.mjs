// Spec 08 "Policy-supplied API keys": "An unlocked (":locked": false) policy key shows as the
// marker until the user types their own, which is then stored and wins, per the resolution
// order." The padlock stands while the field holds the marker; typing an own key brings the
// eye back. setPref() refuses to store the marker itself.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';

const ctx = await openPage('options', {
    policy: {
        connection_type: 'chatgpt_api', 'connection_type:locked': false,
        chatgpt_api_key: 'sk-org-SECRET-1', 'chatgpt_api_key:locked': false,
        anthropic_api_key: 'sk-ant-org-SECRET-2', 'anthropic_api_key:locked': false,
    },
});
after(() => ctx.close());
const { MANAGED_SECRET_MARKER } = ctx.mods;

test('an unlocked policy key shows as the marker, with the padlock, but stays editable', () => {
    for (const key of ['chatgpt_api_key', 'anthropic_api_key']) {
        const input = ctx.$('#' + key);
        assert.equal(input.value, MANAGED_SECRET_MARKER, key);
        assert.equal(input.disabled, false, key + ' disabled');
        assert.equal(input.dataset.mztaManaged, undefined, key + ' marked');
        assert.equal(ctx.$('#toggle_' + key).classList.contains('managed_secret'), true, key + ' padlock');
    }
});

test('while it holds the marker, Fetch models and the connection test refuse it', async () => {
    const fetches = ctx.fetchCalls.length;
    const btn = ctx.$('#btnUpdateChatGPTModels');
    btn.disabled = false;
    await ctx.click(btn);
    await ctx.click(ctx.$('#mzta_conn_test_link'));
    assert.equal(ctx.fetchCalls.length, fetches, 'a request was sent with the marker');
    assert.equal(ctx.$('#mzta_conn_test_text').textContent, msg('connTest_error', [msg('connTest_managed_api_key')]));
});

test('a change event on a field still holding the marker stores nothing', async () => {
    await ctx.fire(ctx.$('#anthropic_api_key'), 'change');
    assert.equal(ctx.ctl.localData().anthropic_api_key, undefined, 'the marker was stored');
});

test('typing an own key brings the eye back and stores the key, which then wins', async () => {
    const input = ctx.$('#chatgpt_api_key');
    input.value = 'sk-user-own';
    await ctx.fire(input, 'input');
    await ctx.fire(input, 'change');
    const toggle = ctx.$('#toggle_chatgpt_api_key');
    assert.equal(toggle.classList.contains('managed_secret'), false, 'still a padlock');
    assert.match(ctx.$('#pwd-icon_chatgpt_api_key').getAttribute('src'), /pwd-show/);
    await ctx.click(toggle);
    assert.equal(input.type, 'text', 'the eye does not reveal the own key');
    assert.equal(ctx.ctl.localData().chatgpt_api_key, 'sk-user-own');
    assert.equal(await ctx.mods.mztaPrefs.getPref('chatgpt_api_key'), 'sk-user-own');
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
