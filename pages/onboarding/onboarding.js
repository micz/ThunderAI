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

import { taLogger } from '../../js/mzta-logger.js';

let taLog = null;

document.addEventListener('DOMContentLoaded', async () => {
    let prefs = await browser.storage.sync.get({do_debug: false, connection_type: 'chatgpt_web'});
    taLog = new taLogger("mzta-popup",prefs.do_debug);
    i18n.updateDocument();
    if(prefs.connection_type === 'chatgpt_web'){
        let permission_chatgpt = await messenger.permissions.contains({ origins: ["https://*.chatgpt.com/*"] });
        if(permission_chatgpt === false){
            document.getElementById("chatgpt_web_permission").style.display = "block";
            document.getElementById("chatgpt_web_permission").addEventListener("click", async () => {
                let granted = await messenger.permissions.request({ origins: ["https://*.chatgpt.com/*"] });
                if(granted){
                    document.getElementById("chatgpt_web_permission").style.display = "none";
                    document.getElementById("integration_permission_ok").style.display = "block";
                    taLog.log("ChatGPT Web permission granted");
                }else{
                    taLog.log("ChatGPT Web permission denied");
                }
            });
            document.getElementById("integration_permission_ok").addEventListener("click", async () => {
                await messenger.tabs.remove((await messenger.tabs.getCurrent()).id);
            });
        }
    }
    if(prefs.connection_type === 'anthropic_api'){
        let permission_chatgpt = await messenger.permissions.contains({ origins: ["https://*.anthropic.com/*"] });
        if(permission_chatgpt === false){
            document.getElementById("anthropic_api_permission").style.display = "block";
            document.getElementById("anthropic_api_permission").addEventListener("click", async () => {
                let granted = await messenger.permissions.request({ origins: ["https://*.anthropic.com/*"] });
                if(granted){
                    document.getElementById("anthropic_api_permission").style.display = "none";
                    document.getElementById("integration_permission_ok").style.display = "block";
                    taLog.log("Anthropic API permission granted");
                }else{
                    taLog.log("Anthropic API web permission denied");
                }
            });
            document.getElementById("integration_permission_ok").addEventListener("click", async () => {
                await messenger.tabs.remove((await messenger.tabs.getCurrent()).id);
            });
        }
    }
}, { once: true });