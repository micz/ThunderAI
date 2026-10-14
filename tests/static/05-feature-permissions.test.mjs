// The permission map of the permission-gated features, against the declarations it names [#962].
//
// Spec 01 "Feature permissions" and spec 05 "Permission-gated toggles": FEATURE_PERMISSIONS
// (js/mzta-feature-permissions.js) is the single source of truth for the optional API permissions
// a feature needs:
//  - each key is a preference declared in prefs_default, with a boolean default (a default of
//    true - spamfilter_skip_addressbook's - is turned off by the reconciliation at the first
//    start of a profile that never granted the permission);
//  - each permission it lists is declared in manifest.json optional_permissions (a permission
//    that is not there can never be requested), and is an API permission, not a host one;
//  - each key has its label, an en message, for the missing-permission messages;
//  - nothing else in the shipped code requests or checks an API permission with a list of its
//    own: every permissions.request() / permissions.contains() naming `permissions` goes through
//    the module. Host permissions ({origins}) belong to the connections and are not checked.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { repoPath } from '../helpers/core/load.mjs';
import { declareCheck } from '../helpers/known-issues/static.mjs';
import { prefs_default } from '../../options/mzta-options-default.js';
import {
    FEATURE_PERMISSIONS,
    getFeatureLabelKey
} from '../../js/mzta-feature-permissions.js';
import {
    sourceFiles,
    tokensOf,
    argumentKeys,
    calls
} from './source-scan.mjs';

const MODULE_FILE = 'js/mzta-feature-permissions.js';
const manifest = JSON.parse(readFileSync(repoPath('manifest.json'), 'utf8'));
const optional = new Set(manifest.optional_permissions || []);
const en = JSON.parse(readFileSync(repoPath('_locales/en/messages.json'), 'utf8'));
const enKeys = new Set(Object.keys(en).map(k => k.toLowerCase()));

test('the map is not empty, and the scan finds the calls the module itself makes', () => {
    assert.ok(Object.keys(FEATURE_PERMISSIONS).length > 0);
    const own = tokensOf(sourceFiles().find(f => f.path === MODULE_FILE));
    assert.ok([...calls(own, ['permissions', 'contains'], { anyReceiver: true })].length > 0);
    assert.ok([...calls(own, ['permissions', 'request'], { anyReceiver: true })].length > 0);
});

const mapViolations = new Map();
for (const [key, permissions] of Object.entries(FEATURE_PERMISSIONS)) {
    if (!(key in prefs_default)) mapViolations.set(key, 'not in prefs_default');
    else if (typeof prefs_default[key] !== 'boolean') mapViolations.set(key, 'its default is ' + JSON.stringify(prefs_default[key]) + ', not a boolean');
    if (!Array.isArray(permissions) || permissions.length === 0) mapViolations.set(key, 'no permission listed');
    for (const p of permissions || []) {
        if (/[:/*<]/.test(p)) mapViolations.set(key + ':' + p, 'a host permission, which belongs to the connections');
        else if (!optional.has(p)) mapViolations.set(key + ':' + p, 'not in manifest.json optional_permissions');
    }
    const label = getFeatureLabelKey(key);
    if (!label || !enKeys.has(label.toLowerCase())) mapViolations.set(key + ':label', 'no en message ' + JSON.stringify(label));
}
declareCheck('permission-map', 'every gated preference is a declared boolean, its permissions are optional ones in manifest.json, and it has a label', mapViolations);

const hardcoded = new Map();
for (const f of sourceFiles()) {
    if (f.kind !== 'js' || f.path === MODULE_FILE) continue;
    const tokens = tokensOf(f);
    for (const method of ['request', 'contains', 'remove']) {
        for (const i of calls(tokens, ['permissions', method], { anyReceiver: true })) {
            const { keys } = argumentKeys(tokens, i);
            if (keys.some(k => k.v === 'permissions')) {
                hardcoded.set(f.path + ':' + tokens[i].line, 'permissions.' + method + '() with its own list of API permissions');
            }
        }
    }
}
declareCheck('permission-hardcoded', 'API permissions are requested and checked only through js/mzta-feature-permissions.js', hardcoded);
