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

import {
    SPAM_ERROR_VALUE,
    taStorage
} from './mzta-storage.js';
import { taLogger } from './mzta-logger.js';

export class taSpamReport {

    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-spamreport', do_debug);
    }

    /** Store a spam report. Rejects when the write fails (see js/mzta-storage.js). */
    async saveReportData(data, data_id) {
        this.taLog.log("[saveReportData] data_id: " + data_id);
        try {
            await this._storage.writeSpam(data_id, data, true);
        } catch (e) {
            this.taLog.error("[saveReportData] error: " + e);
            throw e;
        }
    }

    /**
     * The report of an analysis that failed, as it is stored and shown. Any available message
     * metadata is merged in, so the spam log entry does not show blank fields when the message
     * became unreadable during analysis.
     */
    buildError(data_id, error_message, metadata = {}) {
        return {
            spamValue: SPAM_ERROR_VALUE,
            explanation: error_message,
            report_date: new Date(),
            headerMessageId: data_id,
            moved: false,
            ...metadata
        };
    }

    async saveError(data_id, error_message, metadata = {}) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        let data = this.buildError(data_id, error_message, metadata);
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
        return taSpamReport.toReport(record.spam);
    }

    /** A stored spam record in the shape the panel and the spam log show. */
    static toReport(spam) {
        return {
            headerMessageId: spam.messageId,
            spamValue: spam.spamValue,
            explanation: spam.explanation,
            report_date: new Date(spam.createdAt),
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
    }

    /** A page of reports, newest first, in the shape of toReport(). */
    async getReportPage(offset = 0, limit = 50) {
        this.taLog.log("[getReportPage] offset: " + offset + ", limit: " + limit);
        const records = await taStorage.getPage(taStorage.FIELD_SPAM, { offset, limit });
        return records.map(r => taSpamReport.toReport(r));
    }

    /** The number of stored reports. */
    async countReports() {
        return await taStorage.count(taStorage.FIELD_SPAM);
    }
}
