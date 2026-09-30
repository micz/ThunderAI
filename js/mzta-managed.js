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
 *  1. The policy is READ only in the background page (loadManaged()).
 *     browser.storage.managed.get() is known to fail on options pages in Thunderbird, so
 *     every other context obtains it through browser.runtime.sendMessage instead, in one
 *     round trip: managedReady() hydrates this module from the background
 *     ("get_managed_values"), and every accessor then answers as it does in the background.
 *     Nothing in this file may depend on a DOM.
 *
 *  2. The policy is read ONCE, at startup. Thunderbird fires no change events for the
 *     managed storage area, so there is nothing to listen for and no live reload: an
 *     administrator's change takes effect at the next Thunderbird start.
 *
 *  With no policy installed - which is the case for nearly every user - storage.managed
 *  REJECTS. That is the normal path, not an error, so it is swallowed silently and the
 *  add-on behaves exactly as it did before this module existed.
 */

import {
    prefs_default,
    valid_connection_types,
    integration_options_config,
    special_prompts_with_integration
} from '../options/mzta-options-default.js';
import { taLogger } from './mzta-logger.js';

// Policy keys starting with an underscore are structures and metadata, never preferences.
// No key in prefs_default starts with an underscore, so the two namespaces cannot collide.
const POLICY_SCHEMA_VERSION = '_schema_version';
const POLICY_ORG_NAME = '_org_name';
const POLICY_ORG_ID = '_org_id';
const POLICY_ORG_PROMPTS = '_org_prompts';
// {<special prompt id>: <enforced text>}. Enforced only: there is no preference behind a
// special prompt's text, so nothing for the ":locked" convention to downgrade to.
const POLICY_SPECIAL_PROMPTS_TEXT = '_special_prompts_text';
// {<feature prefix>: {api_type, <integration>_<key>: value, "<field>:locked": false}}: the
// per-feature connection override, which lives in the special prompt and not in a preference.
// See validateSpecialPromptsConnection().
const POLICY_SPECIAL_PROMPTS_CONNECTION = '_special_prompts_connection';

// Restrictions: policy-only switches that take something away from the user rather than
// set a preference. They are structural keys, not entries in prefs_default, because there
// is no user-facing setting behind them - nothing to show in the options page, nothing to
// store in storage.local, and therefore nothing for the ":locked" convention to act on.
// A restriction is simply on (true) or absent; any other value is warned about and ignored.
const POLICY_DISABLE_PROMPT_MANAGEMENT = '_disable_prompt_management';
const POLICY_DISABLE_DEFAULT_PROMPTS = '_disable_default_prompts';
const POLICY_DISABLE_SETUP_WIZARD = '_disable_setup_wizard';

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

/**
 * What a settings page receives in place of a policy-supplied API key.
 *
 * The background hands the real key only to the API chat window, which needs it to call
 * the provider (see the "get_managed_values" handler in mzta-background.js). Every other
 * page gets this sentinel: non-empty, so presence checks such as the popup's
 * isConnectionConfigured() still see a configured connection, but worthless as a key.
 * The password eye toggle, "Fetch models" and the connection test refuse to act on it,
 * and js/mzta-prefs.js and the prompt storage gates in js/mzta-prompts.js refuse to
 * persist it, so it can never be sent to a provider or outlive the policy.
 */
export const MANAGED_SECRET_MARKER = '⁣managed-by-policy⁣';

// Preferences an administrator must not set, because they are per-machine or per-profile
// state rather than configuration. Enforcing any of them across a fleet would be actively
// harmful: window coordinates from another screen, a font zoom from another display, a
// page layout the user chose for themselves, or account ids that simply do not exist in
// this profile.
const EXCLUDED_KEY_PATTERNS = [
    /^chatgpt_win_/,          // window geometry and position, per machine
    /_enabled_accounts$/,     // account ids, per profile
];
const EXCLUDED_KEYS = new Set([
    'api_webchat_font_scale', // local UI zoom
    'custom_prompts_view',    // custom prompts page layout (split/table), local UI
]);

// {feature}_enabled_accounts_match: the fleet-wide counterpart of the excluded
// {feature}_enabled_accounts. Its entries name accounts by what is the same on every machine
// (an identity address, a domain, or ACCOUNT_MATCH_LOCAL for Local Folders), and the account
// ids are resolved from them at read time, per profile - see resolveEnabledAccounts() in
// js/mzta-utils.js. The resolved ids are never stored, so the user's own selection survives.
//
// Always enforced: the key has no control of its own, so an unlocked (":locked": false)
// value would be an "initial value" nothing lets the user change.
const ACCOUNT_MATCH_KEY_PATTERN = /_enabled_accounts_match$/;
export const ACCOUNT_MATCH_LOCAL = 'local';
// Same address shape extractEmail() in js/mzta-utils.js recognises, which is what
// matchAddressList() compares against: an entry it could never produce would never match.
const ACCOUNT_MATCH_ADDRESS = /^[\w.-]+@[\w.-]+\.\w+$/;
const ACCOUNT_MATCH_DOMAIN = /^\*?@[\w.-]+\.\w+$/;

