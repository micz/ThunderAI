// The Summarize settings page with an API global connection and no per-feature override, no
// policy.
//
// Spec 05 "Summarize Settings Page" (the stored settings shown and stored with their type; the
// display mode forced inline by an automatic mode; the forced language field and its preview;
// the automatic sender list card: its own Save, normalized, the toggle, mode 3, the notice; the
// three prompt editors), "Mandatory Specific Integration (feature settings pages)"
// (summarize_auto never stored as null), "Feature Flags" (summarize_auto_senders_list),
// "Unsaved-Changes Guard", and the shared feature-page sections of tests/ui/feature-page.mjs.
//
// Tests run in order on one page: the force-language tests change the languages, the sender
// list tests change summarize_auto.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    userSets,
    writtenSince,
} from '../../ui/dom-helpers.mjs';
import {
    inheritedIntegrationTests,
    promptEditorTests,
    leaveBlocked,
    S_GUARD,
} from '../../ui/feature-page.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    default_chatgpt_lang: 'Spanish',
    summarize_auto: 1,
    summarize_display_mode: 'webchat',
    summarize_max_display_length: 400,
    summarize_max_messages: 7,
    summarize_strip_formatting: true,
    summarize_force_lang: false,
    summarize_lang: 'German',
    summarize_auto_senders: true,
    summarize_auto_senders_list: ['boss@acme.example', '@partner.example'],
};
const ctx = await openPage('summarize', { local: STORED });
after(() => ctx.close());
const k = uiTests('summarize', '01');
const $ = ctx.$;
const S_PAGE = 'spec 05 "Summarize Settings Page (`pages/summarize/`)"';
const S_MAND = 'spec 05 "Mandatory Specific Integration (feature settings pages)"';
const S_FLAGS = 'spec 05 "Feature Flags"';
const hidden = id => $('#' + id).classList.contains('hidden');
const preview = () => $('#summarize_info_additional_statements');
const forceStatement = lang => msg('prompt_summarize_force_lang') + ' ' + lang + '.';

// ---- at load ---------------------------------------------------------------------------

k.test('restore', S_PAGE, 'every stored setting is shown', () => {
    assert.equal($('#summarize_auto').value, '1');
    assert.equal($('#summarize_display_mode').value, 'webchat');
    assert.equal($('#summarize_max_display_length').valueAsNumber, 400);
    assert.equal($('#summarize_max_messages').valueAsNumber, 7);
    assert.equal($('#summarize_strip_formatting').checked, true);
    assert.equal($('#summarize_force_lang').checked, false);
    assert.equal($('#summarize_lang').value, 'German');
    assert.equal($('#summarize_auto_senders').checked, true);
});

k.test('auto-modes', S_PAGE, 'the auto-summarize select offers the modes 0..3', () => {
    assert.deepEqual([...$('#summarize_auto').options].map(o => o.value), ['0', '1', '2', '3']);
});

k.test('display-mode-free', S_PAGE, 'with a manual mode the display mode is the user\'s choice', () => {
    assert.equal($('#summarize_display_mode').disabled, false);
    assert.deepEqual([...$('#summarize_display_mode').options].map(o => o.value).sort(), ['inline', 'webchat']);
});

k.test('lang-hidden', S_PAGE, 'with the forced language off its field is hidden and nothing is previewed', () => {
    assert.equal(hidden('summarize_lang_container'), true);
    assert.equal(preview().style.display, 'none');
});

k.test('senders-load', S_PAGE, 'the sender list is shown one per line, editable, its Save disabled', () => {
    assert.equal($('#summarize_auto_senders_list').value, 'boss@acme.example\n@partner.example');
    assert.equal($('#summarize_auto_senders_list').disabled, false);
    assert.equal($('#btn_save_auto_senders').disabled, true);
    assert.equal(hidden('auto_senders_unsaved'), true);
    assert.equal(hidden('summarize_auto_senders_disabled_note'), true);
});

