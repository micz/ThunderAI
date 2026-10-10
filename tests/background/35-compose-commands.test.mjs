// The compose-window commands: what the background sends the compose script for
// chatgpt_replaceSelectedText and chatgpt_replyMessage.
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
    fromTab,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
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
