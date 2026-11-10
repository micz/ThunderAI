// The API chat window in SmartBar mode (?smartbar=1&hid=..., api_webchat/smartbarChat.js): the
// chat of one message started from the SmartBar. A ChatGPT API window on the smartbar_chat
// prompt; the background's side is scripted here (what it does is tests/background/45-smartbar-chat).
//
// Spec 10 "Chat" ("The window"): no worker, the ready handshake as for any chat, a New conversation
// button in the header; the session resumed from smartbar_chat_init (the earlier messages not
// loaded said so), one turn per record: the user's message, then the model turn with the free
// answer (one render path), the result lines with the bar's texts and buttons (never "Open in
// chat"), the drafts with Create email; a message typed in the input goes to the background with a
// clientId and is drawn once; the reasoning streamed as a live row, then the window's thinking
// block; the tokens of a free answer streamed into its turn; the input back once the message is
// planned or answered; a rate-limited error counting down then retrying once by itself (never a
// resumed record, never twice, the message itself only as the newest turn); a turn from the bar drawn by the page; the prefilled instruction and the note
// of the attached context; a message from a content script ignored; a refused message as a localized
// text, never its code; a message stopped from outside (replaced) reading "Stopped", the input back.
// Spec 01 "Component structure" (SmartBar mode: no worker, the components unchanged).
//
// The tests run in order on one window; each builds on the previous ones.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    fromBackground,
    sentCommands,
    typeAndSend,
    turns,
    botTurns,
    answerEls,
    turnBody,
    field,
    sendButton,
    stopButton,
    usable,
    sq,
} from '../../webchat/webchat-page.mjs';

const HID = 'msg-1@example.com';
const CHAT_ID = 'sb_call';
let nextRecordId = 100;
let sendAnswer = null;
let createAnswer = { ok: true, result: { type: 'reply', recipient: '' } };
let newSession = { ok: true, sessionId: 'sess-2' };
const { ctx, worker, ready } = await openWebchat({
    llm: 'chatgpt_api',
    call_id: CHAT_ID,
    prompt_id: 'prompt_smartbar_chat',
    prompt_name: 'SmartBar',
    smartbar: { hid: HID },
    local: { chatgpt_model: 'gpt-test', chat_show_usage_data: true, hide_thinking: true },
    commands: {
        smartbar_chat_send: () => sendAnswer ?? { ok: true, recordId: nextRecordId },
        smartbar_chat_stop: () => ({ ok: true }),
        smartbar_chat_retry: () => ({ ok: true }),
        smartbar_chat_confirm: () => ({ ok: true }),
        smartbar_chat_cancel: () => ({ ok: true }),
        smartbar_chat_dismiss: () => ({ ok: true }),
        smartbar_chat_create: () => createAnswer,
        smartbar_chat_new_session: () => newSession,
        smartbar_chat_drop_context: () => ({ ok: true }),
        smartbar_open_page: () => ({ ok: true }),
    },
});
after(() => ctx.close());
const k = webchatTests('24');
const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);

const S_CHAT = 'spec 10 "Chat"';
const S_COMP = 'spec 01 "Component structure"';

const bg = (command, extra = {}) => fromBackground(ctx, { command, headerMessageId: HID, chatId: CHAT_ID, ...extra });
let seq = 0;
const update = (record, extra = {}) => bg('smartbar_chat_update', { seq: ++seq, record, ...extra });
const rec = (over = {}) => ({ id: 1, messageId: HID, sessionId: 'sess-1', source: 'chat', instruction: 'x', state: 'done',
    operations: [], reports: [], unrecognized: null, errorType: null, error: null, answer: null, draft: null, dismissed: null, ...over });
const op = (index, id, state, over = {}) => ({ index, id, params: {}, state, result: null, error: null, errorType: null, ...over });

