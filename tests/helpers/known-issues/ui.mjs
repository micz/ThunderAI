/*
 *  Known issues of the ui area: assertions written from the specs about what a page does with no
 *  policy installed, which the shipped page contradicts today. How they run (TODO while failing,
 *  "stale" once passing) is the core mechanism, ../core/known-issues.mjs; this file holds the
 *  entries, their shape, and uiTests(), the one way a test of the area is declared.
 *
 *  The area's tests are DOM files spread over the shared tests/dom/<page>/ folders
 *  (ui-NN-<scenario>.dom.mjs), and every test names the spec section it checks. So the shape is
 *  "a page × a spec section × a case id":
 *
 *      KNOWN = { '<page>': { 'spec NN "<section>"': { 'NN-<case>': '<what the page does>' } } }
 *
 *   - a page is a folder of tests/dom/ that holds at least one ui- file;
 *   - a section is `spec NN "<section title>"`, the section the test was written from;
 *   - a case id is `NN-<slug>`: NN is the number of the ui-NN- file that declares it (so an entry
 *     names exactly one test of one file), the slug is a non-empty slug, never '*' nor a pattern:
 *     a catch-all would hide every later failure of the file at once;
 *   - the value is the reason: what the spec says and what the page does instead.
 *  validateKnown() enforces this; tests/ui/99-harness-known-issues runs it.
 *
 *  Each DOM file ends with uiTests().coverage(): a test that fails on an entry of KNOWN naming a
 *  case of that file the file never declared (or declared under another section), so an entry
 *  cannot outlive the test it was written for.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/ui.mjs';
const DOM_DIR = new URL('../../dom/', import.meta.url);

const SECTION_RE = /^spec \d\d "[^"]+"$/;
const CASE_RE = /^(\d\d)-[a-z0-9][a-z0-9-]*$/;

/** The known issues, by page, spec section and case id. */
export const KNOWN = {
    customdataplaceholders: {
        'spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)"': {
            '01-save-all-text': 'the spec has the stored text stay clean (sanitizeHtml() strips the chip markup); Save All '
                + 're-reads every row with List.js reIndex(), which takes `.text` from the innerHTML of the decorated '
                + 'read-mode span, so a text holding a {%…%} token is stored as \'Hello <span class="ph_chip">{%author%}</span>\' '
                + '(and & as &amp;) - which is what the placeholder then expands to in a prompt',
            '01-edit-saved-text': 'same cause as 01-save-all-text, for a text confirmed with OK: stored as '
                + '\'Kind regards\\n<span class="ph_chip">{%author%}</span> &amp; <span class="ph_chip">{%mail_subject%}</span>\'',
            '01-enabled-toggle-new-row': 'the enabled switch stays clickable straight from the row; a row added in this '
                + 'session gets Edit / Delete / OK / Cancel handlers but no `change` handler on its .input_mod switch '
                + '(only loadCustomDataPHsList() binds those, at load and after an import), so unticking it neither '
                + 'enables Save All nor arms beforeunload',
            '01-delete-after-save': 'Delete matches the row by the id it shows (without the prefix); after any Save All '
                + 'it removes nothing, because setCustomPlaceholders() writes the thunderai_custom_ prefix into the very '
                + 'objects List.js holds (item.values() is handed by reference), so remove("id", "greet") finds no item '
                + 'until the page is reloaded (the add-form\'s "id already used" check misses for the same reason)',
        },
        'spec 03 "Custom Placeholders"': {
            '01-enabled-saved': 'a custom placeholder is disabled with the page\'s checkbox (enabled: 0); Save All re-reads '
                + '`enabled` from the checkbox\'s checked_val attribute (List.js valueName {name: "enabled", attr: '
                + '"checked_val"}), which ticking or unticking the switch never changes, so the stored value stays what '
                + 'it was at load (here 1 after unticking)',
        },
    },
    menu_order: {
        'spec 02 "Menu Order Page (`pages/menu_order/`)"': {
            '01-icon-other-panel': '"an icon chosen in one panel shows in the other": the pick updates only the clicked '
                + 'preview (applyIconToPreview() on the anchor); the same prompt\'s row in the other panel keeps the old '
                + 'icon until that panel is re-rendered (a drag, Reset all, a reload)',
        },
    },
};

