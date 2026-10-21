/*
 *  The ui area's scenarios shared by the six feature settings pages (Add Tags, Spam Filter,
 *  Summarize, Translate, Calendar Event, Task), no policy. The connection panel and the prompt
 *  editor are the same code on all six (initializeSpecificIntegrationUI() in
 *  pages/_lib/connection-ui.js, bindSpecialPromptEditor() in pages/_lib/feature-page.js), but
 *  each page has its own restoreOptions() and saveOptions(), so every page runs them.
 *
 *   inheritedIntegrationTests(ctx, k, cfg)   on a page the caller opened with an API global
 *                                            connection and no override: the switch off, then
 *                                            on (inheriting), a provider change, a field, off
 *   promptEditorTests(ctx, k, cfg)           the prompt text editor and the unsaved-changes guard
 *   ownIntegrationScenario(cfg)              opens the page itself: a stored override in the
 *                                            prompt, stale {prefix}_* preferences and an unusable
 *                                            global connection (the mandatory case)
 *
 *  cfg: { page, nn, prefix, promptId, textareaId, defaultMsgKey, global ('' or 'chatgpt_web',
 *  ownIntegrationScenario only), extraTests(ctx, k) (ownIntegrationScenario only: the page's own
 *  tests on the same page) }. Case ids are fixed slugs, so a known issue names
 *  '<NN>-<slug>' of the page file that runs them.
 *
 *  Area-local: imports only the core and the area's own helpers, never the managed layer.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPage, assertHarnessClean, msg } from '../helpers/core/dom-harness.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import { uiTests } from '../helpers/known-issues/ui.mjs';
import {
    shown,
    userSets,
    scriptFetch,
    json,
    until,
} from './dom-helpers.mjs';

export const S_OVR = 'spec 05 "Special Prompt Integration Overrides"';
export const S_MAND = 'spec 05 "Mandatory Specific Integration (feature settings pages)"';
export const S_AUTH = 'spec 05 "The Prompt Is Authoritative For API Parameters"';
export const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
export const S_TEST = 'spec 05 "Connection Settings Panel — Connection Test Status Strip"';
export const S_GUARD = 'spec 05 "Unsaved-Changes Guard (`pages/_lib/unsaved-guard.js`)"';

const EN = JSON.parse(readFileSync(repoPath('_locales/en/messages.json'), 'utf8'));
/** The shipped (English) text of an i18n key, readable before any page is open. */
export const enText = key => EN[key].message;

/** The stored special prompt `id`, or undefined. */
export const storedPrompt = (ctx, id) => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === id);

/** Whether leaving the page now would ask for confirmation (the guard's beforeunload). */
export function leaveBlocked(ctx) {
    const e = new ctx.window.Event('beforeunload', { cancelable: true });
    ctx.window.dispatchEvent(e);
    return e.defaultPrevented;
}

const label = type => msg({
    chatgpt_api: 'prefs_Connection_type_ChatGPT_API',
    anthropic_api: 'prefs_Connection_type_Anthropic_API',
    ollama_api: 'prefs_Connection_type_Ollama_API',
}[type]);

const rowsOf = (ctx, type) => ctx.$$('tr.specific_integration_sub.conntype_' + type);
const rowShown = tr => tr.style.display !== 'none';

/**
 * The page is open with an API global connection (chatgpt_api) and no per-feature override.
 */
