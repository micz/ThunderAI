// The setup wizard reopened by a user who already configured Claude (every provider field
// stored, two feature flags on), no policy.
//
// Spec 05 "Setup Wizard (`pages/setup-wizard/`)": the saved provider applied at load (its card
// marked, "Continue" enabled), "Persistence" (the same keys as the options page: every stored
// {provider}_{key} of integration_options_config - fixture ui/provider-fields.json - and the
// ChatGPT Web rows shown at load, none rewritten by opening the page, a change stored under its
// key with its default's type; the feature flags on "Pick your tools"), "Connection Settings
// Panel — Advanced Options Disclosure" (JSON field validation on restore, which names the
// wizard). Spec 04 "Anthropic / Claude (`anthropic_api`)", "OpenAI API (`chatgpt_api`)" and "Ollama
// (`ollama_api`)": the per-model availability computed after the restore, the three call sites
// the spec lists for the wizard (`anthropic_effort` filled; a stored thinking budget checked; the OpenAI fields gated by the stored
// model and format; the Ollama capability probe for the stored host and model).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { loadFixture } from '../../helpers/core/load.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const { values: FIELDS } = loadFixture('provider-fields.json', 'ui');
const WEB = {
    chatgpt_web_model: 'gpt-fixture',
    chatgpt_web_project: 'g-p-fixture',
    chatgpt_web_custom_gpt: 'https://chatgpt.com/g/g-fixture',
    chatgpt_web_tempchat: true,
    chatgpt_web_load_wait_time: 2500,
};
const STORED = {
    connection_type: 'anthropic_api',
    ...FIELDS,
    ...WEB,
    // malformed: must be flagged at load without being touched
    chatgpt_extra_body: '{"a": 1,',
    // not below anthropic_max_tokens (8000): must be flagged at load too
    anthropic_extended_thinking_budget: 9000,
    add_tags: true,
    summarize: true,
    translate: false,
};

const ctx = await openPage('setup-wizard', { local: STORED });
after(() => ctx.close());
// Imported once the page's mock is installed, like every module under test (tests/README.md).
const { integration_options_config } = await import('../../../options/mzta-options-default.js');
const KEYS = [
    ...Object.entries(integration_options_config).flatMap(([provider, opts]) => Object.keys(opts).map(key => provider + '_' + key)),
    ...Object.keys(WEB),
];
const k = uiTests('setup-wizard', '02');
const $ = ctx.$;

const S_WIZ = 'spec 05 "Setup Wizard (`pages/setup-wizard/`)"';
const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
const S_OPENAI = 'spec 04 "OpenAI API (`chatgpt_api`)"';
const S_OLLAMA = 'spec 04 "Ollama (`ollama_api`)"';
const S_CLAUDE = 'spec 04 "Anthropic / Claude (`anthropic_api`)"';

const shownValue = el => el.type === 'checkbox' ? el.checked
    : el.type === 'number' ? el.valueAsNumber : el.value;

// ---- at load ---------------------------------------------------------------------------

k.test('saved-provider', S_WIZ, 'the saved provider\'s card is marked and "Continue" is enabled on step 0', () => {
    assert.deepEqual(ctx.$$('.wiz_provider_card.wiz_selected').map(c => c.dataset.provider), ['anthropic_api']);
    assert.equal($('#connection_type').value, 'anthropic_api');
    assert.equal($('#wiz_step_provider').classList.contains('hidden'), false);
    assert.equal($('#wiz_next').disabled, false);
});

k.test('fields-shown', S_WIZ, 'every stored connection field is shown at load, in a control with its key as id', () => {
    const wrong = KEYS.map(id => [id, $('#' + id)])
        .filter(([id, el]) => !el || shownValue(el) !== STORED[id])
        .map(([id, el]) => `${id}: ${el ? 'shows ' + JSON.stringify(shownValue(el)) : 'no control'}, stored ${JSON.stringify(STORED[id])}`);
    assert.deepEqual(wrong, []);
});

k.test('nothing-rewritten', S_WIZ, 'opening the wizard changes no stored value', () => {
    const rewritten = ctx.localWrites(0).flatMap(w => Object.entries(w.items))
        .filter(([id, v]) => v !== STORED[id]).map(([id, v]) => id + ' = ' + JSON.stringify(v));
    assert.deepEqual(rewritten, []);
});

k.test('flags-shown', S_WIZ, '"Pick your tools" shows the stored feature flags', () => {
    assert.equal($('#add_tags').checked, true);
    assert.equal($('#summarize').checked, true);
    assert.equal($('#translate').checked, false);
    assert.equal($('#spamfilter').checked, false);
});

