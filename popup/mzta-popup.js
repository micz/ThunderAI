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

import { prefs_default } from "../options/mzta-options-default.js";
import { taLogger } from "../js/mzta-logger.js";
import { hasNoConnectionSelected } from "../js/mzta-utils.js";

let menuSendImmediately = false;
let taLog = console;
let tabType;
document.addEventListener('DOMContentLoaded', async () => {
    let prefs = await browser.storage.sync.get({
      do_debug: prefs_default.do_debug,
      dynamic_menu_force_enter: prefs_default.dynamic_menu_force_enter,
      connection_type: prefs_default.connection_type,
      chatgpt_api_key: prefs_default.chatgpt_api_key,
      google_gemini_api_key: prefs_default.google_gemini_api_key,
      anthropic_api_key: prefs_default.anthropic_api_key,
      ollama_host: prefs_default.ollama_host,
      openai_comp_host: prefs_default.openai_comp_host
    });
    taLog = new taLogger("mzta-popup",prefs.do_debug);
    i18n.updateDocument();

    // If the selected connection has no credentials yet, offer the setup wizard
    // instead of the prompts list. (ChatGPT Web needs only a host permission,
    // handled by the dedicated permission banner below.)
    if(!isConnectionConfigured(prefs)){
        document.getElementById("mzta_search_banner").style.display = "none";
        document.getElementById("setup_wizard_prompt").style.display = "block";
        document.getElementById("btn_popup_setup_wizard").addEventListener("click", async (e) => {
            e.preventDefault();
            await browser.tabs.create({ url: "../pages/setup-wizard/mzta-setup-wizard.html" });
            window.close();
        });
        return;
    }
    let reponse = await browser.runtime.sendMessage({command: "popup_menu_ready"});
    if (!reponse || typeof reponse !== 'object') {
        const loadingEl = document.getElementById("mzta_autocomplete-items-loading");
        if (loadingEl) loadingEl.style.display = "none";
        taLog.log("No active tab ready for popup menu");
        return;
    }
    taLog.log("Preparing data to load the popup menu: " + JSON.stringify(reponse));

    // If a batch email processing job is running, show a "Stop processing" banner.
    setupBatchStopBanner(reponse.batchStatus);

    let tabId = reponse.lastShortcutTabId;
    tabType = reponse.lastShortcutTabType;
    let filtering = reponse.lastShortcutFiltering;
    let _prompts_data = reponse.lastShortcutPromptsData;
    taLog.log("_prompts_data: " + JSON.stringify(_prompts_data));
    let active_prompts = filterPromptsForTab(_prompts_data, filtering);
    active_prompts.forEach(item => {
        if (item && item.label) {
            item.label = new DOMParser().parseFromString(item.label, "text/html").documentElement.textContent;
        }
    });
    taLog.log("active_prompts: " + JSON.stringify(active_prompts));
    menuSendImmediately = prefs.dynamic_menu_force_enter;
    searchPrompt(active_prompts, tabId, tabType, filtering);
    i18n.updateDocument();

    if(prefs.connection_type === 'chatgpt_web'){
        let permission_chatgpt = await browser.permissions.contains({ origins: ["https://*.chatgpt.com/*"] });
        if(permission_chatgpt === false){
            document.getElementById("mzta_search_banner").style.display = "none";
            document.getElementById("ask_chatgpt_web_perm").style.display = "block";
            document.getElementById('ask_chatgpt_web_perm').addEventListener('click', async () => {
                await browser.tabs.create({ url: "../pages/onboarding/onboarding.html" });
            });
        }
    }
    if(prefs.connection_type === 'anthropic_api'){
        let permission_anthropic = await browser.permissions.contains({ origins: ["https://*.anthropic.com/*"] });
        if(permission_anthropic === false){
            document.getElementById("mzta_search_banner").style.display = "none";
            document.getElementById("ask_anthropic_api_perm").style.display = "block";
            document.getElementById('ask_anthropic_api_perm').addEventListener('click', async () => {
                await browser.tabs.create({ url: "../pages/onboarding/onboarding.html" });
            });
        }
    }
    if(prefs.connection_type === 'chatgpt_api'){
        let permission_openai = await browser.permissions.contains({ origins: ["https://*.openai.com/*"] });
        if(permission_openai === false){
            document.getElementById("mzta_search_banner").style.display = "none";
            document.getElementById("ask_openai_api_perm").style.display = "block";
            document.getElementById('ask_openai_api_perm').addEventListener('click', async () => {
                await browser.tabs.create({ url: "../pages/onboarding/onboarding.html" });
            });
        }
    }
}, { once: true });

