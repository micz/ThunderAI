// Spec 02 "Context Menu", "Several messages" [#979]: with more than one message in the message list
// context (several selected, a collapsed thread, a paginated MessageList) the prompts that read
// only the displayed message are DISABLED, never hidden; only those isMultiMessagePrompt() names -
// the four the context menu hands to processEmails() - stay enabled. One message: all enabled.
//  - the items are created enabled; menus.onShown (js/mzta-menus.js onMenuShown()) changes them;
//  - only the items whose state changes are updated, and menus.refresh() runs only after a change;
//  - a showing that was closed (onHidden) or replaced while its updates ran does not refresh;
//  - other contexts are left alone;
//  - a submenu left with no enabled item is disabled with them;
//  - allow_multi is read from the shipped definitions only: a custom prompt carrying it stays
//    disabled.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    setPrefs,
    assertClean
} from './flows.mjs';
import { menuItems } from './apis.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const MULTI = ['prompt_add_tags', 'prompt_spamfilter', 'prompt_summarize', 'prompt_translate_this'];
const custom = (id, o = {}) => ({ id, name: id, text: 'Do ' + id, type: '1', action: '0', is_default: '0', is_special: '0', need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', show_in: 'context', ...o });
const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, translate: true, spamfilter: true, add_tags: true,
        _custom_prompt: [
            custom('c_plain'),
            custom('c_claims_multi', { allow_multi: true }),
        ],
    },
    setup(m) {
        for (const n of [1, 2, 3]) H['m' + n] = m.addMessage({ headerMessageId: 'm' + n + '@x' });
        m.addTab({ id: 7, type: 'mail', active: true });
    },
});
const k = caseTests('39-context-menu-multi');
const menus = () => ctx.bg.$eval('menus');
const children = () => menuItems(ctx.m).filter(i => i.parentId === 'mzta-context-parent');
const enabledOf = () => Object.fromEntries(children().map(i => [i.id.replace('mzta-ctx-', ''), i.enabled]));
const parentEnabled = () => menuItems(ctx.m).find(i => i.id === 'mzta-context-parent').enabled;
const calls = api => ctx.m.calls.filter(c => c.api === api);
const reset = () => { ctx.m.calls.length = 0; };
/** Open the message list context menu on `headers` (a MessageList of `pageSize` per page). */
const show = (headers, { pageSize, contexts = ['message_list'] } = {}) => menus().onMenuShown(
    { contexts, menuIds: ['mzta-context-parent'], selectedMessages: ctx.m.messageList(headers, pageSize) },
    { id: 7, type: 'mail', windowId: 1 });

k.test('created-enabled', 'every item is created enabled', () => {
    const ids = Object.keys(enabledOf());
    for (const id of [...MULTI, 'c_plain', 'c_claims_multi']) assert.ok(ids.includes(id), id + ' in the context menu');
    assert.ok(Object.values(enabledOf()).every(Boolean));
    assert.ok(parentEnabled());
});

k.test('helper', 'isMultiMessagePrompt() names exactly the four prompts processEmails() takes', () => {
    for (const id of MULTI) assert.equal(ctx.prompts.isMultiMessagePrompt(id), true, id);
    for (const id of ['prompt_reply', 'prompt_get_task', 'prompt_get_calendar_event', 'c_claims_multi', 'nope']) {
        assert.equal(ctx.prompts.isMultiMessagePrompt(id), false, id);
    }
});

k.test('single-unchanged', 'one message: all enabled, nothing updated, no refresh', async () => {
    reset();
    await show([H.m1]);
    assert.ok(Object.values(enabledOf()).every(Boolean));
    assert.equal(calls('menus.update').length, 0);
    assert.equal(calls('menus.refresh').length, 0);
});

k.test('multi', 'two messages: only the four multi-message prompts stay enabled, then one refresh', async () => {
    reset();
    await show([H.m1, H.m2]);
    for (const [id, enabled] of Object.entries(enabledOf())) assert.equal(enabled, MULTI.includes(id), id);
    assert.ok(parentEnabled(), 'the submenu still holds enabled items');
    assert.equal(calls('menus.refresh').length, 1);
});

k.test('injected-flag-ignored', 'a custom prompt saved with allow_multi is disabled all the same, and its object has no such field', () => {
    assert.equal(enabledOf().c_claims_multi, false);
    const loaded = menus().allPrompts.find(p => p.id === 'c_claims_multi');
    assert.equal('allow_multi' in loaded, false);
    for (const p of menus().allPrompts) assert.equal('allow_multi' in p, false, p.id);
});

k.test('multi-again-no-refresh', 'the same multi-selection again: nothing changes, no update, no refresh', async () => {
    reset();
    await show([H.m2, H.m3]);
    assert.equal(calls('menus.update').length, 0);
    assert.equal(calls('menus.refresh').length, 0);
});

k.test('back-to-single', 'back to one message: every item enabled again', async () => {
    reset();
    await show([H.m3]);
    assert.ok(Object.values(enabledOf()).every(Boolean));
    assert.equal(calls('menus.refresh').length, 1);
});

k.test('paginated', 'a MessageList with further pages counts as several messages, its pages are not fetched', async () => {
    reset();
    await show([H.m1, H.m2], { pageSize: 1 });
    assert.equal(enabledOf().c_plain, false);
    assert.equal(enabledOf().prompt_summarize, true);
    assert.equal(calls('messages.continueList').length, 0);
    await show([H.m1]);
});

k.test('other-context', 'a menu shown in another context is left alone', async () => {
    reset();
    await show([H.m1, H.m2], { contexts: ['tab'] });
    assert.equal(calls('menus.update').length, 0);
    assert.ok(Object.values(enabledOf()).every(Boolean));
});

k.test('stale-no-refresh', 'a showing closed while its updates run does not refresh; the next one starts from the set state', async () => {
    reset();
    const pending = show([H.m1, H.m2]);
    menus().onMenuHidden();
    await pending;
    assert.equal(enabledOf().c_plain, false, 'the state is set anyway');
    assert.equal(calls('menus.refresh').length, 0);
    reset();
    const first = show([H.m1]);
    const second = show([H.m1, H.m2]);
    await Promise.all([first, second]);
    assert.equal(enabledOf().c_plain, false, 'the newest showing wins');
    assert.equal(calls('menus.refresh').length, 1, 'only the newest showing refreshes');
    await show([H.m1]);
});

k.test('parent-disabled', 'a submenu left with no enabled item is disabled, and enabled again with one message', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize: false, translate: false, spamfilter: false, add_tags: false });
    await ctx.bg._reload_menus();
    assert.equal(MULTI.some(id => id in enabledOf()), false, 'no multi-message prompt in the menu');
    await show([H.m1, H.m2]);
    assert.equal(parentEnabled(), false);
    await show([H.m1]);
    assert.equal(parentEnabled(), true);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assert.deepEqual(ctx.m.menuErrors, []);
    assertClean(ctx);
});

k.coverage();
