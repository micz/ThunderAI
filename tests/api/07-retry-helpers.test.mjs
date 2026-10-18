// Spec 04 "Automatic Retry Handling", the pure parts of js/api/api-retry.js:
//  - RETRYABLE_STATUSES = 408, 429, 500, 502, 503, 504, 529;
//  - RETRY_DEFAULTS: maxRetries 5, retryDelaysMs [5000, 10000, 20000, 30000], retryAfterCapMs
//    60000, timeoutMs 60000;
//  - parseRetryAfter(): the delta-seconds and the HTTP-date form, clamped at 0; fetchWithRetry
//    calls it with no upper cap (so the function takes one);
//  - classifyRateLimitBody(): OpenAI (and compatible) error.code "insufficient_quota" is terminal,
//    "rate_limit_exceeded" stays retryable; Anthropic error.details.error_code
//    "enforced_spend_limit_reached" is terminal; Gemini a google.rpc.QuotaFailure whose
//    violations[].quotaId contains PerDay/Daily is terminal even with its short RetryInfo (the
//    quotaId decides, not the delay); otherwise Gemini's RetryInfo.retryDelay ("34s") is the
//    wait; an array-wrapped Gemini body is accepted; an unrecognised body is retried;
//  - "Logging": extractErrorMessage() takes error.message (also array-wrapped), a string error
//    (Ollama), a top-level message, otherwise the raw text, whitespace collapsed, cut at 500
//    characters.
// Worker-safe: no browser here.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import {
    apiFixture,
    capturedEntry
} from './wire.mjs';

assertNoBrowser();
const { k } = areaFile('07-retry-helpers');
const {
    RETRYABLE_STATUSES,
    RETRY_DEFAULTS,
    parseRetryAfter,
    classifyRateLimitBody,
    extractErrorMessage,
} = await import('../../js/api/api-retry.js');

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const httpDate = ms => new Date(ms).toUTCString();

k.test('statuses', 'RETRYABLE_STATUSES is exactly 408, 429, 500, 502, 503, 504, 529', () => {
    assert.deepEqual([...RETRYABLE_STATUSES].sort((a, b) => a - b), [408, 429, 500, 502, 503, 504, 529]);
});

k.test('defaults', 'RETRY_DEFAULTS', () => {
    assert.equal(RETRY_DEFAULTS.maxRetries, 5);
    assert.deepEqual(RETRY_DEFAULTS.retryDelaysMs, [5000, 10000, 20000, 30000]);
    assert.equal(RETRY_DEFAULTS.retryAfterCapMs, 60000);
    assert.equal(RETRY_DEFAULTS.timeoutMs, 60000);
});

// ---- parseRetryAfter ------------------------------------------------------------------------

k.test('ra-delta', 'delta-seconds', () => {
    assert.equal(parseRetryAfter('7', Infinity), 7000);
    assert.equal(parseRetryAfter(' 12 ', Infinity), 12000);
    assert.equal(parseRetryAfter('0', Infinity), 0);
});

k.test('ra-date', 'HTTP-date: the time from now', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    assert.equal(parseRetryAfter(httpDate(NOW + 30000), Infinity), 30000);
});

k.test('ra-date-past', 'an HTTP-date in the past is clamped at 0', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    assert.equal(parseRetryAfter(httpDate(NOW - 3600000), Infinity), 0);
});

k.test('ra-absent', 'absent or empty: null', () => {
    assert.equal(parseRetryAfter(null, Infinity), null);
    assert.equal(parseRetryAfter(undefined, Infinity), null);
    assert.equal(parseRetryAfter('', Infinity), null);
    assert.equal(parseRetryAfter('   ', Infinity), null);
});

k.test('ra-garbage', 'a value in neither form: null', () => {
    assert.equal(parseRetryAfter('soon', Infinity), null);
    assert.equal(parseRetryAfter('in a minute', Infinity), null);
});

k.test('ra-no-cap', 'with no upper cap a long wait is returned whole (the caller decides)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    assert.equal(parseRetryAfter('3600', Infinity), 3600000);
    assert.equal(parseRetryAfter(httpDate(NOW + 7200000), Infinity), 7200000);
});

