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
  setTomSelectBorder
} from "../../js/mzta-utils.js";
import {
  initializeSpecificIntegrationUI,
  isClosedCatalogueSelect
} from "../_lib/connection-ui.js";
import { initUnsavedGuard } from "../_lib/unsaved-guard.js";
import { mztaPrefs } from '../../js/mzta-prefs.js';
import {
    applyManagedUI
} from '../_lib/managed-ui.js';
import {
    persistPromptConnectionToPrefs,
    resolveFeatureConnectionPrefs,
    bindConnPanelTint,
    bindSpecialPromptEditor
} from '../_lib/feature-page.js';

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-translate-page", true);

document.addEventListener("DOMContentLoaded", async () => {

    // Warn before leaving the page with unsaved textarea text.
    initUnsavedGuard();

    let specialPrompts = await getSpecialPrompts();
    let translate_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_translate_this');

    await persistPromptConnectionToPrefs('translate', translate_prompt);

    await initializeSpecificIntegrationUI({
      prefix: 'translate',
      promptId: 'prompt_translate_this',
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

    bindConnPanelTint('translate');

    let translate_textarea = document.getElementById("translate_prompt_text");

    await bindSpecialPromptEditor({
        textarea: translate_textarea,
        saveBtn: document.getElementById("btn_save_prompt"),
        resetBtn: document.getElementById("btn_reset_prompt"),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_translate_this'],
        defaultMsgKey: 'prompt_translate_this_full_text',
        do_debug: taLog.do_debug,
    });

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders
        .filter((p) => p.id !== "additional_text")
        .map(mapPlaceholderToSuggestion);

    const translate_textarea_hl = attachEditorHighlight(translate_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (translate_textarea_hl) translate_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
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
          // An empty select (selectedIndex === -1) parses to NaN, which storage
          // serializes as null — and a stored null is *not* replaced by the default in
          // storage.get(), so the value stays outside the 0..3 range forever and
          // every === comparison downstream silently fails. Fall back to the default.
          let parsed = parseInt(element.value, 10);
          options[element.id] = Number.isNaN(parsed) ? prefs_default.translate_auto : parsed;
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
            const restoreValue = result[element.id] ?? default_select_value;
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
  let translate_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_translate_this');

  resolveFeatureConnectionPrefs(getting, translate_prompt, 'translate');

  // If translate_lang is empty, show default_chatgpt_lang as placeholder/default
  if (!getting['translate_lang']) {
      getting['translate_lang'] = '';
  }

  setCurrentChoice(getting);
}
