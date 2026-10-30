// The Add Tags settings page, "Settings for single accounts" section, two accounts, no policy.
//
// Spec 05 "Settings for single accounts (Add Tags page)" (the account selector and its "(own
// settings)" suffix, the discard confirm on a switch, the override rule - toggle off: the control
// hidden and the global value in the summary, in sync with the global controls and the exclusion
// list's Save; on: the control from the account's own value or the global one; "Use only these
// tags" one row with one toggle for the switch and its list, the list disabled on "No" -, Save with only the
// overridden rows in their stored form, a blank prompt, a prompt toggled off and an emptied entry, "Reset to the global settings", the unsaved marker, the account
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
/** The row a key is edited in: "Use only these tags" edits the switch and its list together. */
const rowOf = key => key === 'add_tags_auto_uselist_list' ? 'add_tags_auto_uselist' : key;
const ctlNo = key => $('#addtags_account_' + key + '_no');
const ovr = key => $('#addtags_account_' + rowOf(key) + '_override');
const summary = key => $('#addtags_account_' + rowOf(key) + '_global');
const shown = el => !el.closest('.addtags_account_value').hidden;
const select = () => $('#addtags_account_settings_account');
const editor = () => $('#addtags_account_prompt_text');
const promptOvr = () => $('#addtags_account_prompt_text_override');
const saveBtn = () => $('#btn_save_account_settings');
const removeBtn = () => $('#btn_account_settings_remove');
const unsaved = () => !$('#addtags_account_settings_unsaved').classList.contains('hidden');
const stored = () => ctx.ctl.localData().add_tags_account_settings;
const SUFFIX = msg('AddTags_account_settings_custom_suffix');
const optionLabel = id => [...select().options].find(o => o.value === id).textContent;
/** A textarea's entries, one per line, blank lines dropped, in order. */
const lines = el => el.value.split('\n').map(s => s.trim()).filter(Boolean);
/** What a row's control holds, in a comparable form. */
function shownValue(key) {
    const el = ctl(key);
    if (BOOL_KEYS.includes(key)) {
        assert.equal(ctlNo(key).checked, !el.checked, key + ': Yes and No both checked or both unchecked');
        return el.checked;
    }
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

/** The global values the rows' summaries must show, kept in step with the test's own changes. */
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

/** The summary of a row's global value: Yes/No, the lists comma-separated, the use list in
 *  brackets after "Yes". */
function globalText(key) {
    const row = rowOf(key);
    const value = globals[row];
    let text;
    if (BOOL_KEYS.includes(row)) text = msg(value ? 'yes_string' : 'no_string');
    else if (Array.isArray(value)) text = value.join(', ');
    else text = String(value);
    if (row === 'add_tags_auto_uselist' && value) text += ' (' + globals.add_tags_auto_uselist_list.join(', ') + ')';
    return msg('AddTags_account_settings_global', [text]);
}

function assertInherited(keys = ROW_KEYS) {
    for (const key of keys) {
        assert.equal(ovr(key).checked, false, key + ': toggle on');
        assert.equal(shown(ctl(key)), false, key + ': control shown');
        assert.equal(summary(key).hidden, false, key + ': summary hidden');
        assert.equal(summary(key).textContent, globalText(key), key + ': not the global value');
    }
}

function assertOverridden(key) {
    assert.equal(ovr(key).checked, true, key + ': toggle off');
    assert.equal(shown(ctl(key)), true, key + ': control hidden');
    assert.equal(ctl(key).disabled, false, key + ': control disabled');
    assert.equal(summary(key).hidden, true, key + ': summary shown');
}

/** Sets a row's value as the user would: a Yes/No row by clicking its Yes or No radio. */
async function setValue(key, value) {
    if (BOOL_KEYS.includes(key)) {
        await ctx.click(value ? ctl(key) : ctlNo(key));
        return;
    }
    await userSets(ctx, ctl(key), value);
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

k.test('load-inherited', S_ACC, 'an account with no entry: every toggle off, every control hidden, the summaries showing the global values, the prompt toggle off and its editor hidden', async () => {
    if (select().value !== 'account1') await selectAccount('account1');
    assertInherited();
    assert.equal(promptOvr().checked, false);
    assert.equal(shown(editor()), false);
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

// ---- the override rule -------------------------------------------------------------------

k.test('follow-global-controls', S_ACC, 'the summaries follow a change of the global controls', async () => {
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

k.test('follow-global-exclusions', S_ACC, 'the exclusion summary follows the global list once Saved, not while unsaved', async () => {
    const list = $('#addtags_excl_list');
    list.value = 'Spam\nNewsletter\nPromo';
    await ctx.fire(list, 'input');
    assertInherited(['add_tags_exclusions']);
    await ctx.click($('#btn_save_excl_list'));
    globals.add_tags_exclusions = ['newsletter', 'promo', 'spam'];
    assertInherited(['add_tags_exclusions']);
});

k.test('on-starts-global', S_ACC, 'turning a toggle on shows the control in place of the summary, starting from the global value', async () => {
    for (const key of ROW_KEYS) {
        await userSets(ctx, ovr(key), true);
        assertOverridden(key);
        assert.deepEqual(shownValue(key), globals[key], key + ': not starting from the global value');
    }
});

k.test('prompt-on-starts-global', S_ACC, 'turning the prompt toggle on shows the editor with the global prompt', async () => {
    await userSets(ctx, promptOvr(), true);
    assert.equal(shown(editor()), true);
    assert.equal(editor().value, $('#addtags_prompt_text').value);
    assert.notEqual(editor().value.trim(), '');
});

k.test('on-dirty', S_ACC, 'a toggle turned on is an unsaved change: marker shown, Save and "Reset to the global settings" enabled', () => {
    assert.equal(unsaved(), true);
    assert.equal(saveBtn().disabled, false);
    assert.equal(removeBtn().disabled, false);
});

k.test('on-guard', S_GUARD, 'with unsaved account settings leaving the page asks', () => {
    assert.equal(leaveBlocked(ctx), true);
});

k.test('off-global', S_ACC, 'turning the toggles off again hides the controls, shows the global values and leaves nothing to save', async () => {
    await setValue('add_tags_maxnum', '11');
    await setValue('add_tags_exclusions_exact_match', !globals.add_tags_exclusions_exact_match);
    editor().value = 'Draft prompt';
    await ctx.fire(editor(), 'input');
    for (const key of ROW_KEYS) await userSets(ctx, ovr(key), false);
    await userSets(ctx, promptOvr(), false);
    assertInherited();
    assert.equal(shown(editor()), false);
    assert.equal(unsaved(), false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('on-again-own', S_ACC, 'turning a toggle on again brings back the value the user gave, not the global one', async () => {
    await userSets(ctx, ovr('add_tags_maxnum'), true);
    assert.equal(shownValue('add_tags_maxnum'), 11);
    await userSets(ctx, ovr('add_tags_exclusions_exact_match'), true);
    assert.equal(shownValue('add_tags_exclusions_exact_match'), !globals.add_tags_exclusions_exact_match);
    await userSets(ctx, promptOvr(), true);
    assert.equal(editor().value, 'Draft prompt');
    await userSets(ctx, ovr('add_tags_maxnum'), false);
    await userSets(ctx, ovr('add_tags_exclusions_exact_match'), false);
    await userSets(ctx, promptOvr(), false);
    assert.equal(unsaved(), false);
});

k.test('uselist-one-row', S_ACC, '"Use only these tags" is one row: one toggle shows the Yes / No and the list, the list disabled while "No" is chosen', async () => {
    assert.equal($('#addtags_account_add_tags_auto_uselist_list_override'), null, 'the list has a toggle of its own');
    assert.equal($('#addtags_account_add_tags_auto_uselist_list_global'), null, 'the list has a summary of its own');
    assert.equal(ctl('add_tags_auto_uselist').closest('.addtags_account_row'),
        ctl('add_tags_auto_uselist_list').closest('.addtags_account_row'), 'the switch and the list are in two rows');
    await userSets(ctx, ovr('add_tags_auto_uselist'), true);
    assert.equal(shown(ctl('add_tags_auto_uselist_list')), true);
    assert.equal(ctl('add_tags_auto_uselist_list').disabled, false, 'the list is disabled on "Yes"');
    await setValue('add_tags_auto_uselist', false);
    assert.equal(ctl('add_tags_auto_uselist_list').disabled, true, 'the list is enabled on "No"');
    await setValue('add_tags_auto_uselist', true);
    assert.equal(ctl('add_tags_auto_uselist_list').disabled, false);
    await userSets(ctx, ovr('add_tags_auto_uselist'), false);
    assertInherited(['add_tags_auto_uselist', 'add_tags_auto_uselist_list']);
    assert.equal(unsaved(), false);
});

// ---- overrides, the preview and Save -----------------------------------------------------

const ACCOUNT_PROMPT = 'Account prompt for {%mail_text_body%}';

k.test('override-edit', S_ACC, 'overridden rows take the user\'s values; the marker shows', async () => {
    await userSets(ctx, ovr('add_tags_maxnum'), true);
    await setValue('add_tags_maxnum', '7');
    await userSets(ctx, ovr('add_tags_force_lang'), true);
    await setValue('add_tags_force_lang', true);
    await userSets(ctx, ovr('default_chatgpt_lang'), true);
    await setValue('default_chatgpt_lang', 'French');
    await userSets(ctx, ovr('add_tags_auto_uselist_list'), true);
    await setValue('add_tags_auto_uselist_list', '\n  Urgent\n\nbilling,Billing \n');
    await userSets(ctx, ovr('add_tags_exclusions'), true);
    await setValue('add_tags_exclusions', 'Promo\nNEWS\n\nnews');
    await userSets(ctx, promptOvr(), true);
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
    assert.deepEqual(Object.keys(e).sort(), ['add_tags_auto_uselist', 'add_tags_auto_uselist_list', 'add_tags_exclusions',
        'add_tags_force_lang', 'add_tags_maxnum', 'default_chatgpt_lang', 'prompt_text']);
    assert.strictEqual(e.add_tags_auto_uselist, true, 'the use list switch is not saved with its list');
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

k.test('switch-other', S_ACC, 'the other account shows its own entry: its overridden row and prompt toggled on, the rest off', async () => {
    const before = ctx.dialogs.length;
    await selectAccount('account2');
    assert.equal(ctx.dialogs.length, before, 'a clean switch asked for confirmation');
    assertOverridden('add_tags_force_lang');
    assert.equal(shownValue('add_tags_force_lang'), false);
    assertInherited(ROW_KEYS.filter(key => key !== 'add_tags_force_lang'));
    assert.equal(promptOvr().checked, true);
    assert.equal(shown(editor()), true);
    assert.equal(editor().value, HOME_ENTRY.prompt_text);
});

k.test('switch-back', S_ACC, 'back on the first account the stored values are shown, their toggles on', async () => {
    await selectAccount('account1');
    const overridden = { add_tags_maxnum: 7, add_tags_force_lang: true, default_chatgpt_lang: 'French',
        add_tags_auto_uselist: true, add_tags_auto_uselist_list: ['billing', 'urgent'], add_tags_exclusions: ['news', 'promo'] };
    for (const [key, value] of Object.entries(overridden)) {
        assertOverridden(key);
        assert.deepEqual(shownValue(key), value, key);
    }
    assertInherited(ROW_KEYS.filter(key => !(key in overridden)));
    assert.equal(promptOvr().checked, true);
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

k.test('blank-prompt', S_ACC, 'a blank prompt stores no prompt_text, an emptied tag limit no add_tags_maxnum: both toggles off once reloaded', async () => {
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
    assert.equal(promptOvr().checked, false);
    assert.equal(ovr('add_tags_maxnum').checked, false);
});

k.test('remove', S_ACC, '"Reset to the global settings" removes the entry: every row back to the global value, no suffix, the other account untouched', async () => {
    await ctx.click(removeBtn());
    assert.deepEqual(stored(), { account2: HOME_ENTRY });
    assert.equal(optionLabel('account1'), 'Work');
    assert.equal(select().value, 'account1');
    assertInherited();
    assert.equal(promptOvr().checked, false);
    assert.equal(shown(editor()), false);
    assert.equal(unsaved(), false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(removeBtn().disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('empty-entry-deleted', S_PER, 'toggles off on every overridden row and the prompt: saving the entry with no key removes the account from the preference', async () => {
    await selectAccount('account2');
    await userSets(ctx, ovr('add_tags_force_lang'), false);
    await userSets(ctx, promptOvr(), false);
    assert.equal(editor().value, HOME_ENTRY.prompt_text, 'the text is kept in the hidden editor');
    await ctx.click(saveBtn());
    assert.deepEqual(stored(), {});
    assert.equal(optionLabel('account2'), 'Home');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
