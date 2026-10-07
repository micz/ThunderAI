// Spec 01 "In-flight jobs (taJobRegistry)", across callers: the batch (processEmails()) and the
// manual paths (panel buttons, auto display, context menu, Refresh) can reach the same message at
// any moment; a feature never runs twice on a message at the same time.
//  - Joining: a caller that finds an entry awaits it: no startWorking(), no store write, no API
//    call; with a tab of its own it gets the generating panel, then the outcome. The batch only
//    reads the outcome.
//  - Working indicator: exactly one startWorking() / stopWorking() pair per job that gets past the
//    cache, none for joiners.
//  - Spam: only the job owning the entry can move the message; an autoMove joiner (the batch
//    joining a manual Refresh) sets entry.wantsMove, read at the verdict, so the message is still
//    moved, once. checkSpamReport joins a running analysis.
//  - add_tags: the batch and the context menu share the add_tags entry; a joiner assigns nothing.
//  - Queued messages: a click starts the job at once; when the pipeline reaches that feature it
//    joins it (or starts a job that hits the cache).
// Spec 01 "Per-message pipelines": "a message caught by both triggers costs exactly one API call".

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    sentPrompts,
    receive,
    record,
    fromTab,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 3, summarize_display_mode: 'inline',
        translate: true, translate_auto: 3, default_chatgpt_lang: 'Italian',
        spamfilter: true, spamfilter_skip_addressbook: false, spamfilter_threshold: 70,
        add_tags: true, add_tags_auto: true,
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2 });
    },
});
const hold = holding();
ctx.workers.respond = hold.respond;
const k = caseTests('27-dedup');
const { taWorkingStatus } = await import('../../js/mzta-working-status.js');

const turns = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
/** Wait until a prompt of `feature` for `hid` is held, return it. */
async function heldFor(feature, hid) {
    for (let i = 0; i < 200; i++) {
        const h = hold.held.find(x => !x.done && featureOf(x.prompt) === feature && messageOf(x.prompt) === hid);
        if (h) return h;
        await new Promise(r => setImmediate(r));
    }
    throw new Error('no ' + feature + ' prompt held for ' + hid + '; held: ' + hold.held.map(x => featureOf(x.prompt) + ':' + messageOf(x.prompt)).join(', '));
}
const answer = (h, text) => { h.done = true; h.answer(text); };
const DEFAULT_ANSWER = {
    spam: () => '{"spamValue": 5, "explanation": "ok"}',
    add_tags: () => '{"tags": ["Work"]}',
    summary: hid => 'Summary ' + hid,
    translation: hid => JSON.stringify({ subject: 'S', body: 'B ' + hid, status: '1' }),
};
/** Answer every held prompt with the default answer of its feature, until the promise settles. */
async function autoAnswer(promise, answers = {}) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 400 && !settled; i++) {
        for (const h of hold.held.filter(x => !x.done)) {
            const f = featureOf(h.prompt);
            const hid = messageOf(h.prompt);
            answer(h, (answers[f] || DEFAULT_ANSWER[f])(hid));
        }
        await new Promise(r => setImmediate(r));
    }
    await promise;
}
const count = (feature, hid) => sentPrompts(ctx).filter(p => p.feature === feature && p.message === hid).length;
const show = (tabId, h) => { ctx.m.tab(tabId).displayed = h.id; };

k.test('batch-joins-manual-summary', 'a summary started from the panel while the message waits in a batch: the batch joins it, one API call', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'j1@x' });
    show(7, h);
    const manual = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'j1@x' }, { turns: 1 });
    const s = await heldFor('summary', 'j1@x');
    const batch = receive(ctx, [h]);
    // The batch screens and tags first, then reaches the running summary and joins it.
    await autoAnswerUntil(() => count('add_tags', 'j1@x') === 1 && hold.held.every(x => x.done || x === s), [s]);
    answer(s, 'Manual summary');
    await autoAnswer(batch);
    await manual;
    assert.equal(count('summary', 'j1@x'), 1);
    assert.equal(record(ctx, 'j1@x').summary.summary, 'Manual summary');
});

/** Answer every held prompt but those in `keep` (with the default answers) until `cond()` holds. */
async function autoAnswerUntil(cond, keep = []) {
    for (let i = 0; i < 400 && !cond(); i++) {
        for (const h of hold.held.filter(x => !x.done && !keep.includes(x))) {
            answer(h, DEFAULT_ANSWER[featureOf(h.prompt)](messageOf(h.prompt)));
        }
        await new Promise(r => setImmediate(r));
    }
    if (!cond()) throw new Error('autoAnswerUntil: condition never met');
}

k.test('manual-joins-batch-summary', 'the panel button pressed while the batch summarizes the message: it joins, one call, and its tab gets the result', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'j2@x' });
    const batch = receive(ctx, [h]);
    await autoAnswerUntil(() => hold.held.some(x => !x.done && featureOf(x.prompt) === 'summary' && messageOf(x.prompt) === 'j2@x'));
    const s = await heldFor('summary', 'j2@x');
    show(7, h);
    ctx.m.tabSends.length = 0;
    const level = taWorkingStatus.WorkingLevel;
    const manual = fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'j2@x' }, { turns: 30 });
    await manual;
    assert.equal(taWorkingStatus.WorkingLevel, level, 'a joiner does not count as work in flight');
    assert.equal(hold.held.filter(x => featureOf(x.prompt) === 'summary' && messageOf(x.prompt) === 'j2@x').length, 1, 'no second prompt');
    answer(s, 'Batch summary');
    await autoAnswer(batch);
    await turns();
    assert.equal(count('summary', 'j2@x'), 1);
    assert.equal(ctx.m.sentTo(7, 'showSummary').pop().data.summary, 'Batch summary', 'the joiner\'s tab got the result');
});

