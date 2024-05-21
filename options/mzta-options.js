/*
 *  ThunderAI [https://micz.it/thunderdbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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


import { prefs_default } from './mzta-options-default.js';
import { getLanguageDisplayName } from '../js/mzta-utils.js'

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
        options[element.id] = element.value.trim();
        break;
      default:
        if (element.tagName === 'SELECT') {
          options[element.id] = element.value;
        }else{
          console.log('[ThunderAI] Unhandled input type:', element.type);
        }
    }

  browser.storage.sync.set(options);
}

function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      switch (element.type) {
        case 'checkbox':
          element.checked = result[element.id] || false;
          break;
        case 'number':
          let default_number_value = 0;
          if(element.id == 'chatgpt_win_height') default_number_value = prefs_default.chatgpt_win_height;
          if(element.id == 'chatgpt_win_width') default_number_value = prefs_default.chatgpt_win_width;
          element.value = result[element.id] || default_number_value;
          break;
        case 'text':
          let default_text_value = '';
          if(element.id == 'default_chatgpt_lang') default_text_value = getLanguageDisplayName(browser.i18n.getUILanguage());
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
          let default_select_value = '';
          if(element.id == 'reply_type') default_select_value = 'reply_all';
          element.value = result[element.id] || default_select_value;
          if (element.value === '') {
            element.selectedIndex = -1;
          }
        }else{
          console.log('[ThunderAI] Unhandled input type:', element.type);
        }
      }
    });
  }

  function onError(error) {
    console.log(`[ThunderAI] Error: ${error}`);
  }

  let getting = browser.storage.sync.get(null);
  getting.then(setCurrentChoice, onError);
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  i18n.updateDocument();
  document.querySelectorAll(".option-input").forEach(element => {
    element.addEventListener("change", saveOptions);
  });
  document.getElementById('btnManagePrompts').addEventListener('click', () => {
    // check if the tab is already there
    browser.tabs.query({url: browser.runtime.getURL('../customprompts/mzta-custom-prompts.html')}).then((tabs) => {
      if (tabs.length > 0) {
        // if the tab is already there, focus it
        browser.tabs.update(tabs[0].id, {active: true});
      } else {
        // if the tab is not there, create it
        browser.tabs.create({url: browser.runtime.getURL('../customprompts/mzta-custom-prompts.html')});
      }
    })
  });
}, { once: true });
