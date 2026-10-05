// The Calendar Event settings page with an API global connection, no per-feature override and
// stored settings, no policy.
//
// Spec 05 "Feature Flags" (calendar_enforce_timezone, calendar_append_email_link,
// calendar_no_selection: stored, and a change reloads the menus), "Timezone Select", "Reminder
// Section", spec 02 "Calendar event / task: reminder (#887)" and "Calendar event / task: link to
// the original email" (as far as the page goes: the switch), "Unsaved-Changes Guard" (the one
// textarea saves both calendar prompts), and the shared feature-page sections of
// tests/ui/feature-page.mjs.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';
import {
    inheritedIntegrationTests,
    promptEditorTests,
} from '../../ui/feature-page.mjs';
import {
    timezoneTests,
    reminderTests,
} from '../../ui/calendar-task.mjs';

const STORED = {
    connection_type: 'chatgpt_api',
    calendar_enforce_timezone: true,
    calendar_timezone: 'America/New_York',
    calendar_append_email_link: false,
    calendar_no_selection: false,
};
const ctx = await openPage('get-calendar-event', { local: STORED });
after(() => ctx.close());
const k = uiTests('get-calendar-event', '01');
const $ = ctx.$;
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_LINK = 'spec 02 "Calendar event / task: link to the original email"';

k.test('restore', S_FLAGS, 'the stored switches are shown', () => {
    assert.equal($('#calendar_enforce_timezone').checked, true);
    assert.equal($('#calendar_append_email_link').checked, false);
    assert.equal($('#calendar_no_selection').checked, false);
    assert.equal($('#get_calendar_event_from_clipboard').checked, false);
});

k.test('link-switch', S_LINK, 'the email-link switch is stored as calendar_append_email_link', async () => {
    await userSets(ctx, $('#calendar_append_email_link'), true);
    assert.strictEqual(ctx.ctl.localData().calendar_append_email_link, true);
    assert.equal('get_calendar_event_append_email_link' in ctx.ctl.localData(), false, 'stored under the integration prefix');
});

k.test('enforce-tz', S_FLAGS, 'the enforce-timezone switch is stored as a boolean', async () => {
    await userSets(ctx, $('#calendar_enforce_timezone'), false);
    assert.strictEqual(ctx.ctl.localData().calendar_enforce_timezone, false);
});

k.test('no-selection', S_FLAGS, 'calendar_no_selection is stored and the menus are reloaded', async () => {
    const sent = ctx.ctl.sent.length;
    await userSets(ctx, $('#calendar_no_selection'), true);
    assert.strictEqual(ctx.ctl.localData().calendar_no_selection, true);
    assert.ok(ctx.ctl.sent.slice(sent).some(m => m?.command === 'reload_menus'), 'no reload_menus');
    await userSets(ctx, $('#calendar_no_selection'), false);
    assert.strictEqual(ctx.ctl.localData().calendar_no_selection, false);
});

inheritedIntegrationTests(ctx, k, { prefix: 'get_calendar_event', promptId: 'prompt_get_calendar_event' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_get_calendar_event', textareaId: 'get_calendar_event_prompt_text',
    defaultMsgKey: 'prompt_get_calendar_event_full_text',
    extraPromptIds: ['prompt_get_calendar_event_from_clipboard'],
});
reminderTests(ctx, k, {
    enabledPref: 'calendar_reminder_enabled', rulesPref: 'calendar_reminder_rules',
    textareaId: 'get_calendar_event_prompt_text', statementsId: 'get_calendar_event_info_additional_statements',
    formatMsgKey: 'prompt_calendar_reminder_format',
});
timezoneTests(ctx, k, { stored: 'America/New_York', known: true });

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
