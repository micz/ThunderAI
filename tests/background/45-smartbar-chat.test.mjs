// What the background does with the chat of the Smart bar (claude-spec/10-smartbar.md "Chat"),
// through its real runtime.onMessage listener: the bar's tab opens the chat, the chat window's tab
// sends its messages.
//  - opening: smartbar_open_chat opens the API chat window in Smart bar mode (smartbar=1, the
//    message, prompt_smartbar_chat) on the smartbar_chat connection; once ready it gets the session
//    (smartbar_chat_init), then the text runs as its first message; a second open for the same
//    message brings that window to front (windows.update) and appends the turn: one chat per
//    message; the chat's commands are refused from any other tab;
//  - every message goes through the router (source chat); the messages append, none stops another;
//    Stop is explicit, also from the bar (its Stop names the record); the feature turned off stops
//    them and the window is told (replaced), the next message refused; an automatic retry of a
//    failed line is marked autoRetried;
//  - nothing recognized: the free answer, a special command with no JSON section, the email and
//    the conversation as data; its tokens streamed to the window, the answer stored (the bar gets
//    hasAnswer only); operations recognized with an unrecognized part: a note, no free answer;
//  - compose in the chat ends drafted (no window), the record's draft set; a refinement's router
//    is told draft_exists / draft_type and its compose prompt carries the previous draft; Create
//    email opens the window of the draft (twice: two windows), the line done; deliver_draft only
//    with a draft, after a compose of the same instruction, delivering the new draft;
//  - sessions: the window resumes the latest session; New conversation starts another one, which
//    the bar's next instruction joins too;
//  - "Open in chat" on a json error: the instruction prefilled, the raw answer attached to the next
//    message's free answer only, never to the router.
// The window itself (what it draws) is the webchat area's (dom/webchat/webchat-24-smartbar); the
// chat's pure parts are the smartbar area's (06-chat).

import assert from 'node:assert/strict';
import {
    bgContext,
    STARTUP
} from './context.mjs';
import { answering } from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    fromTab,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ROUTER_MARK = 'Reply with one JSON object and nothing else';
const COMPOSE_MARK = '\nOperation: compose\n';
const CHAT_MARK = 'The user\'s new message:\n';
const routes = {};          // instruction -> the router's raw answer
const routerPrompts = [];
const composes = {};        // instruction -> the compose answer
const composePrompts = [];
const answers = {};         // message -> the free answer
const chatPrompts = [];
const heldRouter = [];      // the router calls held by a test: { instruction, release(answer) }
const holdInstructions = new Set();

const ctx = await bgContext({
    // The chat windows are forgotten when closed: the listener the startup registers.
    // The bars (and the chats) follow the feature switch: the listener the startup registers.
    statements: [...STARTUP, 'setupSmartbarConfigListener();', 'setupSmartbarChatListener();'],
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
    },
});
const k = caseTests('45-smartbar-chat');

const instructionOf = prompt => (/Instruction:\n([^\n]*)/.exec(prompt) || [])[1];
const messageOfChat = prompt => String(prompt).split(CHAT_MARK)[1]?.split('\n\nLanguage:')[0];
const answerAll = answering((prompt) => {
    const p = String(prompt);
    if (p.includes(COMPOSE_MARK)) {
        composePrompts.push(p);
        return composes[instructionOf(p)] ?? '{"subject": "", "body": "Generated text.", "recipient": "", "signature": ""}';
    }
    if (p.includes(ROUTER_MARK)) {
        routerPrompts.push(p);
        return routes[instructionOf(p)] ?? '{"operations": [], "context": [], "unrecognized": ""}';
    }
    if (p.includes(CHAT_MARK)) {
        chatPrompts.push(p);
        const message = messageOfChat(p);
        return answers[message] ?? 'Free answer to: ' + message;
    }
    const f = featureOf(p);
    if (f === 'summary') return 'Summary of **' + messageOf(p) + '**';
    if (f === 'translation') return JSON.stringify({ subject: 'Betreff', body: 'Text', status: '1' });
    throw new Error('45-smartbar-chat: unexpected prompt ' + p.slice(0, 80));
});
ctx.workers.respond = (w, prompt) => {
    const p = String(prompt);
    const instruction = instructionOf(p);
    if (p.includes(ROUTER_MARK) && holdInstructions.has(instruction)) {
        routerPrompts.push(p);
        heldRouter.push({ instruction, release: (answer) => answering(() => answer)(w, prompt) });
        return;
    }
    answerAll(w, prompt);
};