/**
 * True when the string is a valid account matcher: a full address ("user@acme.example"), a
 * domain pattern ("@acme.example" or "*@acme.example", the syntax matchAddressList() accepts)
 * or ACCOUNT_MATCH_LOCAL. Case-insensitive, surrounding whitespace ignored.
 */
export function isAccountMatcherEntry(entry) {
    if (typeof entry !== 'string') return false;
    const e = entry.trim().toLowerCase();
    return e === ACCOUNT_MATCH_LOCAL || ACCOUNT_MATCH_ADDRESS.test(e) ||
           ACCOUNT_MATCH_DOMAIN.test(e);
}

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
    _specialPromptsText: {}, // {special prompt id: enforced text}, validated
    // {feature prefix: {api_type, fields: {<integration>_<key>: {value, locked}}}}, validated.
    // api_type is always enforced; a field is enforced unless "<field>:locked" said false.
    _specialPromptsConnection: {},
    _schemaVersion: 0,
    _disablePromptManagement: false,
    _disableDefaultPrompts: false,
    _disableSetupWizard: false,
    _allowlist: null,
    // The Promise returned by _doLoad(), NOT a function: _doLoad() is async, so calling
    // it starts the work and yields the Promise, which is stored here and awaited as-is.
    // Keeping the Promise rather than a flag is what deduplicates the load - the policy is
    // read once and every caller awaits the same Promise, which once settled returns
    // immediately. That is why js/mzta-prefs.js can afford to await it on every read.
    _loadPromise: null,
    // Same pattern as _loadPromise, for every context that is NOT the background page: the
    // Promise of the one-shot "get_managed_values" round trip started by managedReady().
    _hydratePromise: null,
    // whenLoaded(): settled by loadManaged(), never started by it.
    _whenLoaded: null,
    _resolveWhenLoaded: null,

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
        // Settle whenLoaded() too, even on a failed load, so a waiting caller never hangs.
        if (this._resolveWhenLoaded) this._loadPromise.then(this._resolveWhenLoaded, this._resolveWhenLoaded);
        return this._loadPromise;
    },

    /**
     * Resolve once loadManaged() has settled, WITHOUT starting it. For the background's
     * get_managed_values listener, which is registered before the startup migrations (so a page
     * opened during startup is answered at all) and must not answer before the policy is read.
     * Unlike managedReady() it never hydrates, so the background can never message itself.
     */
    whenLoaded() {
        if (this._loadPromise) return this._loadPromise.then(() => {}, () => {});
        if (!this._whenLoaded) {
            this._whenLoaded = new Promise(resolve => { this._resolveWhenLoaded = () => resolve(); });
        }
        return this._whenLoaded;
    },

    /**
     * Make the policy available to the resolution in js/mzta-prefs.js, in any context.
     *
     * This is what js/mzta-prefs.js awaits before resolving a preference, and what an
     * early-firing listener (commands, context menus, compose events) awaits to be sure
     * the policy is in place.
     *
     * - In the background page it awaits loadManaged(), which that page starts explicitly
     *   before its first preference read. It never starts anything there.
     * - In every other extension context (options and settings pages, popup, API chat
     *   window) it HYDRATES the values once from the background, over runtime.sendMessage
     *   ("get_managed_values"), so every read resolves locked > stored > unlocked > default
     *   exactly as it does in the background. That is also what makes the write guard in
     *   js/mzta-prefs.js effective in pages.
     *
     * Hydration is started by the first preference READ, never by importing the module,
     * and it never touches browser.storage.managed - that call is the one known to fail
     * on options pages, and it stays confined to loadManaged().
     */
    async managedReady() {
        // Awaiting the stored Promise, not calling it - see _loadPromise above. The
        // background sets it synchronously before its first preference read, so it can
        // never end up messaging itself below.
        if (this._loadPromise) {
            await this._loadPromise;
            return;
        }
        if (!this._hydratePromise) this._hydratePromise = this._hydrate();
        await this._hydratePromise;
    },

    /**
     * Fill this context's copy of the policy from the background: the values and locks, the
     * enforced texts and connections, the organization prompts, the restrictions, and whether a
     * policy is active at all. This is the ONLY channel a page gets the policy through, so every
     * accessor below answers the same in every context. Fails OPEN: any failure leaves the
     * context unmanaged, which is what it was before hydration existed, and the background still
     * enforces every locked key on its own reads.
     *
     * Policy-supplied API keys arrive as MANAGED_SECRET_MARKER, except in the API chat
     * window - the background decides, from the sender, never this side.
     */
    async _hydrate() {
        try {
            const reply = await browser.runtime.sendMessage({ command: 'get_managed_values' });
            if (!reply || typeof reply !== 'object' ||
                !reply.values || typeof reply.values !== 'object') {
                this.logger.warn('Could not hydrate the managed configuration: no valid reply.');
                return;
            }
            const locked = Array.isArray(reply.lockedKeys) ? reply.lockedKeys : [];
            this._values = { ...reply.values };
            this._locked = new Set(locked.filter(k => this.hasManagedValue(k)));
            // Already validated by the background; only the shape is re-checked here.
            const texts = reply.specialPromptsText;
            this._specialPromptsText = {};
            if (texts && typeof texts === 'object' && !Array.isArray(texts)) {
                for (const [id, text] of Object.entries(texts)) {
                    if (typeof text === 'string') this._specialPromptsText[id] = text;
                }
            }
            this._specialPromptsConnection = normalizeHydratedConnections(reply.specialPromptsConnection);
            this._orgPrompts = Array.isArray(reply.orgPrompts)
                ? reply.orgPrompts.filter(p => isPlainObject(p) && typeof p.id === 'string') : [];
            this._orgName = (typeof reply.orgName === 'string') ? reply.orgName : '';
            // A restriction is on only for a literal true, as readRestriction() reads it.
            this._disablePromptManagement = reply.disablePromptManagement === true;
            this._disableDefaultPrompts = reply.disableDefaultPrompts === true;
            this._disableSetupWizard = reply.disableSetupWizard === true;
            this._active = reply.active === true;
        } catch (e) {
            this.logger.warn('Could not hydrate the managed configuration: ' + e);
        }
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
                    case POLICY_SPECIAL_PROMPTS_TEXT:
                    case POLICY_SPECIAL_PROMPTS_CONNECTION:
                        // Validated in pass 3, once the rest of the policy is known.
                        break;
                    case POLICY_DISABLE_PROMPT_MANAGEMENT:
                        this._disablePromptManagement = readRestriction(
                            raw_key, value, this.logger);
                        break;
                    case POLICY_DISABLE_DEFAULT_PROMPTS:
                        this._disableDefaultPrompts = readRestriction(
                            raw_key, value, this.logger);
                        break;
                    case POLICY_DISABLE_SETUP_WIZARD:
                        this._disableSetupWizard = readRestriction(
                            raw_key, value, this.logger);
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
        for (const [key, raw_value] of Object.entries(candidates)) {
            let value = raw_value;
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
            // (spamfilter_skip_addresses, summarize_auto_senders_list, add_tags_exclusions)
            // validates properly.
            const expected_is_array = Array.isArray(prefs_default[key]);
            if (expected_is_array) {
                if (!Array.isArray(value)) {
                    this.logger.warn('Policy: "' + key + '" must be an array, got ' +
                        actual + ', ignored.');
                    continue;
                }
                if (ACCOUNT_MATCH_KEY_PATTERN.test(key)) {
                    // An empty list means "not managed": the user's own account
                    // selection stays in effect, so there is nothing to record.
                    if (value.length === 0) continue;
                    value = validateAccountMatchers(key, value, this.logger);
                    this._values[key] = value;
                    if (lock_overrides[key] === false) {
                        this.logger.warn('Policy: "' + key + LOCK_SUFFIX + '": false is not ' +
                            'supported, ignored: an account list set by policy is always enforced.');
                    }
                    this._locked.add(key);
                    continue;
                }
                // Every array preference is a list of strings, and every consumer calls
                // string methods on its elements (checkExcludedTag() lowercases them,
                // matchAddressList() compares them). A single non-string element rejects
                // the WHOLE value: filtering it out would be a silent coercion, which is
                // exactly what this validation never does. The account matchers above are
                // the exception, see validateAccountMatchers().
                const bad_index = value.findIndex(el => typeof el !== 'string');
                if (bad_index !== -1) {
                    this.logger.warn('Policy: "' + key + '" must be an array of strings, ' +
                        'element ' + bad_index + ' is ' + typeof value[bad_index] + ', ignored.');
                    continue;
                }
            } else if (actual !== expected) {
                this.logger.warn('Policy: "' + key + '" must be of type ' + expected +
                    ', got ' + actual + ', ignored.');
                continue;
            } else {
                // The type matches; the content must be usable too (see prefValueProblem()).
                const problem = prefValueProblem(key, value);
                if (problem !== '') {
                    this.logger.warn('Policy: "' + key + '" ' + problem + ' (got ' +
                        this._logValue(key, value) + '), ignored.');
                    continue;
                }
            }
            this._values[key] = value;
            // Every key present in the policy is enforced unless "<key>:locked" says false.
            if (lock_overrides[key] !== false) this._locked.add(key);
        }

        reconcileSummarizeDisplayMode(this._values, this._locked, this.logger);

        // A ":locked" modifier for a key that carries no value has nothing to act on.
        for (const target of Object.keys(lock_overrides)) {
            if (target === POLICY_SPECIAL_PROMPTS_TEXT) {
                this.logger.warn('Policy: "' + target + LOCK_SUFFIX + '" is not supported, ' +
                    'ignored: a special prompt text set by policy is always enforced.');
                continue;
            }
            if (target === POLICY_SPECIAL_PROMPTS_CONNECTION) {
                this.logger.warn('Policy: "' + target + LOCK_SUFFIX + '" is not supported, ' +
                    'ignored: lock single fields inside a feature entry instead ("<field>' +
                    LOCK_SUFFIX + '": false).');
                continue;
            }
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

        // Enforced special prompt texts. js/mzta-prompts.js owns the special prompt ids and
        // what their texts must contain; imported dynamically because it statically imports
        // this module.
        if (POLICY_SPECIAL_PROMPTS_TEXT in policy) {
            const { getSpecialPromptIds, checkSpecialPromptText } = await import('./mzta-prompts.js');
            this._specialPromptsText = validateSpecialPromptsText(
                policy[POLICY_SPECIAL_PROMPTS_TEXT], getSpecialPromptIds(),
                checkSpecialPromptText, this.logger);
        }

        // Enforced per-feature connections. After pass 2 and after the ":locked" check above:
        // an entry is checked against the explicit {prefix}_use_specific_integration and
        // {prefix}_connection_type, and then implies both, locked (see the function).
        if (POLICY_SPECIAL_PROMPTS_CONNECTION in policy) {
            this._specialPromptsConnection = validateSpecialPromptsConnection(
                policy[POLICY_SPECIAL_PROMPTS_CONNECTION], this._values, this._locked, this.logger);
        }

        // A policy that only restricts - no preference, no prompt - is still a policy: the
        // banner and the disabled buttons must be explained, so it counts as active.
        this._active = (Object.keys(this._values).length > 0) ||
                       (this._orgPrompts.length > 0) ||
                       (Object.keys(this._specialPromptsText).length > 0) ||
                       (Object.keys(this._specialPromptsConnection).length > 0) ||
                       this._disablePromptManagement ||
                       this._disableDefaultPrompts ||
                       this._disableSetupWizard;
        this._loaded = true;

        if (this._active) {
            const summary = Object.keys(this._values)
                .map(k => k + (this._locked.has(k) ? ' (locked)' : ' (initial)') +
                     ': ' + this._logValue(k, this._values[k]));
            this.logger.log('Managed configuration active' +
                (this._orgName ? ' for "' + this._orgName + '"' : '') +
                ', ' + Object.keys(this._values).length + ' preference(s), ' +
                this._orgPrompts.length + ' organization prompt(s), ' +
                Object.keys(this._specialPromptsText).length + ' enforced special prompt text(s)' +
                (Object.keys(this._specialPromptsText).length > 0
                    ? ' (' + Object.keys(this._specialPromptsText).join(', ') + ')' : '') + '.');
            this.logger.log('Managed preferences: {' + summary.join(', ') + '}');
            for (const [prefix, entry] of Object.entries(this._specialPromptsConnection)) {
                this.logger.log('Managed connection for "' + prefix + '": ' + entry.api_type + ', {' +
                    Object.entries(entry.fields).map(([name, f]) => name +
                        (f.locked ? ' (locked)' : ' (initial)') + ': ' + this._logValue(name, f.value))
                        .join(', ') + '}');
            }
            const restrictions = [];
            if (this._disablePromptManagement) restrictions.push(POLICY_DISABLE_PROMPT_MANAGEMENT);
            if (this._disableDefaultPrompts) restrictions.push(POLICY_DISABLE_DEFAULT_PROMPTS);
            if (this._disableSetupWizard) restrictions.push(POLICY_DISABLE_SETUP_WIZARD);
            if (restrictions.length > 0) {
                this.logger.log('Managed restrictions: ' + restrictions.join(', '));
            }
        }
    },

    /**
     * True once loadManaged() has run to completion in THIS context.
     *
     * Distinguishes "the policy was read and there is none" from "the policy was never
     * read here", which is what every context other than the background page sees. A
     * caller must not conclude from false that no policy exists: it awaits managedReady(),
     * which hydrates the policy from the background, and reads the accessors after that.
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

    /**
     * The enforced special prompt texts, {id: text}, as a copy (safe to send over
     * runtime.sendMessage). Empty object when the policy enforces none.
     */
    getSpecialPromptsText() {
        return { ...this._specialPromptsText };
    },

    /** The enforced text of this special prompt, or undefined when the policy sets none. */
    getSpecialPromptText(id) {
        return Object.prototype.hasOwnProperty.call(this._specialPromptsText, id)
            ? this._specialPromptsText[id] : undefined;
    },

    /**
     * The enforced per-feature connections, {prefix: {api_type, fields: {name: {value,
     * locked}}}}, as a deep copy (safe to send over runtime.sendMessage). Empty object when the
     * policy supplies none. The background holds the real API keys; a hydrated settings page
     * holds MANAGED_SECRET_MARKER in their place (the API chat window, the real key).
     */
    getSpecialPromptsConnection() {
        return structuredClone(this._specialPromptsConnection);
    },

    /** The connection the policy supplies for this feature prefix (a copy), or undefined. */
    getSpecialPromptConnection(prefix) {
        return Object.prototype.hasOwnProperty.call(this._specialPromptsConnection, prefix)
            ? structuredClone(this._specialPromptsConnection[prefix]) : undefined;
    },

    /**
     * The ids of the feature-page controls whose value the policy enforces: `${prefix}_${field}`
     * for every locked field of every connection entry, which is exactly how the connection
     * panel names its inputs (pages/_lib/connection-ui.js, modelId_prefix = `${prefix}_`).
     * They are not preferences, so they never appear in getLockedKeys().
     */
    getEnforcedConnectionControlIds() {
        const ids = [];
        for (const [prefix, entry] of Object.entries(this._specialPromptsConnection)) {
            for (const [name, field] of Object.entries(entry.fields)) {
                if (field.locked) ids.push(prefix + '_' + name);
            }
        }
        return ids;
    },

    /** True when `id` is one of getEnforcedConnectionControlIds(). */
    isEnforcedConnectionControl(id) {
        if (typeof id !== 'string') return false;
        for (const [prefix, entry] of Object.entries(this._specialPromptsConnection)) {
            if (!id.startsWith(prefix + '_')) continue;
            const field = entry.fields[id.slice(prefix.length + 1)];
            if (field && field.locked) return true;
        }
        return false;
    },

    /**
     * True when the policy forbids creating, importing or exporting prompts.
     *
     * Export is included on purpose: an exported file carries the prompt bodies, and with
     * "include API settings" it can carry provider credentials too, so an organization
     * that locks prompt management does not want that file produced either.
     */
    isPromptManagementDisabled() {
        return this._disablePromptManagement;
    },

    /**
     * True when the policy takes the built-in prompts out of the menus.
     *
     * Only the built-in ones: the special prompts back features of their own (Add Tags,
     * Summarize, Translate...), and the user's and the organization's prompts are not
     * built-in at all. It is meant for an organization that supplies its own prompts via
     * _org_prompts and wants only those to be reachable.
     */
    areDefaultPromptsDisabled() {
        return this._disableDefaultPrompts;
    },

    /** True when the policy forbids opening the setup wizard. */
    isSetupWizardDisabled() {
        return this._disableSetupWizard;
    },
};

