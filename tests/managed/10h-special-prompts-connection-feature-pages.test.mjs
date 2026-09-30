// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Testing": the DOM
// scenarios (tests/dom/<page>/13-*, 14-*) are generated from tests/helpers/feature-pages.mjs, so
// that map must name exactly the features of special_prompts_with_integration, each with a page
// the DOM harness knows and both scenario files. A new feature fails here until it is covered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FEATURE_PAGES } from '../helpers/feature-pages.mjs';
import { repoPath, REPO } from '../helpers/load.mjs';

const { special_prompts_with_integration } =
    await import(new URL('options/mzta-options-default.js', REPO).href);

test('FEATURE_PAGES covers special_prompts_with_integration exactly', () => {
    assert.deepEqual(Object.keys(FEATURE_PAGES).sort(), [...special_prompts_with_integration].sort());
});

test('every feature page has the connection scenarios', () => {
    for (const { page } of Object.values(FEATURE_PAGES)) {
        for (const file of ['13-connection-enforced.dom.mjs', '14-connection-unlocked.dom.mjs',
                            '15-text-save-keeps-connection.dom.mjs',
                            '16-mandatory-connection-blank.dom.mjs']) {
            assert.ok(existsSync(repoPath('tests/dom/' + page + '/' + file)), page + '/' + file + ' missing');
        }
    }
});
