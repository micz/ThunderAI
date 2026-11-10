// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the SmartBar page
// (its Actions tab, the three prompts of the feature): see helpers/dom-prompt-text.mjs.
// Spec 02 "Default text updates": a text the policy enforces gets no update notice, and its
// locked JSON section is still shown under it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

const ctx = await enforcedTextScenario('smartbar', 'dom-special-prompts-text-smartbar.json', [
    { id: 'smartbar_prompt_router_text', promptIds: ['prompt_smartbar_router'], save: 'btn_save_smartbar_router', reset: 'btn_reset_smartbar_router' },
    { id: 'smartbar_prompt_execute_text', promptIds: ['prompt_smartbar_execute'], save: 'btn_save_smartbar_execute', reset: 'btn_reset_smartbar_execute' },
    { id: 'smartbar_prompt_chat_text', promptIds: ['prompt_smartbar_chat'], save: 'btn_save_smartbar_chat', reset: 'btn_reset_smartbar_chat' },
]);

test('no update notice on an enforced text; the locked JSON sections are still shown', () => {
    for (const key of ['router', 'execute', 'chat']) {
        assert.equal(ctx.$('#smartbar_prompt_' + key + '_update').hidden, true, key);
    }
    assert.match(ctx.$('#smartbar_prompt_router_locked').textContent, /"operations"/);
    assert.match(ctx.$('#smartbar_prompt_execute_locked').textContent, /"body"/);
});
