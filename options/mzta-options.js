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
  getDynamicSettingsDefaults,
  getDynamicSettingValue,
  special_prompts_with_integration
} from './mzta-options-default.js';
import { taLogger } from '../js/mzta-logger.js';
import {
  checkSparksPresence,
  openTab,
  isAPIKeyValue,
  getConnectionType,
  hasNoConnectionSelected,
  setTomSelectBorder,
  getMiczItUrl,
  getCacheStorageUsedSpace
} from '../js/mzta-utils.js';
import { taStorage } from '../js/mzta-storage.js';
import {
  injectConnectionUI,
  varConnectionUI,
  showConnectionOptions,
  updateWarnings,
  hasEmptyValueOption
} from '../pages/_lib/connection-ui.js';
import {
  isTestableConnection,
  runConnectionTest
} from '../js/mzta-connection-test.js';

let taLog = new taLogger("mzta-options",true);

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
          if(element.id == 'special_command_timeout') default_number_value = prefs_default.special_command_timeout;
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
          // Without a default this select would restore to '', which matches no
          // option, and the control would render blank.
          if(element.id == 'diff_granularity') default_select_value = prefs_default.diff_granularity;
          // No fallback for connection_type: an empty value means "no connection
          // selected yet" and must stay empty, so the placeholder option shows.
          element.value = result[element.id] || default_select_value;
          // connection_type and the ChatGPT reasoning selects have a dedicated option
          // for the empty value, so let the assignment above select it; every other
          // select has no empty option and must show a blank control instead.
          if (element.value === '' && !hasEmptyValueOption(element.id)) {
            element.selectedIndex = -1;
          }
          if (element.tomselect) {
            element.tomselect.setValue(element.value, true);
            setTomSelectBorder(element.tomselect);
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

function getConnectionTypeLabel(value) {
  const select = document.getElementById('connection_type');
  if (select) {
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) return option.textContent;
  }
  return value;
}

// Per-provider base tint colours (same palette used in mzta-options.css and
// documented in the design). Used to colour the per-feature "specific API"
// indicator pill. A direct map is used (rather than reading a row's computed
// background) because the connection rows are now visually restyled and no
// longer carry a solid per-provider background.
const CONN_TINT_RGB = {
  chatgpt_web:       '180, 83, 14',
  chatgpt_api:       '10, 83, 214',
  google_gemini_api: '150, 120, 12',
  anthropic_api:     '168, 20, 80',
  ollama_api:        '31, 122, 46',
  openai_comp_api:   '122, 43, 191',
};

function getConnectionTypeColor(value) {
  const rgb = CONN_TINT_RGB[value];
  return rgb ? `rgb(${rgb})` : '';
}

function getContrastTextColor(bgColor) {
  const match = bgColor.match(/\d+/g);
  if (!match || match.length < 3) return '';
  const [r, g, b] = match.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#222' : '#eee';
}

function updateSpecificApiIndicators(prefs_opt) {
  for (const prefix of special_prompts_with_integration) {
    const indicator = document.getElementById(`${prefix}_specific_api_indicator`);
    if (!indicator) continue;
    const useSpecific = getDynamicSettingValue(prefs_opt, prefix, 'use_specific_integration');
    if (useSpecific) {
      const connType = getDynamicSettingValue(prefs_opt, prefix, 'connection_type');
      const apiName = getConnectionTypeLabel(connType);
      const bgColor = getConnectionTypeColor(connType);
      indicator.textContent = browser.i18n.getMessage('prefs_specific_api_indicator', [apiName]);
      indicator.style.backgroundColor = bgColor;
      indicator.style.color = getContrastTextColor(bgColor);
      indicator.style.display = 'inline-block';
    } else {
      indicator.textContent = '';
      indicator.style.backgroundColor = '';
      indicator.style.color = '';
      indicator.style.display = 'none';
    }
  }
}

