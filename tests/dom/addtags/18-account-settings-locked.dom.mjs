// Spec 05 "Settings for single accounts (Add Tags page)" -> "Policy", spec 08 "Controls with their
// own load/save logic: data-mzta-pref" (lockOverrideControls(): the override rows), spec 02 "Add
// tags: per-account settings" -> "Policy" - on the addtags page.
//
// The policy locks add_tags_maxnum and add_tags_exclusions (with their values); account1 already
// stores overrides of both, plus one of add_tags_force_lang. The two locked rows are locked (toggle
// off and disabled, control disabled and hidden, the summary showing the policy value, a marker in
// the row's title), the other rows stay editable, the account preview uses the policy values, and
// neither Save nor "Reset to the global settings" ever writes a locked key: the stored values of the locked keys are kept as
// stored, and none is added. The scenario runs in order.

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
import { until } from '../../ui/dom-helpers.mjs';

const ACCOUNTS = [
    { id: 'account1', name: 'Work', type: 'imap', identities: [] },
    { id: 'account2', name: 'Home', type: 'imap', identities: [] },
];
const POLICY = { add_tags_maxnum: 9, add_tags_exclusions: ['policyword'] };
const WORK_ENTRY = { add_tags_maxnum: 2, add_tags_exclusions: ['mine'], add_tags_force_lang: true };
const ctx = await openPage('addtags', {
    policy: POLICY,
    accounts: ACCOUNTS,
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_api_key: 'sk-user-own',
        default_chatgpt_lang: 'German',
        add_tags_maxnum: 4,
        add_tags_force_lang: false,
        add_tags_exclusions: ['userword'],
        add_tags_account_settings: { account1: WORK_ENTRY },
    },
});
after(() => ctx.close());
const $ = ctx.$;

const LOCKED = ['add_tags_maxnum', 'add_tags_exclusions'];
const FREE = ['add_tags_force_lang', 'default_chatgpt_lang', 'add_tags_auto_force_existing',
    'add_tags_auto_uselist', 'add_tags_auto_uselist_list', 'add_tags_exclusions_exact_match'];
const ctl = key => $('#addtags_account_' + key);
/** The row a key is edited in: "Use only these tags" edits the switch and its list together. */
const rowOf = key => key === 'add_tags_auto_uselist_list' ? 'add_tags_auto_uselist' : key;
const ovr = key => $('#addtags_account_' + rowOf(key) + '_override');
const summary = key => $('#addtags_account_' + key + '_global');
const shown = el => !el.closest('.addtags_account_value').hidden;
const globalText = text => msg('AddTags_account_settings_global', [text]);
const select = () => $('#addtags_account_settings_account');
const saveBtn = () => $('#btn_save_account_settings');
const removeBtn = () => $('#btn_account_settings_remove');
const stored = () => ctx.ctl.localData().add_tags_account_settings;
const title = el => el.closest('.addtags_account_row').querySelector('.addtags_account_title');
const accPreview = () => {
    const el = $('#addtags_account_info_additional_statements');
    return el.style.display === 'none' ? '' : el.textContent;
};
const MAXNUM = n => msg('prompt_add_tags_maxnum') + ' ' + n + '.';

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

for (const key of LOCKED) {
    test(`${key}: the row is locked - toggle off and disabled, control disabled and hidden`, () => {
        assert.equal(ovr(key).checked, false, 'toggle on');
        assert.equal(ovr(key).disabled, true, 'toggle enabled');
        assert.equal(ctl(key).disabled, true, 'control enabled');
        assert.equal(shown(ctl(key)), false, 'control shown');
        assert.equal(ctl(key).dataset.mztaManaged, '1', 'control not marked');
        assert.equal(ovr(key).dataset.mztaManaged, '1', 'toggle not marked');
    });

    test(`${key}: the row's title carries the managed marker`, () => {
        const t = title(ctl(key));
        assert.ok(t, 'the control is in no row with a title');
        assert.ok(t.querySelector('.managed_marker'), 'no .managed_marker in the title');
    });
}

test('add_tags_maxnum: the locked row shows the policy value, not the stored override', () => {
    assert.equal(summary('add_tags_maxnum').hidden, false);
    assert.equal(summary('add_tags_maxnum').textContent, globalText('9'));
});

test('add_tags_exclusions: the locked row shows the policy value, not the stored override', () => {
    assert.equal(summary('add_tags_exclusions').hidden, false);
    assert.equal(summary('add_tags_exclusions').textContent, globalText('policyword'));
});

