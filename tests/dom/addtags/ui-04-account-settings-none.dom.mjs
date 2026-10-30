// The Add Tags settings page with no account, no policy: spec 05 "Settings for single accounts
// (Add Tags page)", "No accounts" (the selector, every control and box, the editor and the copy
// button disabled, the rows showing the global values; nothing to save, nothing written).
// A file of its own: a page context has one account list (ui-03 has two accounts).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { leaveBlocked } from '../../ui/feature-page.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    default_chatgpt_lang: 'German',
    add_tags_maxnum: 3,
    add_tags_force_lang: true,
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

k.test('none-disabled', S_ACC, 'with no account the selector, every control and box, the editor and the copy button are disabled', () => {
    assert.equal($('#addtags_account_settings_account').disabled, true, 'selector');
    for (const key of ROW_KEYS) {
        assert.equal($('#addtags_account_' + key).disabled, true, key);
        assert.equal($('#addtags_account_' + key + '_inherit').disabled, true, key + '_inherit');
    }
    assert.equal($('#addtags_account_prompt_text').disabled, true, 'editor');
    assert.equal($('#btn_account_settings_copy_prompt').disabled, true, 'copy button');
});

k.test('none-global-values', S_ACC, 'the rows show the global values', () => {
    assert.equal($('#addtags_account_add_tags_maxnum').valueAsNumber, 3);
    assert.equal($('#addtags_account_add_tags_force_lang').checked, true);
    assert.equal($('#addtags_account_default_chatgpt_lang').value, 'German');
    assert.equal($('#addtags_account_add_tags_exclusions_exact_match').checked, true);
    assert.deepEqual($('#addtags_account_add_tags_exclusions').value.split('\n').filter(Boolean), ['newsletter', 'spam']);
    assert.deepEqual($('#addtags_account_add_tags_auto_uselist_list').value.split('\n').filter(Boolean).sort(), ['urgent', 'work']);
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
