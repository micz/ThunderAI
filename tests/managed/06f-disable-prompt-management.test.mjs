// Spec 08 "_disable_prompt_management" and "The three prompt views":
//  - the user's own prompts stop being available wherever they could be invoked
//    (getPrompts() drops them), built-in and organization prompts are untouched;
//  - they are NEVER deleted: getPromptsForManagement() / getPromptsForMenuOrder() keep them,
//    marked _inert_by_policy, and the mark is stripped at the storage gates and on export;
//  - a policy that only restricts still counts as active;
//  - they come back exactly as they were when the policy is lifted.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const USER_PROMPTS = [
    { id: 'prompt_mine_1', name: 'Mine', text: 'my text', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];

let ctx;

before(async () => {
    ctx = await startBackground({
        policy: loadFixture('disable-prompt-management.json'),
        local: { _custom_prompt: USER_PROMPTS },
    });
});

test('the restriction is on, and a restriction-only policy is active', () => {
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), true);
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), false);
    assert.equal(ctx.mztaManaged.isSetupWizardDisabled(), false);
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), []);
});

test('the invocation view drops the user prompt and keeps the built-ins', async () => {
    const ids = (await ctx.prompts.getPrompts()).map(p => p.id);
    assert.equal(ids.includes('prompt_mine_1'), false);
    assert.ok(ids.includes('prompt_reply'));
    assert.equal(await ctx.prompts.loadPrompt('prompt_mine_1'), undefined);
});

test('special prompts are unaffected', async () => {
    const ids = (await ctx.prompts.getPrompts(false, [], true)).map(p => p.id);
    assert.ok(ids.includes('prompt_spamfilter'));
});

test('both administration views keep the user prompt, marked', async () => {
    for (const view of ['getPromptsForManagement', 'getPromptsForMenuOrder']) {
        const mine = (await ctx.prompts[view]()).find(p => p.id === 'prompt_mine_1');
        assert.ok(mine, view + ' dropped the user prompt');
        assert.equal(mine._inert_by_policy, true, view);
        assert.equal(mine.text, 'my text');
    }
    const reply = (await ctx.prompts.getPromptsForManagement()).find(p => p.id === 'prompt_reply');
    assert.equal(reply._inert_by_policy, false);
});

test('saving from the management view never deletes the prompt, and strips the mark', async () => {
    const own = (await ctx.prompts.getPromptsForManagement()).filter(p => String(p.is_default) !== '1');
    await ctx.prompts.setCustomPrompts(own);
    const stored = ctx.ctl.localData()._custom_prompt;
    assert.deepEqual(stored.map(p => p.id), ['prompt_mine_1']);
    assert.ok(stored.every(p => !('_inert_by_policy' in p)));
});

test('saving the menu order view strips the marks from the special prompts too', async () => {
    const specials = (await ctx.prompts.getPromptsForMenuOrder()).filter(p => String(p.is_special) === '1');
    await ctx.prompts.setSpecialPrompts(specials);
    const raw = JSON.stringify(ctx.ctl.localData()._special_prompts);
    assert.equal(raw.includes('_inert_by_policy'), false);
    assert.equal(raw.includes('_shadowed_by_org'), false);
    assert.equal(raw.includes('_default_inert_by_policy'), false);
});

test('export strips the mark', async () => {
    const out = ctx.prompts.preparePromptsForExport(await ctx.prompts.getPromptsForManagement());
    assert.ok(out.every(p => !('_inert_by_policy' in p)));
});

test('lifting the policy brings the prompt back exactly', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'invocablePrompts');
    const mine = r.result.find(p => p.id === 'prompt_mine_1');
    assert.ok(mine);
    assert.equal(mine.text, 'my text');
    assert.equal(mine.name, 'Mine');
});
