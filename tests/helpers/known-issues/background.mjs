/*
 *  Known issues of the background area: assertions written from the spec of what the add-on does
 *  on its own, with no page open (spec 01 "Data Flow" sections, "Per-message pipelines in
 *  processEmails()", "In-flight jobs (taJobRegistry)", "Batch cancellation (taBatchController)",
 *  "Background Preference Snapshot and Menu Invalidation", "Per-Message Data Storage"; spec 02
 *  "Menu System"; spec 04 "Worker Lifecycle & Timeout", "Thinking in special commands", "Batch
 *  cancellation (user-triggered stop)") that the shipped code contradicts today. How they run (TODO
 *  while failing, "stale" once passing) is the core mechanism, ../core/known-issues.mjs; this file
 *  holds the entries, their shape, and caseTests(), the one way a test of the area is declared.
 *
 *  Every test of the area has a CASE ID, unique in its file, so a known issue names exactly one
 *  test. The shape is "a test file × a case id":
 *
 *      KNOWN = { '<file stem>': { '<case id>': REASONS.<name> } }
 *
 *   - a file stem is the name of a file in tests/background/ without `.test.mjs`
 *     ('20-receive-summary');
 *   - a case id is a non-empty slug, never '*' nor a pattern: a catch-all would hide every later
 *     failure of the file at once;
 *   - a reason is one of REASONS: a non-empty string naming the spec section it contradicts
 *     (`spec 01 "..."`, any of spec 01-08) and what the code does instead.
 *  validateKnown() enforces this; tests/background/99-harness-known-issues runs it.
 *
 *  Each test file ends with caseTests().coverage(): a test that fails on an entry of KNOWN naming
 *  a case id the file never declared, so an entry cannot outlive the test it was written for.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/background.mjs';
const AREA_DIR = new URL('../../background/', import.meta.url);
const SPEC_REF = /\bspec 0[1-8][a-c]? "[^"]+"/;

/** The reasons of KNOWN, one per spec contradiction. */
export const REASONS = {
};

/** The known issues, by test file and case id. */
export const KNOWN = {
};

/** The file stems of tests/background/ (the files a KNOWN entry may name). */
export function areaFiles() {
    return readdirSync(fileURLToPath(AREA_DIR))
        .filter(f => f.endsWith('.test.mjs'))
        .map(f => f.slice(0, -'.test.mjs'.length));
}

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known, files = areaFiles()) {
    const problems = [];
    if (!known || typeof known !== 'object' || Array.isArray(known)) return ['KNOWN must be an object'];
    const reasons = new Set(Object.values(REASONS));
    for (const [file, cases] of Object.entries(known)) {
        if (!files.includes(file)) { problems.push(`${file}: no such test file in tests/background/`); continue; }
        if (!cases || typeof cases !== 'object' || Array.isArray(cases)) {
            problems.push(`${file}: must be an object {case id: reason}`);
            continue;
        }
        for (const [id, reason] of Object.entries(cases)) {
            const at = `${file}.${id}`;
            if (id.trim() === '') problems.push(`${file}: an empty case id`);
            else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`${at}: a case id names one test, never a pattern`);
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(at + ': no reason');
            else if (!SPEC_REF.test(reason)) {
                problems.push(at + ': the reason names no spec section (spec 0N "...")');
            } else if (known === KNOWN && !reasons.has(reason)) {
                problems.push(at + ': the reason is not one of REASONS');
            }
        }
    }
    return problems;
}

/** The spec-reference pattern a reason must contain (for the harness test). */
export const REASON_PATTERN = SPEC_REF;

/**
 * The test declarer of one file of the area.
 *
 *   const k = caseTests('01-job-registry');
 *   k.test('case-id', 'what the spec says', async () => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails
 * the run once it passes. A case id declared twice in a file throws at load.
 */
export function caseTests(file, known = KNOWN) {
    const entries = known[file] || {};
    const declared = new Set();
    return {
        test(id, name, fn) {
            if (declared.has(id)) throw new Error(`caseTests(${file}): case "${id}" declared twice`);
            declared.add(id);
            return knownTest(`[${id}] ${name}`, entries[id], fn, { file: FILE });
        },
        coverage() {
            test(`${file}: every known issue names a case this file declares`, () => {
                const orphans = Object.keys(entries).filter(id => !declared.has(id));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN['${file}'] in ${FILE}`);
            });
        },
    };
}
