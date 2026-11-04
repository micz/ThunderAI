// The default calendar: a stored choice among the calendars Sparks lists, then a user change.

import {
    after,
    test,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';
import {
    CALENDARS,
    SECTION,
    openDefaultCalendarPage,
} from '../../ui/default-calendar.mjs';

const { ctx, select, status, wrote } = await openDefaultCalendarPage('two', () => CALENDARS);
after(() => ctx.close());
const k = uiTests('get-calendar-event', '04');

k.test('listed', SECTION, 'the calendars are listed by name, and only homonyms show provider and ID', () => {
    assert.equal(select.disabled, false);
    assert.equal(select.value, 'two');
    assert.equal(select.options[0].value, '');
    assert.equal(select.options[0].textContent, msg('calendar_preferred_selected'));
    assert.equal(select.options[1].textContent, 'Solo');
    assert.match(select.options[2].textContent, /Same name.*memory.*one/);
    assert.match(select.options[3].textContent, /Same name.*caldav.*two/);
    assert.equal(wrote(), false);
});

k.test('save', SECTION, 'a user choice is stored, and the empty entry clears it', async () => {
    await userSets(ctx, select, 'solo');
    assert.equal(ctx.ctl.localData().calendar_preferred_id, 'solo');
    await userSets(ctx, select, '');
    assert.equal(ctx.ctl.localData().calendar_preferred_id, '');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
