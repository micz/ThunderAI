/*
 *  The ui area's tests shared by the Calendar Event and Task settings pages, no policy: the
 *  timezone select (spec 05 "Timezone Select") and the reminder section (spec 05 "Reminder
 *  Section", spec 02 "Calendar event / task: reminder (#887)"). Both pages carry the same markup
 *  and call the same pages/_lib/ modules, so each page file runs these on its own open page.
 *
 *  Area-local: imports only the core and the area's own helpers.
 */

import assert from 'node:assert/strict';
import { msg } from '../helpers/core/dom-harness.mjs';
import { userSets } from './dom-helpers.mjs';
import { leaveBlocked, S_GUARD } from './feature-page.mjs';

export const S_TZ = 'spec 05 "Timezone Select (`pages/_lib/mzta-timezones.js`)"';
export const S_REM = 'spec 05 "Reminder Section (Calendar Event / Task pages, `pages/_lib/reminder-ui.js`)"';
export const S_REM02 = 'spec 02 "Calendar event / task: reminder (#887)"';

const LABEL_RE = /^\(UTC([+-])(\d\d):(\d\d)\) (\S+)$/;

/**
 * cfg.stored: the calendar_timezone stored for this page ('' for none); cfg.known: whether it is
 * a zone the runtime lists (else restoreOptions() must inject a fallback option for it).
 */
export function timezoneTests(ctx, k, { stored, known }) {
    const sel = () => ctx.$('#calendar_timezone');

    // The dropdown shows Tom Select's options in insertion order ($order, sortField null); the
    // native <select> is not the list the user sees (Tom Select moves the selected option).
    const listed = () => Object.values(sel().tomselect.options)
        .sort((x, y) => x.$order - y.$order)
        .filter(o => o.value !== '' && (known || o.value !== stored));

    k.test('tz-generated', S_TZ, 'the select holds the empty option and the runtime zones, labelled "(UTC±HH:MM) Area/City"', () => {
        assert.ok([...sel().options].some(o => o.value === ''), 'no empty option');
        const zones = listed();
        assert.ok(zones.length > 300, zones.length + ' zones');
        const bad = zones.filter(o => { const m = LABEL_RE.exec(o.text); return !m || m[4] !== o.value; }).map(o => o.text);
        assert.deepEqual(bad.slice(0, 5), []);
    });

    k.test('tz-sorted', S_TZ, 'the zones are listed by UTC offset, then by id', () => {
        const zones = listed().map(o => {
            const m = LABEL_RE.exec(o.text);
            return { id: o.value, min: (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) };
        });
        for (let i = 1; i < zones.length; i++) {
            const a = zones[i - 1], b = zones[i];
            assert.ok(a.min < b.min || (a.min === b.min && a.id.localeCompare(b.id) <= 0),
                `${a.id} (${a.min}) before ${b.id} (${b.min})`);
        }
    });

    k.test('tz-tomselect', S_TZ, 'it is a searchable Tom Select with no option cap, no re-sorting, closing after a pick', () => {
        const ts = sel().tomselect;
        assert.ok(ts, 'not a Tom Select');
        assert.equal(ts.settings.maxOptions, null);
        assert.equal(ts.settings.closeAfterSelect, true);
        assert.equal(ts.settings.sortField, null, 'sorted by label: the negative offsets would follow the positive ones');
    });

    k.test('tz-restore', S_TZ, 'the stored timezone is selected, as one option only', () => {
        assert.equal(sel().value, stored);
        if (stored) {
            const same = [...sel().options].filter(o => o.value === stored);
            assert.equal(same.length, 1, 'duplicated');
            if (!known) assert.ok(same[0].text.endsWith(stored), 'the injected fallback label: ' + same[0].text);
        }
    });

    if (!stored) {
        k.test('tz-empty-ok', S_TZ, 'an empty timezone is a valid choice: no red "missing" border', () => {
            assert.equal(sel().hasAttribute('data-empty-ok'), true);
            assert.doesNotMatch(sel().tomselect.control.style.border, /red/);
        });
    }

    k.test('tz-write', S_TZ, 'a pick is stored as the plain IANA id', async () => {
        const ts = sel().tomselect;
        const since = ctx.ctl.calls.length;
        ts.setValue('Europe/Rome');
        await ctx.settle();
        const writes = ctx.localWrites(since).filter(w => 'calendar_timezone' in w.items);
        assert.equal(writes.at(-1)?.items.calendar_timezone, 'Europe/Rome');
        assert.doesNotMatch(ts.control.style.border, /red/);
    });
}

