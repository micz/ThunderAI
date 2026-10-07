// The background side of "Data Flow: Inline Summary on Message Display" (spec 01): what it sends to
// which tab when a content script asks. What the content script draws with it is the compose area's.
//
//  - initSummary: summarize_auto 0 -> nothing; 1 -> the "click to generate" button
//    (showSummaryButton, with webchat: true in 'webchat' display mode); 2 -> generate inline at
//    once (never on a message in an auto-skipped folder); a cached summary is always shown first,
//    whatever the mode; a summary job already running is joined (spinner, then its result);
//  - triggerSummaryGeneration (the button): the generating panel at once, then the result;
//  - refreshSummary: regenerate (the job drops the stored summary itself);
//  - removeSummary: the stored summary is removed and the manual button drawn again; a job still
//    running is invalidated first - it lands without saving or showing its result, every tab
//    displaying the message gets hideSummaryGenerating and its button back (spec 01 "In-flight
//    jobs", "Remove / invalidate"); an explicit manual trigger on the invalidated job revives it:
//    delete-then-generate-again is still one API call;
//  - getDisplayedMessageId: the headerMessageId the tab displays, null when unknown.
// Spec 01 "Stale-result guard": every terminal show goes through _sendIfCurrent(), which drops it
// when the tab no longer displays that message (the cache is unaffected); the generating panel of
// a joiner is skipped on a tab displaying another message, and the generation continues.
// Spec 01 "Unreachable message pane" (#901): a send to a tab with no reachable message browser
// is dropped quietly - no unhandled rejection - and the result stays in the store.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    record,
    fromTab,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        summarize: true,
        summarize_auto: 1,
        summarize_display_mode: 'inline',
        translate: false,
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2 });
        m.addTab({ id: 9, type: 'mail', windowId: 3, reachable: false });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('25-inline-summary');
const show = (tabId, hid, folderId = 'f-inbox') => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const calls = hid => sentPrompts(ctx).filter(p => p.feature === 'summary' && p.message === hid).length;
const reset = () => { ctx.m.tabSends.length = 0; };

k.test('displayed-id', 'getDisplayedMessageId answers the headerMessageId the tab displays, null with nothing displayed', async () => {
    show(7, 'id1@x');
    assert.equal(await fromTab(ctx, 7, { command: 'getDisplayedMessageId' }, { turns: 1 }), 'id1@x');
    ctx.m.tab(8).displayed = null;
    assert.equal(await fromTab(ctx, 8, { command: 'getDisplayedMessageId' }, { turns: 1 }), null);
});

k.test('auto1-button', 'summarize_auto = 1, inline: the tab gets the manual button for its message, and nothing is generated', async () => {
    show(7, 'b1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.sentTo(7), [{ command: 'showSummaryButton', headerMessageId: 'b1@x' }]);
    assert.equal(calls('b1@x'), 0);
});

k.test('trigger', 'the button (triggerSummaryGeneration): the generating panel first, then the summary; stored on that message', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'b1@x' });
    const cmds = ctx.m.commandsTo(7);
    assert.equal(cmds[0], 'showSummaryGenerating');
    assert.equal(cmds[cmds.length - 1], 'showSummary');
    assert.equal(ctx.m.sentTo(7, 'showSummary')[0].data.headerMessageId, 'b1@x');
    assert.ok(record(ctx, 'b1@x').summary);
    assert.equal(calls('b1@x'), 1);
});

k.test('cached', 'opening a message with a cached summary shows it at once, with no API call', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummary']);
    assert.equal(calls('b1@x'), 1);
});

k.test('cached-error-not-shown', 'a stored error is not shown as a cached summary: the button is offered again', async () => {
    await ctx.ctl.browser.storage.local.set({ 'msg:err1@x': { v: 1, ts: Date.now(), summary: { summary: '', error: true, message: 'boom', ts: Date.now() } } });
    show(7, 'err1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummaryButton']);
});

k.test('stale-drop', 'the user moved on before the summary came back: the result is not drawn on the other message, but it is cached', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    show(7, 'st1@x');
    reset();
    const p = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'st1@x' });
    for (let i = 0; i < 60 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    show(7, 'st2@x');                 // the user clicked another message
    hold.held[0].answer('Late summary');
    await p;
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    assert.deepEqual(ctx.m.sentTo(7, 'showSummary'), [], 'no summary of st1 drawn on the tab now showing st2');
    assert.equal(record(ctx, 'st1@x').summary.summary, 'Late summary', 'but it is in the cache');
    ctx.workers.respond = featureResponder();
});

