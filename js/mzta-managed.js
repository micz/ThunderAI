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
 *  Enterprise managed configuration.
 *
 *  Reads the Thunderbird enterprise policy for this add-on, exposed by the browser as
 *  browser.storage.managed. The policy is written by an administrator as:
 *
 *      policies.json -> "3rdparty" -> "Extensions" -> "thunderai@micz.it"
 *
 *  This module only READS and VALIDATES the policy. The resolution order that makes it
 *  take effect lives in js/mzta-prefs.js, which is the single choke point for every
 *  preference read and write:
 *
 *      locked policy value > user value in storage.local > unlocked policy value > prefs_default
 *
 *  Two hard constraints shape everything here:
 *
 *  1. It must be loaded ONLY in the background page. browser.storage.managed.get() is
 *     known to fail on options pages in Thunderbird, so every other context obtains the
 *     managed state through browser.runtime.sendMessage instead. Nothing in this file may
 *     depend on a DOM.
 *
 *  2. The policy is read ONCE, at startup. Thunderbird fires no change events for the
 *     managed storage area, so there is nothing to listen for and no live reload: an
 *     administrator's change takes effect at the next Thunderbird start. This is
 *     documented for administrators in docs/enterprise-configuration.md.
 *
 *  With no policy installed - which is the case for nearly every user - storage.managed
 *  REJECTS. That is the normal path, not an error, so it is swallowed silently and the
 *  add-on behaves exactly as it did before this module existed.
 */

import {
    prefs_default,
    valid_connection_types
} from '../options/mzta-options-default.js';
import { taLogger } from './mzta-logger.js';

// Policy keys starting with an underscore are structures and metadata, never preferences.
// No key in prefs_default starts with an underscore, so the two namespaces cannot collide.
const POLICY_SCHEMA_VERSION = '_schema_version';
const POLICY_ORG_NAME = '_org_name';
const POLICY_ORG_ID = '_org_id';
const POLICY_ORG_PROMPTS = '_org_prompts';

// Every organization prompt id is composed as ORG_ID_PREFIX + <_org_id> + '_' + <id>, so
// two organizations can never generate the same id and no shipped prompt id (they all
// start with "prompt_") can ever collide with one.
//
// Module-private on purpose: nothing outside recognises an org prompt by its id. The
// is_org flag is what the rest of the add-on keys off, so the naming scheme stays an
// implementation detail of this file and can change without touching anything else.
const ORG_ID_PREFIX = 'org_';

// _org_id must not contain an underscore, or the composed id would be ambiguous:
// "org_acme_foo_bar" could be org "acme" + prompt "foo_bar" or org "acme_foo" + prompt
// "bar", and two different organizations could collide again through that ambiguity.
const ORG_ID_PATTERN = /^[a-z0-9-]+$/;

// Sibling key that downgrades an enforced value to a mere initial value: "<key>:locked".
const LOCK_SUFFIX = ':locked';

// Preferences an administrator must not set, because they are per-machine or per-profile
// state rather than configuration. Enforcing any of them across a fleet would be actively
// harmful: window coordinates from another screen, a font zoom from another display, or
// account ids that simply do not exist in this profile.
const EXCLUDED_KEY_PATTERNS = [
    /^chatgpt_win_/,          // window geometry and position, per machine
    /_enabled_accounts$/,     // account ids, per profile
];
const EXCLUDED_KEYS = new Set([
    'api_webchat_font_scale', // local UI zoom
]);

/**
 * The set of preference keys an enterprise policy may set.
 *
 * Derived from prefs_default rather than hand-maintained, so a new preference is
 * policy-settable the moment it is declared, with no second list to forget. That
 * derivation already covers the generated keys: the six
 * {prefix}_use_specific_integration / {prefix}_connection_type pairs (from
 * special_prompts_with_integration) and the per-provider {integration}_{key} connection
 * keys (from integration_options_config) are all spread into prefs_default in
 * options/mzta-options-default.js.
 *
 * Only the exclusions above are hardcoded.
 */
function buildAllowlist() {
    const allowed = new Set();
    Object.keys(prefs_default).forEach(key => {
        if (EXCLUDED_KEYS.has(key)) return;
        if (EXCLUDED_KEY_PATTERNS.some(re => re.test(key))) return;
        allowed.add(key);
    });
    return allowed;
}

