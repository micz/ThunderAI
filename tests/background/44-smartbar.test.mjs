// What the background does with a Smart bar instruction (claude-spec/10-smartbar.md "Flow",
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
//  - Stop of the whole instruction ends the router call with errorType aborted.
// The record itself and the router's pure parts are the smartbar area's (tests/smartbar/).

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
const routes = {};          // instruction -> the router's raw answer (a string or a function of the attempt)
const routerPrompts = [];

const ctx = await bgContext({
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

k.test('clean', 'no worker left alive, no unmodelled API, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