k.test('stale-back', 'coming back to that message shows the cached summary', async () => {
    show(7, 'st1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(ctx.m.sentTo(7, 'showSummary')[0].data.summary, 'Late summary');
});

k.test('refresh', 'refreshSummary regenerates: a new API call, and the new summary is stored and shown', async () => {
    reset();
    ctx.workers.respond = featureResponder({ summary: () => 'Fresh summary' });
    await fromTab(ctx, 7, { command: 'refreshSummary', headerMessageId: 'st1@x' });
    assert.equal(record(ctx, 'st1@x').summary.summary, 'Fresh summary');
    assert.equal(ctx.m.commandsTo(7)[0], 'showSummaryGenerating');
    assert.equal(ctx.m.sentTo(7, 'showSummary').pop().data.summary, 'Fresh summary');
    ctx.workers.respond = featureResponder();
});

k.test('remove', 'removeSummary drops the stored summary and draws the manual button again', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'removeSummary', headerMessageId: 'st1@x' });
    assert.equal(record(ctx, 'st1@x')?.summary, undefined);
    assert.deepEqual(ctx.m.sentTo(7), [{ command: 'showSummaryButton', headerMessageId: 'st1@x', webchat: false }]);
});

k.test('remove-while-running', 'a summary deleted while it is generated lands without being saved or shown; the displaying tabs get their button back', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    show(7, 'rr1@x');
    show(8, 'rr1@x');
    reset();
    const p = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'rr1@x' });
    for (let i = 0; i < 60 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    await fromTab(ctx, 7, { command: 'removeSummary', headerMessageId: 'rr1@x' }, { turns: 5 });
    hold.held[0].answer('Unwanted summary');
    await p;
    for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
    assert.equal(record(ctx, 'rr1@x')?.summary, undefined, 'not saved');
    for (const tab of [7, 8]) {
        const sent = ctx.m.sentTo(tab);
        assert.equal(sent.some(c => c.command === 'showSummary'), false, 'not shown in tab ' + tab);
        assert.ok(sent.some(c => c.command === 'hideSummaryGenerating'), 'spinner removed in tab ' + tab);
        assert.equal(sent[sent.length - 1].command, 'showSummaryButton', 'button back in tab ' + tab);
    }
    ctx.workers.respond = featureResponder();
});

k.test('delete-then-again', 'deleted while generating, then asked again: the running job is revived, one API call in all', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    show(7, 'rv1@x');
    reset();
    const p1 = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'rv1@x' });
    for (let i = 0; i < 60 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    await fromTab(ctx, 7, { command: 'removeSummary', headerMessageId: 'rv1@x' }, { turns: 5 });
    const p2 = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'rv1@x' });
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(hold.held.length, 1, 'no second prompt');
    hold.held[0].answer('Revived summary');
    await Promise.all([p1, p2]);
    for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
    assert.equal(record(ctx, 'rv1@x').summary.summary, 'Revived summary');
    assert.equal(ctx.m.sentTo(7, 'showSummary').pop().data.summary, 'Revived summary');
    assert.equal(calls('rv1@x'), 1);
    ctx.workers.respond = featureResponder();
});

k.test('unreachable-pane', 'a tab with no reachable message pane: the sends are dropped quietly, and the summary is stored', async () => {
    show(9, 'up1@x');
    await fromTab(ctx, 9, { command: 'triggerSummaryGeneration', headerMessageId: 'up1@x' });
    assert.ok(record(ctx, 'up1@x').summary);
    assert.deepEqual(ctx.m.sentTo(9), []);
    assert.deepEqual(ctx.unhandled, []);
});

k.test('webchat-button', "display mode 'webchat': the manual button is drawn with webchat: true", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize_display_mode: 'webchat' });
    show(7, 'wc1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.sentTo(7), [{ command: 'showSummaryButton', headerMessageId: 'wc1@x', webchat: true }]);
});

k.test('auto0-nothing', 'summarize_auto = 0: opening a message draws nothing and generates nothing', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize_auto: 0, summarize_display_mode: 'inline' });
    show(7, 'a0@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.sentTo(7), []);
    assert.equal(calls('a0@x'), 0);
});

k.test('auto0-cached', 'summarize_auto = 0: a cached summary is still shown', async () => {
    show(7, 'b1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummary']);
});

k.test('auto2-generates', 'summarize_auto = 2: opening a message generates its summary inline at once', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize_auto: 2 });
    show(7, 'a2@x');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummaryGenerating', 'showSummary']);
    assert.ok(record(ctx, 'a2@x').summary);
});

k.test('auto2-skipped-folder', 'summarize_auto = 2: a draft opened is not summarized automatically', async () => {
    show(7, 'dr1@x', 'f-drafts');
    reset();
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(calls('dr1@x'), 0);
    assert.equal(record(ctx, 'dr1@x'), null);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
