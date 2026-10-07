// The alphabetic menu order migration as a step of the startup sequence, on a profile where it
// still has to run (dynamic_menu_order_alphabet never set to false). Spec 02 "Alphabetic-to-Position
// Migration", step 3: the prompts are saved from the normalized view, so a stored prompt may gain
// the fields it lacked, at the defaults every read already applies - no stored value changes, and
// every prompt reads back as before, its positions aside, except that a field the read view lacked
// may now hold its empty default '' (custom_icon of a never-customized built-in prompt), which every
// reader treats as the absent field.
//
// Its ordering rule is the prompts area's (prompts/13a, 13b); here only what the user would notice:
// the prompts as the menus and pages read them, before and after the start.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    profile
} from './expect.mjs';

const k = caseTests('13-sequence-menu-order');
const P = profile('5.0');

// The 5.0.x profile with the preference copy already done, minus the menu order flag, plus a
// sparse custom prompt saved by an old version (most fields missing).
const SPARSE = { id: 'prompt_custom_sparse', name: 'Sparse', text: 'Old {%mail_text_body%}', type: '0', action: '0',
    is_default: '0', is_special: '0', show_in: 'popup' };
const prefs = { ...P.sync };
delete prefs.dynamic_menu_order_alphabet;
const local = { ...P.local, ...prefs, [MARKER]: true,
    _custom_prompt: [...P.local._custom_prompt, SPARSE] };

const POSITIONS = ['position_display', 'position_compose', 'position_context'];
// idnum is the row number a view gives each entry, renumbered on every read (spec 02).
const VIEW_ONLY = ['idnum'];
const strip = p => {
    const o = { ...p };
    for (const f of [...POSITIONS, ...VIEW_ONLY]) delete o[f];
    return o;
};

const before = startup({ run: null, local, read: { menuOrderView: true } });
const after = startup({ run: 'sequence', local, read: { menuOrderView: true } });

k.test('it-runs', 'the menu order migration runs (its flag is written)', async () => {
    const r = await after;
    assert.equal(r.error, null);
    assert.equal(r.local.dynamic_menu_order_alphabet, false);
});

k.test('reads-back-the-same', 'every prompt reads back as before, its positions aside; a field it lacked only as ""', async () => {
    const b = new Map((await before).read.menuOrderView.map(p => [p.id, p]));
    const a = new Map((await after).read.menuOrderView.map(p => [p.id, p]));
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'the set of prompts changed');
    for (const [id, p] of b) {
        const now = strip(a.get(id));
        for (const [field, value] of Object.entries(now)) {
            if (!(field in p)) assert.equal(value, '', id + '.' + field + ' appeared with a value other than ""');
        }
        for (const field of Object.keys(now)) if (!(field in p)) delete now[field];
        assert.deepEqual(now, strip(p), id);
    }
});

k.test('stored-values-kept', 'no stored value changes: every field a stored custom prompt had keeps its value', async () => {
    const r = await after;
    const byId = new Map(r.local._custom_prompt.map(p => [p.id, p]));
    for (const stored of local._custom_prompt) {
        for (const [field, value] of Object.entries(stored)) {
            if (POSITIONS.includes(field)) continue;
            assert.deepEqual(byId.get(stored.id)[field], value, stored.id + '.' + field);
        }
    }
});

k.test('sparse-gains-defaults', 'the sparse prompt may gain fields: only at the value the view already gave it', async () => {
    const r = await after;
    const view = new Map((await before).read.menuOrderView.map(p => [p.id, p])).get(SPARSE.id);
    const stored = r.local._custom_prompt.find(p => p.id === SPARSE.id);
    for (const field of Object.keys(stored)) {
        if (field in SPARSE || POSITIONS.includes(field)) continue;
        assert.deepEqual(stored[field], view[field], 'added ' + field + ' differs from what every read gave');
    }
});

k.coverage();
