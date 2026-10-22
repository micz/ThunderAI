// The Manage Data Placeholders page with two custom data placeholders stored, no policy.
//
// Spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)": the rows (the id shown
// without its prefix, the chips in read mode, the enabled switch clickable from the row), the count,
// the add-form, the row editor (Confirm / Cancel shown with display 'flex', Edit / Delete restored
// with ''; the mirror and the autocomplete attached on entry, destroyed on exit), the quiet-until-
// dirty Save All, Import / Export through confirm() / alert(); spec 05 "Unsaved-Changes Guard
// (`pages/_lib/unsaved-guard.js`)" (this page's own somethingChanged-based beforeunload); spec 03
// "Custom Placeholders" (what is stored: the thunderai_custom_ prefix, is_default / is_dynamic "0",
// enabled; the import merging on the prefixed id and skipping an entry with no usable id),
// "Placeholder Autocomplete" (the type resolved from the row, built-ins only) and "Invalid placeholder
// feedback" (the same built-ins-only list drives validation; a type change repaints).
//
// jsdom has no innerText, which the row buttons read and write: the file maps it to textContent
// (ui/page-stubs.mjs). Stored state: `sig` (always, enabled, a token in its text) and `off`
// (reading, disabled, a legacy <br> in its text). The tests run in order on one page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    stubInnerText,
    pickFile,
    lastDownload,
    withConfirm,
    leaveBlocked,
} from '../../ui/page-stubs.mjs';

const SIG = { id: 'thunderai_custom_sig', name: 'Signature', text: 'Best regards\n{%mail_subject%}', type: '0',
    enabled: 1, is_default: '0', is_dynamic: '0', idnum: 1 };
const OFF = { id: 'thunderai_custom_off', name: 'Disabled one', text: 'Old<br>text', type: '1',
    enabled: 0, is_default: '0', is_dynamic: '0', idnum: 2 };

const ctx = await openPage('customdataplaceholders', { local: { _custom_placeholder: [SIG, OFF] } });
after(() => ctx.close());
stubInnerText(ctx);
const k = uiTests('customdataplaceholders', '01');
const $ = ctx.$;

const S_PAGE = 'spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)"';
const S_GUARD = 'spec 05 "Unsaved-Changes Guard (`pages/_lib/unsaved-guard.js`)"';
const S_CUSTOM = 'spec 03 "Custom Placeholders"';
const S_AUTO = 'spec 03 "Placeholder Autocomplete"';
const S_INVALID = 'spec 03 "Invalid placeholder feedback"';

const rows = () => ctx.$$('#all_custom_dataplaceholders tbody.list tr');
const rowOf = id => rows().find(r => r.querySelector('.id_show').textContent === id);
const stored = () => ctx.ctl.localData()._custom_placeholder || [];
const storedOf = id => stored().find(p => p.id === 'thunderai_custom_' + id);
const typeIn = async (el, value) => { el.value = value; await ctx.fire(el, 'input'); };
const choose = async (el, value) => { el.value = value; await ctx.fire(el, 'change'); };
const status = () => ({ text: $('#msgDisplay').textContent, color: $('#msgDisplay').style.color });
const saveAll = () => ctx.click($('#btnSaveAll'));
const btn = (row, cls) => row.querySelector('.' + cls);

// ---- the rows --------------------------------------------------------------------------------

k.test('rows', S_PAGE, 'each placeholder is a row: the id without its prefix (shown as a label), name, type', () => {
    assert.deepEqual(rows().map(r => r.querySelector('.id_show').textContent).sort(), ['off', 'sig']);
    const r = rowOf('sig');
    assert.equal(r.querySelector('i').textContent, 'thunderai_custom_');
    assert.equal(r.querySelector('.name_show').textContent, 'Signature');
    assert.equal(r.querySelector('.type_show').textContent, msg('customPrompts_add_to_menu_always'));
    assert.equal(rowOf('off').querySelector('.type_show').textContent, msg('customPrompts_add_to_menu_reading'));
});

k.test('rows-chips', S_PAGE, 'read mode: the {%…%} tokens of the text are chips', () => {
    const chips = [...rowOf('sig').querySelectorAll('.text_show .ph_chip')].map(c => c.textContent);
    assert.deepEqual(chips, ['{%mail_subject%}']);
    assert.equal(rowOf('sig').querySelector('.text_show').textContent, 'Best regards\n{%mail_subject%}');
});

