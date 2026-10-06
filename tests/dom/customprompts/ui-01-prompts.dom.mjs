// The Manage Custom Prompts page with two prompts of the user's, no policy.
//
// Spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)": the list (badges, padlock, preview
// with placeholder chips, option chips, count), the search and its badge, the view switch and its
// pref, the row menu, the detail editor (read-only built-ins, the flags, the diff viewer, the
// connection disclosure and its Reset, the ID from the name, validation, Save / Cancel, New,
// Duplicate, Delete, the dirty guard), Export / Import and the immediate saving with its status;
// spec 02 "Custom Prompts", "The five boolean flags are normalized on read" (the editor writes
// numbers), "Per-Prompt API Override Properties" (the export without API settings), "Menu Order
// Page (`pages/menu_order/`)" (the "Menu position" deep-link, from this side); spec 03 "Invalid
// placeholder feedback" (the list preview and the edit-mode mirror) and "Placeholder Autocomplete"
// (the type read through the getter on #detail_type).
//
// Stored state: the global connection is the OpenAI API (with a model), two personal prompts -
// mine_alpha (composing, reply, two flags on, a missing and a wrong-type placeholder) and mine_beta
// (always, substitute text, the diff viewer on, an Anthropic override) - and the eight built-ins
// with nothing stored for them. The tests run in order on one page: each builds on the list the
// previous ones left.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { until } from '../../ui/dom-helpers.mjs';
import {
    stubDialogs,
    stubExecCommand,
    pickFile,
    lastDownload,
    withConfirm,
    leaveBlocked,
} from '../../ui/page-stubs.mjs';

const ALPHA = {
    id: 'mine_alpha', name: 'Alpha helper',
    text: 'Draft {%mail_subject%}<br>from {%no_such_ph%} in {%mail_folder_name%}',
    type: '2', action: '1',
    need_selected: '0', need_signature: '1', need_custom_text: '0', define_response_lang: '1', use_diff_viewer: '0',
    is_default: '0', is_special: '0', show_in: 'popup', position_display: 20, position_compose: 20,
};
const BETA = {
    id: 'mine_beta', name: 'Beta writer',
    text: 'Rewrite {%selected_text%} with {%mail_typed_text%}',
    type: '0', action: '2',
    need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', use_diff_viewer: '1',
    api_type: 'anthropic_api', anthropic_model: 'claude-test',
    is_default: '0', is_special: '0', show_in: 'both', position_display: 21, position_compose: 21,
};
const BUILT_INS = ['prompt_classify', 'prompt_proofread_this', 'prompt_reply', 'prompt_reply_advanced',
    'prompt_reply_custom_command', 'prompt_rewrite_formal', 'prompt_rewrite_polite', 'prompt_this'];

const ctx = await openPage('customprompts', {
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_model: 'gpt-global',
        _custom_prompt: [ALPHA, BETA],
    },
    // The "Menu position" button tells an already open Menu Order tab to highlight; that
    // message reaches the other extension pages, the background ignores it.
    commands: { menu_order_highlight: () => undefined },
});
after(() => ctx.close());
const k = uiTests('customprompts', '01');
const $ = ctx.$;
const dialogs = stubDialogs(ctx);

const S_PAGE = 'spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)"';
const S_CUSTOM = 'spec 02 "Custom Prompts"';
const S_FLAGS = 'spec 02 "The five boolean flags are normalized on read"';
const S_OVERRIDE = 'spec 02 "Per-Prompt API Override Properties"';
const S_MENU = 'spec 02 "Menu Order Page (`pages/menu_order/`)"';
const S_INVALID = 'spec 03 "Invalid placeholder feedback"';
const S_AUTO = 'spec 03 "Placeholder Autocomplete"';

const FLAGS = ['need_selected', 'need_signature', 'need_custom_text', 'define_response_lang', 'use_diff_viewer'];
const rows = () => ctx.$$('#prompts_list .p_row');
const ids = () => rows().map(r => r.querySelector('.p-id').textContent);
const rowOf = id => rows().find(r => r.querySelector('.p-id').textContent === id);
const stored = () => ctx.ctl.localData()._custom_prompt || [];
const storedOf = id => stored().find(p => p.id === id);
const hidden = id => $('#' + id).classList.contains('hiddendata');
const typeIn = async (el, value) => { el.value = value; await ctx.fire(el, 'input'); };
const choose = async (el, value) => { el.value = value; await ctx.fire(el, 'change'); };
const select = async id => { await ctx.click(rowOf(id)); assert.equal($('#detail_id').value, id, id + ' not opened'); };
const search = async needle => typeIn($('#prompts_search'), needle);
const status = () => ({ text: $('#msgDisplay').textContent, color: $('#msgDisplay').style.color });

// ---- the list --------------------------------------------------------------------------------

k.test('list-rows', S_PAGE, 'every prompt is listed once: the built-ins as System, padlocked and locked, the user\'s as Personal', () => {
    assert.deepEqual([...ids()].sort(), ['mine_alpha', 'mine_beta', ...BUILT_INS].sort());
    for (const id of BUILT_INS) {
        const r = rowOf(id);
        assert.equal(r.querySelector('.p-type').textContent, msg('customPrompts_badge_system'), id);
        assert.ok(r.querySelector('.p-type').classList.contains('badge_system'), id);
        assert.equal(r.querySelector('.p_lock').hidden, false, id + ': no padlock');
        assert.ok(r.classList.contains('is_locked'), id);
        assert.equal(r.querySelector('.btnRowEdit').textContent, msg('customPrompts_btnOpen'), id);
        assert.doesNotMatch(r.querySelector('.p-name').textContent, /__MSG_/, id + ': name not resolved');
    }
    assert.equal(rowOf('prompt_reply').querySelector('.p-name').textContent, msg('prompt_reply'));
    for (const id of ['mine_alpha', 'mine_beta']) {
        const r = rowOf(id);
        assert.equal(r.querySelector('.p-type').textContent, msg('customPrompts_badge_personal'), id);
        assert.equal(r.querySelector('.p_lock').hidden, true, id);
        assert.equal(r.classList.contains('is_locked'), false, id);
        assert.equal(r.querySelector('.btnRowEdit').textContent, msg('customPrompts_btnEdit'), id);
    }
    assert.equal(rowOf('mine_alpha').querySelector('.p-name').textContent, 'Alpha helper');
});

k.test('list-order', S_PAGE, 'the list is in id order, and on arrival the pane shows its first row', () => {
    assert.deepEqual(ids(), [...ids()].sort((a, b) => a.localeCompare(b)));
    assert.equal($('#detail_id').value, ids()[0]);
    assert.ok(rows()[0].classList.contains('is_selected'));
});

k.test('list-count', S_PAGE, '#prompts_count says how many prompts are listed', () => {
    assert.equal($('#prompts_count').textContent, msg('customPrompts_promptsCount', ['10']));
});

k.test('list-preview', S_PAGE, 'the preview is one line, with the menu and action labels', () => {
    const r = rowOf('mine_alpha');
    assert.equal(r.querySelector('.p-text').textContent,
        'Draft {%mail_subject%} from {%no_such_ph%} in {%mail_folder_name%}');
    assert.equal(r.querySelector('.p_menu').textContent, msg('customPrompts_add_to_menu_composing'));
    assert.equal(r.querySelector('.p_action').textContent, msg('customPrompts_do_reply'));
    assert.equal(rowOf('mine_beta').querySelector('.p_action').textContent, msg('customPrompts_substitute_text'));
});

