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
} from "../../options/mzta-options-default.js";
import {
    getPrompts,
    setDefaultPromptsProperties,
    setCustomPrompts,
    preparePromptsForExport,
    preparePromptsForImport
} from "../../js/mzta-prompts.js";
import {
    injectConnectionUI,
    showConnectionOptions,
    updateWarnings
} from "../../pages/_lib/connection-ui.js";
import {
    getLocalStorageUsedSpace,
    sanitizeHtml,
    validateCustomData_ChatGPTWeb,
    openTab,
    setTomSelectBorder,
    revealPromptInMenuOrder
} from "../../js/mzta-utils.js";
import { taLogger } from "../../js/mzta-logger.js";
import {
    getPlaceholders,
    placeholdersUtils,
    mapPlaceholderToSuggestion
} from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
    attachEditorHighlight,
    getEditorHighlight,
    makeTokenStateResolver,
    PLACEHOLDER_RE
} from "../../js/mzta-editor-highlight.js";

let prefs = null;
var promptsList = null;
var somethingChanged = false;
var positionMax_compose = 0;
var positionMax_display = 0;
var idnumMax = 0;
var msgTimeout = null;
let taLog = null;
let autocompleteSuggestions = [];
let activePlaceholders = [];

document.addEventListener('DOMContentLoaded', async () => {

    let storedPrefs = await browser.storage.sync.get(null);
    prefs = { ...prefs_default, ...storedPrefs };
    taLog = new taLogger("mzta-custom-prompts", prefs.do_debug);
    
    setStorageSpace();
    
    let values = await getPrompts();

    //console.log('>>>>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    loadPromptsList(values);

    const btnSaveAll = document.getElementById('btnSaveAll');
    btnSaveAll.disabled = true;
    
    // Disable save button and handle save actions
    function handleSaveAllClick(e) {
        e.preventDefault();
        saveAll();
        clearFields();
    }
    btnSaveAll.addEventListener('click', handleSaveAllClick);

    const btnNew = document.getElementById('btnNew');
    
    // Show the new item form
    function handleNewClick(e) {
        e.preventDefault();
        e.target.disabled = true;
        document.getElementById('formNew').style.display = 'block';
        let _checkboxUseDiffViewerNew = document.getElementById('checkboxUseDiffViewerNew');
        _checkboxUseDiffViewerNew.checked = false;
        _checkboxUseDiffViewerNew.disabled = true;
        updateUseDiffViewerHint();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
    btnNew.addEventListener('click', handleNewClick);
    
    // for the new prompt form
    let btnNew_elements = document.querySelectorAll(".input_new");
    if(btnNew_elements) {
        btnNew_elements.forEach(element => {
            element.addEventListener('input', (e) => {
                e.preventDefault();
                checkFields();
            });
        });
    }

    const textareas = document.querySelectorAll('.editor');
    // Kept as the raw list too: the highlight backdrop validates tokens against
    // it on every keystroke and needs the placeholder objects, not the mapped
    // autocomplete suggestions.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.map(mapPlaceholderToSuggestion);

    // The first decoratePromptText() already ran inside loadPromptsList() above,
    // before this await resolved — with an empty activePlaceholders it could not
    // tell a valid token from an invalid one, so it chipped them all as valid.
    // Now that the list is in, re-run it so unknown placeholders turn orange.
    // data-phDecorated holds the decorated HTML, so this pass is a no-op for
    // every row whose markup does not actually change.
    decoratePromptText();

    // console.log('>>>>>>>>>>> autocompleteSuggestions: ' + JSON.stringify(autocompleteSuggestions));
    
    // One registration per textarea. This used to be a nested pair of loops,
    // which attached every handler N+1 times for N textareas (and, through
    // textareaAutocomplete, leaked one document-level listener each time).
    textareas.forEach(textarea => {
        textareaAutocomplete(textarea, autocompleteSuggestions);
        // The mirror is attached here only for the add-form textarea (.input_new),
        // which is permanently in edit mode. Row textareas start hidden in read
        // mode and get theirs from showItemRowEditor(); attaching one now would
        // paint a second copy of the prompt text behind every read-mode row.
        // Note both live inside a <tr>, so closest('tr') cannot tell them apart.
        if (textarea.classList.contains('input_new')) attachHighlightWithValidation(textarea);
        textarea.addEventListener('input', async (e) => {
            await checkPromptsConfigForPlaceholders(e.target);
        });
    });

    const apiSettingsToggle = document.getElementById('api_additional_info_toggle');
    const apiSettingsRow = document.getElementById('api_additional_info');

    apiSettingsToggle.addEventListener('click', (e) => {
        e.preventDefault();
        if (apiSettingsRow.style.display === 'none') {
            apiSettingsRow.style.display = 'table-row';
            apiSettingsToggle.querySelector('span').innerText = browser.i18n.getMessage('customPrompts_hide_additional_info') + ' [API]';
        } else {
            apiSettingsRow.style.display = 'none';
            apiSettingsToggle.querySelector('span').innerText = browser.i18n.getMessage('customPrompts_show_additional_info') + ' [API]';
        }
    });

    await injectConnectionUI({
        afterTrId: 'api_ui_anchor',
        selectId: 'new_prompt_api_type',
        no_chatgpt_web: true,
        taLog: taLog,
        customButtonLabel: browser.i18n.getMessage("Reset"),
        customButtonCallback: () => {
            resetApiSettings('new_prompt_api_type');
        }
    });

    // Fill defaults for new prompt form
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputEl = document.getElementById(propName);
            if (inputEl && prefs[propName] !== undefined) {
                 if (inputEl.type === 'checkbox') {
                     inputEl.checked = (prefs[propName] === true || prefs[propName] === 'true');
                 } else {
                     inputEl.value = prefs[propName];
                 }
            }
        }
    }

    i18n.updateDocument();

    const apiSelect = document.getElementById('new_prompt_api_type');
    // Remove chatgpt_web
    // for (let i = 0; i < apiSelect.options.length; i++) {
    //     if (apiSelect.options[i].value === 'chatgpt_web') {
    //         apiSelect.remove(i);
    //         break;
    //     }
    // }
    apiSelect.addEventListener('change', () => {
        showConnectionOptions(apiSelect);
    });
    showConnectionOptions(apiSelect);

    if(prefs.connection_type == 'chatgpt_web') {
        // for the new item form
        document.getElementById('chatgpt_web_additional_info_toggle').style.display = 'table-row';
        // for the edit list items form
        document.querySelectorAll('.chatgpt_web_additional_info_toggle').forEach(element => {
            element.addEventListener('click', handleChatGPTWebInfoToggleClick);
        });
        document.querySelectorAll('input.chatgpt_web_project_output').forEach(element => {
            element.addEventListener("input", validateCustomData_ChatGPTWeb);
        });
        document.querySelectorAll('input.chatgpt_web_custom_gpt_output').forEach(element => {
            element.addEventListener("input", validateCustomData_ChatGPTWeb);
        });
    }

    // for the edit list items form [API]
    document.querySelectorAll('.api_additional_info_toggle').forEach(element => {
        element.addEventListener('click', handleApiInfoToggleClick);
    });

    const chatgptWebAdditionalPropToggle = document.getElementById('chatgpt_web_additional_info_toggle');
    chatgptWebAdditionalPropToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const additionalInfoRow = document.getElementById('chatgpt_web_additional_info');
        if (additionalInfoRow.style.display === 'none' || additionalInfoRow.style.display === '') {
            additionalInfoRow.style.display = 'table-row';
            let subspan = chatgptWebAdditionalPropToggle.querySelector('td span');
            if (subspan) {
                subspan.innerText = browser.i18n.getMessage('customPrompts_hide_additional_info') + ' [ChatGPT Web]';
            }
        } else {
            additionalInfoRow.style.display = 'none';
            let subspan = chatgptWebAdditionalPropToggle.querySelector('td span');
            if (subspan) {
                subspan.innerText = browser.i18n.getMessage('customPrompts_show_additional_info') + ' [ChatGPT Web]';
            }
        }
    });

    //To add a new item
    var txtIdNew = document.getElementById('txtIdNew');
    var txtNameNew = document.getElementById('txtNameNew');
    var txtTextNew = document.getElementById('txtTextNew');
    var selectTypeNew = document.getElementById('selectTypeNew');
    var selectActionNew = document.getElementById('selectActionNew');
    var checkboxNeedSelectedNew = document.getElementById('checkboxNeedSelectedNew');
    var checkboxNeedSignatureNew = document.getElementById('checkboxNeedSignatureNew');
    var checkboxNeedCustomTextNew = document.getElementById('checkboxNeedCustomTextNew');
    var checkboxDefineResponseLangNew = document.getElementById('checkboxDefineResponseLangNew');
    var checkboxUseDiffViewerNew = document.getElementById('checkboxUseDiffViewerNew');
    // ChatGTP Web Integration
    var chatgptWebModelNew = document.getElementById('chatGPTWebModelNew');
    var chatgptWebProjectNew = document.getElementById('chatGPTWebProjectNew');
    var chatgptWebCustomGptNew = document.getElementById('chatGPTWebCustomGPTNew');
    chatgptWebProjectNew.addEventListener("input", validateCustomData_ChatGPTWeb);
    chatgptWebCustomGptNew.addEventListener("input", validateCustomData_ChatGPTWeb);

    selectActionNew.addEventListener('change', (e) => {
        if (e.target.value === "2") {
            checkboxUseDiffViewerNew.disabled = false;
        } else {
            checkboxUseDiffViewerNew.checked = false;
            checkboxUseDiffViewerNew.disabled = true;
        }
        updateUseDiffViewerHint();
    });

    const btnAddNew = document.getElementById('btnAddNew');
    btnAddNew.addEventListener('click', (e) => {
        e.preventDefault();
        if(!checkFields()) {
            return;
        }
        // Clear any active search first: the new row would almost never match it,
        // and List.js would not render it — leaving the listener wiring below
        // with no DOM node to attach to.
        clearPromptsSearch();
        let newItemData = {
            id: String(txtIdNew.value.trim()).toLocaleLowerCase(),
            name: txtNameNew.value.trim(),
            text: txtTextNew.value.trim(),
            type: selectTypeNew.value,
            action: selectActionNew.value,
            need_selected: (checkboxNeedSelectedNew.checked) ? 1 : 0,
            need_signature: (checkboxNeedSignatureNew.checked) ? 1 : 0,
            need_custom_text: (checkboxNeedCustomTextNew.checked) ? 1 : 0,
            define_response_lang: (checkboxDefineResponseLangNew.checked) ? 1 : 0,
            use_diff_viewer: (checkboxUseDiffViewerNew.checked) ? 1 : 0,
            position_compose: positionMax_compose + 1,
            position_display: positionMax_display + 1,
            is_default: 0,
            idnum: idnumMax + 1,
            api_type: document.getElementById('new_prompt_api_type').value,
            // Placement is no longer chosen at creation: new prompts always start in
            // the popup (the primary surface: toolbar button + shortcut both open it,
            // and it respects `type`). Use the Menu Order page to move it afterwards.
            show_in: 'popup',
        };

        switch(prefs.connection_type) {
            case 'chatgpt_web':
                newItemData.chatgpt_web_model = chatgptWebModelNew.value.trim();
                newItemData.chatgpt_web_project = chatgptWebProjectNew.value.trim();
                newItemData.chatgpt_web_custom_gpt = chatgptWebCustomGptNew.value.trim();
                break;
            // case 'chatgpt_api':
            //     document.getElementById('chatgpt_api').style.display = 'block';
            //     break;
            // case 'ollama_api':
            //     document.getElementById('ollama_api').style.display = 'block';
            //     break;
            // case 'openai_comp_api':
            //     document.getElementById('openai_comp_api').style.display = 'block';
            //     break;
            // case 'google_gemini_api':
            //     document.getElementById('google_gemini_api').style.display = 'block';
            //     break;
        }

        const apiValues = getAPIValuesFromUI();
        Object.assign(newItemData, apiValues);

        let newItem = promptsList.add(newItemData);
        idnumMax++;
        let curr_idnum = newItem[0].values().idnum;
        let checkboxes = document.querySelectorAll(`tr[data-idnum="${curr_idnum}"] input[type="checkbox"]`);
        checkSelectedBoxes(checkboxes);
        let editBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnEditItem`);
        //console.log(`>>>>>>>>>>>> tr[data-idnum="${curr_idnum}"] button.btnEditItem`);
        editBtn.addEventListener('click', handleEditClick);
        let copyBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnCopyItem`);
        copyBtn.addEventListener('click', handleCopyClick);
        //console.log('>>>>>>>>>>>>> editBtn: ' + JSON.stringify(editBtn));
        let deleteBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnDeleteItem`);
        //console.log(`>>>>>>>>>>>> tr[data-idnum="${curr_idnum}"] button.btnDeleteItem`);
        deleteBtn.addEventListener('click', handleDeleteClick);
        let okBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnConfirmItem`);
        okBtn.addEventListener('click', handleConfirmClick);
        let cancelBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnCancelItem`);
        cancelBtn.addEventListener('click', handleCancelClick);
        let menuPositionBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnMenuPositionItem`);
        if (menuPositionBtn) menuPositionBtn.addEventListener('click', handleMenuPositionClick);
        // Normalize the read-only connection/API info boxes for the new row, the
        // same way loadPromptsList does at page load (a freshly added prompt has
        // no connection specified, so these boxes must be hidden).
        let newTr = document.querySelector(`tr[data-idnum="${curr_idnum}"]`);
        if (newTr) {
            toggleApiPropertiesShow(newTr);
            toggleAdditionalPropertiesShow(newTr);
            // Attach the additional-info toggle listeners that are otherwise only
            // wired up at page load, so the new row's [API]/[ChatGPT Web] panels
            // are clickable without needing a save+reload first.
            let apiToggle = newTr.querySelector('.api_additional_info_toggle');
            if (apiToggle) apiToggle.addEventListener('click', handleApiInfoToggleClick);
            if (prefs.connection_type == 'chatgpt_web') {
                let cgwToggle = newTr.querySelector('.chatgpt_web_additional_info_toggle');
                if (cgwToggle) cgwToggle.addEventListener('click', handleChatGPTWebInfoToggleClick);
                newTr.querySelectorAll('input.chatgpt_web_project_output, input.chatgpt_web_custom_gpt_output').forEach(element => {
                    element.addEventListener("input", validateCustomData_ChatGPTWeb);
                });
            }
        }
        // console.log('>>>>>>>>>>>>> deleteBtn: ' + JSON.stringify(deleteBtn));
        // console.log('>>>>>>>>>>>>> newItem: ' + JSON.stringify(newItem));
        document.getElementById('btnNew').disabled = false;
        clearFields();
        setSomethingChanged();
        i18n.updateDocument();
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
          });
    });

    //Import Export
    const btnExportAll = document.getElementById('btnExportAll');
    btnExportAll.addEventListener('click', (e) => {
        e.preventDefault();
        exportPrompts();
    });

    async function exportPrompts() {
        const manifest = browser.runtime.getManifest();
        const addonVersion = manifest.version;
        const include_api_settings = await showYesNoDialog(browser.i18n.getMessage("customPrompts_export_include_api_settings"));
        if (include_api_settings === null) return;
        const outputPrompts = preparePromptsForExport(await getPrompts(), include_api_settings);
        let outputObj = {id: 'thunderai-prompts', addon_version: addonVersion, prompts: outputPrompts};
        const blob = new Blob([JSON.stringify(outputObj, null, 2)], {
            type: "application/json",
          });
        const currentDate = new Date();
        const time_stamp = `${currentDate.getFullYear()}${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${String(currentDate.getHours()).padStart(2, '0')}${String(currentDate.getMinutes()).padStart(2, '0')}${String(currentDate.getSeconds()).padStart(2, '0')}`;
        messenger.downloads.download({
            url: URL.createObjectURL(blob),
            filename: `thunderai-prompts-${time_stamp}.json`,
            saveAs: true,
        });
    }

    async function showYesNoDialog(message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('dialog');
            dialog.className = 'export';
            // Colors (incl. dark mode) come from the `dialog.export` rule in the
            // stylesheet, which reads the shared design tokens.

            const text = document.createElement('p');
            text.textContent = message;
            text.style.marginBottom = '20px';
            text.style.fontSize = '14px';
            text.style.lineHeight = '1.5';
            dialog.appendChild(text);
            
            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.justifyContent = 'flex-end';
            btnContainer.style.gap = '10px';
            
            const createBtn = (text, bgColor) => {
                const btn = document.createElement('button');
                btn.textContent = text;
                btn.style.padding = '8px 16px';
                btn.style.borderRadius = '4px';
                btn.style.border = 'none';
                btn.style.cursor = 'pointer';
                btn.style.fontSize = '14px';
                btn.style.color = 'white';
                btn.style.backgroundColor = bgColor;
                return btn;
            };

            const cancelBtn = createBtn(browser.i18n.getMessage("customPrompts_btnCancel"), '#6c757d');
            cancelBtn.onclick = () => {
                dialog.close();
                dialog.remove();
                resolve(null);
            };

            const noBtn = createBtn(browser.i18n.getMessage("no_string"), '#007bff');
            noBtn.onclick = () => {
                dialog.close();
                dialog.remove();
                resolve(false);
            };
            
            const yesBtn = createBtn(browser.i18n.getMessage("yes_string"), '#6c757d');
            yesBtn.onclick = () => {
                dialog.close();
                dialog.remove();
                resolve(true);
            };
            
            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(noBtn);
            btnContainer.appendChild(yesBtn);
            dialog.appendChild(btnContainer);
            
            document.body.appendChild(dialog);
            dialog.showModal();
        });
    }

    const btnImport = document.getElementById('btnImport');
    btnImport.addEventListener('click', (e) => {
        e.preventDefault();
        importPrompts();
    });

    function importPrompts() {
        if(confirm(browser.i18n.getMessage("importPrompts_confirmText") + '\n' + browser.i18n.getMessage("customPrompts_managePrompts_info_default_2") + '\n' + browser.i18n.getMessage("customPrompts_managePrompts_info_default_3"))) {
            //ask the user to choose a JSON file, and then read it, check if the serialized JSON is valid as generated from exportPrompts(), and if so, add it to the list
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.click();
            input.onchange = async () => {
                setMessage(browser.i18n.getMessage('customPrompts_start_import'));
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = async () => {
                    const json = reader.result;
                    try {
                        const obj = JSON.parse(json);
                        if(obj.id !== 'thunderai-prompts') {
                            alert(browser.i18n.getMessage("importPrompts_invalidFile"));
                            setMessage(browser.i18n.getMessage('importPrompts_invalidFile'),'red');
                            return;
                        }
                        // if(obj.addon_version !== manifest.version) {
                        //     alert(browser.i18n.getMessage("importPrompts_invalidVersion"));
                        //     return;
                        // }
                        if(!Array.isArray(obj.prompts)) {
                            alert(browser.i18n.getMessage("importPrompts_invalidPrompts"));
                            setMessage(browser.i18n.getMessage('customPrompts_invalidPrompts'),'red');
                            return;
                        }
                        //setCustomPrompts(obj.prompts);
                        promptsList.clear();
                        loadPromptsList(await preparePromptsForImport(obj.prompts));
                        setSomethingChanged();
                        i18n.updateDocument();
                        // browser.runtime.sendMessage({command: "reload_menus"});
                        setMessage(browser.i18n.getMessage('customPrompts_import_completed'), 'orange');
                        // msgTimeout = setTimeout(() => {
                        //     clearMessage();
                        // }, 10000);
                    } catch(err) {
                        alert(browser.i18n.getMessage("importPrompts_invalidFile") + ' ' + err);
                        setMessage(browser.i18n.getMessage('importPrompts_invalidFile'),'red');
                        return;
                    }
                };
                reader.readAsText(file);
            };

        };
    }

    document.querySelectorAll('.chatgpt_web_additional_info_show').forEach(element => {
        toggleAdditionalPropertiesShow(element.closest('tr'));
    });
    
    document.querySelectorAll('.api_additional_info_show').forEach(element => {
        toggleApiPropertiesShow(element.closest('tr'));
    });

}, { once: true });