/**
 * An automatic summary (summarize_auto 2 or 3) is always shown inline, so a policy that sets
 * one of those modes and also supplies summarize_display_mode gets 'inline', whatever it wrote,
 * and the display mode takes the lock of summarize_auto: enforced when summarize_auto is
 * enforced, an initial value when summarize_auto is one. Normalised here, once, rather than at
 * every reader: the resolved value is then the one the whole add-on reads - the summarize page,
 * the context menu summarize, the refresh - with nothing to reconcile later.
 */
function reconcileSummarizeDisplayMode(values, locked, logger) {
    if (values.summarize_auto !== 2 && values.summarize_auto !== 3) return;
    if (!Object.prototype.hasOwnProperty.call(values, 'summarize_display_mode')) return;
    const auto_locked = locked.has('summarize_auto');
    if (values.summarize_display_mode === 'inline' && locked.has('summarize_display_mode') === auto_locked) return;
    logger.warn('Policy: "summarize_display_mode" is ' + JSON.stringify(values.summarize_display_mode) +
        (locked.has('summarize_display_mode') ? ' (locked)' : ' (initial)') + ', but "summarize_auto" is ' +
        values.summarize_auto + (auto_locked ? ' (locked)' : ' (initial)') + ', which only shows summaries ' +
        'inline: using "inline"' + (auto_locked ? ' (locked).' : ' (initial).'));
    values.summarize_display_mode = 'inline';
    if (auto_locked) locked.add('summarize_display_mode');
    else locked.delete('summarize_display_mode');
}

