// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI" (the account prompt
// editor of the Add Tags page), spec 05 "Settings for single accounts (Add Tags page)" -> "Policy",
// spec 02 "Add tags: per-account settings" -> "Policy" - on the addtags page.
//
// The policy enforces the Add Tags text (fixture dom-special-prompts-text.json); account1 stores a
// prompt_text and a tag limit. The prompt toggle is off and inert, the account prompt editor
// read-only (not disabled) and marked, the marker in the prompt title, "Copy the prompt above"
// inert; the other rows stay editable and savable, and Save and "Reset to the global settings" keep
// the stored prompt_text exactly as stored (never write it, never drop it).
// The scenario runs in order.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg,
} from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
];
const POLICY = loadFixture('dom-special-prompts-text.json');
const ACCOUNT_TEXT = 'My account prompt for {%mail_text_body%}';
const WORK_ENTRY = { add_tags_maxnum: 2, prompt_text: ACCOUNT_TEXT };
const ctx = await openPage('addtags', {
    policy: POLICY,
    accounts: ACCOUNTS,
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_api_key: 'sk-user-own',
        add_tags_maxnum: 4,
        add_tags_account_settings: { account1: WORK_ENTRY },
    },
});
after(() => ctx.close());
const $ = ctx.$;

const ctl = key => $('#addtags_account_' + key);
const ovr = key => $('#addtags_account_' + key + '_override');
const select = () => $('#addtags_account_settings_account');
const editor = () => $('#addtags_account_prompt_text');
const copyBtn = () => $('#btn_account_settings_copy_prompt');
const promptOvr = () => $('#addtags_account_prompt_text_override');
const saveBtn = () => $('#btn_save_account_settings');
const removeBtn = () => $('#btn_account_settings_remove');
const stored = () => ctx.ctl.localData().add_tags_account_settings;
const SUFFIX = msg('AddTags_account_settings_custom_suffix');
const optionLabel = id => [...select().options].find(o => o.value === id).textContent;

async function selectAccount(id) {
    select().value = id;
    await ctx.fire(select(), 'change');
}
async function userSets(el, value) {
    if (el.type === 'checkbox') {
        if (el.checked !== value) await ctx.click(el);
        return;
    }
    el.value = value;
    await ctx.fire(el, 'input');
    await ctx.fire(el, 'change');
}

test('the account with an entry is the one shown', async () => {
    if (select().value !== 'account1') await selectAccount('account1');
    assert.equal(select().value, 'account1');
});

test('the account prompt editor is read-only, not disabled, marked with the prompt-text tooltip', () => {
    assert.equal(editor().readOnly, true, 'readOnly');
    assert.equal(editor().disabled, false, 'disabled: the text could not be selected and copied');
    assert.equal(editor().dataset.mztaManaged, '1');
    assert.equal(editor().title, msg('managed_prompt_text_tooltip'));
});

test('the prompt toggle is off, disabled and marked, the editor hidden, even with a stored prompt_text', () => {
    assert.equal(promptOvr().checked, false);
    assert.equal(promptOvr().disabled, true);
    assert.equal(promptOvr().dataset.mztaManaged, '1');
    assert.equal(editor().closest('.addtags_account_value').hidden, true);
});

test('a toggle clicked by hand, re-enabled as from the developer tools, stays off', async () => {
    promptOvr().disabled = false;
    await ctx.click(promptOvr());
    promptOvr().disabled = true;
    assert.equal(promptOvr().checked, false);
    assert.equal(editor().closest('.addtags_account_value').hidden, true);
    assert.equal(saveBtn().disabled, true, 'Save enabled');
});

test('the prompt title carries the managed marker, visible with the editor hidden', () => {
    const field = editor().closest('.mzta_field');
    assert.ok(field, 'the editor is in no .mzta_field');
    const title = field.querySelector(':scope > .addtags_account_title');
    assert.ok(title, 'no title in the editor\'s field');
    assert.ok(title.querySelector('.managed_marker'), 'no .managed_marker in the prompt title');
});

test('"Copy the prompt above" is disabled and marked', () => {
    assert.equal(copyBtn().disabled, true);
    assert.equal(copyBtn().dataset.mztaManaged, '1');
});

test('"Copy the prompt above", re-enabled by hand and clicked, changes nothing', async () => {
    const before = editor().value;
    copyBtn().disabled = false;
    await ctx.click(copyBtn());
    copyBtn().disabled = true;
    assert.equal(editor().value, before);
    assert.equal(saveBtn().disabled, true, 'Save enabled: the copy made a change');
});

test('the other rows stay editable: the stored tag limit toggled on and enabled, the other toggles enabled', () => {
    assert.equal(ovr('add_tags_maxnum').checked, true);
    assert.equal(ctl('add_tags_maxnum').disabled, false);
    assert.equal(ctl('add_tags_maxnum').valueAsNumber, 2);
    for (const key of ['add_tags_force_lang', 'default_chatgpt_lang', 'add_tags_auto_force_existing', 'add_tags_auto_uselist',
        'add_tags_exclusions', 'add_tags_exclusions_exact_match']) {
        assert.equal(ovr(key).disabled, false, key);
    }
});

test('Save and "Reset to the global settings" stay available: with a stored entry the removal is enabled', () => {
    assert.equal(removeBtn().disabled, false);
});

test('Save stores the other rows and keeps the stored prompt_text exactly, even with the editor changed by a script', async () => {
    editor().value = 'typed over the read-only editor by a script';
    await ctx.fire(editor(), 'input');
    await userSets(ctl('add_tags_maxnum'), '5');
    assert.equal(saveBtn().disabled, false, 'Save not enabled by the tag limit');
    await ctx.click(saveBtn());
    assert.deepEqual(stored(), { account1: { add_tags_maxnum: 5, prompt_text: ACCOUNT_TEXT } });
});

test('"Reset to the global settings" removes the other rows and keeps the stored prompt_text', async () => {
    await ctx.click(removeBtn());
    assert.deepEqual(stored(), { account1: { prompt_text: ACCOUNT_TEXT } });
    assert.equal(ovr('add_tags_maxnum').checked, false);
    assert.equal(optionLabel('account1'), 'Work ' + SUFFIX, 'the kept prompt_text is still an entry');
});

test('an account with no entry: a text forced into the editor is never stored', async () => {
    await selectAccount('account2');
    assert.equal(editor().readOnly, true);
    editor().value = 'Home text forced by a script';
    await ctx.fire(editor(), 'input');
    await userSets(ovr('add_tags_force_lang'), true);
    await ctx.click(ctl('add_tags_force_lang'));
    await ctx.click(saveBtn());
    assert.deepEqual(stored().account2, { add_tags_force_lang: true });
    assert.deepEqual(stored().account1, { prompt_text: ACCOUNT_TEXT });
});

test('the enforced text never reached the account settings', () => {
    const all = JSON.stringify(stored());
    assert.equal(all.includes(JSON.stringify(POLICY._special_prompts_text.prompt_add_tags).slice(1, -1)), false);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
