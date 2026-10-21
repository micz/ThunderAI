// Spec 08 "Enforced special prompt texts", Validation: the calendar text is copied to the
// clipboard variant "unless the policy names that id too (even with an invalid value - an
// administrator who named it did not ask for the copy)". Also: response keys are matched
// case-sensitively ("spamvalue" is not "spamValue").

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('special-prompts-text-calendar-named.json');

let ctx;

before(async () => {
    ctx = await startBackground({ policy: POLICY });
});

test('the calendar text is enforced', () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_get_calendar_event'),
        POLICY._special_prompts_text.prompt_get_calendar_event);
});

test('the named-but-invalid clipboard text is rejected and NOT replaced by the calendar copy', async () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_get_calendar_event_from_clipboard'), undefined);
    const clip = (await ctx.prompts.getSpecialPrompts())
        .find(p => p.id === 'prompt_get_calendar_event_from_clipboard');
    assert.equal(clip.text, ctx.ctl.browser.i18n.getMessage('prompt_get_calendar_event_full_text'));
    assert.equal('_text_by_policy' in clip, false);
    assert.ok(ctx.con.warnings().some(w => w.includes('prompt_get_calendar_event_from_clipboard')));
});

test('a response key in the wrong case does not satisfy the contract', () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_spamfilter'), undefined);
    assert.ok(ctx.con.warnings().some(w => w.includes('prompt_spamfilter') && w.includes('spamValue')));
});
