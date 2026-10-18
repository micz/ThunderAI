// The harness itself, not the spec: the controlled clock the ChatGPT Web scripts run on
// (./fake-clock.mjs), and the cut of the pre-script (./pre-script.mjs). The timing tests of the area
// (2 s, 15 s, 14999 ms) are only as good as these.
//
// Level 1: nothing imported here reaches jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createClock,
    flush
} from './fake-clock.mjs';
import { preScriptSource } from './pre-script.mjs';

test('a timeout runs once, at its time and not a millisecond before', async () => {
    const c = createClock();
    const runs = [];
    c.globals.setTimeout(() => runs.push(c.now()), 2000);
    await c.advance(1999);
    assert.deepEqual(runs, []);
    await c.advance(1);
    assert.deepEqual(runs, [2000]);
    await c.advance(5000);
    assert.deepEqual(runs, [2000]);
    assert.deepEqual(c.pending(), []);
});

test('an interval repeats until cleared; callbacks run in time order, ties in creation order', async () => {
    const c = createClock();
    const runs = [];
    const id = c.globals.setInterval(function poll() { runs.push('poll@' + c.now()); }, 200);
    c.globals.setTimeout(() => runs.push('a@' + c.now()), 400);
    c.globals.setTimeout(() => runs.push('b@' + c.now()), 400);
    await c.advance(600);
    assert.deepEqual(runs, ['poll@200', 'poll@400', 'a@400', 'b@400', 'poll@600']);
    assert.deepEqual(c.pending().map(p => [p.kind, p.delay, p.name]), [['interval', 200, 'poll']]);
    c.globals.clearInterval(id);
    assert.deepEqual(c.pending(), []);
});

test('a promise a callback resolves runs before the next callback fires', async () => {
    const c = createClock();
    const runs = [];
    c.globals.setTimeout(() => Promise.resolve().then(() => runs.push('then')), 100);
    c.globals.setTimeout(() => runs.push('next'), 100);
    await c.advance(100);
    assert.deepEqual(runs, ['then', 'next']);
});

test('Date.now() and performance.now() read the clock; a throwing callback is recorded', async () => {
    const c = createClock({ start: 5 });
    assert.equal(c.globals.Date.now(), 5);
    assert.equal(c.globals.performance.now(), 5);
    assert.equal(new c.globals.Date().getTime(), 5);
    c.globals.setTimeout(() => { throw new Error('boom'); }, 10);
    await c.advance(10);
    await flush();
    assert.equal(c.errors.length, 1);
    assert.equal(c.globals.Date.now(), 15);
});

test('the pre-script cut is the whole template, up to the semicolon that ends the statement', () => {
    const text = preScriptSource();
    assert.match(text, /^`let mztaWinId = `/);
    assert.ok(text.trimEnd().endsWith('`'), text.slice(-80));
    assert.match(text, /let mztaLoadWaitMs=/);
});
