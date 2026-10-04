/*
 *  Known issues of the static area: what the repository as source contradicts in spec 05, spec 06
 *  or CLAUDE.md rule 7 today. How they run (TODO while failing, "stale" once passing) is the core
 *  mechanism, ../core/known-issues.mjs; this file holds the entries, their shape, and the way a
 *  static check turns into tests (declareCheck(), reportCheck()).
 *
 *  A static check finds violations, each about one SUBJECT: a message key ("menu_title"), a
 *  locale ("sk"), a key of a locale ("it:menu_title"), a preference key, a validation table entry
 *  ("PREF_ENUMS.reply_type"). So the shape is
 *
 *      KNOWN = { <check>: [ { reason, subjects: [<subject>, ...] }, ... ] }
 *
 *  one group per reason, every subject spelled out:
 *   - a check is one of CHECKS;
 *   - a reason is a non-empty string naming what it contradicts ("spec 06 ...", "CLAUDE.md rule
 *     7 ...") and what the code does instead;
 *   - a subject is a non-empty string, never '*' nor a pattern: a catch-all would hide every
 *     later violation of the check at once, which is exactly what a static check is for;
 *   - a subject appears once per check;
 *   - the check is a blocking one: an informational check (INFORMATIONAL) takes no known issues.
 *  validateKnown() enforces this; tests/static/99-harness-known-issues runs it.
 *
 *  Two kinds of check:
 *   - BLOCKING (declareCheck()): the spec states a rule the repository must keep at all times. A
 *     violation outside KNOWN fails the run at once; a group of KNOWN runs as one TODO (one line
 *     per reason, not one per key); a listed subject that no longer violates fails the run
 *     ("stale"), so the list only ever shrinks.
 *   - INFORMATIONAL (reportCheck()): the spec itself expects the violations for a while, and when
 *     they end depends on something outside this repository (Weblate syncing the translations
 *     from en, spec 06 "Removing a String"). Failing on them would turn every expected interval
 *     into a red run and two commits to this file; so the check lists its violations as test
 *     diagnostics and always passes, and takes no KNOWN entry.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/static.mjs';

/** Every check of the area, by the name its test file passes to declareCheck() or reportCheck(). */
export const CHECKS = [
    // 01-locales-files (spec 06)
    'locale-shape', 'en-description', 'placeholders', 'stale-key', 'lang-md',
    // 02-locales-references (spec 06)
    'missing-key', 'dead-key',
    // 03-prefs-references (spec 05, CLAUDE.md rule 7)
    'undeclared-pref',
    // 04-prefs-defaults (spec 05, spec 08, CLAUDE.md rule 7)
    'derivation', 'duplicate', 'orphan-rule', 'type-coherence', 'secret-name', 'secret-treatment',
];

/**
 * The checks of CHECKS that report and never fail (reportCheck()), so take no KNOWN entry.
 * stale-key: spec 06 "Removing a String" says the translations follow a key removed from en when
 * Weblate syncs from en, so a translation still holding it is a state the spec expects.
 */
export const INFORMATIONAL = ['stale-key'];

/** How many subjects reportCheck() lists before "and N more". */
const REPORT_MAX = 20;

/** The reasons of KNOWN, one per group: none today. */
export const REASONS = {};