const userTurns = () => turns(ctx).filter(t => t.classList.contains('turn-user'));
const bubbleText = t => t.querySelector('.bubble').textContent;
const lineTexts = turn => [...turnBody(turn).querySelectorAll('.sb-line .tx')].map(e => e.textContent);
const lineButtons = (turn, i) => [...turnBody(turn).querySelectorAll('.sb-line')].filter(l => l.querySelector('.tx'))[i].querySelectorAll('button');
const button = (turn, cls) => turnBody(turn).querySelector('button.' + cls);
const drafts = turn => [...turnBody(turn).querySelectorAll('.sb-draft')];
const newConversation = () => ctx.document.getElementById('smartbarNewConversation');
const contextNote = () => ctx.document.getElementById('smartbarContextNote');

k.test('no-worker', S_COMP, 'SmartBar mode: no worker is created; the ready handshake as for any chat; the header and the button', () => {
    assert.equal(worker.instance, null);
    assert.deepEqual(worker.unexpected, []);
    assert.equal(sentCommands(ctx, ready).length, 1);
    assert.equal(sentCommands(ctx, 'api_send').length, 0);
    assert.equal(ctx.document.getElementById('appHeaderModel').textContent, 'SmartBar | gpt-test');
    assert.equal(newConversation().textContent, msg('smartbar_chat_new_conversation'));
    assert.equal(contextNote().hidden, true);
    // No usage chip in this mode: the calls are the background's.
    assert.equal(sq(ctx.document, 'messages-area', '[data-mzta-usage]'), null);
});

k.test('init-resume', S_CHAT, 'the session is resumed: the hidden earlier messages said, a turn per record with its answer, lines and drafts', async () => {
    await bg('smartbar_chat_init', { seq: ++seq, sessionId: 'sess-1', total: 53, limit: 50, records: [
        rec({ id: 1, instruction: 'who is the sender?', answer: 'Alice, from **Sales**.' }),
        rec({ id: 2, source: 'bar', instruction: 'riassumi e tagga', operations: [
            op(0, 'summarize', 'done'), op(1, 'tag', 'done', { params: { tags: ['urgent'] }, result: { tags: ['urgent'] } }),
        ] }),
        rec({ id: 3, instruction: 'reply that I agree', operations: [
            op(0, 'compose', 'drafted', { params: { type: 'new' }, result: { type: 'new', subject: 'Quote', body: 'I agree.\nSee you.' } }),
        ], draft: { type: 'new', subject: 'Quote', body: 'I agree.\nSee you.', groupId: 'g3' } }),
    ] });
    const info = turns(ctx).filter(t => t.classList.contains('turn-info'));
    // The session holds 53, the window got 3: 50 are not shown.
    assert.equal(info.at(-1).textContent, msg('smartbar_chat_earlier_hidden', ['50']));
    assert.deepEqual(userTurns().map(bubbleText), ['who is the sender?', 'riassumi e tagga', 'reply that I agree']);
    const bots = botTurns(ctx);
    assert.equal(bots.length, 3);
    // The free answer through the one render path (markdown).
    assert.match(answerEls(bots[0])[0].innerHTML, /Alice, from <strong>Sales<\/strong>\./);
    assert.deepEqual(lineTexts(bots[1]), [msg('smartbar_result_summary_ready'), msg('smartbar_result_tags_added', ['urgent'])]);
    // The draft: the subject of a new email, the body, Create email; no line while drafted.
    const [draft] = drafts(bots[2]);
    assert.equal(draft.querySelector('.sb-draft-subject').textContent, msg('smartbar_chat_draft_subject', ['Quote']));
    assert.equal(draft.querySelector('.sb-draft-body').textContent, 'I agree.\nSee you.');
    assert.equal(draft.querySelector('.create_btn').textContent, msg('smartbar_chat_create_email'));
    assert.deepEqual(lineTexts(bots[2]), []);
    assert.equal(ctx.document.title.includes('SmartBar'), true);
});

