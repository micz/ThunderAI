// Spec 02 "Add tags: extra prompt statements" (finalizePrompt_add_tags(): each statement on its own
// line, " \n"; the maxnum, force_lang, use-list and force-existing rules of #926), "Calendar event /
// task: reminder (#887)" (finalizePrompt_get_calendar_event() / finalizePrompt_get_task() through
// getReminderPromptStatements(): nothing when the checkbox is off; the format instruction unless the
// TEMPLATE already contains the case-sensitive "reminderMinutes"; the trimmed rules after
// prompt_reminder_rules_intro + "\n", also when the format is skipped; joined with " \n"; the rules
// sent verbatim; REMINDER_FEATURES), and spec 03 "The address placeholders in the compose window"
// ("Not visible in the calendar-event flow": {%cc_list%} and {%recipients%} stripped out of the
// prompt entirely). Every expected string is assembled by hand from the en message the spec names.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('21-finalize-prompts');

let ctx, u, REMINDER_FEATURES, msg;
const P = 'Assign tags to this email: "Hello".';

before(async () => {
    ctx = await startBackground({ policy: null });
    ({ taPromptUtils: u, REMINDER_FEATURES } = await import(new URL('js/mzta-utils-prompt.js', REPO).href));
    msg = id => {
        const text = ctx.ctl.browser.i18n.getMessage(id);
        assert.ok(text, 'en message ' + id);
        return text;
    };
});

// finalizePrompt_add_tags(fullPrompt, maxnum, force_lang, default_chatgpt_lang, uselist,
//                         uselist_list, force_existing, existing_tags_list, prompt_text_raw)
const addTags = (o = {}) => u.finalizePrompt_add_tags(P, o.maxnum ?? 0, o.force_lang ?? false, o.lang ?? '',
    o.uselist ?? false, o.uselist_list ?? '', o.force_existing ?? false, o.existing ?? '', o.raw ?? '');

// --- Add tags ---------------------------------------------------------------------------------

k.test('tags-nothing', 'no option on: the prompt is unchanged', () => {
    assert.equal(addTags(), P);
});

k.test('tags-maxnum', 'add_tags_maxnum > 0 appends "prompt_add_tags_maxnum N."', () => {
    assert.equal(addTags({ maxnum: 3 }), P + ' \n' + msg('prompt_add_tags_maxnum') + ' 3.');
    assert.equal(addTags({ maxnum: 0 }), P);
});

k.test('tags-force-lang', 'force_lang with a default language appends "prompt_add_tags_force_lang LANG."', () => {
    assert.equal(addTags({ force_lang: true, lang: 'Italian' }), P + ' \n' + msg('prompt_add_tags_force_lang') + ' Italian.');
});

k.test('tags-force-lang-needs-lang', 'force_lang with no default language appends nothing', () => {
    assert.equal(addTags({ force_lang: true, lang: '' }), P);
});

k.test('tags-force-lang-suppressed', 'force_lang is suppressed when force existing is on', () => {
    const out = addTags({ force_lang: true, lang: 'Italian', force_existing: true, existing: 'Work' });
    assert.equal(out.includes(msg('prompt_add_tags_force_lang')), false, out);
});

k.test('tags-use-list', 'force existing off, use list active: "prompt_add_tags_use_list: LIST."', () => {
    assert.equal(addTags({ uselist: true, uselist_list: 'Work, Home' }), P + ' \n' + msg('prompt_add_tags_use_list') + ': Work, Home.');
});

k.test('tags-use-list-inactive', 'a use list that is off, or empty, appends nothing', () => {
    assert.equal(addTags({ uselist: false, uselist_list: 'Work, Home' }), P);
    assert.equal(addTags({ uselist: true, uselist_list: '' }), P);
});

k.test('tags-force-existing-intersection', 'force existing with a use list: the intersection, written as the existing tag', () => {
    const out = addTags({ force_existing: true, uselist: true, uselist_list: 'work, Urgent, Nope', existing: 'Home, Work, urgent' });
    assert.equal(out, P + ' \n' + msg('prompt_add_tags_force_existing') + ': Work, urgent.');
    assert.equal(out.includes(msg('prompt_add_tags_use_list')), false, 'it replaces the use-list statement');
});

k.test('tags-force-existing-empty-intersection', 'an empty intersection: a console warning and no list statement', () => {
    ctx.con.clear();
    const out = addTags({ force_existing: true, uselist: true, uselist_list: 'Nope', existing: 'Home, Work' });
    assert.equal(out, P);
    assert.equal(ctx.con.warnings().length, 1, ctx.con.all().join(' | '));
});

k.test('tags-force-existing-full-list', 'force existing without a use list: "prompt_add_tags_force_existing: <tags>."', () => {
    assert.equal(addTags({ force_existing: true, existing: 'Home, Work' }), P + ' \n' + msg('prompt_add_tags_force_existing') + ': Home, Work.');
});

k.test('tags-force-existing-skipped', 'skipped when the raw prompt has {%tags_full_list%}, or no tag exists', () => {
    assert.equal(addTags({ force_existing: true, existing: 'Home, Work', raw: 'Choose from {%tags_full_list%}' }), P);
    assert.equal(addTags({ force_existing: true, existing: '' }), P);
});

