// The Manage Custom Prompts page opened in the table view, with ChatGPT Web as the global
// connection, no policy.
//
// Spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)": the stored view, the [ChatGPT Web]
// disclosure (shown only on a ChatGPT Web global, for an editable prompt with no api_type, open
// when the prompt carries a model / project / custom GPT), the read-only summary of a built-in's
// override; spec 02 "Per-Prompt API Override Properties" (the summary is the localized label) and
// "The five boolean flags are normalized on read" (an out-of-domain stored need_custom_text shows
// the built-in's value).
//
// Stored state: custom_prompts_view = 'table', connection_type = 'chatgpt_web'; two personal
// prompts - cgw_one with ChatGPT Web overrides, api_one with an Ollama override - and properties for
// two built-ins: prompt_reply with an Ollama override, prompt_reply_custom_command with the
// out-of-domain need_custom_text "" that old versions wrote.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('customprompts', {
    local: {
        connection_type: 'chatgpt_web',
        custom_prompts_view: 'table',
        _custom_prompt: [
            { id: 'cgw_one', name: 'Web one', text: 'Hello', type: '0', action: '0', is_default: '0',
              show_in: 'popup', chatgpt_web_model: 'gpt-4o', chatgpt_web_project: 'g-p-123/project' },
            { id: 'api_one', name: 'Api one', text: 'Hello', type: '0', action: '0', is_default: '0',
              show_in: 'popup', api_type: 'ollama_api', ollama_model: 'llama3' },
        ],
        _default_prompts_properties: {
            prompt_reply: { api_type: 'ollama_api', show_in: 'popup', position_display: 1, position_compose: 1 },
            prompt_reply_custom_command: { need_custom_text: '', show_in: 'popup', position_display: 2, position_compose: 2 },
        },
    },
});
after(() => ctx.close());
const k = uiTests('customprompts', '02');
const $ = ctx.$;

const S_PAGE = 'spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)"';
const S_OVERRIDE = 'spec 02 "Per-Prompt API Override Properties"';
const S_FLAGS = 'spec 02 "The five boolean flags are normalized on read"';

const rowOf = id => ctx.$$('#prompts_list .p_row').find(r => r.querySelector('.p-id').textContent === id);
const hidden = id => $('#' + id).classList.contains('hiddendata');
const open = async id => {
    await ctx.click(rowOf(id).querySelector('.btnRowEdit'));
    assert.equal($('#detail_id').value, id, id + ' not opened');
};
const choose = async (el, value) => { el.value = value; await ctx.fire(el, 'change'); };
const storedOf = id => (ctx.ctl.localData()._custom_prompt || []).find(p => p.id === id);

k.test('view-stored', S_PAGE, 'the stored table view is restored at load, and not written back', () => {
    assert.ok($('#prompts_card').classList.contains('view-table'));
    assert.equal($('#btnViewTable').getAttribute('aria-pressed'), 'true');
    assert.equal($('#btnViewSplit').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(ctx.localWrites(0).filter(c => 'custom_prompts_view' in c.items), []);
});

k.test('cgw-open', S_PAGE, '[ChatGPT Web] is offered on a ChatGPT Web global, and opens when the prompt carries a model or project', async () => {
    await open('cgw_one');
    assert.equal(hidden('detail_cgw_section'), false);
    assert.equal(hidden('detail_cgw_panel'), false);
    assert.equal($('#detail_cgw_toggle').getAttribute('aria-expanded'), 'true');
    assert.equal($('#detail_cgw_toggle').title, msg('customPrompts_hide_additional_info'));
    assert.equal($('#detail_cgw_model').value, 'gpt-4o');
    assert.equal($('#detail_cgw_project').value, 'g-p-123/project');
    assert.equal($('#detail_cgw_custom_gpt').value, '');
    assert.equal(hidden('detail_api_panel'), true, '[API] opened with no api_type');
});

k.test('cgw-follows-api-type', S_PAGE, '[ChatGPT Web] goes away while the prompt sets an api_type, and comes back without one', async () => {
    const apiSelect = $('#detail_prompt_api_type');
    await choose(apiSelect, 'ollama_api');
    assert.equal(hidden('detail_cgw_section'), true);
    await choose(apiSelect, '');
    assert.equal(hidden('detail_cgw_section'), false);
});

k.test('cgw-save', S_PAGE, 'the ChatGPT Web fields are saved with the prompt, trimmed', async () => {
    const field = $('#detail_cgw_custom_gpt');
    field.value = '  g-abc  ';
    await ctx.fire(field, 'input');
    await ctx.click($('#btnDetailSave'));
    const p = storedOf('cgw_one');
    assert.equal(p.chatgpt_web_custom_gpt, 'g-abc');
    assert.equal(p.chatgpt_web_model, 'gpt-4o');
    assert.equal(p.api_type, '');
});

k.test('cgw-hidden-with-override', S_PAGE, 'a prompt with an api_type: no [ChatGPT Web], [API] open', async () => {
    await open('api_one');
    assert.equal(hidden('detail_cgw_section'), true);
    assert.equal(hidden('detail_api_panel'), false);
    assert.equal($('#detail_prompt_api_type').value, 'ollama_api');
});

k.test('cgw-new', S_PAGE, 'a new prompt on a ChatGPT Web global is offered [ChatGPT Web], closed', async () => {
    await ctx.click($('#btnNew'));
    assert.equal(hidden('detail_cgw_section'), false);
    assert.equal(hidden('detail_cgw_panel'), true);
    assert.equal($('#detail_cgw_toggle').getAttribute('aria-expanded'), 'false');
    assert.ok($('#prompts_card').classList.contains('view-split'), 'New did not switch to the split view');
    await ctx.click($('#btnDetailCancel'));
});

k.test('builtin-conn-summary', S_OVERRIDE, 'a built-in\'s override is summarized read-only, with the localized provider label', async () => {
    await ctx.click(rowOf('prompt_reply'));
    assert.equal($('#detail_id').value, 'prompt_reply');
    assert.equal(hidden('detail_conn_readonly'), false);
    assert.equal($('#detail_conn_readonly_value').textContent, msg('prefs_Connection_type_Ollama_API'));
    assert.equal(hidden('detail_api_section'), true);
    assert.equal(hidden('detail_cgw_section'), true, 'ChatGPT Web offered on a read-only prompt');
});

k.test('builtin-flag-fallback', S_FLAGS, 'a stored need_custom_text "" shows the built-in\'s own value, on', async () => {
    await ctx.click(rowOf('prompt_reply_custom_command'));
    assert.equal($('#detail_id').value, 'prompt_reply_custom_command');
    assert.equal($('#detail_need_custom_text').checked, true);
    assert.equal($('#detail_need_custom_text').disabled, false);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
