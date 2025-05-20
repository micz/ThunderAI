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

import { prefs_default } from './mzta-options-default.js';
import { taLogger } from '../js/mzta-logger.js';
import { OpenAI } from '../js/api/openai.js';
import { Ollama } from '../js/api/ollama.js';
import { OpenAIComp } from '../js/api/openai_comp.js'
import { GoogleGemini } from '../js/api/google_gemini.js';
import { Anthropic } from '../js/api/anthropic.js';
import { ChatGPTWeb_models, checkSparksPresence, isThunderbird128OrGreater, openTab, sanitizeChatGPTModelData, sanitizeChatGPTWebCustomData, validateCustomData_ChatGPTWeb, getChatGPTWebModelsList_HTML } from '../js/mzta-utils.js';

let taLog = new taLogger("mzta-options",true);
let _isThunderbird128OrGreater = true;
let permission_all_urls = false;

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
        } else if (element.tagName === 'TEXTAREA') {
          options[element.id] = element.value.trim();
        } else {
          console.error("[ThunderAI] Unhandled input type:", element.type);
        }
    }

  browser.storage.sync.set(options);
}

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      taLog.log("Options restoring " + element.id + " = " + (element.id=="chatgpt_api_key" || element.id=="openai_comp_api_key" || element.id=="google_gemini_api_key" || element.id=="anthropic_api_key" ? "****************" : result[element.id]));
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
        } else if (element.tagName === 'TEXTAREA') {
          element.value = result[element.id];
        }else{
          console.error("[ThunderAI] Unhandled input type:", element.type);
        }
      }
    });
  }

  let getting = await browser.storage.sync.get(prefs_default);
  setCurrentChoice(getting);
}

function showConnectionOptions() {
  disable_MaxPromptLength();
  disable_AddTags();
  disable_SpamFilter();
  disable_GetCalendarEvent();
  let chatgpt_web_display = 'table-row';
  let chatgpt_api_display = 'none';
  let ollama_api_display = 'none';
  let openai_comp_api_display = 'none';
  let google_gemini_api_display = 'none';
  let anthropic_api_display = 'none';
  let conntype_select = document.getElementById("connection_type");
  let parent = conntype_select.parentElement.parentElement.parentElement;
  parent.classList.toggle("conntype_chatgpt_web", (conntype_select.value === "chatgpt_web"));
  parent.classList.toggle("conntype_chatgpt_api", (conntype_select.value === "chatgpt_api"));
  parent.classList.toggle("conntype_ollama_api", (conntype_select.value === "ollama_api"));
  parent.classList.toggle("conntype_openai_comp_api", (conntype_select.value === "openai_comp_api"));
  parent.classList.toggle("conntype_google_gemini_api", (conntype_select.value === "google_gemini_api"));
  parent.classList.toggle("conntype_anthropic_api", (conntype_select.value === "anthropic_api"));
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
  if (conntype_select.value === "ollama_api") {
    ollama_api_display = 'table-row';
  }else{
    ollama_api_display = 'none';
  }
  if (conntype_select.value === "openai_comp_api") {
    openai_comp_api_display = 'table-row';
  }else{
    openai_comp_api_display = 'none';
  }
  if (conntype_select.value === "google_gemini_api") {
    google_gemini_api_display = 'table-row';
  }else{
    google_gemini_api_display = 'none';
  }
  if (conntype_select.value === "anthropic_api") {
    anthropic_api_display = 'table-row';
  }else{
    anthropic_api_display = 'none';
  }
  document.querySelectorAll(".conntype_chatgpt_web").forEach(element => {
    element.style.display = chatgpt_web_display;
  });
  document.querySelectorAll(".conntype_chatgpt_api").forEach(element => {
    element.style.display = chatgpt_api_display;
  });
  document.querySelectorAll(".conntype_ollama_api").forEach(element => {
    element.style.display = ollama_api_display;
  });
  document.querySelectorAll(".conntype_openai_comp_api").forEach(element => {
    element.style.display = openai_comp_api_display;
  });
  document.querySelectorAll(".conntype_google_gemini_api").forEach(element => {
    element.style.display = google_gemini_api_display;
  });
  document.querySelectorAll(".conntype_anthropic_api").forEach(element => {
    element.style.display = anthropic_api_display;
  });
  if (permission_all_urls) {
    document.getElementById('openai_comp_api_cors_warning').style.display = 'none';
    document.getElementById('ollama_api_cors_warning').style.display = 'none';
  }
}

