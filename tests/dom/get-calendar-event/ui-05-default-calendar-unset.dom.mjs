// The default calendar with nothing stored.

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

const { ctx, select, status, wrote } = await openDefaultCalendarPage(undefined, () => CALENDARS);
after(() => ctx.close());
const k = uiTests('get-calendar-event', '05');

k.test('unset', SECTION, 'no stored choice shows the selected-calendar entry, not a blank select', () => {
    assert.equal(select.value, '');
    assert.equal(select.selectedIndex, 0);
    assert.equal(select.selectedOptions[0].textContent, msg('calendar_preferred_selected'));
    assert.equal(wrote(), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