/**
 * Read a restriction key.
 *
 * Only a literal true turns a restriction on. false is accepted and means "off", which is
 * also what an absent key means - it is allowed so that an administrator can write the key
 * out explicitly. Anything else is a malformed policy and is reported, never coerced: a
 * restriction silently misread as "on" would lock a fleet out of its own prompts.
 */
function readRestriction(key, value, logger) {
    if (typeof value !== 'boolean') {
        logger.warn('Policy: "' + key + '" must be true or false, ignored.');
        return false;
    }
    return value;
}

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
 * Validate a non-empty {feature}_enabled_accounts_match array.
 *
 * Each entry is checked on its own, like validateOrgPrompts(): one that is not an account
 * matcher (see isAccountMatcherEntry()) is skipped with a warning naming it, and the rest
 * still apply. A NON-STRING element is treated the same way, unlike the other array
 * preferences, which reject the whole value on one: there the whole-array rule avoids
 * coercing a list that consumers read as-is, whereas here every entry is already validated
 * one by one, and rejecting the whole list would fail OPEN - back to the user's own
 * selection, possibly every account - which is the wrong direction for a list that limits
 * where mail is sent to an AI provider.
 *
 * For the same reason a list whose entries are ALL invalid is still kept, empty: the
 * administrator asked to limit the accounts, so the feature runs on none rather than on all.
 */
