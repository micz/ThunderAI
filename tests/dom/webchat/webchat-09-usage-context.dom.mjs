// The context window in the usage popover, in an Ollama window whose ollama_num_ctx is set (1000):
// the most authoritative source, so no request is needed to know it. Two answers: the first fills
// 82% of the window and reports its own speed, the second 40%.
//
// Spec 04 "Context window" (looked up once, after the first completed answer, not awaited; Ollama:
// ollama_num_ctx > 0 first; the popovers opened from then on show the maximum, the popover being
// rebuilt on every open), "Rendering in the chat window" (the Context row `used / max · pct%`, at
// 80% or more the warn style and the "consider starting a new chat" note; the rate: the provider's
// tokens_per_second when reported, rounded).
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
} from '../../webchat/webchat-page.mjs';
import {
    usageChip,
    popoverRows,
    count,
} from '../../webchat/usage-view.mjs';

const { ctx, worker } = await openWebchat({
    llm: 'ollama_api',
    local: { ollama_host: 'http://localhost:11434', ollama_model: 'llama3', ollama_num_ctx: 1000 },
});
after(() => ctx.close());
const k = webchatTests('09');

const S_CTX = 'spec 04 "Context window"';
const S_RENDER = 'spec 04 "Rendering in the chat window"';

const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);
const L_CONTEXT = msg('apiwebchat_usage_context');
const L_DURATION = msg('apiwebchat_usage_duration');
const usage = fields => ({
    provider: 'ollama', model: 'llama3', input_tokens: null, output_tokens: null, total_tokens: null,
    cached_input_tokens: null, cache_creation_tokens: null, reasoning_tokens: null,
    tokens_per_second: null, ...fields,
});
async function rowsOf(turn) {
    await ctx.click(usageChip(turn));
    const rows = popoverRows(turn);
    await ctx.click(usageChip(turn));
    return rows;
}

k.test('init-flag', S_RENDER, 'Ollama reports usage: the usage UI is on for this window', () => {
    assert.equal(worker.posted.find(m => m.type === 'init').chat_show_usage_data, true);
});

k.test('window-shown', S_CTX, 'after the first completed answer the window is known: the Context row reads "820 / 1,000 · 82%"', async () => {
    await apiSend(ctx, { prompt: 'Q1' });
    await worker.stream(ctx, ['One.'], { done: false });
    await worker.usage(ctx, 'o1', usage({ input_tokens: 700, output_tokens: 120, total_tokens: 820, tokens_per_second: 35.6 }));
    await worker.done(ctx);
    const rows = await rowsOf(botTurns(ctx)[0]);
    const ctxRow = rows.find(r => r[0] === L_CONTEXT);
    assert.deepEqual(ctxRow.slice(0, 2), [L_CONTEXT, msg('apiwebchat_usage_context_value', [count(820), count(1000), '82'])]);
});

k.test('no-request', S_CTX, 'ollama_num_ctx > 0 is the first source: no request was made to learn the window', () => {
    assert.deepEqual(ctx.fetchCalls, []);
});

k.test('warn', S_RENDER, 'at 80% or more the Context value is in the warn style and a note suggests a new chat', async () => {
    const rows = await rowsOf(botTurns(ctx)[0]);
    assert.equal(rows.find(r => r[0] === L_CONTEXT)[2], 'warn');
    assert.deepEqual(rows.at(-1), ['note', msg('apiwebchat_usage_context_warn')]);
});

k.test('provider-rate', S_RENDER, 'the rate is the provider\'s tokens_per_second, rounded: "· 36 tok/s"', async () => {
    const [, value] = (await rowsOf(botTurns(ctx)[0])).find(r => r[0] === L_DURATION);
    assert.ok(value.endsWith(' · ' + msg('apiwebchat_usage_speed', [count(36)])), value);
});

k.test('below-warn', S_RENDER, 'under 80%: no warn style and no note', async () => {
    await typeAndSend(ctx, 'Q2');
    await worker.stream(ctx, ['Two.'], { done: false });
    await worker.usage(ctx, 'o2', usage({ input_tokens: 300, output_tokens: 100, total_tokens: 400 }));
    await worker.done(ctx);
    const rows = await rowsOf(botTurns(ctx)[1]);
    const ctxRow = rows.find(r => r[0] === L_CONTEXT);
    assert.deepEqual(ctxRow, [L_CONTEXT, msg('apiwebchat_usage_context_value', [count(400), count(1000), '40']), '']);
    assert.equal(rows.some(r => r[0] === 'note'), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
