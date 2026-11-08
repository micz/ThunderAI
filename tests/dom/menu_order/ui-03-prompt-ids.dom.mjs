// The Menu Order page with custom prompts that have the id of a special prompt the page does not
// list, no policy.
//
// Spec 02 "Menu Order Page (`pages/menu_order/`)", "Exclusions from the UI": the excluded prompts are
// chosen among the special ones only (is_special "1") and taken out of the list by object, never by
// id; spec 02 "Prompt ids". Before the startup rename such a profile was possible: the custom prompts
// page checked a new id only against the prompts it lists, which leaves the special ones out. Matched
// by id, Save All moved the custom prompt into _special_prompts, or dropped it from _custom_prompt.
//
// Stored state: a custom prompt with the id of an inactive special prompt (prompt_spamfilter), one
// with the id of an internal one (prompt_summarize_email_template), nothing stored for the built-ins
// and the special prompts; the background reports only summarize as active.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const CUSTOM = [
    { id: 'prompt_spamfilter', name: 'My spam check', text: 'Mine spam', type: '1', action: '0',
      is_default: '0', is_special: '0', show_in: 'popup' },
    { id: 'prompt_summarize_email_template', name: 'My template', text: 'Mine template', type: '1', action: '0',
      is_default: '0', is_special: '0', show_in: 'both' },
];

const ctx = await openPage('menu_order', {
    local: { _custom_prompt: CUSTOM },
    commands: { get_active_special_ids: () => ['prompt_summarize'] },
});
after(() => ctx.close());
const k = uiTests('menu_order', '03');
const $ = ctx.$;

const S_MO = 'spec 02 "Menu Order Page (`pages/menu_order/`)"';

const LISTS = ['popup_list', 'popup_list_hidden', 'context_list', 'context_list_hidden'];
const listedIds = () => new Set(LISTS.flatMap(l => ctx.$$('#' + l + ' > li').map(li => li.dataset.id)));

let saved;

k.test('custom-listed', S_MO, 'both custom prompts are listed, though a special prompt with their id is not', () => {
    const ids = listedIds();
    for (const p of CUSTOM) assert.ok(ids.has(p.id), p.id);
});

k.test('save-keeps-custom', S_MO, 'Save All keeps both in _custom_prompt, with their text', async () => {
    await ctx.click($('#btnResetAll'));
    await ctx.click($('#btnSaveAll'));
    saved = ctx.ctl.localData();
    for (const p of CUSTOM) {
        const mine = (saved._custom_prompt || []).filter(x => x.id === p.id);
        assert.equal(mine.length, 1, p.id + ' deleted');
        assert.equal(mine[0].text, p.text, p.id);
    }
});

k.test('save-specials-clean', S_MO, 'Save All writes each special prompt once into _special_prompts, and no custom prompt', () => {
    const specials = saved._special_prompts || [];
    for (const p of specials) assert.equal(String(p.is_special), '1', p.id + ' is a custom prompt in _special_prompts');
    for (const p of CUSTOM) assert.equal(specials.filter(x => x.id === p.id).length, 1, p.id);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
