// The API chat window in SmartBar mode on a compose window (?smartbar=1&hid=compose:30&compose=30,
// api_webchat/smartbarChat.js): the chat of the email being written. The background's side is
// scripted here (what it does is tests/background/48-smartbar-compose).
//
// claude-spec/10-smartbar-compose.md "Opening it": the header names the email being written (its
// subject, else a new email). "Proposals and Apply": a proposal is drawn with what it changes,
// Show differences (the change picker on the original and the proposal), Apply and Copy; Apply
// sends smartbar_chat_apply, with what the picker composed once it is opened; a proposal applied
// reads "Applied" and its line says so; one whose
// target changed says it, Apply disabled, with Retry; the subject drawn the same way. "Select": its
// line with the passage. "When the compose window closes": the note above the input, the input
// disabled for good, Apply and Retry gone or disabled, the turns and Copy kept; a message stopped
// from outside reads the compose window's "Stopped". No "Details" (the Activity tab never lists
// these records).
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
    botTurns,
    turnBody,
    field,
    sq,
} from '../../webchat/webchat-page.mjs';

const HID = 'compose:30';
const CHAT_ID = 'sbc_call';
let applyAnswer = { ok: true, status: 'applied' };
const { ctx } = await openWebchat({
    llm: 'chatgpt_api',
    call_id: CHAT_ID,
    prompt_id: 'prompt_smartbar_chat',
    prompt_name: 'SmartBar',
    smartbar: { hid: HID, compose: '30' },
    local: { chatgpt_model: 'gpt-test', hide_thinking: true },
    commands: {
        smartbar_chat_send: () => ({ ok: true, recordId: 'compose-x' }),
        smartbar_chat_stop: () => ({ ok: true }),
        smartbar_chat_retry: () => ({ ok: true }),
        smartbar_chat_dismiss: () => ({ ok: true }),
        smartbar_chat_apply: () => applyAnswer,
        smartbar_chat_new_session: () => ({ ok: true, sessionId: 's2' }),
    },
});
after(() => ctx.close());
const k = webchatTests('25');
const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);

const S_OPEN = 'spec 10 "compose window: Opening it"';
const S_APPLY = 'spec 10 "compose window: Proposals and Apply"';
const S_SELECT = 'spec 10 "compose window: Select"';
const S_CLOSED = 'spec 10 "compose window: When the compose window closes"';

const bg = (command, extra = {}) => fromBackground(ctx, { command, headerMessageId: HID, chatId: CHAT_ID, ...extra });
let seq = 0;
const update = record => bg('smartbar_chat_update', { seq: ++seq, record });
const rec = (over = {}) => ({ id: 'compose-1', messageId: null, sessionId: 's1', source: 'compose', instruction: 'x', state: 'done',
    operations: [], reports: [], unrecognized: null, errorType: null, error: null, answer: null, draft: null, dismissed: null, ...over });
const op = (index, id, state, over = {}) => ({ index, id, params: {}, state, result: null, error: null, errorType: null, ...over });
const proposals = turn => [...turnBody(turn).querySelectorAll('.sb-proposal')];
const lineTexts = turn => [...turnBody(turn).querySelectorAll('.sb-line .tx')].map(e => e.textContent);
const title = () => ctx.document.getElementById('smartbarComposeTitle');
const closedNote = () => ctx.document.getElementById('smartbarComposeClosedNote');
const applies = () => sentCommands(ctx, 'smartbar_chat_apply');
const REWRITE = { scope: 'all', original: 'hi bob, ok for me', text: 'Dear Bob,\n\nI agree.' };

k.test('header', S_OPEN, 'the header names the email being written; no note while its window is open', async () => {
    await bg('smartbar_chat_init', { seq: ++seq, sessionId: 's1', records: [], total: 0, limit: 50, compose: { subject: 'Offer', closed: false } });
    assert.equal(title().hidden, false);
    assert.equal(title().textContent, msg('smartbar_chat_compose_title', ['Offer']));
    assert.equal(closedNote().hidden, true);
    assert.equal(field(ctx).disabled, false);
});

