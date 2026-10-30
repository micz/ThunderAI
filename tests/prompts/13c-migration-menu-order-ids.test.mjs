// Spec 02 "Alphabetic-to-Position Migration" step 2 and "Prompt ids": the hidden special prompts are
// matched by is_special "1" as well as by id, so a custom prompt that has one of their ids stays a
// custom prompt. Before the startup rename existed such a profile was possible (a custom id was only
// checked against the prompts the custom prompts page lists, which leaves the special ones out).
// The migration runs once on a real user's data: the custom prompt must neither move to
// _special_prompts nor disappear from _custom_prompt.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('13c-migration-menu-order-ids');

const ID = 'prompt_summarize_email_template';

const STORED = {
    _custom_prompt: [
        { id: ID, name: 'My template prompt', text: 'Mine {%mail_text_body%}', type: '1', action: '0',
          is_default: '0', is_special: '0', show_in: 'both' },
    ],
    _special_prompts: [
        { id: ID, name: '__MSG_prompt_summarize_email_template__', text: 'The template {%mail_text_body%}',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'none' },
    ],
};

let ctx, p;

before(async () => {
    ctx = await startBackground({ policy: null, local: structuredClone(STORED) });
    p = ctx.prompts;
    await p.migrateMenuOrderAlphabetic();
});

const local = key => ctx.ctl.localData()[key];

k.test('custom-kept', 'the custom prompt is still in _custom_prompt, with its text, and gets a position', () => {
    const mine = local('_custom_prompt').filter(x => x.id === ID);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].text, 'Mine {%mail_text_body%}');
    assert.equal(typeof mine[0].position_display, 'number');
});

k.test('special-store-clean', '_special_prompts holds the hidden special prompt once, and no custom prompt', () => {
    const entries = local('_special_prompts').filter(x => x.id === ID);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].is_special, '1');
    assert.equal(entries[0].text, 'The template {%mail_text_body%}');
    assert.equal(entries[0].position_display, undefined, 'a hidden special prompt gets no position');
    for (const prompt of local('_special_prompts')) assert.equal(String(prompt.is_special), '1', prompt.id);
});

k.coverage();
