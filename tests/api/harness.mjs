/*
 *  The area's entry point for a test file: the fetch model, the known-issue declarer, the
 *  console capture and the timer control, wired together.
 *
 *      const { k, net, con } = areaFile('20-anthropic-request');
 *      k.test('case-id', 'what spec 04 says', async (t) => { ... });
 *      k.coverage();
 *
 *  - `net` is the fetch model (fetch-model.mjs), installed on globalThis for the whole file; every
 *    k.test() runs inside net.guard(): an unscripted call fails it at once, and so does a scripted
 *    answer left unconsumed;
 *  - `con` is the core console capture (taLogger writes through console.*), cleared before each
 *    test; TEST_VERBOSE=1 prints it too;
 *  - fakeTime(t) puts the test on node:test's mock timers (setTimeout and Date), so a retry
 *    backoff, a Retry-After or a per-attempt timeout costs no real time; mock.timers is scoped
 *    to the test (t.mock) and restored when it ends. Math.random is pinned for the test too.
 *
 *  Nothing here installs a `browser` global: worker files must stay free of one, and the files
 *  that need the WebExtension mock (a background context) install it themselves.
 */

import {
    after,
    beforeEach
} from 'node:test';
import { captureConsole } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/api.mjs';
import { installFetchModel } from './fetch-model.mjs';

export function areaFile(file) {
    const net = installFetchModel();
    const con = captureConsole();
    beforeEach(() => con.clear());
    after(() => {
        net.restore();
        con.restore();
    });
    const k = caseTests(file, { wrap: fn => net.guard(fn) });
    return { k, net, con };
}

/**
 * Mock setTimeout and Date for the rest of test `t` (released when it ends), starting at `now`,
 * and pin Math.random to `random` (0 = the low end of the jitter).
 */
export function fakeTime(t, { now = Date.UTC(2026, 0, 1), random = 0.5 } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
    t.mock.method(Math, 'random', () => random);
    return t.mock.timers;
}

/**
 * Drive a promise that waits on mocked timers: let the microtasks run, then fire the next timer,
 * until the promise settles. Returns its value (or throws its error).
 */
export async function drive(promise, timers, { maxSteps = 200 } = {}) {
    let done = false;
    let value;
    let error;
    let failed = false;
    promise.then(v => { done = true; value = v; }, e => { done = true; failed = true; error = e; });
    for (let i = 0; i < maxSteps && !done; i++) {
        for (let j = 0; j < 10 && !done; j++) await new Promise(r => setImmediate(r));
        if (!done) timers.runAll();
    }
    if (!done) throw new Error('drive(): the promise did not settle after ' + maxSteps + ' timer steps');
    if (failed) throw error;
    return value;
}

/** Every console line captured so far, joined (for "this secret never appears" checks). */
export function consoleText(con) {
    return con.entries.map(e => e.level + ': ' + e.msg).join('\n');
}