k.test('proposal', S_APPLY, 'a proposal: what it changes, its text, Show differences, Apply and Copy; no line while it waits; no Details', async () => {
    await update(rec({ id: 'compose-1', instruction: 'make it formal', operations: [op(0, 'rewrite', 'drafted', { result: REWRITE })] }));
    const turn = botTurns(ctx).at(-1);
    const [block] = proposals(turn);
    assert.equal(block.querySelector('.sb-draft-label').textContent,
        msg('smartbar_chat_proposal_label', [msg('smartbar_op_rewrite'), msg('smartbar_chat_target_all')]));
    assert.equal(block.querySelector('.sb-draft-body').textContent, 'Dear Bob,\n\nI agree.');
    assert.deepEqual([...block.querySelectorAll('.action-bar button')].map(b => b.textContent),
        [msg('btn_show_differences'), msg('smartbar_chat_apply'), msg('apiwebchat_copy')]);
    assert.deepEqual(lineTexts(turn), []);
    assert.equal(turnBody(turn).querySelector('button.details'), null);
});

k.test('apply', S_APPLY, 'Apply sends smartbar_chat_apply for the record and the line, with no text of its own', async () => {
    const block = proposals(botTurns(ctx).at(-1))[0];
    await ctx.click(block.querySelector('.apply_btn'));
    const sent = applies().at(-1);
    assert.deepEqual([sent.recordId, sent.index, sent.text, sent.html, sent.headerMessageId, sent.chatId], ['compose-1', 0, undefined, undefined, HID, CHAT_ID]);
});

k.test('applied', S_APPLY, 'applied: the block kept, its Apply reading "Applied" and disabled, its line saying so', async () => {
    await update(rec({ id: 'compose-1', instruction: 'make it formal', operations: [op(0, 'rewrite', 'done', { result: { ...REWRITE, applied: true } })] }));
    const turn = botTurns(ctx).at(-1);
    const apply = proposals(turn)[0].querySelector('.apply_btn');
    assert.deepEqual([apply.textContent, apply.disabled], [msg('smartbar_chat_applied'), true]);
    assert.deepEqual(lineTexts(turn), [msg('smartbar_result_applied', [msg('smartbar_op_rewrite')])]);
});

k.test('picker', S_APPLY, 'Show differences opens the change picker; Apply then sends what it composed', async () => {
    await update(rec({ id: 'compose-2', instruction: 'shorter', operations: [op(0, 'proofread', 'drafted', { result: { scope: 'selection', original: 'helo bob', text: 'hello bob' } })] }));
    const turn = botTurns(ctx).at(-1);
    const block = proposals(turn)[0];
    assert.equal(block.querySelector('.sb-draft-label').textContent,
        msg('smartbar_chat_proposal_label', [msg('smartbar_op_proofread'), msg('smartbar_chat_target_selection')]));
    await ctx.click(block.querySelector('.diff_btn'));
    const picker = sq(ctx.document, 'messages-area', 'diff-picker');
    assert.ok(picker, 'the change picker is open');
    assert.equal(turn._mztaPicker, picker);
    assert.equal(proposals(turn)[0].querySelector('.diff_btn').disabled, true);
    await ctx.click(proposals(turn)[0].querySelector('.apply_btn'));
    const sent = applies().at(-1);
    assert.equal(sent.recordId, 'compose-2');
    assert.equal(sent.text, picker.composeResultText());
    assert.equal(sent.html, picker.composeResultHTML());
});

k.test('stale', S_APPLY, 'the target changed: the block\'s Apply disabled, the line says it with Retry; a refused Apply says why', async () => {
    applyAnswer = { ok: false, status: 'changed' };
    await update(rec({ id: 'compose-3', instruction: 'polite', operations: [op(0, 'rewrite', 'drafted', { result: { ...REWRITE } })] }));
    let turn = botTurns(ctx).at(-1);
    await ctx.click(proposals(turn)[0].querySelector('.apply_btn'));
    assert.equal(proposals(turn)[0].querySelector('.sb-draft-status').textContent,
        msg('smartbar_chat_apply_failed', [msg('smartbar_line_proposal_stale', [msg('smartbar_op_rewrite')])]));
    await update(rec({ id: 'compose-3', instruction: 'polite', operations: [op(0, 'rewrite', 'drafted', { result: { ...REWRITE, stale: true } })] }));
    turn = botTurns(ctx).at(-1);
    assert.equal(proposals(turn)[0].querySelector('.apply_btn').disabled, true);
    assert.deepEqual(lineTexts(turn), [msg('smartbar_line_proposal_stale', [msg('smartbar_op_rewrite')])]);
    await ctx.click(turnBody(turn).querySelector('.sb-line button.retry'));
    const retry = sentCommands(ctx, 'smartbar_chat_retry').at(-1);
    assert.deepEqual([retry.recordId, retry.index], ['compose-3', 0]);
    applyAnswer = { ok: true, status: 'applied' };
});