k.test('manual-joins-batch-translation', 'the translation button pressed while the batch translates the message: one call, the result in that tab', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'j3@x' });
    const batch = receive(ctx, [h]);
    await autoAnswerUntil(() => hold.held.some(x => !x.done && featureOf(x.prompt) === 'translation' && messageOf(x.prompt) === 'j3@x'));
    const tr = await heldFor('translation', 'j3@x');
    show(7, h);
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'j3@x' }, { turns: 30 });
    answer(tr, JSON.stringify({ subject: 'Ogg', body: 'Tradotto', status: '1' }));
    await autoAnswer(batch);
    await turns();
    assert.equal(count('translation', 'j3@x'), 1);
    assert.equal(ctx.m.sentTo(7, 'showTranslation').pop().data.translated_text, 'Tradotto');
});

k.test('spam-batch-joins-refresh', 'the batch reaching a message whose manual spam Refresh is running joins it: the verdict is still applied, moved once', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'sp1@x' });
    show(7, h);
    const refresh = fromTab(ctx, 7, { command: 'refreshSpamReport', headerMessageId: 'sp1@x' }, { turns: 1 });
    const sp = await heldFor('spam', 'sp1@x');
    const batch = receive(ctx, [h]);
    await turns(40);
    assert.equal(hold.held.filter(x => featureOf(x.prompt) === 'spam' && messageOf(x.prompt) === 'sp1@x').length, 1, 'the batch did not start a second analysis');
    answer(sp, '{"spamValue": 95, "explanation": "phishing"}');
    await autoAnswer(batch);
    await refresh;
    await turns();
    const moves = ctx.m.calls.filter(c => c.api === 'messages.move' && c.args[0].includes(h.id));
    assert.equal(moves.length, 1, 'moved once');
    assert.equal(ctx.m.byHeaderId('sp1@x').folder.id, 'f-junk');
    assert.equal(record(ctx, 'sp1@x').spam.moved, true);
    assert.equal(count('summary', 'sp1@x'), 0, 'moved: no summary');
});

k.test('spam-check-joins', 'opening the message while its analysis runs (checkSpamReport) joins it: in-progress badge, then the report', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'sp2@x' });
    const batch = receive(ctx, [h]);
    const sp = await heldFor('spam', 'sp2@x');
    show(8, h);
    ctx.m.tabSends.length = 0;
    const check = fromTab(ctx, 8, { command: 'checkSpamReport' }, { type: 'messageDisplay', turns: 20 });
    await check;
    answer(sp, '{"spamValue": 10, "explanation": "fine"}');
    await autoAnswer(batch);
    await turns();
    const cmds = ctx.m.commandsTo(8).filter(c => c.startsWith('showSpam'));
    assert.equal(cmds[0], 'showSpamCheckInProgress');
    assert.equal(cmds[cmds.length - 1], 'showSpamReport');
    assert.equal(count('spam', 'sp2@x'), 1);
});

k.test('add-tags-shared', 'the context-menu Add tags and an incoming batch on the same message share one job: one call, the tags assigned once', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'tg1@x' });
    const menu = clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', { id: 7, windowId: 1, type: 'mail' }, [h]);
    const tg = await heldFor('add_tags', 'tg1@x');
    const batch = receive(ctx, [h]);
    await autoAnswerUntil(() => count('spam', 'tg1@x') === 1 && hold.held.filter(x => !x.done).every(x => x === tg), [tg]);
    await turns(20);
    assert.equal(hold.held.filter(x => featureOf(x.prompt) === 'add_tags' && messageOf(x.prompt) === 'tg1@x').length, 1);
    answer(tg, '{"tags": ["Work"]}');
    await autoAnswer(Promise.all([menu, batch]));
    const assigns = ctx.m.calls.filter(c => c.api === 'messages.update' && c.args[0] === ctx.m.byHeaderId('tg1@x').id && c.args[1].tags);
    assert.equal(assigns.length, 1, 'one tag assignment');
    assert.equal(count('add_tags', 'tg1@x'), 1);
});

k.test('overlapping-batches', 'two overlapping batches with the same message (two accounts receiving it): one call per feature', async () => {
    const a = ctx.m.addMessage({ headerMessageId: 'ov1@x' });
    const b = ctx.m.addMessage({ headerMessageId: 'ov1@x', folderId: 'f-lists' });
    const p1 = receive(ctx, [a]);
    const p2 = receive(ctx, [b]);
    await autoAnswer(Promise.all([p1, p2]));
    for (const f of ['spam', 'summary', 'translation']) assert.equal(count(f, 'ov1@x'), 1, f);
});

k.test('working-balanced', 'when everything settled, the working level is back to zero', async () => {
    await turns();
    assert.equal(taWorkingStatus.WorkingLevel, 0);
    assert.equal(hold.held.filter(x => !x.done).length, 0);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
