// Spec 02 "Alphabetic-to-Position Migration": once dynamic_menu_order_alphabet is false the migration
// does not run again, so the custom ordering the user has set since is kept. A profile where the
// flag is already false, with an ordering that is not alphabetical: nothing is written.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('13b-migration-menu-order-done');

const STORED = {
    dynamic_menu_order_alphabet: false,
    _default_prompts_properties: {
        prompt_this: { position_display: 1, position_compose: 1, position_context: 1, need_custom_text: '0', show_in: 'popup' },
        prompt_reply: { position_display: 2, position_compose: 7, position_context: 3, need_custom_text: '0', show_in: 'popup' },
    },
    _custom_prompt: [
        { id: 'prompt_zeta', name: 'Zeta', text: 'Z', type: '0', action: '0', is_default: '0', is_special: '0',
          show_in: 'popup', position_display: 3, position_compose: 3, position_context: 3 },
    ],
};

let ctx;

before(async () => {
    ctx = await startBackground({ policy: null, local: structuredClone(STORED) });
    await ctx.prompts.migrateMenuOrderAlphabetic();
});

k.test('nothing-written', 'the migration writes nothing', () => {
    assert.deepEqual(ctx.ctl.calls.filter(c => c.op === 'set'), []);
});

k.test('ordering-kept', 'the stored ordering is exactly what it was', () => {
    const data = ctx.ctl.localData();
    for (const key of Object.keys(STORED)) assert.deepEqual(data[key], STORED[key], key);
});

k.coverage();
