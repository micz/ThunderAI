/*
 *  A feature page's text Save must not revert the connection. No policy involved.
 *
 *  The text Save buttons used to write back the whole _special_prompts array the page loaded at
 *  page open, so a connection field the panel had saved since (_updatePrompt(), on every change)
 *  was silently put back to its old value. They now save the text alone, on a fresh read
 *  (saveSpecialPromptTexts() in js/mzta-prompts.js). Generated from FEATURE_PAGES
 *  (./feature-pages.mjs), one file per page:
 *
 *   - change a connection field, which the panel saves;
 *   - then edit the text and click Save;
 *   - the text is saved and the connection field keeps the new value (calendar: both prompts
 *     get the text).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';
import { FEATURE_PAGES, prefixOfPage } from './feature-pages.mjs';

export async function textSaveScenario(page) {
    const prefix = prefixOfPage(page);
    const feature = FEATURE_PAGES[prefix];
    const ctx = await openPage(page, {
        local: {
            connection_type: 'chatgpt_api',
            [prefix + '_use_specific_integration']: true,
            [prefix + '_connection_type']: 'openai_comp_api',
            _special_prompts: [{
                id: feature.promptId, text: feature.text, is_default: '1', is_special: '1',
                show_in: 'both', custom_icon: '',
                api_type: 'openai_comp_api',
                openai_comp_host: 'http://comp.user.example:8080',
                openai_comp_model: 'user-comp-model',
                openai_comp_temperature: '0.3',
            }],
        },
    });
    after(() => ctx.close());
    const stored = id => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === id);

    test('a connection field changed in the panel is saved', async () => {
        const temp = ctx.$('#' + prefix + '_openai_comp_temperature');
        assert.equal(temp.value, '0.3');
        temp.value = '0.9';
        await ctx.fire(temp, 'input');
        await ctx.fire(temp, 'change');
        assert.equal(stored(feature.promptId).openai_comp_temperature, '0.9');
    });

    test('a text Save afterwards saves the text and keeps the connection change', async () => {
        const textarea = ctx.$('#' + feature.textarea);
        const edited = feature.text + ' (edited)';
        textarea.value = edited;
        await ctx.fire(textarea, 'input');
        const save = ctx.$('#btn_save_prompt');
        assert.equal(save.disabled, false, 'Save not enabled by the edit');
        await ctx.click(save);
        const p = stored(feature.promptId);
        assert.equal(p.text, edited, 'the text was not saved');
        assert.equal(p.openai_comp_temperature, '0.9', 'the text Save reverted the connection change');
        assert.equal(p.api_type, 'openai_comp_api');
        assert.equal(p.openai_comp_host, 'http://comp.user.example:8080');
        if (prefix === 'get_calendar_event') {
            assert.equal(stored('prompt_get_calendar_event_from_clipboard').text, edited);
        }
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
