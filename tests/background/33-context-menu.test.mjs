// The context-menu actions on the special prompts, the background side.
//
// Spec 01 "Context-menu actions: one source for messages and UI tab": menus.onClicked reads the
// selection from the CLICKED tab (mailTabs.getSelectedMessages(tab.id)), falling back to
// info.selectedMessages only when that fails, and passes tab.id to processEmails() as sourceTabId:
// the summarize and translate branches use it as their UI tab. info.selectedMessages is not bound to
// the clicked tab - trusting it sent another message to the AI than the one displayed.
// Spec 01 "Data Flow: Inline Summary on Message Display" (context menu): 'inline' with a single
// message and a reachable message pane -> inline via _generateSummaryForMessage(); 'webchat',
// several messages, or an unreachable pane -> the AI chat window (openChatGPT()).
// Spec 01 "Unreachable message pane" (#901): the showSummaryGenerating send is the probe:
// current && !delivered -> the webchat fallback; !current (the tab displays another message) ->
// no panel, the summary generated inline anyway, silently, into the cache.
// Spec 01 "Per-message pipelines", "Translate tab": the manual Translate delivers the outcome to
// its UI tab, only for the message that tab displays.
// Spec 05 `summarize_max_messages`: above it the run is blocked with summarize_too_many_messages.
// What the chat window does once opened is the webchat area's; here: that it opens, for what.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    record,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 1, summarize_display_mode: 'inline', summarize_max_messages: 2,
        translate: true, translate_auto: 0, default_chatgpt_lang: 'Italian',
    },
    setup(m) {
        for (const n of [1, 2, 3, 4, 5, 6]) H['m' + n] = m.addMessage({ headerMessageId: 'm' + n + '@x' });
        m.addTab({ id: 7, type: 'mail', windowId: 1, active: true });
        m.addTab({ id: 8, type: 'mail', windowId: 2, active: true });
        m.addTab({ id: 9, type: 'mail', windowId: 3, reachable: false });
        m.addTab({ id: 12, type: 'messageDisplay', windowId: 6 });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('33-context-menu');
const tabOf = id => ({ id, windowId: ctx.m.tab(id).windowId, type: ctx.m.tab(id).type });
const summarized = () => sentPrompts(ctx).filter(p => p.feature === 'summary').map(p => p.message);
const listener = () => ctx.ctl.browser.menus.onClicked._listeners.find(fn => String(fn).includes("'mzta-ctx-'"));
/** A click in `tabId`, whose own selection is `tabSel`, while info.selectedMessages says `infoSel`. */
const click = (item, tabId, { tabSel, infoSel = tabSel, displayed } = {}) => {
    const t = ctx.m.tab(tabId);
    if (tabSel) t.selected = tabSel.map(h => h.id);
    if (displayed !== undefined) t.displayed = displayed ? displayed.id : null;
    return listener()({ menuItemId: 'mzta-ctx-' + item, selectedMessages: ctx.m.messageList(infoSel) }, tabOf(tabId));
};
const reset = () => { ctx.m.tabSends.length = 0; };

k.test('selection-from-tab', 'the messages come from the clicked tab\'s selection, not from info.selectedMessages', async () => {
    reset();
    await click('prompt_summarize', 8, { tabSel: [H.m2], infoSel: [H.m1], displayed: H.m2 });
    assert.deepEqual(summarized(), ['m2@x']);
    assert.ok(record(ctx, 'm2@x').summary);
    assert.equal(record(ctx, 'm1@x'), null, 'the message of the other selection is not touched');
});

k.test('ui-tab-is-clicked-tab', 'the panels go to the clicked tab, not to the active tab of another window', () => {
    // The probe's generating panel, the job's broadcast of it, then the result.
    assert.deepEqual(ctx.m.commandsTo(8), ['showSummaryGenerating', 'showSummaryGenerating', 'showSummary']);
    assert.deepEqual(ctx.m.commandsTo(7), []);
});

k.test('selection-fallback', 'when the tab selection cannot be read (a message window), info.selectedMessages is used', async () => {
    reset();
    await click('prompt_summarize', 12, { infoSel: [H.m3], displayed: H.m3 });
    assert.ok(summarized().includes('m3@x'));
    assert.deepEqual(ctx.m.commandsTo(12), ['showSummaryGenerating', 'showSummaryGenerating', 'showSummary']);
});

k.test('inline-other-displayed', 'the tab displays another message: no panel is drawn, the summary goes to the cache', async () => {
    reset();
    await click('prompt_summarize', 7, { tabSel: [H.m4], displayed: H.m1 });
    assert.ok(record(ctx, 'm4@x').summary);
    assert.deepEqual(ctx.m.sentTo(7).filter(c => c.headerMessageId === 'm4@x' || c.data?.headerMessageId === 'm4@x'), []);
    assert.equal(ctx.m.windows.length, 0, 'no chat window');
});

k.test('unreachable-webchat', 'an unreachable message pane: the summary falls back to the chat window, nothing is generated inline', async () => {
    reset();
    const before = summarized().length;
    await click('prompt_summarize', 9, { tabSel: [H.m5], displayed: H.m5 });
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    assert.equal(summarized().length, before, 'no inline generation');
    assert.equal(ctx.m.windows.length, 1);
    assert.match(ctx.m.windows[0].url, /api_webchat\/index\.html\?llm=chatgpt_api/);
    assert.deepEqual(ctx.standIns.buildSummaryPrompt.pop().map(e => e.message.headerMessageId), ['m5@x']);
});

k.test('several-webchat', 'several messages: one chat window, its prompt built from those messages, in order', async () => {
    reset();
    await click('prompt_summarize', 7, { tabSel: [H.m1, H.m6], displayed: H.m1 });
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    assert.equal(ctx.m.windows.length, 2);
    assert.deepEqual(ctx.standIns.buildSummaryPrompt.pop().map(e => e.message.headerMessageId), ['m1@x', 'm6@x']);
});

k.test('several-cap', 'more messages than summarize_max_messages: the run is blocked with a warning, no window', async () => {
    reset();
    await click('prompt_summarize', 7, { tabSel: [H.m1, H.m2, H.m3], displayed: H.m1 });
    assert.equal(ctx.m.windows.length, 2);
    const err = ctx.m.sentTo(7, 'showGenericError');
    assert.equal(err.length, 1);
    assert.equal(err[0].data.message, ctx.ctl.browser.i18n.getMessage('summarize_too_many_messages', ['3', '2']));
});

k.test('translate-ui-tab', 'Translate on two messages: both are translated; the clicked tab is told only about the message it displays', async () => {
    reset();
    await click('prompt_translate_this', 7, { tabSel: [H.m1, H.m2], displayed: H.m1 });
    assert.ok(record(ctx, 'm1@x').translation && record(ctx, 'm2@x').translation);
    const shown = ctx.m.sentTo(7, 'showTranslation').map(c => c.data.headerMessageId);
    assert.ok(shown.includes('m1@x'));
    assert.equal(shown.includes('m2@x'), false);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
