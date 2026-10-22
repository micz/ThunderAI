// Spec 08 "Enforced special prompt texts", Validation: "the value must be a plain object".
// Anything else is warned about and nothing is enforced; the shipped texts stay in effect.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('special-prompts-text-malformed.json') });
});

test('an array is not accepted: nothing is enforced, with a warning', async () => {
    assert.deepEqual(ctx.mztaManaged.getSpecialPromptsText(), {});
    assert.ok(ctx.con.warnings().some(w => w.includes('_special_prompts_text')));
    const specials = await ctx.prompts.getSpecialPrompts();
    assert.ok(specials.every(p => !('_text_by_policy' in p)));
    assert.equal(specials.find(p => p.id === 'prompt_spamfilter').text,
        ctx.ctl.browser.i18n.getMessage('prompt_spamfilter_full_text'));
});

test('a policy whose only content was rejected is not active', () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), false);
});
