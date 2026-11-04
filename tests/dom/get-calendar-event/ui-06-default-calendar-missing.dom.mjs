// The default calendar when the stored one can no longer receive events.

import {
    after,
    test,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    CALENDARS,
    SECTION,
    openDefaultCalendarPage,
} from '../../ui/default-calendar.mjs';

const { ctx, select, status, wrote } = await openDefaultCalendarPage('deleted', () => CALENDARS);
after(() => ctx.close());
const k = uiTests('get-calendar-event', '06');

k.test('missing', SECTION, 'a calendar no longer listed stays selected, disabled and explained, and is not rewritten', () => {
    assert.equal(select.value, 'deleted');
    assert.equal(select.selectedOptions[0].disabled, true);
    assert.equal(select.selectedOptions[0].textContent, msg('calendar_preferred_missing'));
    assert.equal(status.textContent, msg('calendar_preferred_missing_info'));
    assert.equal(wrote(), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