export const mztaManaged = {

    logger: new taLogger("mzta-managed", false),

    _loaded: false,
    _active: false,
    _values: {},            // {key: value} for every accepted policy preference
    _locked: new Set(),     // the subset of the above that is enforced
    _orgName: '',
    _orgId: '',
    _orgPrompts: [],
    _schemaVersion: 0,
    _allowlist: null,
    // The Promise returned by _doLoad(), NOT a function: _doLoad() is async, so calling
    // it starts the work and yields the Promise, which is stored here and awaited as-is.
    // Keeping the Promise rather than a flag is what deduplicates the load - the policy is
    // read once and every caller awaits the same Promise, which once settled returns
    // immediately. That is why js/mzta-prefs.js can afford to await it on every read.
    _loadPromise: null,

    // Same masking rule as js/mzta-prefs.js: a policy file is world-readable, but that is
    // no reason to copy a provider key into the error console as well.
    _logValue(key, value) {
        return key.endsWith('_api_key') ? '****************' : JSON.stringify(value);
    },

    /**
     * Read and validate the enterprise policy.
     *
     * Call once, from the background page ONLY, and explicitly: this must never be
     * triggered merely by importing the module. js/mzta-prefs.js imports this file and is
     * itself imported by every options and settings page, so a load-on-import would fire
     * browser.storage.managed.get() on pages where it is known to fail in Thunderbird.
     *
     * Idempotent: concurrent and later calls get the same promise.
     */
    loadManaged() {
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = this._doLoad();
        return this._loadPromise;
    },

    /**
     * Await whatever loading is in flight, without starting any.
     *
     * This is what js/mzta-prefs.js awaits before resolving a preference, and what an
     * early-firing listener (commands, context menus, compose events) awaits to be sure
     * the policy is in place. In the background page it resolves once loadManaged() has
     * finished; in every other context no load was ever started, so it resolves
     * immediately and every getter reports "not managed" - which is correct there,
     * because those contexts get the managed state over runtime.sendMessage instead.
     */
    async managedReady() {
        // Awaiting the stored Promise, not calling it - see _loadPromise above.
        // Null when loadManaged() was never called (every context except the background
        // page), so there is simply nothing in flight to wait for.
        if (this._loadPromise) await this._loadPromise;
    },

    async _doLoad() {
        let policy = null;
        try {
            policy = await browser.storage.managed.get();
        } catch (e) {
            // No policy installed. This is the normal case for nearly every user, so it
            // must stay silent - not even a debug line, which would show up for anyone
            // who turns on do_debug for an unrelated reason.
            this._loaded = true;
            return;
        }

        if (!policy || typeof policy !== 'object' || Object.keys(policy).length === 0) {
            // A policy store that exists but is empty is the same as no policy at all.
            this._loaded = true;
            return;
        }

        this._allowlist = buildAllowlist();

        // Pass 1: the structural keys, and collect the ":locked" modifiers. They are read
        // before the preferences so that a modifier can never depend on key ordering.
        const lock_overrides = {};
        const candidates = {};

        for (const [raw_key, value] of Object.entries(policy)) {
            if (raw_key.endsWith(LOCK_SUFFIX)) {
                const target = raw_key.slice(0, -LOCK_SUFFIX.length);
                if (typeof value !== 'boolean') {
                    this.logger.warn('Policy: "' + raw_key + '" must be true or false, ignored.');
                    continue;
                }
                lock_overrides[target] = value;
                continue;
            }
            if (raw_key.startsWith('_')) {
                switch (raw_key) {
                    case POLICY_SCHEMA_VERSION:
                        this._schemaVersion = Number(value) || 0;
                        break;
                    case POLICY_ORG_NAME:
                        this._orgName = (typeof value === 'string') ? value.trim() : '';
                        break;
                    case POLICY_ORG_ID:
                        this._orgId = (typeof value === 'string')
                            ? value.trim().toLowerCase() : '';
                        break;
                    case POLICY_ORG_PROMPTS:
                        // Validated in pass 3, once the rest of the policy is known.
                        break;
                    default:
                        this.logger.warn('Policy: unknown structural key "' + raw_key + '", ignored.');
                }
                continue;
            }
            candidates[raw_key] = value;
        }

        // Pass 2: validate each candidate preference against the allowlist and against the
        // TYPE of its prefs_default counterpart. A type mismatch is never coerced: an
        // administrator who writes "true" instead of true gets a warning, not a surprise.
        for (const [key, value] of Object.entries(candidates)) {
            if (!this._allowlist.has(key)) {
                if (key in prefs_default) {
                    this.logger.warn('Policy: "' + key + '" cannot be set by policy ' +
                        '(per-machine or per-profile state), ignored.');
                } else {
                    this.logger.warn('Policy: unknown preference "' + key + '", ignored.');
                }
                continue;
            }
            const expected = typeof prefs_default[key];
            const actual = typeof value;
            // Arrays are objects to typeof; compare them as such so a list preference
            // (spamfilter_skip_addresses, summarize_auto_senders_list) validates properly.
            const expected_is_array = Array.isArray(prefs_default[key]);
            if (expected_is_array) {
                if (!Array.isArray(value)) {
                    this.logger.warn('Policy: "' + key + '" must be an array, got ' +
                        actual + ', ignored.');
                    continue;
                }
            } else if (actual !== expected) {
                this.logger.warn('Policy: "' + key + '" must be of type ' + expected +
                    ', got ' + actual + ', ignored.');
                continue;
            }
            this._values[key] = value;
            // Every key present in the policy is enforced unless "<key>:locked" says false.
            if (lock_overrides[key] !== false) this._locked.add(key);
        }

        // A ":locked" modifier for a key that carries no value has nothing to act on.
        for (const target of Object.keys(lock_overrides)) {
            if (!(target in this._values)) {
                this.logger.warn('Policy: "' + target + LOCK_SUFFIX + '" has no matching ' +
                    'value for "' + target + '", ignored.');
            }
        }

        // Pass 3: organization prompts. They need _org_id, which pass 1 has now read.
        if (POLICY_ORG_PROMPTS in policy) {
            this._orgPrompts = validateOrgPrompts(
                policy[POLICY_ORG_PROMPTS], this._orgId, this.logger);
        }

        this._active = (Object.keys(this._values).length > 0) ||
                       (this._orgPrompts.length > 0);
        this._loaded = true;

        if (this._active) {
            const summary = Object.keys(this._values)
                .map(k => k + (this._locked.has(k) ? ' (locked)' : ' (initial)') +
                     ': ' + this._logValue(k, this._values[k]));
            this.logger.log('Managed configuration active' +
                (this._orgName ? ' for "' + this._orgName + '"' : '') +
                ', ' + Object.keys(this._values).length + ' preference(s), ' +
                this._orgPrompts.length + ' organization prompt(s).');
            this.logger.log('Managed preferences: {' + summary.join(', ') + '}');
        }
    },

    /**
     * True once loadManaged() has run to completion in THIS context.
     *
     * Distinguishes "the policy was read and there is none" from "the policy was never
     * read here", which is what every context other than the background page sees. A
     * caller that gets false must ask the background over runtime.sendMessage instead of
     * concluding that no policy exists.
     */
    hasLoaded() {
        return this._loaded;
    },

    /** True when a valid policy supplied at least one preference or prompt. */
    isManagedActive() {
        return this._active;
    },

    /** The organization name from _org_name, or '' when not set. */
    getOrgName() {
        return this._orgName;
    },

    /** The organization id from _org_id, or '' when not set or invalid. */
    getOrgId() {
        return this._orgId;
    },

    /** The enforced keys, as a plain array (safe to send over runtime.sendMessage). */
    getLockedKeys() {
        return Array.from(this._locked);
    },

    /** True when the policy enforces this key, so it must never be written to storage. */
    isManagedLocked(key) {
        return this._locked.has(key);
    },

    /** True when the policy supplies a value for this key, enforced or not. */
    hasManagedValue(key) {
        return Object.prototype.hasOwnProperty.call(this._values, key);
    },

    /** The policy value for this key, or undefined. */
    getManagedValue(key) {
        return this._values[key];
    },

    /** The validated organization prompts. Always an array, possibly empty. */
    getOrgPrompts() {
        return this._orgPrompts;
    },
};

