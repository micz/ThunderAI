// Spec 08a "_disable_add_tags_account_settings" and "Restrictions": a policy-only switch, on (true)
// or absent; a policy that only restricts still counts as active. The module functions every
// run-time path goes through ignore the stored entries, which are kept as they are. The other
// sites (the tag dialog commands, the Add Tags page) are covered by the background area and the
// DOM tests.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const ENTRIES = {
    acc1: { add_tags_maxnum: 7, default_chatgpt_lang: 'French', prompt_text: 'Account text' },
};
const PREFS = { add_tags_maxnum: 3, default_chatgpt_lang: 'Italian' };
const PROMPT = { id: 'prompt_add_tags', text: 'Global text', is_special: '1' };

let ctx, mod;

before(async () => {
    ctx = await startBackground({
        policy: loadFixture('disable-add-tags-account-settings.json'),
        local: { add_tags_account_settings: ENTRIES },
    });
    mod = await import('../../js/mzta-addtags-account-settings.js');
});

test('the restriction is on, the other three are off', () => {
    assert.equal(ctx.mztaManaged.isAddTagsAccountSettingsDisabled(), true);
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), false);
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), false);
    assert.equal(ctx.mztaManaged.isSetupWizardDisabled(), false);
});

test('a restriction-only policy is active, yet locks no preference', () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), []);
});

test('no account override applies: a fresh copy of the global values', async () => {
    const out = await mod.addTags_resolveAccountPrefs(PREFS, 'acc1');
    assert.notEqual(out, PREFS);
    assert.deepEqual(out, PREFS);
});

test('the account prompt text is ignored: the prompt itself', async () => {
    assert.equal(await mod.addTags_applyAccountPrompt(PROMPT, 'acc1'), PROMPT);
});

test('the stored entries are kept, never deleted, and still readable as stored', async () => {
    assert.deepEqual(ctx.ctl.localData().add_tags_account_settings, ENTRIES);
    assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), ENTRIES.acc1);
});

test('nothing about the restriction is stored', () => {
    assert.equal(JSON.stringify(ctx.ctl.localData()).includes('_disable_add_tags'), false);
});
