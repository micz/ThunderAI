/*
 *  Known issues: potential bugs a test found, run as node:test TODOs.
 *
 *  Tests are written from the spec. A test that fails against the shipped code is NOT changed
 *  to pass, and neither is the source: the failing assertion still runs, and is reported as a
 *  node:test TODO carrying its reason, so it shows up in every run ("# TODO") without turning
 *  CI red, until the maintainer fixes the code or rules the behaviour correct (and then updates
 *  the spec).
 *
 *  A known issue whose test PASSES fails the run ("stale known issue"): remove its entry. So an
 *  entry can never outlive its bug and go on hiding a later regression of the same test.
 *
 *  This is only the mechanism. The entries belong to their area, one file each:
 *  tests/helpers/known-issues/<area>.mjs, which also defines (and validates) their shape.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { test } from 'node:test';

/**
 * Run `fn` under a known-issue reason: 'todo' with the failure when it fails, 'stale' when it
 * passes, 'pass' when there is no reason (and it passed; a failure then simply throws).
 */
export async function runKnown(reason, fn, t) {
    if (!reason) { await fn(t); return { outcome: 'pass' }; }
    try {
        await fn(t);
    } catch (e) {
        return { outcome: 'todo', message: reason + ' -- ' + ((e && e.message) || String(e)) };
    }
    return { outcome: 'stale' };
}

/**
 * test(), with a known-issue reason (or none): see runKnown().
 *
 * @param {object} o
 *   file   the file that holds the entry, named by the "stale known issue" failure (an area's
 *          helpers pass their tests/helpers/known-issues/<area>.mjs)
 */
export function knownTest(name, reason, fn, { file = 'its tests/helpers/known-issues/<area>.mjs file' } = {}) {
    if (!reason) return test(name, fn);
    return test(name, async (t) => {
        const r = await runKnown(reason, fn, t);
        if (r.outcome === 'todo') { t.todo(r.message); return; }
        throw new Error('stale known issue, the test passes now: remove its entry from ' +
            file + ' ("' + reason + '")');
    });
}
