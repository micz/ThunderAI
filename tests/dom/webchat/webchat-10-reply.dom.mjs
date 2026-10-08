// The actions on an answer when the prompt replies to a message (action "1", a real message id),
// with reply_type stored as "reply_sender" and the usage display on. Two answers; the background
// answers every command.
//
// Spec 01 "Rich-text layer" closing paragraphs ("The answer-text snapshot is what the use this
// answer / copy / save as summary / diff buttons close over - one instance per turn"; every button
// honours a text selection - not testable in jsdom, see tests/webchat/README.md; Copy writes plain
// text, entities decoded, <br> and block boundaries as real newlines), "Transcript DOM contract" (the full .action-bar on the newest answer with
// .sel_info beside it, the compact .turn-tools on earlier ones, never both on a turn; the toolbar
// bound to its own answer's text; "Self-closing chatgpt_close must be fire-and-forget": the action
// call awaited, then {command: "chatgpt_close", window_id}), "Files" (`<split-button>`: the "use
// this answer" button + optional reply-type dropdown, its outside-click and Escape listeners).
// Spec 05 "UI & Feature Preferences" (`reply_type`: the default reply type). Spec 04 "Rendering in
// the chat window" (the chip never reaches what an action sends or copies).
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
    turnBody,
    commandNames,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { reply_type: 'reply_sender' },
    commands: {
        chatgpt_replyMessage: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('10');

const S_SNAP = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_FILES = 'spec 01 "Files"';
const S_PREF = 'spec 05 "UI & Feature Preferences"';
const S_USAGE = 'spec 04 "Rendering in the chat window"';
const S_ACT = 'spec 01 "Actions on an answer"';

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const first = () => botTurns(ctx)[0];
const second = () => botTurns(ctx)[1];
const split = turn => actionBar(turn).querySelector('split-button');
const mainBtn = turn => sq(actionBar(turn), 'split-button', '.action_btn');
const toggle = turn => sq(actionBar(turn), 'split-button', '.dropdown-toggle');
const menu = turn => sq(actionBar(turn), 'split-button', '.dropdown-menu');
const copyBtn = turn => actionBar(turn).querySelector('.copy_btn');
const closeBtn = turn => actionBar(turn).querySelector('.close_btn');
const selInfo = turn => turnBody(turn).querySelector('.sel_info');
/** What a compact toolbar holds, in order: each button by its label, the usage chip as "chip". */
const toolKinds = tools => [...tools.children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));
/** The snapshot of an answer as the window rendered it, for comparison with what is sent. */
const norm = html => {
    const doc = new ctx.window.DOMParser().parseFromString(html, 'text/html');
    return doc.body.innerHTML.replace(/>\s+</g, '><').trim();
};

const ANSWER_1 = 'Dear Bob,\nTom &amp; Jerry say <b>hi</b>.\n\nBest regards';
const ANSWER_2 = 'Second answer.';

await apiSend(ctx, { prompt: 'Reply to this', action: '1', tabId: 3, mailMessageId: 42 });
await worker.stream(ctx, [ANSWER_1]);

k.test('bar', S_DOM, 'the newest answer gets the full .action-bar, with the .sel_info hint shown beside it in reply mode, and no compact toolbar', () => {
    assert.ok(actionBar(first()));
    assert.equal(toolbar(first()), null);
    assert.ok(selInfo(first()));
    assert.equal(selInfo(first()).style.display, 'block');
    assert.equal(selInfo(first()).textContent, msg('apiwebchat_selection_info'));
});

k.test('split-lines', S_PREF, 'the "use this answer" button names the default reply type on its second line: reply to sender', () => {
    const lines = [...mainBtn(first()).querySelectorAll('span')].map(s => s.textContent);
    assert.deepEqual(lines, [msg('apiwebchat_use_this_answer'), msg('prefs_OptionText_reply_sender')]);
});

k.test('split-dropdown', S_FILES, 'the reply-type dropdown offers the other type, reply to all, and starts closed', () => {
    assert.deepEqual([...menu(first()).querySelectorAll('button')].map(b => b.textContent), [msg('prefs_OptionText_reply_all')]);
    assert.equal(menu(first()).classList.contains('show'), false);
    assert.equal(toggle(first()).getAttribute('aria-expanded'), 'false');
});

k.test('dropdown-escape', S_FILES, 'the toggle opens it; Escape closes it and puts the focus back on the toggle', async () => {
    await ctx.click(toggle(first()));
    assert.equal(menu(first()).classList.contains('show'), true);
    assert.equal(toggle(first()).getAttribute('aria-expanded'), 'true');
    await ctx.fire(ctx.window, 'keydown', { key: 'Escape' });
    assert.equal(menu(first()).classList.contains('show'), false);
    assert.equal(toggle(first()).getAttribute('aria-expanded'), 'false');
    assert.equal(split(first()).shadowRoot.activeElement, toggle(first()));
});

