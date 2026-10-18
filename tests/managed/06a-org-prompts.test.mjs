// Spec 08 "Organization prompts" and 02 "Organization prompts (the fourth set)":
//  - ids are composed, not taken verbatim: org_<_org_id>_<id>;
//  - marked is_org "1", is_default "0", is_special "0";
//  - each entry validated on its own, a bad one skipped with a warning;
//  - a colliding custom prompt is SHADOWED, not rejected, and never deleted: it stays in
//    _custom_prompt and comes back when the policy stops supplying the id;
//  - getPrompts() hides the shadowed prompt, getPromptsForManagement() lists it, flagged;
//    the transient flags are stripped at the storage gates.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('org-prompts.json');
const USER_PROMPTS = [
    { id: 'org_acme_reply', name: 'My own reply', text: 'mine', type: '1', action: '1',
      is_default: '0', is_special: '0', show_in: 'popup' },
    { id: 'prompt_mine_1', name: 'Mine', text: 'also mine', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];

let ctx, orgPrompts, warnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: { _custom_prompt: USER_PROMPTS } });
    orgPrompts = ctx.mztaManaged.getOrgPrompts();
    warnings = ctx.con.warnings();
});

test('ids are composed as org_<_org_id>_<id>; an id already carrying the prefix is kept', () => {
    assert.deepEqual(orgPrompts.map(p => p.id), ['org_acme_reply', 'org_acme_summary']);
    assert.equal(ctx.mztaManaged.getOrgId(), 'acme');
});

test('org prompts are marked as the fourth set', () => {
    for (const p of orgPrompts) {
        assert.equal(p.is_org, '1');
        assert.equal(p.is_default, '0');
        assert.equal(p.is_special, '0');
    }
});

test('each invalid entry is skipped with its own warning, the rest still delivered', () => {
    // 7 bad entries: whitespace id, no id, no name, no text, bad api_type, duplicate, non-object.
    const orgWarnings = warnings.filter(w => w.includes('_org_prompts') || w.includes('organization prompt'));
    assert.ok(orgWarnings.length >= 7, orgWarnings.join('\n'));
    assert.equal(orgPrompts.length, 2);
    assert.equal(orgPrompts.find(p => p.id === 'org_acme_reply').name, 'ACME formal reply',
        'the first occurrence of a duplicate id wins');
});

test('the org prompt wins wherever a prompt can be invoked', async () => {
    const all = await ctx.prompts.getPrompts();
    const reply = all.filter(p => p.id === 'org_acme_reply');
    assert.equal(reply.length, 1);
    assert.equal(reply[0].is_org, '1');
    assert.equal(reply[0].name, 'ACME formal reply');
    assert.ok(all.some(p => p.id === 'org_acme_summary'));
    assert.ok(all.some(p => p.id === 'prompt_mine_1'));
});

test('the management view lists the shadowed user prompt, flagged', async () => {
    const mgmt = await ctx.prompts.getPromptsForManagement();
    const both = mgmt.filter(p => p.id === 'org_acme_reply');
    assert.equal(both.length, 2);
    const user = both.find(p => String(p.is_org) !== '1');
    assert.equal(user.name, 'My own reply');
    assert.equal(user._shadowed_by_org, true);
    const menuOrder = await ctx.prompts.getPromptsForMenuOrder();
    assert.equal(menuOrder.filter(p => p.id === 'org_acme_reply').length, 2);
});

test('the user prompt is never deleted, and saving strips the transient flag', async () => {
    const mgmt = await ctx.prompts.getPromptsForManagement();
    const own = mgmt.filter(p => String(p.is_default) !== '1' && String(p.is_org) !== '1');
    await ctx.prompts.setCustomPrompts(own);
    const stored = ctx.ctl.localData()._custom_prompt;
    assert.deepEqual(stored.map(p => p.id).sort(), ['org_acme_reply', 'prompt_mine_1']);
    assert.ok(stored.every(p => !('_shadowed_by_org' in p)));
    assert.equal(stored.find(p => p.id === 'org_acme_reply').text, 'mine');
});

test('each read hands out its own copy of an org prompt: a mutation never reaches the next run', async () => {
    const first = await ctx.prompts.loadPrompt('org_acme_reply');
    assert.equal(first.text, 'Reply formally to {%mail_text_body%}');
    // What a run does to the prompt it was handed: preparePrompt() rewrites its text, the menus
    // set selection_text.
    first.text = 'rewritten by a run';
    first.selection_text = 'a selection';
    const second = await ctx.prompts.loadPrompt('org_acme_reply');
    assert.notEqual(second, first, 'not the same object');
    assert.equal(second.text, 'Reply formally to {%mail_text_body%}');
    assert.equal('selection_text' in second, false);
    const [a, b] = [await ctx.prompts.getPrompts(), await ctx.prompts.getPrompts()];
    assert.notEqual(a.find(p => p.id === 'org_acme_summary'), b.find(p => p.id === 'org_acme_summary'));
});

test('org prompts are never stored', () => {
    const raw = JSON.stringify(ctx.ctl.localData());
    assert.equal(raw.includes('ACME formal reply'), false);
    assert.equal(raw.includes('ACME summary'), false);
});

test('export strips the transient flags', async () => {
    const out = ctx.prompts.preparePromptsForExport(await ctx.prompts.getPromptsForManagement());
    assert.ok(out.every(p => !('_shadowed_by_org' in p)));
});

test('when the policy stops supplying the id, the user prompt comes back', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'invocablePrompts');
    const reply = r.result.filter(p => p.id === 'org_acme_reply');
    assert.equal(reply.length, 1);
    assert.equal(reply[0].name, 'My own reply');
    assert.ok(r.result.every(p => String(p.is_org) !== '1'));
});
