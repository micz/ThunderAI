// The default calendar of the Calendar Event settings page, opened with a stored choice and a
// Sparks answer. Spec 05 "Feature Flags" (calendar_preferred_id). One file = one page, so each
// stored state has its own ui-* file.

import { openPage } from '../helpers/core/dom-harness.mjs';
import { writtenSince } from './dom-helpers.mjs';

export const SECTION = 'spec 05 "Feature Flags"';
export const CALENDARS = [
    { id: 'solo', name: 'Solo', type: 'storage' },
    { id: 'one', name: 'Same name', type: 'memory' },
    { id: 'two', name: 'Same name', type: 'caldav' },
];

export async function openDefaultCalendarPage(stored, answer) {
    const ctx = await openPage('get-calendar-event', {
        local: { connection_type: 'chatgpt_api', ...(stored === undefined ? {} : { calendar_preferred_id: stored }) },
        external: async (_id, message) => message.action === 'listWritableCalendars' ? answer() : null,
    });
    return {
        ctx,
        select: ctx.$('#calendar_preferred_id'),
        status: ctx.$('#calendar_preferred_status'),
        wrote: () => 'calendar_preferred_id' in writtenSince(ctx, 0),
    };
}