k.test('dropdown-outside', S_FILES, 'a click outside the split button closes the open menu', async () => {
    await ctx.click(toggle(first()));
    assert.equal(menu(first()).classList.contains('show'), true);
    await ctx.click(ctx.$('#appHeader'));
    assert.equal(menu(first()).classList.contains('show'), false);
});

k.test('copy-plain', S_SNAP, 'Copy writes the answer as plain text: entities decoded, a <br> one newline, a paragraph break a blank line', async () => {
    await ctx.click(copyBtn(first()));
    assert.deepEqual(ctx.clipboard, ['Dear Bob,\nTom & Jerry say hi.\n\nBest regards']);
});

k.test('copy-no-chip', S_USAGE, 'the usage chip is not part of what Copy writes', () => {
    assert.doesNotMatch(ctx.clipboard[0], /tokens|\d s/);
});

k.test('copy-stays', S_SNAP, 'Copy does not close the window, and says it copied', () => {
    assert.deepEqual(commandNames(ctx).filter(c => c !== 'chatgpt_api_ready_call1'), []);
    assert.equal(copyBtn(first()).getAttribute('aria-label'), msg('apiwebchat_copied'));
});

k.test('use-main', S_PREF, '"Use this answer" sends chatgpt_replyMessage with the default reply type and the answer snapshot, then closes', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(mainBtn(first()));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_replyMessage', 'chatgpt_close']);
    const reply = sentCommands(ctx, 'chatgpt_replyMessage').at(-1);
    assert.equal(reply.replyType, 'reply_sender');
    assert.equal(norm(reply.text), norm(answerEls(first())[0].innerHTML));
    assert.deepEqual(sentCommands(ctx, 'chatgpt_close').at(-1), { command: 'chatgpt_close', window_id: 1 });
});

k.test('use-target', S_ACT, 'chatgpt_replyMessage names its target with the api_send fields: tabId and mailMessageId, besides the text and the reply type, and nothing else', () => {
    const reply = sentCommands(ctx, 'chatgpt_replyMessage')[0];
    assert.deepEqual(Object.keys(reply).sort(), ['command', 'mailMessageId', 'replyType', 'tabId', 'text']);
    assert.equal(reply.tabId, 3);
    assert.equal(reply.mailMessageId, 42);
});

k.test('use-dropdown', S_FILES, 'the dropdown\'s option sends the same answer with the other reply type', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(toggle(first()));
    await ctx.click(menu(first()).querySelector('button'));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_replyMessage', 'chatgpt_close']);
    assert.equal(sentCommands(ctx, 'chatgpt_replyMessage').at(-1).replyType, 'reply_all');
});

k.test('close', S_DOM, 'Close sends {command: "chatgpt_close", window_id} and nothing else', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(closeBtn(first()));
    assert.deepEqual(ctx.ctl.sent.slice(since), [{ command: 'chatgpt_close', window_id: 1 }]);
});

// ---- a second answer: the first one degrades to its compact toolbar ---------------------

k.test('degrade', S_DOM, 'a newer answer takes the full bar: the earlier one keeps only its compact toolbar (Copy, Use this answer, the chip), and loses .sel_info', async () => {
    await typeAndSend(ctx, 'Shorter');
    await worker.stream(ctx, [ANSWER_2]);
    assert.equal(actionBar(first()), null);
    assert.equal(selInfo(first()), null);
    const tools = toolbar(first());
    assert.ok(tools);
    const labels = [...tools.querySelectorAll('button')].map(b => b.getAttribute('aria-label'));
    assert.deepEqual(labels.slice(0, 2), [msg('apiwebchat_copy'), msg('apiwebchat_use_this_answer')]);
    assert.ok(tools.lastElementChild.classList.contains('mzta-usage'));
    assert.ok(actionBar(second()));
    assert.equal(toolbar(second()), null);
});

k.test('toolbar-reply', S_ACT, 'the compact toolbar of a reply session holds Copy, Use this answer and the usage chip, nothing else: no reply-type choice, no Close', () => {
    assert.deepEqual(toolKinds(toolbar(first())), [msg('apiwebchat_copy'), msg('apiwebchat_use_this_answer'), 'chip']);
});

k.test('toolbar-own-text', S_DOM, 'the earlier answer\'s toolbar acts on its OWN answer: Use sends the first answer, Copy copies it', async () => {
    const tools = toolbar(first());
    const [copy, use] = tools.querySelectorAll('button');
    await ctx.click(use);
    assert.equal(norm(sentCommands(ctx, 'chatgpt_replyMessage').at(-1).text), norm(answerEls(first())[0].innerHTML));
    await ctx.click(copy);
    assert.equal(ctx.clipboard.at(-1), ctx.clipboard[0], 'the toolbar copied something other than what the full bar did');
});

k.test('newest-own-text', S_SNAP, 'the newest answer\'s button sends the newest answer', async () => {
    await ctx.click(mainBtn(second()));
    assert.match(sentCommands(ctx, 'chatgpt_replyMessage').at(-1).text, /Second answer\./);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
