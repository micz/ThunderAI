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
  prefs_default
} from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import {
  getSpecialPrompts
} from "../../js/mzta-prompts.js";
import {
  getPlaceholders,
  mapPlaceholderToSuggestion,
  placeholdersUtils
} from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
  attachEditorHighlight,
  makeTokenStateResolver
} from "../../js/mzta-editor-highlight.js";
import { taSpamReport } from '../../js/mzta-spamreport.js';
import {
  getAccountsList,
  isAPIKeyValue,
  normalizeStringList,
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
let taLog = null;
let spamReport = null;

document.addEventListener('DOMContentLoaded', async () => {

    // Warn before leaving the page with unsaved textarea text.
    initUnsavedGuard();

    let prefs = await mztaPrefs.getPrefs(['do_debug']);
    taLog = new taLogger("mzta-spamfilter-page", prefs.do_debug);
    spamReport = new taSpamReport(prefs.do_debug);

    let specialPrompts = await getSpecialPrompts();
    let spamfilter_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter');

    await persistPromptConnectionToPrefs('spamfilter', spamfilter_prompt);

    await initializeSpecificIntegrationUI({
      prefix: 'spamfilter',
      promptId: 'prompt_spamfilter',
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

    document.getElementById("spamfilter_threshold").addEventListener("input", check_spamfilter_threshold);
    check_spamfilter_threshold({target: document.getElementById("spamfilter_threshold")});


    let spamfilter_textarea = document.getElementById('spamfilter_prompt_text');

    bindConnPanelTint('spamfilter');

    await bindSpecialPromptEditor({
        textarea: spamfilter_textarea,
        saveBtn: document.getElementById('btn_save_prompt'),
        resetBtn: document.getElementById('btn_reset_prompt'),
        unsavedEl: document.getElementById('spamfilter_prompt_unsaved'),
        specialPrompts: specialPrompts,
        promptIds: ['prompt_spamfilter'],
        defaultMsgKey: 'prompt_spamfilter_full_text',
        do_debug: taLog.do_debug,
    });

    // Full list, kept for token validation. Deliberately NOT filtered like the
    // suggestions: {%additional_text%} is a real placeholder that this page simply
    // does not offer, so the editor must not flag it as unknown.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.filter(p => !(p.id === 'additional_text')).map(mapPlaceholderToSuggestion);
    const spamfilter_textarea_hl = attachEditorHighlight(spamfilter_textarea);
    // Flags unknown and unterminated tokens. Type 1 ("reading"),
    // matching the type_value passed to textareaAutocomplete below.
    if (spamfilter_textarea_hl) spamfilter_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(spamfilter_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

    // Skip addresses list
    let skip_addresses_textarea = document.getElementById('spamfilter_skip_addresses');
    let skip_addresses_save_btn = document.getElementById('btn_save_skip_addresses');

    let skip_addresses_value = await spamfilter_getSkipAddresses();
    let skip_addresses_string = skip_addresses_value.join('\n');

    skip_addresses_textarea.value = skip_addresses_string;

    // data-mzta-pref: applyManagedUI() above has already disabled and marked the textarea
    // when the policy locks the list. Its Save button is ours to lock.
    lockCompanions('spamfilter_skip_addresses', [skip_addresses_save_btn]);

    skip_addresses_textarea.addEventListener('input', (event) => {
        setDisabledRespectingManaged(skip_addresses_save_btn, (event.target.value === skip_addresses_string));
        if(skip_addresses_save_btn.disabled){
            document.getElementById('skip_addresses_unsaved').classList.add('hidden');
        } else {
            document.getElementById('skip_addresses_unsaved').classList.remove('hidden');
        }
    });

    skip_addresses_save_btn.addEventListener('click', () => {
        // The button being disabled is not the same as the action being unavailable.
        if (isLockedKey('spamfilter_skip_addresses')) return;
        let skip_array_new = normalizeStringList(skip_addresses_textarea.value, 2);
        spamfilter_setSkipAddresses(skip_array_new);
        skip_addresses_save_btn.disabled = true;
        skip_addresses_string = skip_array_new.join('\n');
        skip_addresses_textarea.value = skip_addresses_string;
        document.getElementById('skip_addresses_unsaved').classList.add('hidden');
    });

    // Block addresses list
    let block_addresses_textarea = document.getElementById('spamfilter_block_addresses');
    let block_addresses_save_btn = document.getElementById('btn_save_block_addresses');

    let block_addresses_value = await spamfilter_getBlockAddresses();
    let block_addresses_string = block_addresses_value.join('\n');

    block_addresses_textarea.value = block_addresses_string;

    // data-mzta-pref: applyManagedUI() above has already disabled and marked the textarea
    // when the policy locks the list. Its Save button is ours to lock.
    lockCompanions('spamfilter_block_addresses', [block_addresses_save_btn]);

    block_addresses_textarea.addEventListener('input', (event) => {
        setDisabledRespectingManaged(block_addresses_save_btn, (event.target.value === block_addresses_string));
        if(block_addresses_save_btn.disabled){
            document.getElementById('block_addresses_unsaved').classList.add('hidden');
        } else {
            document.getElementById('block_addresses_unsaved').classList.remove('hidden');
        }
    });

    block_addresses_save_btn.addEventListener('click', () => {
        // The button being disabled is not the same as the action being unavailable.
        if (isLockedKey('spamfilter_block_addresses')) return;
        let block_array_new = normalizeStringList(block_addresses_textarea.value, 2);
        spamfilter_setBlockAddresses(block_array_new);
        block_addresses_save_btn.disabled = true;
        block_addresses_string = block_array_new.join('\n');
        block_addresses_textarea.value = block_addresses_string;
        document.getElementById('block_addresses_unsaved').classList.add('hidden');
    });

    // Address book skip option
    let skip_addressbook_checkbox = document.getElementById('spamfilter_skip_addressbook');
    let prefs_skip_ab = await mztaPrefs.getPrefs(['spamfilter_skip_addressbook']);
    skip_addressbook_checkbox.checked = prefs_skip_ab.spamfilter_skip_addressbook;

    skip_addressbook_checkbox.addEventListener('change', async (event) => {
        // Locked: no permission prompt and no write, even if the checkbox was re-enabled
        // from the developer tools. Put back the enforced state the change just flipped.
        if (isLockedKey('spamfilter_skip_addressbook')) {
            event.target.checked = !event.target.checked;
            return;
        }
        if (event.target.checked) {
            try {
                const granted = await browser.permissions.request({ permissions: ["addressBooks"] });
                if (granted) {
                    await mztaPrefs.setPref('spamfilter_skip_addressbook', true);
                } else {
                    event.target.checked = false;
                    alert(browser.i18n.getMessage("addressbook_permission_denied"));
                }
            } catch (err) {
                taLog.error("Error requesting addressBooks permission:", err);
                event.target.checked = false;
                alert(browser.i18n.getMessage("addressbook_permission_error"));
            }
        } else {
            await mztaPrefs.setPref('spamfilter_skip_addressbook', false);
        }
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
 
     let prefs_spamfilter = await mztaPrefs.getPrefs(['spamfilter_enabled_accounts']);
     let spamfilter_enabled_accounts = prefs_spamfilter.spamfilter_enabled_accounts;
     taLog.log("spamfilter_enabled_accounts: " + JSON.stringify(spamfilter_enabled_accounts));
     document.querySelectorAll('.accountCheckbox').forEach(checkbox => {
       if (spamfilter_enabled_accounts.length === 0 || spamfilter_enabled_accounts.includes(checkbox.value)) {
         checkbox.checked = true;
       } else {
         checkbox.checked = false;
       }
     });

     // A policy spamfilter_enabled_accounts_match replaces the stored selection: show the
     // accounts it resolves to, read-only, and never write spamfilter_enabled_accounts.
     const accounts_managed = await lockAccountSelector('spamfilter', accountsContainer,
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
         mztaPrefs.setPref('spamfilter_enabled_accounts', []);
         taLog.log("All accounts selected, saving spamfilter_enabled_accounts = [].");
       } else {
         mztaPrefs.setPref('spamfilter_enabled_accounts', selectedAccounts);
         taLog.log("Saving spamfilter_enabled_accounts = " + JSON.stringify(selectedAccounts) + ".");
       }
       });
     });
 
     // The two buttons store the selection they show, like a click on a single box: setting
     // `checked` fires no change event. At least one account stays selected, as for a single
     // box, so "Deselect all" keeps the first one: a start from which to add the others.
     const saveShownAccounts = () => {
       let checkboxes = Array.from(document.querySelectorAll('.accountCheckbox'));
       let selectedAccounts = checkboxes.filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
       mztaPrefs.setPref('spamfilter_enabled_accounts', selectedAccounts.length === checkboxes.length ? [] : selectedAccounts);
     };

     document.getElementById('accounts_select_all').addEventListener('click', () => {
       if (accounts_managed) return;
       let checkboxes = document.querySelectorAll('.accountCheckbox');
       checkboxes.forEach(checkbox => checkbox.checked = true);
       saveShownAccounts();
     });

     document.getElementById('accounts_deselect_all').addEventListener('click', () => {
       if (accounts_managed) return;
       let checkboxes = document.querySelectorAll('.accountCheckbox');
       if (checkboxes.length === 0) return;
       checkboxes.forEach((checkbox, index) => checkbox.checked = (index === 0));
       saveShownAccounts();
     });

    loadSpamReport();
    // Delegated on the tbody, which is static markup, so it survives every
    // populateTable() rebuild and only needs registering once.
    attachRowResizer();
    attachReportFullscreen();
});


function check_spamfilter_threshold(event) {
  let spamfilter_threshold_too_low = document.getElementById("spamfilter_threshold_too_low");
  if(event.target.value < 50){
    spamfilter_threshold_too_low.style.display = "inline";
    if(event.target.value == 0){
      spamfilter_threshold_too_low.textContent = browser.i18n.getMessage('spamfilter_threshold_zero');
      spamfilter_threshold_too_low.style.fontSize = "1.5em";
    }else{
      spamfilter_threshold_too_low.textContent = browser.i18n.getMessage('spamfilter_threshold_too_low');
      spamfilter_threshold_too_low.style.fontSize = "1.1em";
    }
  }else{
    spamfilter_threshold_too_low.style.display = "none";
  }
}

async function loadSpamReport(){
    let report_data = await spamReport.getAllReportData();
    //console.log(">>>>>>>>>>>> loadSpamReport: " + JSON.stringify(report_data));
    //document.getElementById("report_data").textContent = JSON.stringify(report_data, null, 2);
    populateTable(report_data);
}


 // Function to populate the table
 function populateTable(data) {
  const tableBody = document.getElementById("report_data_body");
  tableBody.innerHTML = ""; // Clear table before inserting new data

  // getAllReportData() resolves to an empty object when nothing has been
  // screened yet, so the placeholder goes in a row: replacing the table's
  // content would remove the header row and the tbody itself.
  if(Object.keys(data).length === 0){
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 8;
    emptyCell.textContent = browser.i18n.getMessage("spamfilter_no_reports");
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  Object.keys(data).forEach(email => {
      const report = data[email];

      // Create a new row
      const row = document.createElement("tr");

      // Create and append each cell as a DOM element.
      // The cells that CSS truncates (message id, from, subject, explanation)
      // also carry the full value in their title attribute, so nothing is
      // lost: it is echoed user data, never a translatable string.
      const tdHeaderMessageId = document.createElement("td");
      tdHeaderMessageId.textContent = report.headerMessageId;
      tdHeaderMessageId.title = report.headerMessageId ?? "";
      row.appendChild(tdHeaderMessageId);

      const tdMessageDate = document.createElement("td");
      tdMessageDate.textContent = report.message_date ? new Date(report.message_date).toLocaleString() : "";
      row.appendChild(tdMessageDate);

      const tdFrom = document.createElement("td");
      tdFrom.textContent = Array.isArray(report.from) ? report.from.join(", ") : (report.from ?? "");
      tdFrom.title = tdFrom.textContent;
      row.appendChild(tdFrom);

      const tdSubject = document.createElement("td");
      tdSubject.textContent = Array.isArray(report.subject) ? report.subject.join(", ") : (report.subject ?? "");
      tdSubject.title = tdSubject.textContent;
      row.appendChild(tdSubject);

      const tdSpamValue = document.createElement("td");
      tdSpamValue.textContent = report.spamValue;
      row.appendChild(tdSpamValue);

      const tdMoved = document.createElement("td");
      tdMoved.textContent = (report.moved ? browser.i18n.getMessage("yes_string") : browser.i18n.getMessage("no_string")) + ` (${report.SpamThreshold})`;
      row.appendChild(tdMoved);

      // The explanation goes in an inner block so it can scroll on its own
      // (see .expl_box): overflow on the td itself would be ignored, because
      // a table-cell takes its height from the row.
      const tdExplanation = document.createElement("td");
      const explBox = document.createElement("div");
      explBox.className = "expl_box";
      explBox.textContent = report.explanation ?? "";
      // Title on the text box, not on the cell: on the cell it would also
      // cover the resize strip and pop up a tooltip mid-drag.
      explBox.title = report.explanation ?? "";
      tdExplanation.appendChild(explBox);
      // Grab strip on the bottom border of the cell: dragging it grows just
      // this row (see attachRowResizer).
      const resizer = document.createElement("div");
      resizer.className = "row_resizer";
      tdExplanation.appendChild(resizer);
      row.appendChild(tdExplanation);

      const tdReportDate = document.createElement("td");
      tdReportDate.textContent = new Date(report.report_date).toLocaleString();
      row.appendChild(tdReportDate);

      // Append the row to the table
      tableBody.appendChild(row);
  });
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
      case 'select-one':
        options[element.id] = element.value;
        break;
      case 'textarea':
        options[element.id] = element.value;
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
          element.value = result[element.id] || default_text_value;
          break;
        default:
        if (element.tagName === 'SELECT') {
          let default_select_value = '';
          if(element.id == 'reply_type') default_select_value = 'reply_all';
          if(element.id == 'connection_type') default_select_value = 'chatgpt_web';
          // No default for spamfilter_connection_type on purpose: an unset specific
          // integration must show a blank select, not silently preselect a provider
          // the user never picked (the other feature pages already behave this way).
          const restoreValue = result[element.id] || default_select_value;
          // Ensure option exists before restoring
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
            // Either an empty stored value, or one with no matching option (a stale
            // connection type the select no longer offers): show a blank control.
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
  let spamfilter_prompt = specialPrompts.find(prompt => prompt.id === 'prompt_spamfilter');

  resolveFeatureConnectionPrefs(getting, spamfilter_prompt, 'spamfilter');

  setCurrentChoice(getting);
}

async function spamfilter_getSkipAddresses() {
    let prefs = await mztaPrefs.getPrefs(['spamfilter_skip_addresses']);
    return prefs.spamfilter_skip_addresses;
}

function spamfilter_setSkipAddresses(spamfilter_skip_addresses) {
    if (isLockedKey('spamfilter_skip_addresses')) return;
    mztaPrefs.setPref('spamfilter_skip_addresses', spamfilter_skip_addresses);
}

async function spamfilter_getBlockAddresses() {
    let prefs = await mztaPrefs.getPrefs(['spamfilter_block_addresses']);
    return prefs.spamfilter_block_addresses;
}

function spamfilter_setBlockAddresses(spamfilter_block_addresses) {
    if (isLockedKey('spamfilter_block_addresses')) return;
    mztaPrefs.setPref('spamfilter_block_addresses', spamfilter_block_addresses);
}

/**
 * Makes every explanation cell vertically resizable by dragging the thin
 * strip on its bottom border.
 *
 * The handler is attached once, on the table body, rather than per row:
 * populateTable() rebuilds every row on each refresh, and per-row listeners
 * would be re-registered each time (and leak the old nodes).
 *
 * The drag sets an inline max-height on the row’s own .expl_box. It cannot
 * set a height on the <tr>, because a table row derives its height from its
 * tallest cell and ignores the value. Heights are deliberately not persisted:
 * they last for the life of the page, so no new preference is needed.
 */
function attachRowResizer() {
  const tableBody = document.getElementById("report_data_body");
  if (!tableBody) return;

  const MIN_HEIGHT = 28;   // roughly one line, so a row cannot be collapsed away
  let box = null;          // .expl_box being resized
  let handle = null;
  let startY = 0;
  let startHeight = 0;

  tableBody.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!target.classList.contains("row_resizer")) return;

    box = target.parentElement.querySelector(".expl_box");
    if (!box) return;

    handle = target;
    startY = event.clientY;
    startHeight = box.getBoundingClientRect().height;

    // Capture keeps the events coming even when the pointer outruns the 7px
    // strip, which it always does on a fast drag.
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("mzta_row_resizing");
    event.preventDefault();
  });

  tableBody.addEventListener("pointermove", (event) => {
    if (!box) return;
    const height = Math.max(MIN_HEIGHT, startHeight + (event.clientY - startY));
    box.style.maxHeight = height + "px";
  });

  const endDrag = (event) => {
    if (!box) return;
    if (handle) {
      if (event && handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      handle.classList.remove("dragging");
    }
    document.body.classList.remove("mzta_row_resizing");
    box = null;
    handle = null;
  };

  tableBody.addEventListener("pointerup", endDrag);
  tableBody.addEventListener("pointercancel", endDrag);
}

/**
 * Full-tab toggle for the spam report.
 *
 * Pins the report card over the whole tab so the table can use the entire
 * width and height, and puts it back on a second click. The button carries no
 * label on purpose: a caption would be a new string in all 25 locales, so the
 * state lives in aria-pressed (which also drives the icon swap in CSS).
 *
 * Escape closes it too, which is the expected way out of anything that covers
 * the screen.
 */
function attachReportFullscreen() {
  const btn = document.getElementById("report_fullscreen_btn");
  const section = document.getElementById("spamfilter_reports_container");
  if (!btn || !section) return;

  const setState = (on) => {
    section.classList.toggle("report_fullscreen_on", on);
    document.body.classList.toggle("report_fullscreen", on);
    btn.setAttribute("aria-pressed", String(on));
    if (!on) {
      // Bring the report back into view: leaving full-tab mode restores the
      // page scroll, which may no longer be anywhere near the report.
      section.scrollIntoView({ block: "nearest" });
    }
  };

  btn.addEventListener("click", () => {
    setState(btn.getAttribute("aria-pressed") !== "true");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && btn.getAttribute("aria-pressed") === "true") {
      setState(false);
    }
  });
}
