// The Menu Order page with three custom prompts of the user's and three of the seven special
// features active, no policy.
//
// Spec 02 "Menu Order Page (`pages/menu_order/`)": the two panels (the popup's Reading / Composing
// sub-tabs and their types, the context panel without composing-only prompts), Visible by position
// and Hidden alphabetically, "hidden everywhere", the row badges and the legend, the icon picker,
// the show/hide transitions by dragging between sections, reordering by drag and drop, the
// exclusions (preserved on save), the unsaved-changes tracking, Reset all, the save flow, the
// cross-tab reload and the "Menu position" deep-link message; spec 05 "Menu Order Page
// (`pages/menu_order/`)" (the entry point) and "Unsaved-Changes Guard (`pages/_lib/unsaved-guard.js`)"
// (this page's own somethingChanged-based beforeunload); spec 02 "Icon Resolution".
//
// Drag and drop is driven with the page's own events (dragstart, dragover, drop, dragend) and a
// stand-in dataTransfer. jsdom computes no layout, so every row measures 0×0: a pointer above the
// rows (clientY -1) drops before the first row, below them (clientY 1) after the last. Only those
// two drop positions are reachable here.
//
// Stored state: c_read (reading, both menus), c_compose (composing, popup), c_hidden (always, no
// menu), nothing stored for the built-ins and the special prompts; the background reports only
// add_tags, summarize and translate as active. The tests run in order on one page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { leaveBlocked } from '../../ui/page-stubs.mjs';

const CUSTOM = [
    { id: 'c_read', name: 'Zeta reader', text: 't', type: '1', action: '0', is_default: '0', is_special: '0',
      show_in: 'both', position_display: 100, position_compose: 100, position_context: 100 },
    { id: 'c_compose', name: 'Compose helper', text: 't', type: '2', action: '0', is_default: '0', is_special: '0',
      show_in: 'popup', position_display: 101, position_compose: 0.5 },
    { id: 'c_hidden', name: 'Hidden all', text: 't', type: '0', action: '0', is_default: '0', is_special: '0',
      show_in: 'none' },
];
const ACTIVE_SPECIALS = ['prompt_add_tags', 'prompt_summarize', 'prompt_translate_this'];
const INACTIVE_SPECIALS = ['prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard', 'prompt_get_task', 'prompt_spamfilter'];
const INTERNAL_SPECIALS = ['prompt_summarize_email_template', 'prompt_summarize_email_separator'];

const ctx = await openPage('menu_order', {
    local: { _custom_prompt: CUSTOM },
    commands: { get_active_special_ids: () => ACTIVE_SPECIALS },
});
after(() => ctx.close());
const k = uiTests('menu_order', '01');
const $ = ctx.$;

const S_MO = 'spec 02 "Menu Order Page (`pages/menu_order/`)"';
const S_ICONS = 'spec 02 "Icon Resolution"';
const S_GUARD = 'spec 05 "Unsaved-Changes Guard (`pages/_lib/unsaved-guard.js`)"';

const LISTS = ['popup_list', 'popup_list_hidden', 'context_list', 'context_list_hidden'];
const idsIn = list => ctx.$$('#' + list + ' > li').map(li => li.dataset.id);
const rowIn = (list, id) => ctx.$$('#' + list + ' > li').find(li => li.dataset.id === id);
const allIds = () => new Set(LISTS.flatMap(idsIn));
const nameOf = li => li.querySelector('.item_name').textContent;
const subTab = view => $('.sub_tab[data-view="' + view + '"]');
const model = async () => Object.fromEntries((await ctx.mods.prompts.getPromptsForMenuOrder()).map(p => [p.id, p]));
const status = () => ({ text: $('#msgDisplay').textContent, color: $('#msgDisplay').style.color });
const where = id => LISTS.filter(l => idsIn(l).includes(id));
const builtInIcon = id => ctx.mods.utils.getBuiltInPromptIcon(id).replace(/^moz-extension:/, '');