const json = o => JSON.stringify(o);
const op = (id, params = {}) => ({ id, params });
const { taSmartbarStore } = await import('../../js/mzta-smartbar-store.js');
const turns = async (n = 200) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const onRemoved = ctx.ctl.browser.windows.onRemoved;

const show = (tabId, hid) => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId: 'f-inbox', subject: 'Subject of ' + hid,
        author: 'Alice Smith <alice@example.com>' });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const fromBar = (hid, command, extra = {}) => fromTab(ctx, 7, { command, headerMessageId: hid, ...extra }, { turns: 200 });
const windowCreates = () => ctx.m.calls.filter(c => c.api === 'windows.create');

/** Open the chat of hid from the bar, and announce its window ready. */
async function openChat(hid, extra = {}) {
    const before = ctx.m.windows.length;
    const res = await fromBar(hid, 'smartbar_open_chat', extra);
    assert.deepEqual(res, { ok: true });
    assert.equal(ctx.m.windows.length, before + 1, 'one window opened');
    const win = ctx.m.windows.at(-1);
    const url = new URL(win.url);
    const tabId = win.id * 10;
    ctx.m.addTab({ id: tabId, type: 'content', windowId: win.id });
    const chat = { win, url, tabId, chatId: url.searchParams.get('call_id'), llm: url.searchParams.get('llm'), hid };
    await ctx.ctl.dispatchMessage({ command: chat.llm + '_ready_' + chat.chatId, window_id: win.id },
        { id: 'thunderai@micz.it', tab: { id: tabId, windowId: win.id } });
    await turns();
    return chat;
}
const fromChat = (chat, command, extra = {}) =>
    fromTab(ctx, chat.tabId, { command, headerMessageId: chat.hid, chatId: chat.chatId, ...extra }, { type: 'content', turns: 300 });
const toChat = (chat, command) => ctx.m.sentTo(chat.tabId, command);
const lastUpdate = chat => toChat(chat, 'smartbar_chat_update').at(-1)?.record;
const latest = hid => taSmartbarStore.latest(hid);
async function closeChat(chat) {
    for (const fn of [...onRemoved._listeners]) fn(chat.win.id);
    await turns(20);
}

/** Run the mock clock until no compose window is still waiting for its text. */
async function tickCompose(t) {
    for (let i = 0; i < 10; i++) {
        await turns(60);
        t.mock.timers.tick(500);
    }
    await turns(60);
}

