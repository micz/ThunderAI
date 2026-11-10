// What the background does with a SmartBar instruction (claude-spec/10-smartbar.md "Flow",
// "Router", "Jobs", "Replacement", "Storage"), through its real runtime.onMessage listener, from the
// tab that displays the message:
//  - smartbar_run: refused when the feature is off, for an empty instruction, or from a tab that
//    does not display that message;
//  - the router is a special command on the smartbar_router connection; its prompt never holds the
//    email body; its reasoning is stripped as for every special command; an answer that is not JSON
//    gets one correction attempt, then the record ends in error (errorType json, raw answer kept);
//  - the routed operations run through their feature's pipeline: the summary and the translation
//    are stored and drawn as the panel button would; "translate to German" translates into German
//    and does not take the cached translation; named tags are assigned with no model call;
//  - an operation the router names that is not available is not run, and is reported;
//  - every step reaches the tab as smartbar_update, with an increasing seq; the record is stored;
//  - a new instruction on the same message replaces the previous one: its group stops, its record
//    is replaced; a tag job of the automatic processing that the bar joined is never stopped;
//  - Stop of the whole instruction ends the router call with errorType aborted;
//  - "Compose": a special command on the smartbar_execute connection with the email, the
//    instruction, the type, the context (the router's placeholders, the selected text, which the
//    router never sees), the settings; the email cut to smartbar_max_body_length, quoted part
//    first; the reply opens the same compose window as the API chat's reply (beginReply, same
//    details), a forward beginForward with Thunderbird's forward type, a new email beginNew with
//    the generated subject; no recipient ever set; the text written through insertReply, with the
//    signature the instruction asked for; done once the window is open, the recipient kept as a
//    reminder; compose runs after the other operations; a json error keeps the raw answer and
//    opens no window; a stopped generation opens no window; a window that could not open is
//    opened again by Retry without a new generation.
// The record itself and the router's pure parts are the smartbar area's (tests/smartbar/).
// splitQuotedHtml() (DOMParser) is the compose area's: here a stand-in reads the model's
// text/plain twin, and records what it was given.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    answering,
    holding
} from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    fromTab,
    record,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ROUTER_MARK = 'Reply with one JSON object and nothing else';
const COMPOSE_MARK = '\nOperation: compose\n';
const routes = {};          // instruction -> the router's raw answer (a string or a function of the attempt)
const routerPrompts = [];
const composes = {};        // instruction -> the compose answer (a string or a function of the attempt)
const composePrompts = [];
// The stand-in of splitQuotedHtml(): the twin's <br> back to \n; a test may set the split.
const splitCalls = [];
let nextSplit = null;

const ctx = await bgContext({
    overrides: {
        splitQuotedHtml: (html) => {
            splitCalls.push(html);
            return nextSplit ?? { own: String(html ?? '').replace(/<br>/g, '\n'), quoted: '' };
        },
    },
    local: {
        ...API,
        smartbar_enabled: true,
        add_tags: true,
        add_tags_auto: false,
        summarize: true,
        summarize_auto: 0,
        summarize_display_mode: 'inline',
        translate: true,
        translate_auto: 0,
        translate_lang: 'Italian',
    },
    mail: {
        // An identity: the compose windows open with getCurrentIdentity()'s.
        accounts: [{ id: 'acc1', name: 'Account 1', identities: [{ id: 'id1', email: 'me@example.test' }] }],
        tags: [{ key: 'work', tag: 'Work', color: '#00ff00', ordinal: '' }],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'mail', windowId: 2 });
    },
});
const k = caseTests('44-smartbar');

