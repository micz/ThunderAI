// Spec 02 "Organization prompts (the fourth set)": "Local display preferences belong to the
// user." An org prompt's menu positions, visibility and icon ride in _default_prompts_properties
// under its composed id, exactly as for a built-in, and are applied back when the org prompts
// are read (issue #990: they were written but never read):
//  - only position_display / position_compose / position_context / show_in / custom_icon, each
//    only when in domain; they override what the policy says;
//  - everything else in the entry (the prompt text, need_custom_text, api_type, ...) is ignored:
//    the prompt stays read-only;
//  - a missing or malformed entry leaves the policy values; an entry for an org prompt the
//    policy no longer supplies, or supplies under another _org_id, is never applied.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const policy = (orgId = 'acme') => ({
    _org_name: 'ACME',
    _org_id: orgId,
    _org_prompts: [
        { id: 'reply', name: 'ACME reply', text: 'Reply to {%mail_text_body%}', type: '1', action: '1',
          show_in: 'context', custom_icon: 'clock.png', position_display: 7, position_compose: 7, position_context: 7 },
        { id: 'summary', name: 'ACME summary', text: 'Summarize {%mail_text_body%}', type: '0', action: '0',
          show_in: 'both', custom_icon: 'clock.png' },
        { id: 'plain', name: 'ACME plain', text: 'Plain {%mail_text_body%}', type: '0', action: '0',
          show_in: 'both', custom_icon: 'clock.png', position_display: 9 },
        { id: 'nostore', name: 'ACME not stored', text: 'x {%mail_text_body%}', type: '0', action: '0' },
    ],
});

const STORED = {
    org_acme_reply: {
        position_display: 3, position_compose: 4, position_context: '5',
        show_in: 'none', custom_icon: 'airport.png',
        // Not display preferences: the policy's values must stay.
        need_custom_text: '1', api_type: 'chatgpt_api', chatgpt_web_model: 'gpt-x',
        chatgpt_web_project: 'p', chatgpt_web_custom_gpt: 'g',
        // Not even written by setDefaultPromptsProperties(): a tampered entry.
        text: 'HIJACKED', name: 'HIJACKED', type: '2', is_org: '0', is_default: '1',
    },
    org_acme_summary: 'not an object',
    org_acme_plain: { position_display: '', position_compose: 'abc', position_context: null,
        show_in: 'sideways', custom_icon: 42 },
    org_acme_gone: { position_display: 1, show_in: 'both', custom_icon: 'airport.png' },
};

let ctx;
const byId = list => Object.fromEntries(list.map(p => [p.id, p]));
const org = list => byId(list.filter(p => String(p.is_org) === '1'));

before(async () => {
    ctx = await startBackground({ policy: policy(), local: { _default_prompts_properties: STORED } });
});

test('the stored display properties override the policy values, in every view', async () => {
    for (const view of [await ctx.prompts.getPromptsForMenuOrder(), await ctx.prompts.getPromptsForManagement()]) {
        const r = org(view).org_acme_reply;
        assert.equal(r.position_display, 3);
        assert.equal(r.position_compose, 4);
        assert.equal(r.position_context, '5');
        assert.equal(r.show_in, 'none');
        assert.equal(r.custom_icon, 'airport.png');
    }
    // show_in "none" takes it out of the invocation view (menus, popup), as for any prompt.
    assert.equal((await ctx.prompts.getPrompts(true)).some(p => p.id === 'org_acme_reply'), false);
    assert.equal((await ctx.prompts.loadPrompt('org_acme_reply')).custom_icon, 'airport.png');
});

test('every other field of the stored entry is ignored: the prompt stays the policy\'s', async () => {
    const r = org(await ctx.prompts.getPromptsForMenuOrder()).org_acme_reply;
    assert.equal(r.text, 'Reply to {%mail_text_body%}');
    assert.equal(r.name, 'ACME reply');
    assert.equal(r.type, '1');
    assert.equal(r.is_org, '1');
    assert.equal(r.is_default, '0');
    assert.equal(r.need_custom_text, '0');
    assert.equal(r.api_type, '');
    assert.equal(r.chatgpt_web_model, '');
    assert.equal(r.chatgpt_web_project, '');
    assert.equal(r.chatgpt_web_custom_gpt, '');
});

