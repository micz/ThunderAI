// The extended model check option on the options page, stored on.
//
// Spec 05 "UI & Feature Preferences" (`chatgpt_web_model_extended_check`) and spec 04 "ChatGPT Web"
// (the element id is the preference key: restoreOptions() fills it, saveOptions() writes it):
// a stored true shows checked, unchecking it saves false.

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
const ctx = await openPage('options', { local: { connection_type: 'chatgpt_web', [KEY]: true } });
after(() => ctx.close());
const k = chatgptwebTests('21');
const S_PREF = 'spec 05 "UI & Feature Preferences"';
const box = () => ctx.$('#' + KEY);

k.test('restored', S_PREF, 'stored true: checked at load', () => {
    assert.equal(box().checked, true);
});

k.test('saved-off', S_PREF, 'unchecking it saves false', async () => {
    const since = ctx.ctl.calls.length;
    box().checked = false;
    box().dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    await ctx.settle();
    assert.deepEqual(ctx.localWrites(since).map(c => c.items).filter(i => Object.hasOwn(i, KEY)), [{ [KEY]: false }]);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
