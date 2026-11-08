// The Smart bar page opened as the bar's "Details" link opens it (#activity), no policy, nothing
// stored in the smartbar store (the plugin's empty list).
//
// Spec 05 "Smart Bar Settings Page (`pages/smartbar/`)" and spec 10 "Feature page": the tab
// named by the hash is shown at load; the background selects another tab of the page already open
// by changing its hash (smartbar_open_page), which the page follows (hashchange); a tab clicked
// puts its name in the hash, so a later request for another tab is always a change. With nothing
// running and no error, the Activity tab opens on All, with the empty list's text.
// How the background finds the page already open, and focuses it, is
// tests/background/46-smartbar-activity.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('smartbar', { local: { connection_type: 'chatgpt_api', smartbar_enabled: true }, query: '#activity' });
after(() => ctx.close());
const k = uiTests('smartbar', '06');
const $ = ctx.$;
const S_PAGE = 'spec 05 "Smart Bar Settings Page (`pages/smartbar/`)"';
const S_FEATURE = 'spec 10 "Feature page"';
const S_ACT = 'spec 10 "Activity"';
const selected = () => ctx.$$('#smartbar_tabs [role="tab"]').filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.tab);

async function hashTo(hash) {
    ctx.window.location.hash = hash;
    ctx.window.dispatchEvent(new ctx.window.HashChangeEvent('hashchange'));
    await ctx.settle();
}

k.test('activity-at-load', S_FEATURE, 'opened on #activity: the Activity tab is shown', () => {
    assert.deepEqual(selected(), ['activity']);
    assert.equal($('#tab_activity').hidden, false);
    assert.equal($('#tab_options').hidden, true);
});

k.test('empty-all', S_ACT, 'nothing running and no error: the All filter, the empty list\'s text, nothing to stop or remove', () => {
    const checked = ctx.$$('#smartbar_activity .smartbar_filter').filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.filter);
    assert.deepEqual(checked, ['all']);
    assert.equal($('#smartbar_activity_empty').hidden, false);
    assert.equal($('#smartbar_stop_all').disabled, true);
    assert.equal($('#smartbar_remove_errors').disabled, true);
});

k.test('hash-change', S_FEATURE, 'a new hash on the open page selects that tab', async () => {
    await hashTo('#prompts');
    assert.deepEqual(selected(), ['prompts']);
    await hashTo('#activity');
    assert.deepEqual(selected(), ['activity']);
    await hashTo('#nonsense');
    assert.deepEqual(selected(), ['options'], 'an unknown tab is Options');
});

k.test('click-hash', S_PAGE, 'a tab clicked puts its name in the hash', async () => {
    await ctx.click($('#tab_btn_prompts'));
    assert.equal(ctx.window.location.hash, '#prompts');
    await ctx.click($('#tab_btn_activity'));
    assert.equal(ctx.window.location.hash, '#activity');
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
