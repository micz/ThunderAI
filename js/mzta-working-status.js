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


export const taWorkingStatus = {

    WorkingLevel: 0,
    taLog: console,

    startWorking(){
        this.WorkingLevel++;
        this.taLog.log("[startWorking] WorkingLevel: " + this.WorkingLevel);
        browser.messageDisplayAction.setIcon({path: "/images/icon-loading.svg"});
    },

    stopWorking(){
        this.WorkingLevel--;
        this.taLog.log("[stopWorking] WorkingLevel: " + this.WorkingLevel);
        if(this.WorkingLevel<=0){
            this.WorkingLevel = 0;
            browser.messageDisplayAction.setIcon({path: "/images/icon-32px.png"});
        }
    }
};