document.getElementById('btnManageCustomDataPH').addEventListener('click', () => {
    openTab('/pages/customdataplaceholders/mzta-custom-dataplaceholders.html');
  });

//========= handling an item in a row 
function handleEditClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    const id = tr.querySelector('.id_output').value.toLowerCase();
    
    // Inject Connection UI if needed
    const anchorId = `api_ui_anchor_${id}`;
    const selectId = `api_type_${id}`;
    const prefix = `prompt_${id}_`;

    if (!document.getElementById(selectId)) {
        injectConnectionUI({
            afterTrId: anchorId,
            selectId: selectId,
            modelId_prefix: prefix,
            no_chatgpt_web: true,
            taLog: taLog,
            customButtonLabel: browser.i18n.getMessage("Reset"),
            customButtonCallback: () => {
                resetApiSettings(selectId, id);
            }
        }).then(() => {
            populateConnectionUI(tr, id, prefix, selectId);
            updateWarnings(prefix);
        });
    } else {
        populateConnectionUI(tr, id, prefix, selectId);
        updateWarnings(prefix);
    }

    // Show/Hide buttons
    //console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    e.target.style.display = 'none';    // Edit btn
    tr.querySelector('.btnConfirmItem').style.display = 'flex';   // Save btn
    tr.querySelector('.btnCancelItem').style.display = 'flex';   // Cancel btn
