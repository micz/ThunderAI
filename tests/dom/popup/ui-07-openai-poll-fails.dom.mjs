// The popup of an OpenAI API user who has not granted the openai.com permission, while a batch
// is running and the background stops answering `batch_status`, no policy.
//
// Spec 02 "Popup Menu" (the red banner in place of the search box and its click). Spec 05 "Setup
// Wizard (`pages/setup-wizard/`)", "Blue wizard banner vs. red permission banner" (the chosen
// provider's red banner only). Spec 04 "Batch cancellation (user-triggered stop)" ("Popup
// payload": a failed poll stops the polling and leaves the banner, whose button still works).
//
// `batch_status` is answered with a rejection (openPage({ commands })); the file waits a little
// over two poll periods of real time to see that no further poll is sent.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { until } from '../../ui/dom-helpers.mjs';

const ctx = await openPage('popup', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-configured' },
    permissions: { contains: () => false },
    commands: {
        popup_menu_ready: () => ({
            batchStatus: { working: true, processed: 4, cancelRequested: false },
            lastShortcutTabId: 9,
            lastShortcutTabType: 'mail',
            lastShortcutFiltering: 1,
            lastShortcutPromptsData: [],
        }),
        batch_status: () => { throw new Error('the background is gone'); },
        cancel_batch: () => ({ ok: true }),
    },
});
after(() => ctx.close());
const k = uiTests('popup', '07');
const $ = ctx.$;

const S_POPUP = 'spec 02 "Popup Menu"';
const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const S_BATCH = 'spec 04 "Batch cancellation (user-triggered stop)"';

const sent = command => ctx.apiCalls('browser.runtime.sendMessage').map(c => c.args[0]).filter(m => m?.command === command);

k.test('red-banner', S_WIZ, 'the OpenAI red permission banner is shown, the other two are not', () => {
    assert.equal($('#ask_openai_api_perm').style.display, 'block');
    assert.notEqual($('#ask_chatgpt_web_perm').style.display, 'block');
    assert.notEqual($('#ask_anthropic_api_perm').style.display, 'block');
    assert.deepEqual(ctx.apiCalls('browser.permissions.contains').map(c => c.args[0].origins), [['https://*.openai.com/*']]);
});

k.test('red-banner-click', S_POPUP, 'it replaces the search box, and a click opens the welcome page', async () => {
    assert.equal($('#mzta_search_banner').style.display, 'none');
    await ctx.click($('#ask_openai_api_perm'));
    assert.match(ctx.apiCalls('browser.tabs.create').at(-1).args[0].url, /pages\/onboarding\/onboarding\.html$/);
});

k.test('poll-fails', S_BATCH, 'a failed poll stops the polling and leaves the banner with its last count', async () => {
    await until(ctx, () => sent('batch_status').length === 1, 'the first poll', 3000);
    await new Promise(r => setTimeout(r, 2300));
    await ctx.settle();
    assert.equal(sent('batch_status').length, 1, 'the popup kept polling');
    assert.equal($('#mzta_batch_stop').style.display, 'block');
    assert.equal($('#mzta_batch_progress').textContent, msg('batch_progress_x', ['4']));
});

k.test('stop-still-works', S_BATCH, 'its button still requests the cancellation', async () => {
    await ctx.click($('#mzta_batch_stop_btn'));
    assert.equal(sent('cancel_batch').length, 1);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
