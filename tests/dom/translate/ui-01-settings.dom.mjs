// The Translate settings page with an API global connection and no per-feature override, no
// policy.
//
// Spec 05 "Translate Settings Page" (the stored settings shown, each change stored with its
// type), "Mandatory Specific Integration (feature settings pages)" (translate_auto never stored
// as null), and the shared feature-page sections run by tests/ui/feature-page.mjs: "Special
// Prompt Integration Overrides", "The Prompt Is Authoritative For API Parameters", "Connection
// Settings Panel — Advanced Options Disclosure" / "— Connection Test Status Strip" (feature
// pages), "Unsaved-Changes Guard".

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    userSets,
    writtenSince,
} from '../../ui/dom-helpers.mjs';
import {
    inheritedIntegrationTests,
    promptEditorTests,
} from '../../ui/feature-page.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    translate_auto: 2,
    translate_max_display_length: 300,
    translate_lang: 'Italian',
    translate_exclude_lang: 'en, fr',
};
const ctx = await openPage('translate', { local: STORED });
after(() => ctx.close());
const k = uiTests('translate', '01');
const $ = ctx.$;
const S_PAGE = 'spec 05 "Translate Settings Page (`pages/translate/`)"';
const S_MAND = 'spec 05 "Mandatory Specific Integration (feature settings pages)"';

k.test('restore', S_PAGE, 'the stored mode, max display length, target and excluded languages are shown', () => {
    assert.equal($('#translate_auto').value, '2');
    assert.equal($('#translate_max_display_length').valueAsNumber, 300);
    assert.equal($('#translate_lang').value, 'Italian');
    assert.equal($('#translate_exclude_lang').value, 'en, fr');
});

k.test('auto-modes', S_PAGE, 'the auto-translate select offers the modes 0..3', () => {
    assert.deepEqual([...$('#translate_auto').options].map(o => o.value), ['0', '1', '2', '3']);
});

k.test('write-auto', S_PAGE, 'a mode is stored as a number', async () => {
    let since = ctx.ctl.calls.length;
    await userSets(ctx, $('#translate_auto'), '1');
    assert.strictEqual(writtenSince(ctx, since).translate_auto, 1);
    since = ctx.ctl.calls.length;
    await userSets(ctx, $('#translate_auto'), '3');
    assert.strictEqual(writtenSince(ctx, since).translate_auto, 3);
});

k.test('auto-never-null', S_MAND, 'an empty mode select stores the default, never null', async () => {
    const sel = $('#translate_auto');
    sel.selectedIndex = -1;
    const since = ctx.ctl.calls.length;
    await ctx.fire(sel, 'change');
    assert.strictEqual(writtenSince(ctx, since).translate_auto, ctx.mods.prefs_default.translate_auto);
});

k.test('write-max-length', S_PAGE, 'the max display length is stored as a number', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#translate_max_display_length'), '500');
    assert.strictEqual(writtenSince(ctx, since).translate_max_display_length, 500);
});

k.test('write-lang', S_PAGE, 'the target language is stored trimmed', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#translate_lang'), '  French ');
    assert.strictEqual(writtenSince(ctx, since).translate_lang, 'French');
});

k.test('write-exclude-lang', S_PAGE, 'the excluded languages are stored trimmed, as typed', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#translate_exclude_lang'), '  de,  IT ');
    assert.strictEqual(writtenSince(ctx, since).translate_exclude_lang, 'de,  IT');
});

inheritedIntegrationTests(ctx, k, { prefix: 'translate', promptId: 'prompt_translate_this' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_translate_this', textareaId: 'translate_prompt_text',
    defaultMsgKey: 'prompt_translate_this_full_text',
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
