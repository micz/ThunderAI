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

export class taSpamReport {

    // In-flight state lives in taJobRegistry (js/mzta-job-registry.js). The prefix is kept
    // only so clear*() still sweeps keys written to storage.session by older versions.
    _processing_prefix = 'mzta-spam-processing-';
    _max_reports = 1000;
    _index_key = 'spam_index';
    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-spamreport', do_debug);
    }

    async saveReportData(data, data_id) {
        this.taLog.log("[saveReportData] data_id: " + data_id);
        try {
            await this._storage.writeSpam(data_id, data, true);
            let index = (await this._loadIndex()) || {};
            index[data_id] = Date.now();
            await this._saveIndex(index);
        } catch (e) {
            this.taLog.error("[saveReportData] error: " + e);
            throw e;
        }
    }

    async saveError(data_id, error_message, metadata = {}) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        // Merge any available message metadata so the spam log entry does not show
        // blank fields when the message became unreadable during analysis.
        let data = {
            spamValue: -999,
            explanation: error_message,
            report_date: new Date(),
            headerMessageId: data_id,
            moved: false,
            ...metadata
        };
        await this.saveReportData(data, data_id);
        return data;
    }

    async loadReportData(data_id) {
        this.taLog.log("[loadReportData] data_id: " + data_id);
        let record = await this._storage.getRecord(data_id);
        if (!record || !this._storage.hasField(record, taStorage.FIELD_SPAM)) {
            this.taLog.log("[loadReportData] no record found for data_id: " + data_id);
            return null;
        }
        let spam = record.spam;
        return {
            headerMessageId: data_id,
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

    async removeReportData(data_id) {
        this.taLog.log("[removeReportData] data_id: " + data_id);
        await this._storage.deleteSpamField(data_id);
        const index = await this._loadIndex();
        if (index && data_id in index) {
            delete index[data_id];
            await this._saveIndex(index);
        }
    }

    async getAllReportData() {
        this.taLog.log("[getAllReportData] loading all reports");
        return await this._storage.getAllSpamRecords();
    }

    async clearReportData() {
        this.taLog.log("[clearReportData] clearing all report data");
        let allSpam = await this._storage.getAllSpamRecords();
        let spamKeys = Object.keys(allSpam);
        this.taLog.log("[clearReportData] deleting " + spamKeys.length + " spam records");
        await this._storage.deleteSpamFields(spamKeys);
        await this._saveIndex({});
        let allSession = await browser.storage.session.get(null);
        let keysToDelete = Object.keys(allSession).filter(k => k.startsWith(this._processing_prefix));
        this.taLog.log("[clearReportData] deleting " + keysToDelete.length + " session keys");
        for (let key of keysToDelete) {
            await browser.storage.session.remove(key);
        }
    }

    // Compact index of the stored spam reports ({headerMessageId -> ts}), so
    // the truncation can work without scanning the whole record store on
    // every run. Stores older than the index are picked up by _seedIndex.
    async _loadIndex() {
        try {
            const res = await browser.storage.local.get(this._index_key);
            return (this._index_key in res) ? res[this._index_key] : null;
        } catch (e) {
            this.taLog.error("[_loadIndex] error: " + e);
            return null;
        }
    }

    async _saveIndex(index) {
        await browser.storage.local.set({ [this._index_key]: index });
    }

    async _seedIndex() {
        const all = await this._storage.getAllSpamRecords();
        const index = {};
        for (const [id, record] of Object.entries(all)) {
            index[id] = record.ts || Date.now();
        }
        await this._saveIndex(index);
        this.taLog.log("[_seedIndex] seeded with " + Object.keys(index).length + " entries");
        return index;
    }

    async truncReportData() {
        this.taLog.log("[truncReportData] checking report count");
        let index = await this._loadIndex();
        if (index === null) {
            index = await this._seedIndex();
        }
        let entries = Object.entries(index);
        this.taLog.log("[truncReportData] total reports: " + entries.length + ", max: " + this._max_reports);
        if (entries.length <= this._max_reports) {
            return;
        }
        entries.sort((a, b) => b[1] - a[1]);
        let toDelete = entries.slice(this._max_reports).map(([id]) => id);
        this.taLog.log("[truncReportData] truncating " + toDelete.length + " oldest reports");
        await this._storage.deleteSpamFields(toDelete);
        for (let id of toDelete) {
            delete index[id];
        }
        await this._saveIndex(index);
    }

    sortReportsByDate(data) {
        if (!data) return {};
        const reportKeys = Object.keys(data);
        reportKeys.sort((a, b) => {
            const dateA = new Date(data[a].report_date);
            const dateB = new Date(data[b].report_date);
            return dateB - dateA;
        });

        let sortedReports = {};
        reportKeys.forEach((key) => {
            sortedReports[key] = data[key];
        });

        return sortedReports;
    }
}