/**
 * Validate the _org_prompts array.
 *
 * Every prompt is checked independently: one bad entry is dropped with a warning naming
 * it, and the rest are still delivered. An administrator fixing a typo should not lose
 * the whole set.
 *
 * IDS ARE COMPOSED HERE, NOT TAKEN VERBATIM. The administrator writes a short id and this
 * function prefixes it with ORG_ID_PREFIX + <_org_id> + '_'. Two consequences:
 *
 *  - Two organizations, and an organization and a built-in, can never produce the same
 *    id: every composed id starts with "org_" and no shipped id does. That whole class of
 *    collision stops existing rather than being detected and reported.
 *  - An id that collides with one of the USER's custom prompts is NOT rejected. The user
 *    could otherwise disable an organization prompt just by creating a prompt with its
 *    id, and neither they nor the administrator would see why it vanished. Instead the
 *    org prompt wins and the custom one is shadowed - see isShadowedByOrgPrompt() in
 *    js/mzta-prompts.js. Nothing of the user's is deleted: removing the policy brings
 *    their prompt straight back.
 *
 * Field normalisation is NOT done here - it is applied by normalizePromptFields() in
 * js/mzta-prompts.js, the same function getCustomPrompts() uses, so an org prompt and a
 * custom prompt end up with identical shapes.
 */
