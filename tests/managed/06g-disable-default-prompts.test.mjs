// Spec 08 "_disable_default_prompts":
//  - the BUILT-IN prompts leave the invocation view (getPrompts(), loadPrompt());
//  - special prompts are NOT touched (they carry is_default "1" too), nor the user's own
//    or the organization's;
//  - the built-ins stay in the merged set, marked _default_inert_by_policy, in both
//    administration views, and the mark is transient.

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
        policy: loadFixture('disable-default-prompts.json'),
        local: { _custom_prompt: USER_PROMPTS },
    });
});

test('the restriction is on, and the policy is active', () => {
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), true);
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), false);
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
});

test('no built-in prompt can be invoked', async () => {
    const all = await ctx.prompts.getPrompts();
    assert.deepEqual(all.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1'), []);
    assert.equal(await ctx.prompts.loadPrompt('prompt_reply'), undefined);
});

test('the user prompt and the special prompts are still available', async () => {
    const ids = (await ctx.prompts.getPrompts(false, [], true)).map(p => p.id);
    assert.ok(ids.includes('prompt_mine_1'));
    for (const id of ['prompt_spamfilter', 'prompt_add_tags', 'prompt_summarize', 'prompt_translate_this',
                      'prompt_get_calendar_event', 'prompt_get_task']) {
        assert.ok(ids.includes(id), id);
    }
});

test('the built-ins stay listed, marked, in both administration views', async () => {
    for (const view of ['getPromptsForManagement', 'getPromptsForMenuOrder']) {
        const reply = (await ctx.prompts[view]()).find(p => p.id === 'prompt_reply');
        assert.ok(reply, view);
        assert.equal(reply._default_inert_by_policy, true, view);
    }
    const spam = (await ctx.prompts.getPromptsForMenuOrder()).find(p => p.id === 'prompt_spamfilter');
    assert.equal(spam._default_inert_by_policy, false);
});

test('the mark is never exported or stored', async () => {
    const out = ctx.prompts.preparePromptsForExport(await ctx.prompts.getPromptsForManagement());
    assert.ok(out.every(p => !('_default_inert_by_policy' in p)));
    const specials = (await ctx.prompts.getPromptsForMenuOrder()).filter(p => String(p.is_special) === '1');
    await ctx.prompts.setSpecialPrompts(specials);
    assert.equal(JSON.stringify(ctx.ctl.localData()).includes('_default_inert_by_policy'), false);
});
