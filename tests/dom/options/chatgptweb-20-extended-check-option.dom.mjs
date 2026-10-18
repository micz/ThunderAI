// The extended model check option on the options page, with ChatGPT Web as the connection and
// nothing stored.
//
// Spec 05 "UI & Feature Preferences" (`chatgpt_web_model_extended_check`, default false), spec 05
// "Connection Settings Panel — Advanced Options Disclosure" (the ChatGPT Web toggles of the shared
// template: the `.mzta_switch` toggle in a flex wrapper with its text) and spec 04 "ChatGPT Web"
// (the ChatGPT Web rows carry unprefixed ids, the id is the preference key, saved by saveOptions()):
// an advanced ChatGPT Web row right after the model row, unchecked by default, never disabled - an
// empty model field included, since a prompt's own model can still ask for one - saved on change.
// Its help text is the en string, which names the models it verifies.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
    msg
} from '../../helpers/core/dom-harness.mjs';
import { chatgptwebTests } from '../../helpers/known-issues/chatgptweb.mjs';

const ctx = await openPage('options', { local: { connection_type: 'chatgpt_web' } });
after(() => ctx.close());
const k = chatgptwebTests('20');
const $ = ctx.$;
const KEY = 'chatgpt_web_model_extended_check';

const S_PREF = 'spec 05 "UI & Feature Preferences"';
const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
const S_WEB = 'spec 04 "ChatGPT Web"';

const box = () => $('#' + KEY);
const row = () => box().closest('tr');
const written = since => ctx.localWrites(since).map(c => c.items).filter(items => Object.hasOwn(items, KEY));
async function change(el) {
    el.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    await ctx.settle();
}

k.test('row-after-model', S_WEB, 'one checkbox, its id and name the preference key, in an advanced ChatGPT Web row right after the model row', () => {
    assert.equal(ctx.$$('#' + KEY).length, 1);
    assert.equal(box().name, KEY);
    assert.equal(box().type, 'checkbox');
    assert.ok(box().classList.contains('option-input'));
    assert.ok(row().classList.contains('conntype_chatgpt_web'));
    assert.ok(row().classList.contains('conn_adv'));
    const previous = row().previousElementSibling;
    assert.ok(previous && previous.querySelector('#chatgpt_web_model'), 'the row before is not the model row');
});

k.test('switch', S_ADV, 'the checkbox is the .mzta_switch toggle in a flex wrapper with its help text', () => {
    const label = box().closest('label');
    assert.ok(label.classList.contains('mzta_switch'));
    assert.ok(label.querySelector('span.track'));
    assert.equal(label.parentElement.style.display, 'flex');
});

k.test('texts', S_PREF, 'its title and help text are the en strings; the help names the two models it verifies', () => {
    assert.equal(row().querySelector('.opt_title').textContent.trim(), msg('prefs_OptionText_chatgpt_web_model_extended_check'));
    const info = msg('prefs_OptionText_chatgpt_web_model_extended_check_info');
    assert.ok(row().textContent.includes(info));
    assert.match(info, /\bgpt-6\b/);
    assert.match(info, /\bgpt-6-thinking\b/);
});

k.test('default-unchecked', S_PREF, 'nothing stored: unchecked', () => {
    assert.equal(box().checked, false);
});

k.test('enabled-empty-model', S_PREF, 'never disabled, the model field empty or not', async () => {
    const model = $('#chatgpt_web_model');
    assert.equal(model.value, '');
    assert.equal(box().disabled, false);
    model.value = 'gpt-6';
    await change(model);
    assert.equal(box().disabled, false);
    model.value = '';
    await change(model);
    assert.equal(box().disabled, false);
});

k.test('saved', S_PREF, 'checking and unchecking it saves true, then false, under its key', async () => {
    let since = ctx.ctl.calls.length;
    box().checked = true;
    await change(box());
    assert.deepEqual(written(since), [{ [KEY]: true }]);
    assert.equal(ctx.ctl.localData()[KEY], true);
    since = ctx.ctl.calls.length;
    box().checked = false;
    await change(box());
    assert.deepEqual(written(since), [{ [KEY]: false }]);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