function validateAccountMatchers(key, raw, logger) {
    const out = [];
    raw.forEach((entry, index) => {
        if (!isAccountMatcherEntry(entry)) {
            logger.warn('Policy: "' + key + '"[' + index + '] (' + JSON.stringify(entry) +
                ') is not an address, a domain pattern ("@domain" or "*@domain") or "' +
                ACCOUNT_MATCH_LOCAL + '", skipped.');
            return;
        }
        out.push(entry.trim().toLowerCase());
    });
    if (out.length === 0) {
        logger.warn('Policy: "' + key + '" has no valid entry: the feature will run on no account.');
    }
    return out;
}

/**
 * Validate the _special_prompts_text object: {<special prompt id>: <enforced text>}.
 *
 * Same shape as validateOrgPrompts(): each entry is checked on its own, a bad one is dropped
 * with a warning naming it, and the rest still apply.
 *
 * The response format is part of the text (the shipped prompt_spamfilter_full_text itself
 * asks for {"explanation", "spamValue"}), not appended by code, so a text that no longer
 * names the keys the parser reads would break the feature for the whole fleet with nothing
 * the user could do about it. Such a text is REJECTED - the user's own text stays in effect -
 * rather than enforced with a warning. Missing placeholders are not rejected here: the text
 * still runs, it just may not see the message, and the background warns at startup.
 *
 * prompt_get_calendar_event and prompt_get_calendar_event_from_clipboard are edited through
 * one textarea and always saved together, so an enforced text for the first also applies to
 * the second unless the policy names that one too.
 */
