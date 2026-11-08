// The Add Tags settings page with no account, no policy: spec 05 "Settings for single accounts
// (Add Tags page)", "No accounts" (the selector, every toggle, the editor and the copy button
// disabled, every toggle off and the rows showing the global values in their summaries; nothing to
// save, nothing written).
// A file of its own: a page context has one account list (ui-03 has two accounts).

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
import { leaveBlocked } from '../../ui/feature-page.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    default_chatgpt_lang: 'German',
    add_tags_maxnum: 3,
    add_tags_force_lang: true,
    add_tags_auto_uselist: true,
    add_tags_auto_uselist_list: 'work, urgent',
    add_tags_exclusions: ['newsletter', 'spam'],
    add_tags_exclusions_exact_match: true,
};
const ctx = await openPage('addtags', { local: STORED, accounts: [] });
after(() => ctx.close());
const k = uiTests('addtags', '04');
const $ = ctx.$;

const S_ACC = 'spec 05 "Settings for single accounts (Add Tags page)"';
const ROW_KEYS = ['add_tags_maxnum', 'add_tags_force_lang', 'default_chatgpt_lang', 'add_tags_auto_force_existing',
    'add_tags_auto_uselist', 'add_tags_auto_uselist_list', 'add_tags_exclusions', 'add_tags_exclusions_exact_match'];

const shown = el => !el.closest('.addtags_account_value').hidden;

k.test('none-disabled', S_ACC, 'with no account the selector, every toggle, the editor and the copy button are disabled, every toggle off and every control hidden', () => {
    assert.equal($('#addtags_account_settings_account').disabled, true, 'selector');
    for (const key of [...ROW_KEYS, 'prompt_text']) {
        assert.equal(shown($('#addtags_account_' + key)), false, key + ' shown');
    }
    // The use list is edited in the row of its switch, under its toggle.
    for (const key of [...ROW_KEYS.filter(k => k !== 'add_tags_auto_uselist_list'), 'prompt_text']) {
        const toggle = $('#addtags_account_' + key + '_override');
        assert.equal(toggle.disabled, true, key + '_override disabled');
        assert.equal(toggle.checked, false, key + '_override on');
    }
    assert.equal($('#addtags_account_prompt_text').disabled, true, 'editor');
    assert.equal($('#btn_account_settings_copy_prompt').disabled, true, 'copy button');
});

k.test('none-global-values', S_ACC, 'the summaries show the global values', () => {
    const summary = key => $('#addtags_account_' + key + '_global').textContent;
    const global = text => msg('AddTags_account_settings_global', [text]);
    assert.equal(summary('add_tags_maxnum'), global('3'));
    assert.equal(summary('add_tags_force_lang'), global(msg('yes_string')));
    assert.equal(summary('default_chatgpt_lang'), global('German'));
    assert.equal(summary('add_tags_exclusions_exact_match'), global(msg('yes_string')));
    assert.equal(summary('add_tags_exclusions'), global('newsletter, spam'));
    assert.equal(summary('add_tags_auto_uselist'), global(msg('yes_string') + ' (urgent, work)'));
});

k.test('none-nothing-to-save', S_ACC, 'nothing to save or remove, no unsaved marker, leaving is free, nothing written', () => {
    assert.equal($('#btn_save_account_settings').disabled, true);
    assert.equal($('#btn_account_settings_remove').disabled, true);
    assert.equal($('#addtags_account_settings_unsaved').classList.contains('hidden'), true);
    assert.equal(leaveBlocked(ctx), false);
    assert.equal(ctx.ctl.localData().add_tags_account_settings, undefined);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
