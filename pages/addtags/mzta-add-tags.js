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
  integration_options_config
} from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import {
  getSpecialPrompts
} from "../../js/mzta-prompts.js";
import {
  getPlaceholders,
  mapPlaceholderToSuggestion, placeholdersUtils } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
  attachEditorHighlight,
  makeTokenStateResolver
} from "../../js/mzta-editor-highlight.js";
import {
  addTags_getExclusionList,
  addTags_setExclusionList
} from "../../js/mzta-addtags-exclusion-list.js";
import {
    ADD_TAGS_ACCOUNT_KEYS,
    addTags_getAccountEntry,
    addTags_setAccountSettings
} from "../../js/mzta-addtags-account-settings.js";
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
    lockAccountSelector,
    isEnforcedPromptText,
    lockEnforcedPromptText,
    lockOverrideControls
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

    document.getElementById('add_tags_maxnum').addEventListener('change', updateGlobalAdditionalStatements);
    document.getElementById('add_tags_force_lang').addEventListener('change', updateGlobalAdditionalStatements);
    document.getElementById('add_tags_auto_uselist').addEventListener('change', updateGlobalAdditionalStatements);
    document.getElementById('add_tags_auto_uselist_list').addEventListener('change', updateGlobalAdditionalStatements);
    document.getElementById('add_tags_auto_force_existing').addEventListener('change', updateGlobalAdditionalStatements);
    addtags_textarea.addEventListener('change', updateGlobalAdditionalStatements);

    updateGlobalAdditionalStatements();

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

    // After the exclusion list's Save handler: the section follows the saved global list.
    try {
        await initAccountSettings(addtags_textarea);
    } catch (err) {
        console.error("[ThunderAI] Error initializing the settings for single accounts: ", err);
    }

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

    // The two buttons store the selection they show, like a click on a single box: setting
    // `checked` fires no change event. At least one account stays selected, as for a single
    // box, so "Deselect all" keeps the first one: a start from which to add the others.
    const saveShownAccounts = () => {
      let checkboxes = Array.from(document.querySelectorAll('.accountCheckbox'));
      let selectedAccounts = checkboxes.filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
      mztaPrefs.setPref('add_tags_enabled_accounts', selectedAccounts.length === checkboxes.length ? [] : selectedAccounts);
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
});


// Settings for single accounts (add_tags_account_settings, js/mzta-addtags-account-settings.js).
// The account selector picks which entry the section edits. Every override key has a row, the
// prompt text included: the toggle addtags_account_<key>_override left of its title. Off (the
// default) means the key is not in the entry: the row shows only the current global value
// (addtags_account_<key>_global, kept in step with the global controls above; nothing for the
// prompt). On shows the control addtags_account_<key>, starting from the value the account had
// (stored, or edited since the account was loaded) or else from the global one. A Yes/No row is
// two radios, addtags_account_<key> ("Yes") and addtags_account_<key>_no. "Use only these tags"
// is one row for two keys, as the global option: its toggle overrides add_tags_auto_uselist and
// add_tags_auto_uselist_list together, and the list is disabled while "No" is chosen. Save
// stores the whole entry at once; "Reset to the global settings" removes it.
//
// Policy: a key whose global key is locked is locked here too (its override would be ignored at
// run time): its control disabled, showing the policy value, and its stored value, if any, kept
// as it is; when every key of a row is locked, its toggle too (off and disabled). The same for
// the prompt text when the policy enforces the Add Tags text. So neither Save nor the removal
// ever writes a value the policy owns.
const ACCOUNT_ROW_KEYS = ADD_TAGS_ACCOUNT_KEYS.filter(key => key !== 'prompt_text');
const ACCOUNT_BOOLEAN_KEYS = [
    'add_tags_force_lang',
    'add_tags_auto_force_existing',
    'add_tags_auto_uselist',
    'add_tags_exclusions_exact_match',
];
// The keys edited in another key's row (the one whose ids it carries).
const ACCOUNT_KEY_ROW = {
    add_tags_auto_uselist_list: 'add_tags_auto_uselist',
};
const accountRowOf = (key) => ACCOUNT_KEY_ROW[key] ?? key;
// The rows, by the key whose ids they carry.
const ACCOUNT_ROWS = ACCOUNT_ROW_KEYS.filter(key => !ACCOUNT_KEY_ROW[key]);