//        tr.querySelector('.btnEditItem').style.display = 'none';   // Edit btn
    tr.querySelector('.btnCopyItem').style.display = 'none';   // Copy btn
    tr.querySelector('.btnDeleteItem').style.display = 'none';   // Delete btn
    showItemRowEditor(tr);
    toggleDiffviewer(e);
    toggleAdditionalPropertiesShow(tr);
}

function resetApiSettings(selectId, id = null) {
    let prefix = '';
    if (id) prefix = `prompt_${id}_`;
    const selectEl = document.getElementById(selectId);
    if (selectEl) {
        selectEl.value = '';
        selectEl.dispatchEvent(new Event('change'));
    }

    // Clear UI inputs
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputId = `${prefix}${propName}`;
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
                if (inputEl.type === 'checkbox') {
                    inputEl.checked = false;
                } else {
                    inputEl.value = '';
                }
            }
        }
    }

    // Update promptsList
    const item = promptsList.get('id', id)[0];
    if (item) {
        let newValues = item.values();
        newValues.api_type = '';
        for (const [integration, options] of Object.entries(integration_options_config)) {
            for (const key of Object.keys(options)) {
                const propName = `${integration}_${key}`;
                newValues[propName] = '';
            }
        }
        item.values(newValues);
    }
    setSomethingChanged();
}

function populateConnectionUI(tr, id, prefix, selectId) {
    const item = promptsList.get('id', id)[0];
    const itemValues = item.values();

    const selectEl = document.getElementById(selectId);
    if (selectEl) {
        selectEl.value = itemValues.api_type || '';
        showConnectionOptions(selectEl);
    }

    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputId = `${prefix}${propName}`;
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
                let val = itemValues[propName];
                // Use default if undefined or empty string (for text inputs)
                if (val === undefined || (inputEl.type !== 'checkbox' && val === '')) {
                    if (prefs[propName] !== undefined) {
                        val = prefs[propName];
                    }
                }
                if (inputEl.type === 'checkbox') {
                    inputEl.checked = (val === true || val === 'true');
                } else {
                    if (inputEl.tomselect) {
                        const restoreValue = val || '';
                        let optionExists = Array.from(inputEl.options).some(opt => opt.value === restoreValue);
                        if (!optionExists && restoreValue !== '') {
                            let newOption = new Option(restoreValue, restoreValue);
                            inputEl.add(newOption);
                        }
                        inputEl.value = restoreValue;
                        inputEl.tomselect.sync();
                        inputEl.tomselect.setValue(restoreValue, true);
                        setTomSelectBorder(inputEl.tomselect);
                    } else {
                        inputEl.value = val || '';
                    }
                }
            }
        }
    }
    i18n.updateDocument();
}

/*
 *  Attaches the highlight mirror plus token validation to a prompt textarea.
 *
 *  Token validity depends on the prompt's selected type, so the type selector is
 *  read lazily on every token and a 'change' listener repaints the mirror. There
 *  was no listener on .type_output / #selectTypeNew before this: the autocomplete
 *  reads the type per keystroke and never needed one, but the mirror caches its
 *  render and would otherwise keep showing stale warnings after a type change.
 */
function attachHighlightWithValidation(textarea) {
    // Idempotent, like attachEditorHighlight itself: showItemRowEditor() re-runs
    // on every entry into edit mode.
    const existing = getEditorHighlight(textarea);
    const handle = existing || attachEditorHighlight(textarea);
    if (!handle) return null;

    // The add-form textarea has no row; its selector is #selectTypeNew.
    const tr = textarea.closest('tr');
    const typeSelect = textarea.classList.contains('input_new')
        ? document.getElementById('selectTypeNew')
        : (tr ? tr.querySelector('.type_output') : null);

    if (!existing) {
        handle.setTokenStateResolver(makeTokenStateResolver(
            placeholdersUtils.findPlaceholder,
            activePlaceholders,
            typeSelect ? () => typeSelect.value : null));
    }

    if (typeSelect && !typeSelect._mztaHighlightSync) {
        typeSelect._mztaHighlightSync = true;
        typeSelect.addEventListener('change', () => {
            const h = getEditorHighlight(textarea);
            if (h) h.refresh();
        });
    }
    return handle;
}

/*
 *  Writes a value into a textarea programmatically and repaints its highlight
 *  mirror.
 *
 *  A direct `.value =` assignment fires no 'input' event, and the mirror only
 *  repaints on 'input': the previous text and its chips would stay painted
 *  behind the new content. Every programmatic write to a `.editor` textarea
 *  must go through here. Safe on a textarea with no mirror attached.
 */
function setEditorValue(textarea, value) {
    if (!textarea) return;
    textarea.value = value;
    const handle = getEditorHighlight(textarea);
    if (handle) handle.refresh();
}

function showItemRowEditor(tr) {
    tr.querySelector('.id_output').style.display = 'inline';
    tr.querySelector('.id_show').style.display = 'none';
    tr.querySelector('.name_output').style.display = 'inline';
    tr.querySelector('.name_show').style.display = 'none';
    const text_output = tr.querySelector('.text_output');
    // 'block', not 'inline': the highlight backdrop is absolutely positioned
    // against this box, and an inline textarea would not align with it.
    text_output.style.display = 'block';
    textareaAutocomplete(text_output, autocompleteSuggestions)
    // Both calls are idempotent, so re-entering edit mode on the same row does
    // not stack listeners or mirrors.
    attachHighlightWithValidation(text_output);
    tr.querySelector('.text_show').style.display = 'none';
    toggleAdditionalPropertiesEditor(tr);
    tr.querySelector('.chatgpt_web_additional_info_show').style.display = 'none';
    tr.querySelector('.api_additional_info_show').style.display = 'none';
    tr.querySelector('.type_output').style.display = 'inline';
    tr.querySelector('.type_show').style.display = 'none';
    const action_output = tr.querySelector('.action_output')
    action_output.style.display = 'inline';
    action_output.addEventListener('change', toggleDiffviewer);
    tr.querySelector('.action_show').style.display = 'none';
    tr.querySelector('input.need_selected').disabled = false;
    tr.querySelector('input.need_signature').disabled = false;
    tr.querySelector('input.need_custom_text').disabled = false;
    tr.querySelector('input.define_response_lang').disabled = false;
    tr.querySelector('input.use_diff_viewer').disabled = false;
}

function hideItemRowEditor(tr) {
    tr.querySelector('.id_output').style.display = 'none';
    tr.querySelector('.id_show').style.display = 'inline';
    tr.querySelector('.name_output').style.display = 'none';
    tr.querySelector('.name_show').style.display = 'inline';
    const text_output_hide = tr.querySelector('.text_output');
    const highlight = getEditorHighlight(text_output_hide);
    if (highlight) highlight.destroy();
    // The autocomplete must go down with the mirror it reads the caret from,
    // and its close() drops the row from the shared open-instances set.
    if (text_output_hide._mztaAutocomplete) text_output_hide._mztaAutocomplete.destroy();
    text_output_hide.style.display = 'none';
    tr.querySelector('.text_show').style.display = 'inline';
    tr.querySelector('.chatgpt_web_additional_info_toggle').style.display = 'none';
    tr.querySelector('.chatgpt_web_additional_info').style.display = 'none';
    tr.querySelector('.api_additional_info_toggle').style.display = 'none';
    tr.querySelector('.api_additional_info').style.display = 'none';
    toggleAdditionalPropertiesShow(tr);
    tr.querySelector('.type_output').style.display = 'none';
    tr.querySelector('.type_show').style.display = 'inline';
    const action_output = tr.querySelector('.action_output')
    action_output.style.display = 'none';
    action_output.addEventListener('change', toggleDiffviewer);
    tr.querySelector('.action_show').style.display = 'inline';
    tr.querySelector('input.need_selected').disabled = true;
    tr.querySelector('input.need_signature').disabled = true;
    tr.querySelector('input.need_custom_text').disabled = true;
    tr.querySelector('input.define_response_lang').disabled = true;
    tr.querySelector('input.use_diff_viewer').disabled = true;
}