k.test('senders-notice', S_PAGE, 'with a manual mode, the toggle on and a list, the notice says those senders are still summarized', () => {
    assert.equal(hidden('summarize_auto_senders_notice'), false);
});

k.test('senders-not-option-input', S_PAGE, 'the list textarea is not an .option-input (it has its own Save)', () => {
    assert.equal($('#summarize_auto_senders_list').classList.contains('option-input'), false);
});

// ---- writes ------------------------------------------------------------------------------

k.test('write-settings', S_PAGE, 'each setting is stored with its type', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#summarize_display_mode'), 'inline');
    await userSets(ctx, $('#summarize_max_display_length'), '250');
    await userSets(ctx, $('#summarize_max_messages'), '12');
    await userSets(ctx, $('#summarize_strip_formatting'), false);
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.summarize_display_mode, 'inline');
    assert.strictEqual(w.summarize_max_display_length, 250);
    assert.strictEqual(w.summarize_max_messages, 12);
    assert.strictEqual(w.summarize_strip_formatting, false);
});

k.test('max-messages-zero', S_PAGE, 'the max messages field accepts 0 (no limit), stored as 0', async () => {
    assert.equal($('#summarize_max_messages').min, '0');
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#summarize_max_messages'), '0');
    assert.strictEqual(writtenSince(ctx, since).summarize_max_messages, 0);
});

k.test('max-messages-reset', S_PAGE, 'Reset puts the default back in the field and stores it as a number', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#reset_summarize_max_messages'));
    const d = ctx.mods.prefs_default.summarize_max_messages;
    assert.equal($('#summarize_max_messages').valueAsNumber, d);
    assert.strictEqual(writtenSince(ctx, since).summarize_max_messages, d);
});

k.test('auto-never-null', S_MAND, 'an empty mode select stores the default, never null', async () => {
    const sel = $('#summarize_auto');
    sel.selectedIndex = -1;
    const since = ctx.ctl.calls.length;
    await ctx.fire(sel, 'change');
    assert.strictEqual(writtenSince(ctx, since).summarize_auto, ctx.mods.prefs_default.summarize_auto);
    await userSets(ctx, sel, '1');
});

// ---- forced language ---------------------------------------------------------------------

k.test('lang-on', S_PAGE, 'switching the forced language on shows its field, stores the flag and previews the statement', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#summarize_force_lang'), true);
    assert.strictEqual(writtenSince(ctx, since).summarize_force_lang, true);
    assert.equal(hidden('summarize_lang_container'), false);
    assert.notEqual(preview().style.display, 'none');
    assert.ok(preview().textContent.includes(forceStatement('German')), preview().textContent);
});

k.test('lang-follows-field', S_PAGE, 'the preview follows the language typed (stored trimmed)', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#summarize_lang'), '  French ');
    assert.strictEqual(writtenSince(ctx, since).summarize_lang, 'French');
    assert.ok(preview().textContent.includes(forceStatement('French')), preview().textContent);
});

k.test('lang-fallback', S_PAGE, 'with no summary language the default language is previewed', async () => {
    await userSets(ctx, $('#summarize_lang'), '');
    assert.ok(preview().textContent.includes(forceStatement('Spanish')), preview().textContent);
});

k.test('lang-none', S_PAGE, 'with neither language nothing is previewed', async () => {
    await ctx.ctl.browser.storage.local.set({ default_chatgpt_lang: '' });   // from the options page
    await ctx.settle();
    assert.equal(preview().style.display, 'none');
});

k.test('lang-off', S_PAGE, 'switching it off hides the field again', async () => {
    await userSets(ctx, $('#summarize_force_lang'), false);
    assert.equal(hidden('summarize_lang_container'), true);
});

// ---- the automatic sender list -----------------------------------------------------------

k.test('senders-dirty', S_GUARD, 'editing the list enables its Save and the unsaved mark, and leaving asks', async () => {
    const list = $('#summarize_auto_senders_list');
    list.value = 'Boss@ACME.example, @partner.example\n\n*@new.example\nboss@acme.example\n';
    await ctx.fire(list, 'input');
    assert.equal($('#btn_save_auto_senders').disabled, false);
    assert.equal(hidden('auto_senders_unsaved'), false);
    assert.equal(leaveBlocked(ctx), true);
});

