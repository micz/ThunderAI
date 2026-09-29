/*
 *  Spec 08 "Locked model selects", for a page hosting the global connection panel (options,
 *  setup wizard). Every {provider}_model is locked while the user's own credentials are
 *  stored, so without the lock every "Fetch models" button would be live:
 *
 *   - the select keeps the enforced model and stays disabled, and so does its Tom Select;
 *   - the "Fetch models" / "Update" button is disabled;
 *   - the connection checks re-run on every key/host/version edit and must neither re-enable
 *     the select nor clear() it: emptying the credential and typing it back keeps the
 *     enforced model shown.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';
import { REASONS } from './dom-known-issues.mjs';

export const MODELS = {
    chatgpt_model: { value: 'gpt-org-enforced', btn: 'btnUpdateChatGPTModels', cred: 'chatgpt_api_key' },
    google_gemini_model: { value: 'gemini-org-enforced', btn: 'btnUpdateGoogleGeminiModels', cred: 'google_gemini_api_key' },
    ollama_model: { value: 'llama-org-enforced', btn: 'btnUpdateOllamaModels', cred: 'ollama_host' },
    openai_comp_model: { value: 'comp-org-enforced', btn: 'btnUpdateOpenAICompModels', cred: 'openai_comp_host' },
    anthropic_model: { value: 'claude-org-enforced', btn: 'btnUpdateAnthropicModels', cred: 'anthropic_api_key' },
};

const USER_CREDENTIALS = {
    chatgpt_api_key: 'sk-user-own',
    google_gemini_api_key: 'AIza-user-own',
    ollama_host: 'http://ollama.user.example:11434',
    openai_comp_host: 'http://llm.user.example:8080',
    anthropic_api_key: 'sk-ant-user-own',
};

export async function lockedModelScenario(page) {
    const policy = { _org_name: 'ACME' };
    for (const [key, m] of Object.entries(MODELS)) policy[key] = m.value;
    const local = { connection_type: 'chatgpt_api', ...USER_CREDENTIALS };
    for (const key of Object.keys(MODELS)) local[key] = 'user-model';
    const ctx = await openPage(page, { policy, local });
    after(() => ctx.close());

    const check = (key, where) => {
        const m = MODELS[key];
        const select = ctx.$('#' + key);
        assert.equal(select.value, m.value, `${key} does not show the enforced model ${where}`);
        assert.equal(select.disabled, true, `${key} enabled ${where}`);
        if (select.tomselect) {
            assert.equal(select.tomselect.isDisabled, true, `${key}'s Tom Select enabled ${where}`);
            assert.deepEqual([].concat(select.tomselect.getValue()), [m.value], `${key}'s Tom Select cleared ${where}`);
        }
        assert.equal(ctx.$('#' + m.btn).disabled, true, `${m.btn} enabled ${where}`);
    };

    for (const key of Object.keys(MODELS)) {
        test(`${key}: enforced model shown, select and Tom Select disabled, Update disabled`, () => {
            assert.ok(ctx.$('#' + key).tomselect, key + ' has no Tom Select: the page did not build it');
            check(key, 'at page open');
        });

        test(`${key}: emptying and retyping ${MODELS[key].cred} neither clears nor re-enables it`,
            { todo: REASONS.lockedModelClearedOnEmptyCredential }, async () => {
            const cred = ctx.$('#' + MODELS[key].cred);
            const own = cred.value;
            cred.value = '';
            await ctx.fire(cred, 'input');
            await ctx.fire(cred, 'change');
            check(key, 'with ' + MODELS[key].cred + ' empty');
            cred.value = own;
            await ctx.fire(cred, 'input');
            await ctx.fire(cred, 'change');
            check(key, 'with ' + MODELS[key].cred + ' typed back');
        });
    }

    test('the stored user models are untouched', () => {
        for (const key of Object.keys(MODELS)) assert.equal(ctx.ctl.localData()[key], 'user-model', key);
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
