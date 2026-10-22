// The token-usage chip of each answer, in a ChatGPT API window (chat_show_usage_data at its default,
// on; OpenAI exposes no context window, so the Context row shows the count only), action "0".
// Five answers: full usage (cache and a reported 0 of reasoning), usage with a duplicate message, no
// usage at all, output tokens only, and one after a usage message that arrived with no open turn.
//
// Spec 04 "Rendering in the chat window" (the chip per answer, built at tokensDone and placed last
// before Close; nothing while streaming; the chip text rules; the popover: a button with
// aria-haspopup / aria-expanded / aria-controls, its rows in order, a null omitted and a 0 printed,
// the dividers, the session total; closing on a second click, Escape with focus back on the chip, a
// pointerdown outside; one open at a time; earlier answers keep their chip, moved into the compact
// toolbar; the chip a sibling of .message, marked data-mzta-usage), "Emitting to the chat window"
// (the usage message is separate from tokensDone, once per turn; one that arrives when no turn is
// open is dropped), "Context window" (OpenAI: none, the count alone).
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
    toolbar,
} from '../../webchat/webchat-page.mjs';
import {
    usageWrap,
    usageChip,
    usagePopover,
    chipText,
    popoverRows,
    count,
    DURATION_RE,
} from '../../webchat/usage-view.mjs';

const { ctx, worker } = await openWebchat({ local: { chatgpt_model: 'gpt-5' } });
after(() => ctx.close());
const k = webchatTests('08');

const S_RENDER = 'spec 04 "Rendering in the chat window"';
const S_EMIT = 'spec 04 "Emitting to the chat window"';
const S_CTX = 'spec 04 "Context window"';
const S_ACT = 'spec 01 "Actions on an answer"';

const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);
const L = {
    input: msg('apiwebchat_usage_input'), cached: msg('apiwebchat_usage_of_which_cached'),
    cacheWrite: msg('apiwebchat_usage_of_which_cache_write'), output: msg('apiwebchat_usage_output'),
    reasoning: msg('apiwebchat_usage_of_which_reasoning'), total: msg('apiwebchat_usage_total'),
    duration: msg('apiwebchat_usage_duration'), context: msg('apiwebchat_usage_context'),
    session: msg('apiwebchat_usage_session_total'),
};
const usage = fields => ({
    provider: 'openai_responses', model: 'gpt-5', input_tokens: null, output_tokens: null,
    total_tokens: null, cached_input_tokens: null, cache_creation_tokens: null, reasoning_tokens: null,
    tokens_per_second: null, ...fields,
});
const click = el => ctx.click(el);
const open = async turn => { if (usageChip(turn).getAttribute('aria-expanded') !== 'true') await click(usageChip(turn)); };
const close = async turn => { if (usageChip(turn).getAttribute('aria-expanded') === 'true') await click(usageChip(turn)); };
const turnAt = i => botTurns(ctx)[i];

// ---- answer 1: full usage --------------------------------------------------------------------

k.test('nothing-while-streaming', S_RENDER, 'usage arrives before tokensDone: it is stored, nothing is drawn while the answer streams', async () => {
    await apiSend(ctx, { prompt: 'Q1' });
    await worker.stream(ctx, ['First answer.'], { done: false });
    await worker.usage(ctx, 'm1', usage({ input_tokens: 600, output_tokens: 111, total_tokens: 711,
        cached_input_tokens: 100, reasoning_tokens: 0 }));
    assert.equal(usageWrap(lastBotTurn(ctx)), null);
});

k.test('chip-total', S_RENDER, 'tokensDone: the chip shows the total, "711 tokens"', async () => {
    await worker.done(ctx);
    assert.equal(chipText(turnAt(0)), msg('apiwebchat_usage_chip_tokens', [count(711)]));
});

k.test('chip-place', S_RENDER, 'the chip is the last action of the bar: after Copy, only Close follows it', () => {
    const items = [...actionBar(turnAt(0)).children];
    const at = items.indexOf(usageWrap(turnAt(0)));
    assert.ok(at > 0);
    assert.equal(items.length - 1, at + 1, 'one item after the chip');
    assert.equal(items.at(-1).textContent.trim(), 'Close');
    assert.ok(items.slice(0, at).some(el => el.classList.contains('copy_btn')));
});

