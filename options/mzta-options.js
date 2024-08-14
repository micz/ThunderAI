/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
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
import { OpenAI } from '../js/api/openai.js';

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

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      //console.log("[ThunderAI] Options restoring " + element.id + " = " + result[element.id]);
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
          console.log('[ThunderAI] Unhandled input type:', element.type);
        }
      }
    });
  }

  let getting = await browser.storage.sync.get(prefs_default);
  setCurrentChoice(getting);
}

function showConnectionOptions() {
  let chatgpt_web_display = 'table-row';
  let chatgpt_api_display = 'none';
  let conntype_select = document.getElementById("connection_type");
  let parent = conntype_select.parentElement.parentElement.parentElement;
  parent.classList.toggle("conntype_chatgpt_api", (conntype_select.value === "chatgpt_api"));
  parent.classList.toggle("conntype_chatgpt_web", (conntype_select.value === "chatgpt_web"));
  if (conntype_select.value === "chatgpt_web") {
    chatgpt_web_display = 'table-row';
  }else{
    chatgpt_web_display = 'none';
  }
  if (conntype_select.value === "chatgpt_api") {
    chatgpt_api_display = 'table-row';
  }else{
    chatgpt_api_display = 'none';
  }
  document.querySelectorAll(".conntype_chatgpt_web").forEach(element => {
    element.style.display = chatgpt_web_display;
  });
  document.querySelectorAll(".conntype_chatgpt_api").forEach(element => {
    element.style.display = chatgpt_api_display;
  });
}

function warnAPIKeyEmpty() {
  let apiKeyInput = document.getElementById('chatgpt_api_key');
  let btnFetchModels = document.getElementById('btnUpdateChatGPTModels');
  let modelChatGPT = document.getElementById('chatgpt_model');
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchModels.disabled = true;
    modelChatGPT.disabled = true;
    modelChatGPT.selectedIndex = -1;
    modelChatGPT.style.border = 'none';
  }else{
    apiKeyInput.style.border = 'none';
    btnFetchModels.disabled = false;
    modelChatGPT.disabled = false;
    if((modelChatGPT.selectedIndex === -1)||(modelChatGPT.value === '')){
      modelChatGPT.style.border = '2px solid red';
    }else{
      modelChatGPT.style.border = 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await restoreOptions();
  i18n.updateDocument();
  document.querySelectorAll(".option-input").forEach(element => {
    element.addEventListener("change", saveOptions);
  });

  showConnectionOptions();
  
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

  let conntype_select = document.getElementById("connection_type");
  conntype_select.addEventListener("change", showConnectionOptions);
  conntype_select.addEventListener("change", warnAPIKeyEmpty);
  document.getElementById("chatgpt_api_key").addEventListener("change", warnAPIKeyEmpty);

  let prefs = await browser.storage.sync.get({chatgpt_api_key: '', chatgpt_model: ''});
  let select_chatgpt_model = document.getElementById('chatgpt_model');

  const option = document.createElement('option');
  option.value = prefs.chatgpt_model;
  option.text = prefs.chatgpt_model;
  select_chatgpt_model.appendChild(option);

  document.getElementById('btnUpdateChatGPTModels').addEventListener('click', async () => {
    document.getElementById('model_fetch_loading').style.display = 'inline';
    let openai = new OpenAI(document.getElementById("chatgpt_api_key").value, true);
    openai.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail = JSON.parse(data.error);
        document.getElementById('model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("ChatGPT_Models_Error_fetching"));
        alert(browser.i18n.getMessage("ChatGPT_Models_Error_fetching")+": " + errorDetail.error.message);
        return;
      }
      //console.log(">>>>>>>>> ChatGPT models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_chatgpt_model.options).some(option => option.value === model.id)) {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.id;
          select_chatgpt_model.appendChild(option);
        }
      });
      document.getElementById('model_fetch_loading').style.display = 'none';
    })
    
    warnAPIKeyEmpty();
  });
}, { once: true });
