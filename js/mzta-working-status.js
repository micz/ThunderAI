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


const IDLE_ICON = "/images/icon-32px.png";
// The ThunderAI Privacy companion's own icon, shown while its switch is on.
const PRIVACY_ICON = "/images/privacy-icon-32px.png";

export const taWorkingStatus = {

    WorkingLevel: 0,
    taLog: console,
    privacyOn: false,

    // Follows the ai_processing_enabled switch. While something works the loading
    // icon stays: the new idle icon shows once the level drops back to zero.
    setPrivacy(enabled){
        this.privacyOn = enabled === true;
        if(this.WorkingLevel<=0){
            this.setIdleIcon();
        }
    },

    setIdleIcon(){
        const path = this.privacyOn ? PRIVACY_ICON : IDLE_ICON;
        browser.messageDisplayAction.setIcon({path: path});
        browser.composeAction.setIcon({path: path});
    },

    startWorking(){
        this.WorkingLevel++;
        this.taLog.log("[startWorking] WorkingLevel: " + this.WorkingLevel);
        browser.messageDisplayAction.setIcon({path: "/images/icon-loading.svg"});
        browser.composeAction.setIcon({path: "/images/icon-loading.svg"});
    },

    stopWorking(){
        this.WorkingLevel--;
        this.taLog.log("[stopWorking] WorkingLevel: " + this.WorkingLevel);
        if(this.WorkingLevel<=0){
            this.WorkingLevel = 0;
            this.setIdleIcon();
        }
    }
};