k.test('chip-not-in-answer', S_RENDER, 'the chip is a sibling of the .message, never inside it, and carries data-mzta-usage', () => {
    for (const m of answerEls(turnAt(0))) assert.equal(m.querySelector('.mzta-usage, [data-mzta-usage]'), null);
    assert.equal(usageChip(turnAt(0)).getAttribute('data-mzta-usage'), '1');
    assert.equal(usagePopover(turnAt(0)).getAttribute('data-mzta-usage'), '1');
});

k.test('chip-button', S_RENDER, 'with detail beyond the duration the chip is a button: aria-haspopup="dialog", aria-expanded, aria-controls', () => {
    const chip = usageChip(turnAt(0));
    assert.equal(chip.localName, 'button');
    assert.equal(chip.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(chip.getAttribute('aria-expanded'), 'false');
    assert.equal(chip.getAttribute('aria-controls'), usagePopover(turnAt(0)).id);
    assert.equal(usagePopover(turnAt(0)).hidden, true);
});

k.test('popover-rows', S_RENDER, 'the popover rows, in order: a null omitted, a reported 0 printed, the context count alone, no session total on the first answer', async () => {
    await open(turnAt(0));
    assert.equal(usagePopover(turnAt(0)).hidden, false);
    assert.equal(usageChip(turnAt(0)).getAttribute('aria-expanded'), 'true');
    const rows = popoverRows(turnAt(0));
    const duration = rows.find(r => r[0] === L.duration);
    assert.ok(duration, JSON.stringify(rows));
    assert.deepEqual(rows, [
        [L.input, count(600), ''],
        [L.cached, count(100), 'sub'],
        [L.output, count(111), ''],
        [L.reasoning, count(0), 'sub'],
        [L.total, count(711), 'total'],
        ['divider'],
        duration,
        ['divider'],
        [L.context, count(711), ''],
    ]);
    assert.equal(rows.some(r => r[0] === L.cacheWrite), false);
});

k.test('popover-duration', S_RENDER, 'the Duration row: the measured time, with "· N tok/s" from the output tokens', () => {
    const [, value] = popoverRows(turnAt(0)).find(r => r[0] === L.duration);
    const [time, rate] = value.split(' · ');
    assert.match(time, DURATION_RE);
    assert.match(rate, /^[\d.,]+ tok\/s$/);
});

k.test('context-no-window', S_CTX, 'OpenAI exposes no context window: the Context row is the count alone, never "x / y · z%"', () => {
    const [, value] = popoverRows(turnAt(0)).find(r => r[0] === L.context);
    assert.doesNotMatch(value, /\/|%/);
});

k.test('popover-second-click', S_RENDER, 'a second click on the chip closes the popover', async () => {
    await click(usageChip(turnAt(0)));
    assert.equal(usagePopover(turnAt(0)).hidden, true);
    assert.equal(usageChip(turnAt(0)).getAttribute('aria-expanded'), 'false');
});

k.test('popover-escape', S_RENDER, 'Escape closes it and gives the focus back to the chip', async () => {
    await open(turnAt(0));
    await ctx.fire(ctx.document, 'keydown', { key: 'Escape' });
    assert.equal(usagePopover(turnAt(0)).hidden, true);
    assert.equal(ctx.document.activeElement, ctx.$('messages-area'));
    assert.equal(ctx.$('messages-area').shadowRoot.activeElement, usageChip(turnAt(0)));
});

k.test('popover-outside', S_RENDER, 'a pointerdown outside it closes it; one inside does not', async () => {
    await open(turnAt(0));
    await ctx.fire(usagePopover(turnAt(0)), 'pointerdown', { composed: true });
    assert.equal(usagePopover(turnAt(0)).hidden, false);
    await ctx.fire(ctx.document.body, 'pointerdown');
    assert.equal(usagePopover(turnAt(0)).hidden, true);
});

// ---- answer 2: a duplicate usage message -------------------------------------------------------

k.test('once-per-turn', S_EMIT, 'one usage per turn: a second usage message for the same answer is ignored', async () => {
    await typeAndSend(ctx, 'Q2');
    await worker.stream(ctx, ['Second answer.'], { done: false });
    await worker.usage(ctx, 'm2', usage({ input_tokens: 800, output_tokens: 200, total_tokens: 1000 }));
    await worker.usage(ctx, 'm2', usage({ input_tokens: 9000, output_tokens: 9000, total_tokens: 18000 }));
    await worker.done(ctx);
    assert.equal(chipText(turnAt(1)), msg('apiwebchat_usage_chip_tokens', [count(1000)]));
});

k.test('session-total', S_RENDER, 'the second answer\'s popover adds the session total, the sum of every answer so far', async () => {
    await open(turnAt(1));
    const rows = popoverRows(turnAt(1));
    assert.deepEqual(rows.find(r => r[0] === L.session), [L.session, count(1711), '']);
    assert.deepEqual(rows.find(r => r[0] === L.context), [L.context, count(1000), '']);
    await close(turnAt(1));
});

k.test('moved-to-toolbar', S_RENDER, 'the earlier answer keeps its chip: the same node, moved into its compact toolbar, as its last element', () => {
    const tools = toolbar(turnAt(0));
    assert.ok(tools);
    assert.equal(actionBar(turnAt(0)), null);
    assert.equal(tools.lastElementChild, usageWrap(turnAt(0)));
});

k.test('toolbar-action-0', S_ACT, 'the compact toolbar of an answer with nothing to insert (action "0", no summary) holds Copy and the usage chip, nothing else', () => {
    const kinds = [...toolbar(turnAt(0)).children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));
    assert.deepEqual(kinds, [msg('apiwebchat_copy'), 'chip']);
});

