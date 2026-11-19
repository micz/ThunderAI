// The default calendar when Sparks answers a malformed list (a hole in the array): treated as no
// list at all, so the page stays usable and the stored choice is kept.

import {
    after,
    test,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    SECTION,
    openDefaultCalendarPage,
} from '../../ui/default-calendar.mjs';

const { ctx, select, status, wrote } = await openDefaultCalendarPage('two', () => Array(1));
after(() => ctx.close());
const k = uiTests('get-calendar-event', '09');

k.test('malformed', SECTION, 'a list with a hole is refused: the select stays disabled, says why and keeps the stored choice', () => {
    assert.equal(select.disabled, true);
    assert.equal(status.textContent, msg('calendar_preferred_load_error'));
    assert.equal(ctx.ctl.localData().calendar_preferred_id, 'two');
    assert.equal(wrote(), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