/** The instruction a router prompt was built for. */
const instructionOf = prompt => (/Instruction:\n([^\n]*)/.exec(prompt) || [])[1];
/** The default responder: the router answers from `routes`, the features as their flow tests do. */
function respondAll(prompt) {
    const p = String(prompt);
    // The compose prompt holds a JSON section too: told apart first, by its operation section.
    if (p.includes(COMPOSE_MARK)) {
        composePrompts.push(p);
        const instruction = instructionOf(p);
        const attempt = composePrompts.filter(q => instructionOf(q) === instruction).length;
        const r = composes[instruction];
        return typeof r === 'function' ? r(attempt) : (r ?? '{"subject": "", "body": "Generated text.", "recipient": "", "signature": ""}');
    }
    if (p.includes(ROUTER_MARK)) {
        routerPrompts.push(p);
        const instruction = instructionOf(p);
        const attempt = routerPrompts.filter(q => instructionOf(q) === instruction).length;
        const r = routes[instruction];
        return typeof r === 'function' ? r(attempt) : (r ?? '{"operations": [], "context": [], "unrecognized": ""}');
    }
    const f = featureOf(p);
    if (f === 'summary') return 'Summary of **' + messageOf(p) + '**';
    if (f === 'translation') return JSON.stringify({ subject: 'Betreff', body: 'Text', status: '1' });
    if (f === 'add_tags') return '{"tags": ["Work"]}';
    throw new Error('44-smartbar: unexpected prompt ' + p.slice(0, 80));
}
ctx.workers.respond = answering(respondAll);

const show = (tabId, hid) => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId: 'f-inbox', subject: 'Subject of ' + hid,
        author: 'Alice Smith <alice@example.com>' });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const run = (tabId, hid, instruction, extra = {}) => fromTab(ctx, tabId, { command: 'smartbar_run', headerMessageId: hid, instruction, ...extra }, { turns: 200 });
const updates = tabId => ctx.m.sentTo(tabId, 'smartbar_update');
const lastRecord = tabId => updates(tabId).at(-1)?.record;
const json = o => JSON.stringify(o);
const op = (id, params = {}) => ({ id, params });
const { taSmartbarStore } = await import('../../js/mzta-smartbar-store.js');
const { taJobRegistry } = await import('../../js/mzta-job-registry.js');
const settle = async (n = 200) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

k.test('refused', 'smartbar_run is refused from a tab not displaying the message, and for an empty instruction', async () => {
    show(7, 'r1@x');
    assert.deepEqual(await run(8, 'r1@x', 'summarize'), { ok: false, error: 'not_displayed' });
    assert.deepEqual(await run(7, 'r1@x', '   '), { ok: false, error: 'empty' });
    assert.equal(routerPrompts.length, 0);
});

