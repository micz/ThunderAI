// The Add Tags settings page with an API global connection, no per-feature override and stored
// settings, no policy.
//
// Spec 05 "Feature Flags" (the add_tags_* settings, add_tags_max_messages, the exclusion list
// saved lowercase, add_tags_enabled_accounts with [] = all accounts), "Address-list preferences
// and the empty-string trap" (the allow-list string), "Feature-Page Shell" (the auto-tagging
// sub-rows revealed with an explicit display), spec 02 "Add tags: extra prompt statements" (the
// page's preview follows the same rules as finalizePrompt_add_tags()), "Unsaved-Changes Guard",
// and the shared feature-page sections of tests/ui/feature-page.mjs.
//
// The harness's messages.tags.list() answers no tag; this file gives it two after the page has
// opened (the preview reads the tags on every refresh).

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
    until,
} from '../../ui/dom-helpers.mjs';
import {
    inheritedIntegrationTests,
    promptEditorTests,
    leaveBlocked,
    S_GUARD,
} from '../../ui/feature-page.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
];
const STORED = {
    connection_type: 'chatgpt_api',
    default_chatgpt_lang: 'German',
    add_tags_maxnum: 3,
    add_tags_max_messages: 50,
    add_tags_force_lang: true,
    add_tags_first_uppercase: false,
    add_tags_hide_exclusions: true,
    add_tags_exclusions_exact_match: true,
    add_tags_auto: false,
    add_tags_auto_uselist: false,
    add_tags_auto_uselist_list: 'work, urgent',
    add_tags_auto_force_existing: false,
    add_tags_exclusions: ['newsletter', 'spam'],
};
const ctx = await openPage('addtags', { local: STORED, accounts: ACCOUNTS });
after(() => ctx.close());
ctx.ctl.browser.messages.tags.list = async () => [
    { key: '$label1', tag: 'Work', color: '#ff0000', ordinal: '' },
    { key: 'personal', tag: 'Personal', color: '#00ff00', ordinal: '' },
];
const k = uiTests('addtags', '01');
const $ = ctx.$;
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_LISTS = 'spec 05 "Address-list preferences and the empty-string trap"';
const S_SHELL = 'spec 05 "Feature-Page Shell (opt-in `body.mzta_feature_page`)"';
const S_STMT = 'spec 02 "Add tags: extra prompt statements"';
const hidden = id => $('#' + id).classList.contains('hidden');
const preview = () => $('#addtags_info_additional_statements');
const previewText = () => preview().style.display === 'none' ? '' : preview().textContent;
const MAXNUM = n => msg('prompt_add_tags_maxnum') + ' ' + n + '.';
const FORCE_LANG = lang => msg('prompt_add_tags_force_lang') + ' ' + lang + '.';
const USE_LIST = msg('prompt_add_tags_use_list') + ':';
const FORCE_EXISTING = list => msg('prompt_add_tags_force_existing') + ': ' + list + '.';
/** Wait for the preview to settle on what the stored settings now say (it reads them back). */
const previewSays = (pred, what) => until(ctx, () => pred(previewText()), 'the preview to show ' + what, 3000);

// ---- at load ---------------------------------------------------------------------------

k.test('restore', S_FLAGS, 'every stored setting is shown', () => {
    assert.equal($('#add_tags_maxnum').valueAsNumber, 3);
    assert.equal($('#add_tags_max_messages').valueAsNumber, 50);
    for (const id of ['add_tags_force_lang', 'add_tags_first_uppercase', 'add_tags_hide_exclusions',
        'add_tags_exclusions_exact_match', 'add_tags_auto', 'add_tags_auto_uselist', 'add_tags_auto_force_existing']) {
        assert.equal($('#' + id).checked, STORED[id], id);
    }
    assert.equal($('#addtags_excl_list').value, 'newsletter\nspam');
});

k.test('auto-rows-hidden', S_SHELL, 'with automatic tagging off its sub-rows are hidden', () => {
    for (const id of ['add_tags_auto_only_inbox_tr', 'add_tags_auto_include_sent_tr', 'add_tags_auto_uselist_tr', 'account_selector_container']) {
        assert.equal($('#' + id).style.display, 'none', id);
    }
});

k.test('uselist-disabled', S_FLAGS, 'with the allow list off its textarea is disabled', () => {
    assert.equal($('#add_tags_auto_uselist_list').disabled, true);
});

k.test('preview-load', S_STMT, 'the preview shows the tag limit and the forced language', () => {
    assert.ok(previewText().includes(MAXNUM(3)), previewText());
    assert.ok(previewText().includes(FORCE_LANG('German')), previewText());
    assert.equal(previewText().includes(USE_LIST), false);
});

// ---- writes ------------------------------------------------------------------------------

k.test('write-numbers', S_FLAGS, 'the tag limit and the context-menu message cap are stored as numbers, 0 included', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#add_tags_max_messages'), '0');
    await userSets(ctx, $('#add_tags_maxnum'), '5');
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.add_tags_max_messages, 0);
    assert.strictEqual(w.add_tags_maxnum, 5);
});

k.test('preview-maxnum', S_STMT, 'the preview follows a new tag limit', async () => {
    await previewSays(t => t.includes(MAXNUM(5)), MAXNUM(5));
});

