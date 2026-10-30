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

import { mztaPrefs } from './mzta-prefs.js';
import { mztaManaged } from './mzta-managed.js';

// Per-account Add Tags settings.
// add_tags_account_settings is a declared preference (prefs_default), so it is read and written
// through js/mzta-prefs.js like every other one. It holds an object keyed by account id:
// { "account1": { add_tags_maxnum: 5, add_tags_exclusions: ["news"], prompt_text: "..." }, ... }.
// The override keys ARE the global preference keys (plus prompt_text, the Add Tags prompt
// text), so applying an entry is a plain merge over the global values. A key missing from an
// entry inherits the global value; an account without an entry uses the global settings.
//
// The key is excluded from the enterprise policy (account ids are per profile), but the policy
// still wins: an override is ignored when the policy locks the corresponding global key, and
// prompt_text is ignored when the policy enforces the Add Tags text. A policy can also take the
// whole feature away (_disable_add_tags_account_settings): every entry is then ignored, never
// deleted. See addTags_resolveAccountPrefs() and addTags_applyAccountPrompt().

// The override keys, prompt_text included.
export const ADD_TAGS_ACCOUNT_KEYS = [
    'prompt_text',
    'add_tags_maxnum',
    'add_tags_force_lang',
    'default_chatgpt_lang',
    'add_tags_auto_force_existing',
    'add_tags_auto_uselist',
    'add_tags_auto_uselist_list',
    'add_tags_exclusions',
    'add_tags_exclusions_exact_match',
];

const BOOLEAN_KEYS = [
    'add_tags_force_lang',
    'add_tags_auto_force_existing',
    'add_tags_auto_uselist',
    'add_tags_exclusions_exact_match',
];

const STRING_KEYS = [
    'default_chatgpt_lang',
    'add_tags_auto_uselist_list',
];

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// The value to keep for an override key, or undefined when the key is unknown or the value
// has the wrong type. Arrays are copied, so a stored entry never shares one with the caller.
function validOverrideValue(key, value) {
    if (key === 'prompt_text') {
        return (typeof value === 'string' && value.trim() !== '') ? value : undefined;
    }
    if (key === 'add_tags_maxnum') {
        return (Number.isInteger(value) && value >= 0) ? value : undefined;
    }
    if (key === 'add_tags_exclusions') {
        return (Array.isArray(value) && value.every(el => typeof el === 'string')) ? [...value] : undefined;
    }
    if (BOOLEAN_KEYS.includes(key)) {
        return typeof value === 'boolean' ? value : undefined;
    }
    if (STRING_KEYS.includes(key)) {
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}

// The entry reduced to the known keys with a valid value: a new object.
function cleanEntry(entry) {
    let clean = {};
    if (!isPlainObject(entry)) return clean;
    for (const key of ADD_TAGS_ACCOUNT_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
        const value = validOverrideValue(key, entry[key]);
        if (value !== undefined) clean[key] = value;
    }
    return clean;
}

export async function addTags_getAccountSettings() {
    let account_settings = await mztaPrefs.getPref('add_tags_account_settings');
    if (!isPlainObject(account_settings)) {
        return {};
    }
    return account_settings;
}

// The account's entry, cleaned (known keys, valid values), or {}.
export async function addTags_getAccountEntry(accountId) {
    if (!accountId) return {};
    const account_settings = await addTags_getAccountSettings();
    if (!Object.prototype.hasOwnProperty.call(account_settings, accountId)) return {};
    return cleanEntry(account_settings[accountId]);
}

// Stores the account's entry (validated: unknown keys and wrong-typed values are dropped, a
// blank prompt_text is no key) and returns the whole updated object. An entry that ends up
// empty removes the account. Never mutates what the preference layer handed out.
export async function addTags_setAccountSettings(accountId, entry) {
    let account_settings = { ...(await addTags_getAccountSettings()) };
    const clean = cleanEntry(entry);
    if (Object.keys(clean).length > 0) {
        account_settings[accountId] = clean;
    } else {
        delete account_settings[accountId];
    }
    await mztaPrefs.setPref('add_tags_account_settings', account_settings);
    return account_settings;
}

// A COPY of prefs with the account's overrides applied, for every override key present in
// prefs whose global key the policy does not lock (a locked key is never overridden: that
// would bypass the policy). prompt_text is never copied into prefs, see
// addTags_applyAccountPrompt(). With no account id or no entry it is still a fresh copy equal
// to prefs, so callers can rely on getting a new object. With the per-account settings disabled
// by the policy it is the same fresh copy: no override applies.
export async function addTags_resolveAccountPrefs(prefs, accountId) {
    let resolved = { ...prefs };
    if (!accountId) return resolved;
    // Read before the restriction is asked: the read is what hydrates the policy in a page.
    const entry = await addTags_getAccountEntry(accountId);
    if (mztaManaged.isAddTagsAccountSettingsDisabled()) return resolved;
    for (const key of Object.keys(entry)) {
        if (key === 'prompt_text') continue;
        if (!Object.prototype.hasOwnProperty.call(resolved, key)) continue;
        if (mztaManaged.isManagedLocked(key)) continue;
        resolved[key] = entry[key];
    }
    return resolved;
}

// Returns the Add Tags prompt to use for a message of the given account: a shallow copy of
// curr_prompt with the account text when the account has its own prompt, otherwise
// curr_prompt itself. A copy, because taPromptUtils.preparePrompt() rewrites prompt.text in
// place and on the menu path curr_prompt is the long-lived menu entry object.
//
// When the policy enforces the Add Tags text (_special_prompts_text, flagged on the prompt by
// getSpecialPrompts() as _text_by_policy) the account prompt is ignored: honouring it would
// bypass the policy. So is it when the policy disables the per-account settings.
export async function addTags_applyAccountPrompt(curr_prompt, accountId) {
    if (!curr_prompt || !accountId || curr_prompt._text_by_policy) {
        return curr_prompt;
    }
    const entry = await addTags_getAccountEntry(accountId);
    if (mztaManaged.isAddTagsAccountSettingsDisabled() || typeof entry.prompt_text !== 'string') {
        return curr_prompt;
    }
    return { ...curr_prompt, text: entry.prompt_text };
}