function disable_MaxPromptLength(){
  let maxPromptLength = document.getElementById('max_prompt_length');
  let conntype_select = document.getElementById("connection_type");
  // API-only setting: irrelevant for ChatGPT Web and until a connection is chosen.
  maxPromptLength.disabled = (conntype_select.value === "chatgpt_web") || hasNoConnectionSelected(conntype_select.value);
  let maxPromptLength_tr = document.getElementById('max_prompt_length_tr');
  maxPromptLength_tr.style.display = (maxPromptLength.disabled) ? 'none' : '';
}

// Show the "Manage settings" link for a feature only when its flag is enabled;
// hide it entirely otherwise (previously it was only disabled/greyed out).
function setFeatureManageVisibility(btn, visible){
  if(!btn) return;
  btn.style.display = visible ? '' : 'none';
  btn.disabled = visible ? '' : 'disabled';
}

// Why an API-driven feature can't be used with the current connection:
//   no_connection -> nothing selected yet (the setup wizard banner covers it)
//   chatgpt_web   -> ChatGPT Web has no API
// Both disable the feature, but only chatgpt_web shows the "switch to an API
// integration" hint (warn_API_needed) — that text is about ChatGPT Web and would
// be misleading when no provider has been chosen at all.
function getFeatureConnState(prefs_opt, prefix){
  let conntype_select = document.getElementById("connection_type");
  const tempPrefs = {
      connection_type: conntype_select.value,
      ...prefs_opt
  };
  let effective = getConnectionType(tempPrefs, null, prefix);
  let no_connection = hasNoConnectionSelected(effective);
  return {
    no_connection: no_connection,
    disabled: no_connection || (effective === "chatgpt_web"),
    show_api_warning: (effective === "chatgpt_web")
  };
}

// Shared handling for the four API-driven feature rows (add_tags, spamfilter,
// summarize, translate): they differ only by element ids.
function disable_ApiFeature(prefs_opt, prefix, manageBtnId){
  let checkbox = document.getElementById(prefix);
  if(!checkbox) return;
  let state = getFeatureConnState(prefs_opt, prefix);

  let checked_original = checkbox.checked;
  checkbox.checked = state.disabled ? false : checkbox.checked;
  // With no connection selected the toggle is greyed out: there is nothing to
  // enable the feature against yet.
  checkbox.disabled = state.no_connection;

  setFeatureManageVisibility(document.getElementById(manageBtnId), checkbox.checked);
  let warn = document.getElementById(prefix + '_warn_API_needed');
  if(warn) warn.style.display = state.show_api_warning ? 'inline-block' : 'none';

  if(checked_original != checkbox.checked){
    browser.storage.sync.set({[prefix]: checkbox.checked});
  }
}

function disable_AddTags(prefs_opt){
  disable_ApiFeature(prefs_opt, 'add_tags', 'btnManageTagsInfo');
}

function disable_SpamFilter(prefs_opt){
  disable_ApiFeature(prefs_opt, 'spamfilter', 'btnManageSpamFilterInfo');
}

function disable_Summarize(prefs_opt){
  disable_ApiFeature(prefs_opt, 'summarize', 'btnManageSummarizeInfo');
}

function disable_Translate(prefs_opt){
  disable_ApiFeature(prefs_opt, 'translate', 'btnManageTranslateInfo');
}

