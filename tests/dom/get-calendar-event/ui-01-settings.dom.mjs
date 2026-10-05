// The Calendar Event settings page with an API global connection, no per-feature override and
// stored settings, no policy.
//
// Spec 05 "Feature Flags" (calendar_enforce_timezone, calendar_append_email_link,
// calendar_no_selection: stored, a change reloads the menus, and its body-placeholder guards;
// get_calendar_event_from_clipboard and its clipboardRead permission), "Timezone Select", "Reminder
// Section", spec 02 "Calendar event / task: reminder (#887)" and "Calendar event / task: link to
// the original email" (as far as the page goes: the switch), "Unsaved-Changes Guard" (the one
// textarea saves both calendar prompts), and the shared feature-page sections of
// tests/ui/feature-page.mjs.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';
import {
    inheritedIntegrationTests,
    promptEditorTests,
    storedPrompt,
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
const permissions = {};       // .request swapped by a test (the harness reads it per call)
const ctx = await openPage('get-calendar-event', { local: STORED, permissions });
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

k.test('clipboard-on', S_FLAGS, 'switching the clipboard event on asks for clipboardRead, stores true and reloads the menus', async () => {
    const asked = ctx.apiCalls('browser.permissions.request').length;
    const sent = ctx.ctl.sent.length;
    await userSets(ctx, $('#get_calendar_event_from_clipboard'), true);
    assert.deepEqual(ctx.apiCalls('browser.permissions.request').slice(asked).map(c => c.args[0].permissions), [['clipboardRead']]);
    assert.strictEqual(ctx.ctl.localData().get_calendar_event_from_clipboard, true);
    assert.ok(ctx.ctl.sent.slice(sent).some(m => m?.command === 'reload_menus'), 'no reload_menus');
});

k.test('clipboard-off', S_FLAGS, 'switching it off stores false, asks nothing and reloads the menus', async () => {
    const asked = ctx.apiCalls('browser.permissions.request').length;
    const sent = ctx.ctl.sent.length;
    await userSets(ctx, $('#get_calendar_event_from_clipboard'), false);
    assert.equal(ctx.apiCalls('browser.permissions.request').length, asked);
    assert.strictEqual(ctx.ctl.localData().get_calendar_event_from_clipboard, false);
    assert.ok(ctx.ctl.sent.slice(sent).some(m => m?.command === 'reload_menus'), 'no reload_menus');
});

k.test('clipboard-denied', S_FLAGS, 'refused: back off with an alert, and false stays stored', async () => {
    permissions.request = () => false;
    try {
        const dialogs = ctx.dialogs.length;
        await userSets(ctx, $('#get_calendar_event_from_clipboard'), true);
        assert.equal($('#get_calendar_event_from_clipboard').checked, false);
        assert.deepEqual(ctx.dialogs.slice(dialogs), [{ kind: 'alert', args: [msg('clipboard_permission_denied')] }]);
        assert.strictEqual(ctx.ctl.localData().get_calendar_event_from_clipboard, false);
    } finally {
        delete permissions.request;
    }
});

const NO_BODY = 'Extract the event from {%mail_subject%}.';
const typeText = async (text) => {
    const ta = $('#get_calendar_event_prompt_text');
    ta.value = text;
    await ctx.fire(ta, 'input');
};

k.test('no-selection-refused', S_FLAGS, 'switching it on with a prompt in the editor that does not read the body: alert, back off, false stored', async () => {
    await typeText(NO_BODY);
    const dialogs = ctx.dialogs.length;
    await userSets(ctx, $('#calendar_no_selection'), true);
    assert.equal($('#calendar_no_selection').checked, false);
    assert.strictEqual(ctx.ctl.localData().calendar_no_selection, false);
    assert.deepEqual(ctx.dialogs.slice(dialogs), [{ kind: 'alert', args: [msg('prefs_OptionText_calendar_no_selection_missing_placeholder')] }]);
    await typeText(msg('prompt_get_calendar_event_full_text'));
});

k.test('no-selection-save-refused', S_FLAGS, 'while it is on, Save refuses a text without the body placeholder', async () => {
    await userSets(ctx, $('#calendar_no_selection'), true);
    assert.strictEqual(ctx.ctl.localData().calendar_no_selection, true);
    const before = storedPrompt(ctx, 'prompt_get_calendar_event')?.text;
    await typeText(NO_BODY);
    const dialogs = ctx.dialogs.length;
    await ctx.click($('#btn_save_prompt'));
    assert.deepEqual(ctx.dialogs.slice(dialogs), [{ kind: 'alert', args: [msg('prefs_OptionText_calendar_no_selection_save_missing_placeholder')] }]);
    assert.equal(storedPrompt(ctx, 'prompt_get_calendar_event')?.text, before, 'the text was saved');
    assert.equal($('#btn_save_prompt').disabled, false);
});

k.test('no-selection-save-accepted', S_FLAGS, 'with the placeholder Save goes through', async () => {
    const text = NO_BODY + ' {%mail_html_body_or_selected%}';
    await typeText(text);
    await ctx.click($('#btn_save_prompt'));
    assert.equal(storedPrompt(ctx, 'prompt_get_calendar_event')?.text, text);
    // back to the shipped text and the option off, for the editor tests below
    await typeText(msg('prompt_get_calendar_event_full_text'));
    await ctx.click($('#btn_save_prompt'));
    await userSets(ctx, $('#calendar_no_selection'), false);
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