function warn_ChatGPT_APIKeyEmpty() {
  let apiKeyInput = document.getElementById('chatgpt_api_key');
  let btnFetchChatGPTModels = document.getElementById('btnUpdateChatGPTModels');
  let modelChatGPT = document.getElementById('chatgpt_model');
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchChatGPTModels.disabled = true;
    modelChatGPT.disabled = true;
    modelChatGPT.selectedIndex = -1;
    modelChatGPT.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchChatGPTModels.disabled = false;
    modelChatGPT.disabled = false;
    if((modelChatGPT.selectedIndex === -1)||(modelChatGPT.value === '')){
      modelChatGPT.style.border = '2px solid red';
    }else{
      modelChatGPT.style.border = '';
    }
  }
}

function warn_GoogleGemini_APIKeyEmpty() {
  let apiKeyInput = document.getElementById('google_gemini_api_key');
  let btnFetchGoogleGeminiModels = document.getElementById('btnUpdateGoogleGeminiModels');
  let modelGoogleGemini = document.getElementById('google_gemini_model');
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchGoogleGeminiModels.disabled = true;
    modelGoogleGemini.disabled = true;
    modelGoogleGemini.selectedIndex = -1;
    modelGoogleGemini.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchGoogleGeminiModels.disabled = false;
    modelGoogleGemini.disabled = false;
    if((modelGoogleGemini.selectedIndex === -1)||(modelGoogleGemini.value === '')){
      modelGoogleGemini.style.border = '2px solid red';
    }else{
      modelGoogleGemini.style.border = '';
    }
  }
}

function warn_Ollama_HostEmpty() {
  let hostInput = document.getElementById('ollama_host');
  let btnFetchOllamaModels = document.getElementById('btnUpdateOllamaModels');
  let modelOllama = document.getElementById('ollama_model');
  if(hostInput.value === ''){
    hostInput.style.border = '2px solid red';
    btnFetchOllamaModels.disabled = true;
    modelOllama.disabled = true;
    modelOllama.selectedIndex = -1;
    modelOllama.style.border = '';
  }else{
    hostInput.style.border = '';
    btnFetchOllamaModels.disabled = false;
    modelOllama.disabled = false;
    if((modelOllama.selectedIndex === -1)||(modelOllama.value === '')){
      modelOllama.style.border = '2px solid red';
    }else{
      modelOllama.style.border = '';
    }
  }
}

function warn_OpenAIComp_HostEmpty() {
  let hostInput = document.getElementById('openai_comp_host');
  let btnUpdateOpenAICompModels = document.getElementById('btnUpdateOpenAICompModels');
  let modelOpenAIComp = document.getElementById('openai_comp_model');
  if(hostInput.value === ''){
    hostInput.style.border = '2px solid red';
    btnUpdateOpenAICompModels.disabled = true;
    modelOpenAIComp.disabled = true;
    modelOpenAIComp.selectedIndex = -1;
    modelOpenAIComp.style.border = '';
  }else{
    hostInput.style.border = '';
    btnUpdateOpenAICompModels.disabled = false;
    modelOpenAIComp.disabled = false;
    if((modelOpenAIComp.selectedIndex === -1)||(modelOpenAIComp.value === '')){
      modelOpenAIComp.style.border = '2px solid red';
    }else{
      modelOpenAIComp.style.border = '';
    }
  }
}