const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, getData() { return ''; } };
function dragEvent(type, clientY) {
    const e = new ctx.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(e, 'clientY', { value: clientY });
    return e;
}
/** Drag the row of `id` in list `from` into list `to`, before its first row ('top') or after its last ('end'). */
async function drag(from, id, to, at = 'top') {
    const li = rowIn(from, id);
    assert.ok(li, id + ' is not in ' + from);
    const y = at === 'top' ? -1 : 1;
    li.dispatchEvent(dragEvent('dragstart', y));
    const target = $('#' + to);
    target.dispatchEvent(dragEvent('dragover', y));
    target.dispatchEvent(dragEvent('drop', y));
    li.dispatchEvent(dragEvent('dragend', y));
    await ctx.settle();
}

// ---- the panels ------------------------------------------------------------------------------

k.test('popup-reading', S_MO, 'the popup panel opens on Reading: types 0 and 1 only, Visible = show_in popup / both', async () => {
    assert.ok(subTab('display').classList.contains('active'));
    assert.equal(subTab('compose').classList.contains('active'), false);
    const m = await model();
    for (const list of ['popup_list', 'popup_list_hidden']) {
        for (const id of idsIn(list)) assert.ok(['0', '1'].includes(String(m[id].type)), id + ' in ' + list);
    }
    for (const id of idsIn('popup_list')) assert.ok(['popup', 'both'].includes(m[id].show_in), id);
    for (const id of idsIn('popup_list_hidden')) assert.ok(!['popup', 'both'].includes(m[id].show_in), id);
    assert.ok(idsIn('popup_list').includes('c_read'));
    assert.ok(idsIn('popup_list').includes('prompt_reply'));
    assert.equal(allIds().has('c_compose'), false, 'a composing-only prompt in Reading or in the context panel');
});

k.test('context-panel', S_MO, 'the context panel: never a composing-only prompt, Visible = show_in context / both', async () => {
    const m = await model();
    for (const list of ['context_list', 'context_list_hidden']) {
        for (const id of idsIn(list)) assert.notEqual(String(m[id].type), '2', id + ' in ' + list);
    }
    for (const id of idsIn('context_list')) assert.ok(['context', 'both'].includes(m[id].show_in), id);
    for (const id of idsIn('context_list_hidden')) assert.ok(!['context', 'both'].includes(m[id].show_in), id);
    assert.deepEqual(where('c_read'), ['popup_list', 'context_list']);
    assert.ok(idsIn('context_list').includes('prompt_summarize'));
});

k.test('hidden-everywhere', S_MO, 'a prompt with show_in "none" is in the Hidden section of both panels', () => {
    assert.deepEqual(where('c_hidden'), ['popup_list_hidden', 'context_list_hidden']);
});

k.test('visible-by-position', S_MO, 'Visible follows the position (position_display in Reading, position_context in the context panel)', async () => {
    const m = await model();
    const check = (list, key) => {
        const pos = idsIn(list).map(id => m[id][key]).filter(p => p !== undefined && p !== '').map(Number);
        assert.deepEqual(pos, [...pos].sort((a, b) => a - b), list + ': ' + idsIn(list).join());
    };
    check('popup_list', 'position_display');
    const ids = idsIn('popup_list');
    assert.ok(ids.indexOf('prompt_reply') < ids.indexOf('prompt_classify'), 'position 1 after position 6');
    assert.ok(ids.indexOf('prompt_classify') < ids.indexOf('c_read'), 'position 6 after position 100');
});

k.test('no-position-last', S_MO, 'a Visible prompt with no position is listed after every positioned one', async () => {
    const m = await model();
    const has = id => m[id].position_display !== undefined && m[id].position_display !== '';
    const ids = idsIn('popup_list');
    const firstMissing = ids.findIndex(id => !has(id));
    assert.ok(firstMissing > 0, 'precondition: a prompt with no position_display is listed');
    assert.ok(ids.slice(firstMissing).every(id => !has(id)), ids.join());
});