k.test('summarize', 'an instruction routed to summarize: the router never sees the body, the summary is stored and drawn', async () => {
    routes['riassumi'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    show(7, 's1@x');
    ctx.m.tabSends.length = 0;
    const answer = await run(7, 's1@x', 'riassumi');
    assert.equal(answer.ok, true);
    const prompt = routerPrompts.at(-1);
    assert.ok(!prompt.includes('Body of <s1@x>'), 'no body in the router prompt');
    assert.ok(prompt.includes('Subject: Subject of s1@x'));
    assert.ok(prompt.includes('From: Alice Smith'));
    assert.ok(!prompt.includes('alice@example.com'));
    assert.match((await record(ctx, 's1@x')).summary.summary, /Summary of/);
    assert.ok(ctx.m.sentTo(7, 'showSummary').length > 0, 'drawn as the panel button would');
    const stored = await taSmartbarStore.latest('s1@x');
    assert.equal(stored.state, 'done');
    assert.deepEqual(stored.operations.map(o => [o.id, o.state]), [['summarize', 'done']]);
    assert.equal(lastRecord(7).state, 'done');
    const seqs = updates(7).map(u => u.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.ok(updates(7).every(u => u.headerMessageId === 's1@x'));
});

k.test('reasoning', 'the router\'s reasoning is stripped before its answer is read', async () => {
    routes['summarize please'] = '<think>The user wants {a summary}.</think>' + json({ operations: [op('summarize')], context: [], unrecognized: '' });
    show(7, 's2@x');
    await run(7, 's2@x', 'summarize please');
    const stored = await taSmartbarStore.latest('s2@x');
    assert.equal(stored.state, 'done');
    assert.deepEqual(stored.operations.map(o => o.id), ['summarize']);
});

k.test('json-error', 'an answer that is not JSON twice: one correction attempt, then errorType json with the raw answer', async () => {
    routes['gibberish'] = attempt => 'I would rather chat, attempt ' + attempt;
    show(7, 'j1@x');
    const before = routerPrompts.length;
    await run(7, 'j1@x', 'gibberish');
    assert.equal(routerPrompts.length - before, 2);
    assert.ok(routerPrompts.at(-1).includes('Your previous reply was not a valid JSON object'));
    const stored = await taSmartbarStore.latest('j1@x');
    assert.equal(stored.state, 'error');
    assert.equal(stored.errorType, 'json');
    assert.equal(stored.rawResponse, 'I would rather chat, attempt 2');
    assert.equal(lastRecord(7).hasRawResponse, true);
    assert.equal(lastRecord(7).rawResponse, undefined, 'the raw answer is not sent to the bar');
});

k.test('translate-language', 'translate to German: the translation prompt asks for German, the cached one is not taken', async () => {
    routes['traduci'] = json({ operations: [op('translate')], context: [], unrecognized: '' });
    routes['translate to German'] = json({ operations: [op('translate', { language: 'German' })], context: [], unrecognized: '' });
    show(7, 't1@x');
    await run(7, 't1@x', 'traduci');
    const count = () => ctx.workers.prompts().filter(p => featureOf(p) === 'translation' && messageOf(p) === 't1@x').length;
    assert.equal(count(), 1);
    await run(7, 't1@x', 'translate to German');
    assert.equal(count(), 2, 'a new call, not the cached translation');
    const last = ctx.workers.prompts().filter(p => featureOf(p) === 'translation').at(-1);
    assert.ok(last.includes('German'));
    assert.deepEqual((await taSmartbarStore.latest('t1@x')).operations.map(o => [o.id, o.state, o.params]), [['translate', 'done', { language: 'German' }]]);
});

k.test('named-tags', 'named tags are assigned with no model call', async () => {
    routes['tag it Work'] = json({ operations: [op('tag', { tags: ['Work'] })], context: [], unrecognized: '' });
    show(7, 'g1@x');
    const before = ctx.workers.prompts().filter(p => featureOf(p) === 'add_tags').length;
    await run(7, 'g1@x', 'tag it Work');
    assert.deepEqual(ctx.m.byHeaderId('g1@x').tags, ['work']);
    assert.equal(ctx.workers.prompts().filter(p => featureOf(p) === 'add_tags').length, before);
    const stored = await taSmartbarStore.latest('g1@x');
    assert.equal(stored.operations[0].state, 'done');
    assert.deepEqual(stored.operations[0].result.tags, ['Work']);
});

k.test('unavailable', 'an operation the router names that is not available is reported, never run', async () => {
    await ctx.ctl.browser.storage.local.set({ translate: false });
    try {
        routes['translate it'] = json({ operations: [op('translate'), op('summarize')], context: [], unrecognized: '' });
        show(7, 'u1@x');
        await run(7, 'u1@x', 'translate it');
        assert.ok(!routerPrompts.at(-1).includes('id: "translate"'), 'not offered to the router');
        const stored = await taSmartbarStore.latest('u1@x');
        assert.deepEqual(stored.reports, [{ kind: 'unavailable', id: 'translate' }]);
        assert.deepEqual(stored.operations.map(o => o.id), ['summarize']);
        assert.equal(ctx.workers.prompts().filter(p => featureOf(p) === 'translation' && messageOf(p) === 'u1@x').length, 0);
    } finally {
        await ctx.ctl.browser.storage.local.set({ translate: true });
    }
});

k.test('replace', 'a new instruction replaces the previous one: its router call stops, its record is replaced', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    show(7, 'p1@x');
    const first = run(7, 'p1@x', 'first instruction');
    for (let i = 0; i < 200 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    assert.equal(hold.held.length, 1);
    const firstId = (await taSmartbarStore.latest('p1@x')).id;
    ctx.workers.respond = answering(respondAll);
    routes['second instruction'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    await run(7, 'p1@x', 'second instruction');
    await first;
    await settle();
    assert.equal((await taSmartbarStore.get(firstId)).state, 'replaced');
    const latest = await taSmartbarStore.latest('p1@x');
    assert.notEqual(latest.id, firstId);
    assert.equal(latest.state, 'done');
    assert.equal(latest.sessionId, (await taSmartbarStore.get(firstId)).sessionId, 'the same bar session');
});

k.test('joins-batch-tag-job', 'a tag job already running (the automatic tagging) is joined, and a replacement never stops it', async () => {
    show(7, 'b1@x');
    let release;
    const batchJob = taJobRegistry.start('add_tags', 'b1@x', () => new Promise(r => { release = r; }));
    routes['tag this'] = json({ operations: [op('tag')], context: [], unrecognized: '' });
    const before = ctx.workers.prompts().filter(p => featureOf(p) === 'add_tags').length;
    const pending = run(7, 'b1@x', 'tag this');
    await settle();
    routes['summarize instead'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    await run(7, 'b1@x', 'summarize instead');
    assert.equal(batchJob.invalidated, false, 'the batch job is not invalidated');
    assert.equal(batchJob.abort.signal.aborted, false, 'nor aborted');
    release({ status: 'ok', data: { tags: ['Work'], assigned: true } });
    await pending;
    await settle();
    assert.equal(ctx.workers.prompts().filter(p => featureOf(p) === 'add_tags').length, before, 'no second tag call');
});

k.test('stop', 'Stop of the whole instruction ends the router call: errorType aborted', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    show(7, 'x1@x');
    const pending = run(7, 'x1@x', 'stop me');
    for (let i = 0; i < 200 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_stop', headerMessageId: 'x1@x' }), { ok: true });
    await pending;
    await settle();
    ctx.workers.respond = answering(respondAll);
    const stored = await taSmartbarStore.latest('x1@x');
    assert.equal(stored.state, 'error');
    assert.equal(stored.errorType, 'aborted');
});

k.test('disabled', 'with the feature off smartbar_run is refused and smartbar_get_state answers no state', async () => {
    await ctx.ctl.browser.storage.local.set({ smartbar_enabled: false });
    try {
        show(7, 'd1@x');
        assert.deepEqual(await run(7, 'd1@x', 'summarize'), { ok: false, error: 'disabled' });
        const state = await fromTab(ctx, 7, { command: 'smartbar_get_state' });
        assert.equal(state.config.enabled, false);
        assert.equal(state.state, null);
    } finally {
        await ctx.ctl.browser.storage.local.set({ smartbar_enabled: true });
    }
});

// ---- Compose -------------------------------------------------------------------------------

/**
 * Run the mock clock (the compose script is given 500 ms, insertReply retries every 250 ms) until
 * the latest record of hid is settled. Nothing waits for real time.
 */
async function settled(t, hid) {
    for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 60; j++) await new Promise(r => setImmediate(r));
        const rec = await taSmartbarStore.latest(hid);
        if (rec && rec.state !== 'running' && rec.operations.length > 0) return rec;
        t.mock.timers.tick(250);
    }
    return taSmartbarStore.latest(hid);
}
const composeRoute = (instruction, type, extra = []) => {
    routes[instruction] = json({ operations: [...extra, op('compose', { type })], context: [], unrecognized: '' });
};
const insertsTo = tabId => ctx.m.sentTo(tabId, 'insertReply');
const composeOf = rec => rec.operations.find(o => o.id === 'compose');

k.test('compose-reply', 'reply: the email to the execute call, the same compose window as the chat\'s reply, the text inserted', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('reply that I agree', 'reply');
    composes['reply that I agree'] = json({ subject: 'Ignored', body: 'I agree.\n\nSee you.', recipient: '', signature: '' });
    const h = show(7, 'c1@x');
    const answer = await run(7, 'c1@x', 'reply that I agree');
    assert.equal(answer.ok, true);
    const rec = await settled(t, 'c1@x');
    assert.deepEqual(rec.operations.map(o => [o.id, o.state]), [['compose', 'done']]);
    const prompt = composePrompts.at(-1);
    assert.ok(prompt.includes('Body of <c1@x>'), 'the execute call gets the email');
    assert.ok(prompt.includes('<<<EMAIL START>>>') && prompt.includes('<<<EMAIL END>>>'));
    assert.ok(prompt.includes('Instruction:\nreply that I agree'));
    assert.ok(prompt.includes('Type: reply ('));
    assert.ok(!routerPrompts.at(-1).includes('Body of <c1@x>'), 'still never the router');
    const opened = ctx.m.replies.at(-1);
    assert.equal(opened.messageId, h.id);
    assert.equal(opened.replyType, 'replyToSender');
    // The same compose details as the API chat's reply on the same message (chatgpt_replyMessage).
    await fromTab(ctx, 900, { command: 'chatgpt_replyMessage', text: '<p>x</p>', tabId: 7, mailMessageId: h.id, replyType: 'reply_sender' });
    const chat = ctx.m.replies.at(-1);
    assert.deepEqual([chat.replyType, chat.details], [opened.replyType, opened.details]);
    assert.deepEqual(Object.keys(opened.details).sort(), ['identityId', 'type']);
    const inserted = insertsTo(opened.tabId);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].text, '<!--sanitized--><p>I agree.</p><p>See you.</p>');
    const result = composeOf(rec).result;
    assert.deepEqual([result.type, result.subject, result.body], ['reply', '', 'I agree.\n\nSee you.']);
    // The bar gets the type and the reminder, never the generated text.
    const barOp = composeOf(lastRecord(7));
    assert.equal(barOp.result.type, 'reply');
    assert.equal(barOp.result.body, undefined);
});

