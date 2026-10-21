// The popup of a Claude API user who has not granted the anthropic.com permission, opened on a
// tab that is neither a message nor a compose window (`lastShortcutFiltering` 0), no policy.
//
// Spec 02 "Popup Menu" (no type filter for such a tab, ordered by `position_display`; the red
// banner in place of the search box and its click opening the welcome page). Spec 05 "Setup
// Wizard (`pages/setup-wizard/`)", "Blue wizard banner vs. red permission banner" (the chosen
// provider's red banner only).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const PROMPTS = [
    { id: 'compose', label: 'Compose', type: '2', show_in: 'popup', position_display: 2, position_compose: 1, custom_icon: '' },
    { id: 'reading', label: 'Reading', type: '1', show_in: 'both', position_display: 3, position_compose: 2, custom_icon: '' },
    { id: 'any', label: 'Any', type: '0', show_in: 'popup', position_display: 1, position_compose: 3, custom_icon: '' },
    { id: 'context', label: 'Context', type: '0', show_in: 'context', position_display: 0, position_compose: 0, custom_icon: '' },
];

const ctx = await openPage('popup', {
    local: { connection_type: 'anthropic_api', anthropic_api_key: 'sk-ant-configured' },
    permissions: { contains: () => false },
    commands: {
        popup_menu_ready: () => ({
            batchStatus: { working: false, processed: 0, cancelRequested: false },
            lastShortcutTabId: 3,
            lastShortcutTabType: 'addressBook',
            lastShortcutFiltering: 0,
            lastShortcutPromptsData: structuredClone(PROMPTS),
        }),
    },
});
after(() => ctx.close());
const k = uiTests('popup', '06');
const $ = ctx.$;

const S_POPUP = 'spec 02 "Popup Menu"';
const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';

const rows = () => ctx.$$('#mzta_autocomplete-items .mzta_autocomplete-item');

k.test('no-type-filter', S_POPUP, 'another kind of tab lists every popup prompt, whatever its type, by `position_display`', () => {
    assert.deepEqual(rows().map(r => r.dataset.id), ['any', 'compose', 'reading']);
});

k.test('red-banner', S_WIZ, 'the Claude red permission banner is shown, the other two are not', () => {
    assert.equal($('#ask_anthropic_api_perm').style.display, 'block');
    assert.notEqual($('#ask_chatgpt_web_perm').style.display, 'block');
    assert.notEqual($('#ask_openai_api_perm').style.display, 'block');
    assert.deepEqual(ctx.apiCalls('browser.permissions.contains').map(c => c.args[0].origins), [['https://*.anthropic.com/*']]);
});

k.test('red-banner-click', S_POPUP, 'it replaces the search box, and a click opens the welcome page', async () => {
    assert.equal($('#mzta_search_banner').style.display, 'none');
    await ctx.click($('#ask_anthropic_api_perm'));
    const opened = ctx.apiCalls('browser.tabs.create');
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /pages\/onboarding\/onboarding\.html$/);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
