// The default calendar when Sparks gives no list: missing, too old, or no answer.

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

const { ctx, select, status, wrote } = await openDefaultCalendarPage('two', () => { throw new Error('absent'); });
after(() => ctx.close());
const k = uiTests('get-calendar-event', '07');

k.test('no-sparks', SECTION, 'without a calendar list the select stays disabled, says why and keeps the stored choice', () => {
    assert.equal(select.disabled, true);
    assert.equal(status.textContent, msg('calendar_preferred_load_error'));
    assert.equal(ctx.ctl.localData().calendar_preferred_id, 'two');
    assert.equal(wrote(), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
