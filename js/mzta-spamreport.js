/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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
    _internal_data_id: 'mzta-spam-report-data',
    _max_reports: 100,

    async saveReportData(data, data_id){
        let obj = await browser.storage.session.get(taSpamReport._internal_data_id);
        //console.log(">>>>>>>> saveReportData obj 1: " + JSON.stringify(obj));
        if(obj == undefined){
            obj = {};
            obj[taSpamReport._internal_data_id] = {};
            //console.log(">>>>>>>> saveReportData obj 2a: " + JSON.stringify(obj));
        }
        if(Object.keys(obj).length === 0){
            obj[taSpamReport._internal_data_id] = {};
            //console.log(">>>>>>>> saveReportData obj 2b: " + JSON.stringify(obj));
        }
        
        obj[taSpamReport._internal_data_id][data_id] = data;
        //console.log(">>>>>>>> saveReportData obj 3: " + JSON.stringify(obj));
        await browser.storage.session.set(obj);
    },

    async loadReportData(data_id){
        let output = await browser.storage.session.get(taSpamReport._internal_data_id);
        return output[taSpamReport._internal_data_id][data_id];
    },

    async getAllReportData(){
        let data = await browser.storage.session.get(taSpamReport._internal_data_id);
        //console.log(">>>>>>>>>>> getAllReportData: " + JSON.stringify(data));
        return data[taSpamReport._internal_data_id];
    },

    saveAllData(data){
        browser.storage.session.set({[taSpamReport._internal_data_id]: data});
    },

    clearReportData(){
        browser.storage.session.clear();
    },

    async truncReportData(){
        let data = taSpamReport.sortReportsByDate(await taSpamReport.getAllReportData());
        if(data == undefined) return;
        //console.log(">>>>>>>>>> truncReportData: " + JSON.stringify(data));
        if(Object.keys(data).length > taSpamReport._max_reports){
            let keys = Object.keys(data);
            for(let i = taSpamReport._max_reports; i < keys.length; i++){
                // console.log(">>>>>>>>>> truncReportData: " + keys[i]);
                // console.log(">>>>>>>>>> truncReportData i: " + i);
                delete data[keys[i]];
            }
        }
        taSpamReport.saveAllData(data);
    },

    sortReportsByDate(data) {
        if(data == undefined) return undefined;
        const reportKeys = Object.keys(data);
        reportKeys.sort((a, b) => {
            const dateA = new Date(data[a].report_date);
            const dateB = new Date(data[b].report_date);
            return dateB - dateA;
        });
        const sortedReports = {};
        reportKeys.forEach((key) => {
            sortedReports[key] = data[key];
        });
        return sortedReports;
    }
}