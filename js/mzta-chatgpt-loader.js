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

// Registered at document_start. ChatGPT can keep the HTML document open for ~20 s
// while its app is already usable, so every document lifecycle event arrives late (issue #924):
// the ready message is sent on the first of a visible composer, the load event, or the timeout.

const urlParams = new URLSearchParams(window.location.search);
const call_id = urlParams.get('call_id');

const loaderStartMs = performance.now();
// measured from navigation start, not from the loader start
const READY_TIMEOUT_MS = 15000;
const COMPOSER_POLL_MS = 250;
// Visible composer, old UI first. The hidden textarea[name="prompt-textarea"]
// fallback in the server HTML must not count, so no textarea is listed.
const COMPOSER_SELECTORS = [
    '#prompt-textarea.ProseMirror',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
];
let ready_sent = false;
let composer_observer = null;
let composer_poll = null;
let ready_timeout = null;

function hasVisibleComposer(){
    if (!document.body) return false;
    for (const selector of COMPOSER_SELECTORS) {
        for (const el of document.querySelectorAll(selector)) {
            if (el.getClientRects().length > 0) return true;
        }
    }
    return false;
}

function cleanup(){
    if (composer_observer) composer_observer.disconnect();
    composer_observer = null;
    clearInterval(composer_poll);
    clearTimeout(ready_timeout);
    window.removeEventListener('load', onPageLoad);
}

async function page_ready(call_id, readyReason){
    if (ready_sent) return;
    ready_sent = true;
    cleanup();
    await browser.runtime.sendMessage({
        command: "chatgpt_web_ready_" + call_id,
        loaderStartMs: loaderStartMs,
        readySentMs: performance.now(),
        readyReason: readyReason,
        readyStateAtSend: document.readyState
    });
}

function checkComposer(){
    if (ready_sent) return;
    try {
        if (hasVisibleComposer()) page_ready(call_id, "composer");
    } catch (err) {
        console.error('[ThunderAI] checkComposer: ', err);
    }
}

function onPageLoad(){
    page_ready(call_id, "load");
}

if (document.readyState === "complete") {
    page_ready(call_id, "load");
} else {
    window.addEventListener('load', onPageLoad);
    composer_observer = new MutationObserver(checkComposer);
    composer_observer.observe(document.documentElement || document, { childList: true, subtree: true });
    composer_poll = setInterval(checkComposer, COMPOSER_POLL_MS);
    ready_timeout = setTimeout(() => page_ready(call_id, "timeout"), Math.max(0, READY_TIMEOUT_MS - performance.now()));
    checkComposer();
}
//console.log(">>>>>>>>>>> [ThunderAI] call_id: " + call_id)
