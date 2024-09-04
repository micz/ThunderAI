/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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

const urlParams = new URLSearchParams(window.location.search);
const call_id = urlParams.get('call_id');

async function page_ready(call_id){
    await browser.runtime.sendMessage({command: "chatgpt_web_ready_" + call_id});
}

page_ready(call_id);
//console.log(">>>>>>>>>>> [ThunderAI] call_id: " + call_id)