// What the background does for the SmartBar page and the badge (claude-spec/10-smartbar.md
// "Feature page", "Activity", "Badge"), through its real runtime.onMessage listener:
//  - the Activity commands are accepted from the SmartBar page only;
//  - smartbar_activity_list: the records of a filter, newest first, an instruction in progress as
//    it is in memory (live), with the counts of the running and the error records;
//  - the badge of both actions: the running operations (the router at work counts as one) plus
//    the operations in error; red with at least one error; a pending confirmation, a dismissed
//    error and a Stop (aborted) are not counted; cleared when the feature is turned off;
//  - every change reaches the badge, the bar of the message (smartbar_update) and the page
//    (smartbar_activity_changed): Stop, Retry, Remove, Stop all, Remove all errors from the page,
//    and a dismiss from the bar;
//  - Open (messageDisplay.open in its default place), Open in chat (json errors only: the message
//    opened, then its chat);
//  - smartbar_open_page: the page opened once; a second request brings it to front and selects
//    the requested tab through its hash.
// The page itself is tests/dom/smartbar/ui-05-activity and ui-06-open-tab; the store's queries
// are the smartbar area's (07-activity).

import assert from 'node:assert/strict';
import {
    bgContext,
    STARTUP
} from './context.mjs';
import {
    answering,
    holding
} from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    fromTab,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ROUTER_MARK = 'Reply with one JSON object and nothing else';
const routes = {};          // instruction -> the router's raw answer
const RED = '#d70022';

const ctx = await bgContext({
    // The bars and the badge follow the feature switch: the listener the startup registers.
    statements: [...STARTUP, 'setupSmartbarConfigListener();'],
    overrides: {
        splitQuotedHtml: (html) => ({ own: String(html ?? '').replace(/<br>/g, '\n'), quoted: '' }),
    },
    local: {
        ...API,
        smartbar_enabled: true,
        summarize: true,
        summarize_auto: 0,
        summarize_display_mode: 'inline',
        translate: true,
        translate_auto: 0,
        translate_lang: 'Italian',
    },
    mail: {
        accounts: [{ id: 'acc1', name: 'Account 1', identities: [{ id: 'id1', email: 'me@example.test' }] }],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', windowId: 1, active: true });
        m.addTab({ id: 8, type: 'mail', windowId: 1 });
    },
});
const k = caseTests('46-smartbar-activity');

const instructionOf = prompt => (/Instruction:\n([^\n]*)/.exec(prompt) || [])[1];
const respondAll = answering((prompt) => {
    const p = String(prompt);
    if (p.includes(ROUTER_MARK)) return routes[instructionOf(p)] ?? '{"operations": [], "context": [], "unrecognized": ""}';
    const f = featureOf(p);
    if (f === 'summary') return 'Summary of **' + messageOf(p) + '**';
    if (f === 'translation') return JSON.stringify({ subject: 'Betreff', body: 'Text', status: '1' });
    throw new Error('46-smartbar-activity: unexpected prompt ' + p.slice(0, 80));
});
ctx.workers.respond = respondAll;

const { taSmartbarStore } = await import('../../js/mzta-smartbar-store.js');
const settle = async (n = 200) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = o => JSON.stringify(o);
const op = (id, params = {}) => ({ id, params });
const PAGE_URL = ctx.ctl.browser.runtime.getURL('pages/smartbar/mzta-smartbar.html');

const show = (tabId, hid) => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId: 'f-inbox', subject: 'Subject of ' + hid,
        author: 'Alice Smith <alice@example.com>' });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const run = (tabId, hid, instruction) => fromTab(ctx, tabId, { command: 'smartbar_run', headerMessageId: hid, instruction }, { turns: 200 });
/** A command of the SmartBar page, from its tab. */
async function fromPage(message) {
    const answer = await ctx.ctl.dispatchMessage(message, { id: 'thunderai@micz.it', url: PAGE_URL + '#activity', tab: { id: 300, type: 'content' } });
    await settle();
    return answer;
}
const badge = () => ctx.m.badges.messageDisplayAction;
const badgesAgree = () => assert.deepEqual(ctx.m.badges.composeAction, ctx.m.badges.messageDisplayAction, 'the two actions show different badges');
const pageToldSince = n => ctx.ctl.sent.slice(n).filter(m => m?.command === 'smartbar_activity_changed').length;
const barUpdatesSince = (n, tabId) => ctx.m.tabSends.slice(n).filter(s => s.tabId === tabId && s.message?.command === 'smartbar_update').map(s => s.message);
const unreadable = instruction => { routes[instruction] = 'this is not JSON'; };
/** Hold the router calls until released; resolves once `count` are held. */
async function holdRouters(count = 1) {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    return {
        hold,
        async ready() { for (let i = 0; i < 400 && hold.held.length < count; i++) await new Promise(r => setImmediate(r)); },
        restore() { ctx.workers.respond = respondAll; },
    };
}