k.test('preview-chips', S_INVALID, 'read mode: a missing id is red, a wrong-type one amber, a valid one a plain chip', () => {
    const chips = Object.fromEntries([...rowOf('mine_alpha').querySelectorAll('.p-text .ph_chip')]
        .map(c => [c.textContent, c]));
    assert.deepEqual(Object.keys(chips), ['{%mail_subject%}', '{%no_such_ph%}', '{%mail_folder_name%}']);
    assert.equal(chips['{%mail_subject%}'].classList.contains('ph_chip_invalid_read'), false);
    assert.ok(chips['{%no_such_ph%}'].classList.contains('ph_chip_error_read'));
    assert.equal(chips['{%no_such_ph%}'].title, msg('editor_placeholder_missing'));
    assert.ok(chips['{%mail_folder_name%}'].classList.contains('ph_chip_invalid_read'));
    assert.equal(chips['{%mail_folder_name%}'].classList.contains('ph_chip_error_read'), false);
    assert.equal(chips['{%mail_folder_name%}'].title, msg('editor_placeholder_wrong_type'));
});

k.test('preview-chips-partial', S_INVALID, 'read mode: in a type-0 prompt a composing-only placeholder is amber "partial"', () => {
    const chip = [...rowOf('mine_beta').querySelectorAll('.p-text .ph_chip')].find(c => c.textContent === '{%mail_typed_text%}');
    assert.ok(chip.classList.contains('ph_chip_invalid_read'));
    assert.equal(chip.title, msg('editor_placeholder_partial_type'));
});

k.test('option-chips', S_PAGE, 'Options chips: every active flag, then the first inactive one, the full label as title', () => {
    const chips = [...rowOf('mine_alpha').querySelectorAll('.p_cell_chips .flag_chip')];
    assert.deepEqual(chips.map(c => c.textContent), [
        '● ' + msg('customPrompts_chip_need_signature'),
        '● ' + msg('customPrompts_chip_define_response_lang'),
        '○ ' + msg('customPrompts_chip_need_selected'),
    ]);
    assert.equal(chips[0].title, msg('customPrompts_form_label_need_signature'));
});

k.test('custom-data-ph-button', S_PAGE, 'the header\'s Custom Data PH button opens the Manage Data Placeholders page', async () => {
    const created = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click($('#btnManageCustomDataPH'));
    const calls = ctx.apiCalls('browser.tabs.create').slice(created);
    assert.equal(calls.length, 1);
    assert.match(calls[0].args[0].url, /pages\/customdataplaceholders\/mzta-custom-dataplaceholders\.html$/);
});

k.test('nothing-written-at-load', S_PAGE, 'opening the page writes no prompt store', () => {
    const keys = ctx.localWrites(0).flatMap(c => Object.keys(c.items));
    assert.deepEqual(keys.filter(k => k.startsWith('_')), []);
});

k.test('row-keyboard', S_PAGE, 'split view: Enter selects the focused row, ArrowDown / ArrowUp move the focus', async () => {
    const first = rows()[0];
    first.focus();
    await ctx.fire(first, 'keydown', { key: 'ArrowDown' });
    assert.equal(ctx.document.activeElement, rows()[1]);
    await ctx.fire(rows()[1], 'keydown', { key: 'ArrowUp' });
    assert.equal(ctx.document.activeElement, rows()[0]);
    const target = rowOf('mine_beta');
    target.focus();
    await ctx.fire(target, 'keydown', { key: 'Enter' });
    assert.equal($('#detail_id').value, 'mine_beta');
    assert.ok(target.classList.contains('is_selected'));
});

// ---- search ----------------------------------------------------------------------------------

k.test('search-input', S_PAGE, 'the search field does not carry List.js\' "search" class', () => {
    assert.equal($('#prompts_search').classList.contains('search'), false);
    assert.ok($('#prompts_search').classList.contains('prompts_search_input'));
});

k.test('search-name', S_PAGE, 'filters on the name, marks the hit, counts "shown of total" and shows the badge', async () => {
    await search('ALPHA');
    assert.deepEqual(ids(), ['mine_alpha']);
    assert.equal($('#prompts_count').textContent, msg('customPrompts_promptsCount_filtered', ['1', '10']));
    assert.equal(hidden('filter_badge'), false);
    assert.equal($('#filter_badge_text').textContent, msg('customPrompts_filter_active', ['1', '10']));
    const marks = [...rowOf('mine_alpha').querySelectorAll('mark.search_hit')].map(m => m.textContent);
    assert.deepEqual(marks, ['Alpha', 'alpha'], 'the hits in the name and the id');
});

k.test('search-resolved-name', S_PAGE, 'a built-in is found by the name the user sees, not its __MSG_ token', async () => {
    await search(msg('prompt_reply').toLowerCase());
    assert.ok(ids().includes('prompt_reply'), ids().join());
    await search('__MSG_');
    assert.deepEqual(ids(), []);
});

k.test('search-id-text', S_PAGE, 'filters on the id and on the text in its one-line form', async () => {
    await search('mine_be');
    assert.deepEqual(ids(), ['mine_beta']);
    await search('subject%} from');
    assert.deepEqual(ids(), ['mine_alpha'], 'the <br> reads as a space');
});

k.test('search-no-match', S_PAGE, 'no match: the badge says so, the detail pane keeps its prompt', async () => {
    await search('zzz-nothing');
    assert.deepEqual(ids(), []);
    assert.equal($('#filter_badge_text').textContent, msg('customPrompts_filter_noMatches'));
    assert.ok($('#filter_badge').classList.contains('filter_badge_empty'));
    assert.equal($('#detail_id').value, 'mine_beta', 'the pane was emptied by the search');
    assert.equal(hidden('detail_body'), false);
});

k.test('search-clear', S_PAGE, 'the badge\'s clear button empties the field and lists everything again', async () => {
    await ctx.click($('#btnClearFilter'));
    assert.equal($('#prompts_search').value, '');
    assert.equal(ids().length, 10);
    assert.equal(hidden('filter_badge'), true);
    assert.equal($('#prompts_count').textContent, msg('customPrompts_promptsCount', ['10']));
    assert.equal(ctx.$$('mark.search_hit').length, 0);
});

// ---- views and the row menu ------------------------------------------------------------------

k.test('view-default', S_PAGE, 'with nothing stored the split view is shown', () => {
    assert.ok($('#prompts_card').classList.contains('view-split'));
    assert.equal($('#btnViewSplit').getAttribute('aria-pressed'), 'true');
    assert.equal($('#btnViewTable').getAttribute('aria-pressed'), 'false');
});

