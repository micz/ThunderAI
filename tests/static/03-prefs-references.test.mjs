// CLAUDE.md rule 7 and spec 05 "Adding a New Preference": every preference is declared in
// prefs_default (options/mzta-options-default.js). Spec 05 "Preference access": every read and
// write goes through mztaPrefs (js/mzta-prefs.js), and "defaults come from prefs_default and
// from nowhere else"; an id with no prefs_default entry is a mistake (the accessor only warns).
//
// So every preference key the code names statically exists in prefs_default:
//   - mztaPrefs.getPref / getPrefs / setPref / setPrefs: the string, the array of strings, the
//     keys of the object literal;
//   - prefs_default.<key> and prefs_default['<key>']: the get({key: prefs_default.key}) idiom
//     and its variants (PREFS_INIT_KEYS in mzta-background.js, prefsToGet in the API chat);
//   - a direct browser.storage.local / storage.sync get() with literal keys, the deliberate
//     bypasses spec 05 "What deliberately does *not* go through the accessor" lists. Not
//     preferences, and skipped: a key with a leading underscore (spec 05 "Overview": the large
//     payloads and the migration markers) and the flags spec 05 names as "not preferences: no UI,
//     no prefs_default entry" (NOT_PREFERENCES below).
// A key built at run time is listed by the "unresolvable" test, never failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefs_default } from '../../options/mzta-options-default.js';
import { declareCheck } from '../helpers/known-issues/static.mjs';
import {
    sourceFiles,
    tokensOf,
    calls,
    argumentKeys,
    isStatic,
    where
} from './source-scan.mjs';

// Spec 05 "UI & Feature Preferences" (the dynamic_menu_order_alphabet row) and "What deliberately
// does *not* go through the accessor" (the two one-shot migration flags of js/mzta-prompts.js).
const NOT_PREFERENCES = new Set(['dynamic_menu_order_alphabet']);

const used = new Map();      // key -> ["file:line form", ...]
const unresolvable = [];
const add = (key, site) => {
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(site);
};

const ACCESSORS = ['getPref', 'getPrefs', 'setPref', 'setPrefs'];
const RAW_READS = [['browser', 'storage', 'local', 'get'], ['browser', 'storage', 'sync', 'get'],
    ['messenger', 'storage', 'local', 'get'], ['messenger', 'storage', 'sync', 'get']];

let accessorSites = 0;
for (const file of sourceFiles()) {
    if (file.kind !== 'js') continue;
    const tokens = tokensOf(file);
    for (const fn of ACCESSORS) {
        for (const i of calls(tokens, ['mztaPrefs', fn])) {
            accessorSites++;
            const { keys, dynamic } = argumentKeys(tokens, i);
            keys.forEach(k => add(k.v, `${file.path}:${k.line} ${fn}()`));
            dynamic.forEach(line => unresolvable.push(`${file.path}:${line} ${fn}()`));
        }
    }
    for (const path of RAW_READS) {
        for (const i of calls(tokens, path)) {
            const { keys, dynamic } = argumentKeys(tokens, i);
            keys.filter(k => !k.v.startsWith('_') && !NOT_PREFERENCES.has(k.v))
                .forEach(k => add(k.v, `${file.path}:${k.line} storage.${path[2]}.get()`));
            // get(null) reads everything: no key to check, nothing unresolved.
            if (!(tokens[i] && tokens[i].v === 'null')) {
                dynamic.forEach(line => unresolvable.push(`${file.path}:${line} storage.${path[2]}.get()`));
            }
        }
    }
    for (let i = 0; i + 2 < tokens.length; i++) {
        const t = tokens[i];
        if (t.t !== 'id' || t.v !== 'prefs_default' || (i > 0 && tokens[i - 1].v === '.')) continue;
        const op = tokens[i + 1];
        const k = tokens[i + 2];
        if (op.v === '.' && k.t === 'id') add(k.v, `${file.path}:${k.line} prefs_default.${k.v}`);
        else if (op.v === '[') {
            if (isStatic(k) && tokens[i + 3] && tokens[i + 3].v === ']') add(k.v, `${file.path}:${k.line} prefs_default[]`);
            else unresolvable.push(`${file.path}:${k.line} prefs_default[...]`);
        }
    }
}

const undeclared = new Map();
for (const [key, sites] of used) {
    if (!Object.hasOwn(prefs_default, key)) undeclared.set(key, where(sites));
}

test('the scan sees the accessor calls and the prefs_default idiom', () => {
    assert.ok(accessorSites > 50, 'mztaPrefs calls found (' + accessorSites + ')');
    assert.ok([...used.values()].flat().some(s => s.includes('mzta-background.js') && s.includes('prefs_default.')),
        'prefs_default.<key> in mzta-background.js (PREFS_INIT_KEYS)');
});

test('unresolvable preference keys, listed and not checked', (t) => {
    t.diagnostic(unresolvable.length + ' key(s) built at run time: ' + unresolvable.join('; '));
});

declareCheck('undeclared-pref', 'every preference key the code reads or writes is declared in prefs_default', undeclared);
