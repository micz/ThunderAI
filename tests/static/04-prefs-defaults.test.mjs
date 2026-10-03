// The declarations behind every preference, against what spec 05, spec 08 and CLAUDE.md rule 7
// say about them.
//
// Spec 05 "Global Integration Settings": the per-provider settings are "stored flat in
// prefs_default with {provider}_{key} naming", one per integration_options_config field; spec 08
// "Adding a policy-settable preference": such a field "is at once a global preference" - so each
// `${integration}_${key}` is in prefs_default, with the field's default. Spec 05 "Special Prompt
// Integration Overrides": each special prompt gets `{prefix}_use_specific_integration` (false) and
// `{prefix}_connection_type` ('chatgpt_api'), generated from special_prompts_with_integration;
// plus the global `connection_type` and `use_specific_integration`.
//
// prefs_default declares each key once: an object literal silently keeps the last of two equal
// names, so a key written twice, or written by hand over a generated one, loses a default without
// a word.
//
// CLAUDE.md rule 7 and spec 08 "Content rules": PREF_ENUMS / PREF_NUMBER_RANGES (and the
// per-provider CONNECTION_FIELD_ENUMS) in js/mzta-managed.js give a declared preference the domain
// its type does not express: each names a key that exists, and the key's own default is inside the
// domain (an enumeration's default may be '', the "not selected yet" state spec 05 gives
// connection_type). The tables are module-private, so they are read from the source, never
// exported for the test.
//
// CLAUDE.md rule 7 and spec 08 "Policy-supplied API keys": a secret is named `*_api_key`, and that
// name is what makes it one. Spec 05 "Preference access": the accessor's logging "masks any
// *_api_key value - the same rule isAPIKeyValue() applies"; the managed layer masks it the same way
// (mztaManaged._logValue()), and a hand-written list of the API key fields (the password eye
// toggles of the connection panel) names every one of them.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO, repoPath, captureConsole } from '../helpers/core/load.mjs';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import { declareCheck } from '../helpers/known-issues/static.mjs';
import {
    special_prompts_with_integration,
    integration_options_config,
    valid_connection_types,
    prefs_default
} from '../../options/mzta-options-default.js';
import {
    sourceFiles,
    tokensOf,
    argumentKeys,
    cutLiteral,
    evalLiteral,
    literalEntries
} from './source-scan.mjs';

const DEFAULTS_FILE = 'options/mzta-options-default.js';
const MANAGED_FILE = 'js/mzta-managed.js';
const defaultsSrc = readFileSync(repoPath(DEFAULTS_FILE), 'utf8');
const managedSrc = readFileSync(repoPath(MANAGED_FILE), 'utf8');

// The shipped modules the secret checks call: the managed layer's public objects. js/mzta-prefs.js
// touches `browser` at import time, so the core mock goes first (tests/README.md, "The mock").
installBrowserMock({});
const con = captureConsole();
const imp = rel => import(new URL(rel, REPO).href);
const [{ mztaManaged, featureConnectionTypes }, { mztaPrefs }, { isAPIKeyValue }] =
    await Promise.all([imp(MANAGED_FILE), imp('js/mzta-prefs.js'), imp('js/mzta-utils.js')]);
before(() => con.clear());

const has = key => Object.hasOwn(prefs_default, key);
const show = v => JSON.stringify(v);

// --- derivation -------------------------------------------------------------------------------

// Module-private in mzta-options-default.js: read from its source.
const template = evalLiteral(cutLiteral(defaultsSrc, 'const integration_settings_template', DEFAULTS_FILE));

const integrationKeys = new Map();   // `${integration}_${key}` -> field default
for (const [integration, options] of Object.entries(integration_options_config)) {
    for (const [key, value] of Object.entries(options)) integrationKeys.set(`${integration}_${key}`, value);
}
const promptKeys = new Map();        // `${prefix}_${key}` -> template default
for (const prefix of special_prompts_with_integration) {
    for (const [key, value] of Object.entries(template)) promptKeys.set(`${prefix}_${key}`, value);
}

const derivation = new Map();
const expectDerived = (derived, from) => {
    for (const [key, value] of derived) {
        if (!has(key)) derivation.set(key, 'missing from prefs_default (' + from + ')');
        else if (show(prefs_default[key]) !== show(value)) {
            derivation.set(key, `default ${show(prefs_default[key])}, ${from} says ${show(value)}`);
        }
    }
};
expectDerived(integrationKeys, 'integration_options_config');
expectDerived(promptKeys, 'special_prompts_with_integration x integration_settings_template');
for (const key of ['connection_type', 'use_specific_integration']) {
    if (!has(key)) derivation.set(key, 'missing from prefs_default (spec 05, the global connection selector)');
}

// --- duplicates -------------------------------------------------------------------------------

const entries = literalEntries(cutLiteral(defaultsSrc, 'export const prefs_default', DEFAULTS_FILE));
const explicit = entries.filter(e => e.name !== undefined);
const duplicate = new Map();
const seen = new Map();
for (const { name, line } of explicit) {
    if (seen.has(name)) duplicate.set(name, `declared twice in prefs_default (lines ${seen.get(name)} and ${line})`);
    else seen.set(name, line);
    if (integrationKeys.has(name)) duplicate.set(name, `declared by hand over the generated ${name} of integration_options_config`);
    if (promptKeys.has(name)) duplicate.set(name, `declared by hand, and generated again by special_prompts_with_integration`);
}
for (const key of integrationKeys.keys()) {
    if (promptKeys.has(key)) duplicate.set(key, 'generated both from integration_options_config and from special_prompts_with_integration');
}

// --- validation tables ------------------------------------------------------------------------

