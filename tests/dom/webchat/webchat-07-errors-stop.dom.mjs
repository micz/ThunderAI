// What the user sees when a request does not go as planned, in a ChatGPT API window (action "0",
// usage display off): retries announced in the pill, Stop before any answer (requestAborted), an
// error in the middle of a stream (with the provider's "retry after"), the answer that follows it,
// and Stop in the middle of a stream.
//
// Spec 04 "Automatic Retry Handling" (newRetryAttempt -> showRetryStatus(): "Server not available
// (HTTP 503), retrying in 10 s (attempt 2 of 5)...", the 429 wording, the waiting icon kept, the
// Stop button visible so a retry can be cancelled; requestAborted -> an apiwebchat_request_cancelled
// info notice and enableInput(false); the api_retry_after_hint paragraph under the error). Spec 01
// "Streaming data flow" (error -> an error bot message, the input left usable), "Streaming:
// re-render the whole accumulated raw each time" ("The abort path must discard the streaming
// state": the next answer is not rendered as a continuation of the failed one), "Transcript DOM
// contract" (an error turn takes the full-bar slot; the next degrade removes its bar and builds no
// toolbar). Spec 04 "Live "Thinking…" indicator" (the pill's classes).
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
    turns,
    botTurns,
    lastBotTurn,
    answerHtml,
    actionBar,
    toolbar,
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
const k = webchatTests('07');

const S_RETRY = 'spec 04 "Automatic Retry Handling"';
const S_FLOW = 'spec 01 "Streaming data flow"';
const S_CUMUL = 'spec 01 "Streaming: re-render the whole accumulated raw each time"';
const S_DOM = 'spec 01 "Transcript DOM contract"';

const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);
const stops = () => worker.posted.filter(m => m.type === 'stop');

// ---- retries, then Stop before any answer ---------------------------------------------

k.test('retry-503', S_RETRY, 'newRetryAttempt with an HTTP status: "Server not available (HTTP 503), retrying in 10 s (attempt 2 of 5)..."', async () => {
    await apiSend(ctx, { prompt: 'Q1' });
    await worker.retry(ctx, { attempt: 2, maxRetries: 5, delayMs: 10000, status: 503, reason: 'http' });
    assert.equal(statusText(ctx), 'Server not available (HTTP 503), retrying in 10 s (attempt 2 of 5)...');
});

k.test('retry-waiting-icon', S_RETRY, 'a retry keeps the waiting state and its icon', () => {
    assert.ok(statusPill(ctx).classList.contains('status-waiting'));
    assert.match(statusIcon(ctx).querySelector('img')?.getAttribute('src') || '', /mzta-waiting-server\.svg$/);
});

k.test('retry-stop-visible', S_RETRY, 'while a retry is pending the Stop button is visible, so the retry can be cancelled', () => {
    assert.ok(usable(stopButton(ctx)));
});

k.test('retry-429', S_RETRY, 'a 429 has its own wording: "Rate limit reached, retrying in 10 s (attempt 3 of 5)..."', async () => {
    await worker.retry(ctx, { attempt: 3, maxRetries: 5, delayMs: 10000, status: 429, reason: 'http' });
    assert.equal(statusText(ctx), 'Rate limit reached, retrying in 10 s (attempt 3 of 5)...');
});

k.test('retry-network', S_RETRY, 'a network failure (no status) is named as such in the same wording', async () => {
    await worker.retry(ctx, { attempt: 4, maxRetries: 5, delayMs: 10000, status: null, reason: 'network' });
    assert.equal(statusText(ctx), `Server not available (${msg('apiwebchat_retry_reason_network')}), retrying in 10 s (attempt 4 of 5)...`);
});

k.test('stop-posts', S_FLOW, 'Stop posts {type: "stop"} to the worker and disables itself while stopping', async () => {
    await ctx.click(stopButton(ctx));
    assert.deepEqual(stops(), [{ type: 'stop' }]);
    assert.ok(stopButton(ctx).disabled);
    assert.match(stopButton(ctx).title, /^Stopping/);
});

