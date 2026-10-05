// The Task settings page with an API global connection, no per-feature override and stored
// settings (among them a timezone the runtime does not list), no policy.
//
// Spec 05 "Feature Flags" (calendar_enforce_timezone, task_append_email_link), "Timezone Select"
// (the fallback option for an unknown stored id), "Reminder Section", spec 02 "Calendar event /
// task: reminder (#887)" and "Calendar event / task: link to the original email" (as far as the
// page goes: the switch), "Unsaved-Changes Guard", and the shared feature-page sections of
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

// Stored by an older version: not an id the runtime lists.
const OLD_TZ = 'Legacy/Old_Zone';
const STORED = {
    connection_type: 'chatgpt_api',
    calendar_enforce_timezone: true,
    calendar_timezone: OLD_TZ,
    task_append_email_link: true,
};
const ctx = await openPage('get-task', { local: STORED });
after(() => ctx.close());
const k = uiTests('get-task', '01');
const $ = ctx.$;
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_LINK = 'spec 02 "Calendar event / task: link to the original email"';

k.test('restore', S_FLAGS, 'the stored switches are shown', () => {
    assert.equal($('#calendar_enforce_timezone').checked, true);
    assert.equal($('#task_append_email_link').checked, true);
});

k.test('link-switch', S_LINK, 'the email-link switch is stored as task_append_email_link', async () => {
    await userSets(ctx, $('#task_append_email_link'), false);
    assert.strictEqual(ctx.ctl.localData().task_append_email_link, false);
    assert.equal('get_task_append_email_link' in ctx.ctl.localData(), false, 'stored under the integration prefix');
});

inheritedIntegrationTests(ctx, k, { prefix: 'get_task', promptId: 'prompt_get_task' });
promptEditorTests(ctx, k, {
    promptId: 'prompt_get_task', textareaId: 'get_task_prompt_text',
    defaultMsgKey: 'prompt_get_task_full_text',
});
reminderTests(ctx, k, {
    enabledPref: 'task_reminder_enabled', rulesPref: 'task_reminder_rules',
    textareaId: 'get_task_prompt_text', statementsId: 'get_task_info_additional_statements',
    formatMsgKey: 'prompt_task_reminder_format',
});
timezoneTests(ctx, k, { stored: OLD_TZ, known: false });

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
