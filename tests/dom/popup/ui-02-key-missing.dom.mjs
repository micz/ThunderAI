// The popup of a user who chose OpenAI API but stored no key, no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Popup menu": "Configured" = the
// required credential is set (`*_api_key` for the cloud APIs), so a selected cloud provider with
// no key shows the wizard invitation instead of the prompt list.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('popup', {
    // a host left over from another provider configures nothing for this one
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: '', ollama_host: 'http://ollama.example:11434' },
});
after(() => ctx.close());
const k = uiTests('popup', '02');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const asked = command => ctx.apiCalls('browser.runtime.sendMessage').filter(c => c.args[0]?.command === command);

k.test('invitation', S_WIZ, 'a cloud provider without its key shows the wizard invitation instead of the prompt list', () => {
    assert.equal($('#setup_wizard_prompt').style.display, 'block');
    assert.equal($('#mzta_search_banner').style.display, 'none');
    assert.deepEqual(asked('popup_menu_ready'), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