k.test('auto-rows-shown', S_SHELL, 'switching automatic tagging on reveals the sub-rows with the display each needs', async () => {
    await userSets(ctx, $('#add_tags_auto'), true);
    assert.strictEqual(ctx.ctl.localData().add_tags_auto, true);
    assert.equal($('#add_tags_auto_only_inbox_tr').style.display, 'flex');
    assert.equal($('#add_tags_auto_include_sent_tr').style.display, 'flex');
    assert.equal($('#add_tags_auto_uselist_tr').style.display, 'flex');
    assert.equal($('#account_selector_container').style.display, 'block');
    assert.equal($('#add_tags_auto_infoline').style.display, 'inline');
});

k.test('uselist-on', S_STMT, 'with the allow list on the preview carries it', async () => {
    await userSets(ctx, $('#add_tags_auto_uselist'), true);
    assert.equal($('#add_tags_auto_uselist_list').disabled, false);
    await previewSays(t => t.includes(USE_LIST + ' work, urgent.'), 'the allow list');
});

k.test('uselist-save', S_LISTS, 'the allow list is stored as a normalized string, and shown one per line with no blank line', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#add_tags_auto_uselist_list'), '\n  Urgent\n\nwork,Work \n');
    const stored = writtenSince(ctx, since).add_tags_auto_uselist_list;
    assert.equal(typeof stored, 'string');
    assert.deepEqual(stored.split(/,\s*/), ['urgent', 'work']);
    assert.equal($('#add_tags_auto_uselist_list').value, 'urgent\nwork');
});

k.test('force-existing-uselist', S_STMT, 'forcing existing tags with an allow list: their intersection, as the tags are written, and no language or allow-list statement', async () => {
    await userSets(ctx, $('#add_tags_auto_force_existing'), true);
    await previewSays(t => t.includes(FORCE_EXISTING('Work')), FORCE_EXISTING('Work'));
    assert.equal(previewText().includes(FORCE_LANG('German')), false, 'force_lang not suppressed');
    assert.equal(previewText().includes(USE_LIST), false, 'the allow-list statement kept');
});

k.test('force-existing-all', S_STMT, 'forcing existing tags without an allow list: every existing tag', async () => {
    await userSets(ctx, $('#add_tags_auto_uselist'), false);
    await previewSays(t => t.includes(FORCE_EXISTING('Work, Personal')), FORCE_EXISTING('Work, Personal'));
});

k.test('force-existing-placeholder', S_STMT, 'not when the prompt text already holds {%tags_full_list%}', async () => {
    const ta = $('#addtags_prompt_text');
    ta.value = ta.value + ' {%tags_full_list%}';
    await ctx.fire(ta, 'input');
    await ctx.fire(ta, 'change');
    await previewSays(t => !t.includes(msg('prompt_add_tags_force_existing')), 'no force-existing statement');
    ta.value = msg('prompt_add_tags_full_text');
    await ctx.fire(ta, 'input');
    await ctx.fire(ta, 'change');
    await userSets(ctx, $('#add_tags_auto_force_existing'), false);
});

k.test('excl-save', S_FLAGS, 'the exclusion list has its own Save, and stores it lowercase as an array', async () => {
    const list = $('#addtags_excl_list');
    list.value = 'Spam\nNewsletter, PROMO\n\n';
    await ctx.fire(list, 'input');
    assert.equal($('#btn_save_excl_list').disabled, false);
    assert.equal(hidden('excl_list_unsaved'), false);
    assert.equal(leaveBlocked(ctx), true);
    await ctx.click($('#btn_save_excl_list'));
    assert.deepEqual(ctx.ctl.localData().add_tags_exclusions, ['newsletter', 'promo', 'spam']);
    assert.equal(list.value, 'newsletter\npromo\nspam');
    assert.equal($('#btn_save_excl_list').disabled, true);
    assert.equal(hidden('excl_list_unsaved'), true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('excl-dirty-baseline', S_GUARD, 'after a Save, typing the saved list back leaves nothing to save', async () => {
    const list = $('#addtags_excl_list');
    list.value = 'x';
    await ctx.fire(list, 'input');
    list.value = 'newsletter\npromo\nspam';
    await ctx.fire(list, 'input');
    assert.equal($('#btn_save_excl_list').disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('accounts-all-checked', S_FLAGS, 'with [] stored every account is checked', () => {
    assert.deepEqual(ctx.$$('#account_selector_checkboxes .accountCheckbox').map(b => b.checked), [true, true]);
});

k.test('accounts-one', S_FLAGS, 'unchecking one stores the others\' ids', async () => {
    await userSets(ctx, ctx.$$('#account_selector_checkboxes .accountCheckbox')[0], false);
    assert.deepEqual(ctx.ctl.localData().add_tags_enabled_accounts, ['account2']);
});

// ---- connection panel and the editor -----------------------------------------------------

inheritedIntegrationTests(ctx, k, { prefix: 'add_tags', promptId: 'prompt_add_tags' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_add_tags', textareaId: 'addtags_prompt_text',
    defaultMsgKey: 'prompt_add_tags_full_text',
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
