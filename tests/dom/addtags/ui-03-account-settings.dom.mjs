// The Add Tags settings page, "Settings for single accounts" section, two accounts, no policy.
//
// Spec 05 "Settings for single accounts (Add Tags page)" (the account selector and its "(own
// settings)" suffix, the discard confirm on a switch, the inherit rule and its sync with the global
// controls and the exclusion list's Save, Save with only the overridden rows in their stored form,
// a blank prompt and an emptied entry, "Reset to the global settings", the unsaved marker, the account
// preview with the effective values), "Unsaved-Changes Guard" (the section's Save guards leaving),
// spec 02 "Add tags: per-account settings" (the stored shape of add_tags_account_settings: the
// override keys are the global keys, a second account's entry untouched).
//
// The scenario runs in order: each test starts from the state the previous one left.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    userSets,
    writtenSince,
    until,
} from '../../ui/dom-helpers.mjs';
import {
    leaveBlocked,
    S_GUARD,
} from '../../ui/feature-page.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
];
const HOME_ENTRY = { add_tags_force_lang: false, prompt_text: 'Home prompt {%mail_text_body%}' };
const STORED = {
    connection_type: 'chatgpt_api',
    default_chatgpt_lang: 'German',
    add_tags_maxnum: 3,
    add_tags_force_lang: true,
    add_tags_auto_force_existing: false,
    add_tags_auto_uselist: false,
    add_tags_auto_uselist_list: 'work, urgent',
    add_tags_exclusions: ['newsletter', 'spam'],
    add_tags_exclusions_exact_match: true,
    add_tags_account_settings: { account2: HOME_ENTRY },
};
const ctx = await openPage('addtags', { local: STORED, accounts: ACCOUNTS });
after(() => ctx.close());
const k = uiTests('addtags', '03');
const $ = ctx.$;

const S_ACC = 'spec 05 "Settings for single accounts (Add Tags page)"';
const S_PER = 'spec 02 "Add tags: per-account settings"';
const ROW_KEYS = ['add_tags_maxnum', 'add_tags_force_lang', 'default_chatgpt_lang', 'add_tags_auto_force_existing',
    'add_tags_auto_uselist', 'add_tags_auto_uselist_list', 'add_tags_exclusions', 'add_tags_exclusions_exact_match'];
const BOOL_KEYS = ['add_tags_force_lang', 'add_tags_auto_force_existing', 'add_tags_auto_uselist', 'add_tags_exclusions_exact_match'];
const ctl = key => $('#addtags_account_' + key);
const box = key => $('#addtags_account_' + key + '_inherit');
const select = () => $('#addtags_account_settings_account');
const editor = () => $('#addtags_account_prompt_text');
const saveBtn = () => $('#btn_save_account_settings');
const removeBtn = () => $('#btn_account_settings_remove');
const unsaved = () => !$('#addtags_account_settings_unsaved').classList.contains('hidden');
const stored = () => ctx.ctl.localData().add_tags_account_settings;
const SUFFIX = msg('AddTags_account_settings_custom_suffix');
const optionLabel = id => [...select().options].find(o => o.value === id).textContent;
/** A textarea's entries, one per line, blank lines dropped, in order. */
const lines = el => el.value.split('\n').map(s => s.trim()).filter(Boolean);
/** What a row shows, in a comparable form. */
function shownValue(key) {
    const el = ctl(key);
    if (BOOL_KEYS.includes(key)) return el.checked;
    if (key === 'add_tags_maxnum') return el.valueAsNumber;
    if (key === 'add_tags_auto_uselist_list' || key === 'add_tags_exclusions') return lines(el).sort();
    return el.value;
}
const previewText = id => $('#' + id).style.display === 'none' ? '' : $('#' + id).textContent;
const accPreview = () => previewText('addtags_account_info_additional_statements');
const globalPreview = () => previewText('addtags_info_additional_statements');
const MAXNUM = n => msg('prompt_add_tags_maxnum') + ' ' + n + '.';
const FORCE_LANG = lang => msg('prompt_add_tags_force_lang') + ' ' + lang + '.';
const previewSays = (get, pred, what) => until(ctx, () => pred(get()), what, 3000);

/** The global values the inherited rows must show, kept in step with the test's own changes. */
const globals = {
    add_tags_maxnum: 3,
    add_tags_force_lang: true,
    default_chatgpt_lang: 'German',
    add_tags_auto_force_existing: false,
    add_tags_auto_uselist: false,
    add_tags_auto_uselist_list: ['urgent', 'work'],
    add_tags_exclusions: ['newsletter', 'spam'],
    add_tags_exclusions_exact_match: true,
};

