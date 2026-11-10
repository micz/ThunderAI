// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Testing": the DOM
// scenarios (tests/dom/<page>/13-*, 14-*) are generated from tests/helpers/feature-pages.mjs, so
// that map must name exactly the features of special_prompts_with_integration, each with a page
// the DOM harness knows and both scenario files. A new feature fails here until it is covered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
    FEATURE_PAGES,
    scenarioFile
} from '../helpers/feature-pages.mjs';
import { repoPath, REPO } from '../helpers/load.mjs';

const { special_prompts_with_integration } =
    await import(new URL('options/mzta-options-default.js', REPO).href);

test('FEATURE_PAGES covers special_prompts_with_integration exactly', () => {
    assert.deepEqual(Object.keys(FEATURE_PAGES).sort(), [...special_prompts_with_integration].sort());
});

// One file per feature and scenario; a page hosting several features (the SmartBar page) has the
// prefix in each file name. The text Save scenario only where the page edits the prompt's text.
test('every feature page has the connection scenarios', () => {
    for (const [prefix, feature] of Object.entries(FEATURE_PAGES)) {
        const names = ['13-connection-enforced', '14-connection-unlocked',
                       '16-mandatory-connection-blank', '17-locked-on-switch'];
        if (feature.textarea) names.push('15-text-save-keeps-connection');
        for (const name of names) {
            const file = scenarioFile(prefix, name);
            assert.ok(existsSync(repoPath('tests/dom/' + file)), file + ' missing');
        }
    }
});
