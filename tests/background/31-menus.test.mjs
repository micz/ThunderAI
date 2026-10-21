// Spec 02 "Menu System", what the background builds (js/mzta-menus.js, started by the background's
// own `await menus.loadMenus(await _computeActiveSpecialIds())`):
//
// "Context Menu":
//  - built from every prompt with show_in "context" or "both", reading types only (type 0 or 1);
//  - a "ThunderAI" submenu in the message_list context;
//  - ordered by position_context (alphabetical only when positions are equal);
//  - special prompts (add_tags, spamfilter, summarize, translate) route through processEmails();
//  - icons from getContextMenuIcon(): a user-chosen custom_icon first, else the built-in icon;
//    a prompt with no icon gets none (menuOpts.icons left unset).
// "Popup Menu" (the background side - what the popup is handed): every reachable prompt, its
// label resolved, its show_in ("popup" when it has none), type, positions and icon (custom_icon,
// resolved by getContextMenuIcon()); the popup filters by show_in and tab type itself (ui area).
// preparePopupMenu(tab): lastShortcutTabId / lastShortcutTabType / lastShortcutPromptsData /
// lastShortcutFiltering (1 reading, 2 composing, 0 neither) and batchStatus (spec 04 "Popup
// payload"); popup_menu_ready answers it for the active tab, nothing when there is no tab.
// "Special Prompt Visibility Dependencies": a special prompt is in the menus only when its
// feature is on and its connection can drive an API; show_in "none" (or a hidden built-in
// fragment such as the summary template) is in no menu.
// Spec 01 "Background Preference Snapshot and Menu Invalidation": loadShortcutMenu() swaps the
// new list in at the end, so preparePopupMenu() never reads an empty list mid-rebuild.
// The managed branches (organization prompts in the menus) belong to the managed area.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    record,
    assertClean
} from './flows.mjs';
import { menuItems } from './apis.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';

const custom = (id, o) => ({ id, name: o.name ?? id, text: 'Do ' + id, type: o.type ?? '0', action: '0', is_default: '0', is_special: '0', need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', ...o });
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_display_mode: 'inline',
        translate: false,
        spamfilter: true,
        add_tags: false,
        _custom_prompt: [
            custom('c_both', { name: 'Zeta both', show_in: 'both', position_context: 2 }),
            custom('c_ctx', { name: 'Alpha context', show_in: 'context', type: '1', position_context: 1 }),
            custom('c_tie_b', { name: 'Bravo tie', show_in: 'context', position_context: 5 }),
            custom('c_tie_a', { name: 'Able tie', show_in: 'context', position_context: 5 }),
            custom('c_compose', { name: 'Compose only', show_in: 'both', type: '2', position_context: 3 }),
            custom('c_popup', { name: 'Popup only', show_in: 'popup' }),
            custom('c_none', { name: 'Hidden', show_in: 'none' }),
            custom('c_noshow', { name: 'No show_in' }),
            custom('c_icon', { name: 'With icon', show_in: 'context', position_context: 9, custom_icon: 'clock.png' }),
        ],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 11, type: 'messageCompose', windowId: 5 });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('31-menus');
const items = () => menuItems(ctx.m);
const children = () => items().filter(i => i.parentId === 'mzta-context-parent');
const shortcut = () => ctx.bg.$eval('menus').shortcutMenu;
const entry = id => shortcut().find(e => e.id === id);

k.test('context-parent', 'the context menu is a "ThunderAI" submenu of the message list', () => {
    const parent = items().find(i => i.id === 'mzta-context-parent');
    assert.ok(parent);
    assert.equal(parent.title, 'ThunderAI');
    assert.deepEqual(parent.contexts, ['message_list']);
    for (const c of children()) assert.deepEqual(c.contexts, ['message_list'], c.id);
});

k.test('context-show-in', 'the context menu holds the prompts shown in "context" or "both", and no other', () => {
    const ids = children().map(c => c.id.replace('mzta-ctx-', ''));
    for (const id of ['c_both', 'c_ctx', 'c_tie_a', 'c_tie_b', 'c_icon']) assert.ok(ids.includes(id), id);
    for (const id of ['c_popup', 'c_none', 'c_noshow']) assert.equal(ids.includes(id), false, id);
});

k.test('context-reading-only', 'a composing-only prompt (type 2) is never in the context menu', () => {
    assert.equal(children().some(c => c.id === 'mzta-ctx-c_compose'), false);
});

k.test('context-order', 'the context menu is ordered by position_context, alphabetically on equal positions', () => {
    const custom_ids = children().map(c => c.id.replace('mzta-ctx-', '')).filter(id => id.startsWith('c_'));
    assert.deepEqual(custom_ids, ['c_ctx', 'c_both', 'c_tie_a', 'c_tie_b', 'c_icon']);
});

k.test('context-specials', 'an active special prompt shown in the context (spam filter, summarize) is there; an inactive one (translate) is not', () => {
    const ids = children().map(c => c.id);
    assert.ok(ids.includes('mzta-ctx-prompt_spamfilter'));
    assert.ok(ids.includes('mzta-ctx-prompt_summarize'));
    assert.equal(ids.includes('mzta-ctx-prompt_translate_this'), false, 'translate is off');
    assert.equal(ids.includes('mzta-ctx-prompt_add_tags'), false, 'add_tags is off');
});

k.test('context-icons', 'icons: a custom_icon wins, a special prompt has its built-in icon, a prompt with none gets none', () => {
    const byId = Object.fromEntries(children().map(c => [c.id, c]));
    assert.equal(byId['mzta-ctx-c_icon'].icons, 'moz-extension:images/context_menu/custom/clock.png');
    assert.equal(byId['mzta-ctx-prompt_summarize'].icons, 'moz-extension:images/context_menu/summarize.png');
    assert.equal(byId['mzta-ctx-c_both'].icons, null, 'no icons property at all');
});