k.test('page-only', 'the Activity commands are refused from anything but the SmartBar page', async () => {
    show(7, 'po@x');
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_activity_list', filter: 'all' }), { ok: false, error: 'not_page' });
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_activity_stop_all' }), { ok: false, error: 'not_page' });
    const answer = await fromPage({ command: 'smartbar_activity_list', filter: 'all' });
    assert.equal(answer.ok, true);
});

k.test('badge-running', 'an instruction at work: the badge counts the router as one, neutral; the list shows it live; done clears the badge', async () => {
    routes['summarize it'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    const h = await holdRouters(1);
    show(7, 'r1@x');
    const sentBefore = ctx.ctl.sent.length;
    const pending = run(7, 'r1@x', 'summarize it');
    await h.ready();
    await settle();
    assert.equal(badge().text, '1');
    assert.notEqual(badge().color, RED);
    badgesAgree();
    assert.ok(pageToldSince(sentBefore) > 0, 'the page was not told');
    const list = await fromPage({ command: 'smartbar_activity_list', filter: 'running' });
    assert.deepEqual(list.records.map(r => [r.instruction, r.state, r.live]), [['summarize it', 'running', true]]);
    assert.equal(list.counts.running, 1);
    assert.equal(list.records[0].rawResponse, undefined, 'a raw answer reached the page');
    h.hold.held[0].answer(routes['summarize it']);
    h.restore();
    await pending;
    await settle();
    assert.equal((await taSmartbarStore.latest('r1@x')).state, 'done');
    assert.equal(badge().text, '');
    badgesAgree();
});

k.test('badge-errors', 'an error makes the badge red; running and errors add up; a dismissed error is not counted', async () => {
    unreadable('read this');
    show(7, 'e1@x');
    await run(7, 'e1@x', 'read this');
    await settle();
    assert.equal((await taSmartbarStore.latest('e1@x')).errorType, 'json');
    assert.deepEqual(badge(), { text: '1', color: RED });
    unreadable('read that');
    show(8, 'e2@x');
    await run(8, 'e2@x', 'read that');
    await settle();
    assert.deepEqual(badge(), { text: '2', color: RED });
    // One more at work: 2 errors + the router = 3.
    const h = await holdRouters(1);
    show(7, 'e3@x');
    const pending = run(7, 'e3@x', 'nothing to do');
    await h.ready();
    await settle();
    assert.deepEqual(badge(), { text: '3', color: RED });
    h.hold.held[0].answer('{"operations": [], "context": [], "unrecognized": ""}');
    h.restore();
    await pending;
    await settle();
    // The bar's × on the error of e2: dismissed, not counted.
    const e2 = await taSmartbarStore.latest('e2@x');
    show(8, 'e2@x');
    await fromTab(ctx, 8, { command: 'smartbar_dismiss', headerMessageId: 'e2@x', recordId: e2.id, what: 'error' });
    await settle();
    assert.deepEqual(badge(), { text: '1', color: RED });
    badgesAgree();
});

k.test('not-counted', 'a pending confirmation and a Stop (aborted) are not counted; a stored record not in memory is not Running', async () => {
    const before = badge().text;
    await taSmartbarStore.create({ ...(await taSmartbarStore.latest('r1@x')), id: undefined, state: 'pending_confirmation',
        operations: [{ index: 0, id: 'summarize', params: {}, state: 'pending_confirmation' }] });
    const h = await holdRouters(1);
    show(7, 'st@x');
    const pending = run(7, 'st@x', 'stop me');
    await h.ready();
    const stopped = await fromPage({ command: 'smartbar_activity_list', filter: 'running' });
    const id = stopped.records.find(r => r.messageId === 'st@x').id;
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_stop', recordId: id }), { ok: true });
    h.restore();
    await pending;
    await settle();
    assert.equal((await taSmartbarStore.get(id)).errorType, 'aborted');
    assert.equal(badge().text, before, 'a pending confirmation or a Stop changed the count');
    assert.deepEqual((await fromPage({ command: 'smartbar_activity_list', filter: 'running' })).records, [],
        'a stored pending record with nothing in memory listed as Running');
});

k.test('list-filters', 'the list of each filter: Errors the records in error, All everything newest first, with the counts', async () => {
    const errors = await fromPage({ command: 'smartbar_activity_list', filter: 'errors' });
    assert.ok(errors.records.length >= 2);
    assert.ok(errors.records.every(r => r.state === 'error' && r.live === false));
    const all = await fromPage({ command: 'smartbar_activity_list', filter: 'all' });
    const ids = all.records.map(r => r.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'not newest first');
    assert.equal(all.counts.running, 0);
    assert.equal(all.counts.errors, errors.records.length);
    assert.equal(all.more, false);
    const older = await fromPage({ command: 'smartbar_activity_list', filter: 'all', beforeId: ids[1] });
    assert.deepEqual(older.records.map(r => r.id), ids.slice(2), 'the next page starts after beforeId');
});

k.test('retry', 'Retry from the page: a failed router runs again as a new instruction, which the bar of the message shows', async () => {
    routes['read this'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    const failed = await taSmartbarStore.latest('e1@x');
    show(7, 'e1@x');
    const n = ctx.m.tabSends.length;
    const answer = await fromPage({ command: 'smartbar_activity_retry', recordId: failed.id });
    assert.equal(answer.ok, true);
    await settle();
    const latest = await taSmartbarStore.latest('e1@x');
    assert.notEqual(latest.id, failed.id);
    assert.equal(latest.state, 'done');
    assert.ok(barUpdatesSince(n, 7).some(u => u.record?.id === latest.id), 'the bar of the message was not updated');
});

k.test('retry-line', 'Retry of one failed operation from the page: that line runs again on the same record', async () => {
    let fail = true;
    ctx.workers.respond = answering((prompt) => {
        const p = String(prompt);
        if (p.includes(ROUTER_MARK)) return json({ operations: [op('translate')], context: [], unrecognized: '' });
        if (featureOf(p) === 'translation' && fail) return { error: 'Server error 500' };
        return JSON.stringify({ subject: 'Betreff', body: 'Text', status: '1' });
    });
    show(7, 'tl@x');
    await run(7, 'tl@x', 'translate it');
    await settle();
    const rec = await taSmartbarStore.latest('tl@x');
    assert.equal(rec.operations[0].state, 'error');
    fail = false;
    assert.equal((await fromPage({ command: 'smartbar_activity_retry', recordId: rec.id, index: 0 })).ok, true);
    await settle();
    ctx.workers.respond = respondAll;
    const after = await taSmartbarStore.get(rec.id);
    assert.equal(after.operations[0].state, 'done');
    assert.equal(after.state, 'done');
});

k.test('remove', 'Remove from the page: the record is gone, the bar shows the record left, the page is told; a running record is kept', async () => {
    const latest = await taSmartbarStore.latest('e1@x');
    show(7, 'e1@x');
    const n = ctx.m.tabSends.length;
    const sentBefore = ctx.ctl.sent.length;
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_remove', recordId: latest.id }), { ok: true });
    assert.equal(await taSmartbarStore.get(latest.id), null);
    const update = barUpdatesSince(n, 7).at(-1);
    assert.ok(update, 'the bar was not updated');
    assert.notEqual(update.record?.id, latest.id, 'the bar still shows the removed record');
    assert.ok(pageToldSince(sentBefore) > 0);

    const h = await holdRouters(1);
    show(8, 'rr@x');
    const pending = run(8, 'rr@x', 'keep me');
    await h.ready();
    const live = (await fromPage({ command: 'smartbar_activity_list', filter: 'running' })).records[0];
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_remove', recordId: live.id }), { ok: false, error: 'running' });
    assert.ok(await taSmartbarStore.get(live.id));
    h.hold.held[0].answer('{"operations": [], "context": [], "unrecognized": ""}');
    h.restore();
    await pending;
    await settle();
});

k.test('stop-all', 'Stop all from the page stops every instruction in progress, of every message; the bars and the badge follow', async () => {
    const h = await holdRouters(2);
    show(7, 'sa1@x');
    show(8, 'sa2@x');
    const p1 = run(7, 'sa1@x', 'first');
    const p2 = run(8, 'sa2@x', 'second');
    await h.ready();
    await settle();
    assert.ok(Number(badge().text) >= 2);
    const n = ctx.m.tabSends.length;
    const answer = await fromPage({ command: 'smartbar_activity_stop_all' });
    assert.deepEqual(answer, { ok: true, stopped: 2 });
    h.restore();
    await Promise.all([p1, p2]);
    await settle();
    for (const hid of ['sa1@x', 'sa2@x']) assert.equal((await taSmartbarStore.latest(hid)).errorType, 'aborted', hid);
    assert.ok(barUpdatesSince(n, 7).length > 0 && barUpdatesSince(n, 8).length > 0, 'a bar was not updated');
    assert.equal((await fromPage({ command: 'smartbar_activity_list', filter: 'running' })).records.length, 0);
});

k.test('remove-errors', 'Remove all errors from the page: every record in error goes, the badge is cleared, the bars follow', async () => {
    unreadable('again unreadable');
    show(7, 're@x');
    await run(7, 're@x', 'again unreadable');
    await settle();
    assert.equal(badge().color, RED);
    const n = ctx.m.tabSends.length;
    const answer = await fromPage({ command: 'smartbar_activity_remove_errors' });
    assert.equal(answer.ok, true);
    assert.ok(answer.removed >= 1);
    assert.deepEqual(await taSmartbarStore.byState('error'), []);
    assert.equal(badge().text, '');
    assert.ok(barUpdatesSince(n, 7).length > 0, 'the bar of the message was not updated');
});

k.test('open', 'Open from the page opens the message in its default place', async () => {
    const rec = await taSmartbarStore.latest('r1@x');
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_open', recordId: rec.id }), { ok: true });
    const call = ctx.m.calls.filter(c => c.api === 'messageDisplay.open').at(-1);
    assert.deepEqual(call.args[0], { messageId: ctx.m.byHeaderId('r1@x').id, location: 'default' });
});

k.test('open-chat', 'Open in chat from the page: only for a json error; the message is opened, then its chat', async () => {
    const done = await taSmartbarStore.latest('r1@x');
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_open_chat', recordId: done.id }), { ok: false });
    unreadable('chat about it');
    show(7, 'oc@x');
    await run(7, 'oc@x', 'chat about it');
    await settle();
    const failed = await taSmartbarStore.latest('oc@x');
    const opens = ctx.m.calls.filter(c => c.api === 'messageDisplay.open').length;
    const windows = ctx.m.windows.length;
    assert.deepEqual(await fromPage({ command: 'smartbar_activity_open_chat', recordId: failed.id }), { ok: true });
    assert.equal(ctx.m.calls.filter(c => c.api === 'messageDisplay.open').length, opens + 1);
    assert.equal(ctx.m.windows.length, windows + 1);
    assert.match(ctx.m.windows.at(-1).url, /smartbar=1&hid=oc%40x/);
});

k.test('open-page', 'smartbar_open_page opens the page once; a second request brings it to front on the requested tab', async () => {
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_open_page', tab: 'activity' }), { ok: true, tabId: ctx.m.tabs.at(-1).id });
    const created = ctx.m.calls.filter(c => c.api === 'tabs.create');
    assert.equal(created.length, 1);
    assert.equal(created[0].args[0].url, PAGE_URL + '#activity');
    const pageTab = ctx.m.tabs.at(-1).id;
    await fromTab(ctx, 7, { command: 'smartbar_open_page', tab: 'prompts' });
    assert.equal(ctx.m.calls.filter(c => c.api === 'tabs.create').length, 1, 'a second page was opened');
    assert.deepEqual(ctx.m.calls.filter(c => c.api === 'tabs.update').at(-1).args, [pageTab, { active: true, url: PAGE_URL + '#prompts' }]);
    assert.ok(ctx.m.calls.some(c => c.api === 'windows.update' && c.args[1]?.focused === true), 'its window was not brought to front');
    // No tab named (the options page's Manage settings): the page as it is, brought to front.
    await fromTab(ctx, 7, { command: 'smartbar_open_page' });
    assert.deepEqual(ctx.m.calls.filter(c => c.api === 'tabs.update').at(-1).args, [pageTab, { active: true }]);
    assert.equal(ctx.m.calls.filter(c => c.api === 'tabs.create').length, 1);
});

k.test('disabled', 'the feature turned off clears the badge; turned on, the errors are counted again', async () => {
    unreadable('one more error');
    show(7, 'ds@x');
    await run(7, 'ds@x', 'one more error');
    await settle();
    const shown = { ...badge() };
    assert.equal(shown.color, RED);
    assert.ok(Number(shown.text) >= 1);
    await ctx.ctl.browser.storage.local.set({ smartbar_enabled: false });
    await settle();
    assert.equal(badge().text, '');
    badgesAgree();
    await ctx.ctl.browser.storage.local.set({ smartbar_enabled: true });
    await settle();
    assert.deepEqual(badge(), shown);
});

k.test('clean', 'no worker left alive, no unmodelled API, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