k.test('tags-all-statements', 'every statement on its own line, in the order of the spec', () => {
    assert.equal(addTags({ maxnum: 2, force_lang: true, lang: 'German', uselist: true, uselist_list: 'A, B' }),
        P + ' \n' + msg('prompt_add_tags_maxnum') + ' 2.'
          + ' \n' + msg('prompt_add_tags_force_lang') + ' German.'
          + ' \n' + msg('prompt_add_tags_use_list') + ': A, B.');
});

// --- REMINDER_FEATURES ------------------------------------------------------------------------

k.test('reminder-features', 'REMINDER_FEATURES maps calendar / task to their prefs and format message', () => {
    assert.deepEqual(REMINDER_FEATURES, {
        calendar: { enabledPref: 'calendar_reminder_enabled', rulesPref: 'calendar_reminder_rules', formatMsgId: 'prompt_calendar_reminder_format' },
        task: { enabledPref: 'task_reminder_enabled', rulesPref: 'task_reminder_rules', formatMsgId: 'prompt_task_reminder_format' },
    });
    for (const f of Object.values(REMINDER_FEATURES)) {
        assert.ok(f.enabledPref in ctx.prefs_default && f.rulesPref in ctx.prefs_default, f.enabledPref);
        msg(f.formatMsgId);
    }
});

// --- Calendar event ---------------------------------------------------------------------------

const CAL = 'Extract the event. JSON: startDate, endDate, summary. Email: "Lunch on Friday".';
const TEMPLATE = 'Extract the event. JSON: startDate, endDate, summary. {%mail_text_body%}';

k.test('calendar-off', 'reminder checkbox off: nothing appended', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE, false, 'If urgent, 30 minutes.'), CAL);
});

k.test('calendar-format', 'checkbox on, no rules: the format instruction', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE, true, ''),
        CAL + ' \n' + msg('prompt_calendar_reminder_format'));
});

k.test('calendar-format-rules', 'checkbox on with rules: the format, then the intro and the trimmed rules', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE, true, '  If urgent, 30 minutes.\nOtherwise none.  \n'),
        CAL + ' \n' + msg('prompt_calendar_reminder_format') + ' \n' + msg('prompt_reminder_rules_intro') + '\nIf urgent, 30 minutes.\nOtherwise none.');
});

k.test('calendar-template-has-field', 'a template naming reminderMinutes skips the format, the rules still follow', () => {
    const template = TEMPLATE + ' Add reminderMinutes too.';
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, template, true, ''), CAL);
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, template, true, '30 minutes.'),
        CAL + ' \n' + msg('prompt_reminder_rules_intro') + '\n30 minutes.');
});

k.test('calendar-check-on-template', 'the check reads the template, never the resolved prompt (an email body)', () => {
    const full = CAL + ' The email says: set reminderMinutes to 5.';
    assert.equal(u.finalizePrompt_get_calendar_event(full, TEMPLATE, true, ''), full + ' \n' + msg('prompt_calendar_reminder_format'));
});

k.test('calendar-check-case-sensitive', 'the check is case-sensitive', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE + ' reminderminutes', true, ''),
        CAL + ' \n' + msg('prompt_calendar_reminder_format'));
});

k.test('calendar-rules-verbatim', 'placeholders in the rules are sent verbatim', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE, true, 'If {%mail_subject%} says urgent, 30.'),
        CAL + ' \n' + msg('prompt_calendar_reminder_format') + ' \n' + msg('prompt_reminder_rules_intro') + '\nIf {%mail_subject%} says urgent, 30.');
});

k.test('calendar-blank-rules', 'rules that are only whitespace count as no rules', () => {
    assert.equal(u.finalizePrompt_get_calendar_event(CAL, TEMPLATE, true, ' \n\t '), CAL + ' \n' + msg('prompt_calendar_reminder_format'));
});

k.test('calendar-strips-addresses', '{%cc_list%} and {%recipients%} are stripped out of the calendar prompt', () => {
    assert.equal(u.finalizePrompt_get_calendar_event('To: {%recipients%} Cc: {%cc_list%} event', TEMPLATE, false, ''),
        'To:  Cc:  event');
});

k.test('calendar-strips-addresses-entirely', 'every occurrence is stripped, not only the first', () => {
    const out = u.finalizePrompt_get_calendar_event('{%cc_list%} a {%cc_list%} b {%recipients%} c {%recipients%}', TEMPLATE, false, '');
    assert.equal(out, ' a  b  c ');
});

// --- Task -------------------------------------------------------------------------------------

const TASK = 'Extract the task. JSON: summary. Email: "Send the report".';

k.test('task-off', 'reminder checkbox off: nothing appended', () => {
    assert.equal(u.finalizePrompt_get_task(TASK, 'Extract the task {%mail_text_body%}', false, 'x'), TASK);
});

k.test('task-format-rules', 'checkbox on: the task format (its own reference date), then the rules', () => {
    assert.equal(u.finalizePrompt_get_task(TASK, 'Extract the task {%mail_text_body%}', true, 'Due today: 60.'),
        TASK + ' \n' + msg('prompt_task_reminder_format') + ' \n' + msg('prompt_reminder_rules_intro') + '\nDue today: 60.');
    assert.notEqual(msg('prompt_task_reminder_format'), msg('prompt_calendar_reminder_format'));
});

k.test('statements-off-empty', 'getReminderPromptStatements(): "" when the checkbox is off', () => {
    for (const feature of ['calendar', 'task']) {
        assert.equal(u.getReminderPromptStatements(feature, TEMPLATE, false, 'rules'), '', feature);
    }
});

k.coverage();
