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

import { taStorage } from './mzta-storage.js';
import { taLogger } from './mzta-logger.js';

export class taSummaryStore {

    _processing_prefix = 'mzta-summary-processing-';
    _max_summaries = 100;
    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-summarystore', do_debug);
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

    async saveSummary(data, data_id) {
        this.taLog.log("[saveSummary] data_id: " + data_id);
        try {
            await this._storage.writeSummary(data_id, data, true);
            await browser.storage.session.remove(this._processing_prefix + data_id);
        } catch (e) {
            this.taLog.error("[saveSummary] error: " + e);
            throw e;
        }
    }

    async saveError(data_id, error_message) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        let data = {
            error: true,
            message: error_message,
            summary_date: new Date(),
            headerMessageId: data_id
        };
        await this.saveSummary(data, data_id);
        return data;
    }

    async loadSummary(data_id) {
        this.taLog.log("[loadSummary] data_id: " + data_id);
        let record = await this._storage.getRecord(data_id);
        if (!record || !this._storage.hasField(record, taStorage.FIELD_SUMMARY)) {
            this.taLog.log("[loadSummary] no record found for data_id: " + data_id);
            return null;
        }
        let summary = record.summary;
        return {
            headerMessageId: data_id,
            summary: summary.summary,
            error: summary.error || false,
            message: summary.message || '',
            summary_date: new Date(summary.summary_date || summary.ts),
        };
    }

    async removeSummary(data_id) {
        this.taLog.log("[removeSummary] data_id: " + data_id);
        await this._storage.deleteSummaryField(data_id);
        await browser.storage.session.remove(this._processing_prefix + data_id);
    }

    async getAllSummaries() {
        this.taLog.log("[getAllSummaries] loading all summaries");
        return await this._storage.getAllSummaryRecords();
    }

    async clearSummaries() {
        this.taLog.log("[clearSummaries] clearing all summary data");
        let allSummaries = await this._storage.getAllSummaryRecords();
        let summaryKeys = Object.keys(allSummaries);
        this.taLog.log("[clearSummaries] deleting " + summaryKeys.length + " summary records");
        for (let messageId of summaryKeys) {
            await this._storage.deleteSummaryField(messageId);
        }
        let allSession = await browser.storage.session.get(null);
        let keysToDelete = Object.keys(allSession).filter(k => k.startsWith(this._processing_prefix));
        this.taLog.log("[clearSummaries] deleting " + keysToDelete.length + " session keys");
        for (let key of keysToDelete) {
            await browser.storage.session.remove(key);
        }
    }

    async truncSummaries() {
        this.taLog.log("[truncSummaries] checking summary count");
        let data = await this._storage.getAllSummaryRecords();
        let sortedData = this.sortSummariesByDate(data);
        let keys = Object.keys(sortedData);
        this.taLog.log("[truncSummaries] total summaries: " + keys.length + ", max: " + this._max_summaries);

        if (keys.length > this._max_summaries) {
            let toDelete = keys.length - this._max_summaries;
            this.taLog.log("[truncSummaries] truncating " + toDelete + " oldest summaries");
            for (let i = this._max_summaries; i < keys.length; i++) {
                await this._storage.deleteSummaryField(keys[i]);
            }
        }
    }

    sortSummariesByDate(data) {
        if (!data) return {};
        const summaryKeys = Object.keys(data);
        summaryKeys.sort((a, b) => {
            const dateA = new Date(data[a].summary_date);
            const dateB = new Date(data[b].summary_date);
            return dateB - dateA;
        });

        let sortedSummaries = {};
        summaryKeys.forEach((key) => {
            sortedSummaries[key] = data[key];
        });

        return sortedSummaries;
    }
}
