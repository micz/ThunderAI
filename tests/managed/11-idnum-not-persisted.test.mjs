// Spec 02 (the three prompt views and the storage gates): idnum is a VIEW field - the row number getPrompts(),
// getPromptsForManagement() and getPromptsForMenuOrder() give each entry, renumbered on every
// read - not a property of the prompt. setSpecialPrompts() and setCustomPrompts() drop it, so a
// prompt that comes back from a view (loadPrompt() goes through getPrompts()) never stores a
// stale row number. No policy involved: this is the unmanaged path.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/load.mjs';

const CUSTOM = { id: 'prompt_user_1', name: 'Mine', text: 'Do it', is_default: '0', is_special: '0',
                 show_in: 'popup' };

let ctx;

before(async () => {
    ctx = await startBackground({
        policy: null,
        local: {
            connection_type: 'chatgpt_api',
            _custom_prompt: [{ ...CUSTOM, idnum: 99 }], // a row number stored by an older version
        },
    });
});

const hasIdnum = key => (ctx.ctl.localData()[key] || []).some(p => 'idnum' in p);

test('loadPrompt() hands out a view entry, with its row number', async () => {
    const p = await ctx.prompts.loadPrompt('prompt_spamfilter');
    assert.equal(typeof p.idnum, 'number');
});

test('savePrompt() of a loaded special prompt stores no idnum', async () => {
    const p = await ctx.prompts.loadPrompt('prompt_spamfilter');
    p.api_type = 'ollama_api';
    p.ollama_host = 'http://user:11434';
    await ctx.prompts.savePrompt(p);
    const stored = ctx.ctl.localData()._special_prompts.find(s => s.id === 'prompt_spamfilter');
    assert.equal(stored.api_type, 'ollama_api', 'the change itself was not saved');
    assert.equal(hasIdnum('_special_prompts'), false);
});

test('clearPromptAPI() stores no idnum either', async () => {
    await ctx.prompts.clearPromptAPI('prompt_spamfilter');
    assert.equal(ctx.ctl.localData()._special_prompts.find(s => s.id === 'prompt_spamfilter').api_type, '');
    assert.equal(hasIdnum('_special_prompts'), false);
});

test('saving the management view drops idnum from _custom_prompt, a stored one included', async () => {
    const list = await ctx.prompts.getPromptsForManagement();
    assert.ok(list.every(p => typeof p.idnum === 'number'));
    await ctx.prompts.setCustomPrompts(list.filter(p => p.is_default === '0' && p.is_special !== '1'));
    assert.equal(hasIdnum('_custom_prompt'), false);
    assert.deepEqual(ctx.ctl.localData()._custom_prompt.map(p => p.id), [CUSTOM.id]);
});

test('the views still number their entries after the store lost idnum', async () => {
    const views = [await ctx.prompts.getPrompts(), await ctx.prompts.getPromptsForManagement(),
                   await ctx.prompts.getPromptsForMenuOrder()];
    for (const view of views) {
        const nums = view.map(p => p.idnum);
        assert.deepEqual(nums, nums.map((_, i) => i + 1));
    }
});