k.test('one-open', S_RENDER, 'at most one popover is open in the window', async () => {
    await open(turnAt(0));
    await open(turnAt(1));
    assert.equal(usagePopover(turnAt(0)).hidden, true);
    assert.equal(usagePopover(turnAt(1)).hidden, false);
    await close(turnAt(1));
});

k.test('earlier-snapshot', S_RENDER, 'an earlier answer\'s popover still describes the conversation as it was then: no session total', async () => {
    await open(turnAt(0));
    assert.equal(popoverRows(turnAt(0)).some(r => r[0] === L.session), false);
    await close(turnAt(0));
});

// ---- answer 3: no usage at all ---------------------------------------------------------------

k.test('chip-duration-static', S_RENDER, 'no usage reported: the chip is the measured duration, a static label with no popover', async () => {
    await typeAndSend(ctx, 'Q3');
    await worker.stream(ctx, ['Third answer.']);
    const chip = usageChip(turnAt(2));
    assert.equal(chip.localName, 'span');
    assert.match(chipText(turnAt(2)), DURATION_RE);
    assert.equal(usagePopover(turnAt(2)), null);
    assert.equal(chip.getAttribute('data-mzta-usage'), '1');
});

// ---- answer 4: output tokens only ---------------------------------------------------------------

k.test('chip-output-only', S_RENDER, 'output tokens only: "42 output tokens", and no Total row (nothing but the output to add up)', async () => {
    await typeAndSend(ctx, 'Q4');
    await worker.stream(ctx, ['Fourth answer.'], { done: false });
    await worker.usage(ctx, 'm4', usage({ output_tokens: 42 }));
    await worker.done(ctx);
    assert.equal(chipText(turnAt(3)), msg('apiwebchat_usage_chip_output_tokens', [count(42)]));
    await open(turnAt(3));
    const rows = popoverRows(turnAt(3));
    assert.deepEqual(rows[0], [L.output, count(42), '']);
    assert.equal(rows.some(r => r[0] === L.total || r[0] === L.input || r[0] === L.context), false);
    await close(turnAt(3));
});

// ---- answer 5: a usage message with no open turn --------------------------------------------------

k.test('late-usage-dropped', S_EMIT, 'a usage message arriving when no turn is open is dropped: it lands on no answer and is not counted', async () => {
    await worker.usage(ctx, 'late', usage({ input_tokens: 2500, output_tokens: 2500, total_tokens: 5000 }));
    await typeAndSend(ctx, 'Q5');
    await worker.stream(ctx, ['Fifth answer.'], { done: false });
    await worker.usage(ctx, 'm5', usage({ input_tokens: 6, output_tokens: 4, total_tokens: 10 }));
    await worker.done(ctx);
    await open(turnAt(4));
    assert.deepEqual(popoverRows(turnAt(4)).find(r => r[0] === L.session), [L.session, count(1721), '']);
    await close(turnAt(4));
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