k.test('rows-legacy-br', S_PAGE, 'a legacy <br> reads as a newline, in the row and in its editor', () => {
    assert.equal(rowOf('off').querySelector('.text_show').textContent, 'Old\ntext');
    assert.equal(rowOf('off').querySelector('.text_output').value, 'Old\ntext');
});

k.test('rows-enabled', S_PAGE, 'the enabled switch shows the stored state and is clickable from the row', () => {
    assert.equal(rowOf('sig').querySelector('input.enabled').checked, true);
    assert.equal(rowOf('off').querySelector('input.enabled').checked, false);
    for (const r of rows()) assert.equal(r.querySelector('input.enabled').disabled, false);
});

k.test('count', S_PAGE, '#ph_count says how many data placeholders are listed', () => {
    assert.equal($('#ph_count').textContent, msg('customDataPH_placeholdersCount', ['2']));
});

k.test('row-editor-closed', S_PAGE, 'at load the rows are in read mode: no mirror, the editors hidden', () => {
    for (const r of rows()) {
        assert.equal(r.querySelector('.editor-wrap').classList.contains('editor-active'), false);
        assert.ok(r.querySelector('.text_output').classList.contains('hiddendata'));
    }
});

k.test('quiet-at-load', S_PAGE, 'at load Save All is disabled, nothing is written, leaving is free', () => {
    assert.equal($('#btnSaveAll').disabled, true);
    assert.deepEqual(ctx.localWrites(0).filter(c => '_custom_placeholder' in c.items), []);
    assert.equal(leaveBlocked(ctx), false);
});

// ---- the add-form ----------------------------------------------------------------------------

const form = { id: () => $('#txtIdNew'), name: () => $('#txtNameNew'), text: () => $('#txtTextNew'), type: () => $('#selectTypeNew') };
const formSuggestions = () => {
    const list = form.text().closest('.autocomplete-container').querySelector('.autocomplete-list');
    return list.classList.contains('hidden') ? [] : [...list.querySelectorAll('.ac_cmd')].map(li => li.textContent);
};
const typeAtCaret = async (ta, text) => {
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    await ctx.fire(ta, 'input');
};

k.test('new-form', S_PAGE, '"New" shows the add-form and is disabled while it is open', async () => {
    await ctx.click($('#btnNew'));
    assert.equal($('#formNew').style.display, 'block');
    assert.equal($('#btnNew').disabled, true);
    assert.equal($('#btnAddNew').disabled, true);
});

k.test('form-mirror', S_PAGE, 'the add-form textarea has its highlight mirror from the start', () => {
    assert.ok(form.text().closest('.editor-wrap').classList.contains('editor-active'));
});

k.test('form-autocomplete-type', S_AUTO, 'the add-form suggestions follow its "add to menu" select, read on every keystroke', async () => {
    await choose(form.type(), '2');
    await typeAtCaret(form.text(), '{%folder');
    assert.deepEqual(formSuggestions(), []);
    await choose(form.type(), '1');
    await typeAtCaret(form.text(), '{%folder');
    assert.deepEqual(formSuggestions(), ['{%mail_folder_name%}', '{%mail_folder_path%}']);
});

k.test('form-autocomplete-builtins', S_AUTO, 'a custom data placeholder is never offered: built-ins only', async () => {
    await typeAtCaret(form.text(), '{%thunderai_custom');
    assert.deepEqual(formSuggestions(), []);
});

const mirrorChip = (ta, token) => [...ta.closest('.editor-wrap').querySelectorAll('.editor-highlights [class*="ph_chip"]')]
    .find(c => c.textContent === token);
const typeAway = async (ta, text) => {
    ta.value = text;
    ta.setSelectionRange(0, 0);
    await ctx.fire(ta, 'input');
};

k.test('form-invalid', S_INVALID, 'the add-form: a custom data placeholder token is red, a wrong-type one amber; a type change repaints', async () => {
    await choose(form.type(), '2');
    await typeAway(form.text(), '{%thunderai_custom_sig%} {%mail_folder_name%}');
    assert.ok(mirrorChip(form.text(), '{%thunderai_custom_sig%}').classList.contains('ph_chip_error'));
    assert.ok(mirrorChip(form.text(), '{%mail_folder_name%}').classList.contains('ph_chip_warn'));
    await choose(form.type(), '1');
    assert.equal(mirrorChip(form.text(), '{%mail_folder_name%}').classList.contains('ph_chip_invalid'), false);
});