/** {page: [the NN of each ui-NN- file]} of tests/dom/. */
export function areaFiles() {
    const out = {};
    for (const page of readdirSync(fileURLToPath(DOM_DIR))) {
        let files;
        try { files = readdirSync(fileURLToPath(new URL(page + '/', DOM_DIR))); } catch { continue; }
        const nums = files.map(f => /^ui-(\d\d)-.+\.dom\.mjs$/.exec(f)).filter(Boolean).map(m => m[1]);
        if (nums.length) out[page] = nums;
    }
    return out;
}

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known, files = areaFiles()) {
    const problems = [];
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(known)) return ['KNOWN must be an object'];
    for (const [page, sections] of Object.entries(known)) {
        if (!files[page]) { problems.push(`${page}: no ui- file in tests/dom/${page}/`); continue; }
        if (!isObj(sections)) { problems.push(`${page}: must be an object {section: {case id: reason}}`); continue; }
        const seen = new Set();
        for (const [section, cases] of Object.entries(sections)) {
            const at = `${page} ${section}`;
            if (!SECTION_RE.test(section)) problems.push(`${at}: a section is \`spec NN "<section>"\``);
            if (!isObj(cases)) { problems.push(`${at}: must be an object {case id: reason}`); continue; }
            for (const [id, reason] of Object.entries(cases)) {
                const m = CASE_RE.exec(id);
                if (!m) problems.push(`${at}.${id}: a case id is NN-<slug> and names one test, never a pattern`);
                else if (!files[page].includes(m[1])) problems.push(`${at}.${id}: no ui-${m[1]}- file in tests/dom/${page}/`);
                if (seen.has(id)) problems.push(`${page}.${id}: listed under two sections`);
                seen.add(id);
                if (typeof reason !== 'string' || reason.trim() === '') problems.push(`${at}.${id}: no reason`);
            }
        }
    }
    return problems;
}

/**
 * The test declarer of one DOM file of the area.
 *
 *   const k = uiTests('options', '02');
 *   k.test('case-slug', 'spec 05 "Feature Flags"', 'what the spec says', async () => { ... });
 *   ...
 *   k.coverage();     // last: every KNOWN entry of this file names a declared case
 *
 * k.test() runs through knownTest(): a case listed in KNOWN is a TODO while it fails and fails
 * the run once it passes. A case declared twice in a file, or a section not of the form
 * `spec NN "<section>"`, throws at load.
 */
export function uiTests(page, nn, { known = KNOWN } = {}) {
    const sections = known[page] || {};
    const declared = new Map();     // case id -> its section
    return {
        test(slug, section, name, fn) {
            const id = `${nn}-${slug}`;
            if (!CASE_RE.test(id)) throw new Error(`uiTests(${page}): bad case id "${id}"`);
            if (!SECTION_RE.test(section)) throw new Error(`uiTests(${page}): bad section ${section}`);
            if (declared.has(id)) throw new Error(`uiTests(${page}): case "${id}" declared twice`);
            declared.set(id, section);
            const reason = sections[section]?.[id];
            return knownTest(`[${id}] ${section}: ${name}`,
                reason ? `${section}: ${reason}` : undefined, fn, { file: FILE });
        },
        coverage() {
            test(`${page} ui-${nn}: every known issue names a case this file declares`, () => {
                const orphans = Object.entries(sections).flatMap(([section, cases]) =>
                    Object.keys(cases)
                        .filter(id => id.startsWith(nn + '-') && declared.get(id) !== section)
                        .map(id => `${section} ${id}`));
                assert.deepEqual(orphans, [], `remove or rename these entries of KNOWN['${page}'] in ${FILE}`);
            });
        },
    };
}
