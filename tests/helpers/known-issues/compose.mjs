/*
 *  Known issues of the compose area: assertions written from the specs about what the add-on
 *  reads from a mail and writes into it (js/mzta-compose-script.js, the rich-text layer in
 *  js/lib/mzta-html-lines.js and js/mzta-utils.js) and about the message-display panels, which
 *  the shipped code contradicts today. How they run (TODO while failing, "stale" once passing) is
 *  the core mechanism, ../core/known-issues.mjs; this file holds the entries, their shape, and
 *  composeTests(), the one way a test of the area is declared.
 *
 *  The area's DOM files all live in tests/dom/compose/ (compose-NN-<scenario>.dom.mjs), and
 *  every test names the spec section it checks. The shape is "a spec section × a case id":
 *
 *      KNOWN = { 'spec NN "<section>"': { 'NN-<case>': '<what the code does>' } }
 *
 *   - a section is `spec NN "<section title>"`, the section the test was written from;
 *   - a case id is `NN-<slug>`: NN is the number of the compose-NN- file that declares it (so an
 *     entry names exactly one test of one file), the slug is a non-empty slug, never '*' nor a
 *     pattern: a catch-all would hide every later failure of the file at once;
 *   - the value is the reason: what the spec says and what the code does instead.
 *  validateKnown() enforces this; tests/compose/99-harness-known-issues runs it.
 *
 *  Each DOM file ends with composeTests().coverage(): a test that fails on an entry of KNOWN
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

const FILE = 'tests/helpers/known-issues/compose.mjs';
const DOM_DIR = new URL('../../dom/compose/', import.meta.url);

// A section title may hold quotes and backticks itself.
const SECTION_RE = /^spec \d\d ".+"$/;
const CASE_RE = /^(\d\d)-[a-z0-9][a-z0-9-]*$/;

const S_RICHTEXT = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';

const INJECTED_IN_TYPED = 'MZTA_INJECTED_SELECTORS lists the add-on\'s own elements so that they never reach a '
    + 'placeholder, and spec 03 defines {%mail_typed_text%} as the text typed in the compose window. '
    + 'getOnlyTypedText walks document.body.childNodes directly, not getCleanBodyHtml(), so the '
    + '#mzta-container a panel inserts at the top of the compose body is read as typed text (its '
    + '"[ThunderAI] ..." line and menu glyphs). Spec 01 records it as a known gap ("injected ThunderAI '
    + 'DOM ... can contaminate {%mail_typed_text%}").';

/** The known issues, by spec section and case id. */
export const KNOWN = {
    [S_RICHTEXT]: {
        '01-typed-skips-injected': INJECTED_IN_TYPED,
        '03-typed-without-signature': 'spec 03 defines {%mail_typed_text%} as the text typed so far; in a new '
            + 'message with no quote there is no moz-cite-prefix to stop the walk, so getOnlyTypedText '
            + 'appends the div.moz-signature ("--\\nThis is my best signature!!!") to the typed text. Spec 01 '
            + 'records it as a known gap ("the moz-signature can contaminate {%mail_typed_text%}").',
    },
};

/** [the NN of each compose-NN- file of tests/dom/compose/]. */
export function areaFiles() {
    let files;
    try { files = readdirSync(fileURLToPath(DOM_DIR)); } catch { return []; }
    return files.map(f => /^compose-(\d\d)-.+\.dom\.mjs$/.exec(f)).filter(Boolean).map(m => m[1]);
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
            else if (!files.includes(m[1])) problems.push(`${section}.${id}: no compose-${m[1]}- file in tests/dom/compose/`);
            if (seen.has(id)) problems.push(`${id}: listed under two sections`);
            seen.add(id);
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(`${section}.${id}: no reason`);
        }
    }
    return problems;
}

/**
 * The test declarer of one DOM file of the area.
 *
 *   const k = composeTests('05');
 *   k.test('case-slug', 'spec 01 "Writing into a plain text compose window"', 'what the spec says', async () => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails the
 * run once it passes. A case declared twice in a file, or a section not of the form
 * `spec NN "<section>"`, throws at load.
 */
export function composeTests(nn, { known = KNOWN } = {}) {
    const declared = new Map();     // case id -> its section
    return {
        test(slug, section, name, fn) {
            const id = `${nn}-${slug}`;
            if (!CASE_RE.test(id)) throw new Error(`composeTests(${nn}): bad case id "${id}"`);
            if (!SECTION_RE.test(section)) throw new Error(`composeTests(${nn}): bad section ${section}`);
            if (declared.has(id)) throw new Error(`composeTests(${nn}): case "${id}" declared twice`);
            declared.set(id, section);
            const reason = known[section]?.[id];
            return knownTest(`[${id}] ${section}: ${name}`,
                reason ? `${section}: ${reason}` : undefined, fn, { file: FILE });
        },
        coverage() {
            test(`compose-${nn}: every known issue names a case this file declares`, () => {
                const orphans = Object.entries(known).flatMap(([section, cases]) =>
                    Object.keys(cases)
                        .filter(id => id.startsWith(nn + '-') && declared.get(id) !== section)
                        .map(id => `${section} ${id}`));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN in ${FILE}`);
            });
        },
    };
}
