// The popup opened on a message (reading view) by a ChatGPT Web user who has not granted the
// chatgpt.com permission, while a batch is running, no policy.
//
// Spec 02 "Popup Menu" (filtered by `show_in` and by the reading types 0 + 1, ordered by
// `position_display`, special prompts styled like the others, the icon slot always rendered and
// blank without an icon; no `show_in` counting as `popup`; labels decoded as text; the search, the number prefixes, the keyboard and selecting vs.
// running with `dynamic_menu_force_enter` off; the red banner in place of the search box and
// its click). Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Popup
// menu" (`chatgpt_web` is always configured) and "Blue wizard banner vs. red permission banner"
// (the chosen provider's red banner). Spec 04 "Batch cancellation (user-triggered stop)" ("Popup payload": the
// "Stop processing — N processed" banner, `batch_status` polled every ~1 s while working).
//
// The background's answers are given with openPage({ commands }): `popup_menu_ready` (the
// payload preparePopupMenu() builds), `batch_status` (one more message, then idle, which
// also stops the page's polling interval so the process can exit) and `shortcut_do_prompt`.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { until } from '../../ui/dom-helpers.mjs';

const ICON = 'moz-extension:images/context_menu/proofread.png';
const PROMPTS = [
    { id: 'late', label: 'Late', type: '1', show_in: 'popup', position_display: 3, position_compose: 1, custom_icon: '' },
    { id: 'first', label: 'First', type: '0', show_in: 'both', position_display: 1, position_compose: 9, custom_icon: ICON },
    { id: 'special', label: 'Special', type: '1', show_in: 'both', is_special: true, position_display: 2, position_compose: 2,
      custom_icon: 'moz-extension:images/context_menu/summarize.png' },
    { id: 'context_only', label: 'Context only', type: '0', show_in: 'context', position_display: 2, custom_icon: '' },
    { id: 'nowhere', label: 'Nowhere', type: '0', show_in: 'none', position_display: 2, custom_icon: '' },
    { id: 'compose_only', label: 'Compose only', type: '2', show_in: 'popup', position_display: 2, custom_icon: '' },
    // no show_in (counts as popup), a label with entities
    { id: 'unset', label: 'R&amp;D &lt;x&gt;', type: '0', position_display: 4, position_compose: 4, custom_icon: '' },
];
const statuses = [{ working: true, processed: 5, cancelRequested: false }, { working: false, processed: 0, cancelRequested: false }];

const ctx = await openPage('popup', {
    local: { connection_type: 'chatgpt_web' },
    permissions: { contains: () => false },
    commands: {
        popup_menu_ready: () => ({
            batchStatus: { working: true, processed: 3, cancelRequested: false },
            lastShortcutTabId: 7,
            lastShortcutTabType: 'mail',
            lastShortcutFiltering: 1,
            lastShortcutPromptsData: structuredClone(PROMPTS),
        }),
        batch_status: () => statuses.length > 1 ? statuses.shift() : statuses[0],
        shortcut_do_prompt: () => true,
    },
});
after(() => ctx.close());
const k = uiTests('popup', '03');
const $ = ctx.$;

const S_POPUP = 'spec 02 "Popup Menu"';
const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const S_BATCH = 'spec 04 "Batch cancellation (user-triggered stop)"';

const rows = () => ctx.$$('#mzta_autocomplete-items .mzta_autocomplete-item');
const rowOf = id => rows().find(r => r.dataset.id === id);
const asked = command => ctx.apiCalls('browser.runtime.sendMessage').filter(c => c.args[0]?.command === command);

k.test('web-configured', S_WIZ, 'ChatGPT Web counts as configured: the prompt list is requested, no wizard invitation', () => {
    assert.equal(asked('popup_menu_ready').length, 1);
    assert.notEqual($('#setup_wizard_prompt').style.display, 'block');
});

k.test('red-banner', S_WIZ, 'the chosen provider\'s red permission banner is shown, the other two are not', () => {
    assert.equal($('#ask_chatgpt_web_perm').style.display, 'block');
    assert.notEqual($('#ask_anthropic_api_perm').style.display, 'block');
    assert.notEqual($('#ask_openai_api_perm').style.display, 'block');
});

k.test('red-banner-replaces-search', S_POPUP, 'the red banner takes the search box\'s place', () => {
    assert.equal($('#mzta_search_banner').style.display, 'none');
});

k.test('red-banner-click', S_POPUP, 'a click on it opens the welcome page, where the permission is granted', async () => {
    await ctx.click($('#ask_chatgpt_web_perm'));
    const opened = ctx.apiCalls('browser.tabs.create');
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /pages\/onboarding\/onboarding\.html$/);
});

k.test('filtered', S_POPUP, 'only prompts shown in the popup (`popup` / `both` / none) of the reading types 0 + 1 are listed', () => {
    assert.deepEqual(rows().map(r => r.dataset.id).sort(), ['first', 'late', 'special', 'unset']);
});

k.test('ordered', S_POPUP, 'the reading view is ordered by `position_display`', () => {
    assert.deepEqual(rows().map(r => r.dataset.id), ['first', 'special', 'late', 'unset']);
});

k.test('label-decoded', S_POPUP, 'a label\'s entities are decoded as text, never as markup', () => {
    const label = rowOf('unset').querySelector('.mzta_item_label');
    assert.equal(label.textContent, '4. R&D <x>');
    assert.equal(label.children.length, 0);
});

