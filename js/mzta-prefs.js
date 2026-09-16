/*
 *  Copyright  Mic  (email: m@micz.it)
 *
 *  This Source Code Form is subject to the terms of the Mozilla Public
 *  License, v. 2.0. If a copy of the MPL was not distributed with this
 *  file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 *  This file is avalable in the original repo:
 *  https://github.com/micz/Thunderbird-Addon-Options-Manager
 *
 */

/*
 *  Adapted for ThunderAI from th-addon-options.js of the repository linked above.
 *  Only the preference accessors are taken: saveOptions()/restoreOptions() are NOT
 *  ported, because ThunderAI's own versions in options/mzta-options.js are considerably
 *  more capable (password inputs, API key masking, TomSelect, hasEmptyValueOption(),
 *  the connection_type empty state).
 *
 *  This is the single choke point for every preference READ and WRITE in the add-on, and
 *  therefore also the one place that decides WHICH storage area preferences live in (see
 *  PREFS_AREA below). Multi-key writes go through setPrefs() rather than a direct set(),
 *  so that no writer has to bypass this module.
 *
 *  A handful of call sites still read storage directly and are documented at their own
 *  lines: the two one-shot migration flags in js/mzta-prompts.js, the classic content
 *  script js/mzta-compose-script.js, and one guarded read in pages/_lib/connection-ui.js.
 *  All of them must use the same area as PREFS_AREA.
 *
 *  ENTERPRISE MANAGED CONFIGURATION (js/mzta-managed.js) sits in front of this module.
 *  Because it is a choke point, the whole policy mechanism is a handful of lines here and
 *  no call site outside this file changes. Every read resolves as:
 *
 *      locked policy value > user value in storage.local > unlocked policy value > prefs_default
 *
 *  and every write skips a locked key. See _resolveDefaults() and _applyLocked() below.
 */

import { prefs_default } from '../options/mzta-options-default.js';
import { taLogger } from './mzta-logger.js';
import { mztaManaged } from './mzta-managed.js';

// Preferences live in storage.local, NOT storage.sync. They were moved there because
// storage.sync has a narrow quota — the same reason the large prompt payloads were moved
// for https://github.com/micz/ThunderAI/issues/129. The consequence is deliberate:
// preferences no longer follow the user across profiles or devices.
//
// The one-time copy from sync lives in js/mzta-prefs-migration.js and runs at the top of
// mzta-background.js. The sync copy is intentionally left in place, so a downgrade to an
// older version still finds the user's settings.
//
// Switching areas is a single edit here precisely because every preference read goes
// through this module (issue #163). Anything reading storage directly must be kept in step.
const PREFS_AREA = browser.storage.local;
const PREFS_AREA_NAME = 'local';