k.test('compose-reply-all', 'reply to all: beginReply with replyToAll', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('rispondi a tutti', 'reply_all');
    show(7, 'c2@x');
    await run(7, 'c2@x', 'rispondi a tutti');
    const rec = await settled(t, 'c2@x');
    assert.equal(composeOf(rec).state, 'done');
    assert.equal(ctx.m.replies.at(-1).replyType, 'replyToAll');
});

k.test('compose-forward', 'forward: beginForward with Thunderbird\'s forward type, no recipient, the reminder kept', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('forward it to Marco', 'forward');
    composes['forward it to Marco'] = json({ subject: '', body: 'FYI, see below.', recipient: 'Marco', signature: '' });
    const h = show(7, 'c3@x');
    await run(7, 'c3@x', 'forward it to Marco');
    const rec = await settled(t, 'c3@x');
    const opened = ctx.m.forwards.at(-1);
    assert.equal(opened.messageId, h.id);
    assert.equal(opened.forwardType, undefined, 'the forward type of Thunderbird\'s preferences');
    assert.deepEqual(Object.keys(opened.details), ['identityId'], 'no recipient, no body');
    assert.equal(insertsTo(opened.tabId)[0].text, '<!--sanitized--><p>FYI, see below.</p>');
    assert.equal(composeOf(rec).result.recipient, 'Marco');
    assert.equal(composeOf(lastRecord(7)).result.recipient, 'Marco');
});

