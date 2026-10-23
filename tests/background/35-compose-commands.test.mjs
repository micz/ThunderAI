// The compose-window commands: what the background sends the compose script for
// chatgpt_replaceSelectedText, chatgpt_insertAtCaret and chatgpt_replyMessage.
//
// Spec 01 "Replacing text in a compose window" and "Writing a reply": the compose script inserts an
// HTML answer with execCommand('insertHTML'), so the background passes it through the ONE sanitizer
// (sanitizeBlockHtml) first - the ChatGPT web window's HTML is not sanitized anywhere else - and the
// replaceBody() fallback gets the same sanitized HTML. On a plain text window the answer is
// converted to text (stripHtmlKeepLines) and never sanitized. What the compose script does with it
// is the compose area's; the sanitizer itself is a stand-in here (it prefixes '<!--sanitized-->'),
// and so is stripHtmlKeepLines(), which needs a DOMParser (it prefixes 'PLAIN:').

import assert from 'node:assert/strict';
import { bgContext, flush } from './context.mjs';
import {
    API,
    fromTab,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const custom = (id, action) => ({ id, name: id, text: 'Write ' + id, type: '0', action, is_default: '0', is_special: '0', need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', show_in: 'popup' });
const ctx = await bgContext({
    local: { ...API, _custom_prompt: [custom('c_insert', '3'), custom('c_replace', '2')] },
    overrides: { stripHtmlKeepLines: html => 'PLAIN:' + html },
    mail: { accounts: [{ id: 'acc1', name: 'Account 1', identities: [{ id: 'id1', email: 'me@example.test' }] }] },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 20, type: 'messageCompose', windowId: 4 });
        m.addTab({ id: 21, type: 'messageCompose', windowId: 5, isPlainText: true });
    },
});
const k = caseTests('35-compose-commands');
const HTML = '<p>Hello</p><img src="x" onerror="alert(1)"><p>World</p>';
const SANITIZED = '<!--sanitized-->' + HTML;
const mail = ctx.m.addMessage({ headerMessageId: 'reply@x', author: 'Sender <sender@example.test>' });

k.test('replace-html', 'replace on an HTML window: the compose script gets the answer through sanitizeBlockHtml', async () => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    assert.equal(await fromTab(ctx, 900, { command: 'chatgpt_replaceSelectedText', text: HTML, tabId: 20, mailMessageId: -1 }), true);
    assert.deepEqual(ctx.standIns.sanitizeBlockHtml.slice(before), [HTML]);
    const sent = ctx.m.sentTo(20, 'replaceSelectedText');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, SANITIZED);
    assert.equal(sent[0].isPlainText, false);
});

k.test('replace-plain', 'replace on a plain text window: converted to text, not sanitized', async () => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    await fromTab(ctx, 900, { command: 'chatgpt_replaceSelectedText', text: HTML, tabId: 21, mailMessageId: -1 });
    assert.equal(ctx.standIns.sanitizeBlockHtml.length, before);
    const sent = ctx.m.sentTo(21, 'replaceSelectedText');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].isPlainText, true);
    assert.equal(sent[0].text, 'PLAIN:' + HTML);
});

// Spec 01 "Inserting at the cursor in a compose window": chatgpt_insertAtCaret converts the answer
// exactly as chatgpt_replaceSelectedText does, and sends insertAtCaret instead.
k.test('insert-html', 'insert at cursor on an HTML window: insertAtCaret gets the answer through sanitizeBlockHtml, and no replaceSelectedText is sent', async () => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    const replaces = ctx.m.sentTo(20, 'replaceSelectedText').length;
    assert.equal(await fromTab(ctx, 900, { command: 'chatgpt_insertAtCaret', text: HTML, tabId: 20, mailMessageId: -1 }), true);
    assert.deepEqual(ctx.standIns.sanitizeBlockHtml.slice(before), [HTML]);
    const sent = ctx.m.sentTo(20, 'insertAtCaret');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, SANITIZED);
    assert.equal(sent[0].isPlainText, false);
    assert.equal(ctx.m.sentTo(20, 'replaceSelectedText').length, replaces);
});

