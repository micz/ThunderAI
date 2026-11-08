// The Manage Custom Prompts page and the prompt ids, no policy.
//
// Spec 02 "Prompt ids" and spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)": a new id, or
// a changed one, may not start with prompt_ (customPrompts_error_id_reserved), ignoring case, while a
// prompt whose id already starts with it saves as long as the id is left unchanged; the ID derived
// from the name and the id of a copy drop the prefix; the hint under the field says so
// (customPrompts_form_label_ID_rules_prompt); an import renames a custom entry whose id is a shipped
// one.
//
// Stored state: one ordinary personal prompt (mine_one) and one created by the Copy of a built-in in
// an older version (prompt_reply_copy), and the eight built-ins with nothing stored for them. The
// tests run in order on one page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    stubDialogs,
    pickFile,
    withConfirm,
} from '../../ui/page-stubs.mjs';

const personal = (id, name) => ({
    id, name, text: 'Text of ' + id, type: '0', action: '0',
    need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', use_diff_viewer: '0',
    is_default: '0', is_special: '0', show_in: 'popup',
});

const ctx = await openPage('customprompts', {
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_model: 'gpt-global',
        _custom_prompt: [personal('mine_one', 'Mine one'), personal('prompt_reply_copy', 'Old reply copy')],
    },
    commands: { menu_order_highlight: () => undefined },
});
after(() => ctx.close());
const k = uiTests('customprompts', '04');
const $ = ctx.$;
stubDialogs(ctx);

const S_IDS = 'spec 02 "Prompt ids"';
const S_PAGE = 'spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)"';

const rows = () => ctx.$$('#prompts_list .p_row');
const rowOf = id => rows().find(r => r.querySelector('.p-id').textContent === id);
const stored = () => ctx.ctl.localData()._custom_prompt || [];
const storedOf = id => stored().find(p => p.id === id);
const typeIn = async (el, value) => { el.value = value; await ctx.fire(el, 'input'); };
const select = async id => { await ctx.click(rowOf(id)); assert.equal($('#detail_id').value, id, id + ' not opened'); };
const refused = async (errorKey) => {
    await ctx.click($('#btnDetailSave'));
    assert.equal($('#detail_error').textContent, msg(errorKey));
    assert.ok($('#detail_id').classList.contains('input_error'));
};

k.test('hint', S_PAGE, 'the hint under the ID field names the prompt_ rule', () => {
    assert.ok($('#detail_id').parentElement.textContent.includes(msg('customPrompts_form_label_ID_rules_prompt')));
});

k.test('new-reserved', S_IDS, 'a new prompt with an id starting with prompt_, in any case, is refused, writing nothing', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btnNew'));
    await typeIn($('#detail_name'), 'Something');
    await typeIn($('#detail_text'), 'Say hi');
    for (const id of ['prompt_mine', 'Prompt_Summarize', 'prompt_summarize']) {
        await typeIn($('#detail_id'), id);
        await refused('customPrompts_error_id_reserved');
    }
    assert.deepEqual(ctx.localWrites(since), []);
    await ctx.click($('#btnDetailCancel'));
});

k.test('new-from-name', S_IDS, 'the ID derived from a name drops the prompt_ start, and Save accepts it', async () => {
    await ctx.click($('#btnNew'));
    await typeIn($('#detail_name'), 'Prompt summarize');
    assert.equal($('#detail_id').value, 'summarize');
    await typeIn($('#detail_name'), 'Prompt: prompt reply');
    assert.equal($('#detail_id').value, 'reply', 'a repeated prefix goes too, or Save would refuse the id');
    await typeIn($('#detail_name'), 'Prompt summarize');
    await typeIn($('#detail_text'), 'Sum it up');
    await ctx.click($('#btnDetailSave'));
    assert.equal(storedOf('summarize')?.text, 'Sum it up');
});

k.test('change-reserved', S_IDS, 'changing the id of a prompt to one starting with prompt_ is refused', async () => {
    await select('mine_one');
    const since = ctx.ctl.calls.length;
    await typeIn($('#detail_id'), 'prompt_mine_one');
    await refused('customPrompts_error_id_reserved');
    assert.deepEqual(ctx.localWrites(since), []);
    await ctx.click($('#btnDetailCancel'));
});

k.test('legacy-unchanged', S_IDS, 'a prompt whose id already starts with prompt_ saves while the id is left as it is', async () => {
    await select('prompt_reply_copy');
    await typeIn($('#detail_name'), 'Old reply copy, edited');
    await ctx.click($('#btnDetailSave'));
    assert.equal(storedOf('prompt_reply_copy')?.name, 'Old reply copy, edited');
});

k.test('legacy-changed', S_IDS, 'its id changed to another prompt_ one is refused; changed to a free one it saves', async () => {
    await select('prompt_reply_copy');
    await typeIn($('#detail_id'), 'prompt_reply_copy2');
    await refused('customPrompts_error_id_reserved');
    await typeIn($('#detail_id'), 'reply_copy2');
    await ctx.click($('#btnDetailSave'));
    assert.ok(storedOf('reply_copy2'));
    assert.equal(storedOf('prompt_reply_copy'), undefined);
});

k.test('duplicate-builtin', S_IDS, 'the copy of a built-in has an id without prompt_, which Save accepts', async () => {
    await select('prompt_reply');
    await ctx.click($('#btnDetailDuplicateEdit'));
    const id = 'reply_' + msg('copy_text');
    assert.equal($('#detail_id').value, id);
    await ctx.click($('#btnDetailSave'));
    assert.equal(String(storedOf(id)?.is_default), '0');
});

const FILE = JSON.stringify({ id: 'thunderai-prompts', addon_version: '1', prompts: [
    { id: 'prompt_summarize', name: 'From the file', text: 'File text', type: '1', action: '0', is_default: '0' },
    { id: 'prompt_reply', position_display: 3, position_compose: 3, position_context: 3 },
] });

k.test('import-renamed', S_IDS, 'an imported custom prompt with a shipped id is stored renamed; a built-in entry merges', async () => {
    await withConfirm(ctx, true, () => pickFile(ctx, () => ctx.click($('#btnImport')), FILE,
        () => $('#msgDisplay').textContent === msg('customPrompts_import_completed_saved')));
    // summarize was created above, so the file's prompt_summarize becomes summarize_2.
    assert.equal(storedOf('summarize_2')?.text, 'File text');
    assert.equal(storedOf('summarize')?.text, 'Sum it up', 'the existing prompt was overwritten');
    assert.equal(stored().some(p => ['prompt_summarize', 'prompt_reply'].includes(p.id)), false);
    assert.equal(ctx.ctl.localData()._default_prompts_properties?.prompt_reply?.position_display, 3);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
