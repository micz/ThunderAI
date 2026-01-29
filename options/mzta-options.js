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

import { prefs_default, getDynamicSettingsDefaults } from './mzta-options-default.js';
import { taLogger } from '../js/mzta-logger.js';
import {
  ChatGPTWeb_models,
  checkSparksPresence,
  isThunderbird128OrGreater,
  openTab,
  getChatGPTWebModelsList_HTML,
  isAPIKeyValue,
  getConnectionType,
} from '../js/mzta-utils.js';
import {
  injectConnectionUI,
  varConnectionUI,
  showConnectionOptions,
  updateWarnings
} from '../pages/_lib/connection-ui.js';

let taLog = new taLogger("mzta-options",true);
let _isThunderbird128OrGreater = true;

function saveOptions(e) {
  e.preventDefault();
  let options = {};
  let element = e.target;

    switch (element.type) {
      case 'checkbox':
        options[element.id] = element.checked;
        taLog.log('Saving option: ' + element.id + ' = ' + element.checked);
        break;
      case 'number':
        options[element.id] = element.valueAsNumber;
        taLog.log('Saving option: ' + element.id + ' = ' + element.valueAsNumber);
        break;
      case 'text':
        options[element.id] = element.value.trim();
        taLog.log('Saving option: ' + element.id + ' = ' + element.value);
        break;
      case 'password':
        options[element.id] = element.value.trim();
        taLog.log('Saving option: ' + element.id + ' = *********');
        break;
      case 'select-one':
        options[element.id] = element.value;
        taLog.log('Saving option: ' + element.id + ' = ' + element.value);
        break;
      case 'textarea':
        options[element.id] = element.value.trim();
        taLog.log('Saving option: ' + element.id + ' = ' + element.value.trim());
        break;
      default:
          console.error("[ThunderAI] Unhandled input type:", element.type);
    }

  browser.storage.sync.set(options);
}

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
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
        case 'select-one':
          let default_select_value = '';
          if(element.id == 'reply_type') default_select_value = 'reply_all';
          if(element.id == 'connection_type') default_select_value = 'chatgpt_web';
          element.value = result[element.id] || default_select_value;
          if (element.value === '') {
            element.selectedIndex = -1;
          }
          break;
        case 'textarea':
          element.value = result[element.id];
          break;
        default:
          console.error("[ThunderAI] Unhandled input type:", element.type);
      }
    });
  }

  let getting = await browser.storage.sync.get(prefs_default);
  setCurrentChoice(getting);
}

function disable_MaxPromptLength(){
  let maxPromptLength = document.getElementById('max_prompt_length');
  let conntype_select = document.getElementById("connection_type");
  maxPromptLength.disabled = (conntype_select.value === "chatgpt_web");
  let maxPromptLength_tr = document.getElementById('max_prompt_length_tr');
  maxPromptLength_tr.style.display = (maxPromptLength.disabled) ? 'none' : 'table-row';
}

function disable_AddTags(prefs_opt){
  let add_tags = document.getElementById('add_tags');
  let conntype_select = document.getElementById("connection_type");
  const tempPrefs = {
      connection_type: conntype_select.value,
      ...prefs_opt
  };
  let add_tags_disabled = (getConnectionType(tempPrefs, null, 'add_tags') === "chatgpt_web");
  // console.log('>>>>>>>>>>>>> add_tags_disabled: ' + add_tags_disabled);
  add_tags.checked = add_tags_disabled ? false : add_tags.checked;
  let add_tags_checked_original = add_tags.checked;
  if(!add_tags.checked){
    let add_tags_info_btn = document.getElementById('btnManageTagsInfo');
    add_tags_info_btn.disabled = 'disabled';
  }
  let add_tags_warn_API_needed = document.getElementById('add_tags_warn_API_needed');
  add_tags_warn_API_needed.style.display = (add_tags_disabled) ? 'inline-block' : 'none';
  if(add_tags_checked_original != add_tags.checked){
    browser.storage.sync.set({add_tags: add_tags.checked});
  }
}

function disable_SpamFilter(prefs_opt){
  let spamfilter = document.getElementById('spamfilter');
  let conntype_select = document.getElementById("connection_type");
  const tempPrefs = {
      connection_type: conntype_select.value,
      ...prefs_opt
  };
  let spamfilter_disabled = (getConnectionType(tempPrefs, null, 'spamfilter') === "chatgpt_web");
  let spamfilter_checked_original = spamfilter.checked;
  spamfilter.checked = spamfilter_disabled ? false : spamfilter.checked;
  if(!spamfilter.checked){
    let spamfilter_info_btn = document.getElementById('btnManageSpamFilterInfo');
    spamfilter_info_btn.disabled = 'disabled';
  }
  let spamfilter_warn_API_needed = document.getElementById('spamfilter_warn_API_needed');
  spamfilter_warn_API_needed.style.display = (spamfilter_disabled) ? 'inline-block' : 'none';
  if(spamfilter_checked_original != spamfilter.checked){
    browser.storage.sync.set({spamfilter: spamfilter.checked});
  }
}

