// The startup sequence (./sequence.mjs) from partially migrated states.
//
//  - The oldest profile (pre-#129: the prompt payloads still in sync, still carrying `enabled`,
//    no one-shot flag set), over three starts: spec 05 opening (the marker withheld while a payload
//    is in sync, set on the following start), spec 01 "Storage" (the payloads moved to local),
//    spec 02 "Enabled-to-show_in Migration" (enabled 0 -> show_in "none", enabled dropped; after
//    the sync -> local relocation) and "Alphabetic-to-Position Migration" (positions assigned once,
//    every user prompt kept).
//  - An interrupted start: Thunderbird closing at each storage write of the first start in turn
//    (`crashAtWrite`), then normal starts. Whatever the interruption point, the user's settings
//    must end where uninterrupted starts leave them. The marker is compared apart (README,
//    "Under-specified").

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    PAYLOAD_KEYS,
    profile,
    expectedPrefs,
    withoutEnabled,
    withoutPositions,
    writesOf
} from './expect.mjs';

const k = caseTests('12-sequence-partial');
const run = 'sequence';
const OLD = profile('pre-129');
const P = profile('5.0');

const chain = (start, n) => {
    const out = [start];
    for (let i = 1; i < n; i++) {
        const p = out[i - 1].then(r => startup({ run, sync: r.sync, local: r.local }));
        p.catch(() => {});
        out.push(p);
    }
    return out;
};

const [old1, old2, old3] = chain(startup({ run, sync: OLD.sync, local: OLD.local, read: { specialPrompts: true } }), 3);
const [new1, new2] = chain(startup({ run, sync: P.sync, local: P.local }), 2);

const withoutMarker = local => { const o = { ...local }; delete o[MARKER]; return o; };

// --- The oldest profile, three starts ------------------------------------------------------------

k.test('old-first-runs', 'first start: the sequence completes', async () => {
    const r = await old1;
    assert.equal(r.error, null);
    assert.equal(r.value._prefs_migration_ok, true);
});

k.test('old-payloads-moved', 'first start: the payloads are in storage.local and gone from storage.sync', async () => {
    const r = await old1;
    for (const key of ['_custom_prompt', '_default_prompts_properties']) {
        assert.ok(key in r.local, key + ' not in local');
        assert.ok(!(key in r.sync), key + ' still in sync');
    }
});

k.test('old-prefs', 'first start: every preference has the value the spec gives it', async () => {
    const r = await old1;
    for (const [key, value] of Object.entries(expectedPrefs(OLD))) assert.deepEqual(r.local[key], value, key);
});

// The alphabetic migration saves the prompts from the normalized view (getPromptsForMenuOrder()),
// which may add fields at their defaults: what is checked is that every field the user had keeps
// its value.
k.test('old-custom-prompts', 'first start: every custom prompt survives, enabled folded into show_in, every stored field kept', async () => {
    const r = await old1;
    const byId = new Map(r.local._custom_prompt.map(p => [p.id, p]));
    assert.deepEqual([...byId.keys()].sort(), OLD.sync._custom_prompt.map(p => p.id).sort());
    for (const before of OLD.sync._custom_prompt) {
        const now = byId.get(before.id);
        for (const [field, value] of Object.entries(withoutPositions(withoutEnabled(before)))) {
            assert.deepEqual(now[field], value, before.id + '.' + field);
        }
        assert.ok(!('enabled' in now), before.id + ' still carries enabled');
    }
    assert.equal(byId.get('prompt_custom_old').show_in, 'none', 'enabled 0 -> show_in "none"');
    assert.equal(byId.get('prompt_custom_kept').show_in, 'popup');
});

k.test('old-positions', 'first start: the alphabetic migration gave every custom prompt a position, once', async () => {
    const r = await old1;
    for (const p of r.local._custom_prompt) {
        for (const f of ['position_display', 'position_compose', 'position_context']) {
            assert.ok(Number.isInteger(p[f]) && p[f] > 0, p.id + '.' + f + ' = ' + p[f]);
        }
    }
    assert.equal(r.local.dynamic_menu_order_alphabet, false);
});

k.test('old-default-props', 'first start: the built-in prompt disabled through enabled 0 is now show_in "none"', async () => {
    const r = await old1;
    const reply = r.local._default_prompts_properties.prompt_reply;
    assert.equal(reply.show_in, 'none');
    assert.ok(!('enabled' in reply));
});

k.test('old-special-prompts', 'first start: the stored special prompt keeps its text and loses enabled', async () => {
    const r = await old1;
    const cal = r.local._special_prompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(cal.text, OLD.local._special_prompts[0].text);
    assert.ok(!('enabled' in cal));
    const read = r.read.specialPrompts.find(p => p.id === 'prompt_get_calendar_event');
    assert.equal(String(read.need_selected), '1', 'it still asks for a selection, as before');
});