function validateSpecialPromptsText(raw, validIds, checkText, logger) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        logger.warn('Policy: "' + POLICY_SPECIAL_PROMPTS_TEXT + '" must be an object ' +
            'mapping special prompt ids to texts, ignored.');
        return {};
    }

    const out = {};
    for (const [id, text] of Object.entries(raw)) {
        const where = '"' + POLICY_SPECIAL_PROMPTS_TEXT + '"["' + id + '"]';
        if (!validIds.includes(id)) {
            logger.warn('Policy: ' + where + ' is not a special prompt id, skipped. Valid ids: ' +
                validIds.join(', ') + '.');
            continue;
        }
        if (typeof text !== 'string' || text === '') {
            logger.warn('Policy: ' + where + ' must be a non-empty string, skipped.');
            continue;
        }
        const check = checkText(id, text);
        if (check.blank) {
            logger.warn('Policy: ' + where + ' contains only whitespace, skipped.');
            continue;
        }
        if (check.missingResponseKeys.length > 0) {
            logger.warn('Policy: ' + where + ' does not ask for the response field(s) ' +
                check.missingResponseKeys.map(k => '"' + k + '"').join(', ') +
                ' that ThunderAI reads from the answer, skipped: the feature could not use ' +
                'the response. Keep the output format of the default text. The user\'s own ' +
                'text stays in effect.');
            continue;
        }
        out[id] = text;
    }

    const CALENDAR = 'prompt_get_calendar_event';
    const CLIPBOARD = 'prompt_get_calendar_event_from_clipboard';
    if ((CALENDAR in out) && !(CLIPBOARD in raw)) {
        out[CLIPBOARD] = out[CALENDAR];
    }
    return out;
}

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * The connection types a feature's specific-integration panel offers: the ones with an
 * integration_options_config block, i.e. every API connection. Derived, not listed, with the
 * same api_type -> integration mapping initWorker() in js/mzta-special-commands.js uses;
 * chatgpt_web has no block (it has no API) and the panels never offer it (no_chatgpt_web).
 */
export function featureConnectionTypes() {
    return valid_connection_types.filter(
        type => hasOwn(integration_options_config, type.replace(/_api$/, '')));
}

