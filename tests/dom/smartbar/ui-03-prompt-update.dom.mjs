// The Prompts tab of the Smart bar page with the three texts customized against an older default
// (a fingerprint that is not the current default's), no policy.
//
// Spec 02 "Default text updates": the notice is shown for each; a Save while it is pending keeps
// the old fingerprint; Compare opens the change picker (spec 07, the user's text against the new
// default), closing it changes nothing, its "use" action puts the composed text into the editor
// unsaved and settles the notice, and the next Save stores the current fingerprint; every change
// rejected gives the user's text back, line structure included, and settles the notice at once
// (the current fingerprint stored); "Keep my text" stores the current fingerprint and keeps the
// text. A text with no fingerprint: ui-04-prompt-legacy.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    storedPrompt,
    enText,
} from '../../ui/feature-page.mjs';

const USER_ROUTER = 'My router.\n\n{OPERATIONS}\n{PLACEHOLDERS}\n{LANGUAGE_RULE}';
const USER_EXECUTE = 'Write short emails.\n\nNever use exclamation marks.\n- One idea per paragraph.';
const USER_CHAT = 'Answer briefly.';
const sp = (id, text, extra = {}) => ({ id, text, is_default: '1', is_special: '1', show_in: 'none', custom_icon: '', ...extra });

const ctx = await openPage('smartbar', {
    local: {
        connection_type: 'chatgpt_api',
        _special_prompts: [
            sp('prompt_smartbar_router', USER_ROUTER, { default_hash: 'deadbeef' }),
            sp('prompt_smartbar_execute', USER_EXECUTE, { default_hash: '00000000' }),
            sp('prompt_smartbar_chat', USER_CHAT, { default_hash: '00000000' }),
        ],
    },
    query: '#prompts',
});
after(() => ctx.close());
const k = uiTests('smartbar', '03');
const $ = ctx.$;
const S_UPDATE = 'spec 02 "Default text updates"';
const S_PAGE = 'spec 05 "Smart Bar Settings Page (`pages/smartbar/`)"';
const notice = key => $('#smartbar_prompt_' + key + '_update');
const ta = key => $('#smartbar_prompt_' + key + '_text');
const currentHash = id => ctx.mods.prompts.promptDefaultHash(enText(id + '_full_text'));
const picker = () => ctx.document.querySelector('.mzta_compare_overlay diff-picker');

k.test('shown', S_UPDATE, 'the notice is shown for each text written against another default', () => {
    assert.equal(notice('router').hidden, false);
    assert.equal(notice('execute').hidden, false);
    assert.equal(notice('chat').hidden, false);
    assert.equal(ta('router').value, USER_ROUTER, 'the user\'s text is still the one in use');
});

k.test('save-pending', S_UPDATE, 'a Save while the notice is pending keeps the old fingerprint and the notice', async () => {
    ta('router').value = USER_ROUTER + '\nBe brief.';
    await ctx.fire(ta('router'), 'input');
    await ctx.click($('#btn_save_smartbar_router'));
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').text, USER_ROUTER + '\nBe brief.');
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').default_hash, 'deadbeef');
    assert.equal(notice('router').hidden, false);
});

k.test('compare-close', S_UPDATE, 'Compare opens the change picker; closing it changes nothing', async () => {
    await ctx.click(notice('router').querySelector('[data-action="compare"]'));
    assert.ok(picker(), 'no change picker');
    assert.ok(picker().shadowRoot, 'the picker did not render');
    await ctx.click($('#mzta_compare_close'));
    assert.equal(picker(), null, 'the box is still open');
    assert.equal(ta('router').value, USER_ROUTER + '\nBe brief.');
    assert.equal(notice('router').hidden, false);
    assert.equal($('#btn_save_smartbar_router').disabled, true);
});

k.test('compare-adopt', S_UPDATE, 'the picker\'s use action puts the composed text into the editor, unsaved; the next Save stores the current fingerprint', async () => {
    await ctx.click(notice('router').querySelector('[data-action="compare"]'));
    const use = picker().shadowRoot.querySelector('.picker-use-btn');
    assert.ok(use, 'no use button in the picker');
    await ctx.click(use);
    assert.equal(picker(), null, 'the box is still open');
    // Every change accepted (the picker's initial state): the new default, line for line.
    assert.equal(ta('router').value, enText('prompt_smartbar_router_full_text'));
    assert.equal(notice('router').hidden, true);
    assert.equal($('#btn_save_smartbar_router').disabled, false, 'the adopted text is not an unsaved change');
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').text, USER_ROUTER + '\nBe brief.', 'adopted text saved by itself');
    await ctx.click($('#btn_save_smartbar_router'));
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').text, enText('prompt_smartbar_router_full_text'));
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').default_hash, currentHash('prompt_smartbar_router'));
});

k.test('reject-all', S_UPDATE, 'every change rejected gives the user\'s text back and settles the notice at once', async () => {
    await ctx.click(notice('execute').querySelector('[data-action="compare"]'));
    const root = picker().shadowRoot;
    const rejectAll = root.querySelector('.picker-reject-btn');
    assert.ok(rejectAll, 'no reject-all button in the picker');
    await ctx.click(rejectAll);
    await ctx.click(root.querySelector('.picker-use-btn'));
    assert.equal(ta('execute').value, USER_EXECUTE, 'the user\'s text did not come back as it was');
    assert.equal(notice('execute').hidden, true);
    assert.equal($('#btn_save_smartbar_execute').disabled, true, 'nothing changed, nothing to save');
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_execute').text, USER_EXECUTE);
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_execute').default_hash, currentHash('prompt_smartbar_execute'));
});

k.test('dismiss', S_UPDATE, '"Keep my text" stores the current fingerprint and keeps the text', async () => {
    await ctx.click(notice('chat').querySelector('[data-action="dismiss"]'));
    assert.equal(notice('chat').hidden, true);
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_chat').text, USER_CHAT);
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_chat').default_hash, currentHash('prompt_smartbar_chat'));
    assert.equal(ta('chat').value, USER_CHAT);
    assert.equal($('#btn_save_smartbar_chat').disabled, true);
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
