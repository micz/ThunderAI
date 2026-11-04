// "Let the AI fill in categories and links" on the Calendar Event settings page. Spec 02 "Calendar
// event: native categories and URI links": one switch, and a warning when the live prompt text
// asks for them with the switch off.

import {
    after,
    test,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, openPage } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';

const ctx = await openPage('get-calendar-event', { local: { connection_type: 'chatgpt_api' } });
after(() => ctx.close());
const k = uiTests('get-calendar-event', '08');
const $ = ctx.$;
const S = 'spec 02 "Calendar event: native categories and URI links"';
const box = $('#calendar_metadata_enabled');
const warned = () => $('#calendar_metadata_prompt_warning').classList.contains('shown');
const setPrompt = async text => {
    const area = $('#get_calendar_event_prompt_text');
    area.value = text;
    await ctx.fire(area, 'input');
};

k.test('off-by-default', S, 'the option is off and nothing is stored on load', () => {
    assert.equal(box.checked, false);
    assert.equal(warned(), false);
    assert.equal('calendar_metadata_enabled' in ctx.ctl.localData(), false);
});

k.test('warning', S, 'a prompt asking for categories or links with the option off is flagged, live', async () => {
    await setPrompt('Mine: {%calendar_categories%}');
    assert.equal(warned(), true);
    await setPrompt('Mine, no token');
    assert.equal(warned(), false);
    await setPrompt('Mine: {% mail_links %}');
    assert.equal(warned(), true);
});

k.test('stored', S, 'the switch is stored, and turning it on clears the warning', async () => {
    await userSets(ctx, box, true);
    assert.strictEqual(ctx.ctl.localData().calendar_metadata_enabled, true);
    assert.equal(warned(), false);
    await userSets(ctx, box, false);
    assert.strictEqual(ctx.ctl.localData().calendar_metadata_enabled, false);
    assert.equal(warned(), true);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