export function inheritedIntegrationTests(ctx, k, { prefix, promptId }) {
    const $ = ctx.$;
    const sw = () => $('#' + prefix + '_use_specific_integration');
    const sel = () => $('#' + prefix + '_connection_type');
    const local = () => ctx.ctl.localData();

    k.test('switch-off-at-load', S_OVR, 'with an API global connection and no override the switch is off and the panel hidden', () => {
        assert.equal(sw().checked, false);
        assert.equal(sw().dataset.mandatory, undefined, 'marked mandatory');
        assert.equal($('#mzta_conn_panel').style.display, 'none');
        assert.equal($('#specific_integration_locked_badge').classList.contains('shown'), false);
        assert.equal($('#specific_integration_locked_note').classList.contains('shown'), false);
    });

    k.test('nothing-written-at-load', S_OVR, 'opening the page stores no per-feature connection', () => {
        assert.equal(prefix + '_connection_type' in local(), false, JSON.stringify(local()[prefix + '_connection_type']));
        assert.equal(prefix + '_use_specific_integration' in local(), false);
        assert.ok(!storedPrompt(ctx, promptId)?.api_type, 'api_type stored');
    });

    k.test('switch-on-inherits', S_OVR, 'turning the switch on shows the global API and persists the pair and the prompt', async () => {
        await ctx.click(sw());
        assert.equal(sw().checked, true);
        assert.notEqual($('#mzta_conn_panel').style.display, 'none');
        assert.equal(sel().value, 'chatgpt_api');
        assert.strictEqual(local()[prefix + '_use_specific_integration'], true);
        assert.strictEqual(local()[prefix + '_connection_type'], 'chatgpt_api');
        assert.equal(storedPrompt(ctx, promptId)?.api_type, 'chatgpt_api');
    });

    k.test('panel-pill', S_OVR, 'the panel pill names the provider from the catalogue and the panel takes its tint', () => {
        assert.equal($('#mzta_conn_pill_name').textContent, label('chatgpt_api'));
        assert.equal($('#mzta_conn_panel').classList.contains('tint_chatgpt_api'), true);
    });

    k.test('no-web-option', S_MAND, 'the per-feature select offers no ChatGPT Web and no placeholder', () => {
        const values = [...sel().options].map(o => o.value);
        assert.equal(values.includes('chatgpt_web'), false);
        assert.equal(values.includes(''), false);
    });

    k.test('rows-of-provider', S_OVR, 'only the selected provider\'s rows are shown', () => {
        assert.ok(rowsOf(ctx, 'chatgpt_api').some(rowShown));
        for (const type of ['anthropic_api', 'ollama_api', 'google_gemini_api', 'openai_comp_api']) {
            assert.equal(rowsOf(ctx, type).some(rowShown), false, type);
        }
    });

    k.test('adv-built', S_ADV, 'the page gets the disclosure, collapsed, with the advanced rows moved behind it', () => {
        const btn = $('#mzta_conn_adv_btn');
        assert.ok(btn, 'no #mzta_conn_adv_btn');
        assert.notEqual(btn.style.display, 'none');
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
        assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
        assert.equal(btn.textContent.trim(), msg('prefs_advanced_options'));
        assert.equal(ctx.$$('#connection_ui_table tr.conn_adv').length, 0);
        assert.ok(ctx.$$('#connection_ui_adv_table tr.conn_adv').length > 0);
        assert.equal(ctx.$$('tr.conn_adv.conntype_chatgpt_web').length, 0, 'ChatGPT Web rows injected');
    });

    k.test('strip-built', S_TEST, 'the test strip follows the disclosure, shown and idle for a testable provider', () => {
        const strip = $('#mzta_conn_test');
        assert.ok(strip, 'no #mzta_conn_test');
        assert.equal(strip.previousElementSibling, $('#connection_ui_adv_table'));
        assert.equal(shown(strip), true);
        assert.equal(strip.getAttribute('data-state'), 'idle');
    });

    k.test('type-change', S_OVR, 'a provider change goes into the prompt and the preference, and collapses the disclosure', async () => {
        const btn = $('#mzta_conn_adv_btn');
        await ctx.click(btn);
        assert.equal(btn.getAttribute('aria-expanded'), 'true');
        await userSets(ctx, sel(), 'anthropic_api');
        assert.equal(btn.getAttribute('aria-expanded'), 'false');
        assert.equal(storedPrompt(ctx, promptId)?.api_type, 'anthropic_api');
        assert.strictEqual(local()[prefix + '_connection_type'], 'anthropic_api');
        assert.ok(rowsOf(ctx, 'anthropic_api').some(rowShown));
        assert.equal(rowsOf(ctx, 'chatgpt_api').some(rowShown), false);
        assert.equal($('#mzta_conn_pill_name').textContent, label('anthropic_api'));
    });

    k.test('field-into-prompt', S_AUTH, 'a provider field the user sets is written into the special prompt', async () => {
        await userSets(ctx, $('#' + prefix + '_anthropic_api_key'), 'sk-ant-user-1');
        await userSets(ctx, $('#' + prefix + '_anthropic_temperature'), '0.4');
        const p = storedPrompt(ctx, promptId);
        assert.equal(p?.anthropic_api_key, 'sk-ant-user-1');
        assert.equal(p?.anthropic_temperature, '0.4');
    });

    k.test('strip-test-prefixed', S_TEST, 'the strip tests the feature own fields (the prefixed ones), and saves nothing', async () => {
        const net = scriptFetch(ctx);
        net.answer('https://api.anthropic.com/v1/models', () => json({ data: [] }));
        const strip = $('#mzta_conn_test');
        const before = JSON.stringify(storedPrompt(ctx, promptId));
        await ctx.click(strip.querySelector('.conn_test_link'));
        await until(ctx, () => strip.getAttribute('data-state') !== 'loading', 'the test to end');
        assert.equal(strip.getAttribute('data-state'), 'ok');
        const call = ctx.fetchCalls.findLast(c => c.url === 'https://api.anthropic.com/v1/models');
        assert.equal(new Headers(call.init.headers).get('x-api-key'), 'sk-ant-user-1');
        assert.equal(JSON.stringify(storedPrompt(ctx, promptId)), before, 'the prompt was written');
        assert.deepEqual(net.pending(), []);
    });

    k.test('switch-off-clears', S_OVR, 'turning the switch off clears the prompt\'s api_type and options and the connection preference together', async () => {
        await ctx.click(sw());
        const p = storedPrompt(ctx, promptId);
        assert.equal(p?.api_type, '');
        assert.equal(p?.anthropic_api_key, '');
        assert.equal(p?.anthropic_temperature, '');
        assert.strictEqual(local()[prefix + '_connection_type'], '');
        assert.equal($('#mzta_conn_panel').style.display, 'none');
        assert.equal($('#mzta_conn_adv_btn').style.display, 'none');
        assert.equal(shown($('#mzta_conn_test')), false);
    });
}