test('the other rows stay editable: the stored override toggled on and enabled, the others with an enabled toggle', () => {
    assert.equal(ovr('add_tags_force_lang').checked, true);
    assert.equal(shown(ctl('add_tags_force_lang')), true);
    assert.equal(ctl('add_tags_force_lang').disabled, false);
    assert.equal(ctl('add_tags_force_lang').checked, true);
    for (const key of FREE.filter(k => k !== 'add_tags_force_lang')) {
        assert.equal(ovr(key).disabled, false, key + ': toggle disabled');
        assert.equal(ovr(key).checked, false, key + ': toggle on');
        assert.equal(ctl(key).dataset.mztaManaged, undefined, key + ': marked');
    }
});

test('the prompt toggle, the editor and the copy button are not locked', () => {
    assert.equal($('#addtags_account_prompt_text_override').disabled, false);
    assert.equal($('#addtags_account_prompt_text').readOnly, false);
    assert.equal($('#addtags_account_prompt_text').disabled, false);
    assert.equal($('#btn_account_settings_copy_prompt').disabled, false);
});

test('the account preview uses the policy value for the locked tag limit', async () => {
    await until(ctx, () => accPreview().includes(MAXNUM(9)), 'the account preview to show the policy tag limit', 3000);
    assert.equal(accPreview().includes(MAXNUM(2)), false, accPreview());
});

test('a locked toggle clicked by hand, re-enabled as from the developer tools, stays off and does not show the control', async () => {
    const t = ovr('add_tags_maxnum');
    t.disabled = false;
    await ctx.click(t);
    assert.equal(t.checked, false, 'the toggle was turned on');
    assert.equal(shown(ctl('add_tags_maxnum')), false, 'the control was shown');
    assert.equal(ctl('add_tags_maxnum').disabled, true, 'the control was enabled');
    assert.equal(saveBtn().disabled, true, 'Save enabled');
    t.disabled = true;
});

test('Save keeps the stored values of the locked keys as stored, even with the locked controls edited by hand', async () => {
    // A free row changed through the UI, the locked ones forced open and edited by hand.
    await ctx.click($('#addtags_account_add_tags_force_lang_no'));
    for (const key of LOCKED) {
        ovr(key).checked = true;
        ctl(key).disabled = false;
    }
    await userSets(ctl('add_tags_maxnum'), '6');
    await userSets(ctl('add_tags_exclusions'), 'handword');
    assert.equal(saveBtn().disabled, false, 'Save not enabled by the free row');
    await ctx.click(saveBtn());
    assert.deepEqual(stored(), { account1: { add_tags_maxnum: 2, add_tags_exclusions: ['mine'], add_tags_force_lang: false } });
});

test('after the Save the locked rows are still locked with the policy values', () => {
    for (const key of LOCKED) {
        assert.equal(ovr(key).checked, false, key + ': toggle on');
        assert.equal(ovr(key).disabled, true, key + ': toggle enabled');
        assert.equal(ctl(key).disabled, true, key + ': control enabled');
        assert.equal(shown(ctl(key)), false, key + ': control shown');
    }
    assert.equal(summary('add_tags_maxnum').textContent, globalText('9'));
    assert.equal(summary('add_tags_exclusions').textContent, globalText('policyword'));
});

test('"Reset to the global settings" removes the free overrides and keeps the locked ones as stored', async () => {
    assert.equal(removeBtn().disabled, false);
    await ctx.click(removeBtn());
    assert.deepEqual(stored(), { account1: { add_tags_maxnum: 2, add_tags_exclusions: ['mine'] } });
});

test('with only locked values stored there is nothing the page may remove', () => {
    assert.equal(removeBtn().disabled, true);
    assert.equal(saveBtn().disabled, true);
});

test('an account with no entry: Save adds no locked key', async () => {
    await selectAccount('account2');
    for (const key of LOCKED) {
        assert.equal(ovr(key).checked, false, key);
        assert.equal(ctl(key).disabled, true, key);
    }
    await userSets(ovr('default_chatgpt_lang'), true);
    await userSets(ctl('default_chatgpt_lang'), 'French');
    await ctx.click(saveBtn());
    assert.deepEqual(stored().account2, { default_chatgpt_lang: 'French' });
    assert.deepEqual(stored().account1, { add_tags_maxnum: 2, add_tags_exclusions: ['mine'] });
});

test('the global locked keys never reached storage', () => {
    assert.equal(ctx.ctl.localData().add_tags_maxnum, 4);
    assert.deepEqual(ctx.ctl.localData().add_tags_exclusions, ['userword']);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
