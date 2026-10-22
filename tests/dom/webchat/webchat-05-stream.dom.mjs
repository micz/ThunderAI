// A ChatGPT API window, usage display off, hide_thinking at its default (true). Five answers in a
// row: A streamed in many tokens (past the 2 KB render threshold), B the same text in ONE token,
// C with dedicated thinking tokens, D thinking only, E with inline <think> tags.
//
// Spec 01 "Streaming data flow" (newToken / newThinkingToken / tokensDone and what each drives),
// "One render path, no router" (breaks:true, html:true, the hybrid `Ciao <b>Mario</b>\ngrazie`,
// code fences as text, tables and hr kept), "Streaming: re-render the whole accumulated raw each
// time" (cumulative, coalesced to ~2 KB, live token spans in between, no newline->br post-pass, no
// leading trim per segment), "Transcript DOM contract" (one .turn-bot per answer however many
// flushes: _currentTurnEl survives a flush). Spec 04 "Thinking output in the webchat UI" (the
// <details class="thinking-block"> prepended, hide_thinking -> collapsed, inline <think>
// extracted), "Live "Thinking…" indicator" (the .thinking-live row, a sibling of the message, kept
// through a deferred flush, removed at tokensDone; the pill's icons rebuilt only on the transition
// into their state), "Emitting to the chat window" (the init flag off with the option off).
//
// The tests run in order on one window; each answer builds on the previous turn.

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
    turns,
    botTurns,
    lastBotTurn,
    answerEls,
    answerHtml,
    turnBody,
    actionBar,
    field,
    sendButton,
    stopButton,
    statusPill,
    statusText,
    statusIcon,
    usable,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({ local: { chat_show_usage_data: false } });
after(() => ctx.close());
const k = webchatTests('05');

const S_FLOW = 'spec 01 "Streaming data flow"';
const S_RENDER = 'spec 01 "One render path, no router"';
const S_CUMUL = 'spec 01 "Streaming: re-render the whole accumulated raw each time"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_THINK = 'spec 04 "Thinking output in the webchat UI"';
const S_LIVE = 'spec 04 "Live "Thinking…" indicator"';
const S_EMIT = 'spec 04 "Emitting to the chat window"';

const LONG = Array.from({ length: 60 }, (_, i) => 'parola' + i + ' lorem ipsum dolor sit amet').join(' ');
const TOKENS = [
    'Ciao <b>Ma', 'rio</b>\ngra', 'zie\n\n',
    'Uno\nil', ' body', ' fine.\n\n',
    '| a | b |\n', '|---|---|\n', '| 1 | 2 |\n\n',
    '---\n\n',
    '```\n<div>x</div>\n```\n\n',
    ...LONG.match(/.{1,300}/gs),
    '\n\n',
    'Fine <i>fi', 'ne</i>.',
];
const FULL = TOKENS.join('');

const message = () => answerEls(lastBotTurn(ctx))[0];
/** An element's children, whitespace-only text left out, as [nodeName, text]. A text node is
 *  compared without its leading newline: markdown-it emits `<br>\n` (spec 01 "Streaming: re-render
 *  the whole accumulated raw each time"), the source newline after the tag is not a line break. */
const shape = el => [...el.childNodes]
    .filter(n => !(n.nodeType === 3 && n.data.trim() === ''))
    .map(n => [n.nodeName.toLowerCase(), n.nodeType === 3 ? n.data.replace(/^\n/, '') : n.textContent]);

k.test('usage-flag-off', S_EMIT, 'chat_show_usage_data off: the init message carries the flag off', () => {
    assert.equal(worker.posted.find(m => m.type === 'init').chat_show_usage_data, false);
});

// ---- answer A: many tokens ------------------------------------------------------------

let waitingIcon = null;
k.test('a-waiting', S_LIVE, 'the prompt is out, no token yet: the waiting pill with its own animated icon', async () => {
    await apiSend(ctx, { prompt: 'Q1', action: '0' });
    assert.ok(statusPill(ctx).classList.contains('status-waiting'));
    waitingIcon = statusIcon(ctx).querySelector('img');
    assert.match(waitingIcon?.getAttribute('src') || '', /mzta-waiting-server\.svg$/);
});

let streamingIcon = null;
k.test('a-live-spans', S_CUMUL, 'between renders the arriving text is shown as is, as live token spans: nothing rendered yet', async () => {
    await worker.stream(ctx, TOKENS.slice(0, 3), { done: false });
    const m = message();
    assert.equal(m.textContent, TOKENS.slice(0, 3).join(''));
    assert.ok(m.querySelectorAll('span.token').length >= 3);
    assert.equal(m.querySelector('b, p, br'), null, 'below HTML_RENDER_CHUNK nothing is rendered yet');
});