k.test('view-switch', S_PAGE, 'the switch changes the card class, keeps search and selection, and is stored in custom_prompts_view', async () => {
    await search('beta');
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btnViewTable'));
    assert.ok($('#prompts_card').classList.contains('view-table'));
    assert.equal($('#prompts_card').classList.contains('view-split'), false);
    assert.equal($('#btnViewTable').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(ids(), ['mine_beta'], 'the search was lost');
    assert.equal($('#detail_id').value, 'mine_beta');
    assert.equal(ctx.ctl.localData().custom_prompts_view, 'table');
    assert.ok(ctx.localWrites(since).some(c => c.items.custom_prompts_view === 'table'));
    await ctx.click($('#btnClearFilter'));
});

const menuItems = () => ctx.$$('.row_menu .row_menu_item').map(b => b.querySelectorAll('span')[1].textContent);

k.test('row-menu-personal', S_PAGE, '⋯ on a personal prompt: Duplicate, Export, a divider, Delete (danger)', async () => {
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    assert.deepEqual(menuItems(), [msg('customPrompts_btnDuplicate'), msg('customPrompts_btnExport'), msg('customPrompts_btnDelete')]);
    assert.equal(ctx.$$('.row_menu .row_menu_divider').length, 1);
    assert.ok(ctx.$$('.row_menu .row_menu_item').at(-1).classList.contains('danger'));
    await ctx.click($('.row_menu_overlay'));
    assert.equal($('.row_menu'), null, 'the overlay click did not close it');
});

k.test('row-menu-builtin', S_PAGE, '⋯ on a built-in: Duplicate and edit only', async () => {
    await ctx.click(rowOf('prompt_reply').querySelector('.btnRowMenu'));
    assert.deepEqual(menuItems(), [msg('customPrompts_btnDuplicateEdit')]);
    await ctx.fire(ctx.document, 'keydown', { key: 'Escape' });
    assert.equal($('.row_menu'), null, 'Esc did not close it');
});

k.test('row-menu-closes', S_PAGE, 'the row menu closes on search input and on a view switch', async () => {
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    await search('');
    assert.equal($('.row_menu'), null, 'search input');
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    await ctx.click($('#btnViewSplit'));
    assert.equal($('.row_menu'), null, 'view switch');
    await ctx.click($('#btnViewTable'));
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    await ctx.fire($('#prompts_list'), 'scroll');
    assert.equal($('.row_menu'), null, 'list scroll');
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
    await ctx.settle();
    assert.equal($('.row_menu'), null, 'window resize');
});

k.test('row-menu-upward', S_PAGE, 'the row menu opens upward for the last two visible rows, downward otherwise', async () => {
    const last = rows().at(-1);
    await ctx.click(last.querySelector('.btnRowMenu'));
    assert.notEqual($('.row_menu').style.bottom, '', 'the last row\'s menu opens downward');
    assert.equal($('.row_menu').style.top, '');
    await ctx.click($('.row_menu_overlay'));
    await ctx.click(rows()[0].querySelector('.btnRowMenu'));
    assert.notEqual($('.row_menu').style.top, '');
    assert.equal($('.row_menu').style.bottom, '');
    await ctx.click($('.row_menu_overlay'));
});

k.test('table-edit', S_PAGE, 'table view: Edit / Open shows the prompt in the detail view, in split view', async () => {
    await ctx.click(rowOf('prompt_reply').querySelector('.btnRowEdit'));
    assert.equal($('#detail_id').value, 'prompt_reply');
    assert.ok($('#prompts_card').classList.contains('view-split'));
    assert.equal(ctx.ctl.localData().custom_prompts_view, 'split');
});

// ---- a built-in in the detail editor ---------------------------------------------------------

k.test('builtin-readonly', S_PAGE, 'a built-in is read-only: badge, system banner, fields disabled, text readOnly, no connection section', () => {
    assert.equal(hidden('detail_ro_badge'), false);
    assert.equal($('#detail_banner').textContent, msg('customPrompts_system_banner'));
    assert.equal($('#detail_banner').classList.contains('banner_warn'), false);
    for (const id of ['detail_id', 'detail_name', 'detail_type', 'detail_action']) assert.equal($('#' + id).disabled, true, id);
    assert.equal($('#detail_text').readOnly, true);
    assert.equal($('#detail_text').disabled, false, 'disabled, not selectable');
    assert.ok($('#detail_text').closest('.editor-wrap').classList.contains('is_readonly'));
    assert.equal(hidden('detail_api_section'), true);
    assert.equal(hidden('detail_conn_readonly'), true, 'no override to summarize');
    assert.equal($('#detail_title').textContent, msg('prompt_reply'));
    assert.equal($('#detail_subid').textContent, 'prompt_reply');
});

k.test('builtin-buttons', S_PAGE, 'a built-in offers Duplicate and edit only, plus Menu position', () => {
    assert.equal(hidden('btnDetailDuplicateEdit'), false);
    for (const id of ['btnDetailDuplicate', 'btnDetailDelete', 'btnDetailSave', 'btnDetailCancel']) assert.equal(hidden(id), true, id);
    assert.equal(hidden('btnDetailMenuPosition'), false);
});

k.test('builtin-flags', S_PAGE, 'on a built-in only need_custom_text stays editable; the other four are fixed', () => {
    for (const flag of FLAGS) {
        const cb = $('#detail_' + flag);
        const editable = flag === 'need_custom_text';
        assert.equal(cb.disabled, !editable, flag);
        assert.equal(cb.closest('.flag_row').classList.contains('is_fixed'), !editable, flag);
    }
});

k.test('builtin-need-custom-text', S_PAGE, 'toggling a built-in\'s need_custom_text is saved at once, in _default_prompts_properties', async () => {
    const since = ctx.ctl.calls.length;
    const before = ctx.ctl.sent.length;
    await ctx.click($('#detail_need_custom_text'));
    assert.equal(ctx.ctl.localData()._default_prompts_properties?.prompt_reply?.need_custom_text, '1');
    assert.ok(ctx.localWrites(since).some(c => '_custom_prompt' in c.items), 'the list was not written whole');
    assert.ok(ctx.ctl.sent.slice(before).some(m => m.command === 'reload_menus'), 'no reload_menus');
    assert.deepEqual(status(), { text: msg('customPrompts_saved'), color: 'green' });
    assert.equal(hidden('btnDetailSave'), true, 'a Save was offered on a read-only prompt');
    assert.equal(leaveBlocked(ctx), false, 'nothing is pending');
    assert.ok(rowOf('prompt_reply').querySelector('.p_cell_chips').textContent.includes(msg('customPrompts_chip_need_custom_text')));
});

k.test('saved-without-view-fields', S_CUSTOM, 'the stored prompts carry no idnum and no built-in', () => {
    assert.deepEqual(stored().map(p => p.id).sort(), ['mine_alpha', 'mine_beta']);
    for (const p of stored()) assert.equal('idnum' in p, false, p.id);
    assert.deepEqual(Object.keys(ctx.ctl.localData()._default_prompts_properties).sort(), BUILT_INS);
});

// ---- a personal prompt in the detail editor --------------------------------------------------

k.test('personal-fill', S_PAGE, 'a personal prompt fills the pane: the text with real newlines, its flags, no banner', async () => {
    await select('mine_alpha');
    assert.equal($('#detail_name').value, 'Alpha helper');
    assert.equal($('#detail_text').value, 'Draft {%mail_subject%}\nfrom {%no_such_ph%} in {%mail_folder_name%}');
    assert.equal($('#detail_type').value, '2');
    assert.equal($('#detail_action').value, '1');
    assert.deepEqual(FLAGS.map(f => $('#detail_' + f).checked), [false, true, false, true, false]);
    assert.equal(hidden('detail_banner'), true);
    assert.equal(hidden('detail_ro_badge'), true);
    assert.ok(rowOf('mine_alpha').classList.contains('is_selected'));
    assert.equal(rowOf('mine_beta').classList.contains('is_selected'), false);
});

k.test('personal-buttons', S_PAGE, 'a personal prompt: Duplicate · Delete · Save, Save disabled and no Cancel until an edit', () => {
    for (const id of ['btnDetailDuplicate', 'btnDetailDelete', 'btnDetailSave', 'btnDetailMenuPosition']) assert.equal(hidden(id), false, id);
    assert.equal(hidden('btnDetailDuplicateEdit'), true);
    assert.equal(hidden('btnDetailCancel'), true);
    assert.equal($('#btnDetailSave').disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('diff-viewer', S_PAGE, 'use_diff_viewer is selectable only with "substitute text", with the hint saying why', async () => {
    assert.equal($('#detail_use_diff_viewer').disabled, true);
    assert.equal(hidden('detail_diff_hint'), false);
    await choose($('#detail_action'), '2');
    assert.equal($('#detail_use_diff_viewer').disabled, false);
    assert.equal(hidden('detail_diff_hint'), true);
    await ctx.click($('#detail_use_diff_viewer'));
    assert.equal($('#detail_use_diff_viewer').checked, true);
    await choose($('#detail_action'), '0');
    assert.equal($('#detail_use_diff_viewer').disabled, true);
    assert.equal($('#detail_use_diff_viewer').checked, false, 'left on with another action');
});

k.test('flag-ring', S_PAGE, 'a placeholder needing a flag that is off rings the flag', async () => {
    const ta = $('#detail_text');
    await typeIn(ta, 'Use {%additional_text%} and {%selected_text%}');
    assert.ok($('#detail_need_custom_text').classList.contains('invalid_flag'));
    assert.ok($('#detail_need_selected').classList.contains('invalid_flag'));
    await ctx.click($('#detail_need_custom_text'));
    assert.equal($('#detail_need_custom_text').classList.contains('invalid_flag'), false);
    await typeIn(ta, 'Use {%selected_html%}');
    assert.ok($('#detail_need_selected').classList.contains('invalid_flag'));
    await ctx.click($('#detail_need_selected'));
    assert.equal($('#detail_need_selected').classList.contains('invalid_flag'), false);
});

k.test('dirty', S_PAGE, 'an edit enables Save, shows Cancel and arms beforeunload; Cancel reverts the pane', async () => {
    assert.equal($('#btnDetailSave').disabled, false);
    assert.equal(hidden('btnDetailCancel'), false);
    assert.equal(leaveBlocked(ctx), true);
    await ctx.click($('#btnDetailCancel'));
    assert.equal($('#detail_text').value, 'Draft {%mail_subject%}\nfrom {%no_such_ph%} in {%mail_folder_name%}');
    assert.equal($('#detail_action').value, '1');
    assert.deepEqual(FLAGS.map(f => $('#detail_' + f).checked), [false, true, false, true, false]);
    assert.equal($('#btnDetailSave').disabled, true);
    assert.equal(leaveBlocked(ctx), false);
    assert.equal(storedOf('mine_alpha').text, ALPHA.text, 'Cancel wrote something');
});

k.test('validation', S_PAGE, 'Save refuses an empty, spaced or taken id, a missing name or text, and a "%" in the name, writing nothing', async () => {
    const since = ctx.ctl.calls.length;
    const tryIt = async (field, value, errorKey, badId) => {
        await ctx.click($('#btnDetailCancel')).catch(() => {});
        await select('mine_alpha');
        await typeIn($('#' + field), value);
        await ctx.click($('#btnDetailSave'));
        assert.equal($('#detail_error').textContent, msg(errorKey), field + '=' + JSON.stringify(value));
        assert.equal(hidden('detail_error'), false);
        assert.ok($('#' + badId).classList.contains('input_error'), badId);
    };
    await tryIt('detail_id', '', 'customPrompts_error_id', 'detail_id');
    await tryIt('detail_id', 'two words', 'customPrompts_error_id', 'detail_id');
    await tryIt('detail_id', 'Prompt_Reply', 'customPrompts_error_id', 'detail_id');
    await tryIt('detail_name', '   ', 'customPrompts_error_required', 'detail_name');
    await tryIt('detail_text', ' \n ', 'customPrompts_error_required', 'detail_text');
    await tryIt('detail_name', '100% polite', 'customPrompts_error_name_percent', 'detail_name');
    assert.deepEqual(ctx.localWrites(since), []);
    await ctx.click($('#btnDetailCancel'));
    assert.equal(hidden('detail_error'), true, 'the error outlived the reload of the pane');
});

k.test('save-edit', S_PAGE, 'Save applies the pane to the prompt and writes the list at once, with its status', async () => {
    await select('mine_alpha');
    const since = ctx.ctl.calls.length;
    const before = ctx.ctl.sent.length;
    await typeIn($('#detail_id'), '  Mine_Alpha ');
    await typeIn($('#detail_name'), 'Alpha renamed');
    await typeIn($('#detail_text'), 'Line one\nline {%mail_subject%}');
    await choose($('#detail_type'), '1');
    await choose($('#detail_action'), '2');
    await ctx.click($('#detail_use_diff_viewer'));
    await ctx.click($('#btnDetailSave'));
    const p = storedOf('mine_alpha');
    assert.ok(p, 'the id was not trimmed and lowercased: ' + stored().map(x => x.id).join());
    assert.equal(p.name, 'Alpha renamed');
    assert.equal(p.text, 'Line one\nline {%mail_subject%}', 'the newline is not stored as \\n');
    assert.equal(p.type, '1');
    assert.equal(p.action, '2');
    assert.equal(p.show_in, 'popup', 'a property the pane does not edit was lost');
    assert.ok(ctx.localWrites(since).length > 0);
    assert.ok(ctx.ctl.sent.slice(before).some(m => m.command === 'reload_menus'));
    assert.deepEqual(status(), { text: msg('customPrompts_saved'), color: 'green' });
    assert.equal(rowOf('mine_alpha').querySelector('.p-name').textContent, 'Alpha renamed');
    assert.equal($('#detail_title').textContent, 'Alpha renamed');
    assert.equal($('#btnDetailSave').disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('save-flags-numbers', S_FLAGS, 'the editor writes the five flags as numbers 1 / 0', () => {
    const p = storedOf('mine_alpha');
    assert.deepEqual(FLAGS.map(f => p[f]), [0, 1, 0, 1, 1]);
});

k.test('save-seeds-integration-fields', S_PAGE, 'a save stores the integration fields, seeded from the global prefs, and no api_type', () => {
    const p = storedOf('mine_alpha');
    assert.equal(p.api_type, '');
    assert.equal(p.chatgpt_model, 'gpt-global');
});

// ---- the editor mirror and the autocomplete (spec 03) ----------------------------------------

const mirrorChips = () => [...$('#detail_text').closest('.editor-wrap').querySelectorAll('.editor-highlights [class*="ph_chip"]')];
const chipOf = token => mirrorChips().find(c => c.textContent === token);
const typeAway = async text => {
    const ta = $('#detail_text');
    ta.value = text;
    ta.setSelectionRange(0, 0);       // the token under the caret is never flagged
    await ctx.fire(ta, 'input');
};

k.test('mirror-tiers', S_INVALID, 'edit mode: a missing id is red, a wrong-type one amber, and a type change repaints', async () => {
    await typeAway('{%no_such_ph%} {%mail_typed_text%} {%mail_subject%}');
    assert.ok(chipOf('{%no_such_ph%}').classList.contains('ph_chip_error'));
    assert.ok(chipOf('{%mail_typed_text%}').classList.contains('ph_chip_warn'), 'composing-only in a reading prompt');
    assert.equal(chipOf('{%mail_subject%}').classList.contains('ph_chip_invalid'), false);
    await choose($('#detail_type'), '2');
    assert.equal(chipOf('{%mail_typed_text%}').classList.contains('ph_chip_invalid'), false, 'not repainted on the type change');
    assert.ok(chipOf('{%no_such_ph%}').classList.contains('ph_chip_error'));
});

const suggestions = () => {
    const list = $('#detail_text').closest('.autocomplete-container').querySelector('.autocomplete-list');
    return list.classList.contains('hidden') ? [] : [...list.querySelectorAll('.ac_cmd')].map(li => li.textContent);
};
const typeAtCaret = async text => {
    const ta = $('#detail_text');
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    await ctx.fire(ta, 'input');
};

k.test('autocomplete-type', S_AUTO, 'suggestions follow #detail_type, read on every keystroke', async () => {
    await choose($('#detail_type'), '2');
    await typeAtCaret('x {%folder');
    assert.deepEqual(suggestions(), [], 'a reading-only placeholder offered to a composing prompt');
    await typeAtCaret('x {%typed');
    assert.deepEqual(suggestions(), ['{%mail_typed_text%}']);
    await choose($('#detail_type'), '1');
    await typeAtCaret('x {%folder');
    assert.deepEqual(suggestions(), ['{%mail_folder_name%}', '{%mail_folder_path%}']);
    await ctx.click($('#btnDetailCancel'));
});

const acList = () => $('#detail_text').closest('.autocomplete-container').querySelector('.autocomplete-list');
const acItems = () => [...acList().querySelectorAll('li')];
const key = async k => ctx.fire($('#detail_text'), 'keydown', { key: k });
const execCalls = stubExecCommand(ctx);

k.test('autocomplete-substring', S_AUTO, 'a substring of the id matches; prefix matches come first; the matched run is bold, the sigil plain', async () => {
    await typeAtCaret('x {%selected');
    assert.deepEqual(suggestions(), ['{%selected_text%}', '{%selected_html%}',
        '{%mail_text_body_or_selected%}', '{%mail_html_body_or_selected%}']);
    const bold = acItems().map(li => li.querySelector('.ac_cmd b').textContent);
    assert.deepEqual(bold, ['selected', 'selected', 'selected', 'selected']);
    assert.ok(acItems()[2].querySelector('.ac_cmd').textContent.startsWith('{%mail_text_body_or_'));
    await typeAtCaret('x {%');
    assert.ok(suggestions().length > 10, 'a bare {% offers every eligible placeholder');
    await typeAtCaret('x {%zzz');
    assert.deepEqual(suggestions(), [], 'no match closes the list');
});

k.test('autocomplete-aria', S_AUTO, 'listbox / option roles, aria-autocomplete, aria-controls and aria-expanded follow the list', async () => {
    const ta = $('#detail_text');
    assert.equal(ta.getAttribute('aria-autocomplete'), 'list');
    assert.equal(ta.getAttribute('aria-controls'), acList().id);
    assert.equal(acList().getAttribute('role'), 'listbox');
    assert.equal(ta.getAttribute('aria-expanded'), 'false');
    await typeAtCaret('x {%folder');
    assert.equal(ta.getAttribute('aria-expanded'), 'true');
    for (const li of acItems()) {
        assert.equal(li.getAttribute('role'), 'option');
        assert.equal(li.getAttribute('aria-selected'), 'false');
    }
    const desc = acItems()[0].querySelector('.ac_desc');
    assert.ok(desc && desc.textContent !== '' && !desc.textContent.startsWith('__MSG_'), 'no resolved description line');
});

k.test('autocomplete-keys', S_AUTO, 'the arrows move the active item and wrap around; Escape closes', async () => {
    const ta = $('#detail_text');
    await key('ArrowDown');
    assert.equal(acItems()[0].getAttribute('aria-selected'), 'true');
    assert.equal(ta.getAttribute('aria-activedescendant'), acItems()[0].id);
    await key('ArrowDown');
    assert.equal(acItems()[1].getAttribute('aria-selected'), 'true');
    await key('ArrowDown');
    assert.equal(acItems()[0].getAttribute('aria-selected'), 'true', 'no wrap at the bottom');
    await key('ArrowUp');
    assert.equal(acItems()[1].getAttribute('aria-selected'), 'true', 'no wrap at the top');
    await key('Escape');
    assert.deepEqual(suggestions(), []);
    assert.equal(ta.getAttribute('aria-expanded'), 'false');
});

k.test('autocomplete-enter', S_AUTO, 'Enter accepts the active item: the whole typed token is replaced, through an insertText edit', async () => {
    const ta = $('#detail_text');
    await typeAtCaret('Hi {%folder');
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');
    assert.equal(ta.value, 'Hi {%mail_folder_path%}');
    assert.equal(ta.selectionStart, ta.value.length);
    assert.deepEqual(suggestions(), []);
    assert.deepEqual(execCalls.at(-1), ['insertText', false, '{%mail_folder_path%}']);
    const mirror = ta.closest('.editor-wrap').querySelector('.editor-highlights');
    assert.ok(mirror.textContent.startsWith('Hi {%mail_folder_path%}'), 'the mirror was not repainted');
});

k.test('autocomplete-tab', S_AUTO, 'Tab accepts like Enter; with no active item the first one', async () => {
    const ta = $('#detail_text');
    await typeAtCaret('A {%subj');
    await key('Tab');
    assert.equal(ta.value, 'A {%mail_subject%}');
});

k.test('autocomplete-mousedown', S_AUTO, 'a mousedown on an item inserts it', async () => {
    const ta = $('#detail_text');
    await typeAtCaret('B {%folder');
    await ctx.fire(acItems()[1], 'mousedown');
    assert.equal(ta.value, 'B {%mail_folder_path%}');
    assert.deepEqual(suggestions(), []);
});

k.test('autocomplete-dynamic', S_AUTO, 'a dynamic placeholder completes to {%id:%} with the caret after the colon, before the closing %}', async () => {
    const ta = $('#detail_text');
    await typeAtCaret('C {%additional');
    await key('Enter');
    assert.equal(ta.value, 'C {%additional_text:%}');
    assert.equal(ta.selectionStart, ta.value.length - '%}'.length);
});

k.test('mirror-unterminated', S_INVALID, 'edit mode: an unterminated {% is red', async () => {
    await typeAway('Text {%mail_subj and more');
    const chip = mirrorChips().find(c => c.textContent.startsWith('{%mail_subj'));
    assert.ok(chip, 'the unterminated token is not marked');
    assert.ok(chip.classList.contains('ph_chip_error'));
    assert.equal(chip.title, msg('editor_placeholder_unterminated'));
});

k.test('mirror-caret-open', S_INVALID, 'edit mode: the token being typed (open, the caret inside it) is not flagged', async () => {
    const ta = $('#detail_text');
    ta.value = 'x {%mail_su';
    ta.setSelectionRange(ta.value.length, ta.value.length);
    await ctx.fire(ta, 'input');
    assert.equal(mirrorChips().some(c => c.classList.contains('ph_chip_invalid')), false, 'flagged while typing it');
    await typeAway(ta.value);
    assert.ok(mirrorChips().some(c => c.classList.contains('ph_chip_error')), 'not flagged once the caret left');
});

k.test('mirror-caret-complete', S_INVALID, 'edit mode: a complete token is judged even with the caret inside it', async () => {
    const ta = $('#detail_text');
    try {
        ta.value = 'x {%no_such_ph%} y';
        ta.setSelectionRange(6, 6);
        await ctx.fire(ta, 'input');
        assert.ok(chipOf('{%no_such_ph%}').classList.contains('ph_chip_error'), 'an unknown closed token not flagged');
    } finally {
        await ctx.click($('#btnDetailCancel'));
    }
});

// ---- the connection override -----------------------------------------------------------------

const apiSelect = () => $('#detail_prompt_api_type');

k.test('api-closed', S_PAGE, 'with no api_type the [API] disclosure starts closed; ChatGPT Web is not offered on an API global', () => {
    assert.equal(hidden('detail_api_panel'), true);
    assert.equal($('#detail_api_toggle').getAttribute('aria-expanded'), 'false');
    assert.equal($('#detail_api_toggle').title, msg('customPrompts_show_additional_info'));
    assert.equal(apiSelect().value, '');
    assert.equal(hidden('detail_cgw_section'), true);
});

k.test('api-toggle', S_PAGE, 'the disclosure toggle opens and closes the panel, with aria-expanded and its title', async () => {
    await ctx.click($('#detail_api_toggle'));
    assert.equal(hidden('detail_api_panel'), false);
    assert.equal($('#detail_api_toggle').getAttribute('aria-expanded'), 'true');
    assert.equal($('#detail_api_toggle').title, msg('customPrompts_hide_additional_info'));
    await ctx.click($('#detail_api_toggle'));
    assert.equal(hidden('detail_api_panel'), true);
});

k.test('api-open', S_PAGE, 'a prompt with an api_type opens [API] at once, showing its provider and fields', async () => {
    await select('mine_beta');
    assert.equal(hidden('detail_api_panel'), false);
    assert.equal(apiSelect().value, 'anthropic_api');
    assert.equal($('#detail_prompt_anthropic_model').value, 'claude-test');
});

k.test('mirror-follows-fill', S_PAGE, 'selecting another prompt repaints the editor mirror with its text', () => {
    const mirror = $('#detail_text').closest('.editor-wrap').querySelector('.editor-highlights');
    assert.ok(mirror.textContent.startsWith(BETA.text), JSON.stringify(mirror.textContent));
});

k.test('api-reset', S_PAGE, 'Reset clears the override in the pane only, as a pending edit; Save stores it cleared', async () => {
    const reset = [...$('#detail_api_panel').querySelectorAll('button')].find(b => b.textContent.trim() === msg('reset'));
    assert.ok(reset, 'no Reset button in the connection panel');
    const since = ctx.ctl.calls.length;
    await ctx.click(reset);
    assert.equal(apiSelect().value, '');
    assert.equal($('#detail_prompt_anthropic_model').value, '');
    assert.equal($('#btnDetailSave').disabled, false);
    assert.deepEqual(ctx.localWrites(since), [], 'Reset saved by itself');
    await ctx.click($('#btnDetailSave'));
    assert.equal(storedOf('mine_beta').api_type, '');
});

// ---- New, the ID from the name, Duplicate, Delete --------------------------------------------

k.test('new-blank', S_PAGE, 'New prompt: an empty pane in "new" mode, Save and Cancel offered, no Menu position', async () => {
    await ctx.click($('#btnNew'));
    assert.equal($('#detail_title').textContent, msg('customPrompts_new_prompt_title'));
    for (const id of ['detail_id', 'detail_name', 'detail_text']) assert.equal($('#' + id).value, '', id);
    assert.equal($('#detail_type').value, '0');
    assert.equal($('#detail_action').value, '0');
    assert.equal(hidden('btnDetailSave'), false);
    assert.equal($('#btnDetailSave').disabled, false);
    assert.equal(hidden('btnDetailCancel'), false);
    assert.equal(hidden('btnDetailMenuPosition'), true);
    assert.equal(hidden('btnDetailDelete'), true);
    for (const f of FLAGS.filter(f => f !== 'use_diff_viewer')) assert.equal($('#detail_' + f).disabled, false, f);
    assert.equal(ctx.$$('.p_row.is_selected').length, 0);
});

k.test('id-from-name', S_PAGE, 'the empty ID follows the name: accents dropped, runs to "_", unique with _2', async () => {
    const name = $('#detail_name');
    await typeIn(name, '  Résumé, Héllo! ');
    assert.equal($('#detail_id').value, 'resume_hello');
    await typeIn(name, 'Mine Alpha');
    assert.equal($('#detail_id').value, 'mine_alpha_2');
    await typeIn(name, '日本語');
    assert.equal($('#detail_id').value, '');
});

k.test('id-link', S_PAGE, 'typing in the ID breaks the link, emptying it restores it', async () => {
    await typeIn($('#detail_id'), 'my_own');
    await typeIn($('#detail_name'), 'Something else');
    assert.equal($('#detail_id').value, 'my_own');
    await typeIn($('#detail_id'), '');
    await typeIn($('#detail_name'), 'Gamma prompt');
    assert.equal($('#detail_id').value, 'gamma_prompt');
});

k.test('new-cancel', S_PAGE, 'Cancel drops the draft and returns to the previous selection', async () => {
    await ctx.click($('#btnDetailCancel'));
    assert.equal($('#detail_id').value, 'mine_beta');
    assert.equal(stored().some(p => p.id === 'gamma_prompt'), false);
});

k.test('new-save', S_PAGE, 'Save creates the prompt after the last position, Personal, in the popup, clears the search and selects it', async () => {
    await search('beta');
    await ctx.click($('#btnNew'));
    await typeIn($('#detail_name'), 'Gamma prompt');
    await typeIn($('#detail_text'), '  Say hi  ');
    await ctx.click($('#btnDetailSave'));
    assert.equal($('#prompts_search').value, '', 'the search was not cleared');
    assert.ok(rowOf('gamma_prompt'), 'the new row is not listed');
    assert.ok(rowOf('gamma_prompt').classList.contains('is_selected'));
    assert.equal($('#detail_id').value, 'gamma_prompt');
    assert.equal(hidden('btnDetailDelete'), false, 'not in edit mode after the save');
    const p = storedOf('gamma_prompt');
    assert.ok(p, 'not stored');
    assert.equal(String(p.is_default), '0');
    assert.equal(p.show_in, 'popup');
    assert.equal(p.position_display, 22);
    assert.equal(p.position_compose, 22);
    assert.equal(p.text, 'Say hi');
    assert.equal($('#prompts_count').textContent, msg('customPrompts_promptsCount', ['11']));
});

k.test('duplicate-personal', S_PAGE, 'Duplicate seeds "new" mode from a copy: id_<copy>, "<name> (<copy>)", pending until Save', async () => {
    await select('mine_beta');
    await ctx.click($('#btnDetailDuplicate'));
    const copy = msg('copy_text');
    assert.equal($('#detail_id').value, 'mine_beta_' + copy);
    assert.equal($('#detail_name').value, 'Beta writer (' + copy + ')');
    assert.equal($('#detail_text').value, BETA.text);
    assert.equal($('#detail_title').textContent, msg('customPrompts_new_prompt_title'));
    assert.equal(hidden('btnDetailCancel'), false);
    assert.equal(leaveBlocked(ctx), true, 'a copy is an unapplied prompt');
    await ctx.click($('#btnDetailSave'));
    assert.equal(storedOf('mine_beta_' + copy)?.text, BETA.text);
    assert.equal(storedOf('mine_beta')?.name, 'Beta writer', 'the original changed');
});

k.test('duplicate-unique', S_PAGE, 'a second copy of the same prompt gets a free id: <id>_<copy>_2', async () => {
    await select('mine_beta');
    await ctx.click($('#btnDetailDuplicate'));
    assert.equal($('#detail_id').value, 'mine_beta_' + msg('copy_text') + '_2');
    await ctx.click($('#btnDetailCancel'));
    assert.equal($('#detail_id').value, 'mine_beta');
});

k.test('duplicate-builtin', S_PAGE, 'Duplicate and edit on a built-in gives an ordinary personal prompt with its resolved name', async () => {
    await select('prompt_classify');
    await ctx.click($('#btnDetailDuplicateEdit'));
    const copy = msg('copy_text');
    assert.equal($('#detail_name').value, msg('prompt_classify') + ' (' + copy + ')');
    for (const id of ['detail_id', 'detail_name', 'detail_type']) assert.equal($('#' + id).disabled, false, id);
    assert.equal($('#detail_text').readOnly, false);
    await ctx.click($('#btnDetailSave'));
    const p = storedOf('prompt_classify_' + copy);
    assert.ok(p, 'the copy is not among the custom prompts');
    assert.equal(String(p.is_default), '0');
    assert.equal(rowOf('prompt_classify_' + copy).querySelector('.p-type').textContent, msg('customPrompts_badge_personal'));
});

k.test('delete-cancelled', S_PAGE, 'Delete asks first; cancelled, nothing changes', async () => {
    await select('gamma_prompt');
    const since = ctx.ctl.calls.length;
    await withConfirm(ctx, false, () => ctx.click($('#btnDetailDelete')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('customPrompts_btnDelete_confirmText')] });
    assert.ok(rowOf('gamma_prompt'));
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('delete', S_PAGE, 'Delete confirmed: the prompt leaves the list and storage, the next visible one is selected', async () => {
    const visible = ids();
    const next = visible[visible.indexOf('gamma_prompt') + 1] || visible[visible.indexOf('gamma_prompt') - 1];
    await ctx.click($('#btnDetailDelete'));
    assert.equal(rowOf('gamma_prompt'), undefined);
    assert.equal(storedOf('gamma_prompt'), undefined);
    assert.equal($('#detail_id').value, next);
    assert.equal($('#prompts_count').textContent, msg('customPrompts_promptsCount', [String(visible.length - 1)]));
});

k.test('delete-row-menu', S_PAGE, 'Delete from the row menu removes a prompt that is not the selected one', async () => {
    const copy = msg('copy_text');
    await select('mine_alpha');
    const selected = 'mine_alpha';
    await ctx.click(rowOf('mine_beta_' + copy).querySelector('.btnRowMenu'));
    const del = ctx.$$('.row_menu .row_menu_item').find(b => b.textContent.includes(msg('customPrompts_btnDelete')));
    await ctx.click(del);
    assert.equal(storedOf('mine_beta_' + copy), undefined);
    assert.equal($('#detail_id').value, selected, 'the selection moved');
});

// ---- the dirty guard -------------------------------------------------------------------------

const GUARD = [msg('customPrompts_btnCancel'), msg('customPrompts_dirty_discard'), msg('customPrompts_dirty_apply')];

k.test('guard-cancel', S_PAGE, 'with unapplied edits, picking another prompt asks Cancel / Discard / Apply; Cancel stays', async () => {
    await select('mine_alpha');
    await typeIn($('#detail_name'), 'Alpha pending');
    await ctx.click(rowOf('mine_beta'));
    assert.ok(dialogs.open(), 'no dialog');
    assert.equal(dialogs.open().querySelector('.dialog_text').textContent, msg('customPrompts_dirty_confirm'));
    assert.deepEqual(dialogs.labels(), GUARD);
    await dialogs.choose(GUARD[0]);
    assert.equal(dialogs.open(), null);
    assert.equal($('#detail_id').value, 'mine_alpha');
    assert.equal($('#detail_name').value, 'Alpha pending');
    assert.equal(leaveBlocked(ctx), true);
});

k.test('guard-discard', S_PAGE, 'Discard drops the edits and moves on, writing nothing', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click(rowOf('mine_beta'));
    await dialogs.choose(GUARD[1]);
    assert.equal($('#detail_id').value, 'mine_beta');
    assert.equal(storedOf('mine_alpha').name, 'Alpha renamed');
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('guard-apply', S_PAGE, 'Apply saves the edits, then moves on', async () => {
    await typeIn($('#detail_name'), 'Beta applied');
    await ctx.click(rowOf('mine_alpha'));
    await dialogs.choose(GUARD[2]);
    assert.equal(storedOf('mine_beta').name, 'Beta applied');
    assert.equal($('#detail_id').value, 'mine_alpha');
});

k.test('guard-apply-invalid', S_PAGE, 'Apply with invalid fields keeps the user in place, with the error', async () => {
    await typeIn($('#detail_name'), '');
    await ctx.click(rowOf('mine_beta'));
    await dialogs.choose(GUARD[2]);
    assert.equal($('#detail_id').value, 'mine_alpha');
    assert.equal($('#detail_error').textContent, msg('customPrompts_error_required'));
    assert.equal(storedOf('mine_alpha').name, 'Alpha renamed');
});

k.test('guard-new', S_PAGE, 'New goes through the guard as well', async () => {
    await ctx.click($('#btnNew'));
    assert.deepEqual(dialogs.labels(), GUARD);
    await dialogs.choose(GUARD[1]);
    assert.equal($('#detail_title').textContent, msg('customPrompts_new_prompt_title'));
    await ctx.click($('#btnDetailCancel'));
});

k.test('guard-escape', S_PAGE, 'Escape on the guard dialog is a Cancel: the user stays, the edits pending', async () => {
    await typeIn($('#detail_name'), 'Alpha pending');
    await ctx.click(rowOf('mine_beta'));
    const dlg = dialogs.open();
    assert.ok(dlg, 'no dialog');
    dlg.dispatchEvent(new ctx.window.Event('cancel', { cancelable: true }));
    await ctx.settle();
    assert.equal(dialogs.open(), null);
    assert.equal($('#detail_id').value, 'mine_alpha');
    assert.equal($('#detail_name').value, 'Alpha pending');
});

k.test('guard-table-edit', S_PAGE, 'the table view\'s Edit goes through the guard too', async () => {
    await ctx.click($('#btnViewTable'));
    await ctx.click(rowOf('mine_beta').querySelector('.btnRowEdit'));
    assert.deepEqual(dialogs.labels(), GUARD);
    await dialogs.choose(GUARD[1]);
    assert.equal($('#detail_id').value, 'mine_beta');
    assert.ok($('#prompts_card').classList.contains('view-split'));
    assert.equal(storedOf('mine_alpha').name, 'Alpha renamed');
});

// ---- Menu position, from this side -----------------------------------------------------------

k.test('menu-position-new-tab', S_MENU, '"Menu position" with no Menu Order tab open: the id is stashed in session storage and the page opened', async () => {
    await select('mine_beta');
    const created = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click($('#btnDetailMenuPosition'));
    const stash = await ctx.ctl.browser.storage.session.get('menu_order_highlight_target');
    assert.equal(stash.menu_order_highlight_target, 'mine_beta');
    const calls = ctx.apiCalls('browser.tabs.create').slice(created);
    assert.equal(calls.length, 1);
    assert.match(calls[0].args[0].url, /pages\/menu_order\/mzta-menu-order\.html$/);
});

k.test('menu-position-open-tab', S_MENU, '"Menu position" with the tab already open: it is focused and asked to highlight the prompt', async () => {
    const tabs = ctx.ctl.browser.tabs;
    const realQuery = tabs.query;
    tabs.query = async () => [{ id: 42 }];
    try {
        const before = ctx.ctl.sent.length;
        await ctx.click($('#btnDetailMenuPosition'));
        assert.deepEqual(ctx.apiCalls('browser.tabs.update').at(-1).args, [42, { active: true }]);
        assert.deepEqual(ctx.ctl.sent.slice(before).filter(m => m.command === 'menu_order_highlight'),
            [{ command: 'menu_order_highlight', promptId: 'mine_beta' }]);
    } finally {
        tabs.query = realQuery;
    }
});

// ---- Export and Import -----------------------------------------------------------------------

k.test('export-cancel', S_PAGE, 'Export asks whether to include the API settings; Cancel exports nothing', async () => {
    const downloads = ctx.apiCalls('browser.downloads.download').length;
    await ctx.click(rowOf('mine_alpha').querySelector('.btnRowMenu'));
    await ctx.click(ctx.$$('.row_menu .row_menu_item').find(b => b.textContent.includes(msg('customPrompts_btnExport'))));
    assert.equal(dialogs.open().querySelector('.dialog_text').textContent, msg('customPrompts_export_include_api_settings'));
    assert.deepEqual(dialogs.labels(), [msg('customPrompts_btnCancel'), msg('no_string'), msg('yes_string')]);
    await dialogs.choose(msg('customPrompts_btnCancel'));
    assert.equal(ctx.apiCalls('browser.downloads.download').length, downloads);
});

k.test('export-one', S_OVERRIDE, 'Export of one prompt without API settings: the full file format, one prompt, no override field', async () => {
    await choose($('#detail_prompt_api_type'), 'anthropic_api');
    await ctx.click($('#btnDetailSave'));
    assert.equal(storedOf('mine_beta').api_type, 'anthropic_api');
    await ctx.click(rowOf('mine_beta').querySelector('.btnRowMenu'));
    await ctx.click(ctx.$$('.row_menu .row_menu_item').find(b => b.textContent.includes(msg('customPrompts_btnExport'))));
    await dialogs.choose(msg('no_string'));
    const { opts, json } = await lastDownload(ctx);
    assert.match(opts.filename, /^thunderai-prompt-mine_beta-\d{14}\.json$/);
    assert.equal(opts.saveAs, true);
    assert.equal(json.id, 'thunderai-prompts');
    assert.equal(json.addon_version, ctx.ctl.browser.runtime.getManifest().version);
    assert.deepEqual(json.prompts.map(p => p.id), ['mine_beta']);
    const keys = Object.keys(json.prompts[0]);
    assert.deepEqual(keys.filter(k => k === 'api_type' || /^(chatgpt|anthropic|ollama|openai_comp|google_gemini)_/.test(k)), []);
});

k.test('export-all', S_PAGE, 'Export All with API settings: every prompt, built-ins included, the override kept', async () => {
    await ctx.click($('#btnExportAll'));
    await dialogs.choose(msg('yes_string'));
    const { opts, json } = await lastDownload(ctx);
    assert.match(opts.filename, /^thunderai-prompts-\d{14}\.json$/);
    const exported = json.prompts.map(p => p.id);
    for (const id of [...BUILT_INS, 'mine_alpha', 'mine_beta']) assert.ok(exported.includes(id), id);
    assert.equal(json.prompts.find(p => p.id === 'mine_beta').api_type, 'anthropic_api');
});

const FILE = JSON.stringify({ id: 'thunderai-prompts', addon_version: '1', prompts: [
    { id: 'mine_alpha', name: 'Alpha imported', text: 'Imported text', type: '1', action: '0', is_default: '0' },
    { id: 'imported_one', name: 'Imported one', text: 'Hello', type: '0', action: '0', is_default: '0', enabled: 0,
      need_signature: 1 },
] });

k.test('import-refused', S_PAGE, 'Import asks first, saying it saves at once; refused, no file is asked for', async () => {
    let picked;
    await withConfirm(ctx, false, async () => {
        picked = await pickFile(ctx, () => ctx.click($('#btnImport')), FILE, () => true);
    });
    assert.equal(picked, false, 'a file was asked for');
    const text = ctx.dialogs.at(-1).args[0];
    assert.ok(text.includes(msg('importPrompts_confirmText')), text);
    assert.ok(text.includes(msg('customPrompts_import_saved_now')), text);
});

k.test('import', S_PAGE, 'Import merges the file into the list and saves it at once', async () => {
    const before = ctx.ctl.sent.length;
    await pickFile(ctx, () => ctx.click($('#btnImport')), FILE,
        () => $('#msgDisplay').textContent === msg('customPrompts_import_completed_saved'));
    assert.equal(storedOf('mine_alpha').name, 'Alpha imported');
    assert.equal(storedOf('mine_alpha').text, 'Imported text');
    assert.ok(storedOf('imported_one'));
    assert.ok(storedOf('mine_beta'), 'a prompt missing from the file was dropped');
    assert.ok(rowOf('imported_one'));
    assert.equal($('#msgDisplay').style.color, 'green');
    assert.ok(ctx.ctl.sent.slice(before).some(m => m.command === 'reload_menus'));
    assert.equal(ids().length, 12);
});

k.test('import-legacy', S_CUSTOM, 'an imported legacy enabled 0 becomes show_in "none", and its flags are canonical', () => {
    const p = storedOf('imported_one');
    assert.equal(p.show_in, 'none');
    assert.equal('enabled' in p, false);
    assert.equal(p.need_signature, '1');
});

k.test('import-invalid', S_PAGE, 'a file of another kind, or without a prompt array, is refused with nothing written', async () => {
    for (const [file, key] of [
        [JSON.stringify({ id: 'something-else', prompts: [] }), 'importPrompts_invalidFile'],
        [JSON.stringify({ id: 'thunderai-prompts', prompts: {} }), 'importPrompts_invalidPrompts'],
        ['{ not json', 'importPrompts_invalidFile'],
    ]) {
        const since = ctx.ctl.calls.length;
        await pickFile(ctx, () => ctx.click($('#btnImport')), file,
            () => $('#msgDisplay').style.color === 'red');
        assert.equal($('#msgDisplay').textContent, msg(key), file);
        assert.ok(ctx.dialogs.at(-1).kind === 'alert' && ctx.dialogs.at(-1).args[0].startsWith(msg(key)), file);
        assert.deepEqual(ctx.localWrites(since).filter(c => '_custom_prompt' in c.items), [], file);
    }
});

k.test('import-guard', S_PAGE, 'Import goes through the dirty guard first', async () => {
    await select('mine_beta');
    await typeIn($('#detail_name'), 'Beta pending');
    let picked;
    picked = await pickFile(ctx, () => ctx.click($('#btnImport')), FILE, () => true);
    assert.equal(picked, false, 'the import ran before the guard was answered');
    assert.deepEqual(dialogs.labels(), GUARD);
    await dialogs.choose(GUARD[0]);
    await ctx.click($('#btnDetailCancel'));
});

// ---- a failed write --------------------------------------------------------------------------

k.test('save-error', S_PAGE, 'a failed write reports the error in red and keeps beforeunload armed', async () => {
    const local = ctx.ctl.browser.storage.local;
    const realSet = local.set;
    local.set = async () => { throw new Error('disk full'); };
    try {
        await typeIn($('#detail_name'), 'Beta failing');
        await ctx.click($('#btnDetailSave'));
    } finally {
        local.set = realSet;
    }
    assert.ok($('#msgDisplay').textContent.startsWith(msg('customPrompts_save_error')), $('#msgDisplay').textContent);
    assert.equal($('#msgDisplay').style.color, 'red');
    assert.equal(leaveBlocked(ctx), true, 'what is on screen is not in storage');
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
