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

    _storage = null;
    taLog = null;

    constructor(do_debug = false) {
        this._storage = new taStorage(do_debug);
        this.taLog = new taLogger('mzta-summarystore', do_debug);
    }

    /**
     * Store a summary. metadata: { subject, from, message_date } of the message, as
     * buildMessageMetadata() builds it in js/mzta-storage.js ({} when the message is not
     * available). Rejects when the write fails (see js/mzta-storage.js).
     */
    async saveSummary(data, data_id, metadata = {}) {
        this.taLog.log("[saveSummary] data_id: " + data_id);
        try {
            await this._storage.writeSummary(data_id, { ...data, ...metadata }, true);
        } catch (e) {
            this.taLog.error("[saveSummary] error: " + e);
            throw e;
        }
    }

    async saveError(data_id, error_message, metadata = {}) {
        this.taLog.log("[saveError] data_id: " + data_id + ", error_message: " + error_message);
        let data = {
            error: true,
            message: error_message,
            summary_date: new Date(),
            headerMessageId: data_id
        };
        await this.saveSummary(data, data_id, metadata);
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
            summary_html: summary.summary_html || '',
            error: summary.error || false,
            message: summary.message || '',
            summary_date: new Date(summary.summary_date || summary.createdAt),
        };
    }

    async removeSummary(data_id) {
        this.taLog.log("[removeSummary] data_id: " + data_id);
        await this._storage.deleteSummaryField(data_id);
    }
}
