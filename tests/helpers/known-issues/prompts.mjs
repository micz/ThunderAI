/*
 *  Known issues of the prompts area: assertions written from spec 02 (prompts) and spec 03
 *  (placeholders) that the shipped code contradicts today. How they run (TODO while failing,
 *  "stale" once passing) is the core mechanism, ../core/known-issues.mjs; this file holds the
 *  entries, their shape, and caseTests(), the one way a test of the area is declared.
 *
 *  Every test of the area has a CASE ID, unique in its file, so a known issue names exactly one
 *  test. The shape is "a test file × a case id":
 *
 *      KNOWN = { '<file stem>': { '<case id>': REASONS.<name> } }
 *
 *   - a file stem is the name of a file in tests/prompts/ without `.test.mjs`
 *     ('04-placeholder-values');
 *   - a case id is a non-empty slug, never '*' nor a pattern: a catch-all would hide every later
 *     failure of the file at once;
 *   - a reason is one of REASONS: a non-empty string naming the spec section it contradicts
 *     (`spec 02 "..."` / `spec 03 "..."`) and what the code does instead.
 *  validateKnown() enforces this; tests/prompts/99-harness-known-issues runs it.
 *
 *  Each test file ends with caseTests().coverage(): a test that fails on an entry of KNOWN naming
 *  a case id the file never declared, so an entry cannot outlive the test it was written for
 *  (renamed, removed) and silently stop meaning anything.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/prompts.mjs';
const AREA_DIR = new URL('../../prompts/', import.meta.url);

/** The reasons of KNOWN, one per spec contradiction. */
export const REASONS = {
    defaultPropsNineKeys:
        'spec 02 "Organization prompts (the fourth set)" says _default_prompts_properties "holds only ' +
        'the nine display keys". setDefaultPromptsProperties() writes ten per prompt: position_display/' +
        'compose/context, need_custom_text, chatgpt_web_model/project/custom_gpt, api_type, show_in, ' +
        'custom_icon',
    exportEmitsEnabled:
        'spec 02 "Enabled-to-show_in Migration" says "`enabled` is never emitted on export". ' +
        'preparePromptsForExport() drops it for a built-in prompt (allowedKeys) but copies it ' +
        'unchanged for a custom prompt',
    exportChatgptWebOverride:
        'spec 02 "Per-Prompt API Override Properties" lists chatgpt_web_model, chatgpt_web_project and ' +
        'chatgpt_web_custom_gpt as per-prompt API overrides. preparePromptsForExport(prompts, false) ' +
        'strips only api_type and the integration_options_config keys, so a custom prompt still ' +
        'exports these three',
    pickerPoliteSelectedHtml:
        'spec 02 "The picker prompts send HTML - except one" says prompt_rewrite_polite ' +
        '(prompt_rewrite_full_text) uses {%mail_html_body_or_selected%}, so with no selection it sends ' +
        'the HTML body. The shipped text uses {%selected_html%}: with no selection the token stays ' +
        'unresolved (literal, or empty with the default values on) and the body is never sent',
    pickerProofreadSelectedHtml:
        'spec 02 "The picker prompts send HTML - except one" says prompt_proofread_this uses ' +
        '{%mail_typed_text%} and sends plain text, by design. The shipped text ' +
        '(prompt_proofread_this_full_text, changed in 3507e368) uses "{%selected_html%}": it sends ' +
        'the selection as HTML, and the typed text not at all',
    calendarStripFirstOnly:
        'spec 03 "The address placeholders in the compose window" ("Not visible in the calendar-event ' +
        'flow") says finalizePrompt_get_calendar_event() strips {%cc_list%} and {%recipients%} out of ' +
        'the prompt entirely. It calls String.replace() with a string, so only the FIRST occurrence of ' +
        'each is stripped; a second unresolved token reaches the AI',
};

/** The known issues, by test file and case id. */
export const KNOWN = {
    '15-export-import': {
        'no-api-settings-chatgpt-web': REASONS.exportChatgptWebOverride,
        'enabled-never-exported': REASONS.exportEmitsEnabled,
    },
    '12-prompt-storage': {
        'default-props-nine-keys': REASONS.defaultPropsNineKeys,
    },
    '20-prepare-prompt-golden': {
        '21-picker-polite-selection': REASONS.pickerPoliteSelectedHtml,
        '22-picker-polite-body': REASONS.pickerPoliteSelectedHtml,
        '23-picker-proofread': REASONS.pickerProofreadSelectedHtml,
    },
    '21-finalize-prompts': {
        'calendar-strips-addresses-entirely': REASONS.calendarStripFirstOnly,
    },
};

/** The file stems of tests/prompts/ (the files a KNOWN entry may name). */
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
        if (!files.includes(file)) { problems.push(`${file}: no such test file in tests/prompts/`); continue; }
        if (!cases || typeof cases !== 'object' || Array.isArray(cases)) {
            problems.push(`${file}: must be an object {case id: reason}`);
            continue;
        }
        for (const [id, reason] of Object.entries(cases)) {
            const at = `${file}.${id}`;
            if (id.trim() === '') problems.push(`${file}: an empty case id`);
            else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`${at}: a case id names one test, never a pattern`);
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(at + ': no reason');
            else if (!/\bspec 0[23] "[^"]+"/.test(reason)) {
                problems.push(at + ': the reason names no spec section (spec 02 "..." or spec 03 "...")');
            } else if (known === KNOWN && !reasons.has(reason)) {
                problems.push(at + ': the reason is not one of REASONS');
            }
        }
    }
    return problems;
}

/**
 * The test declarer of one file of the area.
 *
 *   const k = caseTests('04-placeholder-values');
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
