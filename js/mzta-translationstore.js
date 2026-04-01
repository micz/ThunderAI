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

    _processing_prefix = 'mzta-translation-processing-';
    _max_translations = 100;
    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-translationstore', do_debug);
    }

    async setProcessing(data_id) {
        this.taLog.log("[setProcessing] data_id: " + data_id);
        const key = this._processing_prefix + data_id;
        await browser.storage.session.set({ [key]: true });
    }

    async isProcessing(data_id) {
        this.taLog.log("[isProcessing] data_id: " + data_id);
        const key = this._processing_prefix + data_id;
        let output = await browser.storage.session.get(key);
        let result = output[key] || false;
        this.taLog.log("[isProcessing] result: " + result);
        return result;
    }

    async saveTranslation(data, data_id) {
        this.taLog.log("[saveTranslation] data_id: " + data_id);
        try {
            await this._storage.writeTranslation(data_id, data, true);
            await browser.storage.session.remove(this._processing_prefix + data_id);
        } catch (e) {
            this.taLog.error("[saveTranslation] error: " + e);
            throw e;
        }
    }

    async saveError(data_id, error_message) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        let data = {
            translated_text: '',
            lang: '',
            error: true,
            message: error_message,
            headerMessageId: data_id
        };
        await this.saveTranslation(data, data_id);
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
            translation_date: new Date(translation.ts),
        };
    }

    async removeTranslation(data_id) {
        this.taLog.log("[removeTranslation] data_id: " + data_id);
        await this._storage.deleteTranslationField(data_id);
        await browser.storage.session.remove(this._processing_prefix + data_id);
    }

    async getAllTranslations() {
        this.taLog.log("[getAllTranslations] loading all translations");
        return await this._storage.getAllTranslationRecords();
    }

    async clearTranslations() {
        this.taLog.log("[clearTranslations] clearing all translation data");
        let allTranslations = await this._storage.getAllTranslationRecords();
        let translationKeys = Object.keys(allTranslations);
        this.taLog.log("[clearTranslations] deleting " + translationKeys.length + " translation records");
        for (let messageId of translationKeys) {
            await this._storage.deleteTranslationField(messageId);
        }
        let allSession = await browser.storage.session.get(null);
        let keysToDelete = Object.keys(allSession).filter(k => k.startsWith(this._processing_prefix));
        this.taLog.log("[clearTranslations] deleting " + keysToDelete.length + " session keys");
        for (let key of keysToDelete) {
            await browser.storage.session.remove(key);
        }
    }

    async truncTranslations() {
        this.taLog.log("[truncTranslations] checking translation count");
        let data = await this._storage.getAllTranslationRecords();
        let sortedData = this.sortTranslationsByDate(data);
        let keys = Object.keys(sortedData);
        this.taLog.log("[truncTranslations] total translations: " + keys.length + ", max: " + this._max_translations);

        if (keys.length > this._max_translations) {
            let toDelete = keys.length - this._max_translations;
            this.taLog.log("[truncTranslations] truncating " + toDelete + " oldest translations");
            for (let i = this._max_translations; i < keys.length; i++) {
                await this._storage.deleteTranslationField(keys[i]);
            }
        }
    }

    sortTranslationsByDate(data) {
        if (!data) return {};
        const translationKeys = Object.keys(data);
        translationKeys.sort((a, b) => {
            const dateA = new Date(data[a].translation_date);
            const dateB = new Date(data[b].translation_date);
            return dateB - dateA;
        });

        let sortedTranslations = {};
        translationKeys.forEach((key) => {
            sortedTranslations[key] = data[key];
        });

        return sortedTranslations;
    }
}