k.test('lines-buttons', S_CHAT, 'the result lines read as in the bar, with its buttons naming the record; never Open in chat', async () => {
    await update(rec({ id: 3, state: 'running', operations: [
        op(0, 'compose', 'drafted', { params: { type: 'new' }, result: { type: 'new', subject: 'Quote', body: 'I agree.\nSee you.' } }),
        op(1, 'translate', 'running'),
        op(2, 'tag', 'error', { error: 'boom', errorType: 'api' }),
        op(3, 'summarize', 'pending_confirmation'),
    ], reports: [{ kind: 'unavailable', id: 'archive' }] }));
    const turn = botTurns(ctx)[2];
    assert.deepEqual(lineTexts(turn), [
        msg('smartbar_line_running', [msg('smartbar_op_translate')]),
        msg('smartbar_line_error', [msg('smartbar_op_tag'), 'boom']),
        msg('smartbar_line_pending', [msg('smartbar_op_summarize')]),
        msg('smartbar_report_unavailable', ['archive']),
    ]);
    assert.equal(turnBody(turn).querySelector('button.chat'), null, 'no Open in chat inside the chat');
    await ctx.click(lineButtons(turn, 0)[0]);
    assert.deepEqual(sentCommands(ctx, 'smartbar_chat_stop').at(-1), { command: 'smartbar_chat_stop', headerMessageId: HID, chatId: CHAT_ID, recordId: 3, index: 1 });
    await ctx.click(button(turn, 'retry'));
    assert.deepEqual(sentCommands(ctx, 'smartbar_chat_retry').at(-1), { command: 'smartbar_chat_retry', headerMessageId: HID, chatId: CHAT_ID, recordId: 3, index: 2 });
    await ctx.click(button(turn, 'remove'));
    assert.deepEqual(sentCommands(ctx, 'smartbar_chat_dismiss').at(-1), { command: 'smartbar_chat_dismiss', headerMessageId: HID, chatId: CHAT_ID, recordId: 3, what: 2 });
    await ctx.click(button(turn, 'confirm'));
    assert.equal(sentCommands(ctx, 'smartbar_chat_confirm').at(-1).index, 3);
    await ctx.click(button(turn, 'cancel'));
    assert.equal(sentCommands(ctx, 'smartbar_chat_cancel').at(-1).index, 3);
    await ctx.click(button(turn, 'details'));
    assert.deepEqual(sentCommands(ctx, 'smartbar_open_page'), [{ command: 'smartbar_open_page', tab: 'activity' }], 'Details opens the Activity tab of the page');
    // An older update of the same record is ignored.
    await bg('smartbar_chat_update', { seq: 1, record: rec({ id: 3, operations: [] }) });
    assert.equal(lineTexts(turn).length, 4);
});

k.test('draft-create', S_CHAT, 'Create email asks for the draft of its turn; the draft stays, the line says the window opened; a failure is said', async () => {
    const turn = botTurns(ctx)[2];
    await ctx.click(drafts(turn)[0].querySelector('.create_btn'));
    assert.deepEqual(sentCommands(ctx, 'smartbar_chat_create').at(-1), { command: 'smartbar_chat_create', headerMessageId: HID, chatId: CHAT_ID, recordId: 3, index: 0 });
    await update(rec({ id: 3, operations: [
        op(0, 'compose', 'done', { params: { type: 'new' }, result: { type: 'new', subject: 'Quote', body: 'I agree.\nSee you.', recipient: 'Marco' } }),
    ] }));
    assert.equal(drafts(turn).length, 1, 'the draft stays');
    assert.deepEqual(lineTexts(turn), [msg('smartbar_result_compose_opened_recipient', [msg('smartbar_op_compose_new'), 'Marco'])]);
    createAnswer = { ok: false, error: 'no window' };
    const again = drafts(turn)[0].querySelector('.create_btn');
    await ctx.click(again);
    assert.equal(drafts(turn)[0].querySelector('.sb-draft-status').textContent, msg('smartbar_chat_create_failed', ['no window']));
    assert.equal(again.disabled, false);
    createAnswer = { ok: true, result: { type: 'new', recipient: '' } };
});

