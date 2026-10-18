/*
 *  What the spec says a migration must leave behind, as data the tests compare storage with.
 *  Everything here is derived from the spec, never from the code under test:
 *
 *   - PAYLOAD_KEYS: the large-payload keys of spec 01 "Storage" / spec 05 opening, owned by the
 *     #129 migrations, never by the preference copy;
 *   - MARKER: `_prefs_migrated_from_sync`, spec 05 opening;
 *   - expectedPrefs(): spec 05 / spec 01 (every key sync holds, local wins on conflict) with the
 *     two conversions the spec documents on top of the copy: ollama_think (spec 04) and
 *     calendar_no_selection (spec 05 table row, spec 08 "Interaction points").
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import { loadFixture } from '../helpers/core/load.mjs';

export const PAYLOAD_KEYS = ['_custom_prompt', '_default_prompts_properties', '_special_prompts', '_custom_placeholder'];
export const MARKER = '_prefs_migrated_from_sync';

/** A profile of tests/fixtures/migration/ ({sync, local}), fresh each time. */
export function profile(name) {
    const p = loadFixture('profile-' + name + '.json', 'migration');
    return { sync: p.sync, local: p.local };
}

/** The key names a storage call reads: get(null) -> null, get('k'), get(['k']), get({k: d}). */
export function keyNames(keys) {
    if (keys === null || keys === undefined) return null;
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
}

export const writesOf = calls => calls.filter(c => c.op === 'set' || c.op === 'remove' || c.op === 'clear');
export const callsTo = (calls, area) => calls.filter(c => c.area === area);

/** The value the old boolean ollama_think maps to (spec 04): true -> 'true', false -> 'false'. */
export function ollamaThinkLevel(v) {
    return typeof v === 'boolean' ? (v ? 'true' : 'false') : v;
}

/**
 * The preferences storage.local must hold once every migration has run, by spec:
 *  - every key storage.sync holds, except the payloads (spec 05 opening, spec 01 "Storage");
 *  - a key already in storage.local keeps the local value (never reverts a later change);
 *  - ollama_think in level form (spec 04);
 *  - calendar_no_selection aligned once to the stored need_selected of the calendar prompt, when
 *    one is stored (spec 05 table row "calendar_no_selection").
 * Only keys the spec says something about are returned; the internal one-shot flags the
 * migrations add are not (they are asserted where the spec names them).
 */
export function expectedPrefs({ sync = {}, local = {} }) {
    const out = {};
    for (const [k, v] of Object.entries(sync)) {
        if (PAYLOAD_KEYS.includes(k)) continue;
        out[k] = structuredClone(v);
    }
    for (const [k, v] of Object.entries(local)) {
        if (PAYLOAD_KEYS.includes(k) || k.startsWith('msg:')) continue;
        out[k] = structuredClone(v);
    }
    if ('ollama_think' in out) out.ollama_think = ollamaThinkLevel(out.ollama_think);
    const specials = local._special_prompts ?? sync._special_prompts;
    const calendar = Array.isArray(specials) ? specials.find(p => p.id === 'prompt_get_calendar_event') : undefined;
    if (calendar) {
        const ran_without_selection = calendar.need_selected === '0' || calendar.need_selected === 0;
        const was = 'calendar_no_selection' in out ? out.calendar_no_selection === true : false;
        if (ran_without_selection !== was) out.calendar_no_selection = ran_without_selection;
    }
    return out;
}

/** The payloads a profile holds, wherever they are ({key: value}): local wins, as for #129. */
export function payloadsOf({ sync = {}, local = {} }) {
    const out = {};
    for (const k of PAYLOAD_KEYS) {
        if (k in local) out[k] = structuredClone(local[k]);
        else if (k in sync) out[k] = structuredClone(sync[k]);
    }
    return out;
}

/**
 * A prompt payload after migrateEnabledToShowIn() (spec 02 "Enabled-to-show_in Migration"):
 * `enabled` 0 / "0" / false -> show_in "none"; `enabled` dropped either way.
 */
export function withoutEnabled(prompt) {
    const p = structuredClone(prompt);
    if ('enabled' in p) {
        if (p.enabled === 0 || p.enabled === '0' || p.enabled === false) p.show_in = 'none';
        delete p.enabled;
    }
    return p;
}

/** The same prompt without its menu positions (rewritten by the alphabetic migration, spec 02). */
export function withoutPositions(prompt) {
    const p = structuredClone(prompt);
    delete p.position_display;
    delete p.position_compose;
    delete p.position_context;
    return p;
}
