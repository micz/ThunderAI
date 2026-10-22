// The popup of a user who chose OpenAI API but stored a key made of blanks only, no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Popup menu": "Configured" = the
// required credential is set, ignoring surrounding blanks (`*_api_key` for the cloud APIs), so a
// selected cloud provider with a blank key shows the wizard invitation instead of the prompt
// list; the invitation's button opens the wizard and closes the popup.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('popup', {
    // a host left over from another provider configures nothing for this one
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: '   ', ollama_host: 'http://ollama.example:11434' },
});
after(() => ctx.close());
const k = uiTests('popup', '02');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const asked = command => ctx.apiCalls('browser.runtime.sendMessage').filter(c => c.args[0]?.command === command);

k.test('invitation', S_WIZ, 'a cloud provider whose key is only blanks shows the wizard invitation instead of the prompt list', () => {
    assert.equal($('#setup_wizard_prompt').style.display, 'block');
    assert.equal($('#mzta_search_banner').style.display, 'none');
    assert.deepEqual(asked('popup_menu_ready'), []);
});

k.test('link-closes', S_WIZ, 'the invitation\'s button opens the wizard in a new tab and closes the popup', async () => {
    await ctx.click($('#btn_popup_setup_wizard'));
    assert.equal(ctx.apiCalls('browser.tabs.create').length, 1);
    assert.equal(ctx.dialogs.filter(d => d.kind === 'close').length, 1);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
