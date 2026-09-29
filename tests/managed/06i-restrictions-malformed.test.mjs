// Spec 08 "Restrictions": readRestriction() accepts only a boolean. false is allowed and
// means the same as absent. Anything else is warned about and treated as OFF - never
// coerced, because a restriction misread as on would lock a fleet out of its own prompts.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const USER_PROMPTS = [
    { id: 'prompt_mine_1', name: 'Mine', text: 'my text', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];

let ctx;

before(async () => {
    ctx = await startBackground({
        policy: loadFixture('restrictions-malformed.json'),
        local: { _custom_prompt: USER_PROMPTS },
    });
});

test('"true" and 1 are not true: both restrictions stay off', () => {
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), false);
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), false);
    assert.equal(ctx.mztaManaged.isSetupWizardDisabled(), false);
});

test('each malformed value is warned about; an explicit false is not', () => {
    const w = ctx.con.warnings();
    assert.ok(w.some(m => m.includes('_disable_prompt_management')));
    assert.ok(w.some(m => m.includes('_disable_default_prompts')));
    assert.equal(w.some(m => m.includes('_disable_setup_wizard')), false);
});

test('with every restriction off and nothing else, the policy is not active', () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), false);
});

test('user and built-in prompts remain invocable', async () => {
    const ids = (await ctx.prompts.getPrompts()).map(p => p.id);
    assert.ok(ids.includes('prompt_mine_1'));
    assert.ok(ids.includes('prompt_reply'));
});
