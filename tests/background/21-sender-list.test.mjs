// Spec 01 "Data Flow: Auto-Summarize by Sender Address List":
//  - summarize_auto_senders + summarize_auto_senders_list summarize the mail of listed senders
//    with no click, INDEPENDENTLY of summarize_auto (it works with summarize_auto = 0);
//  - matching: matchAddressList(author, list), exact addresses, `@domain.com` and `*@domain.com`
//    (a domain entry matches that domain only, not its subdomains);
//  - two triggers: (1) on reception, processEmails({summarizeSenders}) -> a silent pre-cache with
//    no tab; (2) on message open, the initSummary handler, after the running-job check and the
//    cache check, before the `summarize_auto === 0` return -> inline, in the message pane;
//  - idempotency: a message caught by both triggers costs exactly one API call (the job registry
//    plus the cache);
//  - shared guards: isMessageInAutoSkippedFolder() on both triggers; _summarizeConnectionMissing()
//    (the effective connection, isApiUsableConnection(): chatgpt_web counts as unusable) skips
//    silently - no alert, no error panel, and no error record written;
//  - _process_incoming "also covers a non-empty sender list" (spec 01 "onNewMailReceived
//    registration": the cheap gate that avoids waking the pipeline).
// Spec 05 (note below the table): a list is tested with hasAddressListEntries(), so a legacy
// [''] reads as empty.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    fromTab,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const LIST = ['boss@corp.test', '@partner.test', '*@vendor.test'];
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true,
        summarize_auto: 0,
        summarize_auto_senders: true,
        summarize_auto_senders_list: LIST,
        summarize_display_mode: 'inline',
        translate: false,
    },
    setup(m) { m.addTab({ id: 7, type: 'mail', active: true }); },
});
ctx.workers.respond = featureResponder();
const k = caseTests('21-sender-list');
const mail = (hid, author, folderId = 'f-inbox') => ctx.m.addMessage({ headerMessageId: hid, author, folderId });
const display = (tabId, h) => { ctx.m.tab(tabId).displayed = h.id; };
const summaryCalls = () => sentPrompts(ctx).filter(p => p.feature === 'summary').map(p => p.message);

k.test('process-incoming', 'with summarize_auto = 0 and a sender list, incoming mail still wakes the pipeline', () => {
    assert.equal(ctx.bg.$eval('_process_incoming'), true);
});

k.test('receive-exact', 'on reception, a message from an exact address of the list is summarized', async () => {
    await receive(ctx, [mail('r1@x', 'The Boss <boss@corp.test>')]);
    assert.ok(record(ctx, 'r1@x')?.summary);
    assert.equal(record(ctx, 'r1@x').summary.error, false);
});

k.test('receive-domain', 'on reception, @domain and *@domain entries match that domain', async () => {
    await receive(ctx, [mail('r2@x', 'someone@partner.test'), mail('r3@x', 'Sales <sales@vendor.test>')]);
    assert.ok(record(ctx, 'r2@x')?.summary);
    assert.ok(record(ctx, 'r3@x')?.summary);
});

k.test('receive-subdomain', 'a domain entry does not match its subdomains', async () => {
    await receive(ctx, [mail('r4@x', 'x@eu.vendor.test')]);
    assert.equal(record(ctx, 'r4@x'), null);
    assert.equal(summaryCalls().includes('r4@x'), false);
});

k.test('receive-other', 'a sender not in the list is not summarized, and nothing is stored', async () => {
    await receive(ctx, [mail('r5@x', 'stranger@else.test')]);
    assert.equal(record(ctx, 'r5@x'), null);
    assert.equal(summaryCalls().includes('r5@x'), false);
});

k.test('receive-no-tab', 'the reception trigger is a silent pre-cache: nothing is sent to a tab that does not display the message', async () => {
    ctx.m.tabSends.length = 0;
    await receive(ctx, [mail('r6@x', 'boss@corp.test')]);
    assert.ok(record(ctx, 'r6@x')?.summary);
    assert.deepEqual(ctx.m.commandsTo(7), []);
});

