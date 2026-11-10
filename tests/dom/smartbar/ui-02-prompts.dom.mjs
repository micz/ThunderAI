// The Prompts tab of the SmartBar page (pages/smartbar/), opened on #prompts, nothing stored,
// no policy.
//
// Spec 05 "SmartBar Settings Page (`pages/smartbar/`)": the tab named by the hash shown.
// Spec 02 "SmartBar prompts: router, execute and chat": the three texts shown, each with its
// editor (Save, Restore default, the unsaved-changes guard); the JSON format sections of the router
// and of execute shown read-only under the text, never in the textarea and never saved; the
// router's variables required on Save (a text without one is not saved, the message names the
// missing ones and follows the text). Spec 02 "Default text updates": Save stores the fingerprint
// of the default the text was written against; no notice with nothing customized.
// The policy lock of these texts is the managed area's (07-special-prompts-text).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    promptEditorTests,
    storedPrompt,
    enText,
    leaveBlocked,
} from '../../ui/feature-page.mjs';

const ctx = await openPage('smartbar', { local: { connection_type: 'chatgpt_api', smartbar_enabled: true }, query: '#prompts' });
after(() => ctx.close());
const k = uiTests('smartbar', '02');
const $ = ctx.$;
const S_PAGE = 'spec 05 "SmartBar Settings Page (`pages/smartbar/`)"';
const S_PROMPTS = 'spec 02 "SmartBar prompts: router, execute and chat"';
const S_UPDATE = 'spec 02 "Default text updates"';
const KEYS = { router: 'prompt_smartbar_router', execute: 'prompt_smartbar_execute', chat: 'prompt_smartbar_chat' };
const ta = key => $('#smartbar_prompt_' + key + '_text');

k.test('tab-from-hash', S_PAGE, 'the page opened on #prompts shows the Prompts tab', () => {
    assert.equal($('#tab_btn_prompts').getAttribute('aria-selected'), 'true');
    assert.equal($('#tab_prompts').hidden, false);
    assert.equal($('#tab_options').hidden, true);
    assert.equal($('#tab_activity').hidden, true);
});

k.test('texts', S_PROMPTS, 'each textarea shows its shipped text', () => {
    for (const [key, id] of Object.entries(KEYS)) assert.equal(ta(key).value, enText(id + '_full_text'), key);
});

k.test('locked-shown', S_PROMPTS, 'the JSON sections of the router and of execute are shown read-only under the text, the chat has none', () => {
    const routerLocked = $('#smartbar_prompt_router_locked');
    const executeLocked = $('#smartbar_prompt_execute_locked');
    assert.ok(routerLocked && executeLocked);
    assert.equal(routerLocked.tagName, 'PRE', 'not a read-only block');
    assert.match(routerLocked.textContent, /\{"operations": \[\{"id"/);
    assert.match(executeLocked.textContent, /\{"subject": "", "body": ""/);
    assert.equal($('#smartbar_prompt_chat_locked'), null);
    for (const key of Object.keys(KEYS)) {
        assert.equal(ta(key).value.includes('Reply with one JSON object'), false, key + ': the JSON section is in the editable text');
    }
});

k.test('no-notice', S_UPDATE, 'nothing customized: no update notice', () => {
    for (const key of Object.keys(KEYS)) assert.equal($('#smartbar_prompt_' + key + '_update').hidden, true, key);
});

for (const [key, id] of Object.entries(KEYS)) {
    promptEditorTests(ctx, k, {
        promptId: id, textareaId: 'smartbar_prompt_' + key + '_text', defaultMsgKey: id + '_full_text',
        saveId: 'btn_save_smartbar_' + key, resetId: 'btn_reset_smartbar_' + key, tag: key + '-',
    });
}

k.test('locked-not-saved', S_PROMPTS, 'a saved text never holds the JSON section', () => {
    for (const id of Object.values(KEYS)) {
        const text = storedPrompt(ctx, id)?.text || '';
        assert.equal(text.includes('Reply with one JSON object'), false, id);
    }
});

k.test('hash-stored', S_UPDATE, 'Save stores the fingerprint of the current default with the text', () => {
    for (const id of Object.values(KEYS)) {
        assert.equal(storedPrompt(ctx, id)?.default_hash, ctx.mods.prompts.promptDefaultHash(enText(id + '_full_text')), id);
    }
});

k.test('missing-refused', S_PROMPTS, 'a router text without some variables is not saved; the message names the missing ones', async () => {
    const before = storedPrompt(ctx, KEYS.router)?.text;
    ta('router').value = enText('prompt_smartbar_router_full_text').replace('{PLACEHOLDERS}', '').replace('{LANGUAGE_RULE}', '') + ' Mine.';
    await ctx.fire(ta('router'), 'input');
    await ctx.click($('#btn_save_smartbar_router'));
    assert.equal(storedPrompt(ctx, KEYS.router)?.text, before, 'saved anyway');
    const error = $('#smartbar_prompt_router_error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /\{PLACEHOLDERS\}/);
    assert.match(error.textContent, /\{LANGUAGE_RULE\}/);
    assert.doesNotMatch(error.textContent, /\{OPERATIONS\}/);
    assert.equal($('#btn_save_smartbar_router').disabled, false, 'Save no longer available to try again');
    assert.equal(leaveBlocked(ctx), true, 'the refused text is no longer an unsaved change');
});

k.test('missing-follows', S_PROMPTS, 'the message follows the text, and the complete text is saved', async () => {
    ta('router').value = enText('prompt_smartbar_router_full_text').replace('{LANGUAGE_RULE}', '') + ' Mine.';
    await ctx.fire(ta('router'), 'input');
    assert.doesNotMatch($('#smartbar_prompt_router_error').textContent, /\{PLACEHOLDERS\}/);
    assert.match($('#smartbar_prompt_router_error').textContent, /\{LANGUAGE_RULE\}/);
    const complete = enText('prompt_smartbar_router_full_text') + ' Mine.';
    ta('router').value = complete;
    await ctx.fire(ta('router'), 'input');
    assert.equal($('#smartbar_prompt_router_error').hidden, true);
    await ctx.click($('#btn_save_smartbar_router'));
    assert.equal(storedPrompt(ctx, KEYS.router)?.text, complete);
});

k.test('no-variables-elsewhere', S_PROMPTS, 'execute and chat require no variable: any text is saved', async () => {
    for (const key of ['execute', 'chat']) {
        ta(key).value = 'Just my own words.';
        await ctx.fire(ta(key), 'input');
        await ctx.click($('#btn_save_smartbar_' + key));
        assert.equal(storedPrompt(ctx, KEYS[key])?.text, 'Just my own words.', key);
        assert.equal($('#smartbar_prompt_' + key + '_error').hidden, true, key);
    }
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
