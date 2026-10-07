// The startup migration sequence of mzta-background.js, run as it stands in the file (cut by
// ./sequence.mjs, see README), on a 5.0.x profile: the upgrade every 5.0.x user makes to 5.1.0,
// then the second and third start.
//
// Spec: 05 opening ("runs first", local wins, sync left in place, the marker), 01 "Storage",
// 02 "Alphabetic-to-Position Migration" / "Enabled-to-show_in Migration" (one-shot flags carried
// across, so neither re-runs and the custom menu order and show_in survive), 04 (ollama_think in
// level form, global only), 05 row calendar_no_selection (aligned once to the stored
// need_selected), 04 "When a policy locks the override off" (the migration block runs before
// loadManaged() and must not make the background message itself).
//
// The invariant above all: the user's settings survive.

import assert from 'node:assert/strict';
import { prefs_default } from '../../options/mzta-options-default.js';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    PAYLOAD_KEYS,
    profile,
    expectedPrefs,
    writesOf,
    callsTo
} from './expect.mjs';

const k = caseTests('10-sequence-upgrade');
const run = 'sequence';
const P = profile('5.0');
const EXPECTED = expectedPrefs(P);
const DECLARED = Object.keys(EXPECTED).filter(key => key in prefs_default);
const read = { prefs: DECLARED, specialPrompts: true };

const first = startup({ run, sync: P.sync, local: P.local, read });
const second = first.then(r => startup({ run, sync: r.sync, local: r.local }));
const third = second.then(r => startup({ run, sync: r.sync, local: r.local }));
second.catch(() => {});
third.catch(() => {});

// The stored need_selected "1" disagrees with calendar_no_selection true in sync: the alignment
// must see the COPIED preference, so the copy has to have run before it.
const CAL = profile('5.0');
CAL.local._special_prompts.find(p => p.id === 'prompt_get_calendar_event').need_selected = '1';
const calendar = startup({ run, sync: CAL.sync, local: CAL.local, read });

// --- The first start -----------------------------------------------------------------------------

k.test('runs-clean', 'the sequence completes, with the preference copy reported as done', async () => {
    const r = await first;
    assert.equal(r.error, null);
    assert.equal(r.value._prefs_migration_ok, true);
});

k.test('prefs-survive', 'every preference is in storage.local with the value the spec gives it', async () => {
    const r = await first;
    for (const [key, value] of Object.entries(EXPECTED)) assert.deepEqual(r.local[key], value, key);
});

k.test('prefs-read-back', 'every declared preference reads back through mztaPrefs with that value', async () => {
    const r = await first;
    for (const key of DECLARED) assert.deepEqual(r.read.prefs[key], EXPECTED[key], key);
});

k.test('payloads-intact', 'the prompt payloads and the stored records are byte for byte what they were', async () => {
    const r = await first;
    for (const key of [...PAYLOAD_KEYS, 'msg:42']) assert.deepEqual(r.local[key], P.local[key], key);
});

k.test('menu-order-kept', 'the custom menu order is kept: no prompt renumbered', async () => {
    const r = await first;
    const pos = p => [p.position_display, p.position_compose, p.position_context];
    assert.deepEqual(r.local._custom_prompt.map(p => [p.id, pos(p)]),
        [['prompt_custom_zeta', [3, 1, 2]], ['prompt_custom_alpha', [1, 3, 1]]]);
    assert.deepEqual(pos(r.local._default_prompts_properties.prompt_reply), [2, 2, 3]);
    assert.deepEqual(pos(r.local._default_prompts_properties.prompt_this), [4, 4, 4]);
    assert.deepEqual(pos(r.local._special_prompts.find(p => p.id === 'prompt_spamfilter')), [5, 5, 5]);
});

k.test('show-in-kept', 'show_in is kept on every prompt, "none" included', async () => {
    const r = await first;
    assert.deepEqual(r.local._custom_prompt.map(p => p.show_in), ['context', 'none']);
    assert.equal(r.local._default_prompts_properties.prompt_this.show_in, 'none');
    assert.deepEqual(r.local._special_prompts.map(p => p.show_in), ['both', 'context']);
});

k.test('connections-kept', 'the connection settings and the per-feature override are kept', async () => {
    const r = await first;
    for (const key of ['connection_type', 'chatgpt_api_key', 'chatgpt_model', 'add_tags_use_specific_integration',
        'add_tags_connection_type', 'add_tags_anthropic_api_key', 'add_tags_anthropic_model']) {
        assert.deepEqual(r.local[key], P.sync[key], key);
    }
    const spam = r.read.specialPrompts.find(p => p.id === 'prompt_spamfilter');
    assert.equal(spam.api_type, 'ollama_api');
    assert.equal(spam.ollama_model, 'llama3');
});

k.test('ollama-think', 'ollama_think arrives in level form, the per-feature copy untouched', async () => {
    const r = await first;
    assert.equal(r.local.ollama_think, 'false');
    assert.equal(r.local.add_tags_ollama_think, true);
});

k.test('sync-left', 'storage.sync is left exactly as it was', async () => {
    const r = await first;
    assert.deepEqual(r.sync, P.sync);
});

k.test('marker', 'the marker is set: storage.sync held no payload', async () => {
    const r = await first;
    assert.equal(r.local[MARKER], true);
});

k.test('no-self-message', 'the migrations send no runtime message (the background would message itself)', async () => {
    const r = await first;
    assert.deepEqual(r.sent, []);
});

k.test('calendar-after-copy', 'calendar_no_selection is aligned against the copied preference', async () => {
    const r = await calendar;
    assert.equal(r.error, null);
    assert.equal(r.local.calendar_no_selection, false, 'stored need_selected "1": the prompt asked for a selection');
    const cal = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(String(cal.need_selected), '1');
});

// --- Second and third start ----------------------------------------------------------------------

for (const [id, startP, prevP] of [['second', second, first], ['third', third, second]]) {
    k.test(id + '-writes-nothing', `the ${id} start writes nothing and never touches storage.sync`, async () => {
        const r = await startP;
        assert.equal(r.error, null);
        assert.equal(r.value._prefs_migration_ok, true);
        assert.deepEqual(writesOf(r.calls), []);
        assert.deepEqual(callsTo(r.calls, 'sync'), []);
    });

    k.test(id + '-same-storage', `after the ${id} start storage is exactly what the previous one left`, async () => {
        const r = await startP;
        const prev = await prevP;
        assert.deepEqual(r.local, prev.local);
        assert.deepEqual(r.sync, prev.sync);
    });
}

k.coverage();
