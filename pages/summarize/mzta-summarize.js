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
  prefs_default
} from '../../options/mzta-options-default.js';
import { taLogger } from "../../js/mzta-logger.js";
import {
    getSpecialPrompts
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
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI,
  isClosedCatalogueSelect
} from "../_lib/connection-ui.js";
import { initUnsavedGuard } from "../_lib/unsaved-guard.js";
import { mztaPrefs } from '../../js/mzta-prefs.js';
import {
    applyManagedUI,
    isLockedKey,
    lockCompanions,
    setDisabledRespectingManaged
} from '../_lib/managed-ui.js';
import {
    persistPromptConnectionToPrefs,
    resolveFeatureConnectionPrefs,
    bindConnPanelTint,
    bindSpecialPromptEditor
} from '../_lib/feature-page.js';

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-summarize-page", true);

document.addEventListener("DOMContentLoaded", async () => {

    // Warn before leaving the page with unsaved textarea text.
    initUnsavedGuard();

    let specialPrompts = await getSpecialPrompts();
    let summarize_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize');
    let summarize_email_template = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_template');
    let summarize_email_separator = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_separator');

    await persistPromptConnectionToPrefs('summarize', summarize_prompt);

    await initializeSpecificIntegrationUI({
      prefix: 'summarize',
      promptId: 'prompt_summarize',
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
    document.getElementById('summarize_auto').addEventListener('change', updateDisplayModeConstraint);
    document.getElementById('reset_summarize_max_messages').addEventListener('click', resetSummarizeMaxMessages);

    bindConnPanelTint('summarize');

    // Auto-summarize senders list
    // The toggle is a plain .option-input (saved by saveOptions), the list is saved explicitly.
    let auto_senders_toggle = document.getElementById('summarize_auto_senders');
    let auto_senders_textarea = document.getElementById('summarize_auto_senders_list');
    let auto_senders_save_btn = document.getElementById('btn_save_auto_senders');

    let auto_senders_value = await summarize_getAutoSendersList();
    let auto_senders_string = auto_senders_value.join('\n');

    auto_senders_textarea.value = auto_senders_string;

    // data-mzta-pref: applyManagedUI() above has already disabled and marked the textarea
    // when the policy locks the list. Its Save button is ours to lock.
    lockCompanions('summarize_auto_senders_list', [auto_senders_save_btn]);

    auto_senders_textarea.addEventListener('input', (event) => {
        setDisabledRespectingManaged(auto_senders_save_btn, (event.target.value === auto_senders_string));
        if(auto_senders_save_btn.disabled){
            document.getElementById('auto_senders_unsaved').classList.add('hidden');
        } else {
            document.getElementById('auto_senders_unsaved').classList.remove('hidden');
        }
    });

    auto_senders_save_btn.addEventListener('click', () => {
        // The button being disabled is not the same as the action being unavailable.
        if (isLockedKey('summarize_auto_senders_list')) return;
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
    let summarize_textarea_email_template = document.getElementById("summarize_email_template_text");
    let summarize_email_separator_textarea = document.getElementById("summarize_email_separator_text");

    // Each of the three texts is saved, and can be enforced by the policy, on its own.
    await bindSpecialPromptEditor({
        textarea: summarize_textarea,
        saveBtn: document.getElementById("btn_save_prompt"),
        resetBtn: document.getElementById("btn_reset_prompt"),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_summarize'],
        defaultMsgKey: 'prompt_summarize_full_text',
        do_debug: taLog.do_debug,
    });
    await bindSpecialPromptEditor({
        textarea: summarize_textarea_email_template,
        saveBtn: document.getElementById("btn_save_email_template"),
        resetBtn: document.getElementById("btn_reset_email_template"),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_summarize_email_template'],
        defaultMsgKey: 'prompt_summarize_email_template_full_text',
        do_debug: taLog.do_debug,
    });
    await bindSpecialPromptEditor({
        textarea: summarize_email_separator_textarea,
        saveBtn: document.getElementById("btn_save_email_separator"),
        resetBtn: document.getElementById("btn_reset_email_separator"),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_summarize_email_separator'],
        defaultMsgKey: 'prompt_summarize_email_separator_full_text',
        do_debug: taLog.do_debug,
    });

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

function updateDisplayModeConstraint() {
  const summarize_auto_el = document.getElementById('summarize_auto');
  const display_mode_el = document.getElementById('summarize_display_mode');
  const autoVal = String(summarize_auto_el.value);
  // Through the managed-aware setter: this runs on every summarize_auto change, after
  // applyManagedUI(), and a plain assignment would re-enable a locked display mode.
  if (autoVal === '2' || autoVal === '3') {
    display_mode_el.value = 'inline';
    setDisabledRespectingManaged(display_mode_el, true);
    mztaPrefs.setPref('summarize_display_mode', 'inline');
  } else if (autoVal === '0') {
    setDisabledRespectingManaged(display_mode_el, true);
  } else {
    setDisabledRespectingManaged(display_mode_el, false);
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

  // Through the managed-aware setter: this runs on every summarize_auto change, after
  // applyManagedUI(), and a plain assignment would re-enable a control the policy locked.
  setDisabledRespectingManaged(toggle_el, allSummarized);
  setDisabledRespectingManaged(list_el, allSummarized || !toggle_el.checked);
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
  let prefs = await mztaPrefs.getPrefs(['summarize_auto_senders_list']);
  return prefs.summarize_auto_senders_list;
}

function summarize_setAutoSendersList(summarize_auto_senders_list) {
  if (isLockedKey('summarize_auto_senders_list')) return;
  mztaPrefs.setPref('summarize_auto_senders_list', summarize_auto_senders_list);
}

function resetSummarizeMaxMessages(){
  let summarize_max_messages = document.getElementById('summarize_max_messages');
  summarize_max_messages.value = prefs_default.summarize_max_messages;
  mztaPrefs.setPref('summarize_max_messages', prefs_default.summarize_max_messages);
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
          // An empty select (selectedIndex === -1) parses to NaN, which storage
          // serializes as null — and a stored null is *not* replaced by the default in
          // storage.get(), so the value stays outside the 0..3 range forever and
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
                // A connection select stays blank (an unset specific integration, or a stale type
                // it does not offer): preselecting its first option would be stored as a choice
                // the user never made - on page open, when the integration is mandatory. The
                // other selects always have a value, and fall back to their first option.
                element.selectedIndex = canSynthesize ? 0 : -1;
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
  let summarize_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_summarize');

  resolveFeatureConnectionPrefs(getting, summarize_prompt, 'summarize');

  setCurrentChoice(getting);
  updateDisplayModeConstraint();
}