async function initAccountSettings(global_textarea) {
    const account_select = document.getElementById('addtags_account_settings_account');
    const account_textarea = document.getElementById('addtags_account_prompt_text');
    const prompt_override = document.getElementById('addtags_account_prompt_text_override');
    const prompt_value_el = account_textarea.closest('.addtags_account_value');
    const save_btn = document.getElementById('btn_save_account_settings');
    const remove_btn = document.getElementById('btn_account_settings_remove');
    const copy_btn = document.getElementById('btn_account_settings_copy_prompt');
    const unsaved_el = document.getElementById('addtags_account_settings_unsaved');
    const preview_el = document.getElementById('addtags_account_info_additional_statements');
    const excl_list_textarea = document.getElementById('addtags_excl_list');

    // The controls, by override key; the rows, by the key whose ids they carry.
    const controls = {};
    for (const key of ACCOUNT_ROW_KEYS) {
        controls[key] = {
            control: document.getElementById('addtags_account_' + key),
            control_no: document.getElementById('addtags_account_' + key + '_no'),    // Yes/No only
        };
    }
    const rows = {};
    for (const row_key of ACCOUNT_ROWS) {
        const override = document.getElementById('addtags_account_' + row_key + '_override');
        const row_el = override.closest('.addtags_account_row');
        rows[row_key] = {
            keys: ACCOUNT_ROW_KEYS.filter(key => accountRowOf(key) === row_key),
            override: override,
            value_el: row_el.querySelector('.addtags_account_value'),
            global_el: document.getElementById('addtags_account_' + row_key + '_global'),
            title_el: row_el.querySelector('.addtags_account_title'),
        };
    }
    const uselist_list = controls.add_tags_auto_uselist_list.control;

    const accounts = await getAccountsList();
    let entries = {};
    for (const account of accounts) {
        entries[account.id] = await addTags_getAccountEntry(account.id);
    }
    let current_account_id = '';
    let baseline = '';
    // The account's own values, by key (prompt_text included): the stored ones at load, then the
    // last ones the user gave. Switching a toggle on starts from them, so turning it off and on
    // again does not lose them. Reset on every account load.
    let own_values = {};

    // The global values, in their stored form. The page has no control for default_chatgpt_lang
    // (it is set on the options page), and the exclusion list is the saved one, not what the
    // global textarea may hold unsaved.
    let global_lang = String((await mztaPrefs.getPrefs(['default_chatgpt_lang'])).default_chatgpt_lang ?? '');
    let global_exclusions = await addTags_getExclusionList();

    function globalValue(key) {
        switch (key) {
            case 'default_chatgpt_lang':
                return global_lang;
            case 'add_tags_exclusions':
                return global_exclusions;
            case 'add_tags_maxnum':
                return document.getElementById(key).valueAsNumber;
            case 'add_tags_auto_uselist_list':
                return normalizeStringList(document.getElementById(key).value);
            default:
                return document.getElementById(key).checked;
        }
    }

    // A global value as the summaries show it: Yes/No, the lists comma-separated.
    function valueText(key) {
        const value = globalValue(key);
        let text;
        if (ACCOUNT_BOOLEAN_KEYS.includes(key)) {
            text = browser.i18n.getMessage(value ? 'yes_string' : 'no_string');
        } else if (key === 'add_tags_maxnum') {
            text = Number.isFinite(value) ? String(value) : '';
        } else if (key === 'add_tags_exclusions') {
            text = Array.isArray(value) ? value.join(', ') : '';
        } else {
            text = String(value ?? '').trim();
        }
        return text === '' ? browser.i18n.getMessage('AddTags_account_settings_global_none') : text;
    }

    // The row's summary: "Use only these tags" adds its list, in brackets, when it is on.
    function globalText(row_key) {
        let text = valueText(row_key);
        if (row_key === 'add_tags_auto_uselist' && globalValue(row_key)) {
            text += ' (' + valueText('add_tags_auto_uselist_list') + ')';
        }
        return browser.i18n.getMessage('AddTags_account_settings_global', [text]);
    }

    // Shows a value, in its stored form, in the key's control.
    function showValue(key, value) {
        const ctl = controls[key];
        if (ACCOUNT_BOOLEAN_KEYS.includes(key)) {
            ctl.control.checked = value === true;
            ctl.control_no.checked = value !== true;
        } else if (key === 'add_tags_maxnum') {
            ctl.control.value = Number.isFinite(value) ? String(value) : '';
        } else if (key === 'add_tags_auto_uselist_list') {
            ctl.control.value = normalizeStringList(value, 1);
        } else if (key === 'add_tags_exclusions') {
            ctl.control.value = Array.isArray(value) ? value.join('\n') : '';
        } else {
            ctl.control.value = String(value ?? '');
        }
    }

    // The key's control value, in its stored form; undefined when it holds no valid value
    // (an emptied tag limit), which saves as "use the global setting".
    function readValue(key) {
        const control = controls[key].control;
        if (ACCOUNT_BOOLEAN_KEYS.includes(key)) return control.checked;
        switch (key) {
            case 'add_tags_maxnum': {
                const num = control.valueAsNumber;
                return (Number.isFinite(num) && num >= 0) ? Math.round(num) : undefined;
            }
            case 'add_tags_auto_uselist_list':
                return normalizeStringList(control.value);
            case 'add_tags_exclusions':
                // The same normalization as the global list (lowercase, sorted, no duplicates).
                return normalizeStringList(control.value, 2);
            default:
                return control.value.trim();
        }
    }

    const isRowLocked = (key) => isLockedKey(key);
    const isTextEnforced = () => isEnforcedPromptText('prompt_add_tags');
    const isOverridden = (key) => !isRowLocked(key) && rows[accountRowOf(key)].override.checked;
    // A row is locked when every key it edits is; while some is not, its toggle stays usable.
    const isWholeRowLocked = (row_key) => rows[row_key].keys.every(key => isRowLocked(key));
    const isRowOn = (row_key) => !isWholeRowLocked(row_key) && rows[row_key].override.checked;
    const isPromptOverridden = () => !isTextEnforced() && prompt_override.checked;

    // The stored values the page must keep as they are: those of the locked keys, and the
    // prompt text when the policy enforces the Add Tags text.
    function preservedEntry() {
        const saved = entries[current_account_id] || {};
        let entry = {};
        for (const key of ADD_TAGS_ACCOUNT_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
            if (key === 'prompt_text' ? isTextEnforced() : isRowLocked(key)) entry[key] = saved[key];
        }
        return entry;
    }

    // The entry the section shows, in ADD_TAGS_ACCOUNT_KEYS order (as the stored one is).
    function buildEntry() {
        const preserved = preservedEntry();
        let entry = {};
        for (const key of ADD_TAGS_ACCOUNT_KEYS) {
            if (key === 'prompt_text') {
                if (isTextEnforced()) {
                    if (preserved.prompt_text !== undefined) entry.prompt_text = preserved.prompt_text;
                } else if (prompt_override.checked && account_textarea.value.trim() !== '') {
                    entry.prompt_text = account_textarea.value;
                }
                continue;
            }
            if (isRowLocked(key)) {
                if (preserved[key] !== undefined) entry[key] = preserved[key];
                continue;
            }
            if (!rows[accountRowOf(key)].override.checked) continue;
            const value = readValue(key);
            if (value !== undefined) entry[key] = value;
        }
        return entry;
    }

    // The value that applies to the selected account's messages for this key, as the run time
    // resolves it (addTags_resolveAccountPrefs()): the global one when not overridden or locked.
    function effectiveValue(key) {
        if (!isOverridden(key)) return globalValue(key);
        const value = readValue(key);
        return value === undefined ? globalValue(key) : value;
    }

    function updatePreview() {
        let values = {};
        for (const key of ACCOUNT_ROW_KEYS) values[key] = effectiveValue(key);
        const prompt_text = (isPromptOverridden() && account_textarea.value.trim() !== '')
            ? account_textarea.value : global_textarea.value;
        updateAdditionalPromptStatements(values, prompt_text, preview_el);
    }

    function updateButtons() {
        const is_dirty = current_account_id !== '' && JSON.stringify(buildEntry()) !== baseline;
        setDisabledRespectingManaged(save_btn, !is_dirty);
        unsaved_el.classList.toggle('hidden', !is_dirty);
        // Something to remove: a stored value the page may drop (not one the policy owns), or
        // unsaved changes to discard.
        const has_removable = JSON.stringify(entries[current_account_id] || {}) !== JSON.stringify(preservedEntry());
        setDisabledRespectingManaged(remove_btn, current_account_id === '' || (!has_removable && !is_dirty));
    }

    function onFormChange() {
        updateButtons();
        updatePreview();
    }

    // A row with its toggle on shows its controls, each from the account's own value or else the
    // global one (a locked key the policy value); off (or locked), only the summary of the global
    // value. The controls are also disabled while hidden, through the managed-aware setter, so a
    // locked key is never re-enabled.
    function applyOverride(row_key) {
        const row = rows[row_key];
        const on = isRowOn(row_key);
        for (const key of row.keys) {
            if (on) showValue(key, isRowLocked(key) ? globalValue(key) : (own_values[key] ?? globalValue(key)));
            for (const control of [controls[key].control, controls[key].control_no]) {
                if (control) setDisabledRespectingManaged(control, !on);
            }
        }
        if (row_key === 'add_tags_auto_uselist') applyUselistList();
        row.value_el.hidden = !on;
        row.global_el.textContent = globalText(row_key);
        row.global_el.title = row.global_el.textContent;
        row.global_el.hidden = on;
    }

    // The list of "Use only these tags" is disabled while "No" is chosen, as the global one.
    function applyUselistList() {
        const on = isRowOn('add_tags_auto_uselist') && controls.add_tags_auto_uselist.control.checked;
        setDisabledRespectingManaged(uselist_list, !on);
    }

    // The same for the prompt, which shows nothing while off (the prompt above is in sight).
    function applyPromptOverride() {
        const on = isPromptOverridden();
        prompt_value_el.hidden = !on;
        if (on) setEditorText(own_values.prompt_text ?? global_textarea.value);
    }

    function refreshGlobal() {
        for (const row_key of ACCOUNT_ROWS) {
            rows[row_key].global_el.textContent = globalText(row_key);
            rows[row_key].global_el.title = rows[row_key].global_el.textContent;
        }
        updatePreview();
    }

    function renderAccountOptions() {
        account_select.replaceChildren(...accounts.map(account => {
            let label = account.name;
            if (Object.keys(entries[account.id] || {}).length > 0) {
                label += ' ' + browser.i18n.getMessage('AddTags_account_settings_custom_suffix');
            }
            return new Option(label, account.id);
        }));
        if (current_account_id) {
            account_select.value = current_account_id;
        }
    }

    const account_textarea_hl = attachEditorHighlight(account_textarea);
    if (account_textarea_hl) account_textarea_hl.setTokenStateResolver(makeTokenStateResolver(
        placeholdersUtils.findPlaceholder, activePlaceholders, () => 1));
    textareaAutocomplete(account_textarea, autocompleteSuggestions, 1);    // type_value = 1, only when reading an email

    function setEditorText(text) {
        account_textarea.value = text;
        if (account_textarea_hl) account_textarea_hl.refresh();
    }

    function loadAccount(accountId) {
        current_account_id = accountId;
        const entry = entries[accountId] || {};
        own_values = {};
        for (const key of ADD_TAGS_ACCOUNT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(entry, key)) own_values[key] = entry[key];
        }
        for (const row_key of ACCOUNT_ROWS) {
            rows[row_key].override.checked = rows[row_key].keys.some(key => !isRowLocked(key) && own_values[key] !== undefined);
            applyOverride(row_key);
        }
        prompt_override.checked = !isTextEnforced() && typeof own_values.prompt_text === 'string';
        applyPromptOverride();
        baseline = JSON.stringify(buildEntry());
        onFormChange();
    }

    // A key whose global key the policy locks: its controls disabled, marked and inert, the marker
    // in the row's title; the toggle too when every key of the row is locked.
    for (const key of ACCOUNT_ROW_KEYS) {
        const row = rows[accountRowOf(key)];
        const locked_toggle = row.keys.every(row_key => isLockedKey(row_key)) ? row.override : null;
        await lockOverrideControls(key, [controls[key].control, controls[key].control_no, locked_toggle],
            row.title_el, taLog.do_debug);
    }

    if (accounts.length === 0) {
        account_select.disabled = true;
        for (const row_key of ACCOUNT_ROWS) {
            rows[row_key].override.checked = false;
            rows[row_key].override.disabled = true;
            applyOverride(row_key);
        }
        prompt_override.checked = false;
        prompt_override.disabled = true;
        applyPromptOverride();
        account_textarea.disabled = true;
        copy_btn.disabled = true;
        return;
    }

    renderAccountOptions();
    loadAccount(account_select.value);

    for (const row_key of ACCOUNT_ROWS) {
        const row = rows[row_key];
        row.override.addEventListener('change', () => {
            if (isWholeRowLocked(row_key)) {
                row.override.checked = false;
                return;
            }
            applyOverride(row_key);
            onFormChange();
        });
    }
    for (const key of ACCOUNT_ROW_KEYS) {
        const onValueChange = () => {
            const value = readValue(key);
            if (value === undefined) delete own_values[key];
            else own_values[key] = value;
            if (key === 'add_tags_auto_uselist') applyUselistList();
            onFormChange();
        };
        for (const control of [controls[key].control, controls[key].control_no]) {
            if (!control) continue;
            control.addEventListener('input', onValueChange);
            control.addEventListener('change', onValueChange);
        }
    }
    prompt_override.addEventListener('change', () => {
        if (isTextEnforced()) {
            prompt_override.checked = false;
            return;
        }
        applyPromptOverride();
        onFormChange();
    });
    account_textarea.addEventListener('input', () => {
        if (!isTextEnforced()) own_values.prompt_text = account_textarea.value;
        onFormChange();
    });

    // Keep the global values the rows show, and the preview, in step with the global settings above.
    for (const id of ['add_tags_maxnum', 'add_tags_force_lang', 'add_tags_auto_force_existing',
        'add_tags_auto_uselist', 'add_tags_auto_uselist_list', 'add_tags_exclusions_exact_match']) {
        document.getElementById(id).addEventListener('change', refreshGlobal);
    }
    global_textarea.addEventListener('input', updatePreview);
    // Registered after the global list's own Save handler, which leaves the saved list,
    // normalized, in the textarea.
    document.getElementById('btn_save_excl_list').addEventListener('click', () => {
        if (isLockedKey('add_tags_exclusions')) return;
        global_exclusions = normalizeStringList(excl_list_textarea.value, 2);
        refreshGlobal();
    });

    account_select.addEventListener('change', () => {
        if (!save_btn.disabled && !confirm(browser.i18n.getMessage('AddTags_account_settings_discard_confirm'))) {
            account_select.value = current_account_id;
            return;
        }
        loadAccount(account_select.value);
    });

    // When the policy enforces the Add Tags text the account prompt texts are ignored (they
    // would bypass it), so the prompt toggle stays off and inert, the editor read-only and "Copy
    // the global prompt" inert. Save and the removal stay available for the other settings, and
    // keep the stored text as it is (see preservedEntry()). The handlers still check, see the
    // note on lockEnforcedPromptText().
    await lockEnforcedPromptText(account_textarea, ['prompt_add_tags'], [copy_btn, prompt_override], taLog.do_debug);

    copy_btn.addEventListener('click', () => {
        if (isTextEnforced()) return;
        setEditorText(global_textarea.value);
        own_values.prompt_text = account_textarea.value;
        onFormChange();
    });

    save_btn.addEventListener('click', async () => {
        if (current_account_id === '') return;
        const entry = buildEntry();
        await addTags_setAccountSettings(current_account_id, entry);
        entries[current_account_id] = await addTags_getAccountEntry(current_account_id);
        taLog.log("Saved the add_tags settings of account " + current_account_id + ": " + JSON.stringify(Object.keys(entries[current_account_id])) + ".");
        renderAccountOptions();
        loadAccount(current_account_id);
    });

    remove_btn.addEventListener('click', async () => {
        if (current_account_id === '') return;
        await addTags_setAccountSettings(current_account_id, preservedEntry());
        entries[current_account_id] = await addTags_getAccountEntry(current_account_id);
        taLog.log("Removed the add_tags settings of account " + current_account_id + ", using the global settings.");
        renderAccountOptions();
        loadAccount(current_account_id);
    });
}

