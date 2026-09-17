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
 *  This is the single choke point for every preference READ in the add-on, and therefore
 *  also the one place that decides WHICH storage area preferences live in (see PREFS_AREA
 *  below). A handful of call sites read storage directly and are documented at their own
 *  lines: the two one-shot migration flags in js/mzta-prompts.js, the classic content
 *  script js/mzta-compose-script.js, and one guarded read in pages/_lib/connection-ui.js.
 *  All of them must use the same area as PREFS_AREA.
 */

import { prefs_default } from '../options/mzta-options-default.js';
import { taLogger } from './mzta-logger.js';

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
    _defaultsFor(pref_ids, caller) {
        const obj = {};
        pref_ids.forEach(pref_id => {
            if (!(pref_id in prefs_default)) {
                this._logWarning(caller + ': unknown preference id "' + pref_id +
                    '", it has no entry in prefs_default.');
            }
            obj[pref_id] = prefs_default[pref_id];
        });
        return obj;
    },

    /**
     * Read a single preference.
     * Returns the stored value, or prefs_default[pref_id] if the key is MISSING from
     * storage. A stored null is returned as null - see the note on getPrefs().
     */
    async getPref(pref_id) {
        await this._initLogger();
        const prefs = await PREFS_AREA.get(this._defaultsFor([pref_id], 'getPref'));
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
        const prefs = await PREFS_AREA.get(this._defaultsFor(pref_ids, 'getPrefs'));
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
        this.logger.log("getAllPrefs");
        return await PREFS_AREA.get(prefs_default);
    },

    /**
     * Write a single preference. Multi-key writes stay as direct storage.set() calls.
     */
    async setPref(pref_id, value) {
        await this._initLogger();
        this.logger.log('Saving option: ' + pref_id + ' = ' +
            this._logValue(pref_id, JSON.stringify(value)));
        return await PREFS_AREA.set({ [pref_id]: value });
    },
};

// Keep the module logger in step with the do_debug preference.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === PREFS_AREA_NAME && changes.do_debug) {
        mztaPrefs.logger.changeDebug(changes.do_debug.newValue === true);
        mztaPrefs._debugReady = true;
    }
});