k.test('special-plain', S_POPUP, 'a special prompt gets no distinct treatment: its row is built like the others', () => {
    const shape = r => [r.className, ...[...r.children].map(c => c.tagName + '.' + [...c.classList].filter(x => x !== 'mzta_item_icon_empty').join('.'))].join('|');
    assert.equal(shape(rowOf('special')), shape(rowOf('first')));
});

k.test('icons', S_POPUP, 'each row shows its resolved icon; without one the 16px slot is still rendered, blank', () => {
    const icon = r => r.querySelector('img.mzta_item_icon');
    assert.equal(new URL(icon(rowOf('first')).src).pathname, '/images/context_menu/proofread.png');
    assert.equal(new URL(icon(rowOf('special')).src).pathname, '/images/context_menu/summarize.png');
    const blank = icon(rowOf('late'));
    assert.ok(blank, 'no icon slot');
    assert.equal(blank.classList.contains('mzta_item_icon_empty'), true);
    assert.equal(blank.hasAttribute('src'), false);
});

k.test('batch-banner', S_BATCH, 'a running batch shows the "Stop processing" banner with the processed count', () => {
    assert.equal($('#mzta_batch_stop').style.display, 'block');
    assert.equal($('#mzta_batch_stop_btn').textContent, msg('batch_stop_processing'));
    assert.equal($('#mzta_batch_progress').textContent, msg('batch_progress_x', ['3']));
});

k.test('batch-polled', S_BATCH, 'while open the popup polls `batch_status` (~1 s) and updates the count', async () => {
    await until(ctx, () => $('#mzta_batch_progress').textContent === msg('batch_progress_x', ['5']), 'the first poll', 3000);
    assert.equal(asked('batch_status').length, 1);
});

k.test('batch-ended', S_BATCH, 'once the batch is over the banner goes away', async () => {
    await until(ctx, () => $('#mzta_batch_stop').style.display === 'none', 'the banner to hide', 3000);
    assert.equal(asked('batch_status').length, 2);
});

// ---- search and keyboard (after the batch: no poll can interleave) -----------------------

const input = () => $('#mzta_search_input');
const list = () => $('#mzta_autocomplete-items');
const labels = () => rows().map(r => r.querySelector('.mzta_item_label').textContent);
const type = async text => { input().value = text; await ctx.fire(input(), 'input'); };
const key = k => ctx.fire(input(), 'keydown', { key: k });
const active = () => rows().filter(r => r.classList.contains('mzta_autocomplete-item-active')).map(r => r.dataset.id);
const runs = () => asked('shortcut_do_prompt').map(c => c.args[0]);

k.test('prefixes', S_POPUP, 'the rows are prefixed with their number shortcut', () => {
    assert.deepEqual(labels(), ['1. First', '2. Special', '3. Late', '4. R&D <x>']);
});

k.test('search', S_POPUP, 'typing keeps the labels containing the trimmed text, case-insensitively, renumbered', async () => {
    await type('  A ');
    assert.deepEqual(rows().map(r => r.dataset.id), ['special', 'late']);
    assert.deepEqual(labels(), ['1. Special', '2. Late']);
    assert.notEqual(list().style.display, 'none');
});

k.test('search-none', S_POPUP, 'no match hides the list', async () => {
    await type('zzz');
    assert.deepEqual(rows(), []);
    assert.equal(list().style.display, 'none');
    await type('');
    assert.equal(rows().length, 4);
});

k.test('search-decoded', S_POPUP, 'the search matches the decoded label', async () => {
    await type('&d <');
    assert.deepEqual(rows().map(r => r.dataset.id), ['unset']);
    await type('');
});

k.test('arrows-wrap', S_POPUP, 'the arrows move the highlight, wrapping at both ends', async () => {
    await key('ArrowUp');
    assert.deepEqual(active(), ['unset']);
    await key('ArrowDown');
    assert.deepEqual(active(), ['first']);
    await key('ArrowDown');
    assert.deepEqual(active(), ['special']);
});

k.test('enter-selects', S_POPUP, 'Enter selects the highlighted row: its label in the box, the list closed, nothing run', async () => {
    await key('Enter');
    assert.equal(input().value, 'Special');
    assert.equal(list().style.display, 'none');
    assert.deepEqual(runs(), []);
});

k.test('enter-runs', S_POPUP, 'a second Enter runs it with the popup\'s tab and closes the popup', async () => {
    await key('Enter');
    assert.deepEqual(runs(), [{ command: 'shortcut_do_prompt', tabId: 7, promptId: 'special' }]);
    assert.equal(ctx.dialogs.filter(d => d.kind === 'close').length, 1);
});

k.test('enter-first', S_POPUP, 'with nothing highlighted Enter selects the first row', async () => {
    await type('');
    await key('Enter');
    assert.equal(input().value, 'First');
    assert.equal(runs().length, 1, 'selecting ran the prompt');
});

k.test('digit-selects', S_POPUP, 'a digit selects its row without running it (`dynamic_menu_force_enter` off)', async () => {
    await type('');
    await key('3');
    assert.equal(input().value, 'Late');
    assert.equal(list().style.display, 'none');
    assert.equal(runs().length, 1);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
