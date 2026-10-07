// mzta_specialCommand (js/mzta-special-commands.js), the half the api area leaves out
// (tests/api/README.md "What is not covered"): what happens after initWorker().
//
// Spec 04 "Worker Lifecycle & Timeout":
//  - one Worker per instance, created in initWorker() only: the constructor merely checks the
//    connection type and picks the worker file; a fresh instance per prompt;
//  - Termination: sendPrompt() always calls dispose() once the prompt settles - success, error or
//    timeout; dispose() calls worker.terminate() and nulls the reference;
//  - Timeout: sendPrompt() aborts the request if the worker never replies (no tokensDone / error),
//    after special_command_timeout (default 120000 ms, with a hardcoded fallback); the promise
//    rejects with a clear error and the worker is terminated by the same finally.
// Spec 04 "Thinking in special commands": newThinkingToken never reaches the resolved value;
// inline <think> blocks are stripped with stripThinkTags(text, true, true): a dangling
// unterminated <think> is dropped, and the leading whitespace a removed block leaves is trimmed.
// Spec 04 "Batch cancellation", #batch-stop-on-rate-limit: sendPrompt() copies the worker's
// `rateLimited` flag and `retryAfterMs` onto the rejected Error; it records the status of each
// newRetryAttempt, so a timeout firing while the last retried failure was a 429 is flagged too.
// Spec 04 "Error contract": a worker posts {type: 'error', payload: <text>, rateLimited, retryAfterMs}.
//
// The worker is the area's scripted fake (./fake-worker.mjs); the timers are node:test's mock
// timers, so nothing waits for real.

import assert from 'node:assert/strict';
import { moduleContext, flush } from './context.mjs';
import {
    token,
    thinking,
    done,
    sent,
    retry,
    error
} from './fake-worker.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await moduleContext({
    local: { chatgpt_api_key: 'sk-FAKE', chatgpt_model: 'gpt-test', ollama_host: 'http://localhost:11434', ollama_model: 'llama' },
});
const { mzta_specialCommand } = await import('../../js/mzta-special-commands.js');
const k = caseTests('10-special-command');

/** A command whose worker is created, and its prompt sent: {cmd, w, p}. */
async function started(prompt = 'Say hi', llm = 'chatgpt_api') {
    const cmd = new mzta_specialCommand({ prompt, llm, config: {} });
    await cmd.initWorker();
    const w = ctx.workers.last();
    const p = cmd.sendPrompt();
    p.catch(() => {});
    return { cmd, w, p };
}

const setTimeoutPref = v => ctx.ctl.browser.storage.local.set({ special_command_timeout: v });

k.test('no-worker-before-init', 'the constructor creates no Worker; initWorker() creates exactly one', async () => {
    const before = ctx.workers.created.length;
    const cmd = new mzta_specialCommand({ prompt: 'x', llm: 'ollama_api', config: {} });
    assert.equal(ctx.workers.created.length, before);
    assert.equal(cmd.worker, null);
    await cmd.initWorker();
    assert.equal(ctx.workers.created.length, before + 1);
    assert.equal(ctx.workers.last().file, 'model-worker-ollama.js');
    cmd.dispose();
});

k.test('invalid-llm', 'an unknown connection type throws in the constructor, and no worker exists', () => {
    const before = ctx.workers.created.length;
    assert.throws(() => new mzta_specialCommand({ prompt: 'x', llm: 'chatgpt_web' }));
    assert.equal(ctx.workers.created.length, before);
});

k.test('prompt-posted', 'sendPrompt() posts the prompt to the worker as one chatMessage', async () => {
    const { w, p } = await started('Classify this email');
    assert.deepEqual(w.posted.map(m => m.type), ['init', 'chatMessage']);
    assert.equal(w.prompt, 'Classify this email');
    w.deliver(done());
    await p;
});

k.test('accumulate', 'the answer is the newToken payloads concatenated, resolved at tokensDone', async () => {
    const { w, p } = await started();
    w.deliver(sent(), token('Hel'), token('lo, '), token('world'), done());
    assert.equal(await p, 'Hello, world');
});

k.test('retry-not-answer', 'newRetryAttempt and messageSent add nothing to the answer', async () => {
    const { w, p } = await started();
    w.deliver(sent(), retry(503), token('A'), sent(), retry(429), token('B'), done());
    assert.equal(await p, 'AB');
});

k.test('dispose-on-success', 'on success the worker is terminated and the reference released', async () => {
    const { cmd, w, p } = await started();
    w.deliver(token('ok'), done());
    await p;
    assert.equal(w.terminated, true);
    assert.equal(cmd.worker, null);
});

k.test('thinking-tokens-dropped', 'newThinkingToken never reaches the resolved value', async () => {
    const { w, p } = await started();
    w.deliver(thinking('Let me think about '), thinking('the sender...'), token('{"spamValue": 3}'), done());
    assert.equal(await p, '{"spamValue": 3}');
});

