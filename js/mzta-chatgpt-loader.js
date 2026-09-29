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

const urlParams = new URLSearchParams(window.location.search);
const call_id = urlParams.get('call_id');

const loaderStartMs = performance.now();
const READY_FALLBACK_MS = 10000;
let ready_sent = false;
let ready_fallback_timer = null;

async function page_ready(call_id, readyReason){
    if (ready_sent) return;
    ready_sent = true;
    clearTimeout(ready_fallback_timer);
    window.removeEventListener('load', onPageLoad);
    await browser.runtime.sendMessage({
        command: "chatgpt_web_ready_" + call_id,
        loaderStartMs: loaderStartMs,
        readySentMs: performance.now(),
        readyReason: readyReason
    });
}

function onPageLoad(){
    page_ready(call_id, "load");
}

// Registered at document_end: document_idle also waits for the page's main thread
// to go idle, which on slower machines delayed the ready message by ~20 s (issue #924)
if (document.readyState === "complete") {
    page_ready(call_id, "already-complete");
} else {
    window.addEventListener('load', onPageLoad);
    ready_fallback_timer = setTimeout(() => page_ready(call_id, "timeout"), READY_FALLBACK_MS);
}
//console.log(">>>>>>>>>>> [ThunderAI] call_id: " + call_id)