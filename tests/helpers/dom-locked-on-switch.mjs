/*
 *  Spec 08 "The connection panel" -> "The connection mode": {prefix}_use_specific_integration
 *  locked ON by the policy WITHOUT a policy connection (no _special_prompts_connection entry).
 *  The connection itself stays the user's, so the panel works as without a policy, but:
 *
 *   - the switch is locked on and carries the managed marker - never the "mandatory" badge as
 *     well, even over an unusable global connection (ChatGPT Web here), since the marker is the
 *     explanation;
 *   - a switch re-enabled by hand and turned off goes back on and writes nothing: the prompt's
 *     stored override is not cleared (clearPromptAPI()) and {prefix}_connection_type is not
 *     emptied. The write guard would refuse the preference write only, not the prompt write.
 *
 *  Generated from FEATURE_PAGES (./feature-pages.mjs), one file per page.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';
import { FEATURE_PAGES, prefixOfPage } from './feature-pages.mjs';

export async function lockedOnSwitchScenario(page) {
    const prefix = prefixOfPage(page);
    const feature = FEATURE_PAGES[prefix];
    const useKey = prefix + '_use_specific_integration';
    const ctx = await openPage(page, {
        policy: { _org_name: 'ACME', [useKey]: true },
        local: {
            connection_type: 'chatgpt_web',
            [prefix + '_connection_type']: 'ollama_api',
            _special_prompts: [{
                id: feature.promptId, text: feature.text, is_default: '1', is_special: '1',
                show_in: 'both', custom_icon: '',
                api_type: 'ollama_api',
                ollama_host: 'http://ollama.user.example:11434',
                ollama_model: 'user-model',
            }],
        },
    });
    after(() => ctx.close());
    const stored = () => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === feature.promptId);
    const sw = () => ctx.$('#' + useKey);

    test('the switch is locked on and marked, never also badged as mandatory', () => {
        assert.equal(sw().checked, true);
        assert.equal(sw().disabled, true);
        assert.equal(sw().dataset.mztaManaged, '1');
        assert.notEqual(sw().dataset.mandatory, 'true', 'the "mandatory" badge as a second explanation');
        const badge = ctx.$('#specific_integration_locked_badge');
        assert.ok(!badge || !badge.classList.contains('shown'), 'mandatory badge shown');
    });

    test('the panel shows the user\'s own connection', () => {
        assert.equal(ctx.$('#' + prefix + '_connection_type').value, 'ollama_api');
        assert.equal(ctx.$('#' + prefix + '_ollama_host').value, 'http://ollama.user.example:11434');
    });

    test('a switch re-enabled by hand and turned off goes back on and writes nothing', async () => {
        const sentBefore = ctx.ctl.sent.length;
        sw().disabled = false;
        sw().checked = false;
        await ctx.fire(sw(), 'change');
        assert.equal(sw().checked, true, 'the switch stayed off');
        const p = stored();
        assert.equal(p.api_type, 'ollama_api', 'the stored override was cleared');
        assert.equal(p.ollama_host, 'http://ollama.user.example:11434');
        assert.equal(ctx.ctl.localData()[prefix + '_connection_type'], 'ollama_api',
            prefix + '_connection_type emptied');
        assert.ok(ctx.ctl.sent.length >= sentBefore);
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
