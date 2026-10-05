// The Spam Filter settings page with an API global connection, no per-feature override, stored
// settings and two spam reports, no policy.
//
// Spec 05 "Feature Flags" (spamfilter_threshold, _show_msg_panel, _only_inbox, the allow and
// block lists saved by their own Save buttons through normalizeStringList(value, 2),
// spamfilter_skip_addressbook, spamfilter_enabled_accounts with [] = all accounts), "Address-list
// preferences and the empty-string trap", spec 01 "Data Flow: Spam filter sender rules" (as far as
// the page goes: where the two lists come from), spec 02 "Missing special prompts" (the report
// log: array headers joined, a record without date / sender / subject shows empty cells),
// "Unsaved-Changes Guard", and the shared feature-page sections of tests/ui/feature-page.mjs.

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
    leaveBlocked,
    S_GUARD,
} from '../../ui/feature-page.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
    { id: 'account3', name: 'Local Folders', type: 'none', identities: [] },
];
const STORED = {
    connection_type: 'chatgpt_api',
    spamfilter_threshold: 60,
    spamfilter_show_msg_panel: false,
    spamfilter_only_inbox: true,
    spamfilter_skip_addresses: ['friend@home.example', '@trusted.example'],
    spamfilter_block_addresses: ['@spam.example'],
    spamfilter_skip_addressbook: false,
    spamfilter_enabled_accounts: ['account2'],
    'msg:<full@x.example>': { v: 1, ts: Date.UTC(2026, 0, 2), spam: {
        ts: Date.UTC(2026, 0, 2), spamValue: 85, explanation: 'Looks like phishing.',
        subject: ['Win now'], from: ['Bad <bad@spam.example>'], message_date: Date.UTC(2026, 0, 1),
        moved: true, SpamThreshold: 60,
    } },
    'msg:<legacy@x.example>': { v: 1, ts: Date.UTC(2025, 5, 1), spam: {
        ts: Date.UTC(2025, 5, 1), spamValue: 10, explanation: 'Fine.', moved: false, SpamThreshold: 70,
    } },
};
const ctx = await openPage('spamfilter', { local: STORED, accounts: ACCOUNTS });
after(() => ctx.close());
const k = uiTests('spamfilter', '01');
const $ = ctx.$;
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_LISTS = 'spec 05 "Address-list preferences and the empty-string trap"';
const S_RULES = 'spec 01 "Data Flow: Spam filter sender rules"';
const S_LOG = 'spec 02 "Missing special prompts"';
const hidden = id => $('#' + id).classList.contains('hidden');
const accountBoxes = () => ctx.$$('#account_selector_checkboxes .accountCheckbox');

// ---- at load ---------------------------------------------------------------------------

k.test('restore', S_FLAGS, 'the stored threshold and switches are shown', () => {
    assert.equal($('#spamfilter_threshold').valueAsNumber, 60);
    assert.equal($('#spamfilter_show_msg_panel').checked, false);
    assert.equal($('#spamfilter_only_inbox').checked, true);
    assert.equal($('#spamfilter_skip_addressbook').checked, false);
});

k.test('lists-load', S_RULES, 'the allow and block lists are shown one entry per line, each Save disabled', () => {
    assert.equal($('#spamfilter_skip_addresses').value, 'friend@home.example\n@trusted.example');
    assert.equal($('#spamfilter_block_addresses').value, '@spam.example');
    assert.equal($('#btn_save_skip_addresses').disabled, true);
    assert.equal($('#btn_save_block_addresses').disabled, true);
    for (const id of ['spamfilter_skip_addresses', 'spamfilter_block_addresses']) {
        assert.equal($('#' + id).classList.contains('option-input'), false, id + ' saved on change');
    }
});

k.test('accounts-load', S_FLAGS, 'one checkbox per account, checked as stored', () => {
    assert.deepEqual(accountBoxes().map(b => [b.value, b.checked]),
        [['account1', false], ['account2', true], ['account3', false]]);
});

k.test('log-rows', S_LOG, 'the log has one row per report, under its header row', () => {
    assert.ok($('#report_data thead tr'), 'the header row was removed');
    assert.equal(ctx.$$('#report_data_body tr').length, 2);
});

k.test('log-arrays', S_LOG, 'the subject and sender arrays are joined', () => {
    const row = ctx.$$('#report_data_body tr').find(r => r.cells[0].textContent === '<full@x.example>');
    assert.ok(row, 'no row for <full@x.example>');
    assert.equal(row.cells[2].textContent, 'Bad <bad@spam.example>');
    assert.equal(row.cells[3].textContent, 'Win now');
    assert.equal(row.cells[4].textContent, '85');
});

