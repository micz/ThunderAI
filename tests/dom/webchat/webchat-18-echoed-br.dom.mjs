// A proofreading prompt (use_diff_viewer "1") run on a selection whose HTML twin carries a <br>, as
// {%selected_html%} sends it, replacing it in the mail (action "2"); the answer echoes that <br>
// followed by a newline, the <br> and the newline arriving in different tokens. Usage display off.
// Then more answers, one per variant of the same shape.
//
// Spec 01 "One render path, no router" ("An echoed `<br>` is one line break": the break right after
// a raw <br> is whitespace, not a second <br>, for <br/> and <br  /> and a hardbreak too; two <br>
// written stay two; code untouched; a "\n" rather than nothing, so a list item is not welded once
// removeAloneBRs() drops its <br>; the chat, "use this answer" and Copy get the same line).
// Spec 07 "Line breaks: `<br>` is a block separator" (the echoed answer pairs with the original's
// <br>: no change, and the picker's result keeps it a line break, not a paragraph break).
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
    lastBotTurn,
    answerEls,
    actionBar,
    turnBody,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false },
    commands: {
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('18');

const S_RENDER = 'spec 01 "One render path, no router"';
const S_BR = 'spec 07 "Line breaks: `<br>` is a block separator"';

const message = () => answerEls(lastBotTurn(ctx))[0];
/** An element's children, whitespace-only text left out, as [nodeName, text]. A text node is
 *  compared without its leading newline: the source newline after a <br> is not a line break. */
const shape = el => [...el.childNodes]
    .filter(n => !(n.nodeType === 3 && n.data.trim() === ''))
    .map(n => [n.nodeName.toLowerCase(), n.nodeType === 3 ? n.data.replace(/^\n/, '') : n.textContent]);
const ONE_BR = (second = 'grazie') => [['#text', 'Ciao,'], ['br', ''], ['#text', second]];
const parse = html => new ctx.window.DOMParser().parseFromString(html, 'text/html').body;
const useBtn = turn => sq(actionBar(turn), 'split-button', '.action_btn');
const lastReplace = () => sentCommands(ctx, 'chatgpt_replaceSelectedText').at(-1).text;

await apiSend(ctx, {
    prompt: 'Proofread this:\nCiao,<br>grazie', action: '2', tabId: 3, mailMessageId: 7,
    prompt_info: {
        use_diff_viewer: '1',
        selection_text: 'Ciao,\ngrazie',
        selection_html: 'Ciao,<br>grazie',
        body_text: 'unrelated body', body_html: '<p>unrelated body</p>',
    },
});
await worker.stream(ctx, ['Ciao,<br', '>', '\n', 'grazie!']);
const owner = botTurns(ctx)[0];

k.test('split-tokens', S_RENDER, 'an echoed "<br>" and the newline after it, in different tokens: ONE <br> between the two lines', () => {
    assert.deepEqual(shape(message().querySelector('p')), ONE_BR('grazie!'));
});

k.test('use-one-br', S_RENDER, '"Use this answer" sends the same line: one <br>, inside the paragraph', async () => {
    await ctx.click(useBtn(owner));
    const p = parse(lastReplace()).querySelector('p');
    assert.ok(p, lastReplace());
    assert.deepEqual(shape(p), ONE_BR('grazie!'));
});

k.test('copy-one-line', S_RENDER, 'Copy writes one line break, not a blank line', async () => {
    await ctx.click(actionBar(owner).querySelector('.copy_btn'));
    assert.equal(ctx.clipboard.at(-1), 'Ciao,\ngrazie!');
});

k.test('picker-line-break', S_BR, 'against the original "Ciao,<br>grazie", with its one change accepted, the result of the picker keeps the line break a line break, not a paragraph break', async () => {
    await ctx.click(actionBar(owner).querySelector('.diffv_btn'));
    const picker = turnBody(botTurns(ctx)[1]).querySelector('diff-picker');
    assert.ok(picker);
    assert.equal(picker.shadowRoot.querySelectorAll('.hunk').length, 1, 'only grazie -> grazie! changed');
    assert.equal(picker.composeResultHTML(), '<p>Ciao,<br>grazie!</p>');
});

/** Type a prompt and stream one more answer, in the given tokens. */
async function answer(tokens) {
    await typeAndSend(ctx, 'Again');
    await worker.stream(ctx, tokens);
}

k.test('one-token', S_RENDER, 'the same answer in ONE token renders the same', async () => {
    await answer(['Ciao,<br>\ngrazie']);
    assert.deepEqual(shape(message().querySelector('p')), ONE_BR());
});

k.test('spellings', S_RENDER, '<BR/> and <br />, and a hardbreak (two trailing spaces) after the tag: still one <br>', async () => {
    await answer(['Ciao,<BR/>\ngrazie\n\nCiao,<br />\ngrazie\n\nCiao,<br>  \ngrazie']);
    const ps = [...message().querySelectorAll('p')];
    assert.equal(ps.length, 3);
    for (const p of ps) { assert.deepEqual(shape(p), ONE_BR(), p.innerHTML); }
});

k.test('two-written', S_RENDER, 'two <br> written stay two: an intended blank line survives', async () => {
    await answer(['X<br><br>\nY\n\nX<br>\n<br>\nY']);
    const ps = [...message().querySelectorAll('p')];
    assert.equal(ps.length, 2);
    for (const p of ps) { assert.equal(p.querySelectorAll('br').length, 2, p.innerHTML); }
});

k.test('code-untouched', S_RENDER, 'a "<br>" and its newline inside a code fence stay as written, as text', async () => {
    await answer(['```\nc<br>\nd\n```']);
    const pre = message().querySelector('pre');
    assert.ok(pre);
    assert.equal(pre.textContent, 'c<br>\nd\n');
    assert.equal(pre.querySelector('br'), null);
});

k.test('list-no-weld', S_RENDER, 'in a list item the break becomes whitespace, not nothing: the two lines are never welded in the mail', async () => {
    await answer(['- a<br>\n  b']);
    assert.equal(message().querySelector('li').querySelectorAll('br').length, 1);
    await ctx.click(useBtn(lastBotTurn(ctx)));
    const li = parse(lastReplace()).querySelector('li');
    assert.ok(li, lastReplace());
    assert.notEqual(li.textContent, 'ab');
    assert.equal(li.textContent.replace(/\s+/g, ' '), 'a b');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
