// Spec 08 "Hydration in every other context" and "UI": get_managed_values is the ONE channel a
// page gets the policy through. Besides the values it carries the organization prompts, the
// restrictions and the banner state, so a page's prompt views and pages/_lib/managed-ui.js's
// state come from the same hydrated copy - no other background command is involved. The page
// here answers every other command with an error, so a second round trip would show.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage } from '../helpers/load.mjs';

const POLICY = {
    _org_name: 'ACME',
    _org_id: 'acme',
    _org_prompts: [{ id: 'reply', name: 'ACME reply', text: 'Reply to {%mail_text_body%}', type: '1', action: '1' }],
    _disable_prompt_management: true,
    _disable_default_prompts: true,
    _disable_setup_wizard: true,
};
const USER_PROMPT = { id: 'prompt_mine_1', name: 'Mine', text: 'mine', type: '0', action: '0',
                      is_default: '0', is_special: '0', show_in: 'popup' };

let ctx;
const otherCommands = [];

before(async () => {
    ctx = await startPage({
        policy: POLICY,
        local: { _custom_prompt: [USER_PROMPT] },
        sender: SENDERS.options,
        onOtherMessage(message) {
            otherCommands.push(message && message.command);
            throw new Error('unexpected background command ' + JSON.stringify(message));
        },
    });
});

test('the hydrated module holds the org prompts, the org name and the restrictions', async () => {
    await ctx.mztaManaged.managedReady();
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
    assert.equal(ctx.mztaManaged.getOrgName(), 'ACME');
    assert.deepEqual(ctx.mztaManaged.getOrgPrompts().map(p => p.id), ['org_acme_reply']);
    assert.equal(ctx.mztaManaged.isPromptManagementDisabled(), true);
    assert.equal(ctx.mztaManaged.areDefaultPromptsDisabled(), true);
    assert.equal(ctx.mztaManaged.isSetupWizardDisabled(), true);
});

test('the page prompt views apply the org prompts and both restrictions', async () => {
    const invocable = await ctx.prompts.getPrompts();
    assert.ok(invocable.some(p => p.id === 'org_acme_reply'), 'org prompt missing in a page');
    assert.ok(!invocable.some(p => p.id === 'prompt_mine_1'), 'user prompt not inert in a page');
    assert.ok(!invocable.some(p => String(p.is_default) === '1' && String(p.is_special) !== '1'),
        'built-in prompt not disabled in a page');
    const mgmt = await ctx.prompts.getPromptsForManagement();
    assert.equal(mgmt.find(p => p.id === 'prompt_mine_1')._inert_by_policy, true);
});

test('no background command other than get_managed_values was needed', () => {
    assert.deepEqual(otherCommands, []);
});