function warn_Anthropic_APIKeyEmpty() {
  let apiKeyInput = document.getElementById('anthropic_api_key');
  let btnFetchAnthropicModels = document.getElementById('btnUpdateAnthropicModels');
  let modelAnthropic = document.getElementById('anthropic_model');
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchAnthropicModels.disabled = true;
    modelAnthropic.disabled = true;
    modelAnthropic.selectedIndex = -1;
    modelAnthropic.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchAnthropicModels.disabled = false;
    modelAnthropic.disabled = false;
    if((modelAnthropic.selectedIndex === -1)||(modelAnthropic.value === '')){
      modelAnthropic.style.border = '2px solid red';
    }else{
      modelAnthropic.style.border = '';
    }
  }
}

function warn_Anthropic_VersionEmpty() {
  let versionInput = document.getElementById('anthropic_version');
  let btnFetchAnthropicModels = document.getElementById('btnUpdateAnthropicModels');
  let modelAnthropic = document.getElementById('anthropic_model');
  if(versionInput.value === ''){
    versionInput.style.border = '2px solid red';
    btnFetchAnthropicModels.disabled = true;
    modelAnthropic.disabled = true;
    modelAnthropic.selectedIndex = -1;
    modelAnthropic.style.border = '';
  }else{
    versionInput.style.border = '';
    btnFetchAnthropicModels.disabled = false;
    modelAnthropic.disabled = false;
    if((modelAnthropic.selectedIndex === -1)||(modelAnthropic.value === '')){
      modelAnthropic.style.border = '2px solid red';
    }else{
      modelAnthropic.style.border = '';
    }
  }
}

function disable_MaxPromptLength(){
  let maxPromptLength = document.getElementById('max_prompt_length');
  let conntype_select = document.getElementById("connection_type");
  maxPromptLength.disabled = (conntype_select.value === "chatgpt_web");
  let maxPromptLength_tr = document.getElementById('max_prompt_length_tr');
  maxPromptLength_tr.style.display = (maxPromptLength.disabled) ? 'none' : 'table-row';
}

function disable_AddTags(){
  let add_tags = document.getElementById('add_tags');
  let conntype_select = document.getElementById("connection_type");
  add_tags.disabled = (conntype_select.value === "chatgpt_web");
  add_tags.checked = add_tags.disabled ? false : add_tags.checked;
  let add_tags_checked_original = add_tags.checked;
  if(!add_tags.checked){
    let add_tags_info_btn = document.getElementById('btnManageTagsInfo');
    add_tags_info_btn.disabled = 'disabled';
  }
  let add_tags_tr_elements = document.querySelectorAll('.add_tags_tr');
  add_tags_tr_elements.forEach(add_tags_tr => {
    add_tags_tr.style.display = (add_tags.disabled) ? 'none' : 'table-row';
  });
  if(add_tags_checked_original != add_tags.checked){
    browser.storage.sync.set({add_tags: add_tags.checked});
  }
}

function disable_SpamFilter(){
  let spamfilter = document.getElementById('spamfilter');
  let conntype_select = document.getElementById("connection_type");
  spamfilter.disabled = (conntype_select.value === "chatgpt_web");
  let spamfilter_checked_original = spamfilter.checked;
  spamfilter.checked = spamfilter.disabled ? false : spamfilter.checked;
  if(!spamfilter.checked){
    let spamfilter_info_btn = document.getElementById('btnManageSpamFilterInfo');
    spamfilter_info_btn.disabled = 'disabled';
  }
  let spamfilter_tr_elements = document.querySelectorAll('.spamfilter_tr');
  spamfilter_tr_elements.forEach(spamfilter_tr => {
    spamfilter_tr.style.display = (spamfilter.disabled) ? 'none' : 'table-row';
  });
  if(spamfilter_checked_original != spamfilter.checked){
    browser.storage.sync.set({spamfilter: spamfilter.checked});
  }
}

