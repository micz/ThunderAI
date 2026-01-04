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

export const taSpamReport = {
    logger: console,
    _data_prefix: 'mzta-spam-report-',
    _max_reports: 100,

    async saveReportData(data, data_id) {
        const key = this._data_prefix + data_id;
        await browser.storage.session.set({ [key]: data });
    },

    async loadReportData(data_id) {
        const key = this._data_prefix + data_id;
        let output = await browser.storage.session.get(key);
        return output[key] || null;
    },

    async getAllReportData() {
        let allData = await browser.storage.session.get(null);
        let reportData = {};

        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith(this._data_prefix)) {
                reportData[key.replace(this._data_prefix, '')] = value;
            }
        }

        return reportData;
    },

    async clearReportData() {
        let allData = await browser.storage.session.get(null);
        let keysToDelete = Object.keys(allData).filter(key => key.startsWith(this._data_prefix));

        for (let key of keysToDelete) {
            await browser.storage.session.remove(key);
        }
    },

    async truncReportData() {
        let data = await this.getAllReportData();
        let sortedData = this.sortReportsByDate(data);
        let keys = Object.keys(sortedData);

        if (keys.length > this._max_reports) {
            for (let i = this._max_reports; i < keys.length; i++) {
                await browser.storage.session.remove(this._data_prefix + keys[i]);
            }
        }
    },

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
};
