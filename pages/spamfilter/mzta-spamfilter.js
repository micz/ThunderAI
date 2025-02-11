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

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-spamfilter-page",true);

document.addEventListener('DOMContentLoaded', async () => {

    i18n.updateDocument();
    await restoreOptions();

    document.querySelectorAll(".option-input").forEach(element => {
        element.addEventListener("change", saveOptions);
      });

    let spamfilter_textarea = document.getElementById('spamfilter_prompt_text');
    let spamfilter_save_btn = document.getElementById('btn_save_prompt');
    let spamfilter_reset_btn = document.getElementById('btn_reset_prompt');

    let specialPrompts = await getSpecialPrompts();
    let spamfilter_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter');

    spamfilter_textarea.addEventListener('input', (event) => {
        spamfilter_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_spamfilter_full_text'));
        spamfilter_save_btn.disabled = (event.target.value === spamfilter_prompt.text);
        if(spamfilter_save_btn.disabled){
            document.getElementById('spamfilter_prompt_unsaved').classList.add('hidden');
        } else {
            document.getElementById('spamfilter_prompt_unsaved').classList.remove('hidden');
        }
    });

    spamfilter_reset_btn.addEventListener('click', () => {
        spamfilter_textarea.value = browser.i18n.getMessage('prompt_spamfilter_full_text');
        spamfilter_reset_btn.disabled = true;
        let event = new Event('input', { bubbles: true, cancelable: true });
        spamfilter_textarea.dispatchEvent(event);
    });

    spamfilter_save_btn.addEventListener('click', () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter').text = spamfilter_textarea.value;
        setSpecialPrompts(specialPrompts);
        spamfilter_save_btn.disabled = true;
        document.getElementById('spamfilter_prompt_unsaved').classList.add('hidden');
        browser.runtime.sendMessage({command: "reload_menus"});
    });

    if(spamfilter_prompt.text === 'prompt_spamfilter_full_text'){
        spamfilter_prompt.text = browser.i18n.getMessage(spamfilter_prompt.text);
    }
    spamfilter_textarea.value = spamfilter_prompt.text;
    spamfilter_reset_btn.disabled = (spamfilter_textarea.value === browser.i18n.getMessage('prompt_spamfilter_full_text'));

    autocompleteSuggestions = (await getPlaceholders(true)).filter(p => !(p.id === 'additional_text')).map(p => ({command: '{%'+p.id+'%}', type: p.type}));
    textareaAutocomplete(spamfilter_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

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