function toggleAdditionalPropertiesShow(tr) {
    // console.log(">>>>>>>>>>>>>>>>> toggleAdditionalPropertiesShow tr.querySelector('.api_type_show').innerText: " + tr.querySelector('.api_type_show').innerText);
    let element = tr.querySelector('.chatgpt_web_additional_info_show');
    let chatGPTWebModel_show = tr.querySelector('.chatgpt_web_model_show');
    let chatGPTWebProject_show = tr.querySelector('.chatgpt_web_project_show');
    let chatGPTWebCustomGPT_show = tr.querySelector('.chatgpt_web_custom_gpt_show');
    if(prefs.connection_type == 'chatgpt_web' && tr.querySelector('.api_type_show').innerText == '') {
        if ((chatGPTWebModel_show.innerText !== '' && chatGPTWebModel_show.innerText !== 'undefined') || 
            (chatGPTWebProject_show.innerText !== '' && chatGPTWebProject_show.innerText !== 'undefined') || 
            (chatGPTWebCustomGPT_show.innerText !== '' && chatGPTWebCustomGPT_show.innerText !== 'undefined')) {
            element.style.display = 'flex';
        } else {
            element.style.display = 'none';
        }

        if(chatGPTWebModel_show.innerText === '' || chatGPTWebModel_show.innerText === 'undefined') {
            chatGPTWebModel_show.parentNode.style.display = 'none';
        } else {
            chatGPTWebModel_show.parentNode.style.display = 'inline';
        }
        if(chatGPTWebProject_show.innerText === '' || chatGPTWebProject_show.innerText === 'undefined') {
            chatGPTWebProject_show.parentNode.style.display = 'none';
        } else {
            chatGPTWebProject_show.parentNode.style.display = 'inline';
        }
        if(chatGPTWebCustomGPT_show.innerText === '' || chatGPTWebCustomGPT_show.innerText === 'undefined') {
            chatGPTWebCustomGPT_show.parentNode.style.display = 'none';
        } else {
            chatGPTWebCustomGPT_show.parentNode.style.display = 'inline';
        }
    }else{
        element.style.display = 'none';
        chatGPTWebModel_show.parentNode.style.display = 'none';
        chatGPTWebProject_show.parentNode.style.display = 'none';
        chatGPTWebCustomGPT_show.parentNode.style.display = 'none';
    }
}

// Click handler for the per-row [API] additional info toggle. Defined at module
// scope so it can be attached both at page load and to rows added at runtime.
function handleApiInfoToggleClick(e) {
    e.preventDefault();
    const element = e.currentTarget;
    let additionalInfoRow = element.nextElementSibling;
    if (additionalInfoRow.style.display === 'none' || additionalInfoRow.style.display === '') {
        additionalInfoRow.style.display = 'block';
        element.innerText = browser.i18n.getMessage('customPrompts_hide_additional_info') + ' [API]';
    } else {
        additionalInfoRow.style.display = 'none';
        element.innerText = browser.i18n.getMessage('customPrompts_show_additional_info') + ' [API]';
    }
}

// Click handler for the per-row [ChatGPT Web] additional info toggle.
function handleChatGPTWebInfoToggleClick(e) {
    e.preventDefault();
    let additionalInfoRow = e.target.closest('td').querySelector('.chatgpt_web_additional_info');
    if (additionalInfoRow.style.display === 'none' || additionalInfoRow.style.display === '') {
        additionalInfoRow.style.display = 'block';
        e.target.innerText = browser.i18n.getMessage('customPrompts_hide_additional_info') + ' [ChatGPT Web]';
    } else {
        additionalInfoRow.style.display = 'none';
        e.target.innerText = browser.i18n.getMessage('customPrompts_show_additional_info') + ' [ChatGPT Web]';
    }
}

function toggleApiPropertiesShow(tr) {
    let element = tr.querySelector('.api_additional_info_show');
    let api_type_show = tr.querySelector('.api_type_show');

    if (api_type_show.innerText !== '' && api_type_show.innerText !== 'undefined') {
        element.style.display = 'flex';
    } else {
        element.style.display = 'none';
    }

    if(api_type_show.innerText === '' || api_type_show.innerText === 'undefined') {
        api_type_show.parentNode.style.display = 'none';
    } else {
        api_type_show.parentNode.style.display = 'inline';
    }
}

function toggleAdditionalPropertiesEditor(tr) {
    if(prefs.connection_type == 'chatgpt_web' && tr.querySelector('.api_type_show').innerText == '') {
        let info_toggle = tr.querySelector('.chatgpt_web_additional_info_toggle');
        info_toggle.style.display = 'block';
        let chatGPTWebModel_show = tr.querySelector('.chatgpt_web_model_show').innerText;
        let chatGPTWebProject_show = tr.querySelector('.chatgpt_web_project_show').innerText;
        let chatGPTWebCustomGPT_show = tr.querySelector('.chatgpt_web_custom_gpt_show').innerText;

        if ((chatGPTWebModel_show !== '' && chatGPTWebModel_show !== 'undefined') || 
            (chatGPTWebProject_show !== '' && chatGPTWebProject_show !== 'undefined') || 
            (chatGPTWebCustomGPT_show !== '' && chatGPTWebCustomGPT_show !== 'undefined')) {
            info_toggle.click();
        }
    }

    let api_info_toggle = tr.querySelector('.api_additional_info_toggle');
    api_info_toggle.style.display = 'block';
    let api_type_show = tr.querySelector('.api_type_show').innerText;

    if (api_type_show !== '' && api_type_show !== 'undefined') {
        api_info_toggle.click();
    }
}

function toggleDiffviewer(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    const action = tr.querySelector('.action_output').value;
    const checkbox = tr.querySelector('.use_diff_viewer');
    if (action === "2") {
        checkbox.disabled = false;
    } else {
        checkbox.checked = false;
        checkbox.setAttribute('checked_val', '0');
        checkbox.disabled = true;
    }
    //console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    //console.log('>>>>>>>> action: ' + action);
    //console.log('>>>>>>>> checkbox: ' + checkbox.checked);
    //console.log('>>>>>>>> checkbox: ' + checkbox.style.display);
}


// Confirm and log deletion action
function handleDeleteClick(e) {
    e.preventDefault();
    const checkConfirm = window.confirm(browser.i18n.getMessage("customPrompts_btnDelete_confirmText"));
    if (!checkConfirm) {
        return;
    }
    const tr = e.target.parentNode.parentNode;
    //console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    promptsList.remove("id", tr.querySelector('span.id').innerText);
    setSomethingChanged();
}

function handleCancelClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    e.target.style.display = 'none';    // Cancel btn
    tr.querySelector('.btnConfirmItem').style.display = 'none';   // Save btn
//        tr.querySelector('.btnCancelItem').style.display = 'none';   // Cancel btn
    tr.querySelector('.btnEditItem').style.display = '';   // Edit btn
    tr.querySelector('.btnCopyItem').style.display = '';   // Copy btn
    tr.querySelector('.btnDeleteItem').style.display = '';   // Delete btn
    tr.querySelector('.id_output').value = tr.querySelector('.id_show').innerText.toLocaleUpperCase();
    tr.querySelector('.name_output').value = tr.querySelector('.name_show').innerText;
    tr.querySelector('.text_output').value = sanitizeHtml(tr.querySelector('.text_show').innerHTML).replace(/<br\s*\/?>/gi, "\n");
    tr.querySelector('.type_output').value = tr.querySelector('.type').innerText;
    // tr.querySelector('.type_output').selectedOptions[0].text = tr.querySelector('.type_show').innerText;
    tr.querySelector('.action_output').value = tr.querySelector('.action').innerText;
    // tr.querySelector('.action_output').selectedOptions[0].text = tr.querySelector('.action_show').innerText;
    tr.querySelector('.chatgpt_web_model_output').value = tr.querySelector('.chatgpt_web_model_show').innerText;
    tr.querySelector('.chatgpt_web_project_output').value = tr.querySelector('.chatgpt_web_project_show').innerText;
    tr.querySelector('.chatgpt_web_custom_gpt_output').value = tr.querySelector('.chatgpt_web_custom_gpt_show').innerText;
    tr.querySelector('.api_additional_info_toggle').innerText = browser.i18n.getMessage('customPrompts_show_additional_info') + ' [API]';
    toggleApiPropertiesShow(tr);
    hideItemRowEditor(tr);
}

function handleConfirmClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    e.target.style.display = 'none';    // Ok btn

    const oldId = tr.querySelector('.id_show').innerText;
    const prefix = `prompt_${oldId}_`;
    const selectId = `api_type_${oldId}`;
    
    let newValues = {};
    
    // Standard fields
    newValues.id = tr.querySelector('.id_output').value.trim().toLowerCase();
    newValues.name = tr.querySelector('.name_output').value.trim();
    newValues.text = tr.querySelector('.text_output').value;
    newValues.type = tr.querySelector('.type_output').value;
    newValues.action = tr.querySelector('.action_output').value;
    newValues.need_selected = tr.querySelector('.need_selected').checked ? 1 : 0;
    newValues.need_signature = tr.querySelector('.need_signature').checked ? 1 : 0;
    newValues.need_custom_text = tr.querySelector('.need_custom_text').checked ? 1 : 0;
    newValues.define_response_lang = tr.querySelector('.define_response_lang').checked ? 1 : 0;
    newValues.use_diff_viewer = tr.querySelector('.use_diff_viewer').checked ? 1 : 0;
    newValues.chatgpt_web_model = tr.querySelector('.chatgpt_web_model_output').value.trim();
    newValues.chatgpt_web_project = tr.querySelector('.chatgpt_web_project_output').value.trim();
    newValues.chatgpt_web_custom_gpt = tr.querySelector('.chatgpt_web_custom_gpt_output').value.trim();

    const selectEl = document.getElementById(selectId);
    if(selectEl) newValues.api_type = selectEl.value;

    const apiValues = getAPIValuesFromUI(prefix);
    Object.assign(newValues, apiValues);
    promptsList.get('id', oldId)[0].values(newValues);

