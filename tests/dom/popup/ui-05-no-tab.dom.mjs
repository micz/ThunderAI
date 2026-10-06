// The popup opened when no tab is ready for it (`popup_menu_ready` answers nothing), by a
// configured OpenAI API user, no policy.
//
// Spec 02 "Popup Menu" ("No tab": the loading spinner is hidden and the popup stays empty).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('popup', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-configured' },
    commands: { popup_menu_ready: () => null },
});
after(() => ctx.close());
const k = uiTests('popup', '05');
const $ = ctx.$;

const S_POPUP = 'spec 02 "Popup Menu"';

k.test('spinner-hidden', S_POPUP, 'with no tab to answer, the loading spinner is hidden and no prompt is listed', () => {
    assert.equal($('#mzta_autocomplete-items-loading').style.display, 'none');
    assert.deepEqual(ctx.$$('#mzta_autocomplete-items .mzta_autocomplete-item'), []);
});

k.test('nothing-else', S_POPUP, 'nothing else is shown: no invitation, no batch banner', () => {
    assert.notEqual($('#setup_wizard_prompt').style.display, 'block');
    assert.notEqual($('#mzta_batch_stop').style.display, 'block');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