k.test('context-titles', 'context items are titled with the prompt\'s resolved name', () => {
    const byId = Object.fromEntries(children().map(c => [c.id, c]));
    assert.equal(byId['mzta-ctx-c_both'].title, 'Zeta both');
    assert.equal(byId['mzta-ctx-prompt_summarize'].title, ctx.ctl.browser.i18n.getMessage('prompt_summarize'));
});

k.test('popup-list', 'the popup is handed every reachable prompt, and none hidden with show_in "none"', () => {
    const ids = shortcut().map(e => e.id);
    for (const id of ['c_both', 'c_ctx', 'c_compose', 'c_popup', 'c_noshow', 'prompt_reply', 'prompt_summarize']) assert.ok(ids.includes(id), id);
    assert.equal(ids.includes('c_none'), false);
    assert.equal(ids.includes('prompt_summarize_email_template'), false, 'a hidden built-in fragment');
    assert.equal(ids.includes('prompt_translate_this'), false, 'an inactive special prompt');
});

k.test('popup-entry', 'a popup entry carries the resolved label, type, show_in ("popup" when absent), positions and icon', () => {
    const e = entry('c_noshow');
    assert.equal(e.label, 'No show_in');
    assert.equal(e.show_in, 'popup');
    assert.equal(String(e.type), '0');
    assert.equal(entry('c_icon').custom_icon, 'moz-extension:images/context_menu/custom/clock.png');
    assert.equal(entry('prompt_reply').custom_icon, 'moz-extension:images/context_menu/prompt_reply.png');
    assert.equal(entry('c_both').custom_icon, '');
    assert.equal(entry('c_both').position_context, 2);
    assert.equal(entry('prompt_reply').label, ctx.ctl.browser.i18n.getMessage('prompt_reply'));
});

k.test('popup-ready-mail', 'popup_menu_ready, from a mail tab: reading filter, the prompt list and the batch status', async () => {
    const out = await ctx.ctl.dispatchMessage({ command: 'popup_menu_ready' }, SENDERS.popup);
    assert.equal(out.lastShortcutTabId, 7);
    assert.equal(out.lastShortcutTabType, 'mail');
    assert.equal(out.lastShortcutFiltering, 1);
    assert.deepEqual(out.lastShortcutPromptsData.map(e => e.id), shortcut().map(e => e.id));
    assert.deepEqual(out.batchStatus, { working: false, processed: 0, cancelRequested: false, cancelReason: null });
});

k.test('prepare-filtering', 'preparePopupMenu(): 1 for a reading tab, 2 for a compose tab, 0 for any other', () => {
    assert.equal(ctx.bg.preparePopupMenu({ id: 3, type: 'messageDisplay' }).lastShortcutFiltering, 1);
    assert.equal(ctx.bg.preparePopupMenu({ id: 11, type: 'messageCompose' }).lastShortcutFiltering, 2);
    assert.equal(ctx.bg.preparePopupMenu({ id: 4, type: 'content' }).lastShortcutFiltering, 0);
});

k.test('popup-ready-no-tab', 'popup_menu_ready with no tab ready answers nothing usable', async () => {
    const saved = ctx.m.tabs.splice(0);
    const out = await ctx.ctl.dispatchMessage({ command: 'popup_menu_ready' }, SENDERS.popup);
    ctx.m.tabs.push(...saved);
    assert.equal(out, false);
});

k.test('shortcut-special', 'the popup running a special prompt (shortcut_do_prompt) acts on the message its tab displays', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'sc1@x' });
    ctx.m.tab(7).displayed = h.id;
    await ctx.ctl.dispatchMessage({ command: 'shortcut_do_prompt', tabId: 7, promptId: 'prompt_summarize' }, SENDERS.popup);
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    assert.ok(record(ctx, 'sc1@x')?.summary, 'summarized');
    assert.ok(ctx.m.sentTo(7, 'showSummary').length > 0, 'inline, in that tab');
});

k.test('rebuild-keeps-popup-list', 'during a rebuild the popup keeps reading the previous complete list, never an empty one', async () => {
    const menus = ctx.bg.$eval('menus');
    const before = menus.shortcutMenu;
    const rebuild = ctx.bg._reload_menus();
    assert.equal(menus.shortcutMenu, before, 'not cleared when the rebuild starts');
    assert.ok(ctx.bg.preparePopupMenu({ id: 7, type: 'mail' }).lastShortcutPromptsData.length > 0);
    await rebuild;
    assert.notEqual(menus.shortcutMenu, before, 'swapped in at the end');
    assert.deepEqual(menus.shortcutMenu.map(e => e.id), before.map(e => e.id));
});

k.test('rebuild-same-items', 'a rebuild recreates the same context items, with no duplicate id', async () => {
    const before = items().map(i => i.id);
    await ctx.bg._reload_menus();
    assert.deepEqual(items().map(i => i.id), before);
    assert.deepEqual(ctx.m.menuErrors, []);
});

k.test('no-context-prompts', 'with no prompt for the context menu, there is no ThunderAI submenu at all', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ctx.ctl.browser.storage.local.set({ _custom_prompt: [custom('only_popup', { show_in: 'popup' })], spamfilter: false, summarize: false });
    // Not through the debounced listener: the rebuild itself is under test here.
    await ctx.bg._reload_menus();
    assert.equal(items().some(i => i.id === 'mzta-context-parent'), false, JSON.stringify(items()));
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
