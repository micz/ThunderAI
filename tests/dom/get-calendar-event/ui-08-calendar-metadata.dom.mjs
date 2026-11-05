// The note under the prompt on the Calendar Event settings page. Spec 02 "Calendar event: native
// categories and URI links": the prompt decides, and an edited one is told what it leaves out.

import {
    after,
    test,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, openPage } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('get-calendar-event', { local: { connection_type: 'chatgpt_api' } });
after(() => ctx.close());
const k = uiTests('get-calendar-event', '08');
const $ = ctx.$;
const S = 'spec 02 "Calendar event: native categories and URI links"';
const noted = () => $('#calendar_metadata_prompt_note').classList.contains('shown');
const setPrompt = async text => {
    const area = $('#get_calendar_event_prompt_text');
    area.value = text;
    await ctx.fire(area, 'input');
};

k.test('shipped-prompt', S, 'the shipped prompt asks for both: no note, and no option to set', () => {
    assert.equal(noted(), false);
    assert.equal($('#calendar_metadata_enabled'), null);
});

k.test('note', S, 'an edited prompt leaving a field out is flagged, live', async () => {
    await setPrompt('Mine, no token');
    assert.equal(noted(), true);
    await setPrompt('Mine: {%calendar_categories%}');
    assert.equal(noted(), true);
    await setPrompt('Mine: {%calendar_categories%} {% mail_links %}');
    assert.equal(noted(), false);
    await setPrompt('Mine: "categories": [], "links": []');
    assert.equal(noted(), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