async function disable_GetCalendarEvent(){
  let get_calendar_event = document.getElementById('get_calendar_event');
  let get_task = document.getElementById('get_task');
  let no_sparks_tr = document.getElementById('no_sparks');
  let no_sparks_text = document.getElementById('no_sparks_text');
  let wrong_sparks_text = document.getElementById('wrong_sparks_text');
  let is_spark_present = await checkSparksPresence();
  let conntype_select = document.getElementById("connection_type");
  get_calendar_event.disabled = (conntype_select.value === "chatgpt_web") || !(is_spark_present == 1);
  get_task.disabled = (conntype_select.value === "chatgpt_web") || !(is_spark_present == 1);
  let get_calendar_event_tr_elements = document.querySelectorAll('.get_calendar_event_tr');
  get_calendar_event_tr_elements.forEach(get_calendar_event_tr => {
    get_calendar_event_tr.style.display = get_calendar_event.disabled ? 'none' : 'table-row';
  });
  let get_task_tr_elements = document.querySelectorAll('.get_task_tr');
  get_task_tr_elements.forEach(get_task_tr => {
    get_task_tr.style.display = get_task.disabled ? 'none' : 'table-row';
  });
  no_sparks_tr.style.display = ((is_spark_present == 1) || (conntype_select.value === "chatgpt_web")) ? 'none' : 'table-row';
  no_sparks_text.style.display = (is_spark_present == -1) ? 'inline' : 'none';
  wrong_sparks_text.style.display = (is_spark_present == 0) ? 'inline' : 'none';
}
  