/** The known issues of the blocking checks: none today, every check passes. */
export const KNOWN = {};

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known) {
    const problems = [];
    if (!known || typeof known !== 'object' || Array.isArray(known)) return ['KNOWN must be an object'];
    for (const [check, groups] of Object.entries(known)) {
        if (!CHECKS.includes(check)) { problems.push(`${check}: unknown check`); continue; }
        if (INFORMATIONAL.includes(check)) {
            problems.push(`${check}: an informational check takes no known issues (it reports, never fails)`);
            continue;
        }
        if (!Array.isArray(groups)) { problems.push(`${check}: must be an array of groups`); continue; }
        const seen = new Set();
        groups.forEach((group, g) => {
            const at = `${check}[${g}]`;
            if (!group || typeof group !== 'object') { problems.push(at + ': not a group'); return; }
            const { reason, subjects } = group;
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(at + ': no reason');
            else if (!/\bspec \d\d|CLAUDE\.md rule \d/.test(reason)) {
                problems.push(at + ': the reason names no spec section ("spec NN ..." or "CLAUDE.md rule N")');
            }
            if (!Array.isArray(subjects) || subjects.length === 0) { problems.push(at + ': no subjects'); return; }
            for (const s of subjects) {
                if (typeof s !== 'string' || s.trim() === '') problems.push(at + ': an empty subject');
                else if (/[*?]/.test(s)) problems.push(`${at}.${s}: a subject names one key or locale, never a pattern`);
                else if (seen.has(s)) problems.push(`${check}.${s}: listed twice`);
                else seen.add(s);
            }
        });
    }
    return problems;
}

/** {subject: reason} of one check. No fallback: an unlisted subject has no reason. */
export function knownFor(check, known = KNOWN) {
    const out = new Map();
    for (const { reason, subjects } of known[check] || []) for (const s of subjects) out.set(s, reason);
    return out;
}

/**
 * Declare the tests of one check from its violations, a Map {subject: detail} (the detail says
 * where, for the failure message):
 *
 *   "<title>"                          fails on any violation KNOWN does not list;
 *   "<title> [known: <reason>]"        one TODO per group of KNOWN, while a subject still violates;
 *                                      stale (fails) once none does;
 *   "<title>: every known issue still reproduces"   fails on a listed subject that no longer
 *                                      violates, naming it, so it is removed one at a time.
 */
export function declareCheck(check, title, violations, known = KNOWN) {
    if (!CHECKS.includes(check)) throw new Error('declareCheck: unknown check "' + check + '"');
    if (INFORMATIONAL.includes(check)) throw new Error('declareCheck: "' + check + '" is informational, use reportCheck()');
    const listed = knownFor(check, known);
    test(title, () => {
        const unexpected = [...violations].filter(([s]) => !listed.has(s)).map(([s, d]) => d ? `${s}: ${d}` : s);
        assert.deepEqual(unexpected, [], `${unexpected.length} violation(s) of "${check}"`);
    });
    const groups = known[check] || [];
    for (const { reason, subjects } of groups) {
        knownTest(`${title} [known: ${subjects.length} subject(s)]`, reason, () => {
            // A count, not the list: the list is right here, and 600 keys would bury the run.
            const still = subjects.filter(s => violations.has(s));
            assert.ok(still.length === 0, `${still.length} of ${subjects.length} still violate`);
        }, { file: FILE });
    }
    if (groups.length > 0) {
        test(`${title}: every known issue still reproduces`, () => {
            const stale = [...listed.keys()].filter(s => !violations.has(s));
            assert.deepEqual(stale, [], `stale known issue(s) of "${check}", remove them from ${FILE}`);
        });
    }
}

/**
 * Declare the one test of an informational check (INFORMATIONAL) from its violations, a Map
 * {subject: detail}. It always passes: it lists the violations as test diagnostics, one line per
 * subject up to REPORT_MAX, then "and N more", so a large Weblate sync does not bury the run. No
 * KNOWN, no TODO, no stale: the violations are expected by the spec, see INFORMATIONAL.
 */
export function reportCheck(check, title, violations) {
    if (!CHECKS.includes(check)) throw new Error('reportCheck: unknown check "' + check + '"');
    if (!INFORMATIONAL.includes(check)) throw new Error('reportCheck: "' + check + '" is blocking, use declareCheck()');
    test(title + ' (informational, never fails)', (t) => {
        t.diagnostic(`${violations.size} subject(s) reported by "${check}"`);
        const lines = [...violations].map(([s, d]) => d ? `${s}: ${d}` : s);
        for (const line of lines.slice(0, REPORT_MAX)) t.diagnostic(line);
        if (lines.length > REPORT_MAX) t.diagnostic(`and ${lines.length - REPORT_MAX} more`);
    });
}