export const mztaPrefs = {

    logger: new taLogger("mzta-prefs", false),

    // do_debug is itself a preference, so it cannot be fetched through getPref() without
    // recursing on every single read. It is read once directly, lazily, and then kept up
    // to date by the storage.onChanged listener registered at the bottom of this file.
    _debugReady: false,

    async _initLogger() {
        if (this._debugReady) return;
        this._debugReady = true;
        try {
            const prefs = await PREFS_AREA.get({ do_debug: prefs_default.do_debug });
            this.logger.changeDebug(prefs.do_debug === true);
        } catch (e) {
            // A failed debug-flag read must never break an actual preference read.
            this._debugReady = false;
        }
    },

    // Mask API key values in the log output. Same rule as isAPIKeyValue() in
    // js/mzta-utils.js, inlined rather than imported: that module pulls in
    // mzta-custom-menu-icons.js, a dependency this one has no other use for.
    _logValue(pref_id, value) {
        return pref_id.endsWith('_api_key') ? '****************' : value;
    },

    _logWarning(msg) {
        this.logger.warn(msg);
    },

    // Build the {id: default} object handed to PREFS_AREA.get(). An id with no entry in
    // prefs_default gets `undefined` as its default, so the mistake surfaces instead of
    // silently reading as absent.
    //
    // This is also where an UNLOCKED policy value takes effect. Handing it to get() as the
    // default is exactly the semantics the lock convention asks for: the user's own stored
    // value still wins, and the policy value is only what they see until they change
    // something. A LOCKED key is not handled here - it has to beat the stored value, which
    // a default cannot do, so it is overwritten afterwards by _applyLocked().
    _defaultsFor(pref_ids, caller) {
        const obj = {};
        pref_ids.forEach(pref_id => {
            if (!(pref_id in prefs_default)) {
                this._logWarning(caller + ': unknown preference id "' + pref_id +
                    '", it has no entry in prefs_default.');
            }
            if (mztaManaged.hasManagedValue(pref_id) && !mztaManaged.isManagedLocked(pref_id)) {
                obj[pref_id] = mztaManaged.getManagedValue(pref_id);
            } else {
                obj[pref_id] = prefs_default[pref_id];
            }
        });
        return obj;
    },

    // Overwrite every locked key in a result object with the value the policy enforces.
    //
    // This runs AFTER the storage read, because an enforced value must win over whatever
    // is in storage.local - including a value written before the policy was installed, or
    // by a version of the add-on that predates it.
    _applyLocked(result, pref_ids) {
        pref_ids.forEach(pref_id => {
            if (mztaManaged.isManagedLocked(pref_id)) {
                result[pref_id] = mztaManaged.getManagedValue(pref_id);
            }
        });
        return result;
    },

    /**
     * Read a single preference.
     * Returns the stored value, or prefs_default[pref_id] if the key is MISSING from
     * storage. A stored null is returned as null - see the note on getPrefs().
     */
    async getPref(pref_id) {
        await this._initLogger();
        await mztaManaged.managedReady();
        const prefs = await PREFS_AREA.get(this._defaultsFor([pref_id], 'getPref'));
        this._applyLocked(prefs, [pref_id]);
        this.logger.log("getPref: " + pref_id + " = " +
            this._logValue(pref_id, JSON.stringify(prefs[pref_id])));
        return prefs[pref_id];
    },

    /**
     * Read several preferences at once.
     * Returns a plain {id: value} object with exactly the requested ids, identical in shape
     * to what browser.storage.get() returns, so no call site needs any other change.
     *
     * storage.get() semantics are preserved EXACTLY: a default is substituted only for
     * a key that is MISSING from storage. A stored null - which is what an emptied number
     * input serializes to (NaN -> null) - comes through as null, untouched. Several call
     * sites depend on that and guard with Number.isInteger()/Number.isFinite(); see the
     * comment in mzta-background.js above the summarize_auto read. Do NOT add null coercion
     * here.
     */
    async getPrefs(pref_ids) {
        await this._initLogger();
        await mztaManaged.managedReady();
        const prefs = await PREFS_AREA.get(this._defaultsFor(pref_ids, 'getPrefs'));
        this._applyLocked(prefs, pref_ids);
        const result = {};
        const log_parts = [];
        pref_ids.forEach(pref_id => {
            result[pref_id] = prefs[pref_id];
            log_parts.push(pref_id + ': ' +
                this._logValue(pref_id, JSON.stringify(prefs[pref_id])));
        });
        this.logger.log("getPrefs: {" + log_parts.join(', ') + "}");
        return result;
    },

    /**
     * Read every declared preference. Same semantics as getPrefs(), over all of prefs_default.
     */
    async getAllPrefs() {
        await this._initLogger();
        await mztaManaged.managedReady();
        this.logger.log("getAllPrefs");
        const pref_ids = Object.keys(prefs_default);
        const prefs = await PREFS_AREA.get(this._defaultsFor(pref_ids, 'getAllPrefs'));
        return this._applyLocked(prefs, pref_ids);
    },

    /**
     * Write a single preference.
     */
    async setPref(pref_id, value) {
        await this._initLogger();
        await mztaManaged.managedReady();
        // THE WRITE GUARD. An enforced value must never reach storage.local: once there it
        // would outlive the policy, so removing the policy would leave the user silently
        // stuck with what it used to impose. Skipping the write is what keeps the policy
        // the only source of that value.
        // Silent for the caller - no call site checks a return value - but warned in the
        // console, because a write to a locked key means some UI is still enabled that the
        // managed layer should have disabled.
        if (mztaManaged.isManagedLocked(pref_id)) {
            this._logWarning('setPref: "' + pref_id + '" is locked by the managed ' +
                'configuration, write skipped.');
            return;
        }
        this.logger.log('Saving option: ' + pref_id + ' = ' +
            this._logValue(pref_id, JSON.stringify(value)));
        return await PREFS_AREA.set({ [pref_id]: value });
    },

    /**
     * Write several preferences in one storage operation.
     *
     * Same area and same logging/masking rules as setPref(). It exists so that a
     * multi-key write is not forced to bypass this module: every writer that used to
     * call browser.storage.local.set() directly with an object goes through here, which
     * keeps this file the single choke point for writes as well as for reads.
     *
     * An empty object writes nothing, mirroring what the direct set() calls did when
     * their object came out empty.
     */
    async setPrefs(prefs_obj) {
        await this._initLogger();
        await mztaManaged.managedReady();
        // Same write guard as setPref(), applied per key. Deliberately NOT atomic: the
        // callers are seeding a whole provider block at once, and one locked key must not
        // stop the other seven or eight from being written.
        const allowed = {};
        const skipped = [];
        const log_parts = [];
        Object.entries(prefs_obj).forEach(([pref_id, value]) => {
            if (mztaManaged.isManagedLocked(pref_id)) {
                skipped.push(pref_id);
                return;
            }
            allowed[pref_id] = value;
            log_parts.push(pref_id + ': ' +
                this._logValue(pref_id, JSON.stringify(value)));
        });
        if (skipped.length > 0) {
            this._logWarning('setPrefs: locked by the managed configuration, skipped: ' +
                skipped.join(', '));
        }
        if (log_parts.length === 0) return;
        this.logger.log("setPrefs: {" + log_parts.join(', ') + "}");
        return await PREFS_AREA.set(allowed);
    },
};

// Keep the module logger in step with the do_debug preference.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === PREFS_AREA_NAME && changes.do_debug) {
        mztaPrefs.logger.changeDebug(changes.do_debug.newValue === true);
        mztaPrefs._debugReady = true;
    }
});
