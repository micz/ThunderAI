/*
 *  Potential bugs found by the DOM tests: assertions that contradict spec 08 against the
 *  shipped code as it is. The tests are NOT changed to pass, and neither is the source: each
 *  failing assertion still runs, and is reported as a node:test TODO carrying the reason below,
 *  so it shows up in every run ("# TODO") without turning CI red, until the maintainer fixes the
 *  code or rules the behaviour correct (and then updates the spec).
 *
 *  A known issue whose test PASSES fails the run ("stale known issue"): remove its entry. So an
 *  entry can never outlive its bug and go on hiding a later regression of the same test.
 *
 *  Shape, for the sweeps: { page: { locked: {key: {aspect: reason}}, unlocked: {...} } }.
 *   - a per-key aspect names its key: there is no '*' fallback, which would hide every key of
 *     the page at once;
 *   - '*' is only for the page-wide aspect 'writes' (the write-guard test of the locked sweep);
 *   - 'harness' (the page ran on modelled APIs only) is never a known issue: it is the harness's
 *     own correctness, and a page it cannot run must fail.
 *  validateKnown() enforces this; tests/managed/99-harness-known-issues runs it.
 *
 *  Other test files import the named reasons directly and run their test through knownTest().
 *
 *  No jsdom here, so level 1 can import it.
 */

import { test } from 'node:test';

export const REASONS = {
};

export const KNOWN = {
};

const PER_KEY_ASPECTS = {
    locked: ['disabled', 'value', 'marker', 'companions', 'storage'],
    unlocked: ['value', 'editable'],
};
const PAGE_WIDE_ASPECTS = { locked: ['writes'], unlocked: [] };

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known) {
    const problems = [];
    for (const [page, sweeps] of Object.entries(known)) {
        for (const [sweep, keys] of Object.entries(sweeps || {})) {
            if (!PER_KEY_ASPECTS[sweep]) { problems.push(`${page}: unknown sweep "${sweep}"`); continue; }
            for (const [key, aspects] of Object.entries(keys || {})) {
                for (const [aspect, reason] of Object.entries(aspects || {})) {
                    const where = `${page}.${sweep}.${key}.${aspect}`;
                    if (typeof reason !== 'string' || reason.trim() === '') problems.push(where + ': no reason');
                    if (aspect === 'harness') problems.push(where + ': the harness check is never a known issue');
                    else if (key === '*' && !PAGE_WIDE_ASPECTS[sweep].includes(aspect)) {
                        problems.push(where + ': "*" is only for the page-wide aspect(s) ' +
                            JSON.stringify(PAGE_WIDE_ASPECTS[sweep]) + ', name the key');
                    } else if (key !== '*' && !PER_KEY_ASPECTS[sweep].includes(aspect)) {
                        problems.push(where + ': unknown aspect');
                    }
                }
            }
        }
    }
    return problems;
}

/** The known-issue reason for one key and aspect of a sweep, or undefined. No '*' fallback. */
export function todoFor(todo = {}, key, aspect) {
    return (todo[key] && todo[key][aspect]) || undefined;
}

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

/** test(), with a known-issue reason (or none): see runKnown(). */
export function knownTest(name, reason, fn) {
    if (!reason) return test(name, fn);
    return test(name, async (t) => {
        const r = await runKnown(reason, fn, t);
        if (r.outcome === 'todo') { t.todo(r.message); return; }
        throw new Error('stale known issue, the test passes now: remove its entry from ' +
            'tests/helpers/dom-known-issues.mjs ("' + reason + '")');
    });
}
