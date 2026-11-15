// The popup opened in a compose window with the SmartBar on, no policy.
//
// claude-spec/10-smartbar-compose.md "Opening it": in a compose window only, with the SmartBar on,
// the popup shows the entry "SmartBar chat" above the prompts; a click asks the background to open
// the chat of that compose window (smartbar_compose_open_chat with the popup's tab) and closes the
// popup, as a prompt does. The prompts are listed as usual. (Its absence in a reading tab and with
// the SmartBar off: ui-03, ui-04.)

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const PROMPTS = [
    { id: 'compose_two', label: 'Compose two', type: '2', show_in: 'popup', position_display: 1, position_compose: 1, custom_icon: '' },
];

const ctx = await openPage('popup', {
    local: { connection_type: 'ollama_api', ollama_host: 'http://ollama.example:11434', smartbar_enabled: true },
    commands: {
        popup_menu_ready: () => ({
            batchStatus: { working: false },
            lastShortcutTabId: 42,
            lastShortcutTabType: 'messageCompose',
            lastShortcutFiltering: 2,
            lastShortcutPromptsData: structuredClone(PROMPTS),
        }),
        smartbar_compose_open_chat: () => ({ ok: true }),
    },
});
after(() => ctx.close());
const k = uiTests('popup', '08');
const $ = ctx.$;

const S_OPEN = 'spec 10 "compose window: Opening it"';
const sent = command => ctx.apiCalls('browser.runtime.sendMessage').map(c => c.args[0]).filter(m => m?.command === command);
const entry = () => $('#mzta_smartbar_compose_chat');

k.test('entry-shown', S_OPEN, 'a compose window with the SmartBar on: the entry above the prompts, which are listed as usual', () => {
    assert.equal(entry().style.display, 'block');
    assert.equal(entry().textContent, msg('popup_smartbar_compose_chat'));
    assert.equal(entry().title, msg('popup_smartbar_compose_chat_tooltip'));
    assert.ok(entry().compareDocumentPosition($('#mzta_search_input')) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the search');
    assert.deepEqual(ctx.$$('#mzta_autocomplete-items .mzta_autocomplete-item').map(r => r.dataset.id), ['compose_two']);
});

k.test('entry-opens', S_OPEN, 'a click asks the background for the chat of the popup\'s compose tab, and closes the popup', async () => {
    const closes = ctx.dialogs.filter(d => d.kind === 'close').length;
    await ctx.click(entry());
    assert.deepEqual(sent('smartbar_compose_open_chat'), [{ command: 'smartbar_compose_open_chat', tabId: 42 }]);
    assert.equal(ctx.dialogs.filter(d => d.kind === 'close').length, closes + 1);
});

k.test('harness-clean', S_OPEN, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
