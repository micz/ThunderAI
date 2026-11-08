// Spec 08a "_disable_add_tags_account_settings", spec 05 "Settings for single accounts (Add Tags
// page)" -> "Policy" - on the addtags page.
//
// The policy disables the per-account settings; account1 stores an entry. The section is hidden and
// never set up (no account in its selector), the restriction note is shown in its place, the global
// settings stay editable, and the stored entry is kept exactly as stored.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    managedArtifacts,
    msg,
} from '../../helpers/dom-page.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
];
const WORK_ENTRY = { add_tags_maxnum: 2, prompt_text: 'My account prompt for {%mail_text_body%}' };
const ctx = await openPage('addtags', {
    policy: { _disable_add_tags_account_settings: true },
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

test('the section is hidden and never set up: its account selector is empty', () => {
    assert.equal($('#addtags_account_settings_container').style.display, 'none');
    assert.equal($('#addtags_account_settings_account').options.length, 0);
});

test('the restriction note is shown in its place, with its text', () => {
    const note = $('#managed_restriction_account_settings_note');
    assert.ok(note.classList.contains('shown'));
    assert.equal(note.textContent.trim(), msg('managed_restriction_add_tags_account_settings'));
    assert.equal(managedArtifacts(ctx.document).restrictionNotes, 1);
});

test('the global settings stay editable', () => {
    assert.equal($('#add_tags_maxnum').disabled, false);
    assert.equal($('#addtags_prompt_text').disabled, false);
});

test('the stored entry is kept as stored', () => {
    assert.deepEqual(ctx.ctl.localData().add_tags_account_settings, { account1: WORK_ENTRY });
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
