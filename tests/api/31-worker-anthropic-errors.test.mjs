// Spec 04, the Anthropic model worker on its failure paths, one instance for the file, usage
// display OFF (chat_show_usage_data false):
//  - "Workers and UI": Stop while waiting for the response aborts the request (also during the
//    body read of a retried 429: no newRetryAttempt); an aborted request
//    (is_aborted) removes the unanswered user message from conversationHistory and posts
//    requestAborted (not error); once streaming has started the stopStreaming loop handles Stop;
//  - "Error contract between js/api/* and workers", reading the body of an HTTP error: within 5 s
//    (a body that never arrives: the error with the statusText as detail), and while Stop can
//    abort it (Stop then: requestAborted, no error);
//  - "Error contract between js/api/* and workers": error_text is the exception's own `error`
//    (already prefixed, no status) for is_exception, else
//    i18n["anthropic_api_request_failed"] + ": " + status + " " + statusText + ", Detail: " +
//    error_message [+ " " + errorDetail]; posted as {type:'error', payload, rateLimited,
//    retryAfterMs} and thrown with the same text; rateLimited true for a 429 after the retries
//    or a retryAfterMs, false on is_exception and for 503/529; on a 400 the message gets the
//    describeAnthropicError() hint;
//  - "Emitting to the chat window": nothing emitted when the option is off.
// Realm: worker-realm.mjs - no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    drive,
    fakeTime
} from './harness.mjs';
import { NET } from './fetch-model.mjs';
import {
    assertNoBrowser,
    flush,
    initMessage,
    loadWorker,
    shape,
    startTurn,
    until
} from './worker-realm.mjs';
import {
    apiFixture,
    jsonResponse,
    manualStream,
    sse,
    streamResponse
} from './wire.mjs';

assertNoBrowser();
const { k, net } = areaFile('31-worker-anthropic-errors');
const w = await loadWorker('model-worker-anthropic');

const MSG_URL = 'https://api.anthropic.com/v1/messages';
const FX = apiFixture('anthropic.json');
const FAILED = 'Claude API request failed';
const INTERRUPTED = 'The connection to the server was unexpectedly interrupted';
const wire = events => events.map(e => sse(e.data, e.event)).join('');

await w.send(initMessage({
    anthropic_api_key: 'sk-ant-FAKE-0000',
    anthropic_model: 'claude-sonnet-4-5',
    anthropic_version: '2023-06-01',
    anthropic_max_tokens: 4096,
    anthropic_extended_thinking_budget: 0,
}, {
    chat_show_usage_data: false,
    i18nStrings: {
        anthropic_api_request_failed: FAILED,
        error_connection_interrupted: INTERRUPTED,
        anthropic_err_hint_temperature: 'HINT-SAMPLING for $MODEL$.',
        anthropic_err_hint_budget_tokens: 'HINT-BUDGET for $MODEL$.',
        anthropic_err_hint_thinking_type: 'HINT-THINKING for $MODEL$.',
        anthropic_err_hint_effort: 'HINT-EFFORT for $MODEL$.',
    },
}));

const errorOf = t => t.posted().filter(m => m.type === 'error');

k.test('abort-before-response', 'Stop before any answer: requestAborted, no error, and the message leaves the history', async () => {
    net.expect(MSG_URL, NET.hang);
    const t = startTurn(w, 'LOST QUESTION');
    await until(() => net.calls.length === 1, 'the request');
    await w.send({ type: 'stop' });
    await t.done;
    assert.ok(t.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(t), []);
    assert.equal(net.calls[0].signal.aborted, true, 'the request itself was aborted');
});

k.test('abort-during-body-read', 'Stop while the body of a retried 429 is read (the 429 inspection): requestAborted, no newRetryAttempt, no error', async (t) => {
    fakeTime(t);   // no timer ever fires: the turn must end on the Stop alone
    const s = manualStream({ status: 429, contentType: 'application/json' });
    s.push('{"error": {"message": "never fini');
    net.expect(MSG_URL, () => s.response);
    const turn = startTurn(w, 'LOST DURING THE BODY READ');
    await until(() => net.calls.length === 1, 'the request');
    await flush();   // the response is in, its body being read
    await w.send({ type: 'stop' });
    await turn.done;
    const types = turn.posted().map(m => m.type);
    assert.ok(types.includes('requestAborted'));
    assert.equal(types.includes('newRetryAttempt'), false, 'no retry announced after Stop');
    assert.deepEqual(errorOf(turn), []);
    assert.equal(net.calls.length, 1, 'no further attempt');
    assert.equal(s.cancelled, true, 'the body was cancelled');
    // after-abort, next, checks that this message left the history too.
});

