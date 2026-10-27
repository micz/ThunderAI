// Spec 04 "Anthropic / Claude":
//  - "One-shot retry on a 400" (fetchResponse): when the Messages API answers 400 and the error
//    message names a parameter that was actually sent, the request is repeated exactly once
//    without it, with a console.warn naming the model and the dropped field(s). Needles:
//    budget_tokens / thinking.type / thinking -> thinking; effort / output_config ->
//    output_config; temperature / top_p / top_k -> all three sampling params together. The
//    first entry whose needle matches AND whose fields are in the body wins; none: no retry.
//    Only 400. The error body is read from a clone: the original response is returned as-is
//    (unread) when there is nothing to drop, when the retry fails, or when the retry throws.
//    The clone is read within readResponseBody()'s 5 s: a body that never arrives is returned
//    unretried, its original cancelled too (the worker's read then ends at once); a user abort
//    during that read gives the is_aborted object (error contract).
//  - "400 error hints": describeAnthropicError(detail, model, i18nStrings) prepends a localized
//    hint when the message names budget_tokens / thinking.type / temperature / top_p / top_k /
//    effort / output_config / thinking (in that order, first match wins), the $MODEL$ literal
//    replaced with the model; otherwise, or with the key missing, the raw detail unchanged.

import assert from 'node:assert/strict';
import {
    areaFile,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import {
    apiFixture,
    jsonResponse,
    manualStream
} from './wire.mjs';

const { k, net, con } = areaFile('21-anthropic-400-retry');
const { Anthropic, describeAnthropicError } = await import('../../js/api/anthropic.js');
const { readResponseBody } = await import('../../js/api/api-retry.js');

const MSG_URL = 'https://api.anthropic.com/v1/messages';
const FX = apiFixture('anthropic.json');
const MESSAGES = [{ role: 'user', content: 'Hi' }];
const bad = key => () => jsonResponse(FX[key].body, { status: 400, statusText: 'Bad Request' });
const ok = () => jsonResponse({ id: 'msg_ok' });

function client(cfg) {
    return new Anthropic({ apiKey: 'sk-ant-FAKE-0000', version: '2023-06-01', ...cfg });
}

const SAMPLING = { model: 'claude-sonnet-4-5', temperature: '0.5', top_p: '0.9', top_k: '40', stop_sequences: 'END' };

k.test('drops-sampling', 'a 400 naming temperature: retried once without temperature, top_p and top_k together', async () => {
    net.expect(MSG_URL, bad('error_400_temperature')).expect(MSG_URL, ok);
    const r = await client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 200);
    assert.equal(net.calls.length, 2);
    const [first, second] = net.calls.map(c => c.json());
    for (const f of ['temperature', 'top_p', 'top_k']) {
        assert.ok(f in first, 'sent the first time: ' + f);
        assert.equal(f in second, false, 'dropped on the retry: ' + f);
    }
    assert.deepEqual(second.stop_sequences, ['END'], 'the rest of the body is unchanged');
    assert.equal(second.model, first.model);
    const w = con.warnings().join('\n');
    assert.ok(w.includes('claude-sonnet-4-5'), 'the warning names the model');
    assert.ok(['temperature', 'top_p', 'top_k'].every(f => w.includes(f)), 'and the dropped fields');
});

k.test('drops-thinking', 'a 400 naming budget_tokens: retried without thinking', async () => {
    net.expect(MSG_URL, bad('error_400_budget')).expect(MSG_URL, ok);
    const r = await client({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048 }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 200);
    assert.ok('thinking' in net.calls[0].json());
    assert.equal('thinking' in net.calls[1].json(), false);
});

k.test('first-applicable', 'the first entry whose fields were sent wins: "temperature ... thinking" with no temperature sent drops thinking', async () => {
    net.expect(MSG_URL, bad('error_400_thinking_with_temperature')).expect(MSG_URL, ok);
    await client({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048 }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(net.calls.length, 2);
    assert.equal('thinking' in net.calls[1].json(), false);
});

k.test('drops-effort', 'a 400 naming output_config: retried without output_config', async () => {
    const body = { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.effort: unsupported value for this model' } };
    net.expect(MSG_URL, () => jsonResponse(body, { status: 400 })).expect(MSG_URL, ok);
    await client({ model: 'claude-opus-4-6', effort: 'low' }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.ok('output_config' in net.calls[0].json());
    assert.equal('output_config' in net.calls[1].json(), false);
});

k.test('nothing-to-drop', 'a 400 naming nothing that was sent: no retry, the original response unread', async () => {
    net.expect(MSG_URL, bad('error_400_unrelated'));
    const r = await client({ model: 'claude-sonnet-4-5' }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 400);
    assert.equal(r.bodyUsed, false);
    assert.deepEqual(await r.json(), FX.error_400_unrelated.body);
    assert.equal(net.calls.length, 1);
});

k.test('needle-not-sent', 'a 400 naming temperature when no sampling param was sent: no retry', async () => {
    net.expect(MSG_URL, bad('error_400_temperature'));
    const r = await client({ model: 'claude-sonnet-4-5' }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 400);
    assert.equal(net.calls.length, 1);
});

k.test('exactly-once', 'a second 400 is not retried again: the ORIGINAL response is returned, unread', async () => {
    const second = { type: 'error', error: { type: 'invalid_request_error', message: 'top_k: still rejected' } };
    net.expect(MSG_URL, bad('error_400_temperature')).expect(MSG_URL, () => jsonResponse(second, { status: 400 }));
    const r = await client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(net.calls.length, 2);
    assert.equal(r.status, 400);
    assert.equal(r.bodyUsed, false);
    assert.deepEqual(await r.json(), FX.error_400_temperature.body, 'the first error, not the retry one');
});

k.test('retry-throws', 'when the retry throws, the original response is returned', async () => {
    net.expect(MSG_URL, bad('error_400_temperature')).expect(MSG_URL, NET.networkError());
    const r = await client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), FX.error_400_temperature.body);
});

k.test('only-400', 'another 4xx naming a parameter is not retried', async () => {
    net.expect(MSG_URL, () => jsonResponse(FX.error_400_temperature.body, { status: 422 }));
    const r = await client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 422);
    assert.equal(net.calls.length, 1);
});

