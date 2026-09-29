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
  isClosedCatalogueSelect,
  getConnectionTypeLabel
} from "../_lib/connection-ui.js";
import { initTimezoneSelect } from "../_lib/mzta-timezones.js";
import { initUnsavedGuard } from "../_lib/unsaved-guard.js";
import { mztaPrefs } from '../../js/mzta-prefs.js';
import {
    applyManagedUI,
    seedFromGlobal,
    isEnforcedPref,
    isLockedKey,
    lockEnforcedPromptText,
    isEnforcedPromptText
} from '../_lib/managed-ui.js';

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-get-calendar-event-page",true);

document.addEventListener('DOMContentLoaded', async () => {

    // Warn before leaving the page with unsaved textarea text.
    initUnsavedGuard();

    let specialPrompts = await getSpecialPrompts();
    let get_calendar_event_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_get_calendar_event');

    if (get_calendar_event_prompt && get_calendar_event_prompt.api_type && get_calendar_event_prompt.api_type !== '') {
        let update_prefs = {};
        update_prefs['get_calendar_event_connection_type'] = get_calendar_event_prompt.api_type;
        // getConnectionType() reads the prefixed connection type only when this flag is on,
        // so writing the pair one half at a time leaves the value inert. It matters for the
        // call sites that pass prompt = null (the menu gating in mzta-background.js and the
        // feature row in mzta-options.js): they have no prompt to fall back on, so the pref
        // pair is the only way they can see the per-feature connection.
        // Only for a usable api_type: chatgpt_web has no <option> in the per-prompt select and
        // isApiUsableConnection() rejects it, so the pair would read as "on" while the feature
        // stayed hidden from the menus.
        if (isApiUsableConnection(get_calendar_event_prompt.api_type)) {
            update_prefs['get_calendar_event_use_specific_integration'] = true;
        }
        
        let integration = get_calendar_event_prompt.api_type.replace('_api', '');
        if (integration_options_config && integration_options_config[integration]) {
             for (const key of Object.keys(integration_options_config[integration])) {
                 const propName = `${integration}_${key}`;
                 if (get_calendar_event_prompt[propName] !== undefined) {
                     update_prefs[`get_calendar_event_${propName}`] = get_calendar_event_prompt[propName];
                 }
             }
        }
        await mztaPrefs.setPrefs(update_prefs);
    }

    // Must run before restoreOptions(), which is called by initializeSpecificIntegrationUI()
    initTimezoneSelect(document.getElementById('calendar_timezone'));

    await initializeSpecificIntegrationUI({
      prefix: 'get_calendar_event',
      promptId: 'prompt_get_calendar_event',
      taLog: taLog,
      restoreOptionsCallback: restoreOptions
    });

    i18n.updateDocument();

    // Disable and mark every control the enterprise policy enforces. Runs after the
    // connection panel has been injected above, so its provider rows are covered too.
    await applyManagedUI(document, taLog.do_debug);

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

    let get_calendar_event_textarea = document.getElementById('get_calendar_event_prompt_text');
    let get_calendar_event_save_btn = document.getElementById('btn_save_prompt');
    let get_calendar_event_reset_btn = document.getElementById('btn_reset_prompt');
    let get_calendar_event_use_specific_integration = document.getElementById('get_calendar_event_use_specific_integration');
    let get_calendar_event_no_selection = document.getElementById('calendar_no_selection');
    let get_calendar_event_from_clipboard = document.getElementById('get_calendar_event_from_clipboard');

    get_calendar_event_textarea.addEventListener('input', (event) => {
        get_calendar_event_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_get_calendar_event_full_text'));
        get_calendar_event_save_btn.disabled = (event.target.value === get_calendar_event_prompt.text);
        if(get_calendar_event_save_btn.disabled){
            document.getElementById('get_calendar_event_prompt_unsaved').classList.add('hidden');
        } else {
            document.getElementById('get_calendar_event_prompt_unsaved').classList.remove('hidden');
        }
    });

    // Colour the connection panel to match the selected provider, and hide the
    // whole panel when "use specific integration" is off (no empty bordered box).
    let get_calendar_event_conntype_el = document.getElementById('get_calendar_event_connection_type');
    if (get_calendar_event_conntype_el) {
        get_calendar_event_conntype_el.addEventListener('change', updateConnPanelTint);
    }
    get_calendar_event_use_specific_integration.addEventListener('change', updateConnPanelTint);
    updateConnPanelTint();

    // calendar_no_selection is the single source of truth: need_selected of the calendar
    // prompt is derived from it on every read (applyCalendarNoSelection() in
    // js/mzta-prompts.js), so this handler no longer writes the prompt. The preference itself
    // is stored by saveOptions(), registered above and therefore run first; the background
    // rebuilds the menus from storage.onChanged, and the explicit reload_menus below only
    // makes it immediate.
    get_calendar_event_no_selection.addEventListener('change', async (event) => {
        if (event.target.checked) {
            const currentPromptText = get_calendar_event_textarea.value;
            if (!hasBodyPlaceholder(currentPromptText)) {
                alert(browser.i18n.getMessage('prefs_OptionText_calendar_no_selection_missing_placeholder'));
                event.target.checked = false;
                // saveOptions() has already stored true: roll the preference back too, or the
                // switch would come back on at the next visit with the prompt unchanged.
                await mztaPrefs.setPref('calendar_no_selection', false);
            }
        }
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    // A policy can lock the option on without passing through the check above. Say so next
    // to the switch when the saved prompt cannot work with it (the background also warns).
    const updateNoSelectionPolicyNote = () => {
        const note = document.getElementById('calendar_no_selection_policy_note');
        if (!note) return;
        const show = isLockedKey('calendar_no_selection') && get_calendar_event_no_selection.checked &&
            !hasBodyPlaceholder(get_calendar_event_prompt.text);
        note.textContent = show ? browser.i18n.getMessage('prefs_OptionText_calendar_no_selection_policy_missing_placeholder') : '';
        note.classList.toggle('shown', show);
    };

    get_calendar_event_from_clipboard.addEventListener('change', async (event) => {
        if (event.target.checked) {
            // Request clipboardRead permission when enabling the feature
            try {
                const granted = await browser.permissions.request({
                    permissions: ["clipboardRead"]
                });

                if (granted) {
                    // Permission granted, enable the feature
                    await mztaPrefs.setPref('get_calendar_event_from_clipboard', true);
                    browser.runtime.sendMessage({command: "reload_menus"});
                } else {
                    // Permission denied, uncheck the checkbox
                    event.target.checked = false;
                    alert(browser.i18n.getMessage("clipboard_permission_denied"));
                }
            } catch (err) {
                taLog.error("Error requesting clipboard permission:", err);
                event.target.checked = false;
                alert(browser.i18n.getMessage("clipboard_permission_error"));
            }
        } else {
            // Disabling the feature
            await mztaPrefs.setPref('get_calendar_event_from_clipboard', false);
            browser.runtime.sendMessage({command: "reload_menus"});
        }
    });

    get_calendar_event_reset_btn.addEventListener('click', () => {
        // The button being disabled is not the same as the action being unavailable.
        if (isEnforcedPromptText('prompt_get_calendar_event') ||
            isEnforcedPromptText('prompt_get_calendar_event_from_clipboard')) return;
        get_calendar_event_textarea.value = browser.i18n.getMessage('prompt_get_calendar_event_full_text');
        get_calendar_event_reset_btn.disabled = true;
        let event = new Event('input', { bubbles: true, cancelable: true });
        get_calendar_event_textarea.dispatchEvent(event);
    });

    get_calendar_event_save_btn.addEventListener('click', async () => {
        // The button being disabled is not the same as the action being unavailable. This
        // textarea saves both calendar prompts, so either one being enforced locks it.
        if (isEnforcedPromptText('prompt_get_calendar_event') ||
            isEnforcedPromptText('prompt_get_calendar_event_from_clipboard')) return;
        // The same rule the switch enforces when it is turned on, applied from the other
        // side: with "Do not ask to select text" on, a prompt that does not read the body
        // would be sent with no message text at all. Reset needs no check of its own - it
        // only refills the textarea with the default text, which has the placeholder, and
        // saving goes through here.
        if (get_calendar_event_no_selection.checked && !hasBodyPlaceholder(get_calendar_event_textarea.value)) {
            alert(browser.i18n.getMessage('prefs_OptionText_calendar_no_selection_save_missing_placeholder'));
            return;
        }
        specialPrompts.find(prompt => prompt.id === 'prompt_get_calendar_event').text = get_calendar_event_textarea.value;
        specialPrompts.find(prompt => prompt.id === 'prompt_get_calendar_event_from_clipboard').text = get_calendar_event_textarea.value;
        await setSpecialPrompts(specialPrompts);
        updateNoSelectionPolicyNote();
        get_calendar_event_save_btn.disabled = true;
        document.getElementById('get_calendar_event_prompt_unsaved').classList.add('hidden');
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    if(get_calendar_event_prompt.text === 'prompt_get_calendar_event_full_text'){
        get_calendar_event_prompt.text = browser.i18n.getMessage(get_calendar_event_prompt.text);
    }
    get_calendar_event_textarea.value = get_calendar_event_prompt.text;
    get_calendar_event_reset_btn.disabled = (get_calendar_event_textarea.value === browser.i18n.getMessage('prompt_get_calendar_event_full_text'));
    // A text enforced by the policy is shown (getSpecialPrompts() overlaid it) but not editable.
    // The policy validation gives the clipboard prompt the same text unless it names it too.
    await lockEnforcedPromptText(get_calendar_event_textarea,
        ['prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard'],
        [get_calendar_event_save_btn, get_calendar_event_reset_btn], taLog.do_debug);
    updateNoSelectionPolicyNote();

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.filter(p => !(p.id === 'additional_text')).map(mapPlaceholderToSuggestion);
    const get_calendar_event_textarea_hl = attachEditorHighlight(get_calendar_event_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (get_calendar_event_textarea_hl) get_calendar_event_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(get_calendar_event_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

});



// The calendar_no_selection option sends the whole message body, which only works if the
// prompt reads it through one of these two placeholders.
function hasBodyPlaceholder(text) {
  return (typeof text === 'string') &&
    (text.includes('{%mail_text_body_or_selected%}') || text.includes('{%mail_html_body_or_selected%}'));
}

// Methods to manage options, derived from: /options/mzta-options.js

const CONN_TYPES = ["chatgpt_web", "chatgpt_api", "ollama_api", "openai_comp_api", "google_gemini_api", "anthropic_api"];

// Tint the connection panel to match the selected connection type, set the
// provider pill name, and hide the whole panel when "use specific integration"
// is off. Scoped to the get_calendar_event prefix.
function updateConnPanelTint() {
  let conntype_select = document.getElementById("get_calendar_event_connection_type");
  let panel = document.getElementById("mzta_conn_panel");
  let use_specific = document.getElementById("get_calendar_event_use_specific_integration");
  if (!panel) return;

  panel.style.display = (use_specific && use_specific.checked) ? "" : "none";

  if (!conntype_select) return;
  let conntype = conntype_select.value;
  for (let t of CONN_TYPES) {
    panel.classList.toggle("tint_" + t, conntype === t);
  }
  let pillName = document.getElementById("mzta_conn_pill_name");
  if (pillName) {
    // Resolved from the shared catalogue, not by scraping the select: populateConnectionTypeOptions()
    // rebuilds the <option> list with replaceChildren(), so a DOM lookup can transiently miss.
    pillName.textContent = getConnectionTypeLabel(conntype);
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

  // Guard the default: branch above, which leaves `options` empty — the previous
  // set(options) wrote nothing in that case, so nothing must be written here either.
  if (Object.prototype.hasOwnProperty.call(options, element.id)) {
    mztaPrefs.setPref(element.id, options[element.id]);
  }
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

  let getting = await mztaPrefs.getAllPrefs();

  let specialPrompts = await getSpecialPrompts();
  let get_calendar_event_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_get_calendar_event');

  if (get_calendar_event_prompt) {
      if (isEnforcedPref('get_calendar_event_connection_type')) {
          // Enforced by the policy: getting already holds the enforced value, and that is what
          // runs (getConnectionType() reads it before the prompt's api_type). Show it as it is.
      } else if (get_calendar_event_prompt.api_type && get_calendar_event_prompt.api_type !== '') {
          getting['get_calendar_event_connection_type'] = get_calendar_event_prompt.api_type;
      } else {
          // Inherit the global connection only when this select can actually offer it:
          // chatgpt_web has no <option> here (it has no API), so inheriting it would show
          // a value the control cannot represent. Leave it blank instead.
          // seedFromGlobal(): never seed from a policy-supplied global value - these fields are
          // written into the special prompt, where it would outlive the policy.
          getting['get_calendar_event_connection_type'] = isApiUsableConnection(seedFromGlobal(getting, 'connection_type'))
              ? seedFromGlobal(getting, 'connection_type')
              : '';
      }
      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              const propName = `${integration}_${key}`;
              if (get_calendar_event_prompt[propName] !== undefined && get_calendar_event_prompt[propName] !== '') {
                  getting[`get_calendar_event_${propName}`] = get_calendar_event_prompt[propName];
              } else {
                  getting[`get_calendar_event_${propName}`] = seedFromGlobal(getting, propName);
              }
          }
      }
  }

  setCurrentChoice(getting);
}