k.test('context-position-at-load', S_MO, 'a missing position_context is the alphabetical rank among all the listed prompts', async () => {
    const m = await model();
    const names = new Map(LISTS.flatMap(l => ctx.$$('#' + l + ' > li').map(li => [li.dataset.id, nameOf(li)])));
    const rank = new Map([...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id], i) => [id, i + 1]));
    const pos = id => (m[id].position_context === undefined || m[id].position_context === '') ? rank.get(id) : Number(m[id].position_context);
    const ids = idsIn('context_list');
    assert.deepEqual(ids, [...ids].sort((a, b) => pos(a) - pos(b)));
    assert.ok(ids.indexOf('prompt_summarize') < ids.indexOf('c_read'), 'a special prompt with no position after position 100');
});

k.test('hidden-alphabetical', S_MO, 'Hidden is sorted alphabetically by the displayed name', () => {
    for (const list of ['popup_list_hidden', 'context_list_hidden']) {
        const names = ctx.$$('#' + list + ' > li').map(nameOf);
        assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), list);
    }
});

k.test('popup-composing', S_MO, 'the Composing sub-tab lists types 0 and 2, by position_compose', async () => {
    await ctx.click(subTab('compose'));
    assert.ok(subTab('compose').classList.contains('active'));
    assert.equal(subTab('display').classList.contains('active'), false);
    const m = await model();
    for (const id of [...idsIn('popup_list'), ...idsIn('popup_list_hidden')]) {
        assert.ok(['0', '2'].includes(String(m[id].type)), id);
    }
    assert.equal(idsIn('popup_list')[0], 'c_compose', 'position_compose 0.5 is not first');
    assert.ok(idsIn('popup_list').includes('prompt_rewrite_polite'));
    assert.equal(where('c_read').includes('popup_list'), false);
    assert.deepEqual(where('c_read'), ['context_list'], 'the context panel changed with the sub-tab');
    await ctx.click(subTab('display'));
});

k.test('exclusions', S_MO, 'internal special prompts and those of inactive features are not listed', () => {
    const ids = allIds();
    for (const id of [...INTERNAL_SPECIALS, ...INACTIVE_SPECIALS]) assert.equal(ids.has(id), false, id);
    for (const id of ACTIVE_SPECIALS) assert.ok(ids.has(id), id);
});

// ---- badges and the legend -------------------------------------------------------------------

k.test('badges', S_MO, 'each row: a type badge (Always / Reading / Composing) and a source badge (Default / Special / Custom)', async () => {
    const badges = li => [...li.querySelectorAll('.badge')];
    const check = (li, typeKey, sourceClass, sourceKey) => {
        const [type, source] = badges(li);
        assert.ok(type.classList.contains('badge_type'), li.dataset.id);
        assert.equal(type.textContent, msg(typeKey), li.dataset.id);
        assert.ok(source.classList.contains(sourceClass), li.dataset.id);
        assert.equal(source.textContent, msg(sourceKey), li.dataset.id);
    };
    check(rowIn('popup_list', 'prompt_reply'), 'menu_order_type_reading', 'badge_default', 'menu_order_badge_default');
    check(rowIn('popup_list', 'prompt_classify'), 'menu_order_type_always', 'badge_default', 'menu_order_badge_default');
    check(rowIn('context_list', 'prompt_summarize'), 'menu_order_type_reading', 'badge_special', 'menu_order_badge_special');
    check(rowIn('popup_list_hidden', 'c_hidden'), 'menu_order_type_always', 'badge_custom', 'menu_order_badge_custom');
    await ctx.click(subTab('compose'));
    check(rowIn('popup_list', 'c_compose'), 'menu_order_type_composing', 'badge_custom', 'menu_order_badge_custom');
    await ctx.click(subTab('display'));
});

k.test('legend', S_MO, '#badge_legend explains both badge groups with the same classes and labels', () => {
    const legend = $('#badge_legend');
    const swatches = [...legend.querySelectorAll('.badge')].map(b => [b.className, b.textContent]);
    assert.deepEqual(swatches, [
        ['badge badge_type', msg('menu_order_type_always')],
        ['badge badge_type', msg('menu_order_type_reading')],
        ['badge badge_type', msg('menu_order_type_composing')],
        ['badge badge_default', msg('menu_order_badge_default')],
        ['badge badge_special', msg('menu_order_badge_special')],
        ['badge badge_custom', msg('menu_order_badge_custom')],
    ]);
});