const tableDeps = { valid_connection_types, special_prompts_with_integration, featureConnectionTypes };
const PREF_ENUMS = evalLiteral(cutLiteral(managedSrc, 'const PREF_ENUMS', MANAGED_FILE), tableDeps);
const PREF_NUMBER_RANGES = evalLiteral(cutLiteral(managedSrc, 'const PREF_NUMBER_RANGES', MANAGED_FILE), tableDeps);
const CONNECTION_FIELD_ENUMS = evalLiteral(cutLiteral(managedSrc, 'const CONNECTION_FIELD_ENUMS', MANAGED_FILE), tableDeps);

const orphan = new Map();
for (const key of Object.keys(PREF_ENUMS)) if (!has(key)) orphan.set('PREF_ENUMS.' + key, 'no such preference');
for (const key of Object.keys(PREF_NUMBER_RANGES)) if (!has(key)) orphan.set('PREF_NUMBER_RANGES.' + key, 'no such preference');
for (const key of Object.keys(CONNECTION_FIELD_ENUMS)) {
    if (!integrationKeys.has(key)) orphan.set('CONNECTION_FIELD_ENUMS.' + key, 'no such integration_options_config field');
}

const coherence = new Map();
const checkEnum = (key, allowed, table) => {
    if (!has(key)) return;   // an orphan, reported above
    const d = prefs_default[key];
    if (d !== '' && !allowed.includes(d)) coherence.set(key, `default ${show(d)} is not in ${table} ${show(allowed)}`);
};
for (const [key, allowed] of Object.entries(PREF_ENUMS)) checkEnum(key, allowed(), 'PREF_ENUMS');
for (const [key, allowed] of Object.entries(CONNECTION_FIELD_ENUMS)) checkEnum(key, allowed, 'CONNECTION_FIELD_ENUMS');
for (const [key, range] of Object.entries(PREF_NUMBER_RANGES)) {
    if (!has(key)) continue;
    const d = prefs_default[key];
    const inside = typeof d === 'number' && Number.isInteger(d) && d >= 0 &&
        (range.min === undefined || d >= range.min) && (range.max === undefined || d <= range.max);
    if (!inside) coherence.set(key, `default ${show(d)} is outside PREF_NUMBER_RANGES ${show(range)} (a non-negative integer)`);
}

// --- secrets ----------------------------------------------------------------------------------

// What a credential is called, other than "api_key". A bare "key" is not one of the words: it
// would take in prompt_cache_key, which is a cache id, not a secret.
const CREDENTIAL = /(^|_)(token|secret|password|passwd|pwd|credentials?|bearer|auth|authorization|apikey)(_|$)/i;
const secretName = new Map();
for (const [integration, options] of Object.entries(integration_options_config)) {
    for (const key of Object.keys(options)) {
        if (key !== 'api_key' && CREDENTIAL.test(key)) {
            secretName.set(`${integration}_${key}`, 'a credential field of integration_options_config not named api_key');
        }
    }
}
for (const key of Object.keys(prefs_default)) {
    if (!key.endsWith('_api_key') && CREDENTIAL.test(key)) secretName.set(key, 'a credential preference not named *_api_key');
}

const apiKeys = Object.keys(prefs_default).filter(k => k.endsWith('_api_key'));
const SECRET = 'sk-static-test-secret';
const secretTreatment = new Map();
for (const key of apiKeys) {
    if (String(mztaManaged._logValue(key, SECRET)).includes(SECRET)) secretTreatment.set('mztaManaged._logValue:' + key, 'logged in clear');
    if (String(mztaPrefs._logValue(key, SECRET)).includes(SECRET)) secretTreatment.set('mztaPrefs._logValue:' + key, 'logged in clear');
    if (isAPIKeyValue(key) !== true) secretTreatment.set('isAPIKeyValue:' + key, 'not recognised as an API key');
}
// A hand-written list of API key fields: an array literal of two or more static strings, all of
// them *_api_key. A list that also holds other keys (the popup's "is a connection configured"
// list, which checks some providers by host) is something else, and not read as one.
const keyLists = [];
for (const file of sourceFiles()) {
    if (file.kind !== 'js') continue;
    const tokens = tokensOf(file);
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].t !== 'p' || tokens[i].v !== '[') continue;
        const { keys, dynamic } = argumentKeys(tokens, i);
        if (dynamic.length || keys.length < 2 || !keys.every(k => k.v.endsWith('_api_key'))) continue;
        const site = `${file.path}:${tokens[i].line}`;
        keyLists.push(site);
        const named = new Set(keys.map(k => k.v));
        for (const key of apiKeys) if (!named.has(key)) secretTreatment.set(site + ':' + key, 'missing from this list of API key fields');
    }
}

test('the declarations were found where the checks read them', () => {
    assert.ok(Object.keys(template).length > 0, 'integration_settings_template');
    assert.ok(explicit.length > 50 && entries.some(e => e.spread), 'the prefs_default literal, with its spreads');
    assert.ok(Object.keys(PREF_ENUMS).length > 0 && Object.keys(PREF_NUMBER_RANGES).length > 0, 'PREF_ENUMS, PREF_NUMBER_RANGES');
    assert.ok(apiKeys.length > 0, 'the *_api_key preferences');
    assert.ok(keyLists.length > 0, 'at least one list of API key fields (connection-ui.js SECRET_TOGGLE_FIELDS)');
});

declareCheck('derivation', 'every generated preference is in prefs_default, with its generator\'s default', derivation);
declareCheck('duplicate', 'prefs_default declares every key once', duplicate);
declareCheck('orphan-rule', 'every validation rule names a declared preference', orphan);
declareCheck('type-coherence', 'a preference\'s default is inside its own validation domain', coherence);
declareCheck('secret-name', 'every credential is named *_api_key', secretName);
declareCheck('secret-treatment', 'every *_api_key is treated as a secret', secretTreatment);
