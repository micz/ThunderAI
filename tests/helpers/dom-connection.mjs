/*
 *  Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "UI", on a
 *  feature page with a specific-integration panel. Generated from FEATURE_PAGES
 *  (./feature-pages.mjs), one file per page and mode:
 *
 *  'enforced' - the policy enforces an OpenAI-compatible connection (host, key, model,
 *               temperature) over a stored user override on Ollama, with the switch stored off
 *               and no global connection (which would otherwise make the switch "mandatory"):
 *                - the switch shows on and is locked, the type select shows the policy type
 *                  and is locked, the policy's rows are shown;
 *                - every enforced field shows the policy value, disabled and marked;
 *                - the key is MANAGED_SECRET_MARKER, its eye is the padlock and cannot reveal
 *                  it; "Update" is disabled and, re-enabled by hand, fetches nothing; the page
 *                  has no connection test to refuse it;
 *                - the enforced model is kept in a disabled select;
 *                - write attempts on every locked control, re-enabled by hand, and a text Save
 *                  leave the user's override in storage.local untouched, and nothing in storage
 *                  ever holds a policy value or the marker.
 *  'unlocked' - the policy enforces the type and the host, and offers the model, the key and
 *               the temperature as initial values (":locked": false):
 *                - those fields stay editable and show the user's value, or the policy default
 *                  when the user has none (the key: the marker, with the padlock);
 *                - editing one writes that user field only: api_type, the enforced host and
 *                  the untouched policy defaults are never stored;
 *                - a field the user sets to exactly the policy default is saved as theirs, while
 *                  a text Save afterwards cannot store the policy default over it.
 *
 *  "No policy = as before" is <page>/01-no-policy, which every page already has.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';
import { FEATURE_PAGES, prefixOfPage } from './feature-pages.mjs';

const POLICY_HOST = 'https://gateway.org.example';
const POLICY_KEY = 'sk-org-SECRET-connection';

function policyFor(prefix, mode) {
    const entry = mode === 'enforced'
        ? {
            api_type: 'openai_comp_api',
            openai_comp_host: POLICY_HOST,
            openai_comp_api_key: POLICY_KEY,
            openai_comp_model: 'comp-org-enforced',
            openai_comp_temperature: '0.2',
        }
        : {
            api_type: 'openai_comp_api',
            openai_comp_host: POLICY_HOST,
            openai_comp_api_key: POLICY_KEY, 'openai_comp_api_key:locked': false,
            openai_comp_model: 'comp-org-default', 'openai_comp_model:locked': false,
            openai_comp_temperature: '0.4', 'openai_comp_temperature:locked': false,
        };
    return { _org_name: 'ACME', _special_prompts_connection: { [prefix]: entry } };
}

// The user's own override, on another provider, plus stale values for the policy's provider.
const USER_OVERRIDE = {
    api_type: 'ollama_api',
    ollama_host: 'http://ollama.user.example:11434',
    ollama_model: 'user-llama',
    openai_comp_host: 'http://comp.user.example:8080',
    openai_comp_model: 'user-comp-model',
};
const OVERRIDE_KEY = /^(api_type|(chatgpt|ollama|openai_comp|google_gemini|anthropic)_)/;
const overrideOf = p => Object.fromEntries(Object.entries(p || {}).filter(([k]) => OVERRIDE_KEY.test(k)));

// Values only: the prompt's property names include "openai_comp_api_key".
const holds = (v, target) => v === target
    || (v !== null && typeof v === 'object' && Object.values(v).some(x => holds(x, target)));

export async function connectionScenario(page, mode) {
    const prefix = prefixOfPage(page);
    const feature = FEATURE_PAGES[prefix];
    const id = name => '#' + prefix + '_' + name;
    const local = {
        connection_type: mode === 'enforced' ? '' : 'chatgpt_api',
        [prefix + '_use_specific_integration']: false,
        [prefix + '_connection_type']: 'ollama_api',
        _special_prompts: [{
            id: feature.promptId, text: feature.text, is_default: '1', is_special: '1',
            show_in: 'both', custom_icon: '', ...USER_OVERRIDE,
        }],
    };
    const ctx = await openPage(page, { policy: policyFor(prefix, mode), local });
    after(() => ctx.close());
    const { MANAGED_SECRET_MARKER } = ctx.mods;
    const storedPrompt = () => (ctx.ctl.localData()._special_prompts || []).find(p => p.id === feature.promptId);
    const policyValues = mode === 'enforced'
        ? [POLICY_HOST, POLICY_KEY, 'comp-org-enforced', '0.2', MANAGED_SECRET_MARKER]
        : [POLICY_HOST, POLICY_KEY, 'comp-org-default', '0.4', MANAGED_SECRET_MARKER];
    const assertStorageClean = where => {
        const data = ctx.ctl.localData();
        for (const v of policyValues) {
            assert.equal(holds(data, v), false, JSON.stringify(v) + ' in storage.local ' + where);
        }
        assert.equal(JSON.stringify(data).includes('_connection_by_policy'), false, 'transient flag stored ' + where);
    };
    const assertLocked = (el, name) => {
        assert.ok(el, name + ' not found');
        assert.equal(el.disabled, true, name + ' enabled');
        assert.equal(el.dataset.mztaManaged, '1', name + ' not marked managed');
    };

    test('the switch shows on and is locked; the type select shows the policy type, locked', () => {
        const sw = ctx.$(id('use_specific_integration'));
        assert.equal(sw.checked, true);
        assertLocked(sw, 'the switch');
        const select = ctx.$(id('connection_type'));
        assert.equal(select.value, 'openai_comp_api');
        assertLocked(select, 'the type select');
        assert.equal(ctx.$(id('openai_comp_host')).closest('tr').style.display, 'table-row', 'policy rows hidden');
    });

    if (mode === 'enforced') {
        test('the switch is not presented as "mandatory": the managed marker explains it', () => {
            const badge = ctx.$('#specific_integration_locked_badge');
            if (badge) assert.equal(badge.classList.contains('shown'), false);
            assert.notEqual(ctx.$(id('use_specific_integration')).dataset.mandatory, 'true');
        });

        test('every enforced field shows the policy value, disabled and marked', () => {
            const expected = {
                openai_comp_host: POLICY_HOST,
                openai_comp_api_key: MANAGED_SECRET_MARKER,
                openai_comp_temperature: '0.2',
            };
            for (const [name, value] of Object.entries(expected)) {
                const el = ctx.$(id(name));
                assert.equal(el.value, value, name);
                assertLocked(el, name);
                assert.ok(el.closest('td').querySelector('.managed_marker'), name + ' has no managed marker');
            }
        });

        test('the enforced key is the marker behind a padlock that reveals nothing', async () => {
            const key = ctx.$(id('openai_comp_api_key'));
            const toggle = ctx.$(id('toggle_openai_comp_api_key'));
            assert.equal(toggle.classList.contains('managed_secret'), true, 'no padlock');
            await ctx.click(toggle);
            assert.equal(key.type, 'password');
            assert.equal(key.value, MANAGED_SECRET_MARKER);
        });

        test('the enforced model is kept in a disabled select, and "Update" is disabled', () => {
            const model = ctx.$(id('openai_comp_model'));
            assert.equal(model.value, 'comp-org-enforced');
            assertLocked(model, 'the model select');
            if (model.tomselect) assert.equal(model.tomselect.isDisabled, true, 'Tom Select enabled');
            assert.equal(ctx.$(id('btnUpdateOpenAICompModels')).disabled, true);
        });

        test('"Update", re-enabled by hand, never sends the marker anywhere', async () => {
            const btn = ctx.$(id('btnUpdateOpenAICompModels'));
            btn.disabled = false;
            await ctx.click(btn);
            assert.deepEqual(ctx.fetchCalls, []);
            assert.equal(ctx.$(id('openai_comp_model')).value, 'comp-org-enforced');
        });

        test('the page has no connection test that could be handed the marker', () => {
            assert.deepEqual(ctx.$$('[id^="mzta_conn_test"]'), []);
        });

        test('write attempts on locked controls re-enabled by hand write nothing', async () => {
            const before = JSON.stringify(ctx.ctl.localData());
            const attempts = [
                ['use_specific_integration', el => { el.checked = false; }],
                ['connection_type', el => { el.value = 'chatgpt_api'; }],
                ['openai_comp_host', el => { el.value = 'http://sneaky.example:1'; }],
                ['openai_comp_api_key', el => { el.value = 'sk-sneaky'; }],
                ['openai_comp_temperature', el => { el.value = '1.9'; }],
                ['openai_comp_model', el => { el.value = 'user-comp-model'; }],
            ];
            for (const [name, change] of attempts) {
                const el = ctx.$(id(name));
                el.disabled = false;
                change(el);
                await ctx.fire(el, 'input');
                await ctx.fire(el, 'change');
            }
            assert.equal(JSON.stringify(ctx.ctl.localData()), before);
        });
    } else {
        test('the enforced host is locked; the unlocked fields stay editable', () => {
            assertLocked(ctx.$(id('openai_comp_host')), 'the host');
            assert.equal(ctx.$(id('openai_comp_host')).value, POLICY_HOST);
            for (const name of ['openai_comp_api_key', 'openai_comp_temperature', 'openai_comp_model']) {
                assert.notEqual(ctx.$(id(name)).dataset.mztaManaged, '1', name + ' marked managed');
            }
            assert.equal(ctx.$(id('openai_comp_temperature')).disabled, false);
            assert.equal(ctx.$(id('openai_comp_api_key')).disabled, false);
        });

        test('the user\'s own value is shown; the policy default only where the user has none', () => {
            assert.equal(ctx.$(id('openai_comp_model')).value, 'user-comp-model');
            assert.equal(ctx.$(id('openai_comp_temperature')).value, '0.4');
            assert.equal(ctx.$(id('openai_comp_api_key')).value, MANAGED_SECRET_MARKER);
        });

        test('an unlocked policy key shows the padlock, and "Update" stays disabled on it', () => {
            assert.equal(ctx.$(id('toggle_openai_comp_api_key')).classList.contains('managed_secret'), true);
            assert.equal(ctx.$(id('btnUpdateOpenAICompModels')).disabled, true);
        });

        test('editing an unlocked field saves that user field only', async () => {
            const temp = ctx.$(id('openai_comp_temperature'));
            temp.value = '0.7';
            await ctx.fire(temp, 'input');
            await ctx.fire(temp, 'change');
            const p = storedPrompt();
            assert.equal(p.openai_comp_temperature, '0.7');
            assert.equal(p.api_type, 'ollama_api');
            assert.equal(p.openai_comp_host, USER_OVERRIDE.openai_comp_host);
            assert.equal(p.openai_comp_model, 'user-comp-model');
            assert.equal('openai_comp_api_key' in p, false);
            assertStorageClean('after an unlocked edit');
        });

        test('a field the user sets back to the policy default is saved as their own value', async () => {
            const temp = ctx.$(id('openai_comp_temperature'));
            temp.value = '0.4'; // exactly the unlocked policy default
            await ctx.fire(temp, 'input');
            await ctx.fire(temp, 'change');
            assert.equal(storedPrompt().openai_comp_temperature, '0.4');
            assert.equal(JSON.stringify(ctx.ctl.localData()).includes('_user_fields'), false, 'transient flag stored');
            // and back to 0.7, so the text Save check below still has a user value to protect
            temp.value = '0.7';
            await ctx.fire(temp, 'input');
            await ctx.fire(temp, 'change');
            assert.equal(storedPrompt().openai_comp_temperature, '0.7');
        });

        test('a key the user types over the policy default is theirs, and the eye comes back', async () => {
            const key = ctx.$(id('openai_comp_api_key'));
            key.value = 'sk-user-typed';
            await ctx.fire(key, 'input');
            assert.equal(ctx.$(id('toggle_openai_comp_api_key')).classList.contains('managed_secret'), false);
            await ctx.fire(key, 'change');
            assert.equal(storedPrompt().openai_comp_api_key, 'sk-user-typed');
            assert.equal(storedPrompt().api_type, 'ollama_api');
        });
    }

    // The page's text Save rewrites the whole array from a fresh read (saveSpecialPromptTexts()),
    // overlay included - in 'unlocked' mode after the user edited the connection, so the read
    // holds the policy defaults (the marker) next to values the user has stored.
    test('a text Save writes the array back without storing a policy value over the user\'s', async () => {
        const textarea = ctx.$('#' + feature.textarea);
        const expected = overrideOf(storedPrompt() || USER_OVERRIDE);
        textarea.value = feature.text + ' (edited)';
        await ctx.fire(textarea, 'input');
        const save = ctx.$('#btn_save_prompt');
        save.disabled = false;
        await ctx.click(save);
        const p = storedPrompt();
        assert.equal(p.text, feature.text + ' (edited)', 'the text Save did not run');
        assert.equal(p.api_type, USER_OVERRIDE.api_type);
        assert.equal(p.openai_comp_host, USER_OVERRIDE.openai_comp_host);
        if (mode === 'enforced') {
            assert.deepEqual(overrideOf(p), expected);
        } else {
            // The fields the policy offers keep the user's values.
            assert.equal(p.openai_comp_temperature, expected.openai_comp_temperature);
            assert.equal(p.openai_comp_api_key, expected.openai_comp_api_key);
            assert.equal(p.openai_comp_model, expected.openai_comp_model);
        }
    });

    test('nothing in storage holds a policy value or the marker', () => assertStorageClean('at the end'));

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
