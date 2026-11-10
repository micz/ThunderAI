// The SmartBar settings page (pages/smartbar/) with an API global connection, no per-feature
// override, no policy.
//
// Spec 05 "SmartBar Settings Page (`pages/smartbar/`)": the tab strip (three tabs, Options shown
// when the URL has no hash), the stored settings shown in their sections, each change stored
// with its type (a select as its value, a number as a number and never below its minimum, an
// emptied number as its default, a textarea as typed), the sub-tabs of the Actions tab, the
// writing settings in execute's sub-tab, the three connection panels, one per special prompt,
// each in the sub-tab of its action with its own controls; the keyboard shortcut of the bar shown.
// The connection panels' policy behaviour is the managed area's (the 13-17 files of this folder).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    userSets,
    writtenSince,
} from '../../ui/dom-helpers.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    smartbar_enabled: true,
    smartbar_mode: 'expanded',
    smartbar_default_destination: 'chat',
    smartbar_history_size: 5,
    smartbar_parallel_limit: 2,
    smartbar_retention_days: 10,
    smartbar_retention_max_records: 50,
    smartbar_retention_error_days: 3,
    smartbar_additional_instructions: 'Be brief.\nNo emoji.',
};
const ctx = await openPage('smartbar', { local: STORED });
after(() => ctx.close());
const k = uiTests('smartbar', '01');
const $ = ctx.$;
const S_PAGE = 'spec 05 "SmartBar Settings Page (`pages/smartbar/`)"';
const PANELS = ['smartbar_router', 'smartbar_execute', 'smartbar_chat'];

k.test('tabs', S_PAGE, 'three tabs, Options selected with no hash, its panel alone shown', () => {
    const tabs = [...ctx.document.querySelectorAll('#smartbar_tabs [role="tab"]')];
    assert.deepEqual(tabs.map(t => t.dataset.tab), ['options', 'prompts', 'activity']);
    assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false']);
    assert.deepEqual(tabs.map(t => ctx.document.getElementById(t.getAttribute('aria-controls')).hidden), [false, true, true]);
    assert.equal(ctx.window.location.hash, '#options', 'the hash follows the tab shown');
});

k.test('restore', S_PAGE, 'the stored settings are shown', () => {
    assert.equal($('#smartbar_mode').value, 'expanded');
    assert.equal($('#smartbar_default_destination').value, 'chat');
    assert.equal($('#smartbar_history_size').valueAsNumber, 5);
    assert.equal($('#smartbar_parallel_limit').valueAsNumber, 2);
    assert.equal($('#smartbar_retention_days').valueAsNumber, 10);
    assert.equal($('#smartbar_retention_max_records').valueAsNumber, 50);
    assert.equal($('#smartbar_retention_error_days').valueAsNumber, 3);
    assert.equal($('#smartbar_additional_instructions').value, 'Be brief.\nNo emoji.');
    assert.equal($('#smartbar_signature').value, '');
    assert.equal($('#smartbar_max_body_length').valueAsNumber, 0);
});

k.test('modes', S_PAGE, 'the mode select offers disabled, compact, expanded; the destination execute and chat', () => {
    assert.deepEqual([...$('#smartbar_mode').options].map(o => o.value).sort(), ['compact', 'disabled', 'expanded']);
    assert.deepEqual([...$('#smartbar_default_destination').options].map(o => o.value), ['execute', 'chat']);
});

k.test('write-select', S_PAGE, 'a select is stored as its value', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_mode'), 'compact');
    assert.strictEqual(writtenSince(ctx, since).smartbar_mode, 'compact');
});

k.test('write-number', S_PAGE, 'a number is stored as a number, rounded, never below its minimum', async () => {
    let since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_retention_error_days'), '14');
    assert.strictEqual(writtenSince(ctx, since).smartbar_retention_error_days, 14);
    since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_parallel_limit'), '0');
    assert.strictEqual(writtenSince(ctx, since).smartbar_parallel_limit, 1);
    assert.equal($('#smartbar_parallel_limit').value, '1');
    since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_history_size'), '2.6');
    assert.strictEqual(writtenSince(ctx, since).smartbar_history_size, 3);
});

