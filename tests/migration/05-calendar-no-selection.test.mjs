// migrateCalendarNoSelection() (js/mzta-prompts.js), from spec 05 (the calendar_no_selection row,
// "Preference access") and spec 08 "Interaction points" (calendar_no_selection): the preference is
// now the single source of truth and need_selected of prompt_get_calendar_event is derived from it
// on every read. Before, the stored need_selected drove the behaviour, and the two could disagree;
// so the preference is aligned ONCE to the stored need_selected, "so no unmanaged user changed
// behaviour on upgrade". It compares the user's raw stored values. One-shot flag:
// _migrated_calendar_no_selection.
//
// The behaviour is checked where the spec defines it: need_selected of the calendar prompt as
// getSpecialPrompts() returns it after the migration must equal the need_selected that was stored.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import { writesOf } from './expect.mjs';

const k = caseTests('05-calendar-no-selection');
const run = 'migrateCalendarNoSelection';
const FLAG = '_migrated_calendar_no_selection';

// A stored calendar prompt with no need_selected field at all.
const MISSING = '<missing>';

const calendar = need_selected => {
    const p = {
        id: 'prompt_get_calendar_event', name: '__MSG_prompt_get_calendar_event__',
        text: 'My text {%mail_text_body_or_selected%}', type: '1', action: '0', need_selected,
        need_signature: '0', need_custom_text: '0', define_response_lang: '0', api_type: '',
        is_default: '1', is_special: '1', show_in: 'both',
    };
    if (need_selected === MISSING) delete p.need_selected;
    return p;
};

// [case id, stored need_selected, stored calendar_no_selection (undefined = unset)]
const MATRIX = [
    ['ran-without-unset', '0', undefined],
    ['ran-without-false', '0', false],
    ['ran-without-true', '0', true],
    ['ran-without-number', 0, false],
    ['ran-with-true', '1', true],
    ['ran-with-number-true', 1, true],
    ['ran-with-unset', '1', undefined],
    ['ran-with-false', '1', false],
    // Missing or out of domain: every 5.0.x read it as the shipped "1" (normalizePromptFlags()
    // with the built-in fallback), so it asked for a selection. Spec 05 row calendar_no_selection.
    ['missing-pref-true', MISSING, true],
    ['empty-pref-true', '', true],
    ['null-pref-true', null, true],
    ['boolean-false-pref-true', false, true],
];

const read = { prefs: ['calendar_no_selection'], specialPrompts: true };
const starts = Object.fromEntries(MATRIX.map(([id, need, pref]) => [id, startup({
    run, read,
    local: { _special_prompts: [calendar(need)], ...(pref === undefined ? {} : { calendar_no_selection: pref }) },
})]));
const flagged = startup({ run, read, local: { _special_prompts: [calendar('0')], calendar_no_selection: false, [FLAG]: true } });
const noPrompt = startup({ run, read, local: { connection_type: 'ollama_api' } });
// The preference stored true with no calendar prompt ever stored: the settings page stored the
// preference before rolling the checkbox back (spec 05 row), and the user never saved a special
// prompt. What ran until now was the shipped need_selected "1".
const noPromptTrue = startup({ run, read, local: { calendar_no_selection: true } });

for (const [id, need] of MATRIX) {
    k.test(id, `stored need_selected ${JSON.stringify(need)}: after the migration the calendar prompt behaves as before`, async () => {
        const r = await starts[id];
        assert.equal(r.error, null);
        const ran_without_selection = need === '0' || need === 0;
        assert.equal(r.read.prefs.calendar_no_selection, ran_without_selection, 'the preference');
        const cal = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
        assert.equal(String(cal.need_selected), ran_without_selection ? '0' : '1', 'the derived need_selected');
        assert.equal(r.local[FLAG], true, 'the one-shot flag');
    });
}

k.test('prompt-untouched', 'the stored calendar prompt itself is not rewritten', async () => {
    const r = await starts['ran-without-false'];
    assert.deepEqual(r.local._special_prompts, [calendar('0')]);
});

k.test('flag-short-circuits', 'with the flag set nothing is realigned', async () => {
    const r = await flagged;
    assert.equal(r.local.calendar_no_selection, false);
    assert.deepEqual(writesOf(r.calls), []);
});

k.test('no-stored-prompt', 'no stored calendar prompt and no stored preference: it keeps running with the shipped need_selected "1"', async () => {
    const r = await noPrompt;
    assert.equal(r.error, null);
    assert.equal(r.read.prefs.calendar_no_selection, false);
    const cal = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(String(cal.need_selected), '1');
    assert.equal(r.local[FLAG], true);
});

k.test('no-stored-prompt-pref-true', 'no stored calendar prompt, preference stored true: it keeps asking for a selection, as the shipped prompt did', async () => {
    const r = await noPromptTrue;
    assert.equal(r.error, null);
    const cal = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(String(cal.need_selected), '1', 'the calendar prompt changed behaviour on upgrade');
    assert.equal(r.read.prefs.calendar_no_selection, false);
});

k.coverage();