k.test('after-abort', 'the next turn does not resend the aborted message; with the option off no usage is posted', async () => {
    net.expect(MSG_URL, () => streamResponse([wire(FX.stream_text.events)]));
    const t = startTurn(w, 'Second question');
    await t.done;
    assert.deepEqual(net.calls[0].json().messages, [{ role: 'user', content: 'Second question' }]);
    assert.deepEqual(shape(t.posted()), [['newToken', 'Hello'], ['newToken', '! How can I help?'], ['tokensDone', '']]);
});

k.test('stop-mid-stream', 'Stop once streaming: the stream is cancelled and the turn closes with tokensDone', async () => {
    const s = manualStream();
    net.expect(MSG_URL, () => s.response);
    const t = startTurn(w, 'Long answer please');
    const ev = FX.stream_text.events;
    s.push(sse(ev[0].data, ev[0].event) + sse(ev[3].data, ev[3].event));
    await until(() => t.posted().some(m => m.type === 'newToken'), 'the first token');
    await w.send({ type: 'stop' });
    s.push(sse(ev[4].data, ev[4].event));           // the pending read resolves: it is never rejected
    await t.done;
    assert.equal(s.cancelled, true, 'the reader was cancelled');
    const types = t.posted().map(m => m.type);
    assert.equal(types.filter(x => x === 'tokensDone').length, 1);
    assert.equal(types.at(-1), 'tokensDone');
    assert.deepEqual(errorOf(t), []);
    assert.equal(types.includes('requestAborted'), false);
});