k.test('aborted-notice', S_RETRY, 'requestAborted: an info notice says the request was cancelled', async () => {
    await worker.aborted(ctx);
    const last = turns(ctx).at(-1);
    assert.ok(last.classList.contains('turn-info'));
    assert.equal(last.textContent, msg('apiwebchat_request_cancelled'));
    assert.equal(botTurns(ctx).length, 0);
});

k.test('aborted-input', S_RETRY, 'requestAborted: enableInput(false) - the input is usable again, the pill and its countdown gone', () => {
    assert.ok(usable(field(ctx)));
    assert.ok(usable(sendButton(ctx)));
    assert.equal(usable(stopButton(ctx)), false);
    assert.equal(statusPill(ctx).style.display, 'none');
    assert.equal(statusText(ctx), '');
});

// ---- an error in the middle of a stream -------------------------------------------------

const ERROR = 'Stream interrupted <b>500</b>';

k.test('error-mid-stream', S_FLOW, 'error: the error is shown in a bot turn of its own, as text, after the partial answer', async () => {
    await typeAndSend(ctx, 'Q2');
    await worker.stream(ctx, ['Partial ans', 'wer\n'], { done: false });
    await worker.error(ctx, ERROR, { retryAfterMs: 90000 });
    const last = lastBotTurn(ctx);
    assert.ok(last.textContent.includes(ERROR), last.textContent);
    assert.equal(last.querySelector('.turn-body b'), null);
});

k.test('retry-after-hint', S_RETRY, 'a provider asking to wait longer than the retries accept: the api_retry_after_hint paragraph under the error', () => {
    const lines = [...lastBotTurn(ctx).querySelectorAll('.turn-body > .message')].map(m => m.textContent);
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.equal(lines[0], ERROR);
    assert.match(lines[1], /^The AI provider asks to retry in .*1/);
});

k.test('error-input', S_FLOW, 'after the error the input stays usable and the pill shows the error', () => {
    assert.ok(usable(field(ctx)));
    assert.ok(usable(sendButton(ctx)));
    assert.equal(usable(stopButton(ctx)), false);
    assert.ok(statusPill(ctx).classList.contains('status-error'));
});

k.test('error-full-bar', S_DOM, 'the error turn holds the full-bar slot: a Close-only .action-bar', () => {
    const bar = actionBar(lastBotTurn(ctx));
    assert.ok(bar);
    assert.deepEqual([...bar.querySelectorAll('button')].map(b => b.textContent.trim()), ['Close']);
});

k.test('no-continuation', S_CUMUL, 'the next answer starts fresh: nothing of the interrupted one is rendered with it', async () => {
    await typeAndSend(ctx, 'Q3');
    await worker.stream(ctx, ['Fresh answer.']);
    const html = answerHtml(lastBotTurn(ctx));
    assert.match(html, /Fresh answer\./);
    assert.doesNotMatch(html, /Partial|answer\n/);
});

k.test('error-bar-removed', S_DOM, 'the newer answer takes the full bar: the error turn\'s bar is removed and no toolbar is built for it', () => {
    const errorTurn = botTurns(ctx).find(t => t.textContent.includes(ERROR));
    assert.equal(actionBar(errorTurn), null);
    assert.equal(toolbar(errorTurn), null);
    assert.ok(actionBar(lastBotTurn(ctx)));
});

// ---- Stop in the middle of a stream -----------------------------------------------------

k.test('stop-mid-stream', S_FLOW, 'Stop while tokens arrive: {type: "stop"} posted; the worker\'s tokensDone then closes the answer and frees the input', async () => {
    await typeAndSend(ctx, 'Q4');
    await worker.stream(ctx, ['Some text'], { done: false });
    await ctx.click(stopButton(ctx));
    assert.equal(stops().length, 2);
    await worker.done(ctx);
    assert.match(answerHtml(lastBotTurn(ctx)), /Some text/);
    assert.ok(usable(field(ctx)));
    assert.equal(usable(stopButton(ctx)), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
