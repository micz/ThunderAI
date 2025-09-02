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

import { prefs_default } from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import { getSpecialPrompts, setSpecialPrompts } from "../../js/mzta-prompts.js";
import { getPlaceholders } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import { taSpamReport } from '../../js/mzta-spamreport.js';
import { getAccountsList, isAPIKeyValue } from "../../js/mzta-utils.js";

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-spamfilter-page",true);
taSpamReport.logger = taLog;

document.addEventListener('DOMContentLoaded', async () => {

    i18n.updateDocument();
    await restoreOptions();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

    document.getElementById("spamfilter_threshold").addEventListener("input", check_spamfilter_threshold);
    check_spamfilter_threshold({target: document.getElementById("spamfilter_threshold")});

    let spamfilter_textarea = document.getElementById('spamfilter_prompt_text');
    let spamfilter_save_btn = document.getElementById('btn_save_prompt');
    let spamfilter_reset_btn = document.getElementById('btn_reset_prompt');

    let specialPrompts = await getSpecialPrompts();
    let spamfilter_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter');

    spamfilter_textarea.addEventListener('input', (event) => {
        spamfilter_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_spamfilter_full_text'));
        spamfilter_save_btn.disabled = (event.target.value === spamfilter_prompt.text);
        if(spamfilter_save_btn.disabled){
            document.getElementById('spamfilter_prompt_unsaved').classList.add('hidden');
        } else {
            document.getElementById('spamfilter_prompt_unsaved').classList.remove('hidden');
        }
    });

    spamfilter_reset_btn.addEventListener('click', () => {
        spamfilter_textarea.value = browser.i18n.getMessage('prompt_spamfilter_full_text');
        spamfilter_reset_btn.disabled = true;
        let event = new Event('input', { bubbles: true, cancelable: true });
        spamfilter_textarea.dispatchEvent(event);
    });

    spamfilter_save_btn.addEventListener('click', () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter').text = spamfilter_textarea.value;
        setSpecialPrompts(specialPrompts);
        spamfilter_save_btn.disabled = true;
        document.getElementById('spamfilter_prompt_unsaved').classList.add('hidden');
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    if(spamfilter_prompt.text === 'prompt_spamfilter_full_text'){
        spamfilter_prompt.text = browser.i18n.getMessage(spamfilter_prompt.text);
    }
    spamfilter_textarea.value = spamfilter_prompt.text;
    spamfilter_reset_btn.disabled = (spamfilter_textarea.value === browser.i18n.getMessage('prompt_spamfilter_full_text'));

    autocompleteSuggestions = (await getPlaceholders(true)).filter(p => !(p.id === 'additional_text')).map(p => ({command: '{%'+p.id+'%}', type: p.type}));
    textareaAutocomplete(spamfilter_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

     //Accounts manager
     let accounts = await getAccountsList();
     const accountsContainer = document.getElementById('account_selector_checkboxes');
     accounts.forEach(account => {
         const accountLabel = document.createElement('label');
         const accountCheckbox = document.createElement('input');
         accountCheckbox.type = 'checkbox';
         accountCheckbox.classList.add('accountCheckbox');
         accountCheckbox.value = account.id;
         accountLabel.appendChild(accountCheckbox);
         accountLabel.appendChild(document.createTextNode(account.name));
         accountsContainer.appendChild(accountLabel);
         accountsContainer.appendChild(document.createElement('br'));
     });
 
     let prefs_spamfilter = await browser.storage.sync.get({ spamfilter_enabled_accounts: [] });
     let spamfilter_enabled_accounts = prefs_spamfilter.spamfilter_enabled_accounts;
     taLog.log("spamfilter_enabled_accounts: " + JSON.stringify(spamfilter_enabled_accounts));
     document.querySelectorAll('.accountCheckbox').forEach(checkbox => {
       if (spamfilter_enabled_accounts.length === 0 || spamfilter_enabled_accounts.includes(checkbox.value)) {
         checkbox.checked = true;
       } else {
         checkbox.checked = false;
       }
     });
 
     document.querySelectorAll('.accountCheckbox').forEach(checkbox => {
       checkbox.addEventListener('change', () => {
       let selectedAccounts = Array.from(document.querySelectorAll('.accountCheckbox:checked')).map(checkbox => checkbox.value);
       if (selectedAccounts.length === 0) {
          checkbox.checked = true; // Prevent deselecting the last selected checkbox
          taLog.log("At least one account must be selected.");
          return;
       }
       if (selectedAccounts.length === document.querySelectorAll('.accountCheckbox').length) {
         browser.storage.sync.set({ spamfilter_enabled_accounts: [] });
         taSpamReport.logger.log("All accounts selected, saving spamfilter_enabled_accounts = [].");
       } else {
         browser.storage.sync.set({ spamfilter_enabled_accounts: selectedAccounts });
         taSpamReport.logger.log("Saving spamfilter_enabled_accounts = " + JSON.stringify(selectedAccounts) + ".");
       }
       });
     });
 
     document.getElementById('accounts_select_all').addEventListener('click', () => {
       let checkboxes = document.querySelectorAll('.accountCheckbox');
       checkboxes.forEach(checkbox => checkbox.checked = true);
     });
     
     document.getElementById('accounts_deselect_all').addEventListener('click', () => {
       let checkboxes = document.querySelectorAll('.accountCheckbox');
       checkboxes.forEach(checkbox => checkbox.checked = false);
     });

    loadSpamReport();
});

function check_spamfilter_threshold(event) {
  let spamfilter_threshold_too_low = document.getElementById("spamfilter_threshold_too_low");
  if(event.target.value < 50){
    spamfilter_threshold_too_low.style.display = "inline";
    if(event.target.value == 0){
      spamfilter_threshold_too_low.textContent = browser.i18n.getMessage('spamfilter_threshold_zero');
      spamfilter_threshold_too_low.style.fontSize = "1.5em";
    }else{
      spamfilter_threshold_too_low.textContent = browser.i18n.getMessage('spamfilter_threshold_too_low');
      spamfilter_threshold_too_low.style.fontSize = "1.1em";
    }
  }else{
    spamfilter_threshold_too_low.style.display = "none";
  }
}

async function loadSpamReport(){
    let report_data = await taSpamReport.getAllReportData();
    //console.log(">>>>>>>>>>>> loadSpamReport: " + JSON.stringify(report_data));
    //document.getElementById("report_data").textContent = JSON.stringify(report_data, null, 2);
    if(report_data == undefined){
      document.getElementById("report_data").innerText = browser.i18n.getMessage("spamfilter_no_reports");
    }else{
      populateTable(report_data);
    }
}

 // Function to populate the table
 function populateTable(data) {
  const tableBody = document.getElementById("report_data_body");
  tableBody.innerHTML = ""; // Clear table before inserting new data

  Object.keys(data).forEach(email => {
      const report = data[email];

      // Create a new row
      const row = document.createElement("tr");

      // Create and append each cell as a DOM element
      const tdHeaderMessageId = document.createElement("td");
      tdHeaderMessageId.textContent = report.headerMessageId;
      row.appendChild(tdHeaderMessageId);

      const tdMessageDate = document.createElement("td");
      tdMessageDate.textContent = new Date(report.message_date).toLocaleString();
      row.appendChild(tdMessageDate);

      const tdFrom = document.createElement("td");
      tdFrom.textContent = Array.isArray(report.from) ? report.from.join(", ") : report.from;
      row.appendChild(tdFrom);

      const tdSubject = document.createElement("td");
      tdSubject.textContent = Array.isArray(report.subject) ? report.subject.join(", ") : report.subject;
      row.appendChild(tdSubject);

      const tdSpamValue = document.createElement("td");
      tdSpamValue.textContent = report.spamValue;
      row.appendChild(tdSpamValue);

      const tdMoved = document.createElement("td");
      tdMoved.textContent = (report.moved ? browser.i18n.getMessage("spamfilter_moved") : browser.i18n.getMessage("spamfilter_not_moved")) + ` (${report.SpamThreshold})`;
      row.appendChild(tdMoved);

      const tdExplanation = document.createElement("td");
      tdExplanation.textContent = report.explanation;
      row.appendChild(tdExplanation);

      const tdReportDate = document.createElement("td");
      tdReportDate.textContent = new Date(report.report_date).toLocaleString();
      row.appendChild(tdReportDate);

      // Append the row to the table
      tableBody.appendChild(row);
  });
}


// Methods to manage options, derived from: /options/mzta-options.js
function saveOptions(e) {
  e.preventDefault();
  let options = {};
  let element = e.target;

    switch (element.type) {
      case 'checkbox':
        options[element.id] = element.checked;
        break;
      case 'number':
        options[element.id] = element.valueAsNumber;
        break;
        case 'text':
        case 'password':
        options[element.id] = element.value.trim();
        break;
      case 'select-one':
        options[element.id] = element.value;
        break;
      default:
        console.error("[ThunderAI] Unhandled input type:", element.type);
    }

  browser.storage.sync.set(options);
}

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      taLog.log("Options restoring " + element.id + " = " + (isAPIKeyValue(element.id) ? "****************" : result[element.id]));
      switch (element.type) {
        case 'checkbox':
          element.checked = result[element.id] || false;
          break;
        case 'number':
          let default_number_value = 0;
          if(element.id == 'chatgpt_win_height') default_number_value = prefs_default.chatgpt_win_height;
          if(element.id == 'chatgpt_win_width') default_number_value = prefs_default.chatgpt_win_width;
          element.value = result[element.id] ?? default_number_value;
          break;
        case 'text':
        case 'password':
          let default_text_value = '';
          if(element.id == 'default_chatgpt_lang') default_text_value = prefs_default.default_chatgpt_lang;
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
          let default_select_value = '';
          if(element.id == 'reply_type') default_select_value = 'reply_all';
          if(element.id == 'connection_type') default_select_value = 'chatgpt_web';
          element.value = result[element.id] || default_select_value;
          if (element.value === '') {
            element.selectedIndex = -1;
          }
        }else{
          console.error("[ThunderAI] Unhandled input type:", element.type);
        }
      }
    });
  }

  let getting = await browser.storage.sync.get(prefs_default);
  setCurrentChoice(getting);
}