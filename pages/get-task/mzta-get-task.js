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

import {
  prefs_default,
  integration_options_config
} from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import {
  getSpecialPrompts,
  setSpecialPrompts
} from "../../js/mzta-prompts.js";
import {
  getPlaceholders,
  mapPlaceholderToSuggestion, placeholdersUtils } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import { attachEditorHighlight, makeTokenStateResolver } from "../../js/mzta-editor-highlight.js";
import {
  isAPIKeyValue,
  setTomSelectBorder,
  isApiUsableConnection
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI,
  isClosedCatalogueSelect
} from "../_lib/connection-ui.js";
import { initTimezoneSelect } from "../_lib/mzta-timezones.js";

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-get-task-page",true);

document.addEventListener('DOMContentLoaded', async () => {

    let specialPrompts = await getSpecialPrompts();
    let get_task_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_get_task');

    if (get_task_prompt && get_task_prompt.api_type && get_task_prompt.api_type !== '') {
        let update_prefs = {};
        update_prefs['get_task_connection_type'] = get_task_prompt.api_type;
        
        let integration = get_task_prompt.api_type.replace('_api', '');
        if (integration_options_config && integration_options_config[integration]) {
             for (const key of Object.keys(integration_options_config[integration])) {
                 const propName = `${integration}_${key}`;
                 if (get_task_prompt[propName] !== undefined) {
                     update_prefs[`get_task_${propName}`] = get_task_prompt[propName];
                 }
             }
        }
        await browser.storage.sync.set(update_prefs);
    }

    // Must run before restoreOptions(), which is called by initializeSpecificIntegrationUI()
    initTimezoneSelect(document.getElementById('calendar_timezone'));

    await initializeSpecificIntegrationUI({
      prefix: 'get_task',
      promptId: 'prompt_get_task',
      taLog: taLog,
      restoreOptionsCallback: restoreOptions
    });

    i18n.updateDocument();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

    let get_task_textarea = document.getElementById('get_task_prompt_text');
    let get_task_save_btn = document.getElementById('btn_save_prompt');
    let get_task_reset_btn = document.getElementById('btn_reset_prompt');
    let get_task_use_specific_integration = document.getElementById('get_task_use_specific_integration');

    get_task_textarea.addEventListener('input', (event) => {
        get_task_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_get_task_full_text'));
        get_task_save_btn.disabled = (event.target.value === get_task_prompt.text);
        if(get_task_save_btn.disabled){
            document.getElementById('get_task_prompt_unsaved').classList.add('hidden');
        } else {
            document.getElementById('get_task_prompt_unsaved').classList.remove('hidden');
        }
    });

    get_task_use_specific_integration.addEventListener('change', (event) => {
        if (!event.target.checked) {
          browser.storage.sync.set({ get_task_connection_type: '' });
        }
    });

    // Colour the connection panel to match the selected provider, and hide the
    // whole panel when "use specific integration" is off (no empty bordered box).
    let get_task_conntype_el = document.getElementById('get_task_connection_type');
    if (get_task_conntype_el) {
        get_task_conntype_el.addEventListener('change', updateConnPanelTint);
    }
    get_task_use_specific_integration.addEventListener('change', updateConnPanelTint);
    updateConnPanelTint();

    get_task_reset_btn.addEventListener('click', () => {
        get_task_textarea.value = browser.i18n.getMessage('prompt_get_task_full_text');
        get_task_reset_btn.disabled = true;
        let event = new Event('input', { bubbles: true, cancelable: true });
        get_task_textarea.dispatchEvent(event);
    });

    get_task_save_btn.addEventListener('click', () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_get_task').text = get_task_textarea.value;
        setSpecialPrompts(specialPrompts);
        get_task_save_btn.disabled = true;
        document.getElementById('get_task_prompt_unsaved').classList.add('hidden');
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    if(get_task_prompt.text === 'prompt_get_task_full_text'){
        get_task_prompt.text = browser.i18n.getMessage(get_task_prompt.text);
    }
    get_task_textarea.value = get_task_prompt.text;
    get_task_reset_btn.disabled = (get_task_textarea.value === browser.i18n.getMessage('prompt_get_task_full_text'));

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.filter(p => !(p.id === 'additional_text')).map(mapPlaceholderToSuggestion);
    const get_task_textarea_hl = attachEditorHighlight(get_task_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (get_task_textarea_hl) get_task_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(get_task_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

});



// Methods to manage options, derived from: /options/mzta-options.js

const CONN_TYPES = ["chatgpt_web", "chatgpt_api", "ollama_api", "openai_comp_api", "google_gemini_api", "anthropic_api"];

// Tint the connection panel to match the selected connection type, set the
// provider pill name, and hide the whole panel when "use specific integration"
// is off. Scoped to the get_task prefix.
function updateConnPanelTint() {
  let conntype_select = document.getElementById("get_task_connection_type");
  let panel = document.getElementById("mzta_conn_panel");
  let use_specific = document.getElementById("get_task_use_specific_integration");
  if (!panel) return;

  panel.style.display = (use_specific && use_specific.checked) ? "" : "none";

  if (!conntype_select) return;
  let conntype = conntype_select.value;
  for (let t of CONN_TYPES) {
    panel.classList.toggle("tint_" + t, conntype === t);
  }
  let pillName = document.getElementById("mzta_conn_pill_name");
  if (pillName) {
    const option = conntype_select.querySelector(`option[value="${conntype}"]`);
    pillName.textContent = option ? option.textContent : conntype;
  }
}

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
      if(!element.id) return;
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
        case 'textarea':
          break;
        default:
        if (element.tagName === 'SELECT') {
            let default_select_value = '';
            const restoreValue = result[element.id] || default_select_value;
            // Check if option exists
            let optionExists = Array.from(element.options).some(opt => opt.value === restoreValue);
            // Never synthesize an option for a connection select: its catalogue is closed.
            let canSynthesize = !isClosedCatalogueSelect(element.id);
            if (element.tomselect) {
              if (!optionExists && restoreValue !== '' && canSynthesize) {
                element.tomselect.addOption({ value: restoreValue, text: restoreValue });
              }
              element.tomselect.setValue(restoreValue, true);
              setTomSelectBorder(element.tomselect);
            } else {
              if (!optionExists && restoreValue !== '' && canSynthesize) {
                let newOption = new Option(restoreValue, restoreValue);
                element.add(newOption);
              }
              element.value = restoreValue;
              if (element.value === '') {
                element.selectedIndex = -1;
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
  let get_task_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_get_task');

  if (get_task_prompt) {
      if (get_task_prompt.api_type && get_task_prompt.api_type !== '') {
          getting['get_task_connection_type'] = get_task_prompt.api_type;
      } else {
          // Inherit the global connection only when this select can actually offer it:
          // chatgpt_web has no <option> here (it has no API), so inheriting it would show
          // a value the control cannot represent. Leave it blank instead.
          getting['get_task_connection_type'] = isApiUsableConnection(getting['connection_type'])
              ? getting['connection_type']
              : '';
      }
      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              const propName = `${integration}_${key}`;
              if (get_task_prompt[propName] !== undefined && get_task_prompt[propName] !== '') {
                  getting[`get_task_${propName}`] = get_task_prompt[propName];
              } else {
                  getting[`get_task_${propName}`] = getting[propName];
              }
          }
      }
  }

  setCurrentChoice(getting);
}