k.test('a-streaming-pill', S_LIVE, 'tokens arriving: the pill says it is receiving data, with the streaming icon', () => {
    const pill = statusPill(ctx);
    assert.ok(pill.classList.contains('status-working'));
    assert.equal(pill.classList.contains('status-waiting'), false);
    assert.equal(statusText(ctx), 'Receiving data...');
    streamingIcon = statusIcon(ctx).querySelector('img');
    assert.match(streamingIcon?.getAttribute('src') || '', /mzta-loading\.svg$/);
});

k.test('a-icon-kept', S_LIVE, 'the streaming icon is not rebuilt on every token (that would restart its animation)', async () => {
    await worker.stream(ctx, TOKENS.slice(3, 6), { done: false });
    assert.equal(statusIcon(ctx).querySelector('img'), streamingIcon);
});

k.test('a-input-locked', S_FLOW, 'while streaming the input stays locked and Stop is offered', () => {
    assert.equal(field(ctx).disabled, true);
    assert.equal(usable(sendButton(ctx)), false);
    assert.ok(usable(stopButton(ctx)));
});

k.test('a-chunk-render', S_CUMUL, 'past ~2 KB of new text a flush re-renders the WHOLE raw so far: the inline tag split across tokens is whole', async () => {
    const upto = TOKENS.indexOf('\n\n', 11) + 1;
    await worker.stream(ctx, TOKENS.slice(6, upto), { done: false });
    const m = message();
    const b = m.querySelector('p b');
    assert.ok(b, 'the first paragraph was rendered mid-stream');
    assert.equal(b.textContent, 'Mario');
    assert.equal(m.querySelectorAll('span.token').length, 0, 'the render replaced the live spans');
});

k.test('a-one-turn', S_DOM, 'however many flushes, the answer stays in ONE bot turn with one avatar', async () => {
    await worker.stream(ctx, TOKENS.slice(TOKENS.indexOf('\n\n', 11) + 1), { done: true });
    assert.equal(botTurns(ctx).length, 1);
    assert.equal(lastBotTurn(ctx).querySelectorAll('.turn-head').length, 1);
});

k.test('a-hybrid', S_RENDER, 'html:true + breaks:true: `Ciao <b>Mario</b>\\ngrazie` renders as <p>Ciao <b>Mario</b><br>grazie</p>', () => {
    const p = message().querySelector('p');
    assert.deepEqual(shape(p), [['#text', 'Ciao '], ['b', 'Mario'], ['br', ''], ['#text', 'grazie']]);
});

k.test('a-no-double-br', S_CUMUL, 'no newline->br post-pass: one <br> per newline the model wrote, never two', () => {
    for (const p of message().querySelectorAll('p')) {
        const html = p.innerHTML;
        assert.doesNotMatch(html, /<br>\s*<br>/, html);
    }
    assert.equal(message().querySelectorAll('p')[1].querySelectorAll('br').length, 1);
});

k.test('a-no-weld', S_CUMUL, 'a segment opening with a space keeps it: "il" + " body" stays two words', () => {
    assert.match(message().querySelectorAll('p')[1].textContent, /il body fine\./);
});

k.test('a-table-hr', S_RENDER, 'a markdown table and a rule are kept (BLOCK_ALLOWED widened with the table family and hr)', () => {
    const table = message().querySelector('table');
    assert.ok(table);
    assert.deepEqual([...table.querySelectorAll('th, td')].map(c => c.textContent), ['a', 'b', '1', '2']);
    assert.ok(message().querySelector('hr'));
});

k.test('a-fence', S_RENDER, 'a code fence shows markup as text', () => {
    const pre = message().querySelector('pre');
    assert.ok(pre);
    assert.equal(pre.querySelector('div'), null);
    assert.match(pre.textContent, /<div>x<\/div>/);
});

k.test('a-done', S_FLOW, 'tokensDone: the pill reports done with its check icon, the input is usable again, Stop is gone', () => {
    const pill = statusPill(ctx);
    assert.ok(pill.classList.contains('status-done'));
    assert.equal(statusText(ctx), 'Done!');
    assert.ok(statusIcon(ctx).querySelector('svg'));
    assert.equal(field(ctx).disabled, false);
    assert.ok(usable(sendButton(ctx)));
    assert.equal(usable(stopButton(ctx)), false);
});

// ---- answer B: the same text in one token -------------------------------------------------

k.test('b-input-states', S_FLOW, 'a second prompt typed by the user: the input locks again while it is out', async () => {
    await typeAndSend(ctx, 'Q2');
    assert.equal(field(ctx).disabled, true);
    assert.ok(usable(stopButton(ctx)));
    assert.deepEqual(worker.chatMessages(), ['Q1', 'Q2']);
});

k.test('b-same-rendering', S_CUMUL, 'the same raw text in ONE token renders exactly as the many-token stream did', async () => {
    await worker.stream(ctx, [FULL]);
    const [a, b] = botTurns(ctx);
    assert.equal(answerHtml(b), answerHtml(a));
    assert.notEqual(answerHtml(a), '');
});

