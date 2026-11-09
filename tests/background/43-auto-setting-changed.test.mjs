// The automatic summary / translation turned off while an incoming batch is still running.
//
// Spec 01 "Data Flow: Background Summary on Email Receive" and "Per-message pipelines in
// processEmails()": the batch decides its targets when it starts, but each automatic summary and
// translation step re-reads its setting just before it runs. A message still queued when the user
// moves summarize_auto / translate_auto from 3 (on receive) to 1 (manual button) is not summarized
// nor translated by the batch; opening it offers the manual buttons. A call already in flight
// finishes. The batch here runs one message at a time (batch_max_concurrency = 1) under
// node:test's mock timers.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    fromTab,
    featureOf,
    messageOf,
    sentPrompts,
    receive,
    record,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 3,
        translate: true, translate_auto: 3, default_chatgpt_lang: 'Italian',
        batch_max_concurrency: 1,
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
    },
});
const hold = holding();
ctx.workers.respond = hold.respond;
const k = caseTests('43-auto-setting-changed');

const hs = [1, 2, 3].map(i => ctx.m.addMessage({ headerMessageId: 'ch' + i + '@x' }));

/** Turn the loop and fire due timers (mock clock) until cond() holds. */
async function until(t, cond, what) {
    for (let i = 0; i < 2000; i++) {
        if (cond()) return;
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(0);
    }
    throw new Error('until: ' + what);
}
const heldOpen = () => hold.held.filter(x => !x.done);
const answerHeld = (x) => {
    x.done = true;
    x.answer(featureOf(x.prompt) === 'summary'
        ? 'Summary ' + messageOf(x.prompt)
        : JSON.stringify({ subject: 'S', body: 'B ' + messageOf(x.prompt), status: '1' }));
};

k.test('change-scenario', 'three messages arrive; while the first is summarized, the user sets both features to the manual button', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const batch = receive(ctx, hs);
    let ended = false;
    batch.then(() => { ended = true; });
    await until(t, () => heldOpen().length === 1, 'the summary of message 1');
    assert.equal(messageOf(heldOpen()[0].prompt), 'ch1@x');
    await setPrefs(t, ctx, { summarize_auto: 1, translate_auto: 1 });
    // The call in flight finishes; nothing else may start.
    answerHeld(heldOpen()[0]);
    await until(t, () => ended || heldOpen().length > 0, 'the batch to end');
    while (heldOpen().length > 0 && !ended) {
        answerHeld(heldOpen()[0]);
        await until(t, () => ended || heldOpen().length > 0, 'the batch to end');
    }
    await batch;
});

k.test('in-flight-finishes', 'the summary in flight at the change completes and is stored', async () => {
    assert.equal((await record(ctx, 'ch1@x')).summary.summary, 'Summary ch1@x');
});

k.test('nothing-after-change', 'no summary nor translation is requested after the change: not the first message\'s translation, not the queued messages', () => {
    assert.deepEqual(sentPrompts(ctx), [{ feature: 'summary', message: 'ch1@x' }]);
});

k.test('queued-not-stored', 'the queued messages have nothing stored', async () => {
    assert.equal(await record(ctx, 'ch2@x'), null);
    assert.equal(await record(ctx, 'ch3@x'), null);
});

k.test('button-on-open', 'opening a queued message offers the summary and the translation as the manual button, generating nothing', async () => {
    ctx.m.tab(7).displayed = hs[1].id;
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'initSummary' });
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummaryButton', 'showTranslationButton']);
    assert.deepEqual(heldOpen(), [], 'nothing generated on open');
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
