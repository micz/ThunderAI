// Spec 08 "_disable_setup_wizard" and "Restrictions": a policy-only switch, on (true) or
// absent; a policy that only restricts still counts as active. The enforcement sites
// (options buttons, onboarding banner, popup link, the wizard page) are DOM code and are
// not covered here - only the state they read.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('disable-setup-wizard.json') });
});

test('the restriction is on, the other two are off', () => {
    assert.equal(ctx.mztaManaged.isSetupWizardDisabled(), true);
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), false);
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), false);
});

test('a restriction-only policy is active, yet locks no preference', async () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), []);
    await ctx.mztaPrefs.setPref('connection_type', 'chatgpt_api');
    assert.equal(ctx.ctl.localData().connection_type, 'chatgpt_api');
});

test('nothing about the restriction is stored', () => {
    assert.equal(JSON.stringify(ctx.ctl.localData()).includes('setup_wizard'), false);
});

test('prompts are unaffected', async () => {
    assert.ok((await ctx.prompts.getPrompts()).some(p => p.id === 'prompt_reply'));
});