async function disable_GetCalendarEvent(){
  let get_calendar_event = document.getElementById('get_calendar_event');
  let get_task = document.getElementById('get_task');
  let no_sparks_tr = document.getElementById('no_sparks');
  let no_sparks_text = document.getElementById('no_sparks_text');
  let wrong_sparks_text = document.getElementById('wrong_sparks_text');
  let is_spark_present = await checkSparksPresence();
  let conntype_select = document.getElementById("connection_type");
  // These features need an API: unavailable with ChatGPT Web and with no connection selected.
  let conn_unusable = (conntype_select.value === "chatgpt_web") || hasNoConnectionSelected(conntype_select.value);
  get_calendar_event.disabled = conn_unusable || !(is_spark_present == 1);
  get_task.disabled = conn_unusable || !(is_spark_present == 1);
  let get_calendar_event_tr_elements = document.querySelectorAll('.get_calendar_event_tr');
  get_calendar_event_tr_elements.forEach(get_calendar_event_tr => {
    get_calendar_event_tr.style.display = get_calendar_event.disabled ? 'none' : '';
  });
  let get_task_tr_elements = document.querySelectorAll('.get_task_tr');
  get_task_tr_elements.forEach(get_task_tr => {
    get_task_tr.style.display = get_task.disabled ? 'none' : '';
  });
  no_sparks_tr.style.display = ((is_spark_present == 1) || conn_unusable) ? 'none' : '';
  no_sparks_text.style.display = (is_spark_present == -1) ? 'inline' : 'none';
  wrong_sparks_text.style.display = (is_spark_present == 0) ? 'inline' : 'none';
}

const CONN_TYPES = ["chatgpt_web", "chatgpt_api", "ollama_api", "openai_comp_api", "google_gemini_api", "anthropic_api"];

// Documentation page behind the "Full guide" link of the provider setup callout.
// Sparse on purpose: only these providers have a dedicated page, so the link is
// hidden for the others rather than pointing somewhere generic.
const CONN_GUIDE_PATH = {
  chatgpt_web: 'thunderbird-addon-thunderai/status/',
  ollama_api:  'thunderbird-addon-thunderai/ollama-cors-information/',
};

function updateDescription(){
  let conntype_select = document.getElementById("connection_type");
  let conntype = conntype_select.value;
  let desc = document.getElementById("miczDescription");
  for(let t of CONN_TYPES){
    desc.querySelectorAll(".conntype_" + t).forEach(el => {
      el.style.display = (conntype === t) ? "" : "none";
    });
  }
  // Tint the provider setup callout (border/background/pill) to the selected provider.
  for(let t of CONN_TYPES){
    desc.classList.toggle("tint_" + t, conntype === t);
  }
  // Point the "Full guide" link at the selected provider's page, or hide it.
  // It is moved inside the active provider's span so it flows inline with that
  // text (and stays within the tinted accent bar) instead of sitting below it.
  let guide_link = document.getElementById("mzta_info_guide");
  if(guide_link){
    let guide_path = CONN_GUIDE_PATH[conntype];
    if(guide_path){
      let active_span = desc.querySelector(".conntype_" + conntype + ".info_specific");
      if(active_span && guide_link.parentElement !== active_span){
        active_span.appendChild(guide_link);
      }
      guide_link.href = getMiczItUrl(guide_path);
      guide_link.style.display = "";
    }else{
      guide_link.style.display = "none";
    }
  }
}

// Show the real shortcut assigned to the ThunderAI menu command, so the chips
// stay correct if the user rebinds it. The static Ctrl/Alt/A chips in the HTML
// are kept as a fallback if the command is unavailable or has been cleared.
async function updateShortcutChips(){
  let keys_container = document.getElementById("mzta_shortcut_keys");
  if(!keys_container) return;
  try{
    let commands = await browser.commands.getAll();
    let command = commands.find(c => c.name === '_thunderai__do_action');
    if(!command || !command.shortcut) return;
    let keys = command.shortcut.split('+').map(k => k.trim()).filter(k => k !== '');
    if(keys.length === 0) return;
    keys_container.textContent = '';
    for(let key of keys){
      let kbd = document.createElement('kbd');
      kbd.textContent = key;
      keys_container.appendChild(kbd);
    }
  }catch(error){
    console.error("[ThunderAI] Unable to read the menu keyboard shortcut: " + error);
  }
}

// Re-tint the connection panel (border/background/pill) and set the provider
// pill name to match the selected connection type.
function updateConnPanelTint(){
  let conntype_select = document.getElementById("connection_type");
  if(!conntype_select) return;
  let conntype = conntype_select.value;
  let panel = document.getElementById("mzta_conn_panel");
  if(panel){
    for(let t of CONN_TYPES){
      panel.classList.toggle("tint_" + t, conntype === t);
    }
  }
  let pillName = document.getElementById("mzta_conn_pill_name");
  if(pillName){
    pillName.textContent = getConnectionTypeLabel(conntype);
  }
}