k.test('send-stream', S_CHAT, 'a typed message: sent with a clientId and drawn once; the reasoning live then as the thinking block; the answer streamed; the input back', async () => {
    nextRecordId = 4;
    const usersBefore = userTurns().length;
    await typeAndSend(ctx, 'what is she asking me?');
    const sent = sentCommands(ctx, 'smartbar_chat_send').at(-1);
    assert.deepEqual(Object.keys(sent).sort(), ['chatId', 'clientId', 'command', 'headerMessageId', 'text']);
    assert.equal(sent.text, 'what is she asking me?');
    assert.ok(!usable(sendButton(ctx)) && usable(stopButton(ctx)), 'the input is locked, Stop offered');
    await update(rec({ id: 4, instruction: 'what is she asking me?', state: 'running' }), { clientId: sent.clientId });
    assert.equal(userTurns().length, usersBefore + 1, 'the bubble the input drew, not a second one');
    const turn = botTurns(ctx).at(-1);
    assert.deepEqual(lineTexts(turn), [msg('smartbar_routing')]);
    await bg('smartbar_chat_stream', { recordId: 4, thinking: 'She wants a quote.' });
    assert.ok(turnBody(turn).querySelector('.thinking-live'), 'the live row');
    await bg('smartbar_chat_stream', { recordId: 4, tokens: 'She asks for ' });
    await bg('smartbar_chat_stream', { recordId: 4, tokens: 'a **quote**.' });
    assert.equal(turnBody(turn).querySelector('.thinking-live'), null);
    assert.equal(answerEls(turn).length, 1);
    // The stop button of the input reaches the message in progress.
    await ctx.click(stopButton(ctx));
    assert.deepEqual(sentCommands(ctx, 'smartbar_chat_stop').at(-1), { command: 'smartbar_chat_stop', headerMessageId: HID, chatId: CHAT_ID, recordId: 4 });
    await update(rec({ id: 4, instruction: 'what is she asking me?', answer: 'She asks for a **quote**.' }));
    assert.equal(answerEls(turn).length, 1, 'the answer once');
    assert.match(answerEls(turn)[0].innerHTML, /She asks for a <strong>quote<\/strong>\./);
    const block = turnBody(turn).querySelector('details.thinking-block');
    assert.ok(block, 'the window\'s thinking block');
    assert.equal(block.open, false, 'collapsed with hide_thinking');
    assert.equal(block.querySelector('.thinking-content').textContent, 'She wants a quote.');
    assert.deepEqual(lineTexts(turn), []);
    assert.ok(usable(sendButton(ctx)) && usable(field(ctx)), 'the input is back');
});

k.test('note-and-bar-turn', S_CHAT, 'an unrecognized part beside operations is a note; a turn from the bar is drawn by the page', async () => {
    const usersBefore = userTurns().length;
    await update(rec({ id: 5, source: 'bar', instruction: 'riassumi e archivia', unrecognized: 'e archivia',
        operations: [op(0, 'summarize', 'done')] }));
    assert.equal(userTurns().length, usersBefore + 1);
    assert.equal(bubbleText(userTurns().at(-1)), 'riassumi e archivia');
    assert.deepEqual(lineTexts(botTurns(ctx).at(-1)), [msg('smartbar_result_summary_ready'), msg('smartbar_chat_unrecognized_note', ['e archivia'])]);
    // A record of another session is not drawn.
    await update(rec({ id: 6, sessionId: 'sess-other', instruction: 'elsewhere' }));
    assert.ok(!userTurns().some(t => bubbleText(t) === 'elsewhere'));
});

k.test('prefill', S_CHAT, 'the prefilled instruction and the note of the attached context; × drops it, sending hides it', async () => {
    await bg('smartbar_chat_prefill', { text: 'gibberish', hasRawContext: true });
    assert.equal(field(ctx).value, 'gibberish');
    assert.equal(contextNote().hidden, false);
    assert.equal(contextNote().querySelector('span').textContent, msg('smartbar_chat_raw_context_note'));
    await ctx.click(contextNote().querySelector('button'));
    assert.equal(contextNote().hidden, true);
    assert.equal(sentCommands(ctx, 'smartbar_chat_drop_context').length, 1);
    await bg('smartbar_chat_prefill', { text: 'gibberish', hasRawContext: true });
    nextRecordId = 7;
    await ctx.click(sendButton(ctx));
    assert.equal(contextNote().hidden, true, 'gone with the message it is attached to');
    assert.equal(sentCommands(ctx, 'smartbar_chat_drop_context').length, 1, 'not dropped: sent');
    await update(rec({ id: 7, instruction: 'gibberish', answer: 'ok' }), { clientId: sentCommands(ctx, 'smartbar_chat_send').at(-1).clientId });
    // Its first update already answered: the input comes back all the same.
    assert.ok(usable(sendButton(ctx)) && usable(field(ctx)));
});