// Returns true when the selected connection type has the credentials it needs
// to work. Used to offer the setup wizard from the popup when nothing has been
// configured yet. ChatGPT Web has no credential (only a host permission, shown
// by its own banner), so it's treated as "configured" here.
function isConnectionConfigured(prefs){
    // No connection chosen at all (fresh install): the wizard is the way in.
    if(hasNoConnectionSelected(prefs.connection_type)){
        return false;
    }
    switch(prefs.connection_type){
        case 'chatgpt_api':        return !!(prefs.chatgpt_api_key || '').trim();
        case 'google_gemini_api':  return !!(prefs.google_gemini_api_key || '').trim();
        case 'anthropic_api':      return !!(prefs.anthropic_api_key || '').trim();
        case 'ollama_api':         return !!(prefs.ollama_host || '').trim();
        case 'openai_comp_api':    return !!(prefs.openai_comp_host || '').trim();
        case 'chatgpt_web':
        default:                   return true;
    }
}

export function searchPrompt(allPrompts, tabId, tabType, filtering){
 taLog.log("tabType: " + tabType);

 allPrompts = Array.isArray(allPrompts) ? allPrompts : [];

 // Sort by position: use position_display for reading (filtering=1), position_compose for composing (filtering=2)
 const posKey = filtering === 2 ? 'position_compose' : 'position_display';
 allPrompts.sort((a, b) => (a[posKey] || 9999) - (b[posKey] || 9999));

 let input = document.getElementById('mzta_search_input');
 let autocompleteList = document.getElementById('mzta_autocomplete-items');
 let autocompleteListLoading = document.getElementById('mzta_autocomplete-items-loading');
 let _spacer_div = document.getElementById('_spacer_div');
 let banner = document.getElementById('mzta_search_banner');

 // Initialize variables to track focus and selection
 let currentFocus = -1; // Tracks the currently highlighted item
 let selectedId = null; // Tracks the ID of the selected item

 // Function to filter and display autocomplete suggestions
 input.addEventListener('input', function () {
   const q = (this.value || '').trim().toLowerCase();
   autocompleteList.innerHTML = ''; // Clear previous suggestions
   currentFocus = -1; // Reset highlighted index
   selectedId = null; // Reset selected ID

   autocompleteListLoading.style.display = 'none';

   // Filter data based on the query
   let filteredData = allPrompts.filter(item => 
     item && item.label && item.label.toLowerCase().includes(q)
   );
   taLog.log("filteredData: " + JSON.stringify(filteredData));

   if (filteredData.length === 0) {
       autocompleteList.style.display = 'none';
       _spacer_div.style.display = 'none';
       return;
   }

   // Create a div for each filtered result
   filteredData.forEach((item, index) => {
       const itemDiv = document.createElement('div');
       itemDiv.classList.add('mzta_autocomplete-item');

       // Icon slot: always present so every row keeps the same left offset.
       // Icons are display-only here; they are chosen in the Menu Order page.
       const itemIcon = document.createElement('img');
       itemIcon.classList.add('mzta_item_icon');
       itemIcon.alt = '';
       itemIcon.draggable = false;   // don't let a native image drag swallow the click
       if (item.custom_icon) {
           // getContextMenuIcon() returns a "moz-extension:"-prefixed path; the popup
           // lives one level deep, so a single "../" makes it usable from here.
           itemIcon.src = '../' + item.custom_icon.replace(/^moz-extension:/, '');
       } else {
           itemIcon.classList.add('mzta_item_icon_empty');
       }
       itemDiv.appendChild(itemIcon);

       // Number shortcut prefix: 1-9 for indices 0-8, 0 for index 9
       const prefix = index < 9 ? `${index + 1}. ` : (index === 9 ? '0. ' : '');
       const itemLabel = document.createElement('span');
       itemLabel.classList.add('mzta_item_label');
       itemLabel.textContent = prefix + item.label;
       itemDiv.appendChild(itemLabel);

       itemDiv.setAttribute('data-id', item.id);

       // Add a mousedown event to select the item
       itemDiv.addEventListener('mousedown', function(e) { // Use mousedown instead of click
           e.preventDefault(); // Prevents the input from losing focus
           input.value = item.label;
           selectedId = item.id; // Store the selected item's ID
           currentFocus = -1;
           taLog.log('mousedown selectedId:', selectedId);
           autocompleteList.style.display = 'none';
           _spacer_div.style.display = 'none';
           sendPrompt(selectedId, tabId);
       });

       // Add a select_prompt event to select the item
       itemDiv.addEventListener('select_prompt', function(e) { // Use select_prompt instead of click
           e.preventDefault(); // Prevents the input from losing focus
           input.value = item.label;
           selectedId = item.id; // Store the selected item's ID
           currentFocus = -1;
           autocompleteList.style.display = 'none';
           _spacer_div.style.display = 'none';
           if(menuSendImmediately){
               sendPrompt(selectedId, tabId);
           }
       });

       autocompleteList.appendChild(itemDiv);
   });

   autocompleteList.style.display = 'block';
   _spacer_div.style.display = 'block';
 });

 // Add a keydown event listener to handle arrow navigation and selection
 input.addEventListener('keydown', async function (e) {
   const items = autocompleteList.getElementsByClassName('mzta_autocomplete-item');
   if ((autocompleteList.style.display === 'none' || items.length === 0)
         && (e.key !== 'Enter')
         && !['1','2','3','4','5','6','7','8','9','0'].includes(e.key)) 
   {
       return; // Do nothing if the autocomplete list is not visible
   }

   // Handle number key presses (1-9,0) to select the corresponding item directly
   if (['1','2','3','4','5','6','7','8','9','0'].includes(e.key)) {
     // Map '1' to index 0, '2' to 1, ..., '9' to 8, '0' to 9
     let numIndex = (e.key === '0') ? 9 : parseInt(e.key, 10) - 1;

     if (items[numIndex]) {
         e.preventDefault(); // Prevent any default behavior
         // Dispatch a select_prompt event to simulate a click/select action
         items[numIndex].dispatchEvent(new Event('select_prompt'));
         return; // Exit after handling the number key
     }
   }

   if (e.key === 'ArrowDown') {
       // Navigate down the list
       selectedId = null;
       currentFocus++;
       if (currentFocus >= items.length) currentFocus = 0; // Wrap to the first item
       addActive(items);
       e.preventDefault(); // Prevent cursor from moving to the end
   } else if (e.key === 'ArrowUp') {
       // Navigate up the list
       selectedId = null;
       currentFocus--;
       if (currentFocus < 0) currentFocus = items.length - 1; // Wrap to the last item
       addActive(items);
       e.preventDefault(); // Prevent cursor from moving to the start
   } else if (e.key === 'Enter') {
       if (selectedId) {
           // If an item is already selected, call sendPrompt with the selected ID
           e.preventDefault();
           sendPrompt(selectedId, tabId);
       } else {
           // If no item is selected yet, select the highlighted item
           e.preventDefault();
           if (currentFocus > -1) {
               if (items[currentFocus]) {
                   items[currentFocus].dispatchEvent(new Event('select_prompt'));
               }
           } else if (items.length > 0) {
               items[0].dispatchEvent(new Event('select_prompt'));
           }
       }
   }
 });

 // Function to add the "active" class to the current item
 function addActive(items) {
     removeActive(items); // Remove the "active" class from all items
     if (currentFocus >= items.length) currentFocus = 0;
     if (currentFocus < 0) currentFocus = items.length - 1;
     items[currentFocus].classList.add('mzta_autocomplete-item-active'); // Add "active" class to the current item
     // Ensure the active item is visible within the scrollable list
     items[currentFocus].scrollIntoView({
       behavior: 'auto', // You can change to 'smooth' if you prefer smooth scrolling
       block: 'nearest', // Align the item to the nearest edge of the visible area
     });
 }

 // Function to remove the "active" class from all items
 function removeActive(items) {
     for (let i = 0; i < items.length; i++) {
         items[i].classList.remove('mzta_autocomplete-item-active');
     }
 }

 document.body.insertBefore(banner, document.body.firstChild);
 setTimeout(() => {
   input.dispatchEvent(new InputEvent('input', { bubbles: true }));
   input.focus();
 }, 100);
}


