// Spec 01 "Background Preference Snapshot and Menu Invalidation", invariant 4: menu rebuilds are
// coalesced inside mzta_Menus, not just at the callers.
//  - loadMenus() holds a _rebuildInFlight promise and a _rebuildPending slot; the work is in
//    _loadMenusUnguarded();
//  - three unsynchronized triggers reach _reload_menus(): the internal reload_menus message, the
//    external one from Sparks, and the debounced storage.onChanged handler; an overlapping rebuild
//    would otherwise wipe items the first one created (removeAll() before recreating each item),
//    or fail on duplicate ids;
//  - rebuilds coalesce rather than queue: N triggers collapse into the running rebuild plus ONE
//    trailing rerun, with the newest arguments; only the final state is observable;
//  - removeClickListener() runs under the guard, so a rebuild in flight never loses its listener.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { API, assertClean } from './flows.mjs';
import { menuItems } from './apis.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';

const ctx = await bgContext({
    local: { ...API, summarize: true, spamfilter: true, translate: true, add_tags: true },
});
const k = caseTests('32-menu-coalescing');
const menus = ctx.bg.$eval('menus');
const removeAlls = () => ctx.m.calls.filter(c => c.api === 'menus.removeAll').length;
const specialsInContext = () => menuItems(ctx.m).map(i => i.id).filter(id => id.startsWith('mzta-ctx-prompt_')).sort();
const menusListeners = () => ctx.ctl.browser.menus.onClicked._listeners.filter(fn => fn === menus.listener).length;

k.test('coalesce-three', 'three rebuilds requested together: the running one plus one trailing rerun, never three', async () => {
    const before = removeAlls();
    const a = menus.loadMenus(['prompt_summarize']);
    const b = menus.loadMenus([]);
    const c = menus.loadMenus(['prompt_spamfilter']);
    await Promise.all([a, b, c]);
    assert.equal(removeAlls() - before, 2);
    assert.deepEqual(ctx.m.menuErrors, [], 'no duplicate id: the rebuilds never interleaved');
});

k.test('newest-args', 'the trailing rerun is built from the newest request', () => {
    assert.deepEqual(specialsInContext(), ['mzta-ctx-prompt_spamfilter']);
});

k.test('all-callers-wait', 'every caller resolves only once the final state is built', async () => {
    let early = null;
    const a = menus.loadMenus(['prompt_summarize']);
    const b = menus.loadMenus(['prompt_translate_this']).then(() => { early = specialsInContext(); });
    await Promise.all([a, b]);
    assert.deepEqual(early, ['mzta-ctx-prompt_translate_this'], 'b resolved after the rerun with its own arguments');
});

k.test('later-rebuild-runs', 'a rebuild requested after the coalesced ones ended runs on its own', async () => {
    const before = removeAlls();
    await menus.loadMenus(['prompt_summarize', 'prompt_spamfilter']);
    assert.equal(removeAlls() - before, 1);
    assert.deepEqual(specialsInContext(), ['mzta-ctx-prompt_spamfilter', 'mzta-ctx-prompt_summarize']);
});

k.test('one-click-listener', 'after overlapping rebuilds mzta_Menus has exactly one click listener registered', () => {
    assert.equal(menusListeners(), 1);
});

k.test('real-triggers', 'the reload_menus message, Sparks\' reload_menus and a storage change, all at once: no duplicate, one trailing rerun at most', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const before = removeAlls();
    await ctx.ctl.browser.storage.local.set({ connection_type: 'chatgpt_api', translate: false });
    t.mock.timers.tick(200);
    const internal = ctx.ctl.dispatchMessage({ command: 'reload_menus' }, SENDERS.options);
    const external = ctx.ctl.browser.runtime.onMessageExternal._listeners[0]({ action: 'reload_menus' }, { id: 'thunderai-sparks@micz.it' });
    await Promise.all([internal, external]);
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    // The three reach loadMenus() while the first rebuild runs: the running one plus one rerun.
    assert.equal(removeAlls() - before, 2);
    assert.deepEqual(ctx.m.menuErrors, []);
    assert.equal(specialsInContext().includes('mzta-ctx-prompt_translate_this'), false, 'the final state reflects the last change');
    assert.equal(menusListeners(), 1);
});

k.test('reload-answers-true', 'the reload_menus message answers true once the menus are rebuilt', async () => {
    assert.equal(await ctx.ctl.dispatchMessage({ command: 'reload_menus' }, SENDERS.options), true);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
