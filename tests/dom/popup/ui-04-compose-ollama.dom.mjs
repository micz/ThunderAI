// The popup opened in a compose window by an Ollama user (host set, no key), while a batch is
// running, no policy.
//
// Spec 02 "Popup Menu" (the compose types 0 + 2, ordered by `position_compose`; the number
// prefixes up to the tenth row; with `dynamic_menu_force_enter` on, a digit runs the prompt). Spec 05 "Setup
// Wizard (`pages/setup-wizard/`)", entry point "Popup menu" (for Ollama the required credential
// is the host). Spec 04 "Batch cancellation (user-triggered stop)" (the "Stop processing" button
// disables and relabels itself, sends `cancel_batch` and closes the popup). Spec 01 "Data Flow: User Action → AI Response" (the popup handles the
// selection and hands it to the background with the tab it was opened on: `shortcut_do_prompt`).
//
// The background's answers are given with openPage({ commands }). Clicking "Stop processing"
// also clears the page's polling interval, so the process can exit.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const PROMPTS = [
    { id: 'compose_two', label: 'Compose two', type: '2', show_in: 'popup', position_display: 1, position_compose: 2, custom_icon: '' },
    { id: 'any_one', label: 'Any one', type: '0', show_in: 'both', position_display: 5, position_compose: 1, custom_icon: '' },
    { id: 'reading_only', label: 'Reading only', type: '1', show_in: 'popup', position_display: 2, position_compose: 3, custom_icon: '' },
    // ten more, so the list goes past the tenth row
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'extra_' + i, label: 'Extra ' + i, type: '0', show_in: 'popup',
        position_display: 10 + i, position_compose: 10 + i, custom_icon: '' })),
];
const EXTRAS = Array.from({ length: 10 }, (_, i) => 'extra_' + i);

const ctx = await openPage('popup', {
    local: { connection_type: 'ollama_api', ollama_host: 'http://ollama.example:11434', ollama_api_key: '',
        dynamic_menu_force_enter: true },
    commands: {
        popup_menu_ready: () => ({
            batchStatus: { working: true, processed: 1, cancelRequested: false },
            lastShortcutTabId: 42,
            lastShortcutTabType: 'messageCompose',
            lastShortcutFiltering: 2,
            lastShortcutPromptsData: structuredClone(PROMPTS),
        }),
        batch_status: () => ({ working: true, processed: 1, cancelRequested: false }),
        cancel_batch: () => ({ ok: true }),
        shortcut_do_prompt: () => true,
    },
});
after(() => ctx.close());
const k = uiTests('popup', '04');
const $ = ctx.$;

const S_POPUP = 'spec 02 "Popup Menu"';
const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const S_BATCH = 'spec 04 "Batch cancellation (user-triggered stop)"';
const S_FLOW = 'spec 01 "Data Flow: User Action → AI Response"';

const rows = () => ctx.$$('#mzta_autocomplete-items .mzta_autocomplete-item');
const sent = command => ctx.apiCalls('browser.runtime.sendMessage').map(c => c.args[0]).filter(m => m?.command === command);

k.test('host-configured', S_WIZ, 'Ollama with a host (and no key) is configured: the prompt list, no invitation', () => {
    assert.equal(sent('popup_menu_ready').length, 1);
    assert.notEqual($('#setup_wizard_prompt').style.display, 'block');
});

k.test('compose-filtered-ordered', S_POPUP, 'the compose view lists types 0 + 2 only, by `position_compose`', () => {
    assert.deepEqual(rows().map(r => r.dataset.id), ['any_one', 'compose_two', ...EXTRAS]);
});

k.test('prefix-tenth', S_POPUP, 'rows 1-9 are prefixed "1. "-"9. ", the tenth "0. ", the later ones nothing', () => {
    const labels = rows().map(r => r.querySelector('.mzta_item_label').textContent);
    assert.equal(labels[0], '1. Any one');
    assert.equal(labels[8], '9. Extra 6');
    assert.equal(labels[9], '0. Extra 7');
    assert.deepEqual(labels.slice(10), ['Extra 8', 'Extra 9']);
});

k.test('digit-runs', S_POPUP, 'with `dynamic_menu_force_enter` on, a digit runs its row at once', async () => {
    await ctx.fire($('#mzta_search_input'), 'keydown', { key: '0' });
    assert.deepEqual(sent('shortcut_do_prompt'), [{ command: 'shortcut_do_prompt', tabId: 42, promptId: 'extra_7' }]);
});

k.test('select-sends', S_FLOW, 'choosing a prompt hands it to the background with the popup\'s tab', async () => {
    const row = rows().find(r => r.dataset.id === 'compose_two');
    await ctx.fire(row, 'mousedown');
    assert.deepEqual(sent('shortcut_do_prompt').at(-1), { command: 'shortcut_do_prompt', tabId: 42, promptId: 'compose_two' });
});

k.test('stop-sends-cancel', S_BATCH, '"Stop processing" disables and relabels itself, requests the cancellation, closes the popup', async () => {
    assert.equal($('#mzta_batch_stop').style.display, 'block');
    const closes = ctx.dialogs.filter(d => d.kind === 'close').length;
    await ctx.click($('#mzta_batch_stop_btn'));
    assert.equal(sent('cancel_batch').length, 1);
    assert.equal($('#mzta_batch_stop_btn').disabled, true);
    assert.equal($('#mzta_batch_stop_btn').textContent, msg('batch_stopping'));
    assert.equal(ctx.dialogs.filter(d => d.kind === 'close').length, closes + 1);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
