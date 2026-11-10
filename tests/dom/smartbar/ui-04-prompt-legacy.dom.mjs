// The Prompts tab of the SmartBar page with a customized router text stored with no fingerprint
// (saved before fingerprints existed), no policy.
//
// Spec 02 "Default text updates": a text with no fingerprint gets no notice (the default it was
// written against is unknown); its next Save stores the current default's fingerprint.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    storedPrompt,
    enText,
} from '../../ui/feature-page.mjs';

const USER_ROUTER = 'My router. {OPERATIONS} {PLACEHOLDERS} {LANGUAGE_RULE}';
const ctx = await openPage('smartbar', {
    local: {
        connection_type: 'chatgpt_api',
        _special_prompts: [{ id: 'prompt_smartbar_router', text: USER_ROUTER, is_default: '1', is_special: '1', show_in: 'none', custom_icon: '' }],
    },
    query: '#prompts',
});
after(() => ctx.close());
const k = uiTests('smartbar', '04');
const $ = ctx.$;
const S_UPDATE = 'spec 02 "Default text updates"';
const S_PAGE = 'spec 05 "SmartBar Settings Page (`pages/smartbar/`)"';

k.test('no-fingerprint', S_UPDATE, 'a customized text with no fingerprint gets no notice', () => {
    assert.equal($('#smartbar_prompt_router_text').value, USER_ROUTER);
    assert.equal($('#smartbar_prompt_router_update').hidden, true);
});

k.test('save-stores', S_UPDATE, 'its next Save stores the current default\'s fingerprint', async () => {
    $('#smartbar_prompt_router_text').value = USER_ROUTER + ' Brief.';
    await ctx.fire($('#smartbar_prompt_router_text'), 'input');
    await ctx.click($('#btn_save_smartbar_router'));
    assert.equal(storedPrompt(ctx, 'prompt_smartbar_router').default_hash,
        ctx.mods.prompts.promptDefaultHash(enText('prompt_smartbar_router_full_text')));
    assert.equal($('#smartbar_prompt_router_update').hidden, true);
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