k.test('log-legacy', S_LOG, 'a report without date, sender or subject shows empty cells, not "Invalid Date" / "undefined"', () => {
    const row = ctx.$$('#report_data_body tr').find(r => r.cells[0].textContent === '<legacy@x.example>');
    assert.ok(row, 'no row for <legacy@x.example>');
    for (const i of [1, 2, 3]) assert.equal(row.cells[i].textContent, '', 'cell ' + i);
});

// ---- writes ------------------------------------------------------------------------------

k.test('write-settings', S_FLAGS, 'the threshold is stored as a number, the switches as booleans', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#spamfilter_threshold'), '80');
    await userSets(ctx, $('#spamfilter_show_msg_panel'), true);
    await userSets(ctx, $('#spamfilter_only_inbox'), false);
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.spamfilter_threshold, 80);
    assert.strictEqual(w.spamfilter_show_msg_panel, true);
    assert.strictEqual(w.spamfilter_only_inbox, false);
});

k.test('threshold-zero', S_FLAGS, 'a threshold of 0 ("flag everything") is stored as 0', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#spamfilter_threshold'), '0');
    assert.strictEqual(writtenSince(ctx, since).spamfilter_threshold, 0);
});

k.test('allow-dirty', S_GUARD, 'editing the allow list enables its Save and the unsaved mark, and leaving asks', async () => {
    const list = $('#spamfilter_skip_addresses');
    list.value = 'Friend@HOME.example, *@trusted.example\n\nfriend@home.example\n';
    await ctx.fire(list, 'input');
    assert.equal($('#btn_save_skip_addresses').disabled, false);
    assert.equal(hidden('skip_addresses_unsaved'), false);
    assert.equal(leaveBlocked(ctx), true);
});

k.test('allow-save', S_LISTS, 'Save stores the allow list normalized as an array', async () => {
    await ctx.click($('#btn_save_skip_addresses'));
    assert.deepEqual(ctx.ctl.localData().spamfilter_skip_addresses, ['*@trusted.example', 'friend@home.example']);
    assert.equal($('#spamfilter_skip_addresses').value, '*@trusted.example\nfriend@home.example');
    assert.equal($('#btn_save_skip_addresses').disabled, true);
    assert.equal(hidden('skip_addresses_unsaved'), true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('block-save', S_FLAGS, 'the block list has its own Save, which stores it normalized as an array', async () => {
    const list = $('#spamfilter_block_addresses');
    list.value = '@SPAM.example\nscam@bad.example, ';
    await ctx.fire(list, 'input');
    assert.equal($('#btn_save_block_addresses').disabled, false);
    assert.equal(hidden('block_addresses_unsaved'), false);
    await ctx.click($('#btn_save_block_addresses'));
    assert.deepEqual(ctx.ctl.localData().spamfilter_block_addresses, ['@spam.example', 'scam@bad.example']);
    assert.equal($('#btn_save_block_addresses').disabled, true);
    assert.equal(hidden('block_addresses_unsaved'), true);
});

k.test('block-emptied', S_LISTS, 'an emptied list is stored as [], never [\'\']', async () => {
    const list = $('#spamfilter_block_addresses');
    list.value = '\n  \n';
    await ctx.fire(list, 'input');
    await ctx.click($('#btn_save_block_addresses'));
    assert.deepEqual(ctx.ctl.localData().spamfilter_block_addresses, []);
});

k.test('addressbook', S_FLAGS, 'the address-book switch is stored as a boolean', async () => {
    await userSets(ctx, $('#spamfilter_skip_addressbook'), true);
    assert.strictEqual(ctx.ctl.localData().spamfilter_skip_addressbook, true);
    await userSets(ctx, $('#spamfilter_skip_addressbook'), false);
    assert.strictEqual(ctx.ctl.localData().spamfilter_skip_addressbook, false);
});

k.test('accounts-some', S_FLAGS, 'a partial selection is stored as the account ids', async () => {
    await userSets(ctx, accountBoxes()[0], true);
    assert.deepEqual([...ctx.ctl.localData().spamfilter_enabled_accounts].sort(), ['account1', 'account2']);
});

k.test('accounts-all', S_FLAGS, 'all accounts selected is stored as []', async () => {
    await userSets(ctx, accountBoxes()[2], true);
    assert.deepEqual(ctx.ctl.localData().spamfilter_enabled_accounts, []);
});

// ---- connection panel and the editor -----------------------------------------------------

inheritedIntegrationTests(ctx, k, { prefix: 'spamfilter', promptId: 'prompt_spamfilter' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_spamfilter', textareaId: 'spamfilter_prompt_text',
    defaultMsgKey: 'prompt_spamfilter_full_text',
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