k.test('compose-new', 'new: beginNew with the generated subject, no recipient, not threaded', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('write a new email to the supplier', 'new');
    composes['write a new email to the supplier'] = json({ subject: 'Quote request', body: 'Hello,\n\nplease send a quote.', recipient: 'the supplier', signature: '' });
    show(7, 'c4@x');
    await run(7, 'c4@x', 'write a new email to the supplier');
    const rec = await settled(t, 'c4@x');
    const opened = ctx.m.newMessages.at(-1);
    assert.equal(opened.messageId, undefined, 'not threaded to the message');
    assert.deepEqual(Object.keys(opened.details).sort(), ['identityId', 'subject']);
    assert.equal(opened.details.subject, 'Quote request');
    assert.equal(insertsTo(opened.tabId)[0].text, '<!--sanitized--><p>Hello,</p><p>please send a quote.</p>');
    assert.equal(composeOf(rec).result.subject, 'Quote request');
});

k.test('compose-last', 'compose runs after the other operations, whatever the router\'s order', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    routes['reply and summarize'] = json({ operations: [op('compose', { type: 'reply' }), op('summarize')], context: [], unrecognized: '' });
    show(7, 'c5@x');
    const before = ctx.workers.prompts().length;
    await run(7, 'c5@x', 'reply and summarize');
    const rec = await settled(t, 'c5@x');
    assert.deepEqual(rec.operations.map(o => [o.index, o.id, o.state]), [[0, 'summarize', 'done'], [1, 'compose', 'done']]);
    const order = ctx.workers.prompts().slice(before).map(p => (p.includes(COMPOSE_MARK) ? 'compose' : featureOf(p)));
    assert.ok(order.indexOf('summary') >= 0 && order.indexOf('summary') < order.indexOf('compose'), order.join(','));
});

