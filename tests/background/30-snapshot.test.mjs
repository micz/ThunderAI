// Spec 01 "Background Preference Snapshot and Menu Invalidation", the first three invariants (the
// fourth, the rebuild coalescing inside mzta_Menus, is 32-menu-coalescing):
//  1. special-prompt menu gating reads storage FRESH, never prefs_init: _computeActiveSpecialIds()
//     is the single source of truth (_reload_menus(), get_active_special_ids and the startup
//     build go through it), computed from each feature's EFFECTIVE connection, so a feature on
//     its own API integration stays available under ChatGPT Web;
//  2. storage.onChanged handling is coalesced (a 200 ms debounce) and refreshes the snapshot
//     before rebuilding the menus (reload_pref_init() -> _reload_menus(): doGetSparkFeature()
//     consults the _sparks_presence the former sets);
//  3. the two staleness flags accumulate across a burst and are cleared only when the debounced
//     work runs.
// And: the listener gates on areaName === 'local' (spec 01 "Storage"); keys the policy locks are
// filtered (managed area: not tested here); reload_pref_init() is gated on PREFS_INIT_KEYS, NOT on
// the menu keys (add_tags_auto, summarize_auto, translate_auto feed _process_incoming), so
// _sparks_presence refreshes only when a PREFS_INIT_KEYS key changes; MENU_RELEVANT_KEYS holds
// the per-feature integration keys of every feature, calendar_no_selection and _custom_placeholder
// (spec 05 `calendar_no_selection` row: "A change reloads the menus").
// _reconcileFeatureFlags() heals first: a flag left true on an absent connection is turned off.
// Every test runs on node:test's mock clock; one context for the file.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { API, assertClean } from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';

// The Sparks add-on: absent at start. reload_pref_init() is the only caller of the presence
// check in the background, so each check counts one snapshot refresh.
let sparks = null;
const seq = [];
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 1,
        translate: true, translate_auto: 0,
        spamfilter: false, add_tags: false, add_tags_auto: false,
        get_calendar_event: true, get_task: true,
    },
    external: (id, msg) => { if (msg?.action === 'checkPresence') seq.push('snapshot'); return sparks; },
});
const k = caseTests('30-snapshot');
const browser = ctx.ctl.browser;
const realRemoveAll = browser.menus.removeAll;
browser.menus.removeAll = async () => { seq.push('menus'); return realRemoveAll(); };
const prefsInit = () => ctx.bg.$eval('prefs_init');
const turns = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
/** Tick the mock clock by ms, then let the async work it fired run. */
const advance = async (t, ms) => { t.mock.timers.tick(ms); await turns(); };
const write = (items, area = 'local') => browser.storage[area].set(items);
const shortcutIds = () => ctx.bg.$eval('menus').shortcutMenu.map(e => e.id);
const take = () => seq.splice(0);

k.test('fresh-read', 'the menu gating reads storage fresh: a change the snapshot has not seen yet is already applied', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await write({ summarize: false });
    assert.equal(prefsInit().summarize, true, 'the snapshot is still stale (the debounce has not fired)');
    assert.equal((await ctx.bg._computeActiveSpecialIds()).includes('prompt_summarize'), false);
    await advance(t, 200);
    await write({ summarize: true });
    await advance(t, 200);
    take();
});

k.test('effective-connection', 'a feature on its own API integration stays available with ChatGPT Web as the global connection', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await write({ connection_type: 'chatgpt_web', summarize_use_specific_integration: true, summarize_connection_type: 'ollama_api', ollama_host: 'http://localhost:11434', ollama_model: 'm' });
    await advance(t, 200);
    const ids = await ctx.bg._computeActiveSpecialIds();
    assert.ok(ids.includes('prompt_summarize'), JSON.stringify(ids));
    assert.equal(ids.includes('prompt_translate_this'), false, 'translate follows the global ChatGPT Web: not usable');
    assert.ok(shortcutIds().includes('prompt_summarize'), 'and the rebuilt menus show it');
    take();
});

k.test('get-active-special-ids', 'the get_active_special_ids command answers the same fresh computation', async () => {
    const answer = await ctx.ctl.dispatchMessage({ command: 'get_active_special_ids' }, SENDERS.options);
    assert.deepEqual(answer, await ctx.bg._computeActiveSpecialIds());
});

k.test('debounce-200', 'a preference change refreshes the snapshot 200 ms later, not before', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ do_debug: true });
    await advance(t, 199);
    assert.equal(prefsInit().do_debug, false, 'not yet');
    assert.deepEqual(take(), []);
    await advance(t, 1);
    assert.equal(prefsInit().do_debug, true);
    assert.deepEqual(take(), ['snapshot']);
});