async function openSetupWizard(){
  await browser.tabs.create({ url: "../pages/setup-wizard/mzta-setup-wizard.html" });
}

// Show the blue "no AI connection selected" banner until the user picks a
// provider. Informational, not a warning: nothing is broken on a fresh install,
// the setup wizard is simply the way in.
// Also hides the per-connection "Advanced options" disclosure, which has nothing
// to disclose while no provider is selected (all its rows belong to a provider),
// and shows a note in the Features section explaining why its toggles are greyed.
function updateNoConnectionBanner(){
  let conntype_select = document.getElementById("connection_type");
  if(!conntype_select) return;
  let no_conn = hasNoConnectionSelected(conntype_select.value);

  let banner = document.getElementById('no_connection_banner');
  if(banner) banner.classList.toggle('shown', no_conn);

  let features_note = document.getElementById('features_no_connection_note');
  if(features_note) features_note.classList.toggle('shown', no_conn);

  let conn_adv_btn = document.getElementById('mzta_conn_adv_btn');
  if(conn_adv_btn) conn_adv_btn.style.display = no_conn ? 'none' : '';
  if(no_conn) resetConnAdv();   // collapse it, so it reopens closed once a provider is picked
}

// Collapse the per-connection advanced disclosure back to its default state
// (advanced panel hidden). Mirrors the app-level disclosure: static label,
// panel toggled below the button.
function resetConnAdv(){
  let btn = document.getElementById('mzta_conn_adv_btn');
  let panel = document.getElementById('connection_ui_adv_table');
  if(!btn || !panel) return;
  btn.setAttribute('aria-expanded', 'false');
  panel.classList.add('hidden');
}

// The advanced rows were moved out of #connection_ui_table into
// #connection_ui_adv_table, so showConnectionOptions() (which is scoped to the
// core table's tbody) no longer toggles their per-provider visibility. Mirror
// that logic here for the advanced table: show only the selected provider's rows.
function showAdvConnectionOptions(){
  let advTable = document.getElementById('connection_ui_adv_table');
  let conntype = document.getElementById('connection_type');
  if(!advTable || !conntype) return;
  advTable.querySelectorAll('tr[class*="conntype_"]').forEach(tr => {
    tr.style.display = tr.classList.contains('conntype_' + conntype.value) ? '' : 'none';
  });
}

// ---- Connection test status strip (Options page only) --------------------
// Non-persistent connectivity check. Reuses the provider fetchModels() logic via
// js/mzta-connection-test.js; reads the current form values and saves nothing.

// Show the strip only for connection types that have a testable endpoint
// (everything except ChatGPT Web). Resets to idle when shown/hidden.
function refreshConnTestVisibility(){
  let strip = document.getElementById('mzta_conn_test');
  if(!strip) return;
  let connType = document.getElementById('connection_type')?.value;
  if(isTestableConnection(connType)){
    strip.style.display = 'flex';
  }else{
    strip.style.display = 'none';
  }
  setConnTestState('idle');
}

// Update the strip's visual state, status text and action link.
// state: 'idle' | 'loading' | 'ok' | 'error'. message: ok→api name, error→detail.
function setConnTestState(state, message){
  let strip = document.getElementById('mzta_conn_test');
  let textEl = document.getElementById('mzta_conn_test_text');
  let linkEl = document.getElementById('mzta_conn_test_link');
  if(!strip || !textEl || !linkEl) return;
  strip.setAttribute('data-state', state);
  switch(state){
    case 'loading':
      textEl.textContent = browser.i18n.getMessage('connTest_testing');
      linkEl.style.display = 'none';
      break;
    case 'ok':
      textEl.textContent = browser.i18n.getMessage('connTest_ok', [message || '']);
      linkEl.textContent = browser.i18n.getMessage('connTest_link_retest');
      linkEl.style.display = '';
      break;
    case 'error':
      textEl.textContent = browser.i18n.getMessage('connTest_error', [message || '']);
      linkEl.textContent = browser.i18n.getMessage('connTest_link_retry');
      linkEl.style.display = '';
      break;
    case 'idle':
    default:
      textEl.textContent = browser.i18n.getMessage('connTest_idle');
      linkEl.textContent = browser.i18n.getMessage('connTest_link_test');
      linkEl.style.display = '';
      break;
  }
}

