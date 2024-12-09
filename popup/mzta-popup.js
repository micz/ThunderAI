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

import { taLogger } from "../js/mzta-logger.js";

let menuSendImmediately = false;
let taLog = console;
let connection_type = 'chatgpt_web';
let add_tags = false;

document.addEventListener('DOMContentLoaded', async () => {
    let prefs = await browser.storage.sync.get({do_debug: false, dynamic_menu_force_enter: false, add_tags: false, connection_type: 'chatgpt_web'});
    taLog = new taLogger("mzta-popup",prefs.do_debug);
    i18n.updateDocument();
    let reponse = await browser.runtime.sendMessage({command: "popup_menu_ready"});
    taLog.log("Preparing data to load the popup menu: " + JSON.stringify(reponse));
    let tabId = reponse.lastShortcutTabId;
    let tabType = reponse.lastShortcutTabType;
    let filtering = reponse.lastShortcutFiltering;
    let _prompts_data = reponse.lastShortcutPromptsData;
    taLog.log("_prompts_data: " + JSON.stringify(_prompts_data));
    let active_prompts = filterPromptsForTab(_prompts_data, filtering);
    taLog.log("active_prompts: " + JSON.stringify(active_prompts));
    menuSendImmediately = prefs.dynamic_menu_force_enter;
    connection_type = prefs.connection_type;
    add_tags = prefs.add_tags;
    searchPrompt(active_prompts, tabId, tabType);
    i18n.updateDocument();
}, { once: true });