function disable_Summarize(prefs_opt){
  let summarize = document.getElementById('summarize');
  let conntype_select = document.getElementById("connection_type");
  const tempPrefs = {
      connection_type: conntype_select.value,
      ...prefs_opt
  };
  let summarize_disabled = (getConnectionType(tempPrefs, null, 'summarize') === "chatgpt_web");
  let summarize_checked_original = summarize.checked;
  summarize.checked = summarize_disabled ? false : summarize.checked;
  if(!summarize.checked){
    let summarize_info_btn = document.getElementById('btnManageSummarizeInfo');
    summarize_info_btn.disabled = 'disabled';
  }
  let summarize_warn_API_needed = document.getElementById('summarize_warn_API_needed');
  summarize_warn_API_needed.style.display = (summarize_disabled) ? 'inline-block' : 'none';
  if(summarize_checked_original != summarize.checked){
    browser.storage.sync.set({summarize: summarize.checked});
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

function resetMaxPromptLength(){
  let maxPromptLength = document.getElementById('max_prompt_length');
  maxPromptLength.value = prefs_default.max_prompt_length;
  browser.storage.sync.set({max_prompt_length: prefs_default.max_prompt_length});
}  

document.addEventListener('DOMContentLoaded', async () => {
  await injectConnectionUI({
    afterTrId: 'connection_ui_anchor',
    selectId: 'connection_type',
    taLog: taLog
  });
  
  await restoreOptions();

  varConnectionUI.permission_all_urls = await messenger.permissions.contains({ origins: ["<all_urls>"] })

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
        let granted = await messenger.permissions.request({ permissions: ["messagesMove", "messagesUpdate"] });
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

  let summarize_el = document.getElementById('summarize');
  let summarize_info_btn = document.getElementById('btnManageSummarizeInfo');
  summarize_el.addEventListener('click', (event) => {
    summarize_info_btn.disabled = event.target.checked ? '' : 'disabled';
  });
  summarize_info_btn.disabled = summarize_el.checked ? '' : 'disabled';

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
    openTab('/pages/customprompts/mzta-custom-prompts.html');
  });

  document.getElementById('btnManageCustomDataPH').addEventListener('click', () => {
    openTab('/pages/customdataplaceholders/mzta-custom-dataplaceholders.html');
  });

  document.getElementById('btnManageTagsInfo').addEventListener('click', () => {
    openTab('/pages/addtags/mzta-add-tags.html');
  });

  document.getElementById('btnManageSpamFilterInfo').addEventListener('click', () => {
    openTab('/pages/spamfilter/mzta-spamfilter.html');
  });
  
  document.getElementById('btnManageSummarizeInfo').addEventListener('click', () => {
    openTab('/pages/summarize/mzta-summarize.html');
  });

  document.getElementById('btnManageCalendarEventInfo').addEventListener('click', () => {
    openTab('/pages/get-calendar-event/mzta-get-calendar-event.html');
  });

  document.getElementById('btnManageTaskInfo').addEventListener('click', () => {
    openTab('/pages/get-task/mzta-get-task.html');
  });

  getChatGPTWebModelsList_HTML(ChatGPTWeb_models, 'chatgpt_web_models_list');
  document.querySelectorAll(".conntype_chatgpt_web_option").forEach(element => {
    element.addEventListener("click", () => {
      let el = document.getElementById("chatgpt_web_model");
      el.value = element.textContent;
      el.dispatchEvent(new Event('change'), { bubbles: true });
    });
  });

  let prefs_opt = await browser.storage.sync.get({
    ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
  });

  let conntype_select = document.getElementById("connection_type");
  conntype_select.addEventListener("change", disable_MaxPromptLength);
  conntype_select.addEventListener("change", () => disable_AddTags(prefs_opt));
  conntype_select.addEventListener("change", () => disable_SpamFilter(prefs_opt));
  conntype_select.addEventListener("change", () => disable_Summarize(prefs_opt));
  conntype_select.addEventListener("change", disable_GetCalendarEvent);
  
  showConnectionOptions(conntype_select);
  disable_MaxPromptLength();
  disable_AddTags(prefs_opt);
  disable_SpamFilter(prefs_opt);
  disable_Summarize(prefs_opt);
  disable_GetCalendarEvent();

  document.getElementById('reset_max_prompt_length').addEventListener('click', resetMaxPromptLength);

  browser.runtime.getPlatformInfo().then(info => {
    taLog.log("OS: " + info.os);
    if ((info.os === "linux")&&(prefs_opt.chatgpt_win_height!=0)&&(prefs_opt.chatgpt_win_width!=0)){
      document.getElementById('hyprland_warning').style.display = 'table-row';
    }
  });

  updateWarnings();

}, { once: true });