function assertInherited(keys = ROW_KEYS) {
    for (const key of keys) {
        assert.equal(box(key).checked, true, key + ': box not checked');
        assert.equal(ctl(key).disabled, true, key + ': control enabled');
        assert.deepEqual(shownValue(key), globals[key], key + ': not the global value');
    }
}

async function selectAccount(id) {
    select().value = id;
    await ctx.fire(select(), 'change');
}

// ---- at load -----------------------------------------------------------------------------

k.test('selector', S_ACC, 'one option per account, the suffix only for the account with a stored entry', () => {
    assert.deepEqual([...select().options].map(o => o.value), ['account1', 'account2']);
    assert.equal(optionLabel('account1'), 'Work');
    assert.equal(optionLabel('account2'), 'Home ' + SUFFIX);
    assert.equal(select().disabled, false);
});

k.test('load-inherited', S_ACC, 'an account with no entry: every box checked, every control disabled showing the global value, the editor empty', async () => {
    if (select().value !== 'account1') await selectAccount('account1');
    assertInherited();
    assert.equal(editor().value, '');
    assert.equal(editor().disabled, false);
});

k.test('load-clean', S_ACC, 'nothing to save and nothing to remove: Save and "Reset to the global settings" disabled, no unsaved marker', () => {
    assert.equal(saveBtn().disabled, true);
    assert.equal(removeBtn().disabled, true);
    assert.equal(unsaved(), false);
});

k.test('load-guard', S_GUARD, 'opening the section blocks no leave', () => {
    assert.equal(leaveBlocked(ctx), false);
});

k.test('nothing-written', S_ACC, 'opening the page writes no account settings', () => {
    assert.deepEqual(stored(), { account2: HOME_ENTRY });
});

// ---- the inherit rule --------------------------------------------------------------------

k.test('follow-global-controls', S_ACC, 'the inherited rows follow a change of the global controls', async () => {
    await userSets(ctx, $('#add_tags_maxnum'), '4');
    globals.add_tags_maxnum = 4;
    await userSets(ctx, $('#add_tags_force_lang'), false);
    globals.add_tags_force_lang = false;
    await userSets(ctx, $('#add_tags_exclusions_exact_match'), false);
    globals.add_tags_exclusions_exact_match = false;
    await userSets(ctx, $('#add_tags_auto_uselist'), true);
    globals.add_tags_auto_uselist = true;
    await userSets(ctx, $('#add_tags_auto_uselist_list'), 'urgent\nwork\ninvoice');
    globals.add_tags_auto_uselist_list = ['invoice', 'urgent', 'work'];
    assertInherited();
});

k.test('follow-global-exclusions', S_ACC, 'the inherited exclusion row follows the global list once Saved, not while unsaved', async () => {
    const list = $('#addtags_excl_list');
    list.value = 'Spam\nNewsletter\nPromo';
    await ctx.fire(list, 'input');
    assert.deepEqual(shownValue('add_tags_exclusions'), ['newsletter', 'spam'], 'follows the unsaved global list');
    await ctx.click($('#btn_save_excl_list'));
    globals.add_tags_exclusions = ['newsletter', 'promo', 'spam'];
    assertInherited(['add_tags_exclusions']);
});

k.test('uncheck-starts-global', S_ACC, 'unchecking a box enables the control, starting from the global value', async () => {
    for (const key of ROW_KEYS) {
        await userSets(ctx, box(key), false);
        assert.equal(ctl(key).disabled, false, key + ': control still disabled');
        assert.deepEqual(shownValue(key), globals[key], key + ': not starting from the global value');
    }
});

k.test('uncheck-dirty', S_ACC, 'an unchecked box is an unsaved change: marker shown, Save and "Reset to the global settings" enabled', () => {
    assert.equal(unsaved(), true);
    assert.equal(saveBtn().disabled, false);
    assert.equal(removeBtn().disabled, false);
});

k.test('uncheck-guard', S_GUARD, 'with unsaved account settings leaving the page asks', () => {
    assert.equal(leaveBlocked(ctx), true);
});