k.test('old-marker-withheld', 'first start: the marker is withheld (a payload was in sync when the copy ran)', async () => {
    const r = await old1;
    assert.ok(!(MARKER in r.local));
});

k.test('old-second-marker', 'second start: the marker is set, and nothing else changes', async () => {
    const r = await old2;
    const prev = await old1;
    assert.equal(r.error, null);
    assert.equal(r.local[MARKER], true);
    assert.deepEqual(withoutMarker(r.local), withoutMarker(prev.local));
    assert.deepEqual(r.sync, prev.sync);
});

k.test('old-third-quiet', 'third start: nothing is written', async () => {
    const r = await old3;
    assert.deepEqual(writesOf(r.calls), []);
    assert.deepEqual(r.local, (await old2).local);
});

// --- A #129 move interrupted between its copy and its remove -------------------------------------

// The payload is then in both areas: the #129 migration keeps the local copy (it is the user's) and
// removes the stale sync copy (spec 05 "Preference access"). Spec 05 "Overview": the marker is withheld while a payload
// is in sync "and the marker is set on the following startup"; spec 01 "Storage": the marker exists
// so that a start does not re-read both areas forever.
const BOTH = { sync: OLD.sync, local: { ...OLD.local, _custom_prompt: OLD.sync._custom_prompt,
    _default_prompts_properties: OLD.sync._default_prompts_properties } };
const [both1, both2, both3] = chain(startup({ run, sync: BOTH.sync, local: BOTH.local }), 3);

k.test('both-areas-settings', 'payload in both areas: the local copy is kept and every preference arrives', async () => {
    const r = await both1;
    assert.equal(r.error, null);
    for (const [key, value] of Object.entries(expectedPrefs(OLD))) assert.deepEqual(r.local[key], value, key);
    for (const p of r.local._custom_prompt) assert.ok(!('enabled' in p), p.id);
});

k.test('both-areas-marker', 'payload in both areas: the marker is set on a following start, and the steady state reached', async () => {
    await both1;
    const r2 = await both2;
    const r3 = await both3;
    assert.equal(r2.local[MARKER], true, 'the marker is never written');
    assert.deepEqual(r3.calls.filter(c => c.area === 'sync'), [], 'every start still reads storage.sync');
});

// --- Interrupted at every write ------------------------------------------------------------------

/**
 * For each storage write of a clean first start, a first start that stops at that write, then
 * two normal starts. Resolves to [{at, crashed, final}].
 */
async function interruptions(prof) {
    const ref = await startup({ run, sync: prof.sync, local: prof.local });
    const points = Array.from({ length: ref.writes }, (_, i) => i + 1);
    return Promise.all(points.map(async at => {
        const crashed = await startup({ run, sync: prof.sync, local: prof.local, crashAtWrite: at });
        const s2 = await startup({ run, sync: crashed.sync, local: crashed.local });
        const s3 = await startup({ run, sync: s2.sync, local: s2.local });
        return { at, crashed, final: s3 };
    }));
}

const oldCuts = interruptions(OLD);
const newCuts = interruptions(P);
oldCuts.catch(() => {});
newCuts.catch(() => {});

for (const [id, cutsP, refP, prof] of [['old', oldCuts, old3, OLD], ['5-0', newCuts, new2, P]]) {
    k.test('interrupted-' + id + '-converges', `${id} profile, interrupted at each write in turn: the next starts end where uninterrupted starts end`, async () => {
        const cuts = await cutsP;
        const ref = await refP;
        assert.ok(cuts.length >= 2, 'too few writes to interrupt: ' + cuts.length);
        for (const { at, crashed, final } of cuts) {
            assert.ok(crashed.crashed, 'write ' + at + ' was never reached');
            assert.equal(final.error, null, 'write ' + at + ': ' + final.error);
            assert.deepEqual(withoutMarker(final.local), withoutMarker(ref.local), 'interrupted at write ' + at);
        }
    });

    k.test('interrupted-' + id + '-nothing-lost', `${id} profile: at no interruption point is a payload missing from both areas`, async () => {
        const cuts = await cutsP;
        for (const { at, crashed } of cuts) {
            for (const key of PAYLOAD_KEYS) {
                if (!(key in prof.local) && !(key in prof.sync)) continue;
                assert.ok(key in crashed.local || key in crashed.sync, key + ' lost when interrupted at write ' + at);
            }
        }
    });
}

k.coverage();