async function sendPrompt(prompt_id, tabId){
 taLog.log("sendPrompt: " + prompt_id);
 browser.runtime.sendMessage({command: "shortcut_do_prompt", tabId: tabId, promptId: prompt_id});
 window.close();
}

// Show/hide the "Stop processing" banner based on the batch status snapshot.
// When a batch (auto add-tags / spamfilter / summarize / translate) is running,
// the button lets the user request a cooperative cancellation of the running jobs.
function setupBatchStopBanner(batchStatus){
 const banner = document.getElementById('mzta_batch_stop');
 if(!banner){
   return;
 }
 if(!batchStatus || !batchStatus.working){
   banner.style.display = 'none';
   return;
 }

 const btn = document.getElementById('mzta_batch_stop_btn');
 const progress = document.getElementById('mzta_batch_progress');

 const renderProgress = (count) => {
   if(progress){
     progress.textContent = browser.i18n.getMessage('batch_progress_x', [String(count || 0)]);
   }
 };

 renderProgress(batchStatus.processed);
 banner.style.display = 'block';

 // Poll the background for progress while the popup stays open.
 let pollId = setInterval(async () => {
   try {
     const status = await browser.runtime.sendMessage({command: "batch_status"});
     if(!status || !status.working){
       clearInterval(pollId);
       banner.style.display = 'none';
       return;
     }
     renderProgress(status.processed);
   } catch(e) {
     clearInterval(pollId);
   }
 }, 1000);
 window.addEventListener('unload', () => clearInterval(pollId), { once: true });

 if(btn){
   btn.addEventListener('click', async () => {
     btn.disabled = true;
     btn.textContent = browser.i18n.getMessage('batch_stopping');
     clearInterval(pollId);
     await browser.runtime.sendMessage({command: "cancel_batch"});
     // Cancellation is cooperative; the popup can close immediately.
     window.close();
   });
 }
}

function filterPromptsForTab(prompts_data, filtering){
 // Filter by show_in: only show prompts visible in the popup
 let filtered = (prompts_data || []).filter(prompt => {
   const showIn = prompt.show_in || "popup";
   return showIn === "popup" || showIn === "both";
 });

 // If filtering is 0, return without type filter (should not happen)
 if (filtering === 0) {
   return filtered;
 }

 // Define the types to include based on the value of filtering
 let allowedTypes;
 if (filtering === 1) {
     allowedTypes = ["0", "1"];
 } else if (filtering === 2) {
     allowedTypes = ["0", "2"];
 } else {
     return filtered;
 }

 // Filter the array based on the allowed types
 return filtered.filter(prompt => allowedTypes.includes(prompt.type));
}