// The global settings' preview: the values as stored (the controls save on change).
async function updateGlobalAdditionalStatements(){
    let prefs_ = await mztaPrefs.getPrefs([
      'add_tags_maxnum',
      'add_tags_force_lang',
      'default_chatgpt_lang',
      'add_tags_auto_uselist',
      'add_tags_auto_uselist_list',
      'add_tags_auto_force_existing'
    ]);
    await updateAdditionalPromptStatements(prefs_, document.getElementById('addtags_prompt_text').value,
        document.getElementById('addtags_info_additional_statements'));
}

// Shows in target_el the statements finalizePrompt_add_tags() appends for these values (the
// add_tags keys, in their stored form) and this prompt text, or hides it when there are none.
// Shared by the global preview and the per-account one.
async function updateAdditionalPromptStatements(values, prompt_text, target_el){
    // Mirrors taPromptUtils.finalizePrompt_add_tags() [#926]
    let show_force_lang = !values.add_tags_auto_force_existing && values.add_tags_force_lang && values.default_chatgpt_lang !== '';
    let uselist_active = values.add_tags_auto_uselist && String(values.add_tags_auto_uselist_list ?? '').trim() !== '';
    let force_existing_list = '';
    if(values.add_tags_auto_force_existing){
        let existing_tags_list = (await getTagsList())[0];
        if(uselist_active){
            force_existing_list = intersectTagsLists(values.add_tags_auto_uselist_list, existing_tags_list);
        }else if(!String(prompt_text ?? '').includes("{%tags_full_list%}")){
            force_existing_list = existing_tags_list;
        }
    }
    let show_use_list = !values.add_tags_auto_force_existing && uselist_active;
    let el_tag_limit = target_el;
    if((values.add_tags_maxnum > 0)||show_force_lang||show_use_list||(force_existing_list !== '')){
        el_tag_limit.textContent = browser.i18n.getMessage("addtags_info_additional_statements") + " \""
        if(values.add_tags_maxnum > 0){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_maxnum") + " " + values.add_tags_maxnum +". "
        }
        if(show_force_lang){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_force_lang") + " " + values.default_chatgpt_lang + ". "
        }
        if(show_use_list){
          el_tag_limit.textContent += browser.i18n.getMessage("prompt_add_tags_use_list") + ": " + values.add_tags_auto_uselist_list + ".";
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