//        tr.querySelector('.btnConfirmItem').style.display = 'none';   // Ok btn
    tr.querySelector('.btnCancelItem').style.display = 'none';   // Cancel btn
    tr.querySelector('.btnEditItem').style.display = '';   // Edit btn
    tr.querySelector('.btnCopyItem').style.display = '';   // Copy btn
    tr.querySelector('.btnDeleteItem').style.display = '';   // Delete btn
    // Update item data
    tr.querySelector('.type').innerText = tr.querySelector('.type_output').value;
    tr.querySelector('.type_show').innerText = tr.querySelector('.type_output').selectedOptions[0].text;
    tr.querySelector('.action').innerText = tr.querySelector('.action_output').value;
    tr.querySelector('.action_show').innerText = tr.querySelector('.action_output').selectedOptions[0].text;
    if (newValues.api_type !== '') {
        tr.querySelector('.api_type_show').innerText = newValues.api_type;
        toggleApiPropertiesShow(tr);
    
    }
    // the checkboxes update is handled directly by themselves
    hideItemRowEditor(tr);
    // List.js rewrote .text_show from the saved value, which strips the chips and
    // does not fire 'updated' (it only re-rendered this one row), so re-decorate.
    decoratePromptText();
    setSomethingChanged();
}

// Open the Menu Order page and highlight this prompt there. Placement is owned by
// that page now; this is the deep-link from the editor.
function handleMenuPositionClick(e) {
    e.preventDefault();
    const tr = e.target.closest('tr');
    const promptId = tr.querySelector('.id_output').value.trim().toLowerCase();
    revealPromptInMenuOrder(promptId);
}

// Handle checkbox changes and log new state
async function handleCheckboxChange(e) {
    e.preventDefault();
    e.target.setAttribute('checked_val', e.target.checked ? '1' : '0');

    // List rows only: the #formNew checkbox shares this class but has no backing
    // List.js item yet (its `tr` carries no data-idnum).
    if (e.target.classList.contains('need_custom_text') && !e.target.closest('#formNew')) {
        let tr = e.target.closest('tr');
        if (tr) {
            let idnum = tr.getAttribute('data-idnum');
            let item = promptsList.get('idnum', idnum);
            if (item && item.length > 0) {
                item[0]._values.need_custom_text = e.target.checked ? 1 : 0;
            }
        }
    }

    //console.log('>>>>>>>> checked_val: ' + e.target.getAttribute('checked_val'));
    if (e.target.classList.contains('need_selected') || e.target.classList.contains('need_custom_text') || e.target.classList.contains('need_selected_new') || e.target.classList.contains('need_custom_text_new')) {
        let textarea = e.target.closest('tr').querySelector('.text_output');
        await checkPromptsConfigForPlaceholders(textarea);
    }
    
}

// Enable save button on input change
function handleInputChange(e) {
    e.preventDefault();
    setSomethingChanged();
}

function handleCopyClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    
    let id = tr.querySelector('.id_output').value;
    let name = tr.querySelector('.name_output').value;
    let text = tr.querySelector('.text_output').value;
    let type = tr.querySelector('.type_output').value;
    let action = tr.querySelector('.action_output').value;
    
    let need_selected = tr.querySelector('.need_selected').checked;
    let need_signature = tr.querySelector('.need_signature').checked;
    let need_custom_text = tr.querySelector('.need_custom_text').checked;
    let define_response_lang = tr.querySelector('.define_response_lang').checked;
    let use_diff_viewer = tr.querySelector('.use_diff_viewer').checked;
    
    let chatgpt_web_model = tr.querySelector('.chatgpt_web_model_output').value;
    let chatgpt_web_project = tr.querySelector('.chatgpt_web_project_output').value;
    let chatgpt_web_custom_gpt = tr.querySelector('.chatgpt_web_custom_gpt_output').value;

    const item = promptsList.get('id', id.toLowerCase())[0];
    const itemValues = item.values();

    // Populate new form
    document.getElementById('txtIdNew').value = id + '_' + browser.i18n.getMessage("copy_text");
    document.getElementById('txtNameNew').value = name + ' (' + browser.i18n.getMessage("copy_text") + ')';
    // Type before text: token validity depends on it and setEditorValue repaints
    // immediately, so writing the text first would paint one frame validated
    // against the previous prompt's type. Note `selectTypeNew.value = …` fires no
    // 'change', so the refresh listener on that select does not cover this.
    document.getElementById('selectTypeNew').value = type;
    setEditorValue(document.getElementById('txtTextNew'), text);
    document.getElementById('selectActionNew').value = action;
    
    document.getElementById('checkboxNeedSelectedNew').checked = need_selected;
    document.getElementById('checkboxNeedSignatureNew').checked = need_signature;
    document.getElementById('checkboxNeedCustomTextNew').checked = need_custom_text;
    document.getElementById('checkboxDefineResponseLangNew').checked = define_response_lang;
    
    let checkboxUseDiffViewerNew = document.getElementById('checkboxUseDiffViewerNew');
    checkboxUseDiffViewerNew.checked = use_diff_viewer;
    checkboxUseDiffViewerNew.disabled = (action !== "2");
    updateUseDiffViewerHint();

    document.getElementById('chatGPTWebModelNew').value = chatgpt_web_model;
    document.getElementById('chatGPTWebProjectNew').value = chatgpt_web_project;
    document.getElementById('chatGPTWebCustomGPTNew').value = chatgpt_web_custom_gpt;

    const apiSelect = document.getElementById('new_prompt_api_type');
    if (apiSelect) {
        apiSelect.value = itemValues.api_type || '';
        apiSelect.dispatchEvent(new Event('change'));
        
        for (const [integration, options] of Object.entries(integration_options_config)) {
            for (const key of Object.keys(options)) {
                const propName = `${integration}_${key}`;
                const inputEl = document.getElementById(propName);
                if (inputEl) {
                    let val = itemValues[propName];
                    if (val === undefined) val = '';
                    
                    if (inputEl.type === 'checkbox') {
                        inputEl.checked = (val === true || val === 'true');
                    } else {
                        if (inputEl.tomselect) {
                            inputEl.tomselect.setValue(val, true);
                            setTomSelectBorder(inputEl.tomselect);
                        } else {
                            inputEl.value = val;
                        }
                    }
                }
            }
        }
    }

    // Show form
    document.getElementById('formNew').style.display = 'block';
    document.getElementById('btnNew').disabled = true;

    // Scroll to top
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
    checkFields();
}

//========= handling an item in a row - END

// Wrap {%placeholder%} tokens in the visible prompt text with a styled chip.
// Only touches the read-only .text_show spans (never the editable textarea),
// and is idempotent (skips spans already decorated).
// Uses PLACEHOLDER_RE, the same pattern the edit-mode backdrop uses, and
// placeholdersUtils.findPlaceholder, the same predicate the edit-mode resolver
// uses, so read mode and edit mode can never disagree — neither on what counts
// as a token, nor on whether that token actually resolves.
function decoratePromptText() {
    // activePlaceholders is filled by an await that runs AFTER the first call to
    // this function (loadPromptsList -> decoratePromptText is synchronous, and
    // happens earlier in DOMContentLoaded). With an empty list findPlaceholder()
    // resolves nothing, so classifying now would paint every token on the page
    // as invalid; skip the validity pass until the list is in. The
    // DOMContentLoaded handler re-runs this right after the await.
    const canValidate = Array.isArray(activePlaceholders) && activePlaceholders.length > 0;
    const unknownTitle = canValidate
        ? browser.i18n.getMessage('editor_placeholder_unknown')
        : '';

    document.querySelectorAll('#all_prompts .text_show').forEach(span => {
        // The guard is keyed to the *decorated result*, not to a plain '1' flag:
        // saving a row makes List.js rewrite this span in place (chips and all)
        // without firing 'updated', so a boolean flag would stay stale and the
        // prompt would lose its highlighting until the next full re-render.
        // It also self-invalidates when the validity pass changes the markup,
        // which is what lets the post-await re-run actually repaint.
        if (span.dataset.phDecorated === span.innerHTML) return;
        // PLACEHOLDER_RE carries /g and therefore lastIndex state; reset before
        // each use so a previous call cannot make this one start mid-string.
        PLACEHOLDER_RE.lastIndex = 0;
        if (!PLACEHOLDER_RE.test(span.innerHTML)) {
            span.dataset.phDecorated = span.innerHTML;
            return;
        }

        // The row's prompt type, read from the very element
        // attachHighlightWithValidation() reads in edit mode, so the two modes
        // filter by type identically.
        const tr = span.closest('tr');
        const typeSelect = tr ? tr.querySelector('.type_output') : null;
        const typeSpan = tr ? tr.querySelector('.type') : null;
        const rawType = typeSelect ? typeSelect.value
            : (typeSpan ? typeSpan.innerText.trim() : null);
        const type = (rawType === null || rawType === '') ? null : rawType;

        // Rebuilt with DOM nodes rather than an innerHTML write: the token text
        // comes from user-authored prompts, so it must never be re-parsed as
        // markup. Existing <br> elements are the only structure this span can
        // legitimately carry (List.js renders the stored text, which encodes
        // newlines as <br>), so they are carried over as real elements and
        // everything else is treated as plain text.
        const frag = document.createDocumentFragment();
        span.childNodes.forEach(node => {
            if (node.nodeType !== Node.TEXT_NODE) {
                frag.appendChild(node.cloneNode(true));
                return;
            }
            const text = node.nodeValue;
            PLACEHOLDER_RE.lastIndex = 0;
            let pos = 0;
            let m;
            while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
                if (m.index > pos) {
                    frag.appendChild(document.createTextNode(text.slice(pos, m.index)));
                }
                const chip = document.createElement('span');
                chip.className = 'ph_chip';
                if (canValidate && !placeholdersUtils.findPlaceholder(m[1], activePlaceholders, type)) {
                    chip.classList.add('ph_chip_invalid_read');
                    chip.title = unknownTitle;
                }
                chip.textContent = m[0];
                frag.appendChild(chip);
                pos = m.index + m[0].length;
            }
            if (pos < text.length) {
                frag.appendChild(document.createTextNode(text.slice(pos)));
            }
        });
        span.replaceChildren(frag);
        span.dataset.phDecorated = span.innerHTML;
    });
}

