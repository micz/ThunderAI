/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
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

import {
  prefs_default,
  integration_options_config
} from '../../options/mzta-options-default.js';
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
  normalizeStringList,
  isAPIKeyValue,
  setTomSelectBorder
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI
} from "../_lib/connection-ui.js";

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-translate-page", true);

document.addEventListener("DOMContentLoaded", async () => {

    let specialPrompts = await getSpecialPrompts();
    let translate_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_translate_this');

    if (translate_prompt && translate_prompt.api_type && translate_prompt.api_type !== '') {
        let update_prefs = {};
        update_prefs['translate_connection_type'] = translate_prompt.api_type;

        let integration = translate_prompt.api_type.replace('_api', '');
        if (integration_options_config && integration_options_config[integration]) {
            for (const key of Object.keys(integration_options_config[integration])) {
                if (translate_prompt[key] !== undefined) {
                    update_prefs[`translate_${integration}_${key}`] = translate_prompt[key];
                }
            }
        }
        await browser.storage.sync.set(update_prefs);
    }

    await initializeSpecificIntegrationUI({
      prefix: 'translate',
      promptId: 'prompt_translate_this',
      taLog: taLog,
      restoreOptionsCallback: restoreOptions
    });

    i18n.updateDocument();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
    });

    let translate_textarea = document.getElementById("translate_prompt_text");
    let translate_save_btn = document.getElementById("btn_save_prompt");
    let translate_reset_btn = document.getElementById("btn_reset_prompt");

    // on changing textarea
    translate_textarea.addEventListener("input", (event) => {
        translate_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_translate_this_full_text'));
        translate_save_btn.disabled = (event.target.value === translate_prompt.text);
    });

    // on clicking reset button
    translate_reset_btn.addEventListener("click", () => {
        translate_textarea.value = browser.i18n.getMessage("prompt_translate_this_full_text");
        translate_reset_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        translate_textarea.dispatchEvent(event);
    });

    // on clicking save button
    translate_save_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_translate_this').text = translate_textarea.value;
        setSpecialPrompts(specialPrompts);
        translate_save_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });

    if(translate_prompt.text === 'prompt_translate_this_full_text'){
        translate_prompt.text = browser.i18n.getMessage(translate_prompt.text);
    }

    translate_textarea.value = translate_prompt.text;
    translate_reset_btn.disabled = (translate_textarea.value === browser.i18n.getMessage("prompt_translate_this_full_text"));

    autocompleteSuggestions = (await getPlaceholders(true))
        .filter((p) => p.id !== "additional_text")
        .map(mapPlaceholderToSuggestion);

    textareaAutocomplete(translate_textarea, autocompleteSuggestions, 1);

});

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
        if (element.id === 'translate_auto') {
          options[element.id] = parseInt(element.value, 10);
        } else {
          options[element.id] = element.value;
        }
        break;
      case 'textarea':
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
      if(!element.id) return;
      taLog.log("Options restoring " + element.id + " = " + (isAPIKeyValue(element.id) ? "****************" : result[element.id]));
      switch (element.type) {
        case 'checkbox':
          element.checked = result[element.id] || false;
          break;
        case 'number':
          element.value = result[element.id] ?? 0;
          break;
        case 'text':
        case 'textarea':
        case 'password':
          let default_text_value = '';
          if(element.id == 'translate_lang') default_text_value = prefs_default.default_chatgpt_lang;
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
            let default_select_value = 0;
            if (element.id === 'translate_auto') {
              default_select_value = prefs_default.translate_auto;
            }
            if (element.id === 'translate_display_mode') {
              default_select_value = prefs_default.translate_display_mode;
            }
            const restoreValue = result[element.id] ?? default_select_value;
            let optionExists = Array.from(element.options).some(opt => opt.value === String(restoreValue));
            if (element.tomselect) {
              if (!optionExists && restoreValue !== '') {
                element.tomselect.addOption({ value: String(restoreValue), text: String(restoreValue) });
              }
              element.tomselect.setValue(String(restoreValue), true);
              setTomSelectBorder(element.tomselect);
            } else {
              if (!optionExists && restoreValue !== '') {
                let newOption = new Option(restoreValue, restoreValue);
                element.add(newOption);
              }
              element.value = restoreValue;
              if (element.value === '') {
                element.selectedIndex = 0;
              }
            }
        }else{
          console.error("[ThunderAI] Unhandled input type:", element.type);
        }
      }
    });
  }

  let getting = await browser.storage.sync.get(prefs_default);

  let specialPrompts = await getSpecialPrompts();
  let translate_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_translate_this');

  if (translate_prompt) {
      if (translate_prompt.api_type && translate_prompt.api_type !== '') {
          getting['translate_connection_type'] = translate_prompt.api_type;
      } else {
          getting['translate_connection_type'] = getting['connection_type'];
      }
      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              const propName = `${integration}_${key}`;
              if (translate_prompt[propName] !== undefined && translate_prompt[propName] !== '') {
                  getting[`translate_${propName}`] = translate_prompt[propName];
              } else {
                  getting[`translate_${propName}`] = getting[propName];
              }
          }
      }
  }

  // If translate_lang is empty, show default_chatgpt_lang as placeholder/default
  if (!getting['translate_lang']) {
      getting['translate_lang'] = '';
  }

  setCurrentChoice(getting);
}