k.test('content-script-ignored', S_CHAT, 'a message from a content script (it carries its tab) is ignored', async () => {
    const before = turns(ctx).length;
    await ctx.ctl.dispatchMessage({ command: 'smartbar_chat_update', headerMessageId: HID, chatId: CHAT_ID, seq: ++seq,
        record: rec({ id: 50, instruction: 'injected' }) }, { id: 'thunderai@micz.it', tab: { id: 7 } });
    await ctx.settle();
    assert.equal(turns(ctx).length, before);
    // Nor one for another chat.
    await fromBackground(ctx, { command: 'smartbar_chat_update', headerMessageId: HID, chatId: 'other', seq: ++seq, record: rec({ id: 51, instruction: 'other' }) });
    assert.equal(turns(ctx).length, before);
});

k.test('new-conversation', S_CHAT, 'New conversation: a new session; the turns go, the startup notice stays; disabled while a message is understood', async () => {
    await update(rec({ id: 8, instruction: 'busy', state: 'running' }));
    assert.equal(newConversation().disabled, true);
    await update(rec({ id: 8, instruction: 'busy', answer: 'done' }));
    assert.equal(newConversation().disabled, false);
    await ctx.click(newConversation());
    assert.equal(sentCommands(ctx, 'smartbar_chat_new_session').length, 1);
    const left = turns(ctx);
    assert.equal(left.length, 2, 'the startup notice and the new conversation notice');
    assert.ok(left.every(t => t.classList.contains('turn-info')));
    assert.ok(left[1].textContent.includes(msg('smartbar_chat_new_conversation_started')));
    // The old session's records are no longer drawn; the new session's are.
    await update(rec({ id: 3, instruction: 'old', sessionId: 'sess-1' }));
    await update(rec({ id: 9, instruction: 'fresh', sessionId: 'sess-2' }));
    assert.deepEqual(userTurns().map(bubbleText), ['fresh']);
});

k.test('rate-limit', S_CHAT, 'a rate-limited error counts down, then retries once by itself; never twice, never a resumed record, the message itself only as the newest turn', async () => {
    const autoRetries = () => sentCommands(ctx, 'smartbar_chat_retry').filter(c => c.auto === true);
    const limited = (retryAt, over = {}) => op(0, 'translate', 'error', { error: '429', errorType: 'rate_limit', retryAt, ...over });
    const before = autoRetries().length;
    await update(rec({ id: 20, sessionId: 'sess-2', instruction: 'traduci', state: 'error', operations: [limited(Date.now() + 60000)] }));
    let turn = botTurns(ctx).at(-1);
    const shown = turnBody(turn).querySelector('.countdown').textContent;
    assert.ok([msg('smartbar_retry_in', ['60']), msg('smartbar_retry_in', ['59'])].includes(shown), shown);
    assert.equal(autoRetries().length, before, 'not yet');
    // The time is up: one automatic retry of that line.
    await update(rec({ id: 20, sessionId: 'sess-2', instruction: 'traduci', state: 'error', operations: [limited(Date.now() - 1)] }));
    assert.deepEqual(autoRetries().slice(before), [{ command: 'smartbar_chat_retry', headerMessageId: HID, chatId: CHAT_ID, recordId: 20, index: 0, auto: true }]);
    assert.equal(turnBody(turn).querySelector('.countdown'), null);
    assert.ok(button(turn, 'retry'), 'Retry stays');
    // The same line failing again: never a second automatic retry.
    await update(rec({ id: 20, sessionId: 'sess-2', instruction: 'traduci', state: 'error', operations: [limited(Date.now() - 1, { autoRetried: true })] }));
    assert.equal(autoRetries().length, before + 1);
    // The message itself: retried by itself while it is the newest turn, not once a newer one exists.
    await update(rec({ id: 21, sessionId: 'sess-2', instruction: 'riassumi', state: 'error', errorType: 'rate_limit', error: '429', retryAt: Date.now() - 1 }));
    assert.deepEqual(autoRetries().at(-1), { command: 'smartbar_chat_retry', headerMessageId: HID, chatId: CHAT_ID, recordId: 21, index: null, auto: true });
    await update(rec({ id: 22, sessionId: 'sess-2', instruction: 'riassumi', answer: 'ok' }));
    await update(rec({ id: 20, sessionId: 'sess-2', instruction: 'traduci', state: 'error', errorType: 'rate_limit', error: '429', retryAt: Date.now() - 1, operations: [] }));
    assert.equal(autoRetries().length, before + 2, 'not the newest turn: Retry only');
    // A resumed record is history: no countdown, no automatic retry.
    await bg('smartbar_chat_init', { seq: ++seq, sessionId: 'sess-2', total: 1, limit: 50, records: [
        rec({ id: 23, sessionId: 'sess-2', instruction: 'tagga', state: 'error', operations: [op(0, 'tag', 'error', { error: '429', errorType: 'rate_limit', retryAt: Date.now() - 1 })] }),
    ] });
    turn = botTurns(ctx).at(-1);
    assert.equal(turnBody(turn).querySelector('.countdown'), null);
    assert.equal(autoRetries().length, before + 2);
    assert.ok(button(turn, 'retry'));
});