k.test('coalesced', 'a burst of changes (one key per event, less than 200 ms apart) gives one refresh and one rebuild', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ connection_type: 'chatgpt_api' });
    await advance(t, 150);
    await write({ summarize_use_specific_integration: false });
    await advance(t, 150);
    await write({ do_debug: false });
    assert.deepEqual(take(), [], 'nothing while the burst lasts');
    await advance(t, 200);
    assert.deepEqual(take(), ['snapshot', 'menus']);
});

k.test('snapshot-before-menus', 'the snapshot is refreshed before the menus are rebuilt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ connection_type: 'chatgpt_api', translate: true });
    await advance(t, 200);
    assert.deepEqual(take(), ['snapshot', 'menus']);
});

k.test('sparks-before-menus', 'Sparks detected by the refresh shows the calendar and task prompts in the same rebuild', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(shortcutIds().includes('prompt_get_calendar_event'), false, 'Sparks absent: no calendar prompt');
    sparks = '9.9.9';
    await write({ connection_type: 'chatgpt_api', chatgpt_model: 'gpt-test-2' });
    await advance(t, 200);
    assert.ok(shortcutIds().includes('prompt_get_calendar_event'));
    assert.ok(shortcutIds().includes('prompt_get_task'));
    take();
});

k.test('flags-accumulate-menu-first', 'a menu key then a snapshot-only key in one burst: the menus are still rebuilt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-FAKE-2' });
    await advance(t, 50);
    await write({ do_debug: true });
    await advance(t, 200);
    assert.deepEqual(take(), ['snapshot', 'menus']);
});

k.test('flags-accumulate-prefs-last', 'a menu-only key then a snapshot-only key in one burst: both the refresh and the rebuild run', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ calendar_no_selection: true });
    await advance(t, 50);
    await write({ do_debug: false });
    await advance(t, 200);
    assert.deepEqual(take(), ['snapshot', 'menus']);
});

k.test('prefs-only', 'a snapshot key that does not affect the menus refreshes the snapshot and rebuilds nothing', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ spamfilter_show_msg_panel: false });
    await advance(t, 200);
    assert.deepEqual(take(), ['snapshot']);
    assert.equal(prefsInit().spamfilter_show_msg_panel, false);
});

k.test('menu-only', 'a menu key that is not in the snapshot (calendar_no_selection) rebuilds the menus and does not re-check Sparks', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ calendar_no_selection: false });
    await advance(t, 200);
    assert.deepEqual(take(), ['menus']);
});

for (const key of ['translate_use_specific_integration', 'get_task_connection_type', 'spamfilter_use_specific_integration', '_custom_placeholder']) {
    k.test('menu-key-' + key.replace(/_/g, '-').replace(/^-/, ''), `${key} is menu-relevant: a change rebuilds the menus`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        take();
        await write({ [key]: key === '_custom_placeholder' ? [] : (key.endsWith('_type') ? '' : false) });
        await advance(t, 200);
        assert.ok(take().includes('menus'));
    });
}

k.test('irrelevant-key', 'a key that is neither in the snapshot nor menu-relevant does nothing', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ chatgpt_win_width: 900 });
    await advance(t, 1000);
    assert.deepEqual(take(), []);
});

k.test('records-ignored', 'a per-message record written to storage.local does nothing', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ 'msg:any@x': { v: 1, ts: 1, summary: { summary: 's' } } });
    await advance(t, 1000);
    assert.deepEqual(take(), []);
});

k.test('other-area-ignored', 'a change in storage.sync or storage.session does nothing: preferences live in storage.local', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    take();
    await write({ do_debug: true, connection_type: '' }, 'sync');
    await write({ do_debug: true }, 'session');
    await advance(t, 1000);
    assert.deepEqual(take(), []);
    assert.equal(prefsInit().connection_type, 'chatgpt_api');
});

k.test('process-incoming', 'add_tags_auto (not a menu key) still refreshes _process_incoming', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(ctx.bg.$eval('_process_incoming'), false);
    await write({ add_tags_auto: true });
    await advance(t, 200);
    assert.equal(ctx.bg.$eval('_process_incoming'), true);
    await write({ add_tags_auto: false, translate_auto: 3 });
    await advance(t, 200);
    assert.equal(ctx.bg.$eval('_process_incoming'), true, 'translate_auto = 3 alone wakes it too');
    await write({ translate_auto: 0 });
    await advance(t, 200);
    assert.equal(ctx.bg.$eval('_process_incoming'), false);
    take();
});

k.test('heal', 'a feature flag left on with no connection at all is turned off, and its prompt leaves the menus', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await write({ connection_type: '', summarize: true, summarize_use_specific_integration: false });
    await advance(t, 200);
    await advance(t, 200);
    assert.equal(ctx.ctl.localData().summarize, false, 'healed in storage');
    assert.equal(shortcutIds().includes('prompt_summarize'), false);
    assert.equal(prefsInit().summarize, false, 'and in the snapshot');
    take();
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