function validateOrgPrompts(raw, orgId, logger) {
    if (!Array.isArray(raw)) {
        logger.warn('Policy: "' + POLICY_ORG_PROMPTS + '" must be an array, ignored.');
        return [];
    }
    if (raw.length === 0) return [];

    // Without a valid _org_id there is no namespace to put the prompts in, and falling
    // back to a bare "org_" prefix would let two organizations collide - exactly what the
    // prefix exists to prevent. Refuse the whole set rather than create ambiguous ids.
    if (!orgId) {
        logger.warn('Policy: "' + POLICY_ORG_PROMPTS + '" needs "' + POLICY_ORG_ID +
            '" to be set, organization prompts skipped.');
        return [];
    }
    if (!ORG_ID_PATTERN.test(orgId)) {
        logger.warn('Policy: "' + POLICY_ORG_ID + '" must contain only lowercase letters, ' +
            'digits and hyphens (got "' + orgId + '"), organization prompts skipped.');
        return [];
    }

    const out = [];
    const seen = new Set();
    const prefix = ORG_ID_PREFIX + orgId + '_';

    raw.forEach((prompt, index) => {
        const where = '"' + POLICY_ORG_PROMPTS + '"[' + index + ']';

        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
            logger.warn('Policy: ' + where + ' is not an object, skipped.');
            return;
        }

        const isNonEmptyString = v => (typeof v === 'string') && (v.trim() !== '');

        if (!isNonEmptyString(prompt.id)) {
            logger.warn('Policy: ' + where + ' has no valid "id", skipped.');
            return;
        }
        const rawId = prompt.id.trim().toLowerCase();

        if (/\s/.test(rawId)) {
            logger.warn('Policy: ' + where + ' id "' + rawId +
                '" contains whitespace, skipped.');
            return;
        }
        if (!isNonEmptyString(prompt.name)) {
            logger.warn('Policy: organization prompt "' + rawId +
                '" has no valid "name", skipped.');
            return;
        }
        if (!isNonEmptyString(prompt.text)) {
            logger.warn('Policy: organization prompt "' + rawId +
                '" has no valid "text", skipped.');
            return;
        }
        if (prompt.api_type !== undefined && prompt.api_type !== '' &&
            !valid_connection_types.includes(prompt.api_type)) {
            logger.warn('Policy: organization prompt "' + rawId + '" has an invalid ' +
                '"api_type" (' + prompt.api_type + '), skipped. Valid values: ' +
                valid_connection_types.join(', ') + '.');
            return;
        }

        // An id the administrator already wrote with the prefix is accepted as-is, so a
        // policy copied from the documentation (which shows full ids) still works.
        const id = rawId.startsWith(prefix) ? rawId : prefix + rawId;

        if (seen.has(id)) {
            logger.warn('Policy: organization prompt id "' + id +
                '" appears more than once, later occurrence skipped.');
            return;
        }
        seen.add(id);
        // A copy, so nothing downstream can mutate what the policy said.
        out.push({
            ...prompt,
            id: id,
            // Marks the fourth prompt set. Read-only content the user does not own:
            // pages that persist prompts by rewriting a whole store must exclude these.
            is_org: "1",
            is_default: "0",
            is_special: "0",
        });
    });

    return out;
}

/**
 * Await the in-flight policy load, without starting one. See mztaManaged.managedReady().
 *
 * Deliberately a function and not a module-level promise: evaluating
 * mztaManaged.loadManaged() here would read storage.managed on every page that
 * transitively imports this module, which is all of them.
 */
export function managedReady() {
    return mztaManaged.managedReady();
}