// The integration a prompt field name such as "openai_comp_host" belongs to, or ''.
function integrationOfField(name) {
    for (const [integration, options] of Object.entries(integration_options_config)) {
        if (name.startsWith(integration + '_') && hasOwn(options, name.slice(integration.length + 1))) {
            return integration;
        }
    }
    return '';
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * What is wrong with a connection field value, or '' when it is valid. `key` is the
 * integration_options_config key (host, model, temperature...), `defaultValue` its default:
 * the type must be the default's, never coerced - the same rule as for a preference. On top,
 * the content rules the request builders depend on. The settings UI checks none of them (it
 * saves whatever is typed), but a value typed by a user only breaks that user's feature, while
 * a policy value breaks it for the whole fleet with nothing the user can do about it.
 */
function connectionFieldProblem(key, value, defaultValue) {
    const expected = typeof defaultValue;
    if (typeof value !== expected) return 'must be of type ' + expected + ', got ' + typeof value;
    if (expected === 'number') {
        if (!Number.isInteger(value) || value < 0) return 'must be a non-negative integer';
        if (key === 'max_tokens' && value < 1) return 'must be at least 1';
        return '';
    }
    if (expected !== 'string') return '';
    switch (key) {
        case 'host':
            return isHttpUrl(value) ? '' : 'must be an http:// or https:// URL';
        case 'model':
            return value.trim() !== '' ? '' : 'must not be empty';
        case 'temperature': {
            if (value.trim() === '') return '';
            const n = Number(value);
            return (Number.isFinite(n) && n >= 0) ? '' : 'must be empty or a number not below 0';
        }
        case 'thinking_budget':
            return (value.trim() === '' || /^-?\d+$/.test(value.trim()))
                ? '' : 'must be empty or an integer';
        case 'extra_body': {
            // The contract of parseExtraBody() in js/api/api-utils.js, which would otherwise
            // silently send nothing.
            if (value.trim() === '') return '';
            try {
                return isPlainObject(JSON.parse(value)) ? '' : 'must be a JSON object';
            } catch (e) {
                return 'must be a JSON object (' + e.message + ')';
            }
        }
    }
    return '';
}

// The preferences whose type alone does not make a value usable, beyond the per-provider
// connection keys (those use connectionFieldProblem(), see prefValueProblem()). The domains are
// the ones the settings UI offers: the <option>s of its selects, the min/max of its number inputs.
const PREF_ENUMS = {
    connection_type: () => valid_connection_types,
    reply_type: () => ['reply_all', 'reply_sender'],
    diff_granularity: () => ['words', 'sentences'],
    summarize_display_mode: () => ['inline', 'webchat'],
    summarize_auto: () => [0, 1, 2, 3],
    translate_auto: () => [0, 1, 2, 3],
    // The feature panels never offer chatgpt_web, as for _special_prompts_connection.
    ...Object.fromEntries(special_prompts_with_integration.map(
        prefix => [prefix + '_connection_type', () => featureConnectionTypes()])),
};
// Every other number preference is a non-negative integer (a count, a length, milliseconds);
// these have a tighter range.
const PREF_NUMBER_RANGES = {
    spamfilter_threshold: { min: 0, max: 100 },
    summarize_max_messages: { min: 1 },
    add_tags_maxnum: { min: 1 },
    max_prompt_length: { min: 1 },
};

// A time zone the calendar pages' select offers: it is built from
// Intl.supportedValuesOf('timeZone') (pages/_lib/mzta-timezones.js), so the same list decides
// here. Intl.DateTimeFormat alone would also accept a lowercased id or an alias the select does
// not list, and the page would then show an empty select over the enforced zone. Without
// supportedValuesOf() any id the engine accepts is allowed.
function isTimeZone(value) {
    if (typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('timeZone').includes(value);
    }
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * What is wrong with a policy value for a preference whose type already matched, or '' when it
 * is valid. A type check alone lets through a value the add-on cannot use - a connection_type
 * that names no provider, a host that is not a URL - and a policy value, unlike a user's typo,
 * breaks the feature for the whole fleet with nothing the user can do about it. So the same
 * content rules apply as for a field of _special_prompts_connection:
 *
 *  - a per-provider connection key ({integration}_{key}, from integration_options_config):
 *    connectionFieldProblem(), exactly as for the per-feature connection;
 *  - an enumeration (PREF_ENUMS): one of the values the settings UI offers;
 *  - a number: a non-negative integer, within PREF_NUMBER_RANGES where listed;
 *  - calendar_timezone: '' (no zone enforced) or a zone the calendar select lists.
 *
 * Never coerced: a value that fails is warned about and not applied, like a type mismatch.
 */
function prefValueProblem(key, value) {
    const integration = integrationOfField(key);
    if (integration !== '') {
        const option = key.slice(integration.length + 1);
        return connectionFieldProblem(option, value, integration_options_config[integration][option]);
    }
    if (hasOwn(PREF_ENUMS, key)) {
        const allowed = PREF_ENUMS[key]();
        return allowed.includes(value) ? ''
            : 'must be one of ' + allowed.map(v => JSON.stringify(v)).join(', ');
    }
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0) return 'must be a non-negative integer';
        const range = PREF_NUMBER_RANGES[key];
        if (range && range.min !== undefined && value < range.min) return 'must be at least ' + range.min;
        if (range && range.max !== undefined && value > range.max) return 'must be at most ' + range.max;
        return '';
    }
    if (key === 'calendar_timezone') {
        return (value === '' || isTimeZone(value)) ? '' : 'must be empty or a time zone such as "Europe/Rome"';
    }
    return '';
}

/**
 * Validate the _special_prompts_connection object:
 *   {<feature prefix>: {api_type, <integration>_<key>: value, "<field>:locked": false}}
 *
 * The per-feature connection override lives in the special prompt (api_type plus the
 * {integration}_{key} fields), not in a preference, so the allowlist cannot reach it; this is
 * its policy counterpart. The field names are exactly the prompt properties, so a field added
 * to integration_options_config is covered here the moment it is declared.
 *
 * Same style as validateSpecialPromptsText(): each feature entry is checked on its own, and
 * within an entry each field. An invalid field is skipped with a warning and the rest of the
 * entry applies; an entry without a usable api_type is skipped as a whole, since no field
 * means anything without it.
 *
 * api_type is always enforced: an unlocked provider under enforced provider-specific fields
 * would make no sense, so "api_type:locked": false is warned about and ignored.
 *
 * An accepted entry IMPLIES two preferences, which are written into `values` / `locked` here:
 * {prefix}_use_specific_integration = true and {prefix}_connection_type = api_type, both
 * locked. getConnectionType() in js/mzta-utils.js reads that pair before the prompt's
 * api_type, and several callers (the menu gating, the options feature row) read only the pair,
 * so the overlay on the prompt alone would not be what runs. An explicit
 * {prefix}_use_specific_integration: false in the same policy, locked or initial, wins: the
 * entry is skipped and the feature uses the global connection, which the administrator
 * controls as well. So the locked-off overlay and this one can never apply to the same feature.
 */
