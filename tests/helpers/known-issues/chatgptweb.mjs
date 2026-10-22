/*
 *  Known issues of the chatgptweb area: assertions written from the specs about the ChatGPT Web
 *  integration (the loader js/mzta-chatgpt-loader.js, the content script js/mzta-chatgpt.js and the
 *  pre-script mzta-background.js injects in front of it, the extended model check option on the
 *  connection panel), which the shipped code contradicts today. How they run (TODO while failing,
 *  "stale" once passing) is the core mechanism, ../core/known-issues.mjs; this file holds the
 *  entries, their shape, and chatgptwebTests(), the one way a DOM test of the area is declared.
 *
 *  The area's DOM files are tests/dom/<page>/chatgptweb-NN-<scenario>.dom.mjs, in any page folder
 *  (the ChatGPT page is tests/dom/chatgpt/, the option is on tests/dom/options/), and NN is unique
 *  across the area. Every test names the spec section it checks. The shape is "a spec section × a
 *  case id":
 *
 *      KNOWN = { 'spec NN "<section>"': { 'NN-<case>': '<what the code does>' } }
 *
 *   - a section is `spec NN "<section title>"`, the section the test was written from;
 *   - a case id is `NN-<slug>`: NN is the number of the chatgptweb-NN- file that declares it (so an
 *     entry names exactly one test of one file), the slug is a non-empty slug, never '*' nor a
 *     pattern: a catch-all would hide every later failure of the file at once;
 *   - the value is the reason: what the spec says and what the code does instead.
 *  validateKnown() enforces this; tests/chatgptweb/99-harness-known-issues runs it.
 *
 *  Each DOM file ends with chatgptwebTests().coverage(): a test that fails on an entry of KNOWN
 *  naming a case of that file the file never declared (or declared under another section), so an
 *  entry cannot outlive the test it was written for.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/chatgptweb.mjs';
const DOM_DIR = new URL('../../dom/', import.meta.url);

// A section title may hold quotes and backticks itself.
const SECTION_RE = /^spec \d\d ".+"$/;
const CASE_RE = /^(\d\d)-[a-z0-9][a-z0-9-]*$/;
const FILE_RE = /^chatgptweb-(\d\d)-.+\.dom\.mjs$/;

/** The known issues, by spec section and case id. */
export const KNOWN = {
    'spec 04 "Model verification"': {
        '04-retry-timeout-button': 'a timeout shows the warning and the "Use the current model" button, '
            + 'on every check; but when no composer was found (-2), proceedWithPrompt() writes '
            + 'chatgpt_textarea_not_found_error into #mzta-model_warn with textContent, which removes its '
            + 'child #mzta-btn_model. A check that times out on the retry then shows that text and no '
            + 'button: the user cannot resume',
    },
};

/** The chatgptweb-NN- files of every tests/dom/<page>/ folder: [{nn, path}], path from tests/dom/. */
export function areaDomFiles() {
    let pages;
    try { pages = readdirSync(fileURLToPath(DOM_DIR), { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const page of pages.filter(d => d.isDirectory())) {
        for (const f of readdirSync(fileURLToPath(new URL(page.name + '/', DOM_DIR)))) {
            const m = FILE_RE.exec(f);
            if (m) out.push({ nn: m[1], path: page.name + '/' + f });
        }
    }
    return out;
}

/** [the NN of each chatgptweb-NN- file]. */
export function areaFiles() {
    return areaDomFiles().map(f => f.nn);
}

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known, files = areaFiles()) {
    const problems = [];
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(known)) return ['KNOWN must be an object'];
    const seen = new Set();
    for (const [section, cases] of Object.entries(known)) {
        if (!SECTION_RE.test(section)) problems.push(`${section}: a section is \`spec NN "<section>"\``);
        if (!isObj(cases)) { problems.push(`${section}: must be an object {case id: reason}`); continue; }
        for (const [id, reason] of Object.entries(cases)) {
            const m = CASE_RE.exec(id);
            if (!m) problems.push(`${section}.${id}: a case id is NN-<slug> and names one test, never a pattern`);
            else if (!files.includes(m[1])) problems.push(`${section}.${id}: no chatgptweb-${m[1]}- file in tests/dom/<page>/`);
            if (seen.has(id)) problems.push(`${id}: listed under two sections`);
            seen.add(id);
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(`${section}.${id}: no reason`);
        }
    }
    return problems;
}

/** Two files of the area sharing one NN, as strings; [] when every NN names one file. */
export function duplicateNumbers(files = areaDomFiles()) {
    const byNn = new Map();
    for (const f of files) byNn.set(f.nn, [...(byNn.get(f.nn) || []), f.path]);
    return [...byNn].filter(([, paths]) => paths.length > 1).map(([nn, paths]) => `${nn}: ${paths.join(', ')}`);
}

/**
 * The test declarer of one DOM file of the area.
 *
 *   const k = chatgptwebTests('02');
 *   k.test('case-slug', 'spec 04 "Model verification"', 'what the spec says', async () => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails the
 * run once it passes. A case declared twice in a file, or a section not of the form
 * `spec NN "<section>"`, throws at load.
 */
export function chatgptwebTests(nn, { known = KNOWN } = {}) {
    const declared = new Map();     // case id -> its section
    return {
        test(slug, section, name, fn) {
            const id = `${nn}-${slug}`;
            if (!CASE_RE.test(id)) throw new Error(`chatgptwebTests(${nn}): bad case id "${id}"`);
            if (!SECTION_RE.test(section)) throw new Error(`chatgptwebTests(${nn}): bad section ${section}`);
            if (declared.has(id)) throw new Error(`chatgptwebTests(${nn}): case "${id}" declared twice`);
            declared.set(id, section);
            const reason = known[section]?.[id];
            return knownTest(`[${id}] ${section}: ${name}`,
                reason ? `${section}: ${reason}` : undefined, fn, { file: FILE });
        },
        coverage() {
            test(`chatgptweb-${nn}: every known issue names a case this file declares`, () => {
                const orphans = Object.entries(known).flatMap(([section, cases]) =>
                    Object.keys(cases)
                        .filter(id => id.startsWith(nn + '-') && declared.get(id) !== section)
                        .map(id => `${section} ${id}`));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN in ${FILE}`);
            });
        },
    };
}
