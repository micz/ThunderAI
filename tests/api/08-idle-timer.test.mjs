// Spec 04 "Stream idle timeout", the helper js/api/api-idle-timer.js on its own:
//  - resolveIdleTimeoutMs(): a non-negative number of ms (a string holding one accepted), 0 kept
//    (no idle timeout), anything else -> the default, 120000 ms (spec 05 api_stream_idle_timeout);
//  - createIdleTimer(): fires once after timeoutMs without a touch(), touch() pushes the deadline
//    back, stop() disarms it (a touch() after it does not re-arm it), 0 never fires;
//  - idleTimeoutReason(): a DOMException named IdleTimeoutError;
//  - userStopReason() / isUserStopReason(): a DOMException named StopError, and its check;
//  - idleTimeoutMessage(): error_stream_idle_timeout with $SECONDS$ filled in.
// Worker-safe: no browser global.

import assert from 'node:assert/strict';
import {
    areaFile,
    fakeTime
} from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';

assertNoBrowser();
const { k } = areaFile('08-idle-timer');
const {
    STREAM_IDLE_TIMEOUT_DEFAULT_MS,
    createIdleTimer,
    idleTimeoutMessage,
    idleTimeoutReason,
    isUserStopReason,
    resolveIdleTimeoutMs,
    userStopReason
} = await import('../../js/api/api-idle-timer.js');

k.test('default', 'the default is 120000 ms', () => {
    assert.equal(STREAM_IDLE_TIMEOUT_DEFAULT_MS, 120000);
});

k.test('resolve-valid', 'a non-negative number is kept (whole ms), 0 included; a numeric string is accepted', () => {
    assert.equal(resolveIdleTimeoutMs(5000), 5000);
    assert.equal(resolveIdleTimeoutMs(0), 0);
    assert.equal(resolveIdleTimeoutMs(1500.7), 1500);
    assert.equal(resolveIdleTimeoutMs('30000'), 30000);
    assert.equal(resolveIdleTimeoutMs(' 0 '), 0);
});

k.test('resolve-invalid', 'anything else falls back to the default', () => {
    for (const v of [undefined, null, '', '  ', 'abc', -1, '-5', NaN, Infinity, true, {}, []]) {
        assert.equal(resolveIdleTimeoutMs(v), 120000, String(v));
    }
});

k.test('fires-once', 'fires once, after timeoutMs without a touch', (t) => {
    const timers = fakeTime(t);
    let calls = 0;
    const idle = createIdleTimer(1000, () => calls++);
    idle.start();
    timers.tick(999);
    assert.equal(calls, 0);
    assert.equal(idle.fired, false);
    timers.tick(1);
    assert.equal(calls, 1);
    assert.equal(idle.fired, true);
    timers.tick(10000);
    assert.equal(calls, 1, 'never again');
    idle.touch();
    timers.tick(10000);
    assert.equal(calls, 1, 'a touch after it fired does not re-arm it');
});

k.test('touch', 'touch() pushes the deadline back by timeoutMs', (t) => {
    const timers = fakeTime(t);
    let calls = 0;
    const idle = createIdleTimer(1000, () => calls++);
    idle.start();
    for (let i = 0; i < 5; i++) {
        timers.tick(900);
        idle.touch();
    }
    assert.equal(calls, 0, '4.5 s with a touch every 0.9 s');
    timers.tick(1000);
    assert.equal(calls, 1);
});

k.test('stop', 'stop() disarms it, and a touch after it does not re-arm it', (t) => {
    const timers = fakeTime(t);
    let calls = 0;
    const idle = createIdleTimer(1000, () => calls++);
    idle.start();
    timers.tick(500);
    idle.stop();
    idle.touch();
    timers.tick(10000);
    assert.equal(calls, 0);
    assert.equal(idle.fired, false);
});

k.test('touch-before-start', 'a touch before start() arms nothing', (t) => {
    const timers = fakeTime(t);
    let calls = 0;
    const idle = createIdleTimer(1000, () => calls++);
    idle.touch();
    timers.tick(10000);
    assert.equal(calls, 0);
});

k.test('zero-disabled', '0 never fires', (t) => {
    const timers = fakeTime(t);
    let calls = 0;
    const idle = createIdleTimer(0, () => calls++);
    idle.start();
    idle.touch();
    timers.tick(3600000);
    assert.equal(calls, 0);
});

k.test('reason', 'the abort reason is a DOMException named IdleTimeoutError, never an AbortError', () => {
    const r = idleTimeoutReason(120000);
    assert.ok(r instanceof DOMException);
    assert.equal(r.name, 'IdleTimeoutError');
    assert.match(r.message, /120 s/);
});

k.test('stop-reason', 'the Stop reason is a DOMException named StopError, told apart from the idle reason and from a plain abort', () => {
    const r = userStopReason();
    assert.ok(r instanceof DOMException);
    assert.equal(r.name, 'StopError');
    assert.equal(isUserStopReason(r), true);
    assert.equal(isUserStopReason(idleTimeoutReason(120000)), false);
    const plain = new AbortController();
    plain.abort();
    assert.equal(isUserStopReason(plain.signal.reason), false, 'an AbortError');
    for (const v of [undefined, null, 'StopError', { name: 'StopError' }]) {
        assert.equal(isUserStopReason(v), false, String(v));
    }
});

k.test('message', 'the user text fills $SECONDS$ with the timeout in seconds; a missing string gives no "undefined"', () => {
    const strings = { error_stream_idle_timeout: 'No data for $SECONDS$ seconds' };
    assert.equal(idleTimeoutMessage(strings, 120000), 'No data for 120 seconds');
    assert.equal(idleTimeoutMessage(strings, 5000), 'No data for 5 seconds');
    assert.equal(idleTimeoutMessage({}, 5000), '');
    assert.equal(idleTimeoutMessage(null, 5000), '');
});

k.test('no-browser', 'no browser global was needed', () => {
    assertNoBrowser();
});

k.coverage();