/**
 * The prompt editor (textarea, Save, Reset) and the unsaved-changes guard. A page with several
 * editors runs it once per editor, with its button ids and a `tag` that keeps the case ids apart.
 */
export function promptEditorTests(ctx, k, {
    promptId, textareaId, defaultMsgKey, extraPromptIds = [],
    saveId = 'btn_save_prompt', resetId = 'btn_reset_prompt', tag = '',
}) {
    const $ = ctx.$;
    const ta = () => $('#' + textareaId);
    const save = () => $('#' + saveId);
    const reset = () => $('#' + resetId);

    k.test(tag + 'editor-load', S_GUARD, 'the shipped text is shown; Save starts disabled, so leaving is free', () => {
        assert.equal(ta().value, msg(defaultMsgKey));
        assert.equal(save().disabled, true);
        assert.equal(reset().disabled, true, 'Reset enabled on the shipped text');
        assert.equal(leaveBlocked(ctx), false);
    });

    k.test(tag + 'editor-dirty', S_GUARD, 'an edit enables Save, and leaving the page then asks', async () => {
        ta().value = msg(defaultMsgKey) + ' Be brief.';
        await ctx.fire(ta(), 'input');
        assert.equal(save().disabled, false);
        assert.equal(reset().disabled, false);
        assert.equal(leaveBlocked(ctx), true);
    });

    k.test(tag + 'editor-back-to-saved', S_GUARD, 'typing the saved text back disables Save again', async () => {
        ta().value = msg(defaultMsgKey);
        await ctx.fire(ta(), 'input');
        assert.equal(save().disabled, true);
        assert.equal(leaveBlocked(ctx), false);
    });

    k.test(tag + 'editor-save', S_GUARD, 'Save stores the text, disables itself, and leaving is free again', async () => {
        const text = msg(defaultMsgKey) + ' Be brief.';
        ta().value = text;
        await ctx.fire(ta(), 'input');
        const sent = ctx.ctl.sent.length;
        await ctx.click(save());
        for (const id of [promptId, ...extraPromptIds]) assert.equal(storedPrompt(ctx, id)?.text, text, id);
        assert.equal(save().disabled, true);
        assert.equal(leaveBlocked(ctx), false);
        assert.ok(ctx.ctl.sent.slice(sent).some(m => m?.command === 'reload_menus'), 'the menus are not reloaded');
    });

    k.test(tag + 'editor-reset', S_GUARD, 'Reset puts the shipped text back unsaved: Save enabled, leaving asks', async () => {
        await ctx.click(reset());
        assert.equal(ta().value, msg(defaultMsgKey));
        assert.equal(reset().disabled, true);
        assert.equal(save().disabled, false);
        assert.equal(leaveBlocked(ctx), true);
        assert.notEqual(storedPrompt(ctx, promptId)?.text, msg(defaultMsgKey), 'Reset saved by itself');
        await ctx.click(save());
        assert.equal(storedPrompt(ctx, promptId)?.text, msg(defaultMsgKey));
        assert.equal(leaveBlocked(ctx), false);
    });
}

