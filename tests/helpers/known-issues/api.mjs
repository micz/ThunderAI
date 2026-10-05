/*
 *  Known issues of the api area: assertions written from spec 04 (API integrations) that the
 *  shipped code contradicts today. How they run (TODO while failing, "stale" once passing) is the
 *  core mechanism, ../core/known-issues.mjs; this file holds the entries, their shape, and
 *  caseTests(), the one way a test of the area is declared.
 *
 *  Every test of the area has a CASE ID, unique in its file, so a known issue names exactly one
 *  test. Most files of the area are about one provider and one spec section, so the shape is
 *  "a test file × a case id", and the REASON carries the section and the provider:
 *
 *      KNOWN = { '<file stem>': { '<case id>': REASONS.<name> } }
 *
 *   - a file stem is the name of a file in tests/api/ without `.test.mjs`;
 *   - a case id is a non-empty slug, never '*' nor a pattern: a catch-all would hide every later
 *     failure of the file at once;
 *   - a reason is one of REASONS, a string of the form
 *         spec 04 "<section>" [<provider>]: <what the spec says>; <what the code does>
 *     where <provider> is one of PROVIDERS ('shared' for the code every provider runs:
 *     api-retry.js, mzta-api-usage.js, usage-emitter.js, mzta-special-commands.js).
 *  validateKnown() enforces this; tests/api/99-harness-known-issues runs it.
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

const FILE = 'tests/helpers/known-issues/api.mjs';
const AREA_DIR = new URL('../../api/', import.meta.url);

export const PROVIDERS = ['anthropic', 'google_gemini', 'ollama', 'openai_comp', 'openai_responses', 'shared'];

const REASON_RE = /^spec 04 "[^"]+" \[([a-z_]+)\]: \S/;

/** The reasons of KNOWN, one per spec contradiction. */
export const REASONS = {
};

/** The known issues, by test file and case id. */
export const KNOWN = {
};

/** The file stems of tests/api/ (the files a KNOWN entry may name). */
export function areaFiles() {
    return readdirSync(fileURLToPath(AREA_DIR))
        .filter(f => f.endsWith('.test.mjs'))
        .map(f => f.slice(0, -'.test.mjs'.length));
}

/** The problems with one reason string, as strings; [] when it is well formed. */
export function reasonProblems(reason) {
    if (typeof reason !== 'string' || reason.trim() === '') return ['no reason'];
    const m = REASON_RE.exec(reason);
    if (!m) return ['the reason is not `spec 04 "<section>" [<provider>]: ...`'];
    if (!PROVIDERS.includes(m[1])) return ['unknown provider [' + m[1] + ']'];
    return [];
}

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known, files = areaFiles()) {
    const problems = [];
    if (!known || typeof known !== 'object' || Array.isArray(known)) return ['KNOWN must be an object'];
    const reasons = new Set(Object.values(REASONS));
    for (const [file, cases] of Object.entries(known)) {
        if (!files.includes(file)) { problems.push(`${file}: no such test file in tests/api/`); continue; }
        if (!cases || typeof cases !== 'object' || Array.isArray(cases)) {
            problems.push(`${file}: must be an object {case id: reason}`);
            continue;
        }
        for (const [id, reason] of Object.entries(cases)) {
            const at = `${file}.${id}`;
            if (id.trim() === '') problems.push(`${file}: an empty case id`);
            else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`${at}: a case id names one test, never a pattern`);
            const rp = reasonProblems(reason);
            if (rp.length) problems.push(...rp.map(p => at + ': ' + p));
            else if (known === KNOWN && !reasons.has(reason)) problems.push(at + ': the reason is not one of REASONS');
        }
    }
    return problems;
}

/**
 * The test declarer of one file of the area.
 *
 *   const k = caseTests('20-anthropic-request', { wrap: net.guard.bind(net) });
 *   k.test('case-id', 'what the spec says', async (t) => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails
 * the run once it passes. `wrap` decorates every test function (the fetch model's guard()). A
 * case id declared twice in a file throws at load.
 */
export function caseTests(file, { known = KNOWN, wrap = fn => fn } = {}) {
    const entries = known[file] || {};
    const declared = new Set();
    return {
        test(id, name, fn) {
            if (declared.has(id)) throw new Error(`caseTests(${file}): case "${id}" declared twice`);
            declared.add(id);
            return knownTest(`[${id}] ${name}`, entries[id], wrap(fn), { file: FILE });
        },
        coverage() {
            test(`${file}: every known issue names a case this file declares`, () => {
                const orphans = Object.keys(entries).filter(id => !declared.has(id));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN['${file}'] in ${FILE}`);
            });
        },
    };
}