k.test('open', 'the chat opens in Smart bar mode on smartbar_chat, gets its session, then the text runs as its first message', async () => {
    show(7, 'o1@x');
    routes['riassumi'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    const chat = await openChat('o1@x', { text: 'riassumi' });
    assert.equal(chat.url.pathname.endsWith('/api_webchat/index.html'), true);
    assert.equal(chat.url.searchParams.get('smartbar'), '1');
    assert.equal(chat.url.searchParams.get('hid'), 'o1@x');
    assert.equal(chat.url.searchParams.get('prompt_id'), 'prompt_smartbar_chat');
    assert.equal(chat.llm, API.connection_type);
    assert.equal(windowCreates().at(-1).args[0].type, 'popup');
    const init = toChat(chat, 'smartbar_chat_init');
    assert.equal(init.length, 1);
    assert.deepEqual([init[0].records, init[0].total, init[0].limit, init[0].chatId], [[], 0, 50, chat.chatId]);
    const rec = await latest('o1@x');
    assert.deepEqual([rec.source, rec.instruction, rec.state], ['chat', 'riassumi', 'done']);
    assert.deepEqual(rec.operations.map(o => [o.id, o.state]), [['summarize', 'done']]);
    assert.equal(lastUpdate(chat).id, rec.id);
    assert.equal(lastUpdate(chat).operations[0].state, 'done');
    // The commands of the chat come from its window only.
    assert.deepEqual(await fromTab(ctx, 7, { command: 'smartbar_chat_send', headerMessageId: 'o1@x', chatId: chat.chatId, text: 'x' }),
        { ok: false, error: 'not_chat' });
    assert.deepEqual(await fromChat({ ...chat, chatId: 'other' }, 'smartbar_chat_send', { text: 'x' }), { ok: false, error: 'not_chat' });
    await closeChat(chat);
});

k.test('one-per-message', 'a second open for the same message brings the window to front and appends the turn', async () => {
    show(7, 'o2@x');
    const chat = await openChat('o2@x');
    const updatesBefore = ctx.m.calls.filter(c => c.api === 'windows.update').length;
    const windows = ctx.m.windows.length;
    assert.deepEqual(await fromBar('o2@x', 'smartbar_open_chat', { text: 'who wrote it?' }), { ok: true });
    assert.equal(ctx.m.windows.length, windows, 'no second window');
    const focus = ctx.m.calls.filter(c => c.api === 'windows.update');
    assert.equal(focus.length, updatesBefore + 1);
    assert.deepEqual(focus.at(-1).args, [chat.win.id, { focused: true }]);
    assert.equal((await latest('o2@x')).instruction, 'who wrote it?');
    assert.equal(lastUpdate(chat).instruction, 'who wrote it?');
    // Closed, it is forgotten: the next open is a new window.
    await closeChat(chat);
    const again = await openChat('o2@x');
    assert.notEqual(again.win.id, chat.win.id);
    await closeChat(again);
});

k.test('append-no-abort', 'every message goes through the router; a second one never stops the first; Stop is explicit', async () => {
    show(7, 'a1@x');
    const chat = await openChat('a1@x');
    holdInstructions.add('slow one');
    const before = routerPrompts.length;
    await fromChat(chat, 'smartbar_chat_send', { text: 'slow one', clientId: 'c1' });
    routes['riassumi'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    const second = await fromChat(chat, 'smartbar_chat_send', { text: 'riassumi', clientId: 'c2' });
    assert.equal(second.ok, true);
    assert.equal(routerPrompts.length - before, 2, 'one router call per message');
    const { records } = await taSmartbarStore.sessionRecords((await latest('a1@x')).sessionId);
    const slow = records.find(r => r.instruction === 'slow one');
    assert.equal(slow.state, 'running', 'the first message still runs');
    assert.equal(records.find(r => r.instruction === 'riassumi').state, 'done');
    // The update of a message the window sent carries its clientId.
    assert.ok(toChat(chat, 'smartbar_chat_update').some(u => u.record.instruction === 'riassumi' && u.clientId === 'c2'));
    heldRouter.shift().release(json({ operations: [op('translate')], context: [], unrecognized: '' }));
    await turns(300);
    const done = await taSmartbarStore.get(slow.id);
    assert.deepEqual([done.state, done.operations.map(o => [o.id, o.state])], ['done', [['translate', 'done']]]);
    // Stop is explicit: the input's Stop ends the message being understood.
    await fromChat(chat, 'smartbar_chat_send', { text: 'slow one', clientId: 'c3' });
    assert.deepEqual(await fromChat(chat, 'smartbar_chat_stop', {}), { ok: true });
    await turns(100);
    const stopped = await latest('a1@x');
    assert.deepEqual([stopped.state, stopped.errorType], ['error', 'aborted']);
    // The bar shows that message too: its Stop names the record, and stops it.
    await fromChat(chat, 'smartbar_chat_send', { text: 'slow one', clientId: 'c4' });
    const shown = await latest('a1@x');
    assert.equal(shown.state, 'running');
    assert.deepEqual(await fromBar('a1@x', 'smartbar_stop', { recordId: shown.id }), { ok: true });
    await turns(100);
    assert.equal((await taSmartbarStore.get(shown.id)).errorType, 'aborted');
    heldRouter.length = 0;
    holdInstructions.delete('slow one');
    await closeChat(chat);
});

k.test('free-answer', 'nothing recognized: the free answer with the email and the conversation as data, streamed and stored', async () => {
    show(7, 'f1@x');
    const chat = await openChat('f1@x');
    routes['riassumi'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'riassumi' });
    answers['who is the sender?'] = 'Alice, from Sales.';
    await fromChat(chat, 'smartbar_chat_send', { text: 'who is the sender?' });
    const p = chatPrompts.at(-1);
    assert.ok(p.includes('<<<EMAIL START>>>') && p.includes('Body of <f1@x>'), 'the email');
    assert.ok(p.includes('<<<CONVERSATION START>>>') && p.includes('User: riassumi') && p.includes('Operations: summarize: done'), 'the conversation');
    assert.ok(!p.includes(ROUTER_MARK) && !p.includes('Reply with one JSON object'), 'no JSON section');
    assert.ok(p.includes(CHAT_MARK + 'who is the sender?'));
    assert.ok(!routerPrompts.at(-1).includes('Body of <f1@x>'), 'the router never gets the body');
    const rec = await latest('f1@x');
    assert.deepEqual([rec.answer, rec.state, rec.operations], ['Alice, from Sales.', 'done', []]);
    // The tokens reached the window before the record's final update.
    const sends = ctx.m.sentTo(chat.tabId).filter(x => x.recordId === rec.id || x.record?.id === rec.id);
    const tokenAt = sends.findIndex(x => x.command === 'smartbar_chat_stream' && x.tokens);
    assert.ok(tokenAt >= 0, 'streamed');
    assert.equal(sends[tokenAt].tokens, 'Alice, from Sales.');
    assert.ok(sends.findIndex(x => x.command === 'smartbar_chat_update' && x.record.answer) > tokenAt);
    assert.equal(lastUpdate(chat).answer, 'Alice, from Sales.');
    // The bar: hasAnswer, never the text.
    const bar = ctx.m.sentTo(7, 'smartbar_update').at(-1).record;
    assert.deepEqual([bar.id, bar.hasAnswer, bar.answer], [rec.id, true, undefined]);
    await closeChat(chat);
});

k.test('unrecognized', 'an unrecognized part beside operations is a note with no free answer; with no operation, the free answer', async () => {
    show(7, 'u1@x');
    const chat = await openChat('u1@x');
    routes['riassumi e archivia'] = json({ operations: [op('summarize')], context: [], unrecognized: 'e archivia' });
    const before = chatPrompts.length;
    await fromChat(chat, 'smartbar_chat_send', { text: 'riassumi e archivia' });
    let rec = await latest('u1@x');
    assert.deepEqual([rec.unrecognized, rec.answer, chatPrompts.length], ['e archivia', null, before]);
    routes['archivia'] = json({ operations: [], context: [], unrecognized: 'archivia' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'archivia' });
    rec = await latest('u1@x');
    assert.equal(chatPrompts.length, before + 1);
    assert.equal(rec.answer, 'Free answer to: archivia');
    await closeChat(chat);
});

k.test('drafted', 'compose in the chat ends drafted: no window, the draft on the record, the bar without its text', async () => {
    show(7, 'd1@x');
    const chat = await openChat('d1@x');
    routes['reply that I agree'] = json({ operations: [op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    composes['reply that I agree'] = json({ subject: '', body: 'I agree.', recipient: '', signature: '' });
    const replies = ctx.m.replies.length;
    await fromChat(chat, 'smartbar_chat_send', { text: 'reply that I agree' });
    const rec = await latest('d1@x');
    assert.equal(ctx.m.replies.length, replies, 'no compose window');
    assert.deepEqual(rec.operations.map(o => [o.id, o.state]), [['compose', 'drafted']]);
    assert.equal(rec.state, 'done');
    assert.deepEqual({ ...rec.draft, groupId: !!rec.draft.groupId }, { type: 'reply', subject: '', body: 'I agree.', groupId: true });
    assert.equal(rec.draft.groupId, rec.groupId);
    assert.equal(lastUpdate(chat).operations[0].result.body, 'I agree.', 'the chat gets the draft');
    const bar = ctx.m.sentTo(7, 'smartbar_update').at(-1).record;
    assert.deepEqual([bar.operations[0].state, bar.operations[0].result.body, bar.draft], ['drafted', undefined, undefined]);
    await closeChat(chat);
});

k.test('refinement', 'with a draft the router is told draft_exists / draft_type; the refinement\'s compose sees the previous draft', async () => {
    show(7, 'r1@x');
    const chat = await openChat('r1@x');
    routes['reply that I agree'] = json({ operations: [op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    composes['reply that I agree'] = json({ subject: '', body: 'I agree with every point you made.', recipient: '', signature: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'reply that I agree' });
    assert.ok(routerPrompts.at(-1).includes('(draft_exists): no'));
    routes['shorter'] = json({ operations: [op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    composes['shorter'] = json({ subject: '', body: 'I agree.', recipient: '', signature: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'shorter' });
    const router = routerPrompts.at(-1);
    assert.ok(router.includes('(draft_exists): yes'));
    assert.ok(router.includes('(draft_type): reply'));
    assert.ok(!router.includes('I agree with every point'), 'never the draft\'s text');
    const compose = composePrompts.at(-1);
    assert.ok(compose.includes('<<<CONVERSATION START>>>'));
    assert.ok(compose.includes('User: reply that I agree'));
    assert.ok(compose.includes('Draft (reply):\nI agree with every point you made.'));
    assert.ok(compose.indexOf('<<<CONVERSATION END>>>') < compose.indexOf('Instruction:\nshorter'));
    // The new draft is the current one; the previous stays drafted in its turn.
    const { records } = await taSmartbarStore.sessionRecords((await latest('r1@x')).sessionId);
    assert.deepEqual(records.map(r => [r.instruction, r.operations[0].state, r.draft.body]),
        [['reply that I agree', 'drafted', 'I agree with every point you made.'], ['shorter', 'drafted', 'I agree.']]);
    await closeChat(chat);
});

k.test('create-email', 'Create email opens the window of the draft as the bar\'s compose would; again, a second window', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = show(7, 'c1@x');
    const chat = await openChat('c1@x');
    routes['reply ok'] = json({ operations: [op('compose', { type: 'reply_all' })], context: [], unrecognized: '' });
    composes['reply ok'] = json({ subject: '', body: 'Fine by me.', recipient: 'Marco', signature: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'reply ok' });
    await tickCompose(t);
    const rec = await latest('c1@x');
    const replies = ctx.m.replies.length;
    const created = fromChat(chat, 'smartbar_chat_create', { recordId: rec.id, index: 0 });
    await tickCompose(t);
    assert.deepEqual(await created, { ok: true, result: { type: 'reply_all', recipient: 'Marco' } });
    assert.equal(ctx.m.replies.length, replies + 1);
    const opened = ctx.m.replies.at(-1);
    assert.deepEqual([opened.messageId, opened.replyType], [h.id, 'replyToAll']);
    assert.equal(ctx.m.sentTo(opened.tabId, 'insertReply')[0].text, '<!--sanitized--><p>Fine by me.</p>');
    const after = await taSmartbarStore.get(rec.id);
    assert.equal(after.operations[0].state, 'done');
    assert.equal(after.draft.body, 'Fine by me.', 'the draft stays');
    assert.equal(lastUpdate(chat).operations[0].state, 'done');
    const again = fromChat(chat, 'smartbar_chat_create', { recordId: rec.id, index: 0 });
    await tickCompose(t);
    assert.equal((await again).ok, true);
    assert.equal(ctx.m.replies.length, replies + 2, 'a second window');
    await closeChat(chat);
});

k.test('deliver-draft-availability', 'deliver_draft is offered to the router only in the chat with a draft', async () => {
    show(7, 'v1@x');
    routes['ok vai'] = json({ operations: [], context: [], unrecognized: 'ok vai' });
    await fromBar('v1@x', 'smartbar_run', { instruction: 'ok vai' });
    assert.ok(!routerPrompts.at(-1).includes('id: "deliver_draft"'), 'never from the bar');
    const chat = await openChat('v1@x');
    await fromChat(chat, 'smartbar_chat_send', { text: 'ok vai' });
    assert.ok(!routerPrompts.at(-1).includes('id: "deliver_draft"'), 'no draft yet');
    routes['reply'] = json({ operations: [op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'reply' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'ok vai' });
    assert.ok(routerPrompts.at(-1).includes('id: "deliver_draft"'));
    // A deliver_draft the router names without a draft is reported unavailable, never run.
    routes['create it'] = json({ operations: [op('deliver_draft')], context: [], unrecognized: '' });
    await fromBar('v1@x', 'smartbar_run', { instruction: 'create it' });
    const bar = await latest('v1@x');
    assert.deepEqual([bar.operations, bar.reports], [[], [{ kind: 'unavailable', id: 'deliver_draft' }]]);
    await closeChat(chat);
});

k.test('deliver-draft-with-compose', '"make it shorter and create it": compose first, then deliver_draft opens the new draft', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    show(7, 'w1@x');
    const chat = await openChat('w1@x');
    routes['reply long'] = json({ operations: [op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    composes['reply long'] = json({ subject: '', body: 'A long reply.', recipient: '', signature: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'reply long' });
    // The router gives them in the reverse order: the plan runs compose first anyway.
    routes['create it after making it shorter'] = json({ operations: [op('deliver_draft'), op('compose', { type: 'reply' })], context: [], unrecognized: '' });
    composes['create it after making it shorter'] = json({ subject: '', body: 'Short.', recipient: '', signature: '' });
    const replies = ctx.m.replies.length;
    const sent = fromChat(chat, 'smartbar_chat_send', { text: 'create it after making it shorter' });
    await tickCompose(t);
    await sent;
    await tickCompose(t);
    const rec = await latest('w1@x');
    assert.deepEqual(rec.operations.map(o => [o.index, o.id, o.state, o.dependsOn]),
        [[0, 'compose', 'done', []], [1, 'deliver_draft', 'done', [0]]]);
    assert.deepEqual(rec.operations[1].result, { type: 'reply', recipient: '' });
    assert.equal(ctx.m.replies.length, replies + 1, 'one window: the new draft');
    assert.equal(ctx.m.sentTo(ctx.m.replies.at(-1).tabId, 'insertReply')[0].text, '<!--sanitized--><p>Short.</p>');
    // The previous draft is untouched (still drafted in its own turn).
    const { records } = await taSmartbarStore.sessionRecords(rec.sessionId);
    assert.equal(records[0].operations[0].state, 'drafted');
    await closeChat(chat);
});

k.test('auto-retry', 'the chat\'s automatic retry of a failed line runs that line again and marks it autoRetried', async () => {
    show(7, 'q1@x');
    const chat = await openChat('q1@x');
    routes['traduci'] = json({ operations: [op('translate')], context: [], unrecognized: '' });
    await fromChat(chat, 'smartbar_chat_send', { text: 'traduci' });
    const rec = await latest('q1@x');
    // Made to have failed on a rate limit (the translation pipeline's own errors are its flow tests').
    await taSmartbarStore.save({ ...rec, operations: rec.operations.map(o => ({ ...o, state: 'error', error: '429', errorType: 'rate_limit', retryAt: Date.now() })) });
    assert.deepEqual(await fromChat(chat, 'smartbar_chat_retry', { recordId: rec.id, index: 0, auto: true }), { ok: true });
    await turns(200);
    const after = await taSmartbarStore.get(rec.id);
    assert.deepEqual([after.operations[0].state, after.operations[0].autoRetried, after.source], ['done', true, 'chat']);
    assert.equal(lastUpdate(chat).operations[0].autoRetried, true);
    await closeChat(chat);
});

k.test('sessions', 'the window resumes the latest session; New conversation starts another, which the bar joins too', async () => {
    show(7, 's1@x');
    let chat = await openChat('s1@x');
    await fromChat(chat, 'smartbar_chat_send', { text: 'first question' });
    const first = await latest('s1@x');
    await closeChat(chat);
    chat = await openChat('s1@x');
    const init = toChat(chat, 'smartbar_chat_init').at(-1);
    assert.equal(init.sessionId, first.sessionId);
    assert.deepEqual(init.records.map(r => [r.instruction, r.answer]), [['first question', 'Free answer to: first question']]);
    // The bar's instruction continues the same session, and shows in the open chat.
    routes['riassumi'] = json({ operations: [op('summarize')], context: [], unrecognized: '' });
    await fromBar('s1@x', 'smartbar_run', { instruction: 'riassumi' });
    const bar = await latest('s1@x');
    assert.deepEqual([bar.source, bar.sessionId], ['bar', first.sessionId]);
    assert.equal(lastUpdate(chat).id, bar.id);
    const fresh = await fromChat(chat, 'smartbar_chat_new_session');
    assert.equal(fresh.ok, true);
    assert.notEqual(fresh.sessionId, first.sessionId);
    await fromChat(chat, 'smartbar_chat_send', { text: 'second question' });
    const second = await latest('s1@x');
    assert.equal(second.sessionId, fresh.sessionId);
    assert.ok(!chatPrompts.at(-1).includes('first question'), 'the new conversation does not carry the old one');
    await fromBar('s1@x', 'smartbar_run', { instruction: 'riassumi' });
    assert.equal((await latest('s1@x')).sessionId, fresh.sessionId, 'the bar joins it');
    await closeChat(chat);
    chat = await openChat('s1@x');
    assert.deepEqual(toChat(chat, 'smartbar_chat_init').at(-1).records.map(r => r.instruction), ['second question', 'riassumi']);
    // The old records stay until they expire.
    assert.equal((await taSmartbarStore.sessionRecords(first.sessionId)).total, 2);
    await closeChat(chat);
});

k.test('raw-context', '"Open in chat" on a json error: the instruction prefilled, the raw answer attached to the next free answer only', async () => {
    show(7, 'j1@x');
    routes['gibberish'] = 'not json at all {RAW-MARK}';
    await fromBar('j1@x', 'smartbar_run', { instruction: 'gibberish' });
    const failed = await latest('j1@x');
    assert.equal(failed.errorType, 'json');
    const routerCalls = routerPrompts.length;
    const chat = await openChat('j1@x', { fromError: { recordId: failed.id, index: null } });
    assert.equal(routerPrompts.length, routerCalls, 'nothing sent: the instruction is only prefilled');
    assert.deepEqual(toChat(chat, 'smartbar_chat_prefill').map(x => [x.text, x.hasRawContext]), [['gibberish', true]]);
    await fromChat(chat, 'smartbar_chat_send', { text: 'what went wrong?' });
    assert.ok(!routerPrompts.at(-1).includes('RAW-MARK'), 'never to the router');
    assert.ok(chatPrompts.at(-1).includes('could not be read') && chatPrompts.at(-1).includes('{RAW-MARK}'));
    await fromChat(chat, 'smartbar_chat_send', { text: 'and now?' });
    assert.ok(!chatPrompts.at(-1).includes('RAW-MARK'), 'attached to one message only');
    // × drops it unsent.
    await closeChat(chat);
    const again = await openChat('j1@x', { fromError: { recordId: failed.id, index: null } });
    assert.deepEqual(await fromChat(again, 'smartbar_chat_drop_context'), { ok: true });
    await fromChat(again, 'smartbar_chat_send', { text: 'hello' });
    assert.ok(!chatPrompts.at(-1).includes('RAW-MARK'));
    await closeChat(again);
});

k.test('feature-off', 'the feature turned off stops the chat\'s messages and tells the window; the next message is refused', async () => {
    show(7, 'x1@x');
    const chat = await openChat('x1@x');
    holdInstructions.add('slow off');
    await fromChat(chat, 'smartbar_chat_send', { text: 'slow off', clientId: 'c1' });
    const running = await latest('x1@x');
    assert.equal(running.state, 'running');
    try {
        await ctx.ctl.browser.storage.local.set({ smartbar_enabled: false });
        await turns(300);
        const shown = lastUpdate(chat);
        assert.deepEqual([shown.id, shown.state], [running.id, 'replaced'], 'the window is told');
        assert.equal((await taSmartbarStore.get(running.id)).state, 'replaced');
        assert.deepEqual(await fromChat(chat, 'smartbar_chat_send', { text: 'again' }), { ok: false, error: 'disabled' });
    } finally {
        await ctx.ctl.browser.storage.local.set({ smartbar_enabled: true });
        await turns(50);
        heldRouter.length = 0;
        holdInstructions.delete('slow off');
    }
    await closeChat(chat);
});

k.test('clean', 'no worker left alive, no unmodelled API, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
