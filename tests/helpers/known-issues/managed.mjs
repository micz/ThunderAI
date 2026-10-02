/*
 *  Known issues of the managed configuration: assertions that contradict spec 08 against the
 *  shipped code as it is. How they run (TODO while failing, "stale" once passing) is the core
 *  mechanism, ../core/known-issues.mjs; this file holds the entries and their shape.
 *
 *  Shape, for the sweeps: { page: { locked: {key: {aspect: reason}}, unlocked: {...} } }.
 *   - a per-key aspect names its key: there is no '*' fallback, which would hide every key of
 *     the page at once;
 *   - '*' is only for the page-wide aspect 'writes' (the write-guard test of the locked sweep);
 *   - 'harness' (the page ran on modelled APIs only) is never a known issue: it is the harness's
 *     own correctness, and a page it cannot run must fail.
 *  validateKnown() enforces this; tests/managed/99-harness-known-issues runs it.
 *
 *  Other test files import the named reasons directly and run their test through knownTest()
 *  (../dom-known-issues.mjs, which names this file when an entry goes stale).
 *
 *  No jsdom here, so level 1 can import it.
 */

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
