// The Manage Data Placeholders page with values holding quotes, tags and entities, no policy.
//
// Spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)", "What Save All
// stores" and "The values in the row markup": a value is shown and edited literally - never parsed
// as markup, in the read-only cells nor in the row editor - and stored back unchanged; Delete and
// the add-form's "already used" check work on such ids too.
//
// jsdom has no innerText, which the row buttons read and write: the file maps it to textContent
// (ui/page-stubs.mjs). Stored state: one placeholder whose name holds quotes, < > and &, and
// whose text holds "</textarea>", a tag, an entity and a token. The tests run in order on one page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    stubInnerText,
    pickFile,
} from '../../ui/page-stubs.mjs';

const NAME = 'Il "nostro" <saluto> & l\'altro';
const TEXT = 'A </textarea> <b>bold</b> &amp; {%author%}';
const ctx = await openPage('customdataplaceholders', {
    local: {
        _custom_placeholder: [
            { id: 'thunderai_custom_q', name: NAME, text: TEXT, type: '0', enabled: 1,
              is_default: '0', is_dynamic: '0', idnum: 1 },
        ],
    },
});
after(() => ctx.close());
stubInnerText(ctx);
const k = uiTests('customdataplaceholders', '02');
const $ = ctx.$;

const S_PAGE = 'spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)"';

const rows = () => ctx.$$('#all_custom_dataplaceholders tbody.list tr');
const rowOf = id => rows().find(r => r.querySelector('.id_show').textContent === id);
const stored = () => ctx.ctl.localData()._custom_placeholder || [];
const storedOf = id => stored().find(p => p.id === 'thunderai_custom_' + id);
const typeIn = async (el, value) => { el.value = value; await ctx.fire(el, 'input'); };
const btn = (row, cls) => row.querySelector('.' + cls);
const saveAll = () => ctx.click($('#btnSaveAll'));

k.test('shown-literally', S_PAGE, 'the read-only cells show the values literally: no element is made of them', () => {
    const r = rowOf('q');
    assert.ok(r, 'the row is missing or broken');
    assert.equal(rows().length, 1, 'the text split the row');
    assert.equal(r.querySelector('.name_show').textContent, NAME);
    assert.equal(r.querySelector('.name_show').children.length, 0);
    const text = r.querySelector('.text_show');
    assert.equal(text.textContent, TEXT);
    assert.equal(text.querySelector('b'), null, 'a tag of the text became an element');
    assert.deepEqual([...text.children].map(c => c.className), ['ph_chip']);
});

k.test('edited-literally', S_PAGE, 'the row editor holds the values literally', () => {
    const r = rowOf('q');
    assert.equal(r.querySelector('.name_output').value, NAME, 'the quote cut the name');
    assert.equal(r.querySelector('.text_output').value, TEXT, 'the textarea was closed early or an entity decoded');
    assert.equal(r.querySelector('.id_output').value, 'q');
});

k.test('round-trip', S_PAGE, 'Edit, OK and Save All store the values exactly as they were', async () => {
    const r = rowOf('q');
    await ctx.click(btn(r, 'btnEditItem'));
    await ctx.click(btn(r, 'btnConfirmItem'));
    await saveAll();
    assert.equal(storedOf('q').name, NAME);
    assert.equal(storedOf('q').text, TEXT);
});

k.test('round-trip-twice', S_PAGE, 'a second Save All stores them unchanged too', async () => {
    await ctx.click(rowOf('q').querySelector('input.enabled'));
    await saveAll();
    assert.equal(storedOf('q').name, NAME);
    assert.equal(storedOf('q').text, TEXT);
});

k.test('cancel-literally', S_PAGE, 'Cancel restores the editor with the values as they are', async () => {
    const r = rowOf('q');
    await ctx.click(btn(r, 'btnEditItem'));
    await typeIn(r.querySelector('.name_output'), 'changed');
    await ctx.click(btn(r, 'btnCancelItem'));
    assert.equal(r.querySelector('.name_output').value, NAME);
    assert.equal(r.querySelector('.text_output').value, TEXT);
    assert.equal(r.querySelector('.name_show').textContent, NAME);
});

const form = { id: () => $('#txtIdNew'), name: () => $('#txtNameNew'), text: () => $('#txtTextNew') };

k.test('add-literally', S_PAGE, 'a placeholder added with such values is shown and stored literally', async () => {
    await ctx.click($('#btnNew'));
    await typeIn(form.id(), 'x&y');
    await typeIn(form.name(), 'A "b"');
    await typeIn(form.text(), '<i>t</i> &lt;');
    await ctx.click($('#btnAddNew'));
    const r = rowOf('x&y');
    assert.ok(r, 'the new row is not listed');
    assert.equal(r.querySelector('.name_show').textContent, 'A "b"');
    assert.equal(r.querySelector('.name_output').value, 'A "b"');
    assert.equal(r.querySelector('.text_show').textContent, '<i>t</i> &lt;');
    assert.equal(r.querySelector('.text_output').value, '<i>t</i> &lt;');
    await saveAll();
    assert.equal(storedOf('x&y').name, 'A "b"');
    assert.equal(storedOf('x&y').text, '<i>t</i> &lt;');
});

k.test('id-check-literally', S_PAGE, 'the add-form refuses an id already listed, special characters included', async () => {
    await ctx.click($('#btnNew'));
    await typeIn(form.name(), 'n');
    await typeIn(form.text(), 't');
    await typeIn(form.id(), 'x&y');
    assert.equal($('#btnAddNew').disabled, true);
    await typeIn(form.id(), 'x&z');
    assert.equal($('#btnAddNew').disabled, false);
});

k.test('delete-literally', S_PAGE, 'Delete removes a row whose id holds special characters', async () => {
    await ctx.click(btn(rowOf('x&y'), 'btnDeleteItem'));
    assert.equal(rowOf('x&y'), undefined);
    await saveAll();
    assert.equal(storedOf('x&y'), undefined);
    assert.ok(storedOf('q'), 'the other row was removed');
});

k.test('import-literally', S_PAGE, 'an imported placeholder is shown literally, not parsed as markup', async () => {
    const file = JSON.stringify({ id: 'thunderai-custom-data-placeholders', customdataplaceholders: [
        { id: 'imp', name: '<img src="x">', text: '</textarea><b>x</b>', type: '0', enabled: 1 },
    ] });
    await pickFile(ctx, () => ctx.click($('#btnImport')), file, () => !!rowOf('imp'));
    const r = rowOf('imp');
    assert.equal(r.querySelector('img'), null, 'the imported name became an element');
    assert.equal(r.querySelector('.name_show').textContent, '<img src="x">');
    assert.equal(r.querySelector('.text_output').value, '</textarea><b>x</b>');
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
