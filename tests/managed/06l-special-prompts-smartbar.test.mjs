// Spec 08 / 08a / 08b: the three special prompts of the SmartBar (claude-spec/10-smartbar.md
// "Special prompts and their connections") as policy keys.
//  - _special_prompts_text: the three ids are valid keys; their texts are enforced as a read-time
//    overlay and never stored. The router's variables ({OPERATIONS}, {PLACEHOLDERS},
//    {LANGUAGE_RULE}) are required by the Actions tab on the user's own Save only: a policy text
//    without them is still enforced (spec 02 "SmartBar prompts": a variable the text lacks has
//    its content appended at call time), and the SmartBar's prompts have no response contract
//    (their JSON sections are the add-on's).
//  - _special_prompts_connection: the three feature prefixes are valid keys; each implies its
//    {prefix}_use_specific_integration / {prefix}_connection_type pair, locked, and overlays its
//    prompt.
//  - The user's default_hash (spec 02 "Default text updates") stays the user's under a policy.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('special-prompts-smartbar.json');
const T = POLICY._special_prompts_text;
const USER_ROUTER = 'My router {OPERATIONS} {PLACEHOLDERS} {LANGUAGE_RULE}';
const STORED = {
    connection_type: 'chatgpt_api',
    _special_prompts: [
        { id: 'prompt_smartbar_router', text: USER_ROUTER, default_hash: 'abcdef01', is_default: '1', is_special: '1', show_in: 'none', custom_icon: '' },
    ],
};

let ctx, warnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
    warnings = ctx.con.warnings();
});

const IDS = ['prompt_smartbar_router', 'prompt_smartbar_execute', 'prompt_smartbar_chat'];
const PREFIXES = { smartbar_router: 'openai_comp_api', smartbar_execute: 'anthropic_api', smartbar_chat: 'ollama_api' };

test('the three texts are enforced, the router\'s without its variables too', () => {
    assert.deepEqual(Object.keys(ctx.mztaManaged.getSpecialPromptsText()).sort(), [...IDS].sort());
    for (const id of IDS) assert.equal(ctx.mztaManaged.getSpecialPromptText(id), T[id], id);
    assert.equal(warnings.some(w => w.includes('prompt_smartbar_')), false, 'a SmartBar text was warned about: ' + warnings.join(' | '));
});

test('getSpecialPrompts() overlays the texts; storage keeps the user\'s text and default_hash', async () => {
    const list = await ctx.prompts.getSpecialPrompts();
    for (const id of IDS) assert.equal(list.find(p => p.id === id).text, T[id], id);
    await ctx.prompts.setSpecialPrompts(list);
    const stored = ctx.ctl.localData()._special_prompts.find(p => p.id === 'prompt_smartbar_router');
    assert.equal(stored.text, USER_ROUTER, 'the enforced text was stored');
    assert.equal(stored.default_hash, 'abcdef01');
});

test('the three connections are accepted, each implying its preference pair, locked', () => {
    const m = ctx.mztaManaged;
    for (const [prefix, type] of Object.entries(PREFIXES)) {
        assert.equal(m.getManagedValue(prefix + '_use_specific_integration'), true, prefix);
        assert.equal(m.getManagedValue(prefix + '_connection_type'), type, prefix);
        assert.equal(m.isManagedLocked(prefix + '_use_specific_integration'), true, prefix);
        assert.equal(m.isManagedLocked(prefix + '_connection_type'), true, prefix);
    }
    assert.equal(warnings.some(w => /smartbar_(router|execute|chat)/.test(w)), false, warnings.join(' | '));
});

test('getSpecialPrompts() overlays each connection on its prompt', async () => {
    const list = await ctx.prompts.getSpecialPrompts();
    const byId = id => list.find(p => p.id === id);
    assert.equal(byId('prompt_smartbar_router').api_type, 'openai_comp_api');
    assert.equal(byId('prompt_smartbar_router').openai_comp_model, 'router-model');
    assert.equal(byId('prompt_smartbar_execute').api_type, 'anthropic_api');
    assert.equal(byId('prompt_smartbar_execute').anthropic_model, 'claude-org-writer');
    assert.equal(byId('prompt_smartbar_chat').api_type, 'ollama_api');
    assert.equal(byId('prompt_smartbar_chat').ollama_model, 'llama-org-chat');
});
