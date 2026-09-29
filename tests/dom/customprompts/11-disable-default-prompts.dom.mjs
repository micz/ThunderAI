// Spec 08 "_disable_default_prompts" -> "Where it is enforced", on pages/customprompts/: the
// built-in prompts stay listed and read-only, but dimmed (.is_dimmed), with
// #managed_restriction_defaults_note once for the page and
// customPrompts_policy_default_inert_note in the detail editor's banner - "without them a
// prompt that has silently vanished from every menu reads as a bug". The user's own prompts
// are untouched, and prompt management stays available (the two restrictions are independent).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const USER_PROMPTS = [
    { id: 'prompt_mine_1', name: 'Mine', text: 'my text', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
];
const ctx = await openPage('customprompts', {
    policy: loadFixture('disable-default-prompts.json'),
    local: { _custom_prompt: USER_PROMPTS },
});
after(() => ctx.close());

const rowOf = id => ctx.$$('.p_row').find(r => r.querySelector('.p-id')?.textContent === id);

test('the page-level defaults note is shown, the prompt-management note is not', () => {
    assert.equal(ctx.$('#managed_restriction_defaults_note').classList.contains('shown'), true);
    assert.equal(ctx.$('#managed_restriction_note').classList.contains('shown'), false);
});

test('every built-in prompt is listed and dimmed; the user prompt is not dimmed', () => {
    const builtins = ctx.$$('.p_row').filter(r => r.querySelector('.p-id')?.textContent.startsWith('prompt_')
        && r.querySelector('.p-id').textContent !== 'prompt_mine_1');
    assert.ok(builtins.length > 0, 'no built-in prompt listed');
    for (const r of builtins) assert.equal(r.classList.contains('is_dimmed'), true, r.querySelector('.p-id').textContent);
    assert.equal(rowOf('prompt_mine_1').classList.contains('is_dimmed'), false);
});

test('a built-in prompt, opened, explains why it is not in the menus', async () => {
    await ctx.click(rowOf('prompt_reply').querySelector('.btnRowEdit'));
    assert.equal(ctx.$('#detail_id').value, 'prompt_reply');
    assert.ok(ctx.$('#detail_banner').textContent.includes(msg('customPrompts_policy_default_inert_note')));
});

test('prompt management stays available', () => {
    assert.equal(ctx.$('#btnNew').disabled, false);
    assert.notEqual(ctx.$('#import_export').style.display, 'none');
});

test('no policy mark is persisted', () => {
    assert.equal(JSON.stringify(ctx.ctl.localData()).includes('_default_inert_by_policy'), false);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
