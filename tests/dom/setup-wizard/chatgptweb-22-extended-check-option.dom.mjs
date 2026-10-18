// The extended model check option in the setup wizard, the other page that hosts the ChatGPT Web
// rows, stored on.
//
// Spec 04 "ChatGPT Web" (the ChatGPT Web rows are injected only for the two global consumers, the
// options page and the setup wizard, once, with unprefixed ids: the element id is the preference key)
// and spec 05 "UI & Feature Preferences" (`chatgpt_web_model_extended_check`): the checkbox is there
// once, restored checked, and saved under its key.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean
} from '../../helpers/core/dom-harness.mjs';
import { chatgptwebTests } from '../../helpers/known-issues/chatgptweb.mjs';

const KEY = 'chatgpt_web_model_extended_check';
const ctx = await openPage('setup-wizard', { local: { connection_type: 'chatgpt_web', [KEY]: true } });
after(() => ctx.close());
const k = chatgptwebTests('22');
const S_WEB = 'spec 04 "ChatGPT Web"';
const S_PREF = 'spec 05 "UI & Feature Preferences"';
const box = () => ctx.$('#' + KEY);

k.test('once', S_WEB, 'the checkbox is injected once, its id the preference key, right after the model row', () => {
    assert.equal(ctx.$$('#' + KEY).length, 1);
    assert.ok(box().closest('tr').previousElementSibling.querySelector('#chatgpt_web_model'));
});

k.test('restored', S_PREF, 'stored true: checked at load', () => {
    assert.equal(box().checked, true);
});

k.test('saved-off', S_PREF, 'unchecking it saves false under its key', async () => {
    const since = ctx.ctl.calls.length;
    box().checked = false;
    box().dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    await ctx.settle();
    assert.deepEqual(ctx.localWrites(since).map(c => c.items).filter(i => Object.hasOwn(i, KEY)), [{ [KEY]: false }]);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