k.test('http-400-hint', 'a 400 naming an option: the error text carries status, statusText, the hinted message and the detail', async () => {
    // No temperature is configured, so the client has nothing to drop and does not retry.
    const body = FX.error_400_temperature.body;
    net.expect(MSG_URL, () => jsonResponse(body, { status: 400, statusText: 'Bad Request' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done, e => e.message.endsWith(errorOf(t)[0].payload));
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 400 Bad Request, Detail: HINT-SAMPLING for claude-sonnet-4-5.'), err.payload);
    assert.ok(err.payload.includes(body.error.message));
    assert.equal(err.payload.includes('undefined'), false);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

k.test('http-401', 'a 401: no hint, the provider message in the detail', async () => {
    net.expect(MSG_URL, () => jsonResponse(FX.error_401.body, { status: 401, statusText: 'Unauthorized' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    const [err] = errorOf(t);
    assert.ok(err.payload.startsWith(FAILED + ': 401 Unauthorized, Detail: invalid x-api-key'), err.payload);
    assert.equal(err.rateLimited, false);
});

k.test('rate-limited-429', 'a 429 still failing after the retries: rateLimited, no retryAfterMs', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(MSG_URL, () => jsonResponse(FX.error_429_rate_limit.body, { status: 429, statusText: 'Too Many Requests' }));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    assert.equal(turn.posted().filter(m => m.type === 'newRetryAttempt').length, 5);
    const [err] = errorOf(turn);
    assert.equal(err.rateLimited, true);
    assert.equal(err.retryAfterMs, null);
});

k.test('spend-limit-429', 'a 429 retrying cannot fix: returned at once, rateLimited', async () => {
    net.expect(MSG_URL, () => jsonResponse(FX.error_429_spend_limit.body, { status: 429, statusText: 'Too Many Requests' }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    assert.equal(t.posted().some(m => m.type === 'newRetryAttempt'), false);
    assert.equal(errorOf(t)[0].rateLimited, true);
});

k.test('retry-after-long', 'a 529 asking to wait an hour: not retried, rateLimited with retryAfterMs', async () => {
    net.expect(MSG_URL, () => jsonResponse(FX.error_529.body, { status: 529, statusText: '', headers: { 'Retry-After': '3600' } }));
    const t = startTurn(w, 'q');
    await assert.rejects(t.done);
    const [err] = errorOf(t);
    assert.equal(err.rateLimited, true, 'a retryAfterMs is always rateLimited, whatever the status');
    assert.equal(err.retryAfterMs, 3600000);
});

k.test('overloaded-not-rate-limited', 'a 529 after the retries is not flagged rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(MSG_URL, () => jsonResponse(FX.error_529.body, { status: 529 }));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    const [err] = errorOf(turn);
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('network', 'a network failure after the retries: the exception text as is, no status, not rateLimited', async (t) => {
    const timers = fakeTime(t);
    for (let i = 0; i < 6; i++) net.expect(MSG_URL, NET.networkError('NetworkError when attempting to fetch resource.'));
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers), e => e.message.endsWith(errorOf(turn)[0].payload));
    const [err] = errorOf(turn);
    assert.ok(err.payload.includes('NetworkError when attempting to fetch resource.'));
    assert.match(err.payload, /Claude/);
    assert.equal(err.payload.includes('undefined'), false, 'no "undefined undefined" status');
    assert.equal(err.payload.split('request failed').length - 1, 1, 'the provider prefix appears once, not re-prefixed');
    assert.equal(err.rateLimited, false);
    assert.equal(err.retryAfterMs, null);
});

k.test('stream-error-event', 'an error event mid-stream: one error with its message, no tokensDone, not rateLimited', async () => {
    const ev = FX.stream_text.events;
    net.expect(MSG_URL, () => streamResponse([wire([ev[0], ev[3]]) + sse(FX.stream_error_event.event.data, 'error')]));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, FAILED + ': Overloaded');
    assert.notEqual(errs[0].rateLimited, true);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

k.test('stream-cut', 'a connection cut mid-stream: one error, connection interrupted, no tokensDone', async () => {
    const ev = FX.stream_text.events;
    net.expect(MSG_URL, () => streamResponse([wire([ev[0], ev[3]])], { errorAfter: 1 }));
    const t = startTurn(w, 'q');
    await t.done;
    const errs = errorOf(t);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, INTERRUPTED + ': Error in input stream');
    assert.notEqual(errs[0].rateLimited, true);
    assert.equal(t.posted().some(m => m.type === 'tokensDone'), false);
});

/** An HTTP error whose body has started but never ends (until cancelled or errored). */
function stalledError() {
    const s = manualStream({ status: 401, statusText: 'Unauthorized', contentType: 'application/json' });
    s.push('{"error": {"message": "never fini');
    return s;
}

k.test('error-body-stalled', 'an HTTP error whose body never arrives: after 5 s the error with its status, the body cancelled', async (t) => {
    const timers = fakeTime(t);
    const s = stalledError();
    net.expect(MSG_URL, () => s.response);
    const t0 = Date.now();
    const turn = startTurn(w, 'q');
    await assert.rejects(drive(turn.done, timers));
    assert.equal(Date.now() - t0, 5000, 'the read gave up after 5 s');
    assert.equal(s.cancelled, true, 'the body was cancelled');
    const errs = errorOf(turn);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].payload, FAILED + ': 401 Unauthorized, Detail: Unauthorized', 'the statusText stands in for the detail');
    assert.equal(errs[0].rateLimited, false);
    assert.equal(turn.posted().some(m => m.type === 'requestAborted'), false);
});

k.test('stop-during-error-body', 'Stop while the body of an HTTP error is read: requestAborted, no error', async (t) => {
    fakeTime(t);   // no timer ever fires: the turn must end on the Stop alone
    const s = stalledError();
    net.expect(MSG_URL, () => s.response);
    const turn = startTurn(w, 'q');
    await until(() => net.calls.length === 1, 'the request');
    await flush();   // the response is in, its body being read
    await w.send({ type: 'stop' });
    await turn.done;
    assert.ok(turn.posted().some(m => m.type === 'requestAborted'));
    assert.deepEqual(errorOf(turn), []);
    assert.equal(s.cancelled, true, 'the body was cancelled');
    // history-after-errors, at the end of the file, checks that 'q' left the history.
});

k.test('history-after-errors', 'failed turns leave nothing in the history: no failed question, no partial answer', async () => {
    net.expect(MSG_URL, () => streamResponse([wire(FX.stream_text.events)]));
    const t = startTurn(w, 'After the errors');
    await t.done;
    const msgs = net.calls[0].json().messages;
    assert.deepEqual(msgs.at(-1), { role: 'user', content: 'After the errors' });
    assert.equal(msgs.filter(m => m.role === 'user' && m.content === 'q').length, 0, 'no failed question resent');
    assert.equal(msgs.some(m => m.role === 'assistant' && m.content === 'Hello'), false, 'no partial answer');
    msgs.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant', 'roles alternate at ' + i));
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