k.test('compose-context', 'the context and the selected text go to the execute call, never to the router', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    routes['reply using the folder'] = json({ operations: [op('compose', { type: 'reply' })], context: ['mail_folder_name'], unrecognized: '' });
    show(7, 'c6@x');
    await run(7, 'c6@x', 'reply using the folder', { hasSelection: true, selection: 'the chosen words' });
    await settled(t, 'c6@x');
    const prompt = composePrompts.at(-1);
    assert.ok(prompt.includes('[mail_folder_name]\nInbox'), prompt.slice(prompt.indexOf('Context')));
    assert.ok(prompt.includes('[selected_text]\nthe chosen words'));
    assert.ok(!routerPrompts.at(-1).includes('the chosen words'));
    assert.deepEqual((await taSmartbarStore.latest('c6@x')).routerContext, ['mail_folder_name', 'selected_text']);
});

k.test('compose-settings', 'the length limit (quoted part first), the additional instructions, the signatures, the language', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ctx.ctl.browser.storage.local.set({
        smartbar_max_body_length: 30,
        smartbar_additional_instructions: 'Be formal.',
        smartbar_signature: 'Mario Rossi\nSales',
        default_chatgpt_lang: 'Italian',
    });
    nextSplit = { own: 'Own text of the author.', quoted: 'On Monday Bob wrote:\nquoted line one\nquoted line two' };
    try {
        composeRoute('reply and sign', 'reply');
        composes['reply and sign'] = json({ subject: '', body: 'Fine.', recipient: '', signature: 'default' });
        show(7, 'c7@x');
        await run(7, 'c7@x', 'reply and sign');
        await settled(t, 'c7@x');
        const prompt = composePrompts.at(-1);
        const email = prompt.slice(prompt.indexOf('<<<EMAIL START>>>'), prompt.indexOf('<<<EMAIL END>>>'));
        // 30 characters: the author's text whole, the quoted part cut from the bottom.
        assert.ok(email.includes('Own text of the author.\n\nOn Mo\n[truncated]'), email);
        assert.ok(!email.includes('quoted line'), 'the quoted part cut first');
        assert.ok(prompt.includes('Additional instructions:\nBe formal.'));
        assert.ok(prompt.includes('Mario Rossi\nSales'));
        assert.ok(prompt.includes('Language: Write in Italian, unless the instruction explicitly asks for another language.'));
        assert.equal(insertsTo(ctx.m.replies.at(-1).tabId)[0].text, '<!--sanitized--><p>Fine.</p><p>Mario Rossi<br>Sales</p>');
    } finally {
        nextSplit = null;
        await ctx.ctl.browser.storage.local.set({ smartbar_max_body_length: 0, smartbar_additional_instructions: '', smartbar_signature: '', default_chatgpt_lang: '' });
    }
});