// Keep the card footer prompt count in sync with the rendered list. When the
// search filter is narrowing the list, report "shown of total" instead.
function updatePromptsCount() {
    const el = document.getElementById('prompts_count');
    if (!el) return;
    const total = promptsList ? promptsList.items.length : 0;
    const shown = promptsList ? promptsList.matchingItems.length : total;
    if (promptsList && promptsList.searched && shown !== total) {
        el.textContent = browser.i18n.getMessage('customPrompts_promptsCount_filtered', [String(shown), String(total)]);
    } else {
        el.textContent = browser.i18n.getMessage('customPrompts_promptsCount', [String(total)]);
    }
}

// Built-in prompts store their name as a "__MSG_key__" token, localized only
// after render by i18n.updateDocument(). Resolve it so the search matches the
// label the user actually sees. Same approach as resolveName() in mzta-prompts.js.
function resolvePromptName(name) {
    const n = name ?? '';
    if (typeof n === 'string' && n.startsWith('__MSG_') && n.endsWith('__')) {
        return browser.i18n.getMessage(n.substring(6, n.length - 2)) || n;
    }
    return String(n);
}

// The needle currently painted into the visible rows, so the highlight pass can
// tell "nothing to repaint" from "clear the previous highlight".
let currentSearchNeedle = '';

// Wrap every occurrence of the search needle in the visible Name and ID cells
// with <mark class="search_hit">.
//
// This must run after *every* List.js render, not just on input: item.values()
// writes flow through templater.set(), which resets the `.name`/`.id` content
// from the stored value and so silently drops the marks (the same hazard the
// data-phDecorated guard exists for in decoratePromptText).
//
// Only `.name_show` / `.id_show` are touched. The `_output` inputs stay
// untouched, and they are the single source of truth for every save/cancel/copy
// path (handleConfirmClick, handleCancelClick, handleCopyClick all read
// `.name_output` / `.id_output`), so no highlight markup can ever reach storage.
function highlightSearchMatches() {
    const needle = currentSearchNeedle;
    document.querySelectorAll('#all_prompts .name_show, #all_prompts .id_show').forEach(span => {
        // textContent, NOT innerText: these spans are set to display:none while
        // their row is in edit mode, and innerText returns '' for a hidden
        // element — which would blank the name/ID instead of re-marking it.
        // Reading the text back also strips any <mark> from a previous pass, so
        // re-highlighting is idempotent and marks can never nest.
        const plain = span.textContent;
        if (needle === '') {
            // Nothing to highlight: restore the plain text only if this span was
            // actually marked up, to avoid pointless DOM writes on every render.
            if (span.querySelector('mark.search_hit')) {
                span.textContent = plain;
            }
            return;
        }

        const lower = plain.toLowerCase();
        let pos = 0;
        let at = lower.indexOf(needle);
        if (at === -1) {
            if (span.querySelector('mark.search_hit')) {
                span.textContent = plain;
            }
            return;
        }
        // Built from DOM nodes, never an innerHTML write: the needle and the
        // surrounding name/ID text are user-supplied and must not be re-parsed
        // as markup.
        const frag = document.createDocumentFragment();
        while (at !== -1) {
            if (at > pos) frag.appendChild(document.createTextNode(plain.slice(pos, at)));
            const mark = document.createElement('mark');
            mark.className = 'search_hit';
            mark.textContent = plain.slice(at, at + needle.length);
            frag.appendChild(mark);
            pos = at + needle.length;
            at = lower.indexOf(needle, pos);
        }
        if (pos < plain.length) frag.appendChild(document.createTextNode(plain.slice(pos)));
        span.replaceChildren(frag);
    });
}

// Show/hide the toolbar badge announcing that the list is filtered.
//
// This is deliberately NOT routed through #msgDisplay: that span is owned
// exclusively by setSomethingChanged() / setNothingChanged() / setMessage(),
// which overwrite its text and toggle its display — an unsaved-changes warning
// would silently wipe the filter notice, and setNothingChanged() would hide it.
// The two states are independent and must be able to show at the same time.
function updateFilterIndicator() {
    const badge = document.getElementById('filter_badge');
    const label = document.getElementById('filter_badge_text');
    if (!badge || !label) return;

    const filtering = !!(promptsList && promptsList.searched && currentSearchNeedle !== '');
    if (!filtering) {
        badge.classList.add('hiddendata');
        label.textContent = '';
        return;
    }

    const total = promptsList.items.length;
    const shown = promptsList.matchingItems.length;
    label.textContent = (shown === 0)
        ? browser.i18n.getMessage('customPrompts_filter_noMatches')
        : browser.i18n.getMessage('customPrompts_filter_active', [String(shown), String(total)]);
    badge.classList.toggle('filter_badge_empty', shown === 0);
    badge.classList.remove('hiddendata');
}

// Filter the list on prompt name and ID only (not the prompt body).
// Called from loadPromptsList(), which runs again after an import — the listener
// is therefore attached only once, while the handler reads the current
// promptsList instance through the module-level variable.
let promptsSearchBound = false;
function setupPromptsSearch() {
    const searchInput = document.getElementById('prompts_search');
    if (!searchInput) return;

    // An import replaces the List instance; the field must not keep showing a
    // filter that is no longer applied to the freshly built list.
    searchInput.value = '';
    currentSearchNeedle = '';
    updateFilterIndicator();

    if (promptsSearchBound) return;
    promptsSearchBound = true;

    const btnClearFilter = document.getElementById('btnClearFilter');
    if (btnClearFilter) {
        btnClearFilter.addEventListener('click', (e) => {
            e.preventDefault();
            // Same teardown as typing the field empty, including reverting any
            // row left open in edit mode by the previously filtered view.
            cancelOpenRowEditors();
            clearPromptsSearch();
            searchInput.focus();
        });
    }

    // List.js lowercases and regex-escapes the search string before handing it
    // to a custom search function, so compare against the raw input value.
    const promptsSearch = () => {
        const needle = searchInput.value.trim().toLowerCase();
        promptsList.items.forEach(item => {
            const values = item.values();
            const name = resolvePromptName(values.name).toLowerCase();
            const id = String(values.id ?? '').toLowerCase();
            item.found = name.includes(needle) || id.includes(needle);
        });
    };

    searchInput.addEventListener('input', () => {
        if (!promptsList) return;
        // A row left open in edit mode would keep unsaved edits in a hidden
        // node, so revert any open editor before changing what is visible.
        cancelOpenRowEditors();
        const needle = searchInput.value.trim();
        currentSearchNeedle = needle.toLowerCase();
        // An empty string makes List.js reset the filter entirely.
        promptsList.search(needle, ['name', 'id'], promptsSearch);
        // search() triggers 'updated' only when the visible set changes; repaint
        // unconditionally so narrowing the needle within the same result set
        // (e.g. "re" -> "rep") still moves the marks.
        highlightSearchMatches();
        updateFilterIndicator();
    });
}

// Drop any active search filter and empty the search field.
function clearPromptsSearch() {
    const searchInput = document.getElementById('prompts_search');
    if (searchInput) searchInput.value = '';
    currentSearchNeedle = '';
    if (promptsList && promptsList.searched) promptsList.search('');
    // Strip the marks even when search() was a no-op and fired no 'updated'.
    highlightSearchMatches();
    updateFilterIndicator();
}

// Revert every row currently open in edit mode, discarding its pending edits.
// handleEditClick() reveals the Cancel button with display:flex, so that is the
// marker for "this row has an open editor".
function cancelOpenRowEditors() {
    document.querySelectorAll('.btnCancelItem').forEach(btn => {
        if (btn.style.display === 'flex') {
            btn.click();
        }
    });
}