test('a malformed entry, or a malformed field, leaves the policy values', async () => {
    const m = org(await ctx.prompts.getPromptsForMenuOrder());
    assert.equal(m.org_acme_summary.show_in, 'both');
    assert.equal(m.org_acme_summary.custom_icon, 'clock.png');
    assert.equal(m.org_acme_plain.position_display, 9);
    assert.equal(m.org_acme_plain.position_compose, undefined);
    assert.equal(m.org_acme_plain.position_context, undefined);
    assert.equal(m.org_acme_plain.show_in, 'both');
    assert.equal(m.org_acme_plain.custom_icon, 'clock.png');
});

test('with no stored entry the policy values, or the normalised defaults, apply', async () => {
    const n = org(await ctx.prompts.getPromptsForMenuOrder()).org_acme_nostore;
    assert.equal(n.show_in, 'popup');
    assert.equal(n.custom_icon, '');
    assert.equal(n.position_display, undefined);
});

test('an entry for an org prompt the policy no longer supplies is harmless', async () => {
    const all = await ctx.prompts.getPromptsForMenuOrder();
    assert.equal(all.some(p => p.id === 'org_acme_gone'), false);
});

test('the policy-supplied prompt itself is never changed by a read', () => {
    const reply = ctx.mztaManaged.getOrgPrompts().find(p => p.id === 'org_acme_reply');
    assert.equal(reply.show_in, 'context');
    assert.equal(reply.custom_icon, 'clock.png');
});

test('round trip: what the Menu Order page saves is what the next read returns', async () => {
    const all = await ctx.prompts.getPromptsForMenuOrder();
    const m = byId(all);
    Object.assign(m.org_acme_nostore, { position_display: 2, position_compose: 2, position_context: 1,
        show_in: 'context', custom_icon: 'airport.png' });
    Object.assign(m.org_acme_reply, { show_in: 'both' });
    // The split of saveAll() in pages/menu_order/.
    await ctx.prompts.setDefaultPromptsProperties(all.filter(p =>
        (String(p.is_default) === '1' || String(p.is_org) === '1') && String(p.is_special) !== '1'));

    const stored = ctx.ctl.localData()._default_prompts_properties;
    assert.equal(stored.org_acme_nostore.show_in, 'context');
    assert.equal('org_acme_gone' in stored, false, 'the save rewrites the store from what is listed');

    const back = org(await ctx.prompts.getPromptsForMenuOrder());
    assert.equal(back.org_acme_nostore.position_display, 2);
    assert.equal(back.org_acme_nostore.position_context, 1);
    assert.equal(back.org_acme_nostore.show_in, 'context');
    assert.equal(back.org_acme_nostore.custom_icon, 'airport.png');
    assert.equal(back.org_acme_reply.show_in, 'both');
    assert.equal(back.org_acme_reply.position_display, 3);

    // ...and after a restart, in the menus.
    const r = await restart({ policy: policy(), local: ctx.ctl.localData() }, 'invocablePrompts');
    const inv = byId(r.result);
    assert.equal(inv.org_acme_nostore.show_in, 'context');
    assert.equal(inv.org_acme_nostore.custom_icon, 'airport.png');
    assert.equal(inv.org_acme_reply.position_display, 3);
});

test('a new _org_id composes new ids: the stored preferences of the old ones do not apply', async () => {
    const r = await restart({ policy: policy('acme2'), local: ctx.ctl.localData() }, 'invocablePrompts');
    const inv = org(r.result);
    assert.deepEqual(Object.keys(inv).sort(),
        ['org_acme2_nostore', 'org_acme2_plain', 'org_acme2_reply', 'org_acme2_summary']);
    assert.equal(inv.org_acme2_reply.show_in, 'context');
    assert.equal(inv.org_acme2_reply.position_display, 7);
    assert.equal(inv.org_acme2_nostore.show_in, 'popup');
});

test('a malformed _default_prompts_properties store breaks nothing', async () => {
    for (const bad of ['garbage', ['org_acme_reply'], 42]) {
        const r = await restart({ policy: policy(), local: { _default_prompts_properties: bad } }, 'invocablePrompts');
        const reply = byId(r.result).org_acme_reply;
        assert.ok(reply, JSON.stringify(bad));
        assert.equal(reply.show_in, 'context');
        assert.equal(reply.custom_icon, 'clock.png');
    }
});