/** A 400 whose body has started but never ends (until cancelled or errored). */
function stalled400() {
    const s = manualStream({ status: 400, statusText: 'Bad Request', contentType: 'application/json' });
    s.push('{"type": "error", "error": {"message": "temperat');
    return s;
}

k.test('body-stalled', 'a 400 whose body never arrives: after 5 s returned unretried, the original cancelled so the worker does not wait again', async (t) => {
    const timers = fakeTime(t);
    const s = stalled400();
    net.expect(MSG_URL, () => s.response);
    const t0 = Date.now();
    const r = await drive(client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0 }), timers);
    assert.equal(Date.now() - t0, 5000, 'the clone read gave up after 5 s');
    assert.equal(r.status, 400);
    assert.equal(net.calls.length, 1, 'nothing to drop is known: no retry');
    assert.equal(s.cancelled, true, 'the body was cancelled (the clone and the original)');
    assert.equal(await readResponseBody(r), '', 'the read of the original by the worker ends at once, no timer fired');
    assert.equal(Date.now() - t0, 5000);
});

k.test('abort-during-read', 'a user abort while the 400 body is read: the is_aborted object, no retry', async (t) => {
    fakeTime(t);   // no timer ever fires: the request must end on the abort alone
    const s = stalled400();
    net.expect(MSG_URL, () => s.response);
    const ctrl = new AbortController();
    const p = client(SAMPLING).fetchResponse(MESSAGES, { maxRetries: 0, signal: ctrl.signal });
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    assert.equal(net.calls.length, 1);
    ctrl.abort(new DOMException('stopped by the user', 'AbortError'));
    const out = await p;
    assert.equal(out.is_exception, true);
    assert.equal(out.is_aborted, true);
    assert.equal(out.ok, false);
    assert.equal(net.calls.length, 1, 'no retry');
});

k.test('transient-retry-too', 'the one-shot retry also gets the transient retry (_postMessages goes through fetchWithRetry)', async (t) => {
    const timers = fakeTime(t);
    net.expect(MSG_URL, bad('error_400_temperature'))
        .expect(MSG_URL, () => jsonResponse(FX.error_529.body, { status: 529 }))
        .expect(MSG_URL, ok);
    const r = await drive(client(SAMPLING).fetchResponse(MESSAGES, {}), timers);
    assert.equal(r.status, 200);
    assert.equal(net.calls.length, 3);
});

// ---- describeAnthropicError -----------------------------------------------------------------

const HINTS = {
    anthropic_err_hint_budget_tokens: 'HINT-BUDGET for $MODEL$.',
    anthropic_err_hint_thinking_type: 'HINT-THINKING for $MODEL$.',
    anthropic_err_hint_temperature: 'HINT-SAMPLING for $MODEL$.',
    anthropic_err_hint_effort: 'HINT-EFFORT for $MODEL$.',
};
const M = 'claude-sonnet-5';

for (const [id, detail, key] of [
    ['hint-budget', 'thinking.enabled.budget_tokens: not supported', 'BUDGET'],
    ['hint-thinking-type', 'thinking.type: "enabled" is not supported', 'THINKING'],
    ['hint-temperature', 'temperature: not supported', 'SAMPLING'],
    ['hint-top-p', 'top_p: not supported', 'SAMPLING'],
    ['hint-top-k', 'top_k: not supported', 'SAMPLING'],
    ['hint-effort', 'effort: invalid level', 'EFFORT'],
    ['hint-output-config', 'output_config: unknown field', 'EFFORT'],
    ['hint-thinking', 'thinking: unsupported on this model', 'THINKING'],
    ['hint-order', 'temperature may only be set to 1 when thinking is enabled', 'SAMPLING'],
    ['hint-order-budget', 'budget_tokens and thinking.type conflict', 'BUDGET'],
]) {
    k.test(id, `"${detail}" gets the ${key} hint (first match in the spec order), with the model`, () => {
        const out = describeAnthropicError(detail, M, HINTS);
        assert.ok(out.startsWith(`HINT-${key} for ${M}.`), out);
        assert.ok(out.endsWith(detail), 'the raw detail follows the hint');
        assert.equal(out.includes('$MODEL$'), false);
    });
}

k.test('hint-none', 'a message naming no parameter comes back unchanged', () => {
    assert.equal(describeAnthropicError('messages: at least one message is required', M, HINTS), 'messages: at least one message is required');
});

k.test('hint-missing-key', 'a missing hint key returns the raw detail', () => {
    assert.equal(describeAnthropicError('temperature: not supported', M, {}), 'temperature: not supported');
    assert.equal(describeAnthropicError('temperature: not supported', M, null), 'temperature: not supported');
});

k.coverage();
