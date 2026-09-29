// Spec 08 "_disable_prompt_management" -> "Where it is enforced", on pages/customprompts/:
//  - btnNew disabled in place; #import_export HIDDEN, with #managed_restriction_note in its place;
//  - the user's own prompts still listed but read-only (rowState().locked): every field
//    read-only, no Save / Delete, customPrompts_policy_inert_note in the detail banner;
//  - Duplicate / Duplicate and edit / Export disabled on EVERY prompt, built-in included;
//  - exportPrompts(), importPrompts(), startNewPrompt() return early even when reached;
//  - the user's prompts are never deleted, and no policy mark is persisted.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const USER_PROMPTS = [
    { id: 'prompt_mine_1', name: 'Mine', text: 'my text', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];
const ctx = await openPage('customprompts', {
    policy: loadFixture('disable-prompt-management.json'),
    local: { _custom_prompt: USER_PROMPTS },
});
after(() => ctx.close());

const rowOf = id => ctx.$$('.p_row').find(r => r.querySelector('.p-id')?.textContent === id);
const menuLabels = () => ctx.$$('.row_menu .row_menu_item').map(b => ({
    label: b.querySelectorAll('span')[1]?.textContent, disabled: b.disabled,
}));
const COPY_LABELS = ['customPrompts_btnDuplicate', 'customPrompts_btnDuplicateEdit', 'customPrompts_btnExport'].map(k => msg(k));

test('New prompt is disabled in place, with the restriction tooltip', () => {
    const btn = ctx.$('#btnNew');
    assert.equal(btn.disabled, true);
    assert.equal(btn.dataset.mztaManaged, '1');
    assert.equal(btn.title, msg('managed_restriction_tooltip'));
});

test('Import / Export are hidden and the restriction note takes their place', () => {
    assert.equal(ctx.$('#import_export').style.display, 'none');
    assert.equal(ctx.$('#managed_restriction_note').classList.contains('shown'), true);
    assert.equal(ctx.$('#managed_restriction_defaults_note').classList.contains('shown'), false,
        'the other restriction note is independent');
});

test('the user prompt is still listed, locked and dimmed', () => {
    const row = rowOf('prompt_mine_1');
    assert.ok(row, 'the user prompt disappeared from the list');
    assert.equal(row.classList.contains('is_locked'), true);
    assert.equal(row.classList.contains('is_dimmed'), true);
    assert.equal(row.querySelector('.p_lock').hidden, false, 'no padlock on the row');
});

test('opened, the user prompt is read-only, explained, with no Save or Delete', async () => {
    await ctx.click(rowOf('prompt_mine_1').querySelector('.btnRowEdit'));
    assert.equal(ctx.$('#detail_id').value, 'prompt_mine_1', 'the detail editor did not open it');
    assert.ok(ctx.$('#detail_banner').textContent.includes(msg('customPrompts_policy_inert_note')), 'no inert note');
    assert.equal(ctx.$('#detail_text').readOnly, true, 'text editable');
    for (const el of ctx.$$('input.detail_edit, select.detail_edit')) assert.equal(el.disabled, true, el.id + ' editable');
    assert.equal(ctx.$('#btnDetailSave').classList.contains('hiddendata'), true, 'Save offered');
    assert.equal(ctx.$('#btnDetailDelete').classList.contains('hiddendata'), true, 'Delete offered');
    assert.equal(ctx.$('#btnDetailDuplicate').disabled, true);
    assert.equal(ctx.$('#btnDetailDuplicateEdit').disabled, true);
});

test('a built-in prompt cannot be duplicated from the detail editor either', async () => {
    await ctx.click(rowOf('prompt_reply').querySelector('.btnRowEdit'));
    assert.equal(ctx.$('#detail_id').value, 'prompt_reply');
    assert.equal(ctx.$('#btnDetailDuplicate').disabled, true);
    assert.equal(ctx.$('#btnDetailDuplicateEdit').disabled, true);
});

test('the row menu offers no enabled Duplicate / Duplicate and edit / Export, on any row', async () => {
    const rows = ctx.$$('.p_row');
    assert.ok(rows.length > 1);
    for (const row of rows) {
        await ctx.click(row.querySelector('.btnRowMenu'));
        const items = menuLabels();
        assert.ok(items.length > 0, 'no row menu opened');
        for (const it of items.filter(i => COPY_LABELS.includes(i.label))) {
            assert.equal(it.disabled, true, `"${it.label}" enabled on ${row.querySelector('.p-id').textContent}`);
        }
        const overlay = ctx.$('.row_menu_overlay');
        if (overlay) await ctx.click(overlay);
    }
});

test('forcing New, Export all and Import does nothing', async () => {
    const since = ctx.ctl.calls.length;
    const dialogs = ctx.dialogs.length;
    const btnNew = ctx.$('#btnNew');
    btnNew.disabled = false;
    await ctx.click(btnNew);
    assert.notEqual(ctx.$('#detail_id').value, '', 'a new prompt was started');
    await ctx.click(ctx.$('#btnExportAll'));
    await ctx.click(ctx.$('#btnImport'));
    assert.deepEqual(ctx.apiCalls('browser.downloads.download'), [], 'a file was exported');
    assert.equal(ctx.dialogs.length, dialogs, 'an import/export dialog was opened');
    assert.deepEqual(ctx.localWrites(since), [], 'storage written');
});

test('the user prompt is never deleted, and no policy mark is persisted', () => {
    const stored = ctx.ctl.localData()._custom_prompt;
    assert.deepEqual(stored, USER_PROMPTS);
    assert.equal(JSON.stringify(ctx.ctl.localData()).includes('_inert_by_policy'), false);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