k.test('recheck-global', S_ACC, 'checking the box again puts the global value back and leaves nothing to save', async () => {
    ctl('add_tags_maxnum').value = '11';
    await ctx.fire(ctl('add_tags_maxnum'), 'input');
    for (const key of ROW_KEYS) await userSets(ctx, box(key), true);
    assertInherited();
    assert.equal(unsaved(), false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

// ---- overrides, the preview and Save -----------------------------------------------------

const ACCOUNT_PROMPT = 'Account prompt for {%mail_text_body%}';

k.test('override-edit', S_ACC, 'overridden rows take the user\'s values; the marker shows', async () => {
    await userSets(ctx, box('add_tags_maxnum'), false);
    await userSets(ctx, ctl('add_tags_maxnum'), '7');
    await userSets(ctx, box('add_tags_force_lang'), false);
    await userSets(ctx, ctl('add_tags_force_lang'), true);
    await userSets(ctx, box('default_chatgpt_lang'), false);
    await userSets(ctx, ctl('default_chatgpt_lang'), 'French');
    await userSets(ctx, box('add_tags_auto_uselist_list'), false);
    await userSets(ctx, ctl('add_tags_auto_uselist_list'), '\n  Urgent\n\nbilling,Billing \n');
    await userSets(ctx, box('add_tags_exclusions'), false);
    await userSets(ctx, ctl('add_tags_exclusions'), 'Promo\nNEWS\n\nnews');
    editor().value = ACCOUNT_PROMPT;
    await ctx.fire(editor(), 'input');
    assert.equal(unsaved(), true);
    assert.equal(saveBtn().disabled, false);
    assert.equal(leaveBlocked(ctx), true);
});

k.test('preview-effective', S_ACC, 'the account preview shows the effective values: the account\'s tag limit and language, not the global ones', async () => {
    await previewSays(accPreview, t => t.includes(MAXNUM(7)) && t.includes(FORCE_LANG('French')), 'the account preview to show 7 and French');
    assert.equal(accPreview().includes(MAXNUM(4)), false, accPreview());
});

k.test('preview-global-unchanged', S_ACC, 'the global preview keeps the global values', async () => {
    await previewSays(globalPreview, t => t.includes(MAXNUM(4)), 'the global preview to show 4');
    assert.equal(globalPreview().includes(MAXNUM(7)), false, globalPreview());
    assert.equal(globalPreview().includes('French'), false, globalPreview());
});

k.test('save-entry', S_PER, 'Save stores exactly the overridden rows, in their stored form, under the selected account only', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click(saveBtn());
    const w = writtenSince(ctx, since);
    assert.deepEqual(Object.keys(w), ['add_tags_account_settings'], 'other preferences written: ' + Object.keys(w));
    const all = w.add_tags_account_settings;
    assert.deepEqual(Object.keys(all).sort(), ['account1', 'account2']);
    assert.deepEqual(all.account2, HOME_ENTRY, 'the other account was touched');
    const e = all.account1;
    assert.deepEqual(Object.keys(e).sort(), ['add_tags_auto_uselist_list', 'add_tags_exclusions', 'add_tags_force_lang',
        'add_tags_maxnum', 'default_chatgpt_lang', 'prompt_text']);
    assert.strictEqual(e.add_tags_maxnum, 7);
    assert.strictEqual(e.add_tags_force_lang, true);
    assert.strictEqual(e.default_chatgpt_lang, 'French');
    assert.equal(typeof e.add_tags_auto_uselist_list, 'string');
    assert.deepEqual(e.add_tags_auto_uselist_list.split(/,\s*/), ['billing', 'urgent']);
    assert.deepEqual(e.add_tags_exclusions, ['news', 'promo']);
    assert.strictEqual(e.prompt_text, ACCOUNT_PROMPT);
});

k.test('save-clean', S_ACC, 'after Save: no unsaved marker, Save disabled, "Reset to the global settings" enabled, the suffix on the account', () => {
    assert.equal(unsaved(), false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(removeBtn().disabled, false);
    assert.equal(optionLabel('account1'), 'Work ' + SUFFIX);
    assert.equal(optionLabel('account2'), 'Home ' + SUFFIX);
});

k.test('save-guard', S_GUARD, 'after Save leaving is free again', () => {
    assert.equal(leaveBlocked(ctx), false);
});

// ---- switching account -------------------------------------------------------------------

k.test('switch-other', S_ACC, 'the other account shows its own entry: its overridden row unchecked, the rest inherited', async () => {
    const before = ctx.dialogs.length;
    await selectAccount('account2');
    assert.equal(ctx.dialogs.length, before, 'a clean switch asked for confirmation');
    assert.equal(box('add_tags_force_lang').checked, false);
    assert.equal(ctl('add_tags_force_lang').disabled, false);
    assert.equal(ctl('add_tags_force_lang').checked, false);
    assertInherited(ROW_KEYS.filter(key => key !== 'add_tags_force_lang'));
    assert.equal(editor().value, HOME_ENTRY.prompt_text);
});

k.test('switch-back', S_ACC, 'back on the first account the stored values are shown, their boxes unchecked', async () => {
    await selectAccount('account1');
    const overridden = { add_tags_maxnum: 7, add_tags_force_lang: true, default_chatgpt_lang: 'French',
        add_tags_auto_uselist_list: ['billing', 'urgent'], add_tags_exclusions: ['news', 'promo'] };
    for (const [key, value] of Object.entries(overridden)) {
        assert.equal(box(key).checked, false, key + ': box checked');
        assert.equal(ctl(key).disabled, false, key + ': control disabled');
        assert.deepEqual(shownValue(key), value, key);
    }
    assertInherited(ROW_KEYS.filter(key => !(key in overridden)));
    assert.equal(editor().value, ACCOUNT_PROMPT);
    assert.equal(unsaved(), false);
});

k.test('switch-dirty-cancel', S_ACC, 'switching with unsaved changes asks; cancelling puts the previous account back with its edits', async () => {
    await userSets(ctx, ctl('add_tags_maxnum'), '8');
    const real = globalThis.confirm;
    const asked = [];
    globalThis.confirm = (...args) => { asked.push(args); return false; };
    ctx.window.confirm = globalThis.confirm;
    try {
        await selectAccount('account2');
    } finally {
        globalThis.confirm = real;
        ctx.window.confirm = real;
    }
    assert.equal(asked.length, 1, 'no confirmation asked');
    assert.equal(asked[0][0], msg('AddTags_account_settings_discard_confirm'));
    assert.equal(select().value, 'account1');
    assert.equal(ctl('add_tags_maxnum').valueAsNumber, 8);
    assert.equal(unsaved(), true);
});

k.test('switch-dirty-discard', S_ACC, 'confirming discards the edits: nothing written, the stored entry shown on return', async () => {
    const since = ctx.ctl.calls.length;
    const before = ctx.dialogs.length;
    await selectAccount('account2');      // the harness's confirm answers true
    assert.equal(ctx.dialogs.slice(before).filter(d => d.kind === 'confirm').length, 1);
    assert.equal(select().value, 'account2');
    assert.deepEqual(writtenSince(ctx, since), {});
    await selectAccount('account1');
    assert.equal(ctl('add_tags_maxnum').valueAsNumber, 7);
    assert.equal(unsaved(), false);
});

// ---- blank values, removal ---------------------------------------------------------------

k.test('blank-prompt', S_ACC, 'a blank prompt stores no prompt_text, an emptied tag limit no add_tags_maxnum', async () => {
    editor().value = '   \n ';
    await ctx.fire(editor(), 'input');
    await userSets(ctx, ctl('add_tags_maxnum'), '');
    await ctx.click(saveBtn());
    const e = stored().account1;
    assert.ok(e, 'the entry was removed');
    assert.equal('prompt_text' in e, false, 'prompt_text stored: ' + JSON.stringify(e.prompt_text));
    assert.equal('add_tags_maxnum' in e, false, 'add_tags_maxnum stored: ' + JSON.stringify(e.add_tags_maxnum));
    assert.strictEqual(e.default_chatgpt_lang, 'French');
    assert.deepEqual(stored().account2, HOME_ENTRY);
});

k.test('remove', S_ACC, '"Reset to the global settings" removes the entry: every row back to the global value, no suffix, the other account untouched', async () => {
    await ctx.click(removeBtn());
    assert.deepEqual(stored(), { account2: HOME_ENTRY });
    assert.equal(optionLabel('account1'), 'Work');
    assert.equal(select().value, 'account1');
    assertInherited();
    assert.equal(editor().value, '');
    assert.equal(unsaved(), false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(removeBtn().disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('empty-entry-deleted', S_PER, 'saving an entry with no key removes the account from the preference', async () => {
    await selectAccount('account2');
    await userSets(ctx, box('add_tags_force_lang'), true);
    editor().value = '';
    await ctx.fire(editor(), 'input');
    await ctx.click(saveBtn());
    assert.deepEqual(stored(), {});
    assert.equal(optionLabel('account2'), 'Home');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