// ---- icons -----------------------------------------------------------------------------------

const preview = (list, id) => rowIn(list, id).querySelector('img.item_icon_preview');

k.test('icon-slot', S_ICONS, 'every row of every list has an icon slot: the built-in icon, or the empty one for a custom prompt', () => {
    for (const list of LISTS) for (const li of ctx.$$('#' + list + ' > li')) assert.ok(li.querySelector('img.item_icon_preview'), li.dataset.id);
    assert.equal(preview('popup_list', 'prompt_reply').getAttribute('src'), '../../' + builtInIcon('prompt_reply'));
    assert.equal(preview('context_list', 'prompt_summarize').getAttribute('src'), '../../' + builtInIcon('prompt_summarize'));
    const empty = preview('popup_list', 'c_read');
    assert.equal(empty.getAttribute('src'), '../../images/context_menu/custom/empty_icon.png');
    assert.ok(empty.classList.contains('item_icon_preview_empty'));
});

const popover = () => $('.icon_picker_popover');
const cells = () => [...popover().querySelectorAll('.icon_picker_cell')];

k.test('icon-popover-builtin', S_MO, 'the picker of a prompt with a built-in icon: a first "Default icon" cell previewing it, then the icon grid', async () => {
    await ctx.click(preview('popup_list', 'prompt_reply'));
    assert.ok(popover(), 'no picker');
    const none = cells()[0];
    assert.ok(none.classList.contains('icon_picker_cell_none'));
    assert.equal(none.title, msg('menu_order_icon_default'));
    assert.equal(none.querySelector('img').getAttribute('src'), '../../' + builtInIcon('prompt_reply'));
    assert.equal(none.querySelector('img').classList.contains('icon_picker_none_empty'), false);
    assert.ok(none.classList.contains('selected'), 'no custom icon, yet "Default" not selected');
    const files = cells().slice(1).map(c => c.querySelector('img').getAttribute('src').split('/').pop());
    assert.ok(files.length > 10, 'the icon grid is missing');
    assert.ok(files.includes('airport.png'));
    await ctx.fire(ctx.document, 'keydown', { key: 'Escape' });
    assert.equal(popover(), null, 'Esc did not close the picker');
});

k.test('icon-popover-custom', S_MO, 'the picker of a custom prompt: a first "No icon" cell with the greyscale placeholder', async () => {
    await ctx.click(preview('popup_list', 'c_read'));
    const none = cells()[0];
    assert.equal(none.title, msg('menu_order_icon_none'));
    assert.ok(none.querySelector('img').classList.contains('icon_picker_none_empty'));
    await ctx.fire(ctx.document.body, 'mousedown');
    assert.equal(popover(), null, 'an outside mousedown did not close the picker');
});

