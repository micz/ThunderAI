// The popup on a fresh install (no connection selected), every host permission missing, no
// policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)", entry point "Popup menu" (no connection
// selected: `isConnectionConfigured()` is false and the wizard invitation is shown *instead of*
// the prompt list) and "Blue wizard banner vs. red permission banner" (an empty
// `connection_type` never triggers a red banner). The invitation and its link are managed's
// popup/01-no-policy.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('popup', { permissions: { contains: () => false } });
after(() => ctx.close());
const k = uiTests('popup', '01');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const asked = command => ctx.apiCalls('browser.runtime.sendMessage').filter(c => c.args[0]?.command === command);

k.test('no-list', S_WIZ, 'the invitation replaces the prompt list: the list is hidden and never requested', () => {
    assert.equal($('#setup_wizard_prompt').style.display, 'block');
    assert.equal($('#mzta_search_banner').style.display, 'none');
    assert.deepEqual(asked('popup_menu_ready'), []);
});

k.test('no-red-banner', S_WIZ, 'no red permission banner, though every host permission is missing', () => {
    for (const id of ['ask_chatgpt_web_perm', 'ask_anthropic_api_perm', 'ask_openai_api_perm']) {
        assert.notEqual($('#' + id).style.display, 'block', id);
    }
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