k.test('form-validation', S_PAGE, 'Add is enabled only for an id that is set, has no space and is not listed (as typed), with a name and a text', async () => {
    const add = $('#btnAddNew');
    await typeIn(form.name(), 'A name');
    await typeIn(form.text(), 'A text');
    for (const bad of ['', 'two words', 'sig']) {
        await typeIn(form.id(), bad);
        assert.equal(add.disabled, true, JSON.stringify(bad));
        assert.equal(form.id().style.borderColor, 'red', JSON.stringify(bad));
    }
    await typeIn(form.id(), 'Sig');
    assert.equal(add.disabled, false, 'the check is on the id as typed');
    assert.equal(form.id().style.borderColor, 'green');
    await typeIn(form.name(), '  ');
    assert.equal(add.disabled, true, 'a blank name');
    assert.equal(form.name().style.borderColor, 'red');
    await typeIn(form.name(), 'A name');
    await typeIn(form.text(), '');
    assert.equal(add.disabled, true, 'an empty text');
    assert.equal(form.text().style.borderColor, 'red');
});

k.test('add', S_PAGE, 'Add puts the new row in the list, closes and clears the form, and marks the page unsaved', async () => {
    await typeIn(form.id(), 'Greet');
    await typeIn(form.name(), 'Greeting');
    await typeIn(form.text(), 'Hello {%author%}');
    await choose(form.type(), '2');
    assert.equal($('#btnAddNew').disabled, false);
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btnAddNew'));
    const r = rowOf('greet');
    assert.ok(r, 'the new row is not listed: ' + rows().map(x => x.querySelector('.id_show').textContent));
    assert.equal(r.querySelector('.name_show').textContent, 'Greeting');
    assert.equal(r.querySelector('input.enabled').checked, true);
    assert.equal($('#formNew').style.display, 'none');
    for (const f of ['id', 'name', 'text']) assert.equal(form[f]().value, '', f);
    assert.equal($('#btnNew').disabled, false);
    assert.equal($('#btnSaveAll').disabled, false);
    assert.deepEqual(status(), { text: msg('customPrompts_unsaved_changes'), color: 'red' });
    assert.equal($('#ph_count').textContent, msg('customDataPH_placeholdersCount', ['3']));
    assert.deepEqual(ctx.localWrites(since), [], 'written before Save All');
});

k.test('delete-cancelled', S_PAGE, 'Delete asks first; cancelled, the row stays', async () => {
    await ctx.click($('#btnNew'));
    await typeIn(form.id(), 'tmp');
    await typeIn(form.name(), 'Temporary');
    await typeIn(form.text(), 'x');
    await ctx.click($('#btnAddNew'));
    assert.ok(rowOf('tmp'));
    await withConfirm(ctx, false, () => ctx.click(btn(rowOf('tmp'), 'btnDeleteItem')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('customPrompts_btnDelete_confirmText')] });
    assert.ok(rowOf('tmp'));
});

