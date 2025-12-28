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
import {
  getSpecialPrompts,
  setSpecialPrompts,
  loadPrompt,
  savePrompt,
  clearPromptAPI
} from "../../js/mzta-prompts.js";
import {
  getPlaceholders,
  mapPlaceholderToSuggestion
 } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
  addTags_getExclusionList,
  addTags_setExclusionList
} from "../../js/mzta-addatags-exclusion-list.js";
import {
  getAccountsList,
  normalizeStringList,
  isAPIKeyValue
} from "../../js/mzta-utils.js";
import {
  injectConnectionUI,
  updateWarnings,
  changeConnTypeRowColor
} from "../_lib/connection-ui.js";

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-addtags-page",true);
let conntype_select_id = 'add_tags_connection_type';
let model_prefix = 'add_tags_';

document.addEventListener('DOMContentLoaded', async () => {
    try {
      await injectConnectionUI({
        afterTrId: 'connection_ui_anchor',
        tr_class: 'specific_integration_sub',
        selectId: conntype_select_id,
        modelId_prefix: model_prefix,
        no_chatgpt_web: true,
        taLog: taLog
      });
    } catch (e) {
      console.error('Failed to inject connection UI (add-tags)', e);
    }
    i18n.updateDocument();
    await restoreOptions();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

    document.querySelectorAll(".option-input-specific").forEach(element => {
        element.addEventListener("change", updatePromptAPIInfo);
      });

    let conntype_el = document.getElementById(conntype_select_id);
    let conntype_end_el = document.getElementById('connection_ui_end');

    conntype_el.addEventListener('change', updatePromptAPIInfo);

    let add_tags_use_specific_integration_el = document.getElementById('add_tags_use_specific_integration');
    let prefs_add_tags = await browser.storage.sync.get({ add_tags_enabled_accounts: [], connection_type: 'chatgpt_web' });
    if(prefs_add_tags.connection_type == 'chatgpt_web'){
       add_tags_use_specific_integration_el.checked = true;
       add_tags_use_specific_integration_el.dispatchEvent(new Event('change'));
       add_tags_use_specific_integration_el.disabled = true;
    }

    let conntype_row = document.getElementById(conntype_select_id + '_tr');
    add_tags_use_specific_integration_el.addEventListener('change', (event) => {
      // console.log(">>>>>>>>>>>>> conntype_el.value: " + conntype_el.value);
      document.querySelectorAll(".specific_integration_sub").forEach(tr => {
        tr.style.display = event.target.checked && tr.classList.contains('conntype_' + conntype_el.value) ? 'table-row' : 'none';
      });
      conntype_el.style.display = event.target.checked ? 'table-row' : 'none';
      conntype_end_el.style.display = event.target.checked ? 'table-row' : 'none';
      changeConnTypeRowColor(conntype_row, conntype_el);
      if(!event.target.checked){
        clearPromptAPI('prompt_add_tags');
      }else{
        updatePromptAPIInfo();
      }
    });

    // console.log(">>>>>>>>>>>>> conntype_el.value: " + conntype_el.value);
    document.querySelectorAll(".specific_integration_sub").forEach(tr => {
        tr.style.display = add_tags_use_specific_integration_el.checked && tr.classList.contains('conntype_' + conntype_el.value) ? 'table-row' : 'none';
      });
    document.getElementById(conntype_select_id + '_tr').style.display = add_tags_use_specific_integration_el.checked ? 'table-row' : 'none';
    conntype_end_el.style.display = add_tags_use_specific_integration_el.checked ? 'table-row' : 'none';
    changeConnTypeRowColor(conntype_row, conntype_el);

    let addtags_textarea = document.getElementById('addtags_prompt_text');
    let addtags_save_btn = document.getElementById('btn_save_prompt');
    let addtags_reset_btn = document.getElementById('btn_reset_prompt');

    let specialPrompts = await getSpecialPrompts();
    let addtags_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_add_tags');

    addtags_textarea.addEventListener('input', (event) => {
        addtags_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_add_tags_full_text'));
        addtags_save_btn.disabled = (event.target.value === addtags_prompt.text);
        if(addtags_save_btn.disabled){
            document.getElementById('addtags_prompt_unsaved').classList.add('hidden');
        } else {
            document.getElementById('addtags_prompt_unsaved').classList.remove('hidden');
        }
    });

    let add_tags_auto_el = document.getElementById('add_tags_auto');
    let add_tags_auto_only_inbox_tr = document.getElementById('add_tags_auto_only_inbox_tr');
    let account_selector_container = document.getElementById('account_selector_container');
    let add_tags_auto_infoline = document.getElementById('add_tags_auto_infoline');
    let add_tags_auto_uselist_tr = document.getElementById('add_tags_auto_uselist_tr');
    add_tags_auto_el.addEventListener('click', (event) => {
      add_tags_auto_only_inbox_tr.style.display = event.target.checked ? 'table-row' : 'none';
      account_selector_container.style.display = event.target.checked ? 'block' : 'none';
      add_tags_auto_infoline.style.display = event.target.checked ? 'inline' : 'none';
      add_tags_auto_uselist_tr.style.display = event.target.checked ? 'table-row' : 'none';

    });
    add_tags_auto_only_inbox_tr.style.display = add_tags_auto_el.checked ? 'table-row' : 'none';
    account_selector_container.style.display = add_tags_auto_el.checked ? 'block' : 'none';
    add_tags_auto_infoline.style.display = add_tags_auto_el.checked ? 'inline' : 'none';
    add_tags_auto_uselist_tr.style.display = add_tags_auto_el.checked ? 'table-row' : 'none';

    let add_tags_auto_uselist = document.getElementById('add_tags_auto_uselist');
    let add_tags_auto_uselist_list = document.getElementById('add_tags_auto_uselist_list');
    add_tags_auto_uselist.addEventListener('click', (event) => {
      add_tags_auto_uselist_list.disabled = !event.target.checked;
    });
    add_tags_auto_uselist_list.disabled = !add_tags_auto_uselist.checked;

    addtags_reset_btn.addEventListener('click', () => {
        addtags_textarea.value = browser.i18n.getMessage('prompt_add_tags_full_text');
        addtags_reset_btn.disabled = true;
        let event = new Event('input', { bubbles: true, cancelable: true });
        addtags_textarea.dispatchEvent(event);
    });

    addtags_save_btn.addEventListener('click', () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_add_tags').text = addtags_textarea.value;
        setSpecialPrompts(specialPrompts);
        addtags_save_btn.disabled = true;
        document.getElementById('addtags_prompt_unsaved').classList.add('hidden');
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    if(addtags_prompt.text === 'prompt_add_tags_full_text'){
        addtags_prompt.text = browser.i18n.getMessage(addtags_prompt.text);
    }
    addtags_textarea.value = addtags_prompt.text;
    addtags_reset_btn.disabled = (addtags_textarea.value === browser.i18n.getMessage('prompt_add_tags_full_text'));

    document.getElementById('add_tags_maxnum').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_force_lang').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_auto_uselist').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_auto_uselist_list').addEventListener('change', updateAdditionalPromptStatements);

    updateAdditionalPromptStatements();

    autocompleteSuggestions = (await getPlaceholders(true)).filter(p => !(p.id === 'additional_text')).map(mapPlaceholderToSuggestion);
    textareaAutocomplete(addtags_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

    let excl_list_textarea = document.getElementById('addtags_excl_list');
    let excl_list_save_btn = document.getElementById('btn_save_excl_list');

    let excl_list_value = await addTags_getExclusionList();
    let excl_list_string = excl_list_value.join('\n');

    excl_list_textarea.value = excl_list_string;

    excl_list_textarea.addEventListener('input', (event) => {
        excl_list_save_btn.disabled = (event.target.value === excl_list_string);
        if(excl_list_save_btn.disabled){
            document.getElementById('excl_list_unsaved').classList.add('hidden');
        } else {
            document.getElementById('excl_list_unsaved').classList.remove('hidden');
        }
    });

    excl_list_save_btn.addEventListener('click', () => {
        let excl_array_new = normalizeStringList(excl_list_textarea.value, 2);
        addTags_setExclusionList(excl_array_new);
        excl_list_save_btn.disabled = true;
        excl_list_textarea.value = excl_array_new.join('\n');
        document.getElementById('excl_list_unsaved').classList.add('hidden');
    });

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

    let add_tags_enabled_accounts = prefs_add_tags.add_tags_enabled_accounts;
    taLog.log("add_tags_enabled_accounts = " + JSON.stringify(add_tags_enabled_accounts) + ".");
    document.querySelectorAll('.accountCheckbox').forEach(checkbox => {
      if (add_tags_enabled_accounts.length === 0 || add_tags_enabled_accounts.includes(checkbox.value)) {
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
        browser.storage.sync.set({ add_tags_enabled_accounts: [] });
        taLog.log("All accounts selected, saving add_tags_enabled_accounts = [].");
      } else {
        browser.storage.sync.set({ add_tags_enabled_accounts: selectedAccounts });
        taLog.log("Saving add_tags_enabled_accounts = " + JSON.stringify(selectedAccounts) + ".");
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

    updateWarnings(model_prefix);
});


async function updateAdditionalPromptStatements(){
    let prefs_ = await browser.storage.sync.get({
      add_tags_maxnum: prefs_default.add_tags_maxnum,
      add_tags_force_lang: prefs_default.add_tags_force_lang,
      default_chatgpt_lang: prefs_default.default_chatgpt_lang,
      add_tags_auto_uselist: prefs_default.add_tags_auto_uselist,
      add_tags_auto_uselist_list: prefs_default.add_tags_auto_uselist_list,
    });
    let el_tag_limit = document.getElementById('addtags_info_additional_statements');
    if((prefs_.add_tags_maxnum > 0)||(prefs_.add_tags_force_lang && prefs_.default_chatgpt_lang !== '')||(prefs_.add_tags_auto_uselist && prefs_.add_tags_auto_uselist_list.trim() !== '')){
        el_tag_limit.textContent = browser.i18n.getMessage("addtags_info_additional_statements") + " \""
        if(prefs_.add_tags_maxnum > 0){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_maxnum") + " " + prefs_.add_tags_maxnum +". "
        }
        if(prefs_.add_tags_force_lang && prefs_.default_chatgpt_lang !== ''){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_force_lang") + " " + prefs_.default_chatgpt_lang + ". "
        }
        if(prefs_.add_tags_auto_uselist && prefs_.add_tags_auto_uselist_list.trim() !== ''){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_use_list") + ": " + prefs_.add_tags_auto_uselist_list + ".";
        }
        el_tag_limit.textContent = el_tag_limit.textContent.trim();
        el_tag_limit.textContent += "\".";
        el_tag_limit.style.display = 'block';
    }else{
        el_tag_limit.style.display = 'none';
    }
}

async function updatePromptAPIInfo(){
  let conntype = document.getElementById(conntype_select_id).value;
  let model_value = conntype.substring(0, conntype.length - 4) + '_model';
  let temperature_value = conntype.substring(0, conntype.length - 4) + '_temperature';
  // console.log(">>>>>>>>>>> updatePromptAPIInfo: conntype: " + conntype + " - model: " + model + " - model_value: " + model_value);
  let add_tags_prompt = await loadPrompt('prompt_add_tags');
  // console.log(">>>>>>>>>>> updatePromptAPIInfo: BEFORE add_tags_prompt: " + JSON.stringify(add_tags_prompt));
  add_tags_prompt.api = conntype;
  add_tags_prompt.model = document.getElementById(model_prefix + model_value).value;
  add_tags_prompt.temperature = document.getElementById(model_prefix + temperature_value).value;
  // console.log(">>>>>>>>>>> updatePromptAPIInfo: AFTER add_tags_prompt: " + JSON.stringify(add_tags_prompt));
  await savePrompt(add_tags_prompt);
}


// Methods to manage options, derived from: /options/mzta-options.js

function saveOptions(e) {
  e.preventDefault();
  let options = {};
  let element = e.target;
  // console.log(">>>>>>>>>> Saving option: " + element.id + " = " + element.value);
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
        // console.log(">>>>>>>>>> Saving option [select-one]: " + element.id + " = " + element.value);
        options[element.id] = element.value;
        break;
      case 'textarea':
        if(element.id === 'add_tags_auto_uselist_list') {
          element.value = normalizeStringList(element.value, 1);
        }
        options[element.id] = normalizeStringList(element.value);
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
        case 'textarea':
        case 'password':
          let default_text_value = '';
          if(element.id == 'default_chatgpt_lang') default_text_value = prefs_default.default_chatgpt_lang;
          if(element.id === 'add_tags_auto_uselist_list') {
            result[element.id] = normalizeStringList(result[element.id], 1);
          }
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
            let default_select_value = '';
            const restoreValue = result[element.id] || default_select_value;
            // Check if option exists
            let optionExists = Array.from(element.options).some(opt => opt.value === restoreValue);
            // If it doesn't exist and restoreValue is not empty, create it
            if (!optionExists && restoreValue !== '') {
              let newOption = new Option(restoreValue, restoreValue);
              element.add(newOption);
            }
            // Set value
            element.value = restoreValue;
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
