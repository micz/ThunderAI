// The actions on an answer when the prompt's action is "3" (insert at cursor position) and it was
// run from a compose window: api_send carries action "3" with mailMessageId -1, and "Insert at
// cursor" inserts the answer (chatgpt_insertAtCaret) instead of replacing the text. Usage display
// off. Two answers.
//
// Spec 07 "Scope" (the compose-window case forces the action to "2", except "3", which keeps its
// own command). Spec 01 "Inserting at the cursor in a compose window" and the command table of
// "Actions on an answer" (chatgpt_insertAtCaret: the same fields as chatgpt_replaceSelectedText).
// Spec 02 "Action Types Reference" (the button reads "Insert at cursor"). Spec 01 "Transcript DOM
// contract" (the action call, then chatgpt_close; an earlier answer's toolbar bound to its own text).
//
// The tests run in order on one window.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    typeAndSend,
    botTurns,
    answerEls,
    actionBar,
    toolbar,
    commandNames,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false },
    commands: {
        chatgpt_insertAtCaret: () => true,
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('19');

const S_SCOPE = 'spec 07 "Scope"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_ACT = 'spec 01 "Actions on an answer"';
const S_TYPES = 'spec 02 "Action Types Reference"';

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const norm = html => new ctx.window.DOMParser().parseFromString(html, 'text/html').body.innerHTML.replace(/>\s+</g, '><').trim();
const turn = i => botTurns(ctx)[i];
const toolKinds = tools => [...tools.children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));

await apiSend(ctx, { prompt: 'Write the email', action: '3', tabId: 4, mailMessageId: -1 });
await worker.stream(ctx, ['Dear Sir,\nkind regards.']);

k.test('label', S_TYPES, 'the button reads "Insert at cursor", standalone: one line, no dropdown', () => {
    const split = actionBar(turn(0)).querySelector('split-button');
    assert.ok(split.hasAttribute('standalone'));
    assert.equal(sq(actionBar(turn(0)), 'split-button', '.dropdown-toggle'), null);
    const lines = [...sq(actionBar(turn(0)), 'split-button', '.action_btn').querySelectorAll('span')].map(s => s.textContent);
    assert.deepEqual(lines, [msg('chatgpt_win_insert_at_cursor')]);
});

k.test('insert', S_SCOPE, 'compose window, action "3": the answer is inserted (chatgpt_insertAtCaret, not a replace), then the window closes', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(sq(actionBar(turn(0)), 'split-button', '.action_btn'));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_insertAtCaret', 'chatgpt_close']);
    assert.equal(norm(sentCommands(ctx, 'chatgpt_insertAtCaret').at(-1).text), norm(answerEls(turn(0))[0].innerHTML));
    assert.deepEqual(sentCommands(ctx, 'chatgpt_replaceSelectedText'), []);
});

k.test('insert-target', S_ACT, 'chatgpt_insertAtCaret names its target as chatgpt_replaceSelectedText does: tabId (the compose tab) and mailMessageId (-1), besides the text, and nothing else', () => {
    const insert = sentCommands(ctx, 'chatgpt_insertAtCaret')[0];
    assert.deepEqual(Object.keys(insert).sort(), ['command', 'mailMessageId', 'tabId', 'text']);
    assert.equal(insert.tabId, 4);
    assert.equal(insert.mailMessageId, -1);
});

k.test('toolbar-insert', S_DOM, 'an earlier answer\'s toolbar button, labelled "Insert at cursor", inserts ITS answer, and nothing else is in the toolbar but Copy', async () => {
    await typeAndSend(ctx, 'Shorter');
    await worker.stream(ctx, ['Dear Sir.']);
    assert.deepEqual(toolKinds(toolbar(turn(0))), [msg('apiwebchat_copy'), msg('chatgpt_win_insert_at_cursor')]);
    const use = [...toolbar(turn(0)).querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === msg('chatgpt_win_insert_at_cursor'));
    const since = ctx.ctl.sent.length;
    await ctx.click(use);
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_insertAtCaret', 'chatgpt_close']);
    assert.equal(norm(sentCommands(ctx, 'chatgpt_insertAtCaret').at(-1).text), norm(answerEls(turn(0))[0].innerHTML));
    assert.deepEqual(sentCommands(ctx, 'chatgpt_replaceSelectedText'), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