k.test('json-on-restore', S_ADV, 'a malformed stored *_extra_body shows its red border and reason without being touched', () => {
    const field = $('#chatgpt_extra_body');
    assert.equal(field.value, STORED.chatgpt_extra_body);
    assert.match(field.style.border, /red/);
    const box = $('#chatgpt_extra_body_error');
    assert.equal(box.hidden, false);
    assert.ok(box.textContent.startsWith(msg('prefs_extra_body_error_invalid')), box.textContent);
});

k.test('effort-filled', S_CLAUDE, 'after the restore the effort select is filled, holds the stored level, and is gated by the model', () => {
    // claude-sonnet-4-5 takes no effort: every level offered, the control disabled with its note
    const effort = $('#anthropic_effort');
    assert.ok(effort.options.length > 1, 'the effort select is blank');
    assert.equal(effort.value, 'medium');
    assert.equal(effort.disabled, true);
    assert.notEqual($('#anthropic_effort_unsupported').style.display, 'none');
    assert.equal($('#anthropic_temperature').disabled, false);
});

k.test('openai-gated', S_OPENAI, 'after the restore the OpenAI fields follow the stored model and format', () => {
    // gpt-4.1 has no reasoning: its two reasoning fields disabled with their notes, sampling kept
    for (const id of ['chatgpt_reasoning_effort', 'chatgpt_reasoning_summary']) {
        assert.equal($('#' + id).disabled, true, id);
        assert.notEqual($('#' + id + '_unsupported').style.display, 'none', id);
    }
    assert.equal($('#chatgpt_temperature').disabled, false);
    // json_object: the schema name and schema apply to json_schema only
    assert.equal($('#chatgpt_text_format_schema_name').disabled, true);
    assert.equal($('#chatgpt_text_format_schema').disabled, true);
});

k.test('ollama-probed', S_OLLAMA, 'after the restore the stored Ollama host and model are probed for their capabilities', () => {
    assert.ok(ctx.fetchCalls.some(c => c.url === STORED.ollama_host + '/api/show'),
        ctx.fetchCalls.map(c => c.url).join(', '));
});

k.test('budget-on-restore', S_CLAUDE, 'a stored thinking budget not below max_tokens is flagged at load, with its reason', () => {
    // claude-sonnet-4-5 takes a budget, so the field is enabled and checked
    const field = $('#anthropic_extended_thinking_budget');
    assert.equal(field.disabled, false);
    assert.match(field.style.border, /red/);
    const box = $('#anthropic_extended_thinking_budget_error');
    assert.equal(box.hidden, false);
    assert.equal(box.textContent, msg('anthropic_warn_thinking_budget_max', '8000'));
});

// ---- changes -----------------------------------------------------------------------------

/** What the user enters in each control, and what must then be stored. */
function userValue(el, id) {
    if (el.type === 'checkbox') return { set: !el.checked, stored: !el.checked };
    if (el.type === 'number') return { set: String(el.valueAsNumber + 1), stored: el.valueAsNumber + 1 };
    if (el.tagName === 'SELECT') {
        let opt = [...el.options].find(o => o.value !== '' && o.value !== el.value);
        if (!opt) {                    // a model list holds only the stored model: a fetched one is picked
            opt = new ctx.window.Option('picked-' + id, 'picked-' + id);
            el.appendChild(opt);
        }
        return { set: opt.value, stored: opt.value };
    }
    if (el.classList.contains('check-json')) return { set: ' {"w": 1} ', stored: '{"w": 1}' };
    if (el.classList.contains('check-number')) return { set: ' 0.25 ', stored: '0.25' };
    return { set: '  w-' + id + '  ', stored: 'w-' + id };
}

k.test('written-on-change', S_WIZ, 'a change is stored under the field\'s own key, as the default\'s type', async () => {
    const defaults = ctx.mods.prefs_default;
    const wrong = [];
    for (const id of KEYS) {
        const el = $('#' + id);
        if (!el) continue;
        const { set, stored } = userValue(el, id);
        const since = ctx.ctl.calls.length;
        if (el.type === 'checkbox') el.checked = set;
        else el.value = set;
        await ctx.fire(el, 'change');
        const own = ctx.localWrites(since).filter(w => id in w.items).map(w => w.items[id]);
        if (own.length === 0) { wrong.push(id + ': nothing stored'); continue; }
        const got = own.at(-1);
        if (got !== stored) wrong.push(`${id}: stored ${JSON.stringify(got)}, expected ${JSON.stringify(stored)}`);
        else if (typeof got !== typeof defaults[id]) wrong.push(`${id}: stored a ${typeof got}, its default is a ${typeof defaults[id]}`);
    }
    assert.deepEqual(wrong, []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
