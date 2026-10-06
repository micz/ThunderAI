/*
 *  Known issues of the webchat area: assertions written from the specs about the API chat window
 *  (api_webchat/index.html) and its diff picker, which the shipped window contradicts today. How
 *  they run (TODO while failing, "stale" once passing) is the core mechanism,
 *  ../core/known-issues.mjs; this file holds the entries, their shape, and webchatTests(), the one
 *  way a test of the area is declared.
 *
 *  The area has one page, so its DOM files all live in tests/dom/webchat/
 *  (webchat-NN-<scenario>.dom.mjs), and every test names the spec section it checks. The shape is
 *  "a spec section × a case id":
 *
 *      KNOWN = { 'spec NN "<section>"': { 'NN-<case>': '<what the window does>' } }
 *
 *   - a section is `spec NN "<section title>"`, the section the test was written from;
 *   - a case id is `NN-<slug>`: NN is the number of the webchat-NN- file that declares it (so an
 *     entry names exactly one test of one file), the slug is a non-empty slug, never '*' nor a
 *     pattern: a catch-all would hide every later failure of the file at once;
 *   - the value is the reason: what the spec says and what the window does instead.
 *  validateKnown() enforces this; tests/webchat/99-harness-known-issues runs it.
 *
 *  Each DOM file ends with webchatTests().coverage(): a test that fails on an entry of KNOWN naming
 *  a case of that file the file never declared (or declared under another section), so an entry
 *  cannot outlive the test it was written for.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/webchat.mjs';
const DOM_DIR = new URL('../../dom/webchat/', import.meta.url);

// A section title may hold quotes itself (spec 04 'Live "Thinking…" indicator').
const SECTION_RE = /^spec \d\d ".+"$/;
const CASE_RE = /^(\d\d)-[a-z0-9][a-z0-9-]*$/;

/** The known issues, by spec section and case id. */
export const KNOWN = {
    'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"': {
        '10-copy-plain': 'Copy turns each <br> into a real newline. The answer is markdown-it output, which '
            + 'writes `<br>\\n`: htmlToPlainText() (api_webchat/messagesArea.js) turns the <br> into a newline '
            + 'AND keeps the source newline after it, so every line break of the answer is copied as a blank '
            + 'line ("Dear Bob,\\n\\nTom..."), indistinguishable from a paragraph break. stripHtmlKeepLines() '
            + 'consumes that newline for the same reason (spec 01 "Writing into a plain text compose window").',
    },
    'spec 07 "The `composeResult` invariant"': {
        ...Object.fromEntries(['words', 'sentences'].map(g => [`15-inv-reject-markup-only-${g}`,
            'a block whose words match but whose markup differs ("Dear <b>Sir</b>," vs "Dear Sir,") is '
            + 'a replace pair whose word diff finds no change: the block has no hunk the user can choose, '
            + 'contextSide() answers "new", and reject all returns the ANSWER\'s markup ("<p>Dear Sir,</p>") '
            + 'instead of renderBlocks(segmentBlocks(original)) ("<p>Dear <b>Sir</b>,</p>"). The spec says '
            + 'a markup-only difference "falls through to a replace pair, where both sides are kept and the '
            + 'user can choose".'])),
        ...Object.fromEntries(['br-lines', 'lists', 'tag-change', 'to-list'].flatMap(c => ['words', 'sentences']
            .map(g => [`15-inv-reject-${c}-${g}`,
                'a replace pair takes its wrapper from the ANSWER\'s block only (buildHunks() copies '
                + 'nb.tag / nb.listType into the composed block), so reject all puts the original\'s words '
                + 'in the answer\'s wrapper: <div> becomes <p>, <ul> becomes <ol>, <p> becomes <h2> or '
                + '<ul><li>, instead of renderBlocks(segmentBlocks(original)).']))),
    },
};

/** [the NN of each webchat-NN- file of tests/dom/webchat/]. */
export function areaFiles() {
    let files;
    try { files = readdirSync(fileURLToPath(DOM_DIR)); } catch { return []; }
    return files.map(f => /^webchat-(\d\d)-.+\.dom\.mjs$/.exec(f)).filter(Boolean).map(m => m[1]);
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
            else if (!files.includes(m[1])) problems.push(`${section}.${id}: no webchat-${m[1]}- file in tests/dom/webchat/`);
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
 *   const k = webchatTests('05');
 *   k.test('case-slug', 'spec 01 "Streaming data flow"', 'what the spec says', async () => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails the
 * run once it passes. A case declared twice in a file, or a section not of the form
 * `spec NN "<section>"`, throws at load.
 */
export function webchatTests(nn, { known = KNOWN } = {}) {
    const declared = new Map();     // case id -> its section
    return {
        test(slug, section, name, fn) {
            const id = `${nn}-${slug}`;
            if (!CASE_RE.test(id)) throw new Error(`webchatTests(${nn}): bad case id "${id}"`);
            if (!SECTION_RE.test(section)) throw new Error(`webchatTests(${nn}): bad section ${section}`);
            if (declared.has(id)) throw new Error(`webchatTests(${nn}): case "${id}" declared twice`);
            declared.set(id, section);
            const reason = known[section]?.[id];
            return knownTest(`[${id}] ${section}: ${name}`,
                reason ? `${section}: ${reason}` : undefined, fn, { file: FILE });
        },
        coverage() {
            test(`webchat-${nn}: every known issue names a case this file declares`, () => {
                const orphans = Object.entries(known).flatMap(([section, cases]) =>
                    Object.keys(cases)
                        .filter(id => id.startsWith(nn + '-') && declared.get(id) !== section)
                        .map(id => `${section} ${id}`));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN in ${FILE}`);
            });
        },
    };
}