function resetMaxPromptLength(){
  let maxPromptLength = document.getElementById('max_prompt_length');
  maxPromptLength.value = prefs_default.max_prompt_length;
  browser.storage.sync.set({max_prompt_length: prefs_default.max_prompt_length});
}

function resetSpecialCommandTimeout(){
  let specialCommandTimeout = document.getElementById('special_command_timeout');
  specialCommandTimeout.value = prefs_default.special_command_timeout;
  browser.storage.sync.set({special_command_timeout: prefs_default.special_command_timeout});
}

async function updateCacheSize() {
  let size = await getCacheStorageUsedSpace();
  document.getElementById('cache_storage_size').textContent = size;
}  

document.addEventListener('DOMContentLoaded', async () => {
  await injectConnectionUI({
    afterTrId: 'connection_ui_anchor',
    selectId: 'connection_type',
    taLog: taLog
  });

  // Relocate the advanced connection rows into a separate table that sits below
  // the "Advanced options" disclosure button, so expanding it opens the fields
  // BELOW the button (button stays fixed) — mirroring the app-level disclosure.
  // showConnectionOptions() queries the whole #mzta_conn_panel, so per-provider
  // visibility still works after the move.
  let conn_adv_body = document.querySelector('#connection_ui_adv_table tbody');
  if(conn_adv_body){
    document.querySelectorAll('#connection_ui_table tr.conn_adv').forEach(tr => conn_adv_body.appendChild(tr));
  }
  // Keep the moved advanced rows in sync with the selected provider (see comment
  // on showAdvConnectionOptions). The initial call happens after restoreOptions()
  // sets the saved provider, next to the showConnectionOptions() init call below.
  document.getElementById('connection_type').addEventListener('change', showAdvConnectionOptions);

  await restoreOptions();

  varConnectionUI.permission_all_urls = await messenger.permissions.contains({ origins: ["<all_urls>"] })

  // show Owl warning
  const accountList = await messenger.accounts.list(false);
  if(accountList.some(account => account.type.toLowerCase().includes('owl'))) {
    taLog.log('OWL detected, displaying the warning.');
    document.getElementById('owl_warning').style.display = 'block';
  }

  i18n.updateDocument();

  document.getElementById('link_doc_guides').href = getMiczItUrl('thunderbird-addon-thunderai/guides/');
  document.getElementById('link_doc_tutorial').href = getMiczItUrl('thunderbird-addon-thunderai/tutorial/');

  document.querySelectorAll(".option-input").forEach(element => {
    element.addEventListener("change", saveOptions);
  });
  
  let addtags_el = document.getElementById('add_tags');
  let addtags_info_btn = document.getElementById('btnManageTagsInfo');
  addtags_el.addEventListener('click', (event) => {
    async function _addtags_el_change() {
      if (event.target.checked) {
        let granted = false;
        granted = await messenger.permissions.request({ permissions: ["messagesTags", "messagesUpdate"] });
        if (!granted) {
          event.target.checked = false;
          setFeatureManageVisibility(addtags_info_btn, false);
          browser.storage.sync.set({add_tags: false});
        }
      }
    }
    _addtags_el_change();
    setFeatureManageVisibility(addtags_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(addtags_info_btn, addtags_el.checked);

  let spamfilter_el = document.getElementById('spamfilter');
  let spamfilter_info_btn = document.getElementById('btnManageSpamFilterInfo');
  spamfilter_el.addEventListener('click', (event) => {
    async function _spamfilter_el_change() {
      if (event.target.checked) {
        let granted = await messenger.permissions.request({ permissions: ["messagesMove", "messagesUpdate"] });
        if (!granted) {
          event.target.checked = false;
          setFeatureManageVisibility(spamfilter_info_btn, false);
          browser.storage.sync.set({spamfilter: false});
        }
      }
    }
    _spamfilter_el_change();
    setFeatureManageVisibility(spamfilter_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(spamfilter_info_btn, spamfilter_el.checked);

  let summarize_el = document.getElementById('summarize');
  let summarize_info_btn = document.getElementById('btnManageSummarizeInfo');
  summarize_el.addEventListener('click', (event) => {
    setFeatureManageVisibility(summarize_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(summarize_info_btn, summarize_el.checked);

  let translate_el = document.getElementById('translate');
  let translate_info_btn = document.getElementById('btnManageTranslateInfo');
  translate_el.addEventListener('click', (event) => {
    setFeatureManageVisibility(translate_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(translate_info_btn, translate_el.checked);

  let get_calendar_event_el = document.getElementById('get_calendar_event');
  let get_calendar_event_info_btn = document.getElementById('btnManageCalendarEventInfo');
  get_calendar_event_el.addEventListener('click', (event) => {
    setFeatureManageVisibility(get_calendar_event_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(get_calendar_event_info_btn, get_calendar_event_el.checked);

  let get_task_el = document.getElementById('get_task');
  let get_task_info_btn = document.getElementById('btnManageTaskInfo');
  get_task_el.addEventListener('click', (event) => {
    setFeatureManageVisibility(get_task_info_btn, event.target.checked);
  });
  setFeatureManageVisibility(get_task_info_btn, get_task_el.checked);
  
  document.getElementById('btnManagePrompts').addEventListener('click', () => {
    openTab('/pages/customprompts/mzta-custom-prompts.html');
  });

  document.getElementById('btnManageCustomDataPH').addEventListener('click', () => {
    openTab('/pages/customdataplaceholders/mzta-custom-dataplaceholders.html');
  });

  document.getElementById('btnMenuOrder').addEventListener('click', () => {
    openTab('/pages/menu_order/mzta-menu-order.html');
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

  document.getElementById('btnManageTranslateInfo').addEventListener('click', () => {
    openTab('/pages/translate/mzta-translate.html');
  });

  document.getElementById('btnManageCalendarEventInfo').addEventListener('click', () => {
    openTab('/pages/get-calendar-event/mzta-get-calendar-event.html');
  });

  document.getElementById('btnManageTaskInfo').addEventListener('click', () => {
    openTab('/pages/get-task/mzta-get-task.html');
  });

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
  conntype_select.addEventListener("change", () => disable_Translate(prefs_opt));
  conntype_select.addEventListener("change", disable_GetCalendarEvent);
  conntype_select.addEventListener("change", updateDescription);
  conntype_select.addEventListener("change", updateConnPanelTint);

  showConnectionOptions(conntype_select);
  showAdvConnectionOptions();
  updateDescription();
  updateConnPanelTint();
  updateShortcutChips();
  disable_MaxPromptLength();
  disable_AddTags(prefs_opt);
  disable_SpamFilter(prefs_opt);
  disable_Summarize(prefs_opt);
  disable_Translate(prefs_opt);
  disable_GetCalendarEvent();
  updateSpecificApiIndicators(prefs_opt);

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    const hasRelevantChange = Object.keys(changes).some(key =>
      key.endsWith('_use_specific_integration') || key.endsWith('_connection_type')
    );
    if (hasRelevantChange) {
      prefs_opt = await browser.storage.sync.get({
        ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
      });
      updateSpecificApiIndicators(prefs_opt);
    }
  });

  document.getElementById('reset_max_prompt_length').addEventListener('click', resetMaxPromptLength);
  document.getElementById('reset_special_command_timeout').addEventListener('click', resetSpecialCommandTimeout);

  // App-level "Advanced options" disclosure (purely UI, no pref persisted)
  let adv_toggle = document.getElementById('mzta_adv_toggle');
  let adv_panel = document.getElementById('mzta_adv_panel');
  adv_toggle.addEventListener('click', () => {
    let expanded = adv_toggle.getAttribute('aria-expanded') === 'true';
    adv_toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    adv_panel.classList.toggle('hidden', expanded);
  });

  // Per-connection "Advanced options" disclosure (purely UI, no pref persisted).
  // Advanced field rows are tagged conn_adv in the shared template and were moved
  // above into #connection_ui_adv_table, which sits below this button. Toggling
  // the .hidden class opens the advanced fields BELOW the button (button stays
  // fixed), mirroring the app-level disclosure; the label stays static.
  let conn_adv_btn = document.getElementById('mzta_conn_adv_btn');
  let conn_adv_panel = document.getElementById('connection_ui_adv_table');
  let conn_ui_table = document.getElementById('connection_ui_table');
  conn_adv_btn.addEventListener('click', () => {
    let expanded = conn_adv_btn.getAttribute('aria-expanded') === 'true';
    conn_adv_btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    conn_adv_panel.classList.toggle('hidden', expanded);
  });
  // Start collapsed and reset to collapsed whenever the connection type changes.
  resetConnAdv();
  document.getElementById('connection_type').addEventListener('change', resetConnAdv);

  // Connection test status strip: show for testable types, reset on any field change,
  // and run the (non-persistent) connectivity check when the action link is clicked.
  refreshConnTestVisibility();
  document.getElementById('connection_type').addEventListener('change', refreshConnTestVisibility);
  // Any edit to a connection field invalidates a prior result → back to idle.
  // The advanced fields now live in a separate table, so listen on both.
  conn_ui_table.addEventListener('input', () => setConnTestState('idle'));
  conn_ui_table.addEventListener('change', () => setConnTestState('idle'));
  conn_adv_panel.addEventListener('input', () => setConnTestState('idle'));
  conn_adv_panel.addEventListener('change', () => setConnTestState('idle'));
  let conn_test_link = document.getElementById('mzta_conn_test_link');
  conn_test_link.addEventListener('click', async (e) => {
    e.preventDefault();
    let connType = document.getElementById('connection_type').value;
    if(!isTestableConnection(connType)) return;
    setConnTestState('loading');
    let result = await runConnectionTest(connType);
    if(result.status === 'ok'){
      setConnTestState('ok', result.apiName);
    }else{
      setConnTestState('error', result.message);
    }
  });

  document.getElementById('btn_welcome').addEventListener('click', async () => {
      await browser.tabs.create({ url: "../pages/onboarding/onboarding.html" });
  });

  document.getElementById('btn_setup_wizard').addEventListener('click', openSetupWizard);

  // "No connection selected" banner: shown until a provider is chosen.
  updateNoConnectionBanner();
  document.getElementById('connection_type').addEventListener('change', updateNoConnectionBanner);
  document.getElementById('btn_options_setup_wizard').addEventListener('click', async (e) => {
      e.preventDefault();
      await openSetupWizard();
  });

  // Cache management
  updateCacheSize();

  document.getElementById('btnClearCache').addEventListener('click', async () => {
    if (!confirm(browser.i18n.getMessage("prefs_storage_clear_confirm"))) {
      return;
    }
    let count = await taStorage.clearAllRecords();
    alert(browser.i18n.getMessage("prefs_storage_clear_done", [String(count)]));
    updateCacheSize();
  });

  browser.runtime.getPlatformInfo().then(info => {
    taLog.log("OS: " + info.os);
    if ((info.os === "linux")&&(prefs_opt.chatgpt_win_height!=0)&&(prefs_opt.chatgpt_win_width!=0)){
      document.getElementById('hyprland_warning').style.display = 'block';
    }
  });

  updateWarnings();

}, { once: true });
