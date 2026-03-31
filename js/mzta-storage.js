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
    static FIELD_SPAM = 'spam';
    static FIELD_SUMMARY = 'summary';
    static FIELD_TRANSLATION = 'translation';

    taLog = null;

    /**
     * @param {boolean} [do_debug=false] - Enable debug logging.
     */
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
        this.taLog.log('[getRecord] messageId: ' + messageId);
        try {
            let key = this._buildKey(messageId);
            let result = await messenger.storage.local.get(key);
            let record = result[key] || null;
            this.taLog.log('[getRecord] record found: ' + (record !== null));
            return record;
        } catch (e) {
            this.taLog.error('getRecord error: ' + e);
            return null;
        }
    }

    /**
     * Check if a record contains the specified field.
     * @param {object|null} record - The record object (from getRecord).
     * @param {string} field - The field name to check ("spam", "summary", or "translation").
     * @returns {boolean} True if the record exists and the field is present.
     */
    hasField(record, field) {
        this.taLog.log('[hasField] field: ' + field);
        try {
            let result = record !== null && record !== undefined && field in record;
            this.taLog.log('[hasField] result: ' + result);
            return result;
        } catch (e) {
            this.taLog.error('hasField error: ' + e);
            return false;
        }
    }

    /**
     * Write the spam field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {object} report_data - The full spam report object with fields:
     *   spamValue, explanation, subject, from, message_date, moved, SpamThreshold.
     * @param {boolean} [force=true] - If true, overwrite existing spam data.
     */
    async writeSpam(messageId, report_data, force = true) {
        this.taLog.log('[writeSpam] messageId: ' + messageId + ', force: ' + force);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if (taStorage.FIELD_SPAM in record && !force) {
                this.taLog.log('[writeSpam] spam field already exists, skipping (force=false)');
                return;
            }
            let now = Date.now();
            record[taStorage.FIELD_SPAM] = {
                spamValue: report_data.spamValue,
                explanation: report_data.explanation,
                subject: report_data.subject,
                from: report_data.from,
                message_date: report_data.message_date instanceof Date
                    ? report_data.message_date.toISOString()
                    : report_data.message_date,
                moved: report_data.moved,
                SpamThreshold: report_data.SpamThreshold,
                ts: now,
            };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeSpam error: ' + e);
        }
    }

    /**
     * Get all records that contain a spam field.
     * @returns {Promise<object>} Map of messageId -> spam data object (legacy shape).
     */
    async getAllSpamRecords() {
        this.taLog.log('[getAllSpamRecords] loading all spam records');
        try {
            let all = await messenger.storage.local.get(null);
            let result = {};
            for (let [key, record] of Object.entries(all)) {
                if (!key.startsWith(taStorage.STORAGE_KEY_PREFIX)) continue;
                if (!this.hasField(record, taStorage.FIELD_SPAM)) continue;
                let messageId = key.slice(taStorage.STORAGE_KEY_PREFIX.length);
                let spam = record[taStorage.FIELD_SPAM];
                result[messageId] = {
                    headerMessageId: messageId,
                    spamValue: spam.spamValue,
                    explanation: spam.explanation,
                    report_date: new Date(spam.ts),
                    subject: spam.subject,
                    from: spam.from,
                    message_date: spam.message_date,
                    moved: spam.moved,
                    SpamThreshold: spam.SpamThreshold,
                };
            }
            this.taLog.log('[getAllSpamRecords] found ' + Object.keys(result).length + ' spam records');
            return result;
        } catch (e) {
            this.taLog.error('getAllSpamRecords error: ' + e);
            return {};
        }
    }

    /**
     * Delete only the spam field from a record.
     * Deletes the entire record if no other data fields remain.
     * @param {string} messageId - The Message-ID header string.
     */
    async deleteSpamField(messageId) {
        this.taLog.log('[deleteSpamField] messageId: ' + messageId);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId);
            if (!record || !(taStorage.FIELD_SPAM in record)) {
                this.taLog.log('[deleteSpamField] no spam field found for messageId: ' + messageId);
                return;
            }
            delete record[taStorage.FIELD_SPAM];
            const remainingFields = Object.keys(record).filter(k => k !== 'v' && k !== 'ts');
            if (remainingFields.length === 0) {
                this.taLog.log('[deleteSpamField] no remaining fields, deleting entire record');
                await messenger.storage.local.remove(key);
            } else {
                this.taLog.log('[deleteSpamField] remaining fields: ' + remainingFields.join(', '));
                await messenger.storage.local.set({ [key]: record });
            }
        } catch (e) {
            this.taLog.error('deleteSpamField error: ' + e);
        }
    }

    /**
     * Write the summary field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {object} summary_data - The summary data object with fields:
     *   summary, error, message, summary_date.
     * @param {boolean} [force=true] - If true, overwrite existing summary data.
     */
    async writeSummary(messageId, summary_data, force = true) {
        this.taLog.log('[writeSummary] messageId: ' + messageId + ', force: ' + force);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if (taStorage.FIELD_SUMMARY in record && !force) {
                this.taLog.log('[writeSummary] summary field already exists, skipping (force=false)');
                return;
            }
            let now = Date.now();
            record[taStorage.FIELD_SUMMARY] = {
                summary: summary_data.summary,
                summary_html: summary_data.summary_html || '',
                error: summary_data.error || false,
                message: summary_data.message || '',
                summary_date: summary_data.summary_date instanceof Date
                    ? summary_data.summary_date.toISOString()
                    : summary_data.summary_date,
                ts: now,
            };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeSummary error: ' + e);
        }
    }

    /**
     * Get all records that contain a summary field.
     * @returns {Promise<object>} Map of messageId -> summary data object.
     */
    async getAllSummaryRecords() {
        this.taLog.log('[getAllSummaryRecords] loading all summary records');
        try {
            let all = await messenger.storage.local.get(null);
            let result = {};
            for (let [key, record] of Object.entries(all)) {
                if (!key.startsWith(taStorage.STORAGE_KEY_PREFIX)) continue;
                if (!this.hasField(record, taStorage.FIELD_SUMMARY)) continue;
                let messageId = key.slice(taStorage.STORAGE_KEY_PREFIX.length);
                let summary = record[taStorage.FIELD_SUMMARY];
                result[messageId] = {
                    headerMessageId: messageId,
                    summary: summary.summary,
                    error: summary.error || false,
                    message: summary.message || '',
                    summary_date: new Date(summary.summary_date || summary.ts),
                };
            }
            this.taLog.log('[getAllSummaryRecords] found ' + Object.keys(result).length + ' summary records');
            return result;
        } catch (e) {
            this.taLog.error('getAllSummaryRecords error: ' + e);
            return {};
        }
    }

    /**
     * Delete only the summary field from a record.
     * Deletes the entire record if no other data fields remain.
     * @param {string} messageId - The Message-ID header string.
     */
    async deleteSummaryField(messageId) {
        this.taLog.log('[deleteSummaryField] messageId: ' + messageId);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId);
            if (!record || !(taStorage.FIELD_SUMMARY in record)) {
                this.taLog.log('[deleteSummaryField] no summary field found for messageId: ' + messageId);
                return;
            }
            delete record[taStorage.FIELD_SUMMARY];
            const remainingFields = Object.keys(record).filter(k => k !== 'v' && k !== 'ts');
            if (remainingFields.length === 0) {
                this.taLog.log('[deleteSummaryField] no remaining fields, deleting entire record');
                await messenger.storage.local.remove(key);
            } else {
                this.taLog.log('[deleteSummaryField] remaining fields: ' + remainingFields.join(', '));
                await messenger.storage.local.set({ [key]: record });
            }
        } catch (e) {
            this.taLog.error('deleteSummaryField error: ' + e);
        }
    }

    /**
     * Write the translation field for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     * @param {string} translated_text - The translated text.
     * @param {string} lang - Target language code.
     * @param {boolean} [force=true] - If true, overwrite existing translation data.
     */
    async writeTranslation(messageId, data, force = true) {
        const {
            translated_text = '',
            translated_subject = '',
            translation_status = '',
            lang = '',
            error = false,
            message = '',
        } = data || {};
        this.taLog.log('[writeTranslation] messageId: ' + messageId + ', lang: ' + lang + ', force: ' + force);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId) || { v: taStorage.SCHEMA_VERSION };
            if (taStorage.FIELD_TRANSLATION in record && !force) {
                this.taLog.log('[writeTranslation] translation field already exists, skipping (force=false)');
                return;
            }
            let now = Date.now();
            record[taStorage.FIELD_TRANSLATION] = {
                translated_text,
                translated_subject,
                translation_status,
                lang,
                error,
                message,
                ts: now
            };
            record.ts = now;
            await messenger.storage.local.set({ [key]: record });
        } catch (e) {
            this.taLog.error('writeTranslation error: ' + e);
        }
    }

    /**
     * Get all records that have a translation field.
     * @returns {Promise<Object>} A map of messageId → translation data.
     */
    async getAllTranslationRecords() {
        this.taLog.log('[getAllTranslationRecords] loading all translation records');
        try {
            let all = await messenger.storage.local.get(null);
            let result = {};
            for (let [key, record] of Object.entries(all)) {
                if (!key.startsWith(taStorage.STORAGE_KEY_PREFIX)) continue;
                if (!this.hasField(record, taStorage.FIELD_TRANSLATION)) continue;
                let messageId = key.slice(taStorage.STORAGE_KEY_PREFIX.length);
                let translation = record[taStorage.FIELD_TRANSLATION];
                result[messageId] = {
                    headerMessageId: messageId,
                    translated_text: translation.translated_text,
                    lang: translation.lang || '',
                    error: translation.error || false,
                    message: translation.message || '',
                    translation_date: new Date(translation.ts),
                };
            }
            return result;
        } catch (e) {
            this.taLog.error('getAllTranslationRecords error: ' + e);
            return {};
        }
    }

    /**
     * Delete only the translation field from a record.
     * Deletes the entire record if no other data fields remain.
     * @param {string} messageId - The Message-ID header string.
     */
    async deleteTranslationField(messageId) {
        this.taLog.log('[deleteTranslationField] messageId: ' + messageId);
        try {
            let key = this._buildKey(messageId);
            let record = await this.getRecord(messageId);
            if (!record || !(taStorage.FIELD_TRANSLATION in record)) {
                this.taLog.log('[deleteTranslationField] no translation field found for messageId: ' + messageId);
                return;
            }
            delete record[taStorage.FIELD_TRANSLATION];
            const remainingFields = Object.keys(record).filter(k => k !== 'v' && k !== 'ts');
            if (remainingFields.length === 0) {
                this.taLog.log('[deleteTranslationField] no remaining fields, deleting entire record');
                await messenger.storage.local.remove(key);
            } else {
                this.taLog.log('[deleteTranslationField] remaining fields: ' + remainingFields.join(', '));
                await messenger.storage.local.set({ [key]: record });
            }
        } catch (e) {
            this.taLog.error('deleteTranslationField error: ' + e);
        }
    }

    /**
     * Delete the entire record for a given Message-ID.
     * @param {string} messageId - The Message-ID header string.
     */
    async deleteRecord(messageId) {
        this.taLog.log('[deleteRecord] messageId: ' + messageId);
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
        this.taLog.log('[cleanup] maxAgeDays: ' + maxAgeDays);
        if (maxAgeDays === 0) {
            this.taLog.log('[cleanup] maxAgeDays is 0, skipping cleanup');
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
            this.taLog.log('[cleanup] found ' + keysToDelete.length + ' records older than ' + maxAgeDays + ' days');
            if (keysToDelete.length > 0) {
                await messenger.storage.local.remove(keysToDelete);
            }
            return keysToDelete.length;
        } catch (e) {
            this.taLog.error('cleanup error: ' + e);
            return 0;
        }
    }

    /**
     * Remove all records (all keys with the storage prefix).
     * @returns {Promise<number>} The number of deleted records.
     */
    static async clearAllRecords() {
        try {
            let all = await messenger.storage.local.get(null);
            let keysToDelete = Object.keys(all).filter(k => k.startsWith(taStorage.STORAGE_KEY_PREFIX));
            if (keysToDelete.length > 0) {
                await messenger.storage.local.remove(keysToDelete);
            }
            return keysToDelete.length;
        } catch (e) {
            console.error('[taStorage.clearAllRecords] error: ' + e);
            return 0;
        }
    }
}