async function searchPrompt(allPrompts, tabId, tabType){
 taLog.log("tabType: " + tabType);

 let prefs_order = await browser.storage.sync.get({dynamic_menu_order_alphabet: true});

 if(prefs_order.dynamic_menu_order_alphabet){
  allPrompts.sort((a, b) => a.label.localeCompare(b.label));
 }

 // console.log(">>>>>>>>> allPrompts: " + JSON.stringify(allPrompts));

 let input = document.getElementById('mzta_search_input');
 let autocompleteList = document.getElementById('mzta_autocomplete-items');
 let autocompleteListLoading = document.getElementById('mzta_autocomplete-items-loading');
 let _spacer_div = document.getElementById('_spacer_div');
 let banner = document.getElementById('mzta_search_banner');

 // Initialize variables to track focus and selection
 let currentFocus = -1; // Tracks the currently highlighted item
 let selectedId = null; // Tracks the ID of the selected item

 // Function to filter and display autocomplete suggestions
 input.addEventListener('input', function() {
   const query = this.value.trim().toLowerCase();
  // console.log(">>>>>>>>>>>> query: " + query);
   autocompleteList.innerHTML = ''; // Clear previous suggestions
   currentFocus = -1; // Reset the highlighted index
   selectedId = null; // Reset the selected ID since input has changed

   // Uncomment the following lines if you want to hide suggestions when input is empty
   /*
   if (query === '') {
       autocompleteList.style.display = 'none';
       return;
   }
   */

   // Filter data based on the query
   const filteredData = allPrompts.filter(item => 
     item.label.toLowerCase().includes(query)
   );
   taLog.log("filteredData: " + JSON.stringify(filteredData));

   if (filteredData.length === 0) {
       autocompleteList.style.display = 'none';
       _spacer_div.style.display = 'none';
       return;
   }

   //TODO if add_tags is true and connection_type is not 'chatgpt_web' reserve 0 position for prompt_add_tags

   // Prepend numbers to the first 10 items
   Array.from(filteredData).slice(0, 10).forEach((item, index) => {
     const number = (index < 9) ? (index + 1).toString() : '0';
     // Check if the number is already prepended to avoid duplication
     if (!item.numberPrepended) {
         item.label = `${number}. ${item.label}`;
         item.numberPrepended = 'true'; // Mark as prepended
     }
   });

  //  console.log(">>>>>>>>>>>>> filteredData: " + JSON.stringify(filteredData));

   // Create a div for each filtered result
   filteredData.forEach(item => {
       const itemDiv = document.createElement('div');
       itemDiv.classList.add('mzta_autocomplete-item');
       itemDiv.textContent = item.label;
       itemDiv.setAttribute('data-id', item.id);

       // Add a mousedown event to select the item
       itemDiv.addEventListener('mousedown', function(e) { // Use mousedown instead of click
           e.preventDefault(); // Prevents the input from losing focus
           input.value = item.label;
           selectedId = item.id; // Store the selected item's ID
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
        // console.log('>>>>>>>>>>>>> select_prompt selectedId:', selectedId);
        autocompleteList.style.display = 'none';
        _spacer_div.style.display = 'none';
        if(menuSendImmediately){
            sendPrompt(selectedId, tabId);
        }
    });

       autocompleteList.appendChild(itemDiv);
   });

   autocompleteListLoading.style.display = 'none';
   autocompleteList.style.display = 'block';
   _spacer_div.style.display = 'block';
 });

 // Add a keydown event listener to handle arrow navigation and selection
 input.addEventListener('keydown', function (e) {
 
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
     const numIndex = (e.key === '0') ? 9 : parseInt(e.key, 10) - 1;
     if (items[numIndex]) {
         e.preventDefault(); // Prevent any default behavior
         // Dispatch a select_prompt event to simulate a click/select action
         items[numIndex].dispatchEvent(new Event('select_prompt'));
         return; // Exit after handling the number key
     }
   }

   if (e.key === 'ArrowDown') {
       // Navigate down the list
       currentFocus++;
       if (currentFocus >= items.length) currentFocus = 0; // Wrap to the first item
       addActive(items);
       e.preventDefault(); // Prevent cursor from moving to the end
   } else if (e.key === 'ArrowUp') {
       // Navigate up the list
       currentFocus--;
       if (currentFocus < 0) currentFocus = items.length - 1; // Wrap to the last item
       addActive(items);
       e.preventDefault(); // Prevent cursor from moving to the start
   } else if (e.key === 'Enter') {
      //  console.log(">>>>>>>>>>>>>> keydown == enter selectedId: " + selectedId);
       if (selectedId) {
         // If an item is already selected, call sendPrompt with the selected ID
         e.preventDefault();
         sendPrompt(selectedId, tabId); // Call your sendPrompt function
         //banner.remove(); // Remove the banner after sending the prompt
     } else {
       // If no item is selected yet, select the highlighted item
       // Select the highlighted item, or the first item if none is highlighted
       e.preventDefault(); // Prevent form submission if inside a form
       if (currentFocus > -1) {
           if (items[currentFocus]) {
               items[currentFocus].dispatchEvent(new Event('select_prompt')); // Trigger the select_prompt event
           }
       } else if (items.length > 0) {
           // If no item is highlighted, select the first item
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


function sendPrompt(prompt_id, tabId){
 taLog.log("sendPrompt: " + prompt_id);
 document.getElementById('mzta_search_input').style.display = 'none';
 document.getElementById('mzta_sending_prompt').style.display = 'block';
 browser.runtime.sendMessage({command: "shortcut_do_prompt", tabId: tabId, promptId: prompt_id});
}

function filterPromptsForTab(prompts_data, filtering){
 // If filtering is 0, return the original array without any filters (btw it should not happen)
 if (filtering === 0) {
   return prompts_data;
 }

 // Define the types to include based on the value of filtering
 let allowedTypes;
 if (filtering === 1) {
     allowedTypes = ["0", "1"];
 } else if (filtering === 2) {
     allowedTypes = ["0", "2"];
 } else {
     // If filtering has an unexpected value, return the original data
     return prompts_data;
 }

 // Filter the array based on the allowed types
 return prompts_data.filter(prompt => allowedTypes.includes(prompt.type));
}