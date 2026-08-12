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
    mapPlaceholderToSuggestion, placeholdersUtils } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import { attachEditorHighlight, makeTokenStateResolver } from "../../js/mzta-editor-highlight.js";
import {
  normalizeStringList,
  isAPIKeyValue,
  setTomSelectBorder,
  hasAddressListEntries
  isApiUsableConnection
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI,
  isClosedCatalogueSelect
} from "../_lib/connection-ui.js";

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-summarize-page", true);

document.addEventListener("DOMContentLoaded", async () => {
  
    let specialPrompts = await getSpecialPrompts();
    let summarize_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize');
    let summarize_email_template = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_template');
    let summarize_email_separator = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_separator');

    if (summarize_prompt && summarize_prompt.api_type && summarize_prompt.api_type !== '') {
        let update_prefs = {};
        update_prefs['summarize_connection_type'] = summarize_prompt.api_type;
        // getConnectionType() reads the prefixed connection type only when this flag is on,
        // so writing the pair one half at a time leaves the value inert. It matters for the
        // call sites that pass prompt = null (the menu gating in mzta-background.js and the
        // feature row in mzta-options.js): they have no prompt to fall back on, so the pref
        // pair is the only way they can see the per-feature connection.
        // Only for a usable api_type: chatgpt_web has no <option> in the per-prompt select and
        // isApiUsableConnection() rejects it, so the pair would read as "on" while the feature
        // stayed hidden from the menus.
        if (isApiUsableConnection(summarize_prompt.api_type)) {
            update_prefs['summarize_use_specific_integration'] = true;
        }

        let integration = summarize_prompt.api_type.replace('_api', '');
        if (integration_options_config && integration_options_config[integration]) {
            for (const key of Object.keys(integration_options_config[integration])) {
                const propName = `${integration}_${key}`;
                if (summarize_prompt[propName] !== undefined) {
                    update_prefs[`summarize_${propName}`] = summarize_prompt[propName];
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
    document.getElementById('summarize_auto').addEventListener('change', updateDisplayModeConstraint);
    document.getElementById('reset_summarize_max_messages').addEventListener('click', resetSummarizeMaxMessages);

    // Colour the connection panel to match the selected provider, and hide the
    // whole panel when "use specific integration" is off (no empty bordered box).
    // The connection select / checkbox are managed by initializeSpecificIntegrationUI;
    // we only react to their changes here (no change to the shared connection-ui.js).
    let summarize_conntype_el = document.getElementById('summarize_connection_type');
    let summarize_use_specific_el = document.getElementById('summarize_use_specific_integration');
    if (summarize_conntype_el) {
        summarize_conntype_el.addEventListener('change', updateConnPanelTint);
    }
    if (summarize_use_specific_el) {
        summarize_use_specific_el.addEventListener('change', updateConnPanelTint);
    }
    updateConnPanelTint();
    let prefs_summarize = await browser.storage.sync.get({ summarize_enabled_accounts: [], connection_type: 'chatgpt_web' });

    // Auto-summarize senders list
    // The toggle is a plain .option-input (saved by saveOptions), the list is saved explicitly.
    let auto_senders_toggle = document.getElementById('summarize_auto_senders');
    let auto_senders_textarea = document.getElementById('summarize_auto_senders_list');
    let auto_senders_save_btn = document.getElementById('btn_save_auto_senders');

    let auto_senders_value = await summarize_getAutoSendersList();
    let auto_senders_string = auto_senders_value.join('\n');

    auto_senders_textarea.value = auto_senders_string;

    auto_senders_textarea.addEventListener('input', (event) => {
        auto_senders_save_btn.disabled = (event.target.value === auto_senders_string);
        if(auto_senders_save_btn.disabled){
            document.getElementById('auto_senders_unsaved').classList.add('hidden');
        } else {
            document.getElementById('auto_senders_unsaved').classList.remove('hidden');
        }
    });

    auto_senders_save_btn.addEventListener('click', () => {
        let auto_senders_array_new = normalizeStringList(auto_senders_textarea.value, 2);
        summarize_setAutoSendersList(auto_senders_array_new);
        auto_senders_save_btn.disabled = true;
        auto_senders_string = auto_senders_array_new.join('\n');
        auto_senders_textarea.value = auto_senders_string;
        document.getElementById('auto_senders_unsaved').classList.add('hidden');
        updateAutoSendersNotice();
    });

    // The list and its Save button are only usable when the feature is switched on.
    auto_senders_toggle.addEventListener('change', () => {
        updateAutoSendersState();
        updateAutoSendersNotice();
    });
    updateAutoSendersState();
    // updateDisplayModeConstraint() only fires on the summarize_auto select, so the notice is
    // refreshed on its own here (and on the toggle change and after a save).
    updateAutoSendersNotice();

    let summarize_textarea = document.getElementById("summarize_prompt_text");
    let summarize_save_btn = document.getElementById("btn_save_prompt");
    let summarize_reset_btn = document.getElementById("btn_reset_prompt");
    let summarize_textarea_email_template = document.getElementById("summarize_email_template_text");
    let summarize_reset_email_template_btn = document.getElementById("btn_reset_email_template");
    let summarize_save_email_template_btn = document.getElementById("btn_save_email_template");
    let summarize_email_separator_textarea = document.getElementById("summarize_email_separator_text");
    let summarize_email_separator_save_btn = document.getElementById("btn_save_email_separator");
    let summarize_email_separator_reset_btn = document.getElementById("btn_reset_email_separator");

    
    // on changing textareas
    summarize_textarea.addEventListener("input", (event) => {
        summarize_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_full_text'));
        summarize_save_btn.disabled = (event.target.value === summarize_prompt.text);
    });
    
    summarize_textarea_email_template.addEventListener("input", (event) => {
        summarize_reset_email_template_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_email_template_full_text'));
        summarize_save_email_template_btn.disabled = (event.target.value === summarize_email_template.text);
    });

    summarize_email_separator_textarea.addEventListener("input", (event) => {
        summarize_email_separator_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_email_separator_full_text'));
        summarize_email_separator_save_btn.disabled = (event.target.value === summarize_email_separator.text);
    });
    

    // on clicking buttons, reset
    summarize_reset_email_template_btn.addEventListener("click", () => {
        summarize_textarea_email_template.value = browser.i18n.getMessage("prompt_summarize_email_template_full_text");
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

    summarize_email_separator_reset_btn.addEventListener("click", () => {
        summarize_email_separator_textarea.value = browser.i18n.getMessage("prompt_summarize_email_separator_full_text");
        summarize_email_separator_reset_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        summarize_email_separator_textarea.dispatchEvent(event);
    });
    
    // on clicking buttons, save
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

    summarize_email_separator_save_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_summarize_email_separator').text = summarize_email_separator_textarea.value;
        setSpecialPrompts(specialPrompts);
        summarize_email_separator_save_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });

    
    if(summarize_prompt.text === 'prompt_summarize_full_text'){
        summarize_prompt.text = browser.i18n.getMessage(summarize_prompt.text);
    }
    if(summarize_email_template.text === 'prompt_summarize_email_template_full_text'){
        summarize_email_template.text = browser.i18n.getMessage(summarize_email_template.text);
    }
    if(summarize_email_separator.text === 'prompt_summarize_email_separator_full_text'){
        summarize_email_separator.text = browser.i18n.getMessage(summarize_email_separator.text);
    }

    summarize_textarea_email_template.value = summarize_email_template.text;
    summarize_reset_email_template_btn.disabled = (summarize_textarea_email_template.value === browser.i18n.getMessage("prompt_summarize_email_template_full_text"));
    summarize_textarea.value = summarize_prompt.text;
    summarize_reset_btn.disabled = (summarize_textarea.value === browser.i18n.getMessage("prompt_summarize_full_text"));
    summarize_email_separator_textarea.value = summarize_email_separator.text;
    summarize_email_separator_reset_btn.disabled = (summarize_email_separator_textarea.value === browser.i18n.getMessage("prompt_summarize_email_separator_full_text"));

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders
        .filter((p) => p.id !== "additional_text")
        .map(mapPlaceholderToSuggestion);

    const summarize_textarea_hl = attachEditorHighlight(summarize_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (summarize_textarea_hl) summarize_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(summarize_textarea, autocompleteSuggestions, 1);
    const summarize_textarea_email_template_hl = attachEditorHighlight(summarize_textarea_email_template);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (summarize_textarea_email_template_hl) summarize_textarea_email_template_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(summarize_textarea_email_template, autocompleteSuggestions, 1);
    const summarize_email_separator_textarea_hl = attachEditorHighlight(summarize_email_separator_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (summarize_email_separator_textarea_hl) summarize_email_separator_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(summarize_email_separator_textarea, autocompleteSuggestions, 1);
    
});

// Methods to manage options, derived from: /options/mzta-options.js

const CONN_TYPES = ["chatgpt_web", "chatgpt_api", "ollama_api", "openai_comp_api", "google_gemini_api", "anthropic_api"];

// Tint the connection panel (border/background/pill) to match the selected
// connection type, set the provider pill name, and hide the whole panel when
// the "use specific integration" checkbox is off. Mirrors updateConnPanelTint()
// on the options page but scoped to the summarize prefix.
function updateConnPanelTint() {
  let conntype_select = document.getElementById("summarize_connection_type");
  let panel = document.getElementById("mzta_conn_panel");
  let use_specific = document.getElementById("summarize_use_specific_integration");
  if (!panel) return;

  // Hide the whole panel (not just its rows) when specific integration is off.
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

function updateDisplayModeConstraint() {
  const summarize_auto_el = document.getElementById('summarize_auto');
  const display_mode_el = document.getElementById('summarize_display_mode');
  const autoVal = String(summarize_auto_el.value);
  if (autoVal === '2' || autoVal === '3') {
    display_mode_el.value = 'inline';
    display_mode_el.disabled = true;
    browser.storage.sync.set({ summarize_display_mode: 'inline' });
  } else if (autoVal === '0') {
    display_mode_el.disabled = true;
  } else {
    display_mode_el.disabled = false;
  }
  updateAutoSendersState();
  updateAutoSendersNotice();
}

// Enables or disables the auto-summarize senders card.
// With summarize_auto === 3 every incoming message is summarized anyway, so the whole card is
// switched off and an explanatory note is shown. Otherwise only the list and its Save button
// follow the toggle.
function updateAutoSendersState(){
  const toggle_el = document.getElementById('summarize_auto_senders');
  const list_el = document.getElementById('summarize_auto_senders_list');
  const save_btn = document.getElementById('btn_save_auto_senders');
  const note_el = document.getElementById('summarize_auto_senders_disabled_note');
  if(!toggle_el || !list_el || !save_btn) return;

  const summarize_auto_el = document.getElementById('summarize_auto');
  const allSummarized = (String(summarize_auto_el.value) === '3');

  toggle_el.disabled = allSummarized;
  list_el.disabled = allSummarized || !toggle_el.checked;
  // Never re-enable Save here: it is owned by the dirty-state check on the textarea.
  if(list_el.disabled){
    save_btn.disabled = true;
  }
  if(note_el){
    note_el.classList.toggle('hidden', !allSummarized);
  }
}

// The notice below the summarize_auto select warns that, even though auto-summarize is
// disabled in general, the senders in the list are still summarized automatically.
async function updateAutoSendersNotice(){
  const notice_el = document.getElementById('summarize_auto_senders_notice');
  if(!notice_el) return;
  const summarize_auto_el = document.getElementById('summarize_auto');
  const toggle_el = document.getElementById('summarize_auto_senders');
  const list = await summarize_getAutoSendersList();
  const show = ((String(summarize_auto_el.value) === '0') || (String(summarize_auto_el.value) === '1')) && toggle_el.checked && hasAddressListEntries(list);
  notice_el.classList.toggle('hidden', !show);
}

async function summarize_getAutoSendersList() {
  let prefs = await browser.storage.sync.get({summarize_auto_senders_list: prefs_default.summarize_auto_senders_list});
  return prefs.summarize_auto_senders_list;
}

function summarize_setAutoSendersList(summarize_auto_senders_list) {
  browser.storage.sync.set({summarize_auto_senders_list: summarize_auto_senders_list});
}

function resetSummarizeMaxMessages(){
  let summarize_max_messages = document.getElementById('summarize_max_messages');
  summarize_max_messages.value = prefs_default.summarize_max_messages;
  browser.storage.sync.set({summarize_max_messages: prefs_default.summarize_max_messages});
}

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
        if (element.id === 'summarize_auto') {
          // An empty select (selectedIndex === -1) parses to NaN, which storage.sync
          // serializes as null — and a stored null is *not* replaced by the default in
          // storage.sync.get(), so the value stays outside the 0..3 range forever and
          // every === comparison downstream silently fails. Fall back to the default.
          let parsed = parseInt(element.value, 10);
          options[element.id] = Number.isNaN(parsed) ? prefs_default.summarize_auto : parsed;
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
          let default_number_value = 0;
          if(element.id == 'chatgpt_win_height') default_number_value = prefs_default.chatgpt_win_height;
          if(element.id == 'chatgpt_win_width') default_number_value = prefs_default.chatgpt_win_width;
          if(element.id == 'summarize_max_messages') default_number_value = prefs_default.summarize_max_messages;
          element.value = result[element.id] ?? default_number_value;
          break;
        case 'text':
        case 'textarea':
        case 'password':
          let default_text_value = '';
          if(element.id == 'default_chatgpt_lang') default_text_value = prefs_default.default_chatgpt_lang;
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
            let default_select_value = 0;
            if (element.id === 'summarize_auto') {
              default_select_value = prefs_default.summarize_auto;
            }
            if (element.id === 'summarize_display_mode') {
              default_select_value = prefs_default.summarize_display_mode;
            }
            const restoreValue = result[element.id] ?? default_select_value;
            // Check if option exists
            let optionExists = Array.from(element.options).some(opt => opt.value === String(restoreValue));
            // Never synthesize an option for a connection select: its catalogue is closed.
            let canSynthesize = !isClosedCatalogueSelect(element.id);
            if (element.tomselect) {
              if (!optionExists && restoreValue !== '' && canSynthesize) {
                element.tomselect.addOption({ value: String(restoreValue), text: String(restoreValue) });
              }
              element.tomselect.setValue(String(restoreValue), true);
              setTomSelectBorder(element.tomselect);
            } else {
              if (!optionExists && restoreValue !== '' && canSynthesize) {
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
  let addtags_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_summarize');

  if (addtags_prompt) {
      if (addtags_prompt.api_type && addtags_prompt.api_type !== '') {
          getting['summarize_connection_type'] = addtags_prompt.api_type;
      } else {
          // Inherit the global connection only when this select can actually offer it:
          // chatgpt_web has no <option> here (it has no API), so inheriting it would show
          // a value the control cannot represent. Leave it blank instead.
          getting['summarize_connection_type'] = isApiUsableConnection(getting['connection_type'])
              ? getting['connection_type']
              : '';
      }
      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              const propName = `${integration}_${key}`;
              if (addtags_prompt[propName] !== undefined && addtags_prompt[propName] !== '') {
                  getting[`summarize_${propName}`] = addtags_prompt[propName];
              } else {
                  getting[`summarize_${propName}`] = getting[propName];
              }
          }
      }
  }

  setCurrentChoice(getting);
  updateDisplayModeConstraint();
}