/**
 * Opens the page with an unusable global connection (cfg.global: '' or 'chatgpt_web'), a special
 * prompt that carries its own Claude connection, and stale {prefix}_* preferences.
 */
export async function ownIntegrationScenario({ page, nn, prefix, promptId, defaultMsgKey, global, extraTests = null }) {
    const ctx = await openPage(page, {
        local: {
            ...(global ? { connection_type: global } : {}),
            [prefix + '_connection_type']: 'ollama_api',
            [prefix + '_anthropic_model']: 'stale-model',
            [prefix + '_anthropic_api_key']: 'sk-stale',
            _special_prompts: [{
                id: promptId, text: enText(defaultMsgKey), is_default: '1', is_special: '1',
                show_in: 'both', custom_icon: '',
                api_type: 'anthropic_api',
                anthropic_api_key: 'sk-ant-own',
                anthropic_model: 'claude-own-1',
                anthropic_version: '2023-06-01',
            }],
        },
    });
    after(() => ctx.close());
    const k = uiTests(page, nn);
    const $ = ctx.$;
    const sw = () => $('#' + prefix + '_use_specific_integration');
    const sel = () => $('#' + prefix + '_connection_type');
    const local = () => ctx.ctl.localData();
    const msgKey = global === 'chatgpt_web'
        ? 'specific_integration_mandatory_chatgpt_web' : 'specific_integration_mandatory_no_connection';

    k.test('mandatory-forced', S_MAND, 'the switch is forced on, enabled, marked mandatory, with the badge and the reason', () => {
        assert.equal(sw().checked, true);
        assert.equal(sw().disabled, false, 'disabled: the saveOptions() sweep would skip it');
        assert.equal(sw().dataset.mandatory, 'true');
        assert.equal($('#specific_integration_locked_badge').classList.contains('shown'), true);
        const note = $('#specific_integration_locked_note');
        assert.equal(note.classList.contains('shown'), true);
        assert.equal(note.textContent, msg(msgKey));
        assert.equal(sw().title, msg(msgKey));
    });

    k.test('mandatory-click-ignored', S_MAND, 'a click does not turn it off, and clears nothing', async () => {
        await ctx.click(sw());
        assert.equal(sw().checked, true);
        assert.equal(storedPrompt(ctx, promptId)?.api_type, 'anthropic_api');
        assert.equal(storedPrompt(ctx, promptId)?.anthropic_api_key, 'sk-ant-own');
    });

    k.test('restore-from-prompt', S_AUTH, 'the panel shows the prompt\'s connection, not the stale preferences', () => {
        assert.equal(sel().value, 'anthropic_api');
        assert.equal($('#' + prefix + '_anthropic_model').value, 'claude-own-1');
        assert.equal($('#' + prefix + '_anthropic_api_key').value, 'sk-ant-own');
    });

    k.test('mirrored-on-open', S_AUTH, 'opening the page mirrors the prompt into the preferences, type and flag together', () => {
        assert.strictEqual(local()[prefix + '_connection_type'], 'anthropic_api');
        assert.strictEqual(local()[prefix + '_use_specific_integration'], true);
        assert.strictEqual(local()[prefix + '_anthropic_model'], 'claude-own-1');
        assert.strictEqual(local()[prefix + '_anthropic_api_key'], 'sk-ant-own');
    });

    k.test('pick-persists', S_MAND, 'picking another provider stores it in the prompt and the preference', async () => {
        await userSets(ctx, sel(), 'ollama_api');
        assert.equal(storedPrompt(ctx, promptId)?.api_type, 'ollama_api');
        assert.strictEqual(local()[prefix + '_connection_type'], 'ollama_api');
        assert.strictEqual(local()[prefix + '_use_specific_integration'], true);
    });

    // The page's own tests for this initial state (no other stored preference), same page.
    if (extraTests) extraTests(ctx, k);

    k.coverage();
    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
