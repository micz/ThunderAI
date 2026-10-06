// The popup opened on a message (reading view) by a ChatGPT Web user who has not granted the
// chatgpt.com permission, while a batch is running, no policy.
//
// Spec 02 "Popup Menu" (filtered by `show_in` and by the reading types 0 + 1, ordered by
// `position_display`, special prompts styled like the others, the icon slot always rendered and
// blank without an icon). Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Popup
// menu" (`chatgpt_web` is always configured) and "Blue wizard banner vs. red permission banner"
// (the chosen provider's red banner). Spec 04 "Batch cancellation (user-triggered stop)" ("Popup payload": the
// "Stop processing — N processed" banner, `batch_status` polled every ~1 s while working).
//
// The background's answers are given with openPage({ commands }): `popup_menu_ready` (the
// payload preparePopupMenu() builds) and `batch_status` (one more message, then idle, which
// also stops the page's polling interval so the process can exit).

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

k.test('filtered', S_POPUP, 'only prompts shown in the popup (`popup` / `both`) of the reading types 0 + 1 are listed', () => {
    assert.deepEqual(rows().map(r => r.dataset.id).sort(), ['first', 'late', 'special']);
});

k.test('ordered', S_POPUP, 'the reading view is ordered by `position_display`', () => {
    assert.deepEqual(rows().map(r => r.dataset.id), ['first', 'special', 'late']);
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

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
