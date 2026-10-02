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

import { prefs_default } from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import {
  getSpecialPrompts
} from "../../js/mzta-prompts.js";
import {
  getPlaceholders,
  mapPlaceholderToSuggestion, placeholdersUtils } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import { attachEditorHighlight, makeTokenStateResolver } from "../../js/mzta-editor-highlight.js";
import {
  addTags_getExclusionList,
  addTags_setExclusionList
} from "../../js/mzta-addtags-exclusion-list.js";
import {
  getAccountsList,
  getTagsList,
  intersectTagsLists,
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
    applyManagedUI,
    isLockedKey,
    lockCompanions,
    setDisabledRespectingManaged,
    lockAccountSelector
} from '../_lib/managed-ui.js';
import {
    persistPromptConnectionToPrefs,
    resolveFeatureConnectionPrefs,
    bindConnPanelTint,
    bindSpecialPromptEditor
} from '../_lib/feature-page.js';

let autocompleteSuggestions = [];
let activePlaceholders = [];
let taLog = new taLogger("mzta-addtags-page",true);

document.addEventListener('DOMContentLoaded', async () => {

  // Warn before leaving the page with unsaved textarea text.
  initUnsavedGuard();

  let specialPrompts = await getSpecialPrompts();
  let addtags_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_add_tags');

    await persistPromptConnectionToPrefs('add_tags', addtags_prompt);

    await initializeSpecificIntegrationUI({
      prefix: 'add_tags',
      promptId: 'prompt_add_tags',
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
    let prefs_add_tags = await mztaPrefs.getPrefs(['add_tags_enabled_accounts']);

    let addtags_textarea = document.getElementById('addtags_prompt_text');

    bindConnPanelTint('add_tags');

    let add_tags_auto_el = document.getElementById('add_tags_auto');
    let add_tags_auto_only_inbox_tr = document.getElementById('add_tags_auto_only_inbox_tr');
    let add_tags_auto_include_sent_tr = document.getElementById('add_tags_auto_include_sent_tr');
    let account_selector_container = document.getElementById('account_selector_container');
    let add_tags_auto_infoline = document.getElementById('add_tags_auto_infoline');
    let add_tags_auto_uselist_tr = document.getElementById('add_tags_auto_uselist_tr');
    // The sub-rows are hidden by a CSS rule (see mzta-add-tags.css) so they don't flash before
    // this runs. Setting style.display = '' only *removes* the inline value, which falls back to
    // that rule and leaves the row hidden, so each element must be revealed with the explicit
    // display its own layout needs: 'flex' for the .feature_row rows and for the .mzta_field
    // allow-list wrapper (a column flexbox), 'block' for the .mzta_section account card.
    function toggleAutoSubRows(visible) {
      add_tags_auto_only_inbox_tr.style.display = visible ? 'flex' : 'none';
      add_tags_auto_include_sent_tr.style.display = visible ? 'flex' : 'none';
      account_selector_container.style.display = visible ? 'block' : 'none';
      add_tags_auto_infoline.style.display = visible ? 'inline' : 'none';
      add_tags_auto_uselist_tr.style.display = visible ? 'flex' : 'none';
    }
    add_tags_auto_el.addEventListener('click', (event) => {
      toggleAutoSubRows(event.target.checked);
    });
    toggleAutoSubRows(add_tags_auto_el.checked);

    let add_tags_auto_uselist = document.getElementById('add_tags_auto_uselist');
    let add_tags_auto_uselist_list = document.getElementById('add_tags_auto_uselist_list');
    // Through the managed-aware setter: both run after applyManagedUI(), and a plain
    // assignment would re-enable the list when the policy locks it.
    add_tags_auto_uselist.addEventListener('click', (event) => {
      setDisabledRespectingManaged(add_tags_auto_uselist_list, !event.target.checked);
    });
    setDisabledRespectingManaged(add_tags_auto_uselist_list, !add_tags_auto_uselist.checked);

    await bindSpecialPromptEditor({
        textarea: addtags_textarea,
        saveBtn: document.getElementById('btn_save_prompt'),
        resetBtn: document.getElementById('btn_reset_prompt'),
        unsavedEl: document.getElementById('addtags_prompt_unsaved'),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_add_tags'],
        defaultMsgKey: 'prompt_add_tags_full_text',
        do_debug: taLog.do_debug,
    });

    document.getElementById('add_tags_maxnum').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_force_lang').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_auto_uselist').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_auto_uselist_list').addEventListener('change', updateAdditionalPromptStatements);
    document.getElementById('add_tags_auto_force_existing').addEventListener('change', updateAdditionalPromptStatements);
    addtags_textarea.addEventListener('change', updateAdditionalPromptStatements);

    updateAdditionalPromptStatements();

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.filter(p => !(p.id === 'additional_text')).map(mapPlaceholderToSuggestion);
    const addtags_textarea_hl = attachEditorHighlight(addtags_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (addtags_textarea_hl) addtags_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(addtags_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

    let excl_list_textarea = document.getElementById('addtags_excl_list');
    let excl_list_save_btn = document.getElementById('btn_save_excl_list');

    let excl_list_value = await addTags_getExclusionList();
    let excl_list_string = excl_list_value.join('\n');

    excl_list_textarea.value = excl_list_string;

    // data-mzta-pref="add_tags_exclusions" (the element id is not the preference key):
    // applyManagedUI() above has already disabled and marked the textarea when the policy
    // locks the list. Its Save button is ours to lock.
    lockCompanions('add_tags_exclusions', [excl_list_save_btn]);

    excl_list_textarea.addEventListener('input', (event) => {
        setDisabledRespectingManaged(excl_list_save_btn, (event.target.value === excl_list_string));
        if(excl_list_save_btn.disabled){
            document.getElementById('excl_list_unsaved').classList.add('hidden');
        } else {
            document.getElementById('excl_list_unsaved').classList.remove('hidden');
        }
    });

    excl_list_save_btn.addEventListener('click', () => {
        // The button being disabled is not the same as the action being unavailable. The
        // write guard in js/mzta-prefs.js would refuse it anyway.
        if (isLockedKey('add_tags_exclusions')) return;
        let excl_array_new = normalizeStringList(excl_list_textarea.value, 2);
        addTags_setExclusionList(excl_array_new);
        excl_list_save_btn.disabled = true;
        // The saved list is the new baseline for the dirty check above: without this,
        // editing the text back to the pre-save value would disable Save again.
        excl_list_string = excl_array_new.join('\n');
        excl_list_textarea.value = excl_list_string;
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

    // A policy add_tags_enabled_accounts_match replaces the stored selection: show the
    // accounts it resolves to, read-only, and never write add_tags_enabled_accounts.
    const accounts_managed = await lockAccountSelector('add_tags', accountsContainer,
        [document.getElementById('accounts_select_all'), document.getElementById('accounts_deselect_all')],
        taLog.do_debug);

    document.querySelectorAll('.accountCheckbox').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
      if (accounts_managed) return;
      let selectedAccounts = Array.from(document.querySelectorAll('.accountCheckbox:checked')).map(checkbox => checkbox.value);
      if (selectedAccounts.length === 0) {
        checkbox.checked = true; // Prevent deselecting the last selected checkbox
        taLog.log("At least one account must be selected.");
        return;
      }
      if (selectedAccounts.length === document.querySelectorAll('.accountCheckbox').length) {
        mztaPrefs.setPref('add_tags_enabled_accounts', []);
        taLog.log("All accounts selected, saving add_tags_enabled_accounts = [].");
      } else {
        mztaPrefs.setPref('add_tags_enabled_accounts', selectedAccounts);
        taLog.log("Saving add_tags_enabled_accounts = " + JSON.stringify(selectedAccounts) + ".");
      }
      });
    });

    document.getElementById('accounts_select_all').addEventListener('click', () => {
      if (accounts_managed) return;
      let checkboxes = document.querySelectorAll('.accountCheckbox');
      checkboxes.forEach(checkbox => checkbox.checked = true);
    });

    document.getElementById('accounts_deselect_all').addEventListener('click', () => {
      if (accounts_managed) return;
      let checkboxes = document.querySelectorAll('.accountCheckbox');
      checkboxes.forEach(checkbox => checkbox.checked = false);
    });
});


async function updateAdditionalPromptStatements(){
    let prefs_ = await mztaPrefs.getPrefs([
      'add_tags_maxnum',
      'add_tags_force_lang',
      'default_chatgpt_lang',
      'add_tags_auto_uselist',
      'add_tags_auto_uselist_list',
      'add_tags_auto_force_existing'
    ]);
    // Mirrors taPromptUtils.finalizePrompt_add_tags() [#926]
    let show_force_lang = !prefs_.add_tags_auto_force_existing && prefs_.add_tags_force_lang && prefs_.default_chatgpt_lang !== '';
    let uselist_active = prefs_.add_tags_auto_uselist && prefs_.add_tags_auto_uselist_list.trim() !== '';
    let force_existing_list = '';
    if(prefs_.add_tags_auto_force_existing){
        let existing_tags_list = (await getTagsList())[0];
        if(uselist_active){
            force_existing_list = intersectTagsLists(prefs_.add_tags_auto_uselist_list, existing_tags_list);
        }else if(!document.getElementById('addtags_prompt_text').value.includes("{%tags_full_list%}")){
            force_existing_list = existing_tags_list;
        }
    }
    let show_use_list = !prefs_.add_tags_auto_force_existing && uselist_active;
    let el_tag_limit = document.getElementById('addtags_info_additional_statements');
    if((prefs_.add_tags_maxnum > 0)||show_force_lang||show_use_list||(force_existing_list !== '')){
        el_tag_limit.textContent = browser.i18n.getMessage("addtags_info_additional_statements") + " \""
        if(prefs_.add_tags_maxnum > 0){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_maxnum") + " " + prefs_.add_tags_maxnum +". "
        }
        if(show_force_lang){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_force_lang") + " " + prefs_.default_chatgpt_lang + ". "
        }
        if(show_use_list){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_use_list") + ": " + prefs_.add_tags_auto_uselist_list + ".";
        }
        if(force_existing_list !== ''){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_force_existing") + ": " + force_existing_list + ".";
        }
        el_tag_limit.textContent = el_tag_limit.textContent.trim();
        el_tag_limit.textContent += "\".";
        el_tag_limit.style.display = 'block';
    }else{
        el_tag_limit.style.display = 'none';
    }
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
  let addtags_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_add_tags');

  resolveFeatureConnectionPrefs(getting, addtags_prompt, 'add_tags');

  setCurrentChoice(getting);
}
