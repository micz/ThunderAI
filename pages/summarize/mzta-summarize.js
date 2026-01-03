/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { prefs_default, integration_options_config } from '../../options/mzta-options-default.js';
import { taLogger } from "../../js/mzta-logger.js";
import {
    getSpecialPrompts,
    setSpecialPrompts
} from "../../js/mzta-prompts.js";
import {
    getPlaceholders,
    mapPlaceholderToSuggestion
} from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
  getAccountsList,
  normalizeStringList,
  isAPIKeyValue
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI
} from "../_lib/connection-ui.js";

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-summarize-page", true);

document.addEventListener("DOMContentLoaded", async () => {
  
    let specialPrompts = await getSpecialPrompts();
    let summarize_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize');
    let summarize_email_template = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_template');

    if (summarize_prompt && summarize_prompt.api_type && summarize_prompt.api_type !== '') {
        let update_prefs = {};
        update_prefs['summarize_connection_type'] = summarize_prompt.api_type;

        let integration = summarize_prompt.api_type.replace('_api', '');
        if (integration_options_config && integration_options_config[integration]) {
            for (const key of Object.keys(integration_options_config[integration])) {
                if (summarize_prompt[key] !== undefined) {
                    update_prefs[`summarize_${integration}_${key}`] = summarize_prompt[key];
                }
            }
        }
        await browser.storage.sync.set(update_prefs);
    }

    await initializeSpecificIntegrationUI({
      prefix: 'summarize',
      promptId: 'prompt_summarize',
      taLog: taLog,
      restoreOptionsCallback: restoreOptions
    });
    
    i18n.updateDocument();
    
    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });
    let prefs_summarize = await browser.storage.sync.get({ summarize_enabled_accounts: [], connection_type: 'chatgpt_web' });

    let summarize_textarea = document.getElementById("summarize_prompt_text");
    let summarize_save_btn = document.getElementById("btn_save_prompt");
    let summarize_reset_btn = document.getElementById("btn_reset_prompt");
    let summarize_textarea_email_template = document.getElementById("summarize_email_template_text");
    let summarize_reset_email_template_btn = document.getElementById("btn_reset_email_template");
    let summarize_save_email_template_btn = document.getElementById("btn_save_email_template");

    
    summarize_textarea.addEventListener("input", (event) => {
        summarize_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_full_text'));
        summarize_save_btn.disabled = (event.target.value === summarize_prompt.text);
    });
    
    summarize_textarea_email_template.addEventListener("input", (event) => {
        summarize_reset_email_template_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_email_template')); 
        summarize_save_email_template_btn.disabled = (event.target.value === summarize_email_template.text);
    });
    
    summarize_reset_email_template_btn.addEventListener("click", () => {
        summarize_textarea_email_template.value = browser.i18n.getMessage("prompt_summarize_email_template");
        summarize_reset_email_template_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        summarize_textarea_email_template.dispatchEvent(event);
    });
    
    summarize_reset_btn.addEventListener("click", () => {
        summarize_textarea.value = browser.i18n.getMessage("prompt_summarize_full_text");
        summarize_reset_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        summarize_textarea.dispatchEvent(event);
    });
    
    summarize_save_email_template_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_summarize_email_template').text = summarize_textarea_email_template.value;
        setSpecialPrompts(specialPrompts);
        summarize_save_email_template_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });
    
    summarize_save_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_summarize').text = summarize_textarea.value;
        setSpecialPrompts(specialPrompts);
        summarize_save_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });
    
    if(summarize_prompt.text === 'prompt_summarize_full_text'){
        summarize_prompt.text = browser.i18n.getMessage(summarize_prompt.text);
    }
    if(summarize_email_template === 'prompt_summarize_email_template'){
        summarize_email_template.text = browser.i18n.getMessage(summarize_email_template.text);
    }
    summarize_textarea_email_template.value = summarize_email_template.text;
    summarize_reset_email_template_btn.disabled = (summarize_email_template.value === browser.i18n.getMessage("prompt_summarize_email_template"));
    summarize_textarea.value = summarize_prompt.text;
    summarize_reset_btn.disabled = (summarize_textarea.value === browser.i18n.getMessage("prompt_summarize_full_text"));

    autocompleteSuggestions = (await getPlaceholders(true))
        .filter((p) => p.id !== "additional_text")
        .map(mapPlaceholderToSuggestion);
    textareaAutocomplete(summarize_textarea, autocompleteSuggestions, 1);
    textareaAutocomplete(summarize_textarea_email_template, autocompleteSuggestions, 1);
    
});

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

  let specialPrompts = await getSpecialPrompts();
  let addtags_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_add_tags');

  if (addtags_prompt) {
      if (addtags_prompt.api_type && addtags_prompt.api_type !== '') {
          getting['add_tags_connection_type'] = addtags_prompt.api_type;
      } else {
          getting['add_tags_connection_type'] = getting['connection_type'];
      }
      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              const propName = `${integration}_${key}`;
              if (addtags_prompt[propName] !== undefined && addtags_prompt[propName] !== '') {
                  getting[`add_tags_${propName}`] = addtags_prompt[propName];
              } else {
                  getting[`add_tags_${propName}`] = getting[propName];
              }
          }
      }
  }

  setCurrentChoice(getting);
}