k.test('ra-cap', 'with an upper cap the wait is clamped to it', () => {
    assert.equal(parseRetryAfter('3600', 60000), 60000);
    assert.equal(parseRetryAfter('30', 60000), 30000);
});

// ---- classifyRateLimitBody ------------------------------------------------------------------

const OA = apiFixture('openai_responses.json');
const AN = apiFixture('anthropic.json');
const GE = apiFixture('google_gemini.json');

k.test('cls-openai-quota', 'OpenAI insufficient_quota is terminal', () => {
    assert.equal(classifyRateLimitBody(OA.error_429_insufficient_quota.body).terminal, true);
});

k.test('cls-openai-rate', 'OpenAI rate_limit_exceeded stays retryable', () => {
    assert.equal(classifyRateLimitBody(OA.error_429_rate_limit.body).terminal, false);
});

k.test('cls-anthropic-spend', 'Anthropic enforced_spend_limit_reached is terminal', () => {
    assert.equal(classifyRateLimitBody(AN.error_429_spend_limit.body).terminal, true);
});

k.test('cls-anthropic-rate', 'Anthropic rate_limit_error alone stays retryable', () => {
    assert.equal(classifyRateLimitBody(AN.error_429_rate_limit.body).terminal, false);
});

k.test('cls-gemini-daily', 'Gemini daily quota is terminal although it carries a 34 s RetryInfo', () => {
    assert.equal(classifyRateLimitBody(GE.error_429_daily.body).terminal, true);
});

k.test('cls-gemini-minute', 'Gemini per-minute quota: retryable, and RetryInfo "34s" is the wait', () => {
    const r = classifyRateLimitBody(GE.error_429_minute.body);
    assert.equal(r.terminal, false);
    assert.equal(r.retryAfterMs, 34000);
});

k.test('cls-gemini-array', 'an array-wrapped Gemini body is accepted', () => {
    assert.equal(classifyRateLimitBody([GE.error_429_daily.body]).terminal, true);
    assert.equal(classifyRateLimitBody([GE.error_429_minute.body]).retryAfterMs, 34000);
});

k.test('cls-unrecognised', 'an unrecognised body is not terminal and gives no wait', () => {
    for (const body of [null, {}, 'text', [], { error: 'string' }, AN.error_529.body, GE.error_400_key.body]) {
        const r = classifyRateLimitBody(body);
        assert.equal(r.terminal, false, JSON.stringify(body));
        assert.equal(r.retryAfterMs, null, JSON.stringify(body));
    }
});

// ---- extractErrorMessage --------------------------------------------------------------------

k.test('msg-error-message', 'error.message (OpenAI, Anthropic, Gemini - the captured 503)', () => {
    const body = capturedEntry('gemini-503-retry-then-stream.txt', 'response body: ');
    assert.equal(extractErrorMessage(body),
        'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.');
    assert.equal(extractErrorMessage(JSON.stringify(AN.error_529.body)), 'Overloaded');
});

k.test('msg-array', 'array-wrapped error.message', () => {
    assert.equal(extractErrorMessage(JSON.stringify([GE.error_400_key.body])), 'API key not valid. Please pass a valid API key.');
});

k.test('msg-string-error', 'a string error (Ollama)', () => {
    assert.equal(extractErrorMessage(JSON.stringify(apiFixture('ollama.json').error_404_model.body)),
        'model "llama3.9" not found, try pulling it first');
});

k.test('msg-top-level', 'a top-level message', () => {
    assert.equal(extractErrorMessage('{"message": "Bad gateway upstream"}'), 'Bad gateway upstream');
});

k.test('msg-raw', 'otherwise the raw text, whitespace collapsed', () => {
    assert.equal(extractErrorMessage('<html>\n  <body>\n\t502   Bad Gateway\n</body></html>'), '<html> <body> 502 Bad Gateway </body></html>');
});

k.test('msg-cut', 'cut at 500 characters', () => {
    const long = 'x'.repeat(480) + 'TAIL-' + 'y'.repeat(100);
    const out = extractErrorMessage(long);
    assert.equal(out.slice(0, 500), long.slice(0, 500));
    assert.equal(out.includes('y'.repeat(20)), false, 'nothing past character 500 survives');
});

k.coverage();