k.test('think-block-stripped', 'an inline <think> block is stripped before the answer is resolved', async () => {
    const { w, p } = await started();
    w.deliver(token('<think>reasoning\nmore</think>'), token('Final answer'), done());
    assert.equal(await p, 'Final answer');
});

k.test('think-leading-whitespace', 'the whitespace a removed block leaves at the start is trimmed', async () => {
    const { w, p } = await started();
    w.deliver(token('<think>r</think>\n\n  {"a": 1}'), done());
    assert.equal(await p, '{"a": 1}');
});

k.test('think-unterminated', 'a dangling unterminated <think> (a truncated reply) is dropped, not handed to the parser', async () => {
    const { w, p } = await started();
    w.deliver(token('Answer part '), token('<think>the model was cut off while thinking'), done());
    const out = await p;
    assert.equal(out.includes('<think>'), false, JSON.stringify(out));
    assert.equal(out.includes('cut off'), false, JSON.stringify(out));
});

k.test('error-rejects', 'a worker error rejects with the error text, and the worker is terminated', async () => {
    const { cmd, w, p } = await started();
    w.deliver(token('partial'), error('OpenAI API request failed: 500 Internal Server Error, Detail: x'));
    await assert.rejects(p, e => e instanceof Error && e.message.includes('500 Internal Server Error'));
    assert.equal(w.terminated, true);
    assert.equal(cmd.worker, null);
});

k.test('error-rate-limited', 'the worker\'s rateLimited flag and retryAfterMs are copied onto the rejected Error', async () => {
    const { w, p } = await started();
    w.deliver(error('429 Too Many Requests', { rateLimited: true, retryAfterMs: 3600000 }));
    await assert.rejects(p, e => e.rateLimited === true && e.retryAfterMs === 3600000);
});

k.test('error-not-rate-limited', 'an ordinary error carries no rateLimited flag', async () => {
    const { w, p } = await started();
    w.deliver(error('503 Service Unavailable', { rateLimited: false, retryAfterMs: null }));
    await assert.rejects(p, e => !e.rateLimited && e.retryAfterMs === undefined);
});

k.test('crash-rejects', 'a worker script error (onerror) rejects, and the worker is terminated', async () => {
    const { cmd, w, p } = await started();
    w.crash({ message: 'SyntaxError', filename: 'model-worker-openai_responses.js', lineno: 3, colno: 1 });
    await assert.rejects(p);
    assert.equal(w.terminated, true);
    assert.equal(cmd.worker, null);
});

k.test('timeout-pref', 'with no reply the request is aborted after special_command_timeout: rejected, worker terminated', async (t) => {
    await setTimeoutPref(5000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cmd, w, p } = await started();
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    t.mock.timers.tick(4999);
    await flush(3);
    assert.equal(settled, false, 'still waiting one ms before the timeout');
    t.mock.timers.tick(1);
    await assert.rejects(p, e => /timed out/i.test(e.message));
    assert.equal(w.terminated, true);
    assert.equal(cmd.worker, null);
});

k.test('timeout-default', 'an unusable special_command_timeout falls back to the 120000 ms default', async (t) => {
    await setTimeoutPref(0);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, p } = await started();
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    t.mock.timers.tick(119999);
    await flush(3);
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await assert.rejects(p, /timed out/i);
    assert.equal(w.terminated, true);
});

k.test('timeout-after-429', 'a timeout while the last retried failure was a 429 is reported as rate limited', async (t) => {
    await setTimeoutPref(1000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, p } = await started();
    w.deliver(retry(429));
    t.mock.timers.tick(1000);
    await assert.rejects(p, e => /timed out/i.test(e.message) && e.rateLimited === true);
});

k.test('timeout-after-503', 'a timeout after a retried 503 is a plain timeout, not a rate limit', async (t) => {
    await setTimeoutPref(1000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, p } = await started();
    w.deliver(retry(429), retry(503));
    t.mock.timers.tick(1000);
    await assert.rejects(p, e => /timed out/i.test(e.message) && !e.rateLimited);
});

k.test('no-timeout-after-answer', 'once answered, the timeout never fires: the answer stands', async (t) => {
    await setTimeoutPref(1000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, p } = await started();
    w.deliver(token('fine'), done());
    t.mock.timers.tick(5000);
    assert.equal(await p, 'fine');
});

k.test('dispose-idempotent', 'dispose() is safe to call again, and on a command that never created a worker', async () => {
    const cmd = new mzta_specialCommand({ prompt: 'x', llm: 'chatgpt_api', config: {} });
    cmd.dispose();
    await cmd.initWorker();
    const w = ctx.workers.last();
    cmd.dispose();
    cmd.dispose();
    assert.equal(w.terminated, true);
    assert.equal(cmd.worker, null);
});

k.test('no-leak', 'after every path above, no worker is left alive', async () => {
    await flush(3);
    assert.deepEqual(ctx.workers.live().map(w => w.file), []);
    assert.deepEqual(ctx.workers.unexpected, []);
});

k.coverage();
