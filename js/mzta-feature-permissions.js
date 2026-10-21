/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  The features that need an optional Thunderbird API permission, and the permissions each one
 *  needs. The single source of truth for every place that grants, checks or revokes them: the
 *  settings toggles (pages/_lib/permission-toggle.js), the background reconciliation and its
 *  permissions.onRemoved listener, and the runtime guards of the feature paths [#962].
 *
 *  A feature preference listed here is turned on ONLY after permissions.request() resolved to
 *  true, and the background turns it off whenever its permissions are missing (unless the
 *  enterprise policy locks it). See "Feature permissions" in claude-spec/01-architecture.md.
 *
 *  Adding a permission-gated feature: one entry in FEATURE_PERMISSIONS (and its label in
 *  FEATURE_LABEL_KEYS), its permissions in manifest.json optional_permissions, and its toggle
 *  bound through bindPermissionToggle(). Host permissions (origins) are not listed here: they
 *  belong to the connection, not to a feature, and have their own flow.
 *
 *  No imports on purpose: the background, the menus and every settings page load it, and the
 *  level-1 tests read it with nothing installed.
 */

/** Feature preference key -> the optional API permissions it needs. */
export const FEATURE_PERMISSIONS = Object.freeze({
    add_tags: Object.freeze(['messagesTags', 'messagesUpdate']),
    spamfilter: Object.freeze(['messagesMove', 'messagesUpdate']),
    spamfilter_skip_addressbook: Object.freeze(['addressBooks']),
    get_calendar_event_from_clipboard: Object.freeze(['clipboardRead']),
});

// The i18n key naming each feature in the messages about its permission: the label of its
// switch, so the user finds the same words in the settings.
const FEATURE_LABEL_KEYS = Object.freeze({
    add_tags: 'prefs_OptionText_add_tags',
    spamfilter: 'prefs_OptionText_spamfilter',
    spamfilter_skip_addressbook: 'prefs_OptionText_spamfilter_skip_addressbook',
    get_calendar_event_from_clipboard: 'prefs_OptionText_get_calendar_event_from_clipboard',
});

/** True when the preference is a feature gated by optional permissions. */
export function isPermissionGatedPref(key) {
    return Object.prototype.hasOwnProperty.call(FEATURE_PERMISSIONS, key);
}

/** The permissions a feature needs ([] for a preference that is not gated). */
export function getFeaturePermissions(key) {
    return isPermissionGatedPref(key) ? [...FEATURE_PERMISSIONS[key]] : [];
}

/**
 * Whether Thunderbird has granted every permission the feature needs. true for a preference that
 * is not gated. A failing permissions.contains() rejects: the caller decides what an unknown
 * answer means (the reconciliation leaves the flag alone, a runtime guard blocks).
 */
export async function hasFeaturePermissions(key) {
    const permissions = getFeaturePermissions(key);
    if (permissions.length === 0) return true;
    return await browser.permissions.contains({ permissions });
}

/**
 * Ask the user for the permissions the feature needs. Must be the FIRST await of a click or
 * change handler: Thunderbird shows the prompt only within the user gesture. Resolves to true
 * when granted (also when they already were), false when refused; rejects on an API error.
 */
export function requestFeaturePermissions(key) {
    const permissions = getFeaturePermissions(key);
    if (permissions.length === 0) return Promise.resolve(true);
    return browser.permissions.request({ permissions });
}

/**
 * The feature preferences that stop working when the given API permissions are removed (the
 * `permissions` array of a permissions.onRemoved event), in map order.
 */
export function getFeaturesAffectedByRemoval(removed) {
    const set = new Set(Array.isArray(removed) ? removed : []);
    return Object.keys(FEATURE_PERMISSIONS).filter(key => FEATURE_PERMISSIONS[key].some(p => set.has(p)));
}

/** The localized name of a gated feature, as its switch shows it. */
export function getFeatureLabel(key) {
    const label_key = FEATURE_LABEL_KEYS[key];
    return (label_key && browser.i18n.getMessage(label_key)) || key;
}

/** The i18n key of a gated feature's label (for the static tests). */
export function getFeatureLabelKey(key) {
    return FEATURE_LABEL_KEYS[key] || '';
}

/**
 * The message telling the user a feature cannot run because its permission is missing. A feature
 * locked by the enterprise policy cannot be switched off and on again by the user, so `managed`
 * gives the variant pointing to the administrator.
 */
export function getMissingPermissionMessage(key, managed = false) {
    return browser.i18n.getMessage(managed ? 'feature_permission_missing_managed' : 'feature_permission_missing', [getFeatureLabel(key)]);
}