k.test('compose-signature-rules', 'no signature unless asked; a dictated one as it is; the ThunderAI name when none is configured', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ctx.ctl.browser.storage.local.set({ default_sign_name: 'Mic' });
    try {
        const cases = [['', '<p>Body.</p>'], ['Cheers, M.', '<p>Body.</p><p>Cheers, M.</p>'], ['default', '<p>Body.</p><p>Mic</p>']];
        for (const [i, [signature, html]] of cases.entries()) {
            const instruction = 'reply sign case ' + i;
            composeRoute(instruction, 'reply');
            composes[instruction] = json({ subject: '', body: 'Body.', recipient: '', signature });
            show(7, 'cs' + i + '@x');
            await run(7, 'cs' + i + '@x', instruction);
            await settled(t, 'cs' + i + '@x');
            assert.equal(insertsTo(ctx.m.replies.at(-1).tabId)[0].text, '<!--sanitized-->' + html, signature);
        }
    } finally {
        await ctx.ctl.browser.storage.local.set({ default_sign_name: '' });
    }
});

k.test('compose-json-error', 'an answer that is not usable twice: errorType json with the raw answer, no window', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('reply in prose', 'reply');
    composes['reply in prose'] = attempt => (attempt === 1 ? 'Here is your reply: hi' : '{"subject": "x"}');
    show(7, 'c8@x');
    const opened = ctx.m.replies.length;
    await run(7, 'c8@x', 'reply in prose');
    const rec = await settled(t, 'c8@x');
    const line = composeOf(rec);
    assert.deepEqual([line.state, line.errorType], ['error', 'json']);
    assert.equal(line.rawResponse, '{"subject": "x"}');
    assert.ok(composePrompts.at(-1).includes('Your previous reply was not a valid JSON object with a non-empty "body"'));
    assert.equal(ctx.m.replies.length, opened, 'no window opened');
});

k.test('compose-stop', 'a generation stopped by the user never opens a window', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('reply slowly', 'reply');
    show(7, 'c9@x');
    const opened = ctx.m.replies.length;
    const hold = holding();
    // The router answers; the compose call is held.
    ctx.workers.respond = (w, prompt) => (String(prompt).includes(COMPOSE_MARK) ? hold.respond(w, prompt) : answering(respondAll)(w, prompt));
    try {
        await run(7, 'c9@x', 'reply slowly');
        for (let i = 0; i < 400 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
        assert.equal(hold.held.length, 1, 'the compose call is running');
        assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_stop', headerMessageId: 'c9@x' }), { ok: true });
        await settle();
        // The call was stopped at once: its worker is gone, no late answer can arrive.
        assert.throws(() => hold.held[0].answer('{"body": "too late"}'), /after terminate/);
    } finally {
        ctx.workers.respond = answering(respondAll);
    }
    const rec = await settled(t, 'c9@x');
    assert.equal(composeOf(rec).state, 'cancelled');
    assert.equal(ctx.m.replies.length, opened, 'no window opened');
});

k.test('compose-window-retry', 'a window that could not open: error compose_window, Retry opens it without a new generation', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    composeRoute('reply once', 'reply');
    composes['reply once'] = json({ subject: '', body: 'Kept text.', recipient: '', signature: '' });
    show(7, 'c10@x');
    ctx.m.failComposeOpen = 1;
    await run(7, 'c10@x', 'reply once');
    const rec = await settled(t, 'c10@x');
    const line = composeOf(rec);
    assert.deepEqual([line.state, line.errorType], ['error', 'compose_window']);
    assert.equal(line.result.body, 'Kept text.');
    const generated = composePrompts.length;
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_retry', headerMessageId: 'c10@x', recordId: rec.id, index: line.index }), { ok: true });
    // The stored line stays in error until the retry ends: run the clock until it is done.
    let again;
    for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 60; j++) await new Promise(r => setImmediate(r));
        again = composeOf(await taSmartbarStore.get(rec.id));
        if (again.state === 'done') break;
        t.mock.timers.tick(250);
    }
    assert.equal(again.state, 'done');
    assert.equal(composePrompts.length, generated, 'no new generation');
    assert.equal(insertsTo(ctx.m.replies.at(-1).tabId)[0].text, '<!--sanitized--><p>Kept text.</p>');
});

k.test('clean', 'no worker left alive, no unmodelled API, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