/**
 * cfg: feature ('calendar' | 'task'), enabledPref, rulesPref, textareaId (the main prompt),
 * statementsId (the page's #{prefix}_info_additional_statements), formatMsgKey.
 */
export function reminderTests(ctx, k, { enabledPref, rulesPref, textareaId, statementsId, formatMsgKey }) {
    const $ = ctx.$;
    const box = () => $('#' + enabledPref);
    const rules = () => $('#reminder_rules');
    const save = () => $('#btn_save_reminder_rules');
    const warning = () => $('#reminder_prompt_warning');
    const preview = () => $('#' + statementsId);
    const prompt = () => $('#' + textareaId);
    const formatShown = () => preview().querySelector('.reminder_statements_format')?.textContent ?? null;
    const rulesShown = () => preview().querySelector('.reminder_statements_rules') ?? null;

    k.test('rem-placed', S_REM, 'the section comes after the prompt section', () => {
        const prompt_section = prompt().closest('.mzta_section');
        const section = $('#reminder_container');
        assert.ok(prompt_section.compareDocumentPosition(section) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING);
    });

    k.test('rem-off', S_REM, 'off: the rules are hidden, no warning, nothing previewed', () => {
        assert.equal(box().checked, false);
        assert.equal($('#reminder_rules_block').style.display, 'none');
        assert.equal(warning().classList.contains('shown'), false);
        assert.equal(preview().style.display, 'none');
    });

    k.test('rem-plain-textarea', S_REM, 'the rules textarea is plain: no placeholder editor', () => {
        assert.equal(rules().classList.contains('editor'), false);
        assert.equal(rules().classList.contains('option-input'), false, 'saved on change');
    });

    k.test('rem-on', S_REM02, 'on: stored, the rules shown, and the format instruction previewed', async () => {
        await userSets(ctx, box(), true);
        assert.strictEqual(ctx.ctl.localData()[enabledPref], true);
        assert.equal($('#reminder_rules_block').style.display, 'block');
        assert.notEqual(preview().style.display, 'none');
        assert.equal(formatShown(), msg(formatMsgKey));
        assert.equal(rulesShown(), null);
    });

    k.test('rem-rules-dirty', S_GUARD, 'typing rules enables Save and the unsaved mark, previews them, and leaving asks', async () => {
        rules().value = '  30 minutes before meetings.  ';
        await ctx.fire(rules(), 'input');
        assert.equal(save().disabled, false);
        assert.equal($('#reminder_rules_unsaved').classList.contains('hidden'), false);
        assert.equal(leaveBlocked(ctx), true);
        const r = rulesShown();
        assert.ok(r, 'the rules are not previewed');
        assert.equal(r.querySelector('b')?.textContent, msg('prompt_reminder_rules_intro'));
        assert.ok(r.textContent.endsWith('30 minutes before meetings.'), r.textContent);
    });

    k.test('rem-rules-save', S_REM, 'Save stores the rules trimmed and disables itself', async () => {
        await ctx.click(save());
        assert.equal(ctx.ctl.localData()[rulesPref], '30 minutes before meetings.');
        assert.equal(rules().value, '30 minutes before meetings.');
        assert.equal(save().disabled, true);
        assert.equal($('#reminder_rules_unsaved').classList.contains('hidden'), true);
        assert.equal(leaveBlocked(ctx), false);
    });

    k.test('rem-template-has-field', S_REM02, 'a main prompt that already asks for reminderMinutes: no format instruction, the rules still', async () => {
        prompt().value = prompt().value + ' Add "reminderMinutes".';
        await ctx.fire(prompt(), 'input');
        assert.equal(formatShown(), null);
        assert.ok(rulesShown(), 'the rules are not previewed');
        assert.equal(warning().classList.contains('shown'), false, 'warning while on');
    });

    k.test('rem-warning', S_REM, 'off with reminderMinutes in the live prompt: the warning shows, nothing previewed', async () => {
        await userSets(ctx, box(), false);
        assert.strictEqual(ctx.ctl.localData()[enabledPref], false);
        assert.equal(warning().classList.contains('shown'), true);
        assert.equal(preview().style.display, 'none');
        assert.equal($('#reminder_rules_block').style.display, 'none');
    });

    k.test('rem-warning-gone', S_REM, 'the warning follows the live prompt text', async () => {
        prompt().value = msg('prompt_' + (enabledPref.startsWith('calendar') ? 'get_calendar_event' : 'get_task') + '_full_text');
        await ctx.fire(prompt(), 'input');
        assert.equal(warning().classList.contains('shown'), false);
    });
}
