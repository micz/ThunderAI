/*
 *  The Ollama think select is an open catalogue (spec 04, Ollama "Settings UI"): a model may
 *  report levels beyond OLLAMA_THINK_LEVELS. A stored level the default list lacks, and a
 *  policy-enforced one (any lowercase word is accepted, spec 08 "Content rules"), must show in
 *  the select after the page's restore - not "Default" - because ensureRestorableOption() gives
 *  it an option before the assignment, and buildOllamaThinkOptions() keeps it on every rebuild.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';

const LEVEL = 'xhigh';

/** mode 'user': the user's stored level; mode 'policy': a level the policy enforces. One page
 *  per test file: the harness installs its globals per page. */
export async function ollamaThinkLevelScenario(page, mode) {
    const local = { connection_type: 'ollama_api' };
    const ctx = mode === 'policy'
        ? await openPage(page, { policy: { ollama_think: LEVEL }, local: { ...local, ollama_think: 'low' } })
        : await openPage(page, { local: { ...local, ollama_think: LEVEL } });
    after(() => ctx.close());

    if (mode === 'policy') {
        test('a policy-enforced level the default list lacks is shown, locked', () => {
            const el = ctx.$('#ollama_think');
            assert.equal(el.value, LEVEL);
            assert.equal(el.disabled, true);
            assert.equal(el.dataset.mztaManaged, '1');
        });
    } else {
        test('a stored level the default list lacks is shown, not "Default"', () => {
            assert.equal(ctx.$('#ollama_think').value, LEVEL);
        });
    }

    test('the page ran on modelled APIs only', () => {
        assertHarnessClean(ctx);
    });
}