k.test('icon-pick', S_MO, 'picking an icon sets it on the row and marks the page unsaved, writing nothing', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click(preview('popup_list', 'c_read'));
    const cell = cells().find(c => c.querySelector('img').getAttribute('src').endsWith('/airport.png'));
    await ctx.click(cell);
    assert.equal(popover(), null);
    assert.equal(preview('popup_list', 'c_read').getAttribute('src'), '../../images/context_menu/custom/airport.png');
    assert.equal(preview('popup_list', 'c_read').classList.contains('item_icon_preview_empty'), false);
    assert.equal($('#btnSaveAll').disabled, false);
    assert.deepEqual(status(), { text: msg('customPrompts_unsaved_changes'), color: 'red' });
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('icon-other-panel', S_MO, 'the icon chosen in one panel shows in the other', () => {
    assert.equal(preview('context_list', 'c_read').getAttribute('src'), '../../images/context_menu/custom/airport.png');
});

k.test('unsaved-guard', S_GUARD, 'with a pending Save All, leaving the page asks first', () => {
    assert.equal(leaveBlocked(ctx), true);
});

k.test('icon-restore', S_ICONS, 'the first cell clears the custom icon: a special prompt gets its shipped icon back', async () => {
    await ctx.click(preview('context_list', 'prompt_summarize'));
    await ctx.click(cells().find(c => c.querySelector('img').getAttribute('src').endsWith('/clock.png')));
    assert.equal(preview('context_list', 'prompt_summarize').getAttribute('src'), '../../images/context_menu/custom/clock.png');
    await ctx.click(preview('context_list', 'prompt_summarize'));
    assert.equal(cells()[0].classList.contains('selected'), false);
    await ctx.click(cells()[0]);
    assert.equal(preview('context_list', 'prompt_summarize').getAttribute('src'), '../../' + builtInIcon('prompt_summarize'));
});

// ---- drag and drop ---------------------------------------------------------------------------

k.test('drag-indicator', S_MO, 'while dragging, the rows do not move: the dragged one is marked and the target shows an insertion line', async () => {
    const before = idsIn('popup_list');
    const li = rowIn('popup_list', 'prompt_classify');
    li.dispatchEvent(dragEvent('dragstart', -1));
    $('#popup_list').dispatchEvent(dragEvent('dragover', -1));
    await ctx.settle();
    assert.deepEqual(idsIn('popup_list'), before, 'the DOM moved before the drop');
    assert.ok(li.classList.contains('dragging'));
    assert.ok(ctx.$$('#popup_list > li')[0].classList.contains('drag-over'), 'no line on the target row');
    $('#popup_list').dispatchEvent(dragEvent('dragover', 1));
    await ctx.settle();
    assert.equal(ctx.$$('#popup_list .drag-over').length, 0, 'the previous line stayed');
    assert.ok(ctx.$$('#popup_list > li:not(.dragging)').at(-1).classList.contains('drag-over-end'));
    li.dispatchEvent(dragEvent('dragend', 1));    // released outside a list: nothing moves
    await ctx.settle();
    assert.deepEqual(idsIn('popup_list'), before);
    assert.equal(ctx.$$('#popup_list .drag-over, #popup_list .drag-over-end, #popup_list .dragging').length, 0);
});

k.test('show-hide-transitions', S_MO, 'dragging between Visible and Hidden walks the whole show_in table', async () => {
    // both -popup off-> context -context off-> none -context on-> context -popup on-> both
    //      -context off-> popup -popup off-> none -popup on-> popup -context on-> both
    const steps = [
        ['popup_list', 'popup_list_hidden', ['popup_list_hidden', 'context_list']],
        ['context_list', 'context_list_hidden', ['popup_list_hidden', 'context_list_hidden']],
        ['context_list_hidden', 'context_list', ['popup_list_hidden', 'context_list']],
        ['popup_list_hidden', 'popup_list', ['popup_list', 'context_list']],
        ['context_list', 'context_list_hidden', ['popup_list', 'context_list_hidden']],
        ['popup_list', 'popup_list_hidden', ['popup_list_hidden', 'context_list_hidden']],
        ['popup_list_hidden', 'popup_list', ['popup_list', 'context_list_hidden']],
        ['context_list_hidden', 'context_list', ['popup_list', 'context_list']],
    ];
    for (const [i, [from, to, expected]] of steps.entries()) {
        await drag(from, 'c_read', to);
        assert.deepEqual(where('c_read'), expected, 'step ' + (i + 1) + ': ' + from + ' -> ' + to);
    }
});

k.test('drop-position', S_MO, 'a row dropped into Visible keeps the place it was dropped at', async () => {
    await drag('popup_list', 'c_read', 'popup_list_hidden');
    await drag('popup_list_hidden', 'c_read', 'popup_list', 'top');
    assert.equal(idsIn('popup_list')[0], 'c_read');
});

k.test('reorder', S_MO, 'reordering inside Visible moves the row and marks the page unsaved', async () => {
    await drag('popup_list', 'prompt_classify', 'popup_list', 'end');
    assert.equal(idsIn('popup_list').at(-1), 'prompt_classify');
    await drag('context_list', 'prompt_translate_this', 'context_list', 'top');
    assert.equal(idsIn('context_list')[0], 'prompt_translate_this');
    assert.equal($('#btnSaveAll').disabled, false);
});

// ---- save ------------------------------------------------------------------------------------

k.test('save-error', S_MO, 'a Save All failing halfway says so in red, gives the button back and keeps the changes pending', async () => {
    const local = ctx.ctl.browser.storage.local;
    const realSet = local.set;
    // The built-ins' properties are written, the custom prompts are not.
    local.set = async function (items) {
        if ('_custom_prompt' in items) throw new Error('disk full');
        return realSet.call(this, items);
    };
    const popup = idsIn('popup_list');
    try {
        await ctx.click($('#btnSaveAll'));
        await new Promise(r => setTimeout(r, 300));     // past the reloader's 200 ms debounce
        await ctx.settle();
    } finally {
        local.set = realSet;
    }
    assert.ok($('#msgDisplay').textContent.startsWith(msg('menu_order_save_error')), $('#msgDisplay').textContent);
    assert.equal($('#msgDisplay').style.color, 'red');
    assert.equal($('#btnSaveAll').disabled, false, 'no way to try again');
    assert.equal(leaveBlocked(ctx), true);
    assert.deepEqual(idsIn('popup_list'), popup, 'the page reloaded over its pending changes');
});

let saved;

k.test('save-positions', S_MO, 'Save All stores the Visible order as positions 1, 2, 3…', async () => {
    const popup = idsIn('popup_list');
    const context = idsIn('context_list');
    const before = ctx.ctl.sent.length;
    await ctx.click($('#btnSaveAll'));
    saved = { ...ctx.ctl.localData() };
    saved.sent = ctx.ctl.sent.slice(before);
    const all = Object.fromEntries([
        ...Object.entries(saved._default_prompts_properties || {}),
        ...(saved._custom_prompt || []).map(p => [p.id, p]),
        ...(saved._special_prompts || []).map(p => [p.id, p]),
    ]);
    popup.forEach((id, i) => assert.equal(Number(all[id].position_display), i + 1, id + ' position_display'));
    context.forEach((id, i) => assert.equal(Number(all[id].position_context), i + 1, id + ' position_context'));
});

k.test('save-stores', S_MO, 'Save All splits the prompts into their three stores, show_in and icons included', () => {
    assert.deepEqual((saved._custom_prompt || []).map(p => p.id).sort(), ['c_compose', 'c_hidden', 'c_read']);
    const props = saved._default_prompts_properties || {};
    for (const id of ['prompt_reply', 'prompt_classify', 'prompt_this']) assert.ok(props[id], id);
    for (const id of Object.keys(props)) assert.ok(!id.startsWith('c_'), id);
    const c = (saved._custom_prompt || []).find(p => p.id === 'c_read');
    assert.equal(c.show_in, 'both');
    assert.equal(c.custom_icon, 'airport.png');
    assert.equal(c.text, 't', 'the prompt itself was lost');
});

k.test('save-preserves-excluded', S_MO, 'Save All writes the special prompts the page did not list back as they were', () => {
    const specials = Object.fromEntries((saved._special_prompts || []).map(p => [p.id, p]));
    for (const id of [...ACTIVE_SPECIALS, ...INACTIVE_SPECIALS, ...INTERNAL_SPECIALS]) assert.ok(specials[id], id + ' lost');
    assert.equal(specials.prompt_summarize_email_template.show_in, 'none');
    assert.equal(specials.prompt_spamfilter.show_in, 'context');
    assert.equal(specials.prompt_summarize.custom_icon, '');
});

k.test('save-state', S_MO, 'after Save All: reload_menus sent, the saved status in green, the button disabled, leaving free', () => {
    assert.ok(saved.sent.some(m => m.command === 'reload_menus'));
    assert.equal($('#btnSaveAll').disabled, true);
    assert.equal(leaveBlocked(ctx), false);
});

k.test('drag-marks-unsaved', S_MO, 'a drag released outside any list, and a reorder inside Hidden, mark the page unsaved', async () => {
    assert.equal($('#btnSaveAll').disabled, true, 'precondition: nothing pending');
    const before = idsIn('popup_list');
    const li = rowIn('popup_list', 'prompt_reply');
    li.dispatchEvent(dragEvent('dragstart', -1));
    li.dispatchEvent(dragEvent('dragend', -1));
    await ctx.settle();
    assert.deepEqual(idsIn('popup_list'), before);
    assert.equal($('#btnSaveAll').disabled, false, 'outside any list');
    await ctx.click($('#btnSaveAll'));
    assert.equal($('#btnSaveAll').disabled, true);
    const hiddenRow = ctx.$$('#popup_list_hidden > li').at(-1).dataset.id;
    await drag('popup_list_hidden', hiddenRow, 'popup_list_hidden', 'top');
    assert.equal($('#btnSaveAll').disabled, false, 'inside Hidden');
    await ctx.click($('#btnSaveAll'));
});

// ---- Reset all -------------------------------------------------------------------------------

k.test('reset-in-memory', S_MO, 'Reset all asks nothing, writes nothing, and marks the page unsaved', async () => {
    const since = ctx.ctl.calls.length;
    const dialogs = ctx.dialogs.length;
    await ctx.click($('#btnResetAll'));
    assert.equal(ctx.dialogs.length, dialogs);
    assert.deepEqual(ctx.localWrites(since), []);
    assert.equal($('#btnSaveAll').disabled, false);
    assert.deepEqual(status(), { text: msg('customPrompts_unsaved_changes'), color: 'red' });
});

k.test('reset-factory', S_MO, 'Reset all: factory visibility and icons, specials first then the others, alphabetically', async () => {
    assert.equal(preview('popup_list', 'c_read').getAttribute('src'), '../../images/context_menu/custom/empty_icon.png', 'icon kept');
    assert.deepEqual(where('c_read'), ['popup_list', 'context_list_hidden'], 'a custom prompt goes back to the popup');
    assert.deepEqual(where('prompt_summarize'), ['popup_list_hidden', 'context_list'], 'summarize goes back to the context menu only');
    assert.deepEqual(where('prompt_add_tags'), ['popup_list', 'context_list']);
    const names = ctx.$$('#context_list > li').map(nameOf);
    const specials = ctx.$$('#context_list > li').filter(li => li.querySelector('.badge_special')).map(nameOf);
    assert.deepEqual(names.slice(0, specials.length), [...specials].sort((a, b) => a.localeCompare(b)));
    const popupNames = ctx.$$('#popup_list > li').filter(li => !li.querySelector('.badge_special')).map(nameOf);
    assert.deepEqual(popupNames, [...popupNames].sort((a, b) => a.localeCompare(b)));
});

k.test('reset-saved', S_MO, 'after Reset all, Save All stores equal positions for the three keys', async () => {
    await ctx.click($('#btnSaveAll'));
    const props = ctx.ctl.localData()._default_prompts_properties;
    for (const [id, p] of Object.entries(props)) {
        assert.equal(Number(p.position_display), Number(p.position_compose), id);
        assert.equal(Number(p.position_display), Number(p.position_context), id);
    }
    const c = ctx.ctl.localData()._custom_prompt.find(p => p.id === 'c_read');
    assert.equal(c.show_in, 'popup');
    assert.equal(c.custom_icon, '');
});

// ---- the cross-tab reload --------------------------------------------------------------------

k.test('cross-tab-unrelated', S_MO, 'a change to another key does not reload the page or drop its pending changes', async () => {
    await drag('popup_list', 'prompt_reply', 'popup_list', 'end');
    await ctx.ctl.browser.storage.local.set({ some_other_pref: 1 });
    await ctx.settle();
    assert.equal($('#btnSaveAll').disabled, false);
    assert.equal(idsIn('popup_list').at(-1), 'prompt_reply');
});

k.test('cross-tab-reload', S_MO, 'a prompt store written elsewhere reloads the page, discarding its unsaved changes', async () => {
    const custom = ctx.ctl.localData()._custom_prompt.map(p => p.id === 'c_hidden' ? { ...p, name: 'Renamed elsewhere' } : p);
    await ctx.ctl.browser.storage.local.set({ _custom_prompt: custom });
    await ctx.settle();
    assert.equal(nameOf(ctx.$$('li[data-id="c_hidden"]')[0]), 'Renamed elsewhere');
    assert.notEqual(idsIn('popup_list').at(-1), 'prompt_reply', 'the unsaved reorder survived');
    assert.equal($('#btnSaveAll').disabled, true);
    assert.equal($('#msgDisplay').textContent, '');
    assert.equal(leaveBlocked(ctx), false);
});

// ---- the "Menu position" deep-link -----------------------------------------------------------

const highlighted = () => ctx.$$('.sortable_item.mzta_highlight').map(li => li.parentElement.id + ':' + li.dataset.id);

k.test('deeplink-discards-pending', S_MO, 'the deep-link reload drops the pending changes and the dirty state with them', async () => {
    const before = idsIn('popup_list');
    await drag('popup_list', before[0], 'popup_list', 'end');
    assert.equal($('#btnSaveAll').disabled, false);
    await ctx.ctl.dispatchMessage({ command: 'menu_order_highlight', promptId: 'prompt_classify' }, {});
    await ctx.settle();
    assert.deepEqual(idsIn('popup_list'), before, 'the pending reorder survived the reload');
    assert.equal($('#btnSaveAll').disabled, true);
    assert.equal($('#msgDisplay').textContent, '');
    assert.equal(leaveBlocked(ctx), false, 'still warning about changes thrown away');
});

k.test('deeplink-all-instances', S_MO, 'menu_order_highlight highlights every instance of the prompt, in both panels', async () => {
    await ctx.ctl.dispatchMessage({ command: 'menu_order_highlight', promptId: 'prompt_classify' }, {});
    await ctx.settle();
    assert.deepEqual(highlighted().sort(), ['context_list_hidden:prompt_classify', 'popup_list:prompt_classify']);
});

k.test('deeplink-tab-dot', S_MO, 'a type-0 prompt also in the other sub-tab puts a dot on it, with its tooltip', () => {
    assert.ok(subTab('compose').classList.contains('mzta_has_target'));
    assert.equal(subTab('compose').title, msg('menu_order_tab_dot_tooltip'));
    assert.equal(subTab('display').classList.contains('mzta_has_target'), false);
});

k.test('deeplink-persists', S_MO, 'the highlight survives a sub-tab switch and a re-render', async () => {
    await ctx.click(subTab('compose'));
    assert.ok(highlighted().includes('popup_list:prompt_classify'));
    assert.ok(subTab('display').classList.contains('mzta_has_target'), 'the dot did not move to the other tab');
    await ctx.click(subTab('display'));
    assert.ok(highlighted().includes('popup_list:prompt_classify'));
});

k.test('deeplink-switch', S_MO, 'a composing-only target switches the popup panel to Composing', async () => {
    await ctx.ctl.dispatchMessage({ command: 'menu_order_highlight', promptId: 'c_compose' }, {});
    await ctx.settle();
    assert.ok(subTab('compose').classList.contains('active'));
    assert.deepEqual(highlighted(), ['popup_list:c_compose']);
    assert.equal(ctx.$$('.sub_tab.mzta_has_target').length, 0, 'a dot for a prompt not in the other view');
});

k.test('drag-clears-highlight', S_MO, 'a drag start ends the deep-link highlight', async () => {
    assert.ok(highlighted().length > 0, 'no highlight to clear');
    const li = ctx.$$('#popup_list > li')[0];
    li.dispatchEvent(dragEvent('dragstart', -1));
    li.dispatchEvent(dragEvent('dragend', -1));
    await ctx.settle();
    assert.deepEqual(highlighted(), []);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