k.test('insert-plain', 'insert at cursor on a plain text window: converted to text, not sanitized', async () => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    await fromTab(ctx, 900, { command: 'chatgpt_insertAtCaret', text: HTML, tabId: 21, mailMessageId: -1 });
    assert.equal(ctx.standIns.sanitizeBlockHtml.length, before);
    const sent = ctx.m.sentTo(21, 'insertAtCaret');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].isPlainText, true);
    assert.equal(sent[0].text, 'PLAIN:' + HTML);
});

// The caret is saved when the prompt starts, before getMailBody() reads anything (the autoselect
// of getOnlyTypedText would take it away): saveCaret first, on a compose tab, for action "3" only.
// The run is stopped at the first read (getSelectedText rejects): only the order matters here.
async function runPrompt(t, promptId, tabId) {
    const tab = ctx.m.tab(tabId);
    const active = ctx.m.tabs.map(x => [x, x.active]);
    const win = ctx.m.currentWindow;
    ctx.m.tabs.forEach(x => { x.active = (x === tab); });
    ctx.m.currentWindow = tab.windowId;
    ctx.m.tabAnswer = (id, message) => {
        if (message.command === 'getSelectedText') throw new Error('stopped at the first read');
        return true;
    };
    t.after(() => {
        active.forEach(([x, a]) => { x.active = a; });
        ctx.m.currentWindow = win;
        ctx.m.tabAnswer = null;
    });
    const sends = ctx.m.sentTo(tabId).length;
    assert.deepEqual(await ctx.bg.$eval('menus').executeMenuAction(promptId), { ok: '0' });
    return ctx.m.sentTo(tabId).slice(sends).map(x => x.command);
}

k.test('save-caret-first', 'an insert-at-cursor prompt in a compose window: saveCaret is sent before anything is read', async (t) => {
    assert.deepEqual(await runPrompt(t, 'c_insert', 20), ['saveCaret', 'getSelectedText']);
});

k.test('save-caret-insert-only', 'a replace prompt in a compose window: no saveCaret', async (t) => {
    assert.deepEqual(await runPrompt(t, 'c_replace', 20), ['getSelectedText']);
});

k.test('save-caret-compose-only', 'an insert-at-cursor prompt on a message tab: no saveCaret', async (t) => {
    assert.deepEqual(await runPrompt(t, 'c_insert', 7), ['getSelectedText']);
});

async function reply(t, text, plain) {
    ctx.m.replyPlainText = plain;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const n = ctx.m.replies.length;
    assert.equal(await fromTab(ctx, 900, { command: 'chatgpt_replyMessage', text, tabId: 7, mailMessageId: mail.id, replyType: 'reply_sender' }), true);
    // The compose script is given 500 ms to load before insertReply is sent.
    t.mock.timers.tick(500);
    await flush(60);
    assert.equal(ctx.m.replies.length, n + 1, 'one reply opened');
    return ctx.m.sentTo(ctx.m.replies.at(-1).tabId, 'insertReply');
}

k.test('reply-html', 'reply on an HTML window: insertReply gets the answer through sanitizeBlockHtml', async (t) => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    const sent = await reply(t, HTML, false);
    assert.deepEqual(ctx.standIns.sanitizeBlockHtml.slice(before), [HTML]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, SANITIZED);
    assert.equal(sent[0].isPlainText, false);
});

k.test('reply-plain', 'reply on a plain text window: converted to text, not sanitized', async (t) => {
    const before = ctx.standIns.sanitizeBlockHtml.length;
    const sent = await reply(t, HTML, true);
    assert.equal(ctx.standIns.sanitizeBlockHtml.length, before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].isPlainText, true);
    assert.equal(sent[0].text, 'PLAIN:' + HTML);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
