// The Calendar Event settings page with its own Claude connection stored in the special prompt,
// stale get_calendar_event_* preferences and no global connection, no policy: spec 05 "Mandatory
// Specific Integration (feature settings pages)", "The Prompt Is Authoritative For API
// Parameters" (see tests/ui/feature-page.mjs, ownIntegrationScenario()). No timezone stored:
// spec 05 "Timezone Select" (the empty value is a valid choice).

import assert from 'node:assert/strict';
import { ownIntegrationScenario } from '../../ui/feature-page.mjs';
import { S_TZ } from '../../ui/calendar-task.mjs';

await ownIntegrationScenario({
    page: 'get-calendar-event', nn: '02', prefix: 'get_calendar_event', promptId: 'prompt_get_calendar_event',
    defaultMsgKey: 'prompt_get_calendar_event_full_text', global: '',
    extraTests(ctx, k) {
        k.test('tz-empty-ok', S_TZ, 'with no timezone stored the select is empty, with no red "missing" border', () => {
            const sel = ctx.$('#calendar_timezone');
            assert.equal(sel.value, '');
            assert.equal(sel.hasAttribute('data-empty-ok'), true);
            assert.doesNotMatch(sel.tomselect.control.style.border, /red/);
        });
    },
});