k.test('senders-save', S_FLAGS, 'Save stores the list normalized as an array: split, trimmed, lowercased, deduped, no empties, sorted', async () => {
    await ctx.click($('#btn_save_auto_senders'));
    assert.deepEqual(ctx.ctl.localData().summarize_auto_senders_list, ['*@new.example', '@partner.example', 'boss@acme.example']);
    assert.equal($('#summarize_auto_senders_list').value, '*@new.example\n@partner.example\nboss@acme.example');
    assert.equal($('#btn_save_auto_senders').disabled, true);
    assert.equal(hidden('auto_senders_unsaved'), true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('senders-toggle-off', S_PAGE, 'with the toggle off the list and its Save are disabled, and the notice goes', async () => {
    await userSets(ctx, $('#summarize_auto_senders'), false);
    assert.strictEqual(ctx.ctl.localData().summarize_auto_senders, false);
    assert.equal($('#summarize_auto_senders_list').disabled, true);
    assert.equal($('#btn_save_auto_senders').disabled, true);
    assert.equal(hidden('summarize_auto_senders_notice'), true);
    await userSets(ctx, $('#summarize_auto_senders'), true);
    assert.equal($('#summarize_auto_senders_list').disabled, false);
});

k.test('auto-2-inline', S_PAGE, 'an automatic mode forces the display mode to inline, disabled, and stores it', async () => {
    await userSets(ctx, $('#summarize_display_mode'), 'webchat');
    await userSets(ctx, $('#summarize_auto'), '2');
    assert.strictEqual(ctx.ctl.localData().summarize_auto, 2);
    assert.equal($('#summarize_display_mode').value, 'inline');
    assert.equal($('#summarize_display_mode').disabled, true);
    assert.strictEqual(ctx.ctl.localData().summarize_display_mode, 'inline');
    assert.equal(hidden('summarize_auto_senders_notice'), true, 'notice with an automatic mode');
});

k.test('auto-3-card', S_PAGE, 'mode 3 disables the whole sender card and shows why', async () => {
    await userSets(ctx, $('#summarize_auto'), '3');
    assert.equal($('#summarize_auto_senders').disabled, true);
    assert.equal($('#summarize_auto_senders_list').disabled, true);
    assert.equal($('#btn_save_auto_senders').disabled, true);
    assert.equal(hidden('summarize_auto_senders_disabled_note'), false);
});

k.test('auto-back', S_PAGE, 'back to a manual mode the card and the display mode are usable again', async () => {
    await userSets(ctx, $('#summarize_auto'), '0');
    assert.equal($('#summarize_auto_senders').disabled, false);
    assert.equal($('#summarize_auto_senders_list').disabled, false);
    assert.equal(hidden('summarize_auto_senders_disabled_note'), true);
    assert.equal($('#summarize_display_mode').disabled, false);
    assert.equal(hidden('summarize_auto_senders_notice'), false);
});

// ---- connection panel and the three editors ----------------------------------------------

inheritedIntegrationTests(ctx, k, { prefix: 'summarize', promptId: 'prompt_summarize' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_summarize', textareaId: 'summarize_prompt_text',
    defaultMsgKey: 'prompt_summarize_full_text',
});
promptEditorTests(ctx, k, {
    promptId: 'prompt_summarize_email_template', textareaId: 'summarize_email_template_text',
    defaultMsgKey: 'prompt_summarize_email_template_full_text',
    saveId: 'btn_save_email_template', resetId: 'btn_reset_email_template', tag: 'template-',
});
promptEditorTests(ctx, k, {
    promptId: 'prompt_summarize_email_separator', textareaId: 'summarize_email_separator_text',
    defaultMsgKey: 'prompt_summarize_email_separator_full_text',
    saveId: 'btn_save_email_separator', resetId: 'btn_reset_email_separator', tag: 'separator-',
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
