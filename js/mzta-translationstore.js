/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { taStorage } from './mzta-storage.js';
import { taLogger } from './mzta-logger.js';

export class taTranslationStore {

    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-translationstore', do_debug);
    }

    /**
     * Store a translation. metadata: as for taSummaryStore.saveSummary().
     * Rejects when the write fails (see js/mzta-storage.js).
     */
    async saveTranslation(data, data_id, metadata = {}) {
        this.taLog.log("[saveTranslation] data_id: " + data_id);
        try {
            await this._storage.writeTranslation(data_id, { ...data, ...metadata }, true);
        } catch (e) {
            this.taLog.error("[saveTranslation] error: " + e);
            throw e;
        }
    }

    async saveError(data_id, error_message, metadata = {}) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        let data = {
            translated_text: '',
            lang: '',
            error: true,
            message: error_message,
            headerMessageId: data_id
        };
        await this.saveTranslation(data, data_id, metadata);
        return data;
    }

    async loadTranslation(data_id) {
        this.taLog.log("[loadTranslation] data_id: " + data_id);
        let record = await this._storage.getRecord(data_id);
        if (!record || !this._storage.hasField(record, taStorage.FIELD_TRANSLATION)) {
            this.taLog.log("[loadTranslation] no record found for data_id: " + data_id);
            return null;
        }
        let translation = record[taStorage.FIELD_TRANSLATION];
        return {
            headerMessageId: data_id,
            translated_text: translation.translated_text || '',
            translated_subject: translation.translated_subject || '',
            translation_status: translation.translation_status || '',
            lang: translation.lang || '',
            error: translation.error || false,
            message: translation.message || '',
            translation_date: new Date(translation.createdAt),
        };
    }

    async removeTranslation(data_id) {
        this.taLog.log("[removeTranslation] data_id: " + data_id);
        await this._storage.deleteTranslationField(data_id);
    }
}