k.test('refused-replaced', S_CHAT, 'a refused message reads as a text, never a code; a message stopped from outside reads "Stopped" and gives the input back', async () => {
    const errorTexts = () => botTurns(ctx).flatMap(t => [...turnBody(t).querySelectorAll('.message.error')]).map(e => e.textContent);
    for (const [code, text] of [
        ['disabled', msg('smartbar_chat_error_disabled')],
        ['not_found', msg('smartbar_chat_error_not_found')],
        ['not_chat', msg('smartbar_chat_error_closed')],
        ['no_chat', msg('smartbar_chat_error_closed')],
        ['HTTP 500 from the provider', 'HTTP 500 from the provider'],
    ]) {
        sendAnswer = { ok: false, error: code };
        await typeAndSend(ctx, 'anything');
        assert.equal(errorTexts().at(-1), text, code);
        assert.ok(usable(sendButton(ctx)) && usable(field(ctx)), code + ': the input is back');
    }
    assert.ok(!errorTexts().some(t => /^(disabled|not_found|not_chat|no_chat)$/.test(t)));
    // Stopped from outside (the feature turned off): the turn ends, the input comes back.
    sendAnswer = null;
    nextRecordId = 30;
    await typeAndSend(ctx, 'slow');
    const clientId = sentCommands(ctx, 'smartbar_chat_send').at(-1).clientId;
    await update(rec({ id: 30, sessionId: 'sess-2', instruction: 'slow', state: 'running' }), { clientId });
    assert.ok(!usable(sendButton(ctx)));
    await update(rec({ id: 30, sessionId: 'sess-2', instruction: 'slow', state: 'replaced' }));
    const turn = botTurns(ctx).at(-1);
    assert.deepEqual(lineTexts(turn), [msg('smartbar_chat_replaced')]);
    assert.ok(usable(sendButton(ctx)) && usable(field(ctx)));
    assert.equal(newConversation().disabled, false);
    // Create email refused the same way: the text, not the code.
    await update(rec({ id: 31, sessionId: 'sess-2', instruction: 'reply', operations: [
        op(0, 'compose', 'drafted', { params: { type: 'reply' }, result: { type: 'reply', subject: '', body: 'Ok.' } }),
    ] }));
    createAnswer = { ok: false, error: 'not_found' };
    const draftTurn = botTurns(ctx).at(-1);
    await ctx.click(drafts(draftTurn)[0].querySelector('.create_btn'));
    assert.equal(drafts(draftTurn)[0].querySelector('.sb-draft-status').textContent,
        msg('smartbar_chat_create_failed', [msg('smartbar_chat_error_not_found')]));
    createAnswer = { ok: true, result: { type: 'reply', recipient: '' } };
});

k.test('harness-clean', S_COMP, 'the window ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
