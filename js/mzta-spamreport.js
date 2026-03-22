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

    _processing_prefix = 'mzta-spam-processing-';
    _max_reports = 100;
    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-spamreport', do_debug);
    }

    async setProcessing(data_id) {
        const key = this._processing_prefix + data_id;
        await browser.storage.session.set({ [key]: true });
    }

    async isProcessing(data_id) {
        const key = this._processing_prefix + data_id;
        let output = await browser.storage.session.get(key);
        return output[key] || false;
    }

    async saveReportData(data, data_id) {
        await this._storage.writeSpam(data_id, data, true);
        await browser.storage.session.remove(this._processing_prefix + data_id);
    }

    async saveError(data_id, error_message) {
        let data = {
            spamValue: -999,
            explanation: error_message,
            report_date: new Date(),
            headerMessageId: data_id
        };
        await this.saveReportData(data, data_id);
        return data;
    }

    async loadReportData(data_id) {
        let record = await this._storage.getRecord(data_id);
        if (!record || !this._storage.hasField(record, 'spam')) return null;
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
        await this._storage.deleteSpamField(data_id);
        await browser.storage.session.remove(this._processing_prefix + data_id);
    }

    async getAllReportData() {
        return await this._storage.getAllSpamRecords();
    }

    async clearReportData() {
        let allSpam = await this._storage.getAllSpamRecords();
        for (let messageId of Object.keys(allSpam)) {
            await this._storage.deleteSpamField(messageId);
        }
        let allSession = await browser.storage.session.get(null);
        let keysToDelete = Object.keys(allSession).filter(k => k.startsWith(this._processing_prefix));
        for (let key of keysToDelete) {
            await browser.storage.session.remove(key);
        }
    }

    async truncReportData() {
        let data = await this._storage.getAllSpamRecords();
        let sortedData = this.sortReportsByDate(data);
        let keys = Object.keys(sortedData);

        if (keys.length > this._max_reports) {
            for (let i = this._max_reports; i < keys.length; i++) {
                await this._storage.deleteSpamField(keys[i]);
            }
        }
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
