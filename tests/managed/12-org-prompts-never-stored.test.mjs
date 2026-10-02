// Spec 02 "Organization prompts (the fourth set)" and 08 "Organization prompts":
//  - org prompts are NEVER stored: the policy is their only source of truth;
//  - their menu position and visibility belong to the user and ride in
//    _default_prompts_properties, exactly as for a built-in;
//  - a colliding custom prompt is shadowed, never deleted: it stays in _custom_prompt.
// The writers that rewrite _custom_prompt from a merged view must therefore leave the org
// prompts out: the startup migrateMenuOrderAlphabetic() (which runs on every fresh profile,
// after loadManaged()) and setCustomPrompts() itself, the gate into that store.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('org-prompts.json');
const USER_PROMPTS = [
    { id: 'org_acme_reply', name: 'My own reply', text: 'mine', type: '1', action: '1',
      is_default: '0', is_special: '0', show_in: 'popup' },
    { id: 'prompt_mine_1', name: 'Mine', text: 'also mine', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];

let ctx;

before(async () => {
    // No dynamic_menu_order_alphabet stored: the migration's "not yet run" default, as on a
    // fresh profile.
    ctx = await startBackground({ policy: POLICY, local: { _custom_prompt: USER_PROMPTS } });
});

const storedCustom = () => ctx.ctl.localData()._custom_prompt || [];

test('migrateMenuOrderAlphabetic() stores no org prompt in _custom_prompt', async () => {
    await ctx.prompts.migrateMenuOrderAlphabetic();
    const stored = storedCustom();
    assert.ok(stored.every(p => String(p.is_org) !== '1'),
        'org prompt copied into the user prompts: ' + JSON.stringify(stored.filter(p => String(p.is_org) === '1')));
    assert.ok(!stored.some(p => p.id === 'org_acme_summary'));
});

test('the migration keeps every user prompt, the shadowed one included', () => {
    const stored = storedCustom();
    assert.deepEqual(stored.map(p => p.id).sort(), ['org_acme_reply', 'prompt_mine_1']);
    assert.equal(stored.find(p => p.id === 'org_acme_reply').name, 'My own reply');
});

test('the migration gives the org prompts a menu position in _default_prompts_properties', () => {
    const props = ctx.ctl.localData()._default_prompts_properties || {};
    for (const id of ['org_acme_reply', 'org_acme_summary']) {
        assert.ok(props[id], id + ' has no display properties');
        assert.notEqual(props[id].position_display, '');
    }
});

test('setCustomPrompts() drops an org prompt handed to it', async () => {
    const view = await ctx.prompts.getPromptsForManagement();
    const notBuiltIn = view.filter(p => String(p.is_default) !== '1');
    assert.ok(notBuiltIn.some(p => String(p.is_org) === '1'), 'the view should list the org prompts');
    await ctx.prompts.setCustomPrompts(notBuiltIn);
    const stored = storedCustom();
    assert.ok(stored.every(p => String(p.is_org) !== '1'));
    assert.deepEqual(stored.map(p => p.id).sort(), ['org_acme_reply', 'prompt_mine_1']);
});