document.addEventListener('DOMContentLoaded', async () => {
  await restoreOptions();

  permission_all_urls = await messenger.permissions.contains({ origins: ["<all_urls>"] })

  _isThunderbird128OrGreater = await isThunderbird128OrGreater();

  // show Owl warning
  const accountList = await messenger.accounts.list(false);
  if(accountList.some(account => account.type.toLowerCase().includes('owl'))) {
    taLog.log('OWL detected, displaying the warning.');
    document.getElementById('owl_warning').style.display = 'table-row';
  }

  i18n.updateDocument();
  document.querySelectorAll(".option-input").forEach(element => {
    element.addEventListener("change", saveOptions);
  });
  
  let addtags_el = document.getElementById('add_tags');
  let addtags_info_btn = document.getElementById('btnManageTagsInfo');
  addtags_el.addEventListener('click', (event) => {
    async function _addtags_el_change() {
      if (event.target.checked) {
        let granted = false;
        if(_isThunderbird128OrGreater){
          granted = await messenger.permissions.request({ permissions: ["messagesTags", "messagesUpdate"] });
        }else{
          granted = await messenger.permissions.request({ permissions: ["messagesTags"] });
        }
        if (!granted) {
          event.target.checked = false;
          addtags_info_btn.disabled = 'disabled';
          browser.storage.sync.set({add_tags: false});
        }
      }
    }
    _addtags_el_change();
    addtags_info_btn.disabled = event.target.checked ? '' : 'disabled';
  });
  addtags_info_btn.disabled = addtags_el.checked ? '' : 'disabled';

  let spamfilter_el = document.getElementById('spamfilter');
  let spamfilter_info_btn = document.getElementById('btnManageSpamFilterInfo');
  spamfilter_el.addEventListener('click', (event) => {
    async function _spamfilter_el_change() {
      if (event.target.checked) {
        let granted = await messenger.permissions.request({ permissions: ["messagesMove"] });
        if (!granted) {
          event.target.checked = false;
          spamfilter_info_btn.disabled = 'disabled';
          browser.storage.sync.set({spamfilter: false});
        }
      }
    }
    _spamfilter_el_change();
    spamfilter_info_btn.disabled = event.target.checked ? '' : 'disabled';
  });
  spamfilter_info_btn.disabled = spamfilter_el.checked ? '' : 'disabled';

  let get_calendar_event_el = document.getElementById('get_calendar_event');
  let get_calendar_event_info_btn = document.getElementById('btnManageCalendarEventInfo');
  get_calendar_event_el.addEventListener('click', (event) => {
    get_calendar_event_info_btn.disabled = event.target.checked ? '' : 'disabled';
  });
  get_calendar_event_info_btn.disabled = get_calendar_event_el.checked ? '' : 'disabled';

  let get_task_el = document.getElementById('get_task');
  let get_task_info_btn = document.getElementById('btnManageTaskInfo');
  get_task_el.addEventListener('click', (event) => {
    get_task_info_btn.disabled = event.target.checked ? '' : 'disabled';
  });
  get_task_info_btn.disabled = get_task_el.checked ? '' : 'disabled';
  
  document.getElementById('btnManagePrompts').addEventListener('click', () => {
    openTab('../pages/customprompts/mzta-custom-prompts.html');
  });

  document.getElementById('btnManageTagsInfo').addEventListener('click', () => {
    openTab('../pages/addtags/mzta-add-tags.html');
  });

  document.getElementById('btnManageSpamFilterInfo').addEventListener('click', () => {
    openTab('../pages/spamfilter/mzta-spamfilter.html');
  });

  document.getElementById('btnManageCalendarEventInfo').addEventListener('click', () => {
    openTab('../pages/get-calendar-event/mzta-get-calendar-event.html');
  });

  document.getElementById('btnManageTaskInfo').addEventListener('click', () => {
    openTab('../pages/get-task/mzta-get-task.html');
  });

  document.getElementById('btnOpenAICompForceModel').addEventListener('click', () => {
    let modelName = prompt(browser.i18n.getMessage('OpenAIComp_force_model_ask')).trim();
    if ((modelName !== null) && (modelName !== undefined) && (modelName !== '')) {
      let select_openai_comp_model = document.getElementById('openai_comp_model');
      let option = document.createElement('option');
      option.value = modelName;
      option.text = modelName;
      select_openai_comp_model.appendChild(option);
      select_openai_comp_model.value = modelName;
      select_openai_comp_model.dispatchEvent(new Event('change', { bubbles: true }));    
    }
  });

  document.getElementById('btnGiveAllUrlsPermission_ollama_api').addEventListener('click', async () => {
    permission_all_urls = await messenger.permissions.request({ origins: ["<all_urls>"] });
  });

  document.getElementById('btnGiveAllUrlsPermission_openai_comp_api').addEventListener('click', async () => {
    permission_all_urls = await messenger.permissions.request({ origins: ["<all_urls>"] });
  });

  getChatGPTWebModelsList_HTML(ChatGPTWeb_models, 'chatgpt_web_models_list');
  document.querySelectorAll(".conntype_chatgpt_web_option").forEach(element => {
    element.addEventListener("click", () => {
      let el = document.getElementById("chatgpt_web_model");
      el.value = element.textContent;
      el.dispatchEvent(new Event('change'), { bubbles: true });
    });
  });

  let conntype_select = document.getElementById("connection_type");
  conntype_select.addEventListener("change", showConnectionOptions);
  conntype_select.addEventListener("change", warn_ChatGPT_APIKeyEmpty);
  conntype_select.addEventListener("change", warn_Ollama_HostEmpty);
  conntype_select.addEventListener("change", warn_OpenAIComp_HostEmpty);
  conntype_select.addEventListener("change", warn_GoogleGemini_APIKeyEmpty);
  conntype_select.addEventListener("change", warn_Anthropic_APIKeyEmpty);
  conntype_select.addEventListener("change", warn_Anthropic_VersionEmpty);
  conntype_select.addEventListener("change", disable_AddTags);
  conntype_select.addEventListener("change", disable_SpamFilter);
  conntype_select.addEventListener("change", disable_GetCalendarEvent);
  document.getElementById("chatgpt_api_key").addEventListener("change", warn_ChatGPT_APIKeyEmpty);
  document.getElementById("ollama_host").addEventListener("change", warn_Ollama_HostEmpty);
  document.getElementById("openai_comp_host").addEventListener("change", warn_OpenAIComp_HostEmpty);
  document.getElementById("google_gemini_api_key").addEventListener("change", warn_GoogleGemini_APIKeyEmpty);
  document.getElementById("chatgpt_web_project").addEventListener("input", validateCustomData_ChatGPTWeb);
  document.getElementById("chatgpt_web_custom_gpt").addEventListener("input", validateCustomData_ChatGPTWeb);
  document.getElementById("anthropic_api_key").addEventListener("change", warn_Anthropic_APIKeyEmpty);
  document.getElementById("anthropic_version").addEventListener("change", warn_Anthropic_VersionEmpty);

  let prefs = await browser.storage.sync.get({chatgpt_web_model: '', chatgpt_model: '', ollama_model: '', openai_comp_model: '', google_gemini_model: '', anthropic_model: '', anthropic_version: '', chatgpt_win_height: 0, chatgpt_win_width: 0 });
  
  // OpenAI API ChatGPT model fetching
  let select_chatgpt_model = document.getElementById('chatgpt_model');
  const chatgpt_option = document.createElement('option');
  chatgpt_option.value = prefs.chatgpt_model;
  chatgpt_option.text = prefs.chatgpt_model;
  select_chatgpt_model.appendChild(chatgpt_option);
  select_chatgpt_model.addEventListener("change", warn_ChatGPT_APIKeyEmpty);

  document.getElementById('btnUpdateChatGPTModels').addEventListener('click', async () => {
    document.getElementById('chatgpt_model_fetch_loading').style.display = 'inline';
    let openai = new OpenAI(document.getElementById("chatgpt_api_key").value, '', true);
    openai.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById('chatgpt_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("ChatGPT_Models_Error_fetching"));
        alert(browser.i18n.getMessage("ChatGPT_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("ChatGPT models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_chatgpt_model.options).some(option => option.value === model.id)) {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.id;
          select_chatgpt_model.appendChild(option);
        }
      });
      document.getElementById('chatgpt_model_fetch_loading').style.display = 'none';
    });
    
    warn_ChatGPT_APIKeyEmpty();
  });

  // Google Gemini API model fetching
  let select_google_gemini_model = document.getElementById('google_gemini_model');
  const google_gemini_option = document.createElement('option');
  google_gemini_option.value = prefs.google_gemini_model;
  google_gemini_option.text = prefs.google_gemini_model;
  select_google_gemini_model.appendChild(google_gemini_option);
  select_google_gemini_model.addEventListener("change", warn_GoogleGemini_APIKeyEmpty);

  document.getElementById('btnUpdateGoogleGeminiModels').addEventListener('click', async () => {
    document.getElementById('google_gemini_model_fetch_loading').style.display = 'inline';
    let google_gemini = new GoogleGemini(document.getElementById("google_gemini_api_key").value, '', true);
    google_gemini.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById('google_gemini_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("GoogleGemini_Models_Error_fetching"));
        alert(browser.i18n.getMessage("GoogleGemini_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("GoogleGemini models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_google_gemini_model.options).some(option => option.value === model.name.substring(model.name.lastIndexOf("/") + 1))) {
          const option = document.createElement('option');
          option.value = model.name.substring(model.name.lastIndexOf("/") + 1);
          option.text = model.displayName;
          select_google_gemini_model.appendChild(option);
        }
      });
      document.getElementById('google_gemini_model_fetch_loading').style.display = 'none';
    });
    
    warn_GoogleGemini_APIKeyEmpty();
  });

  // Ollama API Model fetching
  let select_ollama_model = document.getElementById('ollama_model');
  const ollama_option = document.createElement('option');
  ollama_option.value = prefs.ollama_model;
  ollama_option.text = prefs.ollama_model;
  select_ollama_model.appendChild(ollama_option);
  select_ollama_model.addEventListener("change", warn_Ollama_HostEmpty);

  document.getElementById('btnUpdateOllamaModels').addEventListener('click', async () => {
    document.getElementById('ollama_model_fetch_loading').style.display = 'inline';
    let ollama = new Ollama(document.getElementById("ollama_host").value, true);
    try {
      let data = await ollama.fetchModels();
      if(!data){
        document.getElementById('ollama_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        return;
      }
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById('ollama_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      if(data.response.models.length == 0){
        document.getElementById('ollama_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + browser.i18n.getMessage("API_Models_Error_NoModels"));
        return;
      }
      taLog.log("Ollama models: " + JSON.stringify(data));
      data.response.models.forEach(model => {
        if (!Array.from(select_ollama_model.options).some(option => option.value === model.model)) {
          const option = document.createElement('option');
          option.value = model.model;
          option.text = model.name + " (" + model.model + ")";
          select_ollama_model.appendChild(option);
        }
      });
      document.getElementById('ollama_model_fetch_loading').style.display = 'none';
    } catch (error) {
      document.getElementById('ollama_model_fetch_loading').style.display = 'none';
      taLog.error(browser.i18n.getMessage("Ollama_Models_Error_fetching"));
      alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + error.message);
    }
    
    warn_Ollama_HostEmpty();
  });


  // OpenAI Comp API Model fetching
  let select_openai_comp_model = document.getElementById('openai_comp_model');
  const openai_comp_option = document.createElement('option');
  openai_comp_option.value = prefs.openai_comp_model;
  openai_comp_option.text = prefs.openai_comp_model;
  select_openai_comp_model.appendChild(openai_comp_option);
  select_openai_comp_model.addEventListener("change", warn_OpenAIComp_HostEmpty);

  document.getElementById('btnUpdateOpenAICompModels').addEventListener('click', async () => {
    document.getElementById('openai_comp_model_fetch_loading').style.display = 'inline';
    let openai_comp = new OpenAIComp(document.getElementById("openai_comp_host").value , null, document.getElementById("openai_comp_api_key").value, true, document.getElementById("openai_comp_use_v1").checked);
    openai_comp.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById('openai_comp_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("OpenAIComp_Models_Error_fetching"));
        alert(browser.i18n.getMessage("OpenAIComp_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("OpenAIComp models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_openai_comp_model.options).some(option => option.value === model.id)) {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.id;
          select_openai_comp_model.appendChild(option);
        }
      });
      document.getElementById('openai_comp_model_fetch_loading').style.display = 'none';
    });
    
    warn_OpenAIComp_HostEmpty();
  });

   // Anthropic API model fetching
  let select_anthropic_model = document.getElementById('anthropic_model');
  const anthropic_option = document.createElement('option');
  anthropic_option.value = prefs.anthropic_model;
  anthropic_option.text = prefs.anthropic_model;
  select_anthropic_model.appendChild(anthropic_option);
  select_anthropic_model.addEventListener("change", warn_Anthropic_APIKeyEmpty);
  select_anthropic_model.addEventListener("change", warn_Anthropic_VersionEmpty);

  document.getElementById('btnUpdateAnthropicModels').addEventListener('click', async () => {
    document.getElementById('anthropic_model_fetch_loading').style.display = 'inline';
    let anthropic = new Anthropic(document.getElementById("anthropic_api_key").value, document.getElementById("anthropic_version").value, '');
    anthropic.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById('anthropic_model_fetch_loading').style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Anthropic_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Anthropic_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("Anthropic models: " + JSON.stringify(data));
      data.response.forEach(model => {
        const existingOption = Array.from(select_anthropic_model.options).find(option => option.value === model.id);
        if (existingOption) {
          existingOption.text = model.display_name + " (" + model.id + ")";
        } else {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.display_name + " (" + model.id + ")";
          select_anthropic_model.appendChild(option);
        }
      });
      document.getElementById('anthropic_model_fetch_loading').style.display = 'none';
    });
    
    warn_Anthropic_APIKeyEmpty();
  });

  showConnectionOptions();
  warn_ChatGPT_APIKeyEmpty();
  warn_Ollama_HostEmpty();
  warn_OpenAIComp_HostEmpty();
  warn_GoogleGemini_APIKeyEmpty();
  warn_Anthropic_APIKeyEmpty();
  warn_Anthropic_VersionEmpty();
  disable_MaxPromptLength();
  disable_AddTags();
  disable_SpamFilter();
  disable_GetCalendarEvent();

  const passwordField_chatgpt_api_key = document.getElementById('chatgpt_api_key');
  const toggleIcon_chatgpt_api_key = document.getElementById('toggle_chatgpt_api_key');
  const icon_img_chatgpt_api_key = document.getElementById('pwd-icon_chatgpt_api_key');

  toggleIcon_chatgpt_api_key.addEventListener('click', () => {
      const type = passwordField_chatgpt_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_chatgpt_api_key.setAttribute('type', type);

      icon_img_chatgpt_api_key.src = type === 'password' ? "../images/pwd-show.png" : "../images/pwd-hide.png";
  });

  const passwordField_google_gemini_api_key = document.getElementById('google_gemini_api_key');
  const toggleIcon_google_gemini_api_key = document.getElementById('toggle_google_gemini_api_key');
  const icon_img_google_gemini_api_key = document.getElementById('pwd-icon_google_gemini_api_key');

  toggleIcon_google_gemini_api_key.addEventListener('click', () => {
      const type = passwordField_google_gemini_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_google_gemini_api_key.setAttribute('type', type);

      icon_img_google_gemini_api_key.src = type === 'password' ? "../images/pwd-show.png" : "../images/pwd-hide.png";
  });

  const passwordField_openai_comp_api_key = document.getElementById('openai_comp_api_key');
  const toggleIcon_openai_comp_api_key = document.getElementById('toggle_openai_comp_api_key');
  const icon_img_openai_comp_api_key = document.getElementById('pwd-icon_openai_comp_api_key');

  toggleIcon_openai_comp_api_key.addEventListener('click', () => {
      const type = passwordField_openai_comp_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_openai_comp_api_key.setAttribute('type', type);

      icon_img_openai_comp_api_key.src = type === 'password' ? "../images/pwd-show.png" : "../images/pwd-hide.png";
  });

  const passwordField_anthropic_api_key = document.getElementById('anthropic_api_key');
  const toggleIcon_anthropic_api_key = document.getElementById('toggle_anthropic_api_key');
  const icon_img_anthropic_api_key = document.getElementById('pwd-icon_anthropic_api_key');

  toggleIcon_anthropic_api_key.addEventListener('click', () => {
      const type = passwordField_anthropic_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_anthropic_api_key.setAttribute('type', type);

      icon_img_anthropic_api_key.src = type === 'password' ? "../images/pwd-show.png" : "../images/pwd-hide.png";
  });

  const btnChatGPTWeb_Tab = document.getElementById('btnChatGPTWeb_Tab');
  btnChatGPTWeb_Tab.addEventListener('click', async () => {
    let prefs_mod = await browser.storage.sync.get({chatgpt_web_model: prefs_default.chatgpt_web_model, chatgpt_web_project: prefs_default.chatgpt_web_project, chatgpt_web_custom_gpt: prefs_default.chatgpt_web_custom_gpt});
    
    let base_url = 'https://chatgpt.com';
    let model_opt = '';
    let webproject_set = false;
    
    if((prefs_mod.chatgpt_web_model != '') && (prefs_mod.chatgpt_web_model != undefined)){
      model_opt = '?model=' + sanitizeChatGPTModelData(prefs_mod.chatgpt_web_model);
    }
    if((prefs_mod.chatgpt_web_project != '') && (prefs_mod.chatgpt_web_project != undefined)){
      base_url += sanitizeChatGPTWebCustomData(prefs_mod.chatgpt_web_project);
      webproject_set = true;
    }
    if(!webproject_set && (prefs_mod.chatgpt_web_custom_gpt != '') && (prefs_mod.chatgpt_web_custom_gpt != undefined)){
      base_url += sanitizeChatGPTWebCustomData(prefs_mod.chatgpt_web_custom_gpt);
    }
    browser.tabs.create({ url: base_url + model_opt });
  });

  browser.runtime.getPlatformInfo().then(info => {
    taLog.log("OS: " + info.os);
    if ((info.os === "linux")&&(prefs.chatgpt_win_height!=0)&&(prefs.chatgpt_win_width!=0)){
      document.getElementById('hyprland_warning').style.display = 'table-row';
    }
  });

}, { once: true });