k.test('write-number-empty', S_PAGE, 'an emptied number stores its default, never null', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_retention_days'), '');
    assert.strictEqual(writtenSince(ctx, since).smartbar_retention_days, ctx.mods.prefs_default.smartbar_retention_days);
    assert.equal($('#smartbar_retention_days').valueAsNumber, ctx.mods.prefs_default.smartbar_retention_days);
});

k.test('write-textarea', S_PAGE, 'a textarea is stored as typed', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#smartbar_signature'), '  -- \nMic  ');
    assert.strictEqual(writtenSince(ctx, since).smartbar_signature, '  -- \nMic  ');
});

k.test('subtabs', S_PAGE, 'the Actions tab has one sub-tab per action, the first shown at load, a click shows its panel alone', async () => {
    const subtabs = () => [...ctx.document.querySelectorAll('#tab_prompts #smartbar_subtabs [role="tab"]')];
    const shown = () => subtabs().map(t => !ctx.document.getElementById(t.getAttribute('aria-controls')).hidden);
    assert.deepEqual(subtabs().map(t => t.dataset.subtab), ['router', 'execute', 'chat']);
    assert.deepEqual(subtabs().map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false']);
    assert.deepEqual(shown(), [true, false, false]);
    await ctx.click($('#subtab_btn_execute'));
    assert.deepEqual(subtabs().map(t => t.getAttribute('aria-selected')), ['false', 'true', 'false']);
    assert.deepEqual(shown(), [false, true, false]);
    assert.equal(ctx.window.location.hash, '#options', 'a sub-tab is not in the hash');
    await ctx.click($('#subtab_btn_router'));
    assert.deepEqual(shown(), [true, false, false]);
});

k.test('execute-settings', S_PAGE, 'the writing settings are in execute\'s sub-tab of the Actions tab, before its prompt section', () => {
    const settings = $('#smartbar_execute_settings');
    assert.ok($('#subtab_execute').contains(settings));
    assert.equal($('#tab_options').contains(settings), false, 'not left in the Options tab');
    for (const id of ['smartbar_max_body_length', 'smartbar_additional_instructions', 'smartbar_signature']) {
        assert.ok(settings.querySelector('#' + id), id);
    }
    assert.ok(settings.compareDocumentPosition($('#smartbar_prompt_execute_section')) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING);
});

k.test('three-panels', S_PAGE, 'three connection panels, one per special prompt, each in its prompt\'s section in the sub-tab of its action with its own switch and anchor, before the text', () => {
    for (const prefix of PANELS) {
        const key = prefix.replace('smartbar_', '');
        const section = ctx.document.getElementById('smartbar_prompt_' + key + '_section');
        assert.ok(section, prefix);
        assert.ok(ctx.document.getElementById('subtab_' + key).contains(section), prefix + ' in its sub-tab of the Actions tab');
        const sw = section.querySelector('#' + prefix + '_use_specific_integration');
        assert.ok(sw, prefix + ' switch');
        assert.ok(section.querySelector('#' + prefix + '_connection_ui_anchor'), prefix + ' anchor');
        const text = section.querySelector('#smartbar_prompt_' + key + '_text');
        assert.ok(sw.compareDocumentPosition(text) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, prefix + ' switch before the text');
    }
    assert.equal(ctx.document.querySelector('#tab_options [id$="_use_specific_integration"]'), null, 'no switch left in the Options tab');
});

k.test('panel-switch', S_PAGE, 'each panel\'s own switch stores its own preference', async () => {
    for (const prefix of PANELS) {
        const since = ctx.ctl.calls.length;
        await userSets(ctx, $('#' + prefix + '_use_specific_integration'), true);
        const written = writtenSince(ctx, since);
        assert.strictEqual(written[prefix + '_use_specific_integration'], true, prefix);
        for (const other of PANELS.filter(p => p !== prefix)) {
            assert.ok(!(other + '_use_specific_integration' in written), prefix + ' leaves ' + other + ' alone');
        }
    }
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
