// Every global connection field of the options page, no policy.
//
// Spec 05 "Global Integration Settings": the provider settings are stored flat in
// prefs_default as {provider}_{key}, one control each on the options page. Each stored value
// (tests/fixtures/ui/provider-fields.json, one per key of integration_options_config) is shown
// at load, and a change the user makes is stored under that same key, with the type of its
// default (strings trimmed, as for every text field of the page).
//
// The field list comes from integration_options_config, so a new provider setting is swept
// without touching this file; the fixture must give it a stored value (a test says so).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { loadFixture } from '../../helpers/core/load.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const { values: STORED } = loadFixture('provider-fields.json', 'ui');

const ctx = await openPage('options', { local: { connection_type: 'anthropic_api', ...STORED } });
after(() => ctx.close());
// Imported once the page's mock is installed, like every module under test (tests/README.md).
const { integration_options_config } = await import('../../../options/mzta-options-default.js');
const KEYS = Object.entries(integration_options_config)
    .flatMap(([provider, opts]) => Object.keys(opts).map(key => provider + '_' + key));
const k = uiTests('options', '04');
const $ = ctx.$;
const S_GLOBAL = 'spec 05 "Global Integration Settings"';

const shownValue = el => el.type === 'checkbox' ? el.checked
    : el.type === 'number' ? el.valueAsNumber : el.value;

k.test('fixture-complete', S_GLOBAL, 'the fixture stores a value of the default\'s type for every provider setting', () => {
    const defaults = ctx.mods.prefs_default;
    assert.deepEqual(KEYS.filter(id => !(id in STORED)), [], 'keys without a stored value');
    for (const id of KEYS) {
        assert.equal(typeof STORED[id], typeof defaults[id], id);
        assert.notDeepEqual(STORED[id], defaults[id], id + ' equals its default');
    }
});

k.test('one-control-each', S_GLOBAL, 'every provider setting has its control, an .option-input with its key as id', () => {
    assert.deepEqual(KEYS.filter(id => !$('#' + id)?.classList.contains('option-input')), []);
});

k.test('shown-at-load', S_GLOBAL, 'every stored value is shown at load', () => {
    const wrong = KEYS.filter(id => $('#' + id) && shownValue($('#' + id)) !== STORED[id])
        .map(id => `${id}: shows ${JSON.stringify(shownValue($('#' + id)))}, stored ${JSON.stringify(STORED[id])}`);
    assert.deepEqual(wrong, []);
});

k.test('nothing-overwritten-at-load', S_GLOBAL, 'opening the page changes none of them in storage', () => {
    const rewritten = ctx.localWrites(0).flatMap(w => Object.entries(w.items))
        .filter(([id, v]) => KEYS.includes(id) && v !== STORED[id]).map(([id, v]) => id + ' = ' + JSON.stringify(v));
    assert.deepEqual(rewritten, []);
});

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

k.test('written-on-change', S_GLOBAL, 'a change is stored under the field\'s own key, as the default\'s type', async () => {
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