k.test('b-history', S_DOM, 'the transcript keeps the whole conversation, in order: notice, Q1, A, Q2, B', () => {
    const kinds = turns(ctx).map(t => ['turn-info', 'turn-user', 'turn-bot'].find(c => t.classList.contains(c)));
    assert.deepEqual(kinds, ['turn-info', 'turn-user', 'turn-bot', 'turn-user', 'turn-bot']);
    assert.match(turns(ctx)[3].textContent, /Q2/);
    assert.equal(field(ctx).disabled, false);
});

// ---- answer C: dedicated thinking tokens --------------------------------------------------

const live = () => turnBody(lastBotTurn(ctx))?.querySelector('.thinking-live') ?? null;

k.test('c-indicator', S_LIVE, 'newThinkingToken: a .thinking-live row with the thinking spinner and "Thinking..." appears in the turn', async () => {
    await typeAndSend(ctx, 'Q3');
    await worker.thinking(ctx, 'Let me ');
    await worker.thinking(ctx, 'think.');
    const row = live();
    assert.ok(row, 'no live indicator');
    assert.match(row.querySelector('img')?.getAttribute('src') || '', /mzta-thinking\.svg$/);
    assert.equal(row.textContent, 'Thinking...');
    assert.equal(lastBotTurn(ctx).querySelectorAll('.thinking-live').length, 1);
});

k.test('c-indicator-sibling', S_LIVE, 'the indicator is a sibling of the accumulating message, not inside it, and survives a deferred flush', async () => {
    await worker.token(ctx, 'Answer one.\n');
    const row = live();
    assert.ok(row);
    assert.equal(row.parentElement, turnBody(lastBotTurn(ctx)));
    assert.equal(message().contains(row), false);
});

k.test('c-indicator-gone', S_LIVE, 'tokensDone: the indicator is removed, the real block is never on screen together with it', async () => {
    await worker.done(ctx);
    assert.equal(live(), null);
    assert.equal(lastBotTurn(ctx).querySelectorAll('.thinking-live').length, 0);
});

k.test('c-block', S_THINK, 'the thinking is rendered as a <details class="thinking-block"> prepended to the answer, holding the whole reasoning', () => {
    const m = message();
    const block = m.firstElementChild;
    assert.ok(block.matches('details.thinking-block'), m.innerHTML);
    assert.equal(block.querySelector('summary').textContent, 'Thinking');
    assert.equal(block.querySelector('.thinking-content').textContent, 'Let me think.');
    assert.match(answerHtml(lastBotTurn(ctx)), /Answer one\./);
});

k.test('c-collapsed', S_THINK, 'hide_thinking (default true): the block starts collapsed', () => {
    assert.equal(message().firstElementChild.open, false);
});

// ---- answer D: thinking only -------------------------------------------------------------

k.test('d-thinking-only', S_LIVE, 'a response made only of thinking tokens: the indicator does not survive tokensDone', async () => {
    await typeAndSend(ctx, 'Q4');
    await worker.thinking(ctx, 'Only thoughts.');
    assert.ok(live());
    await worker.done(ctx);
    assert.equal(live(), null);
    assert.equal(field(ctx).disabled, false);
});

k.test('d-thinking-only-block', S_THINK, 'a response made only of thinking tokens still shows its thinking block, with an empty answer', () => {
    const turn = lastBotTurn(ctx);
    const block = answerEls(turn)[0]?.querySelector('details.thinking-block');
    assert.ok(block, 'no thinking block');
    assert.equal(block.querySelector('.thinking-content').textContent, 'Only thoughts.');
    assert.equal(answerHtml(turn).trim(), '');
});

// ---- answer E: inline <think> -------------------------------------------------------------

k.test('e-inline-no-indicator', S_LIVE, 'inline <think> tags post no newThinkingToken, so no live indicator', async () => {
    await typeAndSend(ctx, 'Q5');
    await worker.stream(ctx, ['<think>inner ', 'reason</think>', 'Visible\n'], { done: false });
    assert.equal(live(), null);
});

k.test('e-inline-extracted', S_THINK, 'inline <think>…</think> is extracted into the thinking block and stripped from the answer', async () => {
    await worker.done(ctx);
    const turn = lastBotTurn(ctx);
    const block = answerEls(turn)[0].querySelector('details.thinking-block');
    assert.ok(block);
    assert.equal(block.querySelector('.thinking-content').textContent, 'inner reason');
    assert.match(answerHtml(turn), /Visible/);
    assert.doesNotMatch(answerHtml(turn), /inner|think/);
});

k.test('e-bars', S_DOM, 'only the newest answer keeps the full action bar', () => {
    const bars = botTurns(ctx).map(t => !!actionBar(t));
    assert.deepEqual(bars, [false, false, false, false, true]);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