function validateSpecialPromptsConnection(raw, values, locked, logger) {
    const root = '"' + POLICY_SPECIAL_PROMPTS_CONNECTION + '"';
    if (!isPlainObject(raw)) {
        logger.warn('Policy: ' + root + ' must be an object mapping feature names to ' +
            'connections, ignored.');
        return {};
    }
    const allowedTypes = featureConnectionTypes();
    const out = {};
    for (const [prefix, entry] of Object.entries(raw)) {
        const where = root + '["' + prefix + '"]';
        if (!special_prompts_with_integration.includes(prefix)) {
            logger.warn('Policy: ' + where + ' is not a feature with a specific integration, ' +
                'skipped. Valid features: ' + special_prompts_with_integration.join(', ') + '.');
            continue;
        }
        if (!isPlainObject(entry)) {
            logger.warn('Policy: ' + where + ' must be an object, skipped.');
            continue;
        }
        const api_type = entry.api_type;
        if (typeof api_type !== 'string' || !allowedTypes.includes(api_type)) {
            logger.warn('Policy: ' + where + ' has ' + (api_type === undefined ? 'no "api_type"'
                : 'an invalid "api_type" (' + JSON.stringify(api_type) + ')') + ', the whole ' +
                'feature entry is skipped. Valid values: ' + allowedTypes.join(', ') + '.');
            continue;
        }
        const useKey = prefix + '_use_specific_integration';
        const typeKey = prefix + '_connection_type';
        if (hasOwn(values, useKey) && values[useKey] === false) {
            logger.warn('Policy: ' + where + ' is skipped: "' + useKey + '" is set to false ' +
                (locked.has(useKey) ? '(locked)' : '(initial)') + ' in the same policy, and the ' +
                'explicit switch wins. The feature uses the global connection.');
            continue;
        }
        const apiTypeLock = 'api_type' + LOCK_SUFFIX;
        if (hasOwn(entry, apiTypeLock) && entry[apiTypeLock] !== true) {
            logger.warn('Policy: ' + where + '["' + apiTypeLock + '"] is not supported, ignored: ' +
                'the connection type of a feature set by policy is always enforced.');
        }

        const integration = api_type.replace(/_api$/, '');
        const options = integration_options_config[integration];
        const fields = {};
        for (const [name, value] of Object.entries(entry)) {
            if (name === 'api_type' || name.endsWith(LOCK_SUFFIX)) continue;
            const fwhere = where + '["' + name + '"]';
            const key = name.startsWith(integration + '_') ? name.slice(integration.length + 1) : null;
            if (key === null || !hasOwn(options, key)) {
                const owner = integrationOfField(name);
                logger.warn('Policy: ' + fwhere + (owner
                    ? ' belongs to the "' + owner + '" connection, not to "' + api_type + '"'
                    : ' is not a connection field') + ', skipped. Valid fields for "' + api_type +
                    '": ' + Object.keys(options).map(k => integration + '_' + k).join(', ') + '.');
                continue;
            }
            const problem = connectionFieldProblem(key, value, options[key]);
            if (problem !== '') {
                logger.warn('Policy: ' + fwhere + ' ' + problem + ', skipped.');
                continue;
            }
            // Every field present is enforced unless its "<field>:locked" says false.
            fields[name] = { value: value, locked: entry[name + LOCK_SUFFIX] !== false };
        }
        for (const name of Object.keys(entry)) {
            if (!name.endsWith(LOCK_SUFFIX) || name === apiTypeLock) continue;
            const target = name.slice(0, -LOCK_SUFFIX.length);
            if (typeof entry[name] !== 'boolean') {
                logger.warn('Policy: ' + where + '["' + name + '"] must be true or false, ' +
                    'ignored: the field stays enforced.');
            } else if (!hasOwn(fields, target)) {
                logger.warn('Policy: ' + where + '["' + name + '"] has no valid value for "' +
                    target + '", ignored.');
            }
        }

        // The implied preference pair, locked. An explicit value the administrator also wrote
        // is overridden with a warning, never silently.
        if (hasOwn(values, useKey) && !locked.has(useKey)) {
            logger.warn('Policy: "' + useKey + '" is an initial value, but ' + where +
                ' enforces the connection of that feature: it is enforced (true).');
        }
        values[useKey] = true;
        locked.add(useKey);
        if (hasOwn(values, typeKey) && (values[typeKey] !== api_type || !locked.has(typeKey))) {
            logger.warn('Policy: "' + typeKey + '" is ' + JSON.stringify(values[typeKey]) +
                (locked.has(typeKey) ? ' (locked)' : ' (initial)') + ', but ' + where +
                ' enforces "' + api_type + '": using "' + api_type + '" (locked).');
        }
        values[typeKey] = api_type;
        locked.add(typeKey);

        out[prefix] = { api_type: api_type, fields: fields };
    }
    return out;
}

// The shape check for a hydrated _special_prompts_connection: the background already
// validated it, so only the structure is re-checked, and anything malformed is dropped.
function normalizeHydratedConnections(raw) {
    const out = {};
    if (!isPlainObject(raw)) return out;
    for (const [prefix, entry] of Object.entries(raw)) {
        if (!isPlainObject(entry) || typeof entry.api_type !== 'string' ||
            !isPlainObject(entry.fields)) continue;
        const fields = {};
        for (const [name, field] of Object.entries(entry.fields)) {
            if (isPlainObject(field) && hasOwn(field, 'value') && typeof field.locked === 'boolean') {
                fields[name] = { value: field.value, locked: field.locked };
            }
        }
        out[prefix] = { api_type: entry.api_type, fields: fields };
    }
    return out;
}

/**
 * Await the policy, see mztaManaged.managedReady(): the in-flight load in the background,
 * the one-shot hydration everywhere else.
 *
 * Deliberately a function and not a module-level promise: evaluating
 * mztaManaged.loadManaged() here would read storage.managed on every page that
 * transitively imports this module, which is all of them.
 */
export function managedReady() {
    return mztaManaged.managedReady();
}
