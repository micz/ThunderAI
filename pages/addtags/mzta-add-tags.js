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
import { addTags_getExclusionList, addTags_setExclusionList } from "../../js/mzta-addatags-exclusion-list.js";


let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-addtags-page",true);

document.addEventListener('DOMContentLoaded', async () => {

    i18n.updateDocument();
    await restoreOptions();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

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
    let add_tags_auto_force_existing_tr = document.getElementById('add_tags_auto_force_existing_tr');
    add_tags_auto_el.addEventListener('click', (event) => {
      add_tags_auto_force_existing_tr.style.display = event.target.checked ? 'table-row' : 'none';
      if(!event.target.checked){
        document.getElementById('add_tags_auto_force_existing').checked = false;
      }
    });
    add_tags_auto_force_existing_tr.style.display = add_tags_auto_el.checked ? 'table-row' : 'none';

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

    updateAdditionalPromptStatements();

    autocompleteSuggestions = (await getPlaceholders(true)).filter(p => !(p.id === 'additional_text')).map(p => ({command: '{%'+p.id+'%}', type: p.type}));
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
        let excl_array_new = excl_list_textarea.value.split(/[\n,]+/);
        excl_array_new = Array.from(new Set(excl_array_new.map(item => item.trim().toLowerCase()))).sort();
        addTags_setExclusionList(excl_array_new);
        excl_list_save_btn.disabled = true;
        excl_list_textarea.value = excl_array_new.join('\n');
        document.getElementById('excl_list_unsaved').classList.add('hidden');
    });

});


async function updateAdditionalPromptStatements(){
    let prefs_ = await browser.storage.sync.get({add_tags_maxnum: 3, add_tags_force_lang: true, default_chatgpt_lang: ''});
    let el_tag_limit = document.getElementById('addtags_info_additional_statements');
    if((prefs_.add_tags_maxnum > 0)||(prefs_.add_tags_force_lang && prefs_.default_chatgpt_lang !== '')){
        el_tag_limit.textContent = browser.i18n.getMessage("addtags_info_additional_statements") + " \""
        if(prefs_.add_tags_maxnum > 0){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_maxnum") + " " + prefs_.add_tags_maxnum +"."
        }
        if(prefs_.add_tags_force_lang && prefs_.default_chatgpt_lang !== ''){
          if(prefs_.add_tags_maxnum > 0){
            el_tag_limit.textContent += " "
          }
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_force_lang") + " " + prefs_.default_chatgpt_lang + "."
        }
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
      default:
        if (element.tagName === 'SELECT') {
          options[element.id] = element.value;
        }else{
          console.error("[ThunderAI] Unhandled input type:", element.type);
        }
    }

  browser.storage.sync.set(options);
}

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      taLog.log("Options restoring " + element.id + " = " + (element.id=="chatgpt_api_key" || element.id=="openai_comp_api_key" ? "****************" : result[element.id]));
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