k.test('delete', S_PAGE, 'Delete confirmed removes the row from the list, pending until Save All', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click(btn(rowOf('tmp'), 'btnDeleteItem'));
    assert.equal(rowOf('tmp'), undefined);
    assert.equal($('#ph_count').textContent, msg('customDataPH_placeholdersCount', ['3']));
    assert.equal($('#btnSaveAll').disabled, false);
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('unsaved-guard', S_GUARD, 'with a pending Save All, leaving the page asks first', () => {
    assert.equal(leaveBlocked(ctx), true);
});

k.test('save-error', S_PAGE, 'a failed Save All says so in red, gives the button back and keeps the changes pending', async () => {
    const local = ctx.ctl.browser.storage.local;
    const realSet = local.set;
    local.set = async () => { throw new Error('disk full'); };
    try {
        await saveAll();
    } finally {
        local.set = realSet;
    }
    assert.ok($('#msgDisplay').textContent.startsWith(msg('customDataPH_save_error')), $('#msgDisplay').textContent);
    assert.equal($('#msgDisplay').style.color, 'red');
    assert.equal($('#btnSaveAll').disabled, false, 'no way to try again');
    assert.equal(leaveBlocked(ctx), true, 'the pending changes can be lost without a warning');
    assert.equal(storedOf('greet'), undefined);
});

k.test('save-all-closes-form', S_PAGE, 'Save All also closes and empties the add-form', async () => {
    await ctx.click($('#btnNew'));
    await typeIn(form.id(), 'draft');
    await saveAll();
    assert.equal($('#formNew').style.display, 'none');
    assert.equal(form.id().value, '');
    assert.equal(storedOf('draft'), undefined);
});

k.test('save-all', S_CUSTOM, 'Save All stores every placeholder with the thunderai_custom_ prefix, is_default and is_dynamic "0"', async () => {
    await saveAll();
    assert.deepEqual(stored().map(p => p.id).sort(),
        ['thunderai_custom_greet', 'thunderai_custom_off', 'thunderai_custom_sig']);
    for (const p of stored()) {
        assert.equal(p.is_default, '0', p.id);
        assert.equal(p.is_dynamic, '0', p.id);
    }
    const g = storedOf('greet');
    assert.equal(g.name, 'Greeting');
    assert.equal(String(g.type), '2');
    assert.equal(Number(g.enabled), 1);
    assert.equal(Number(storedOf('off').enabled), 0, 'a disabled placeholder was enabled by the save');
    assert.equal(storedOf('tmp'), undefined, 'a deleted row was saved');
});

k.test('save-all-text', S_PAGE, 'the stored text stays clean: as typed, without the read-mode chip markup', () => {
    assert.equal(storedOf('greet').text, 'Hello {%author%}');
    assert.equal(storedOf('sig').text, SIG.text);
});

k.test('save-all-state', S_PAGE, 'after Save All: the button quiet again, the saved status, leaving free', () => {
    assert.equal($('#btnSaveAll').disabled, true);
    assert.deepEqual(status(), { text: msg('customDataPH_saved'), color: 'green' });
    assert.equal(leaveBlocked(ctx), false);
});

// ---- the row editor --------------------------------------------------------------------------

k.test('edit-enter', S_PAGE, 'Edit: the inputs replace the text, Confirm / Cancel shown as flex, Edit / Delete hidden, the mirror on', async () => {
    const r = rowOf('sig');
    await ctx.click(btn(r, 'btnEditItem'));
    assert.equal(btn(r, 'btnConfirmItem').style.display, 'flex');
    assert.equal(btn(r, 'btnCancelItem').style.display, 'flex');
    assert.equal(btn(r, 'btnEditItem').style.display, 'none');
    assert.equal(btn(r, 'btnDeleteItem').style.display, 'none');
    assert.equal(r.querySelector('.id_show').style.display, 'none');
    assert.equal(r.querySelector('.id_output').style.display, 'inline');
    assert.equal(r.querySelector('.text_output').style.display, 'block');
    assert.equal(r.querySelector('.text_show').style.display, 'none');
    assert.equal(r.querySelector('.type_output').style.display, 'inline');
    assert.ok(r.querySelector('.editor-wrap').classList.contains('editor-active'));
    assert.equal(r.querySelector('.text_output').value, SIG.text);
});

k.test('edit-autocomplete-row-type', S_AUTO, 'the row editor resolves the type from its own row', async () => {
    const r = rowOf('sig');
    const ta = r.querySelector('.text_output');
    const list = () => {
        const l = r.querySelector('.autocomplete-list');
        return l.classList.contains('hidden') ? [] : [...l.querySelectorAll('.ac_cmd')].map(li => li.textContent);
    };
    await choose(r.querySelector('.type_output'), '2');
    await typeAtCaret(ta, '{%typed');
    assert.deepEqual(list(), ['{%mail_typed_text%}']);
    await choose(r.querySelector('.type_output'), '1');
    await typeAtCaret(ta, '{%typed');
    assert.deepEqual(list(), []);
});

k.test('edit-invalid-repaint', S_INVALID, 'the row editor: a type change repaints the tiers', async () => {
    const r = rowOf('sig');
    const ta = r.querySelector('.text_output');
    await typeAway(ta, 'Hi {%mail_typed_text%}');
    assert.ok(mirrorChip(ta, '{%mail_typed_text%}').classList.contains('ph_chip_warn'));
    await choose(r.querySelector('.type_output'), '2');
    assert.equal(mirrorChip(ta, '{%mail_typed_text%}').classList.contains('ph_chip_invalid'), false);
});

k.test('edit-cancel', S_PAGE, 'Cancel restores the row as it was, back in read mode, and saves nothing', async () => {
    const r = rowOf('sig');
    await typeIn(r.querySelector('.name_output'), 'Changed name');
    const since = ctx.ctl.calls.length;
    await ctx.click(btn(r, 'btnCancelItem'));
    assert.equal(r.querySelector('.name_show').textContent, 'Signature');
    assert.equal(r.querySelector('.text_show').textContent, SIG.text);
    assert.equal(r.querySelector('.type_show').textContent, msg('customPrompts_add_to_menu_always'));
    assert.equal(r.querySelector('.name_output').value, 'Signature');
    assert.equal(r.querySelector('.text_output').value, SIG.text, 'the editor keeps the chip markup or the edit');
    assert.equal(btn(r, 'btnEditItem').style.display, '');
    assert.equal(btn(r, 'btnDeleteItem').style.display, '');
    assert.equal(btn(r, 'btnConfirmItem').style.display, 'none');
    assert.equal(r.querySelector('.editor-wrap').classList.contains('editor-active'), false, 'the mirror survived');
    assert.equal(r.querySelector('.text_output')._mztaAutocomplete, undefined, 'the autocomplete survived');
    assert.equal($('#btnSaveAll').disabled, true);
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('cancel-id-restored', S_PAGE, 'Cancel puts the id back into its (hidden) input as it was', () => {
    assert.equal(rowOf('sig').querySelector('.id_output').value, 'sig');
});

k.test('edit-confirm', S_PAGE, 'Confirm updates the row in place, chips included, back in read mode, and marks the page unsaved', async () => {
    const r = rowOf('sig');
    await ctx.click(btn(r, 'btnEditItem'));
    await typeIn(r.querySelector('.name_output'), 'Signature 2');
    await typeIn(r.querySelector('.text_output'), 'Kind regards\n{%author%} & {%mail_subject%}');
    await choose(r.querySelector('.type_output'), '1');
    await ctx.click(btn(r, 'btnConfirmItem'));
    assert.equal(r.querySelector('.id_show').textContent, 'sig', 'OK did not lowercase the id again');
    assert.equal(r.querySelector('.name_show').textContent, 'Signature 2');
    assert.equal(r.querySelector('.text_show').textContent, 'Kind regards\n{%author%} & {%mail_subject%}');
    assert.deepEqual([...r.querySelectorAll('.text_show .ph_chip')].map(c => c.textContent), ['{%author%}', '{%mail_subject%}']);
    assert.equal(r.querySelector('.type_show').textContent, msg('customPrompts_add_to_menu_reading'));
    assert.equal(btn(r, 'btnEditItem').style.display, '');
    assert.equal(btn(r, 'btnDeleteItem').style.display, '');
    assert.equal(btn(r, 'btnConfirmItem').style.display, 'none');
    assert.equal(btn(r, 'btnCancelItem').style.display, 'none');
    assert.equal(r.querySelector('.editor-wrap').classList.contains('editor-active'), false);
    assert.equal(r.querySelector('.text_output')._mztaAutocomplete, undefined);
    assert.equal($('#btnSaveAll').disabled, false);
});

k.test('edit-saved', S_CUSTOM, 'the confirmed edit is stored by Save All', async () => {
    await saveAll();
    const p = storedOf('sig');
    assert.equal(p.name, 'Signature 2');
    assert.equal(String(p.type), '1');
});

k.test('edit-saved-text', S_PAGE, 'the confirmed text is stored as typed, without the chip markup', () => {
    assert.equal(storedOf('sig').text, 'Kind regards\n{%author%} & {%mail_subject%}');
});

// ---- the enabled switch ----------------------------------------------------------------------

k.test('enabled-toggle', S_PAGE, 'unticking enabled on a row marks the page unsaved', async () => {
    await ctx.click(rowOf('sig').querySelector('input.enabled'));
    assert.equal(rowOf('sig').querySelector('input.enabled').checked, false);
    assert.equal($('#btnSaveAll').disabled, false);
    assert.equal(leaveBlocked(ctx), true);
});

k.test('enabled-saved', S_CUSTOM, 'a placeholder disabled from its row is stored with enabled 0, and re-enabling one stores 1', async () => {
    await saveAll();
    assert.equal(Number(storedOf('sig').enabled), 0, 'unticked, stored enabled');
    await ctx.click(rowOf('off').querySelector('input.enabled'));
    await saveAll();
    assert.equal(Number(storedOf('off').enabled), 1, 'ticked, stored disabled');
});

k.test('enabled-toggle-new-row', S_PAGE, 'the enabled switch of a row added in this session marks the page unsaved too', async () => {
    assert.equal($('#btnSaveAll').disabled, true, 'precondition: nothing pending');
    await ctx.click(rowOf('greet').querySelector('input.enabled'));
    assert.equal(rowOf('greet').querySelector('input.enabled').checked, false);
    assert.equal($('#btnSaveAll').disabled, false);
});

// ---- delete after a Save All -----------------------------------------------------------------

k.test('delete-after-save', S_PAGE, 'after a Save All, Delete still removes the row, and the next Save All drops it from storage', async () => {
    await ctx.click(btn(rowOf('greet'), 'btnDeleteItem'));
    assert.equal(rowOf('greet'), undefined, 'the row is still listed');
    await saveAll();
    assert.equal(storedOf('greet'), undefined);
});

// ---- export and import -----------------------------------------------------------------------

k.test('export', S_PAGE, 'Export All downloads a file the import accepts, with the stored placeholders', async () => {
    await ctx.click($('#btnExportAll'));
    const { opts, json } = await lastDownload(ctx);
    assert.match(opts.filename, /^thunderai-custom-data-placeholders-\d{14}\.json$/);
    assert.equal(opts.saveAs, true);
    assert.equal(json.id, 'thunderai-custom-data-placeholders');
    assert.deepEqual(json.customdataplaceholders.map(p => p.id).sort(), stored().map(p => p.id).sort());
});

k.test('export-stored-only', S_PAGE, 'Export All writes what is stored: a pending edit is not in the file', async () => {
    const r = rowOf('off');
    await ctx.click(btn(r, 'btnEditItem'));
    await typeIn(r.querySelector('.name_output'), 'Pending name');
    await ctx.click(btn(r, 'btnConfirmItem'));
    await ctx.click($('#btnExportAll'));
    const { json } = await lastDownload(ctx);
    assert.equal(json.customdataplaceholders.find(p => p.id === 'thunderai_custom_off').name, 'Disabled one');
});

const FILE = JSON.stringify({ id: 'thunderai-custom-data-placeholders', addon_version: '1', customdataplaceholders: [
    { id: 'sig', name: 'Signature imported', text: 'Imported', type: '0', enabled: 1 },
    { id: 'thunderai_custom_new1', name: 'New one', text: 'x', type: '0', enabled: 1 },
    { name: 'No id', text: 'y', type: '0', enabled: 1 },
    { id: '   ', name: 'Blank id', text: 'z', type: '0', enabled: 1 },
] });

k.test('import-refused', S_PAGE, 'Import asks first; refused, no file is asked for', async () => {
    let picked;
    await withConfirm(ctx, false, async () => {
        picked = await pickFile(ctx, () => ctx.click($('#btnImport')), FILE, () => true);
    });
    assert.equal(picked, false);
    assert.ok(ctx.dialogs.at(-1).args[0].includes(msg('importCustomDataPH_confirmText')));
});

k.test('import', S_CUSTOM, 'Import merges on the prefixed id, skips an entry with no usable id, and waits for Save All', async () => {
    const since = ctx.ctl.calls.length;
    // What is stored now, plus new1 (sig is merged, the two entries with no usable id skipped).
    const expected = [...new Set([...stored().map(p => p.id.replace('thunderai_custom_', '')), 'sig', 'new1'])].sort();
    await pickFile(ctx, () => ctx.click($('#btnImport')), FILE,
        () => $('#msgDisplay').textContent === msg('importCustomDataPH_import_completed'));
    assert.deepEqual(rows().map(r => r.querySelector('.id_show').textContent).sort(), expected);
    assert.equal(rowOf('sig').querySelector('.name_show').textContent, 'Signature imported');
    assert.equal($('#btnSaveAll').disabled, false);
    assert.deepEqual(ctx.localWrites(since).filter(c => '_custom_placeholder' in c.items), [], 'saved before Save All');
    await saveAll();
    assert.deepEqual(stored().map(p => p.id).sort(), expected.map(id => 'thunderai_custom_' + id));
    assert.equal(storedOf('sig').name, 'Signature imported');
});

k.test('import-invalid', S_PAGE, 'a file of another kind, or without a placeholder array, is refused with an alert', async () => {
    for (const [file, key] of [
        [JSON.stringify({ id: 'thunderai-prompts', customdataplaceholders: [] }), 'importCustomDataPH_invalidFile'],
        [JSON.stringify({ id: 'thunderai-custom-data-placeholders', customdataplaceholders: {} }), 'importCustomDataPH_invalidDataPHs'],
    ]) {
        const since = ctx.ctl.calls.length;
        await pickFile(ctx, () => ctx.click($('#btnImport')), file, () => $('#msgDisplay').style.color === 'red');
        assert.equal($('#msgDisplay').textContent, msg(key), file);
        assert.deepEqual(ctx.dialogs.at(-1), { kind: 'alert', args: [msg(key)] });
        assert.deepEqual(ctx.localWrites(since), [], file);
    }
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