k.test('apply-again', S_APPLY, 'Apply refused for another reason than a changed email: said, and Apply can be clicked again', async () => {
    // The compose window did not answer for a moment (still open: this window was not told).
    applyAnswer = { ok: false, error: 'compose_closed' };
    await update(rec({ id: 'compose-8', instruction: 'retry me', operations: [op(0, 'rewrite', 'drafted', { result: { ...REWRITE } })] }));
    const block = proposals(botTurns(ctx).at(-1))[0];
    await ctx.click(block.querySelector('.apply_btn'));
    assert.equal(block.querySelector('.apply_btn').disabled, false, 'Apply usable again');
    assert.equal(block.querySelector('.sb-draft-status').textContent, msg('smartbar_chat_apply_failed', [msg('smartbar_error_compose_closed')]));
    applyAnswer = { ok: true, status: 'applied' };
    const before = applies().length;
    await ctx.click(block.querySelector('.apply_btn'));
    assert.equal(applies().length, before + 1);
});

k.test('subject', S_APPLY, 'a subject proposal: its label and text, Apply and Copy, no Show differences', async () => {
    await update(rec({ id: 'compose-4', instruction: 'subject', operations: [op(0, 'subject', 'drafted', { result: { subject: 'New offer' } })] }));
    const block = proposals(botTurns(ctx).at(-1))[0];
    assert.equal(block.querySelector('.sb-draft-label').textContent, msg('smartbar_chat_subject_label'));
    assert.equal(block.querySelector('.sb-draft-subject').textContent, 'New offer');
    assert.equal(block.querySelector('.diff_btn'), null);
    await ctx.click(block.querySelector('.apply_btn'));
    assert.deepEqual([applies().at(-1).recordId, applies().at(-1).text], ['compose-4', undefined]);
});

k.test('select-lines', S_SELECT, 'select: its line with the passage, the change after it cancelled, a conflict reported', async () => {
    await update(rec({ id: 'compose-5', instruction: 'select it', operations: [
        op(0, 'select', 'done', { result: { passage: 'hi bob' } }),
        op(1, 'translate_text', 'cancelled', { params: { language: 'German' } }),
    ], reports: [{ kind: 'conflict', id: 'rewrite' }] }));
    const turn = botTurns(ctx).at(-1);
    assert.deepEqual(lineTexts(turn), [
        msg('smartbar_result_selected', ['hi bob']),
        msg('smartbar_line_cancelled', [msg('smartbar_op_translate_text')]),
        msg('smartbar_report_conflict', ['rewrite']),
    ]);
});

k.test('closed', S_CLOSED, 'the compose window closed: the note, the input disabled for good, Apply disabled and no Retry; the turns and Copy kept', async () => {
    await update(rec({ id: 'compose-6', instruction: 'again', operations: [
        op(0, 'rewrite', 'drafted', { result: { ...REWRITE } }),
    ] }));
    await update(rec({ id: 'compose-7', instruction: 'fail', operations: [op(0, 'proofread', 'error', { error: 'boom', errorType: 'api' })] }));
    const before = botTurns(ctx).length;
    await bg('smartbar_chat_compose_closed');
    assert.equal(closedNote().hidden, false);
    assert.equal(closedNote().textContent, msg('smartbar_chat_compose_closed_note'));
    assert.equal(field(ctx).disabled, true);
    assert.equal(botTurns(ctx).length, before, 'the turns stay');
    const proposalTurn = botTurns(ctx).at(-2);
    const block = proposals(proposalTurn)[0];
    assert.equal(block.querySelector('.apply_btn').disabled, true);
    assert.equal(block.querySelector('.copy_btn').disabled, false);
    assert.equal(turnBody(botTurns(ctx).at(-1)).querySelector('.sb-line button.retry'), null);
    // A message stopped from outside: the compose window's text.
    await update(rec({ id: 'compose-6', instruction: 'again', state: 'replaced', operations: [op(0, 'rewrite', 'cancelled')] }));
    assert.ok(lineTexts(botTurns(ctx).at(-2)).includes(msg('smartbar_chat_compose_replaced')));
});

k.test('init-closed', S_CLOSED, 'the init of a chat whose compose window is already closed disables it at once; a new email has its own title', async () => {
    title().hidden = true;
    await bg('smartbar_chat_init', { seq: ++seq, sessionId: 's1', records: [], total: 0, limit: 50, compose: { subject: '', closed: true } });
    assert.equal(title().textContent, msg('smartbar_chat_compose_title_new'));
    assert.equal(closedNote().hidden, false);
    assert.equal(field(ctx).disabled, true);
});

k.test('harness-clean', S_OPEN, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