k.test('receive-skipped-folder', 'on reception, a listed sender in an auto-skipped folder (junk) is not summarized', async () => {
    await receive(ctx, [mail('r7@x', 'boss@corp.test', 'f-junk')]);
    assert.equal(record(ctx, 'r7@x'), null);
});

k.test('open-generates', 'on open, a listed sender not caught on reception is summarized inline, in that tab', async () => {
    const h = mail('o1@x', 'boss@corp.test');
    display(7, h);
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.ok(record(ctx, 'o1@x')?.summary);
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummaryGenerating', 'showSummary']);
    assert.equal(ctx.m.sentTo(7, 'showSummary')[0].data.headerMessageId, 'o1@x');
});

k.test('open-cached', 'on open, a cached summary is shown at once, with no API call', async () => {
    const before = ctx.workers.created.length;
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(ctx.workers.created.length, before);
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummary']);
});

k.test('open-other-sender', 'on open, a sender not in the list with summarize_auto = 0: nothing is shown and nothing generated', async () => {
    const h = mail('o2@x', 'stranger@else.test');
    display(7, h);
    ctx.m.tabSends.length = 0;
    const before = ctx.workers.created.length;
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.deepEqual(ctx.m.commandsTo(7), []);
    assert.equal(ctx.workers.created.length, before);
});

k.test('open-skipped-folder', 'on open, a listed sender in an auto-skipped folder is not summarized automatically', async () => {
    const h = mail('o3@x', 'boss@corp.test', 'f-trash');
    display(7, h);
    const before = ctx.workers.created.length;
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(ctx.workers.created.length, before);
    assert.equal(record(ctx, 'o3@x'), null);
});

k.test('both-triggers-one-call', 'a message caught by both triggers - opened while the reception job runs - costs exactly one API call', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    const h = mail('both@x', 'boss@corp.test');
    const batch = receive(ctx, [h]);
    for (let i = 0; i < 60 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    assert.equal(hold.held.length, 1, 'the reception job is waiting for its answer');
    display(7, h);
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(hold.held.length, 1, 'opening it joined the running job: no second prompt');
    hold.held[0].answer('Joined summary');
    await batch;
    await fromTab(ctx, 7, { command: 'initSummary' }, { turns: 10 });
    assert.equal(summaryCalls().filter(id => id === 'both@x').length, 1);
    assert.equal(record(ctx, 'both@x').summary.summary, 'Joined summary');
    assert.ok(ctx.m.sentTo(7, 'showSummary').some(c => c.data.summary === 'Joined summary'), 'the joiner\'s tab got the result');
    ctx.workers.respond = featureResponder();
});

k.test('unusable-connection', 'with an unusable connection (ChatGPT Web) the sender list skips silently: no call, no error stored, no panel', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { connection_type: 'chatgpt_web' });
    const before = ctx.workers.created.length;
    ctx.m.tabSends.length = 0;
    await receive(ctx, [mail('w1@x', 'boss@corp.test')]);
    const h = mail('w2@x', 'boss@corp.test');
    display(7, h);
    await fromTab(ctx, 7, { command: 'initSummary' });
    assert.equal(ctx.workers.created.length, before);
    assert.equal(record(ctx, 'w1@x'), null);
    assert.equal(record(ctx, 'w2@x'), null);
    assert.deepEqual(ctx.m.commandsTo(7), []);
    await setPrefs(t, ctx, { connection_type: API.connection_type });
});

k.test('legacy-empty-list', 'a legacy [\'\'] list reads as empty: incoming mail does not wake the pipeline', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize_auto_senders_list: [''] });
    assert.equal(ctx.bg.$eval('_process_incoming'), false);
    const before = ctx.workers.created.length;
    const r = await receive(ctx, [mail('e1@x', 'boss@corp.test')]);
    assert.equal(r, undefined, 'the listener returns at once');
    assert.equal(ctx.workers.created.length, before);
    assert.equal(record(ctx, 'e1@x'), null);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
