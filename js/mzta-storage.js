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

import { taLogger } from './mzta-logger.js';

export class taStorage {

    static STORAGE_KEY_PREFIX = 'msg:';
    static SCHEMA_VERSION = 1;

    taLog = null;

    constructor(do_debug = false) {
        this.taLog = new taLogger("mzta-storage", do_debug);
    }

    /**
     * Build the storage key for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @returns {string} The prefixed storage key.
     */
    _buildKey(messageId) {
        return taStorage.STORAGE_KEY_PREFIX + messageId;
    }

    /**
     * Read the full record for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @returns {Promise<object|null>} The record object or null if not found.
     */
    async getRecord(messageId) {
        try {
            let key = this._buildKey(messageId);
            let result = await messenger.storage.local.get(key);
            return result[key] || null;
        } catch (e) {
            this.taLog.error('getRecord error: ' + e);
            return null;
        }
    }

    /**
     * Check if a record exists and contains the specified field.
     * @param {string} messageId - The Message-ID header string.
     * @param {string} field - The field name to check ("spam", "summary", or "translation").
     * @returns {Promise<boolean>} True if the record exists and the field is present.
     */
    async hasField(messageId, field) {
        try {
            let record = await this.getRecord(messageId);
            return record !== null && field in record;
        } catch (e) {
            this.taLog.error('hasField error: ' + e);
            return false;
        }
    }

    /**
     * Write the spam field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {number} score - Spam score (float 0-1).
     * @param {string} reason - Textual motivation for the score.
     * @param {boolean} [force=false] - If true, overwrite existing spam data.
     */
    async writeSpam(messageId, score, reason, force = true) {
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if ('spam' in record && !force) {
                return;
            }
            let now = Date.now();
            record.spam = { score: score, reason: reason, ts: now };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeSpam error: ' + e);
        }
    }

    /**
     * Write the summary field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {string} text - The summary text.
     * @param {string} lang - The language of the summary.
     * @param {boolean} [force=false] - If true, overwrite existing summary data.
     */
    async writeSummary(messageId, text, force = true) {
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if ('summary' in record && !force) {
                return;
            }
            let now = Date.now();
            record.summary = { text: text, ts: now };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeSummary error: ' + e);
        }
    }

    /**
     * Write the translation field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {string} from - Source language code.
     * @param {string} to - Target language code.
     * @param {string} text - The translated text.
     * @param {boolean} [force=false] - If true, overwrite existing translation data.
     */
    async writeTranslation(messageId, translated_text, lang, force = true) {
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if ('translation' in record && !force) {
                return;
            }
            let now = Date.now();
            record.translation = { translated_text: translated_text, lang: lang, ts: now };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeTranslation error: ' + e);
        }
    }

    /**
     * Delete the entire record for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     */
    async deleteRecord(messageId) {
        try {
            let key = this._buildKey(messageId);
            await messenger.storage.local.remove(key);
        } catch (e) {
            this.taLog.error('deleteRecord error: ' + e);
        }
    }

    /**
     * Remove all records older than maxAgeDays.
     * @param {number} maxAgeDays - Maximum age in days. If 0, does nothing.
     * @returns {Promise<number>} The number of deleted records.
     */
    async cleanup(maxAgeDays) {
        if (maxAgeDays === 0) {
            return 0;
        }
        try {
            let all = await messenger.storage.local.get(null);
            let cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
            let keysToDelete = [];
            for (let key of Object.keys(all)) {
                if (!key.startsWith(taStorage.STORAGE_KEY_PREFIX)) {
                    continue;
                }
                let record = all[key];
                if (record.ts && record.ts < cutoff) {
                    keysToDelete.push(key);
                }
            }
            if (keysToDelete.length > 0) {
                await messenger.storage.local.remove(keysToDelete);
            }
            return keysToDelete.length;
        } catch (e) {
            this.taLog.error('cleanup error: ' + e);
            return 0;
        }
    }
}