function loadPromptsList(values){
    // console.log('>>>>>>>> loadPromptsList values: ' + JSON.stringify(values));
    let api_fields = [];
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            api_fields.push(`${integration}_${key}`);
        }
    }

    let options = {
        valueNames: [ { data: ['idnum'] }, 'is_default', 'id', 'name', 'text', 'type', 'action', 'position_compose', 'position_display', 'show_in', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'define_response_lang', attr: 'checked_val'}, { name: 'use_diff_viewer', attr: 'checked_val'}, 'api_type', ...api_fields ],
        item: function(values) {
            let type_output = '';
            switch(String(values.type)){
                case "0":
                    type_output = `__MSG_customPrompts_add_to_menu_always__`;
                    break;
                case "1":
                    type_output = `__MSG_customPrompts_add_to_menu_reading__`;
                    break;
                case "2":
                    type_output = `__MSG_customPrompts_add_to_menu_composing__`;
                    break;
            }

            let action_output = '';
            switch(String(values.action)){
                case "0":
                    action_output = `__MSG_customPrompts_close_button__`;
                    break;
                case "1":
                    action_output = `__MSG_customPrompts_do_reply__`;
                    break;
                case "2":
                    action_output = `__MSG_customPrompts_substitute_text__`;
                    break;
            }

            let output = `<tr ` + ((values.is_default == 1) ? 'class="is_default"':'') + `>
                <td class="w08"><span class="id id_show"></span><input type="text" class="hiddendata id_output" value="` + values.id + `" /></td>
                <td class="w08"><span class="name name_show"></span><input type="text" class="hiddendata name_output" value="` + values.name + `" /></td>
                <td class="w40">
                    <span class="text text_show"></span>
                    <div class="autocomplete-container editor-wrap">
                        <div class="editor-backdrop" aria-hidden="true"><div class="editor-highlights"></div></div>
                        <textarea class="hiddendata text_output editor">` + values.text.replace(/<br\s*\/?>/gi, "\n") + `</textarea>
                        <ul class="autocomplete-list hidden"></ul>
                    </div>
                    <div class="chatgpt_web_additional_info_toggle small_info">__MSG_customPrompts_show_additional_info__ [ChatGPT Web]</div>
                    <div class="chatgpt_web_additional_info">
                        <span class="field_title_us">__MSG_prefs_OptionText_chatgpt_web_model__:</span>
                        <br>
                        <input type="text" id="chatgpt_web_model_output_` + values.id + `" class="input_additional chatgpt_web_model_output" tabindex="10" value="` + values.chatgpt_web_model + `">
                        <br><br>
                        <span class="field_title_us">__MSG_prefs_OptionText_chatgpt_web_project__:</span>
                        <br>
                        <input type="text" id="chatgpt_web_project_` + values.id + `" class="input_additional chatgpt_web_project_output" tabindex="11" value="` + values.chatgpt_web_project + `">
                        <br><i class="small_info" id="chatgpt_web_project_` + values.id + `_info">__MSG_prefs_OptionText_chatgpt_web_custom_data_info__ <b>/g/PROJECT_ID-PROJECT_NAME/project</b>
                            <br>__MSG_prefs_OptionText_chatgpt_web_custom_data_info2__</i>
                        <br><br>
                        <span class="field_title_us">__MSG_prefs_OptionText_chatgpt_web_custom_gpt__:</span>
                        <br>
                        <input type="text" id="chatgpt_web_custom_gpt_` + values.id + `" class="input_additional chatgpt_web_custom_gpt_output" tabindex="11" value="` + values.chatgpt_web_custom_gpt + `">
                        <br><i class="small_info" id="chatgpt_web_custom_gpt_` + values.id + `_info">__MSG_prefs_OptionText_chatgpt_web_custom_data_info__ <b>/g/CUSTOM_GPT_ID</b>
                        <br>__MSG_prefs_OptionText_chatgpt_web_custom_data_info2__
                        <br>__MSG_prefs_OptionText_CustomGPT_Warn__</i>
                    </div>
                    <div class="api_additional_info_toggle small_info">__MSG_customPrompts_show_additional_info__ [API]</div>
                    <div class="api_additional_info" style="display:none">
                        <table style="width:100%; text-align:left;">
                            <tbody id="api_ui_container_` + values.id + `">
                                <tr id="api_ui_anchor_` + values.id + `"><td style="display:none"></td></tr>
                            </tbody>
                        </table>
                    </div>
                </td>
                <td class="w08 menu_cell"><div class="menu_cell_inner"><span class="field_title_s">__MSG_customPrompts_add_to_menu__:</span>
                <br>
                <span class="type_show">` + type_output + `</span>
                <select class="type_output hiddendata">
                <option value="0"` + ((values.type == "0") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_always__</option>
                <option value="1"` + ((values.type == "1") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_reading__</option>
                <option value="2"` + ((values.type == "2") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_composing__</option>
              </select>` +
              `<span class="type hiddendata"></span>
              <br><br>` +
              // Placement (show_in) is no longer editable here — the Menu Order page
              // owns it (reachable via the "Menu position" button). The value is still
              // tracked in this hidden span so it is preserved across edits/saves.
                `<span class="show_in hiddendata"></span>
              <span class="field_title_s">__MSG_customPrompts_form_label_Action__:</span>
                <br><span class="action_show">` + action_output + `</span>
                <select class="action_output hiddendata">
                <option value="0"` + ((values.action == "0") ? ' selected':'') + `>__MSG_customPrompts_close_button__</option>
                <option value="1"` + ((values.action == "1") ? ' selected':'') + `>__MSG_customPrompts_do_reply__</option>
                <option value="2"` + ((values.action == "2") ? ' selected':'') + `>__MSG_customPrompts_substitute_text__</option>
                </select>` +
                `<span class="action hiddendata"></span>
                <button class="btnMenuPositionItem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg><span>__MSG_menu_position_btn_label__</span></button>
              </div></td>
                <td class="w17">
                    <label><span class="need_selected_span"><input type="checkbox" class="need_selected" disabled> __MSG_customPrompts_form_label_need_selected__</span></label>
                    <br>
                    <label><input type="checkbox" class="need_signature" disabled> __MSG_customPrompts_form_label_need_signature__</label>
                    <br>
                    <label><span class="need_custom_text_span"><input type="checkbox" class="need_custom_text` + ((values.is_default == 1) ? ' input_mod':'') + `"` + ((values.is_default == 0) ? ' disabled':'') + ` > __MSG_customPrompts_form_label_need_custom_text__</span></label>
                    <br>
                    <label><input type="checkbox" class="define_response_lang" disabled> __MSG_customprompts_form_label_define_response_lang__</label>
                    <br>
                    <label title="__MSG_customPrompts_form_label_use_diff_viewer_title__"><input type="checkbox" class="use_diff_viewer" disabled> __MSG_customPrompts_form_label_use_diff_viewer__</label>
                    <span class="is_default hiddendata"></span>
                    <span class="position_compose hiddendata"></span>
                    <span class="position_display hiddendata"></span>
                        <div class="chatgpt_web_additional_info_show small_info"><span class="chatgpt_web_additional_info_row field_title"><i>__MSG_customPrompts_show_additional_info_show__ [ChatGPT Web]</i></span>
                        <div class="chatgpt_web_additional_info_row"><span class="field_title">__MSG_prefs_OptionText_chatgpt_web_model__:</span><span class="chatgpt_web_model chatgpt_web_model_show">` + values.chatgpt_web_model + `</span></div>
                        <div class="chatgpt_web_additional_info_row"><span class="field_title">__MSG_prefs_OptionText_chatgpt_web_project__:</span><span class="chatgpt_web_project chatgpt_web_project_show">` + values.chatgpt_web_project + `</span></div>
                        <div class="chatgpt_web_additional_info_row"><span class="field_title">__MSG_prefs_OptionText_chatgpt_web_custom_gpt__:</span><span class="chatgpt_web_custom_gpt chatgpt_web_custom_gpt_show">` + values.chatgpt_web_custom_gpt + `</span></div>
                    </div>
                    <div class="api_additional_info_show small_info">
                        <div class="api_additional_info_row"><span class="field_title">__MSG_prefs_Connection_type__:</span><br/><span class="api_type api_type_show">` + values.api_type + `</span></div>
                    </div>
                </td>
                <td class="actions_cell">
                <button class="btnEditItem"` + ((values.is_default == 1) ? ' disabled':'') + `><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>__MSG_customPrompts_btnEdit__</span></button>
                <button class="btnCancelItem hiddendata"` + ((values.is_default == 1) ? ' disabled':'') + `><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>__MSG_customPrompts_btnCancel__</span></button>
                <button class="btnConfirmItem hiddendata"` + ((values.is_default == 1) ? ' disabled':'') + `><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>__MSG_customPrompts_btnOK__</span></button>
                <button class="btnCopyItem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>__MSG_customPrompts_btnCopy__</span></button>
                <button class="btnDeleteItem"` + ((values.is_default == 1) ? ' disabled':'') + `><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg><span>__MSG_customPrompts_btnDelete__</span></button>
               </td>
            </tr>`;
            //console.log('>>>>>>>> values.name: ' + JSON.stringify(values.name));
            positionMax_compose = Math.max(positionMax_compose, values.position_compose);
            positionMax_display = Math.max(positionMax_display, values.position_display);
            idnumMax = Math.max(idnumMax, values.idnum);
            return output;
        }
    };

    switch(prefs.connection_type) {
        case 'chatgpt_web': {
            options.valueNames.push('chatgpt_web_model', 'chatgpt_web_project', 'chatgpt_web_custom_gpt');
            break;
        }
        // case 'chatgpt_api':
        //     document.getElementById('chatgpt_api').style.display = 'block';
        //     break;
        // case 'ollama_api':
        //     document.getElementById('ollama_api').style.display = 'block';
        //     break;
        // case 'openai_comp_api':
        //     document.getElementById('openai_comp_api').style.display = 'block';
        //     break;
        // case 'google_gemini_api':
        //     document.getElementById('google_gemini_api').style.display = 'block';
        //     break;
    }

    // console.log('>>>>>>>>>>>>> options: ' + JSON.stringify(options));
    // console.log('>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    promptsList = new List('all_prompts', options, values);

    // Decorate the visible prompt text: wrap {%placeholder%} tokens in a code
    // chip, and keep the footer prompt count in sync. Runs after the initial
    // render and on every List.js re-render (sort / filter / add / remove).
    decoratePromptText();
    updatePromptsCount();
    promptsList.on('updated', () => {
        decoratePromptText();
        updatePromptsCount();
        // List.js rewrites the .name/.id spans from the stored values on render,
        // wiping the <mark> wrappers, so they must be repainted every time.
        highlightSearchMatches();
        // Deleting rows while filtered changes both counts, so refresh here too.
        updateFilterIndicator();
    });

    setupPromptsSearch();

    checkSelectedBoxes();
    let btnEditItem_elements = document.querySelectorAll(".btnEditItem");
    btnEditItem_elements.forEach(element => {
        element.addEventListener('click', handleEditClick);
    });

    let btnCopyItem_elements = document.querySelectorAll(".btnCopyItem");
    btnCopyItem_elements.forEach(element => {
        element.addEventListener('click', handleCopyClick);
    });

    let btnDeleteItem_elements = document.querySelectorAll(".btnDeleteItem");
    btnDeleteItem_elements.forEach(element => {
        element.addEventListener('click', handleDeleteClick);
    });

    let btnCancelItem_elements = document.querySelectorAll(".btnCancelItem");
    btnCancelItem_elements.forEach(element => {
        element.addEventListener('click', handleCancelClick);
    });

    let btnConfirmItem_elements = document.querySelectorAll(".btnConfirmItem");
    btnConfirmItem_elements.forEach(element => {
        element.addEventListener('click', handleConfirmClick);
    });

    let btnMenuPositionItem_elements = document.querySelectorAll(".btnMenuPositionItem");
    btnMenuPositionItem_elements.forEach(element => {
        element.addEventListener('click', handleMenuPositionClick);
    });

    let checkbox_elements = document.querySelectorAll("input[type='checkbox']");
    checkbox_elements.forEach(element => {
        element.addEventListener('change', handleCheckboxChange);
    });

    document.querySelectorAll('.input_mod').forEach(element => {
        element.addEventListener('change', handleInputChange);
    });
}

function checkFields() {
    //console.log('>>>>>>>>>>>>> typeof promptsList: ' + typeof promptsList);
    //console.log('>>>>>>>>>>>>> Array.isArray(promptsList): ' + Array.isArray(promptsList));
    // the id must be unique and without spaces
    let is_error = false;
    let id_value = document.getElementById('txtIdNew').value.trim();
    if ((id_value == '')||
    (/\s/.test(id_value))) {
        inputSetError('txtIdNew');
        is_error = true;
    } else {
        let exists = promptsList.get("id", id_value);
        //console.log('>>>>>>>>>>>>> exists: ' + JSON.stringify(exists));
        if(exists && exists.length > 0) {
            inputSetError('txtIdNew');
            is_error = true;
        } else {
            inputClearError('txtIdNew');
        }
    }
    if (document.getElementById('txtNameNew').value.trim() == '') {
        inputSetError('txtNameNew');
        is_error = true;
    } else {
        inputClearError('txtNameNew');
    }
    if (document.getElementById('txtTextNew').value.trim() == '') {
        inputSetError('txtTextNew');
        is_error = true;
    } else {
        inputClearError('txtTextNew');
    }
    document.getElementById('btnAddNew').disabled = is_error;
    return !is_error;
}


// The diff viewer flag only applies when the action is "substitute text", so
// while it's disabled the form spells out the condition under the toggle. Once
// it becomes available the hint is redundant and gets hidden again.
function updateUseDiffViewerHint() {
    const hint = document.getElementById('useDiffViewerNew_hint');
    if (!hint) return;
    const checkbox = document.getElementById('checkboxUseDiffViewerNew');
    hint.classList.toggle('hidden', !checkbox.disabled);
}

function clearFields() {
    document.getElementById('txtIdNew').value = '';
    document.getElementById('txtNameNew').value = '';
    // Not a bare `.value = ''`: that fires no 'input' event, so the highlight
    // mirror would keep painting the previous prompt's text and chips behind the
    // now-empty textarea, and they would still be there the next time the add
    // form is opened.
    setEditorValue(document.getElementById('txtTextNew'), '');
    document.getElementById('chatGPTWebModelNew').value = '';
    document.getElementById('chatGPTWebProjectNew').value = '';
    document.getElementById('chatGPTWebCustomGPTNew').value = '';
    document.getElementById('selectTypeNew').value = '0';
    document.getElementById('selectActionNew').value = '0';
    document.getElementById('checkboxNeedSelectedNew').checked = false;
    document.getElementById('checkboxNeedSignatureNew').checked = false;
    document.getElementById('checkboxNeedCustomTextNew').checked = false;
    document.getElementById('checkboxDefineResponseLangNew').checked = false;
    document.getElementById('checkboxUseDiffViewerNew').checked = false;
    // The action is reset to '0' above, so the diff viewer flag goes back to
    // being not applicable (same state as on page load).
    document.getElementById('checkboxUseDiffViewerNew').disabled = true;
    updateUseDiffViewerHint();
    // Drop any leftover validation rings from the previous edit.
    document.getElementById('checkboxNeedSelectedNew').classList.remove('invalid_flag');
    document.getElementById('checkboxNeedCustomTextNew').classList.remove('invalid_flag');
    document.getElementById('formNew').style.display = 'none';
}

function getAPIValuesFromUI(prefix = '') {
    let values = {};
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputId = `${prefix}${propName}`;
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
                values[propName] = (inputEl.type === 'checkbox') ? inputEl.checked : inputEl.value;
            }
        }
    }
    return values;
}

function inputSetError(input) {
    document.getElementById(input).style.borderColor = 'red';
}

function inputClearError(input) {
    document.getElementById(input).style.borderColor = 'green';
}

function setSomethingChanged(){
    clearTimeout(msgTimeout);
    somethingChanged = true;
    document.getElementById('btnSaveAll').disabled = false;
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = browser.i18n.getMessage('customPrompts_unsaved_changes');
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = 'red';
}

function setNothingChanged(){
    somethingChanged = false;
    document.getElementById('btnSaveAll').disabled = true;
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.disabled = true;
    msgDisplay.textContent = ''
    msgDisplay.style.display = 'none';
    msgDisplay.style.color = '';
}

function checkSelectedBoxes(checkboxes = null) {
    if(checkboxes == null){
        // Restores the list rows' checkboxes from their `checked_val` attribute.
        // Scoped to the prompts list on purpose: the #formNew inputs share these
        // classes (they use the same toggle-switch styling) but carry no
        // `checked_val`, and the else-branch below would then force them all on.
        checkboxes = [
            ...document.querySelectorAll('table.prompts_list .need_selected[type="checkbox"]'),
            ...document.querySelectorAll('table.prompts_list .need_signature[type="checkbox"]'),
            ...document.querySelectorAll('table.prompts_list .need_custom_text[type="checkbox"]'),
            ...document.querySelectorAll('table.prompts_list .define_response_lang[type="checkbox"]'),
            ...document.querySelectorAll('table.prompts_list .use_diff_viewer[type="checkbox"]'),
        ];
    }

    // Iterate through the checkboxes
    checkboxes.forEach(checkbox => {
        // Check if the 'checked' attribute is "0"
        if (checkbox.getAttribute('checked_val') == "0") {
            // Uncheck the checkbox
            checkbox.checked = false;
        } else {
            checkbox.checked = true;
        }
    });
}

//Save all prompts
async function saveAll() {
    setMessage(browser.i18n.getMessage('customPrompts_start_saving'));
    setNothingChanged();
    if(promptsList != null) {
        let newPrompts = promptsList.items.map(item => {
            // For each item in the array, return only the '_values' part
            // console.log(">>>>>>>>>>>>>>>> item: " + JSON.stringify(item))
            return item.values();
        });
        taLog.log('newPrompts: ' + JSON.stringify(newPrompts));
        // newPrompts.forEach(prompt => {
        //     console.log('>>>>>>>>>>>>> id: ' + JSON.stringify(prompt));
        // });
        //console.log('>>>>>>>>>>>>> saveAll: ' + JSON.stringify(newPrompts));
        setMessage(browser.i18n.getMessage('customPrompts_filtering_prompts'));
        let newDefaultPrompts = newPrompts.filter(item => item.is_default == 1);
        //console.log('>>>>>>>>>>>>> newDefaultPrompts: ' + JSON.stringify(newDefaultPrompts));
        let newCustomPrompts = newPrompts.filter(item => item.is_default == 0);
        setMessage(browser.i18n.getMessage('customPrompts_saving_default_prompts'));
        await setDefaultPromptsProperties(newDefaultPrompts);
        setMessage(browser.i18n.getMessage('customPrompts_saving_custom_prompts'));
        await setCustomPrompts(newCustomPrompts);
        setMessage(browser.i18n.getMessage('customPrompts_reloading_menus'));
        await browser.runtime.sendMessage({command: "reload_menus"});
        setMessage(browser.i18n.getMessage('customPrompts_saved'),'green');
        msgTimeout = setTimeout(() => {
            clearMessage();
        }, 10000)
    }
    setStorageSpace();
}

function setMessage(msg, color = '') {
    clearTimeout(msgTimeout);
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = msg;
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = color;
}

function clearMessage() {
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = '';
    msgDisplay.style.display = 'none';
    msgDisplay.style.color = '';
}

async function setStorageSpace() {
    let storage_space = await getLocalStorageUsedSpace();
    document.getElementById('storage_space').textContent = storage_space;
}


window.addEventListener('beforeunload', function (event) {
    if (somethingChanged) {
        event.preventDefault();
    }
});

async function checkPromptsConfigForPlaceholders(textarea){
    let curr_text = textarea.value;
    // First substitute the custom data placeholders
    curr_text = await placeholdersUtils.replaceCustomPlaceholders(curr_text);
    // console.log('>>>>>>>>>> curr_text after custom placeholders: ' + curr_text);
    // check additional_text and selected_text placeholders presence and the corrispondent checkboxes
    let tr_ancestor = textarea.closest('tr');
    let need_custom_text_element = tr_ancestor.querySelector('.need_custom_text') || tr_ancestor.querySelector('.need_custom_text_new');
    // The ring is drawn on the checkbox itself (see .invalid_flag in the CSS), so it
    // hugs the toggle switch instead of boxing the whole label row.
    let need_custom_text_missing = /{%\s*additional_text(?::.*?)?\s*%}/.test(String(curr_text)) && !need_custom_text_element.checked;
    need_custom_text_element.classList.toggle('invalid_flag', need_custom_text_missing);

      let tr_ancestor2 = textarea.closest('tr');
      let selected_text_element = tr_ancestor2.querySelector('.need_selected') || tr_ancestor2.querySelector('.need_selected_new');
      let selected_text_used = (String(curr_text).indexOf('{%selected_text%}') != -1)||(String(curr_text).indexOf('{%selected_html%}') != -1);
      selected_text_element.classList.toggle('invalid_flag', selected_text_used && !selected_text_element.checked);
}