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

let prefs = null;
var promptsList = null;
var somethingChanged = false;
var positionMax_compose = 0;
var positionMax_display = 0;
var idnumMax = 0;
var msgTimeout = null;
let taLog = null;
let autocompleteSuggestions = [];

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
        // Back to "inherit the global preference", and hidden: the checkbox above
        // was just cleared, so the two-level gate is closed.
        document.getElementById('selectDiffGranularityNew').value = '';
        toggleDiffGranularityNew();
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
    autocompleteSuggestions = (await getPlaceholders(true)).map(mapPlaceholderToSuggestion);

    // console.log('>>>>>>>>>>> autocompleteSuggestions: ' + JSON.stringify(autocompleteSuggestions));
    
    textareas.forEach(textarea => {
        textareaAutocomplete(textarea, autocompleteSuggestions);
        textareas.forEach(textarea => {
            textarea.addEventListener('input', async (e) => {
                await checkPromptsConfigForPlaceholders(e.target);
            });
        textareaAutocomplete(textarea, autocompleteSuggestions);
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
        toggleDiffGranularityNew();
    });
    // Two-level gate, same as the row editor: the granularity only matters when
    // the action substitutes text AND the picker is on.
    checkboxUseDiffViewerNew.addEventListener('change', toggleDiffGranularityNew);
    toggleDiffGranularityNew();

    const btnAddNew = document.getElementById('btnAddNew');
    btnAddNew.addEventListener('click', (e) => {
        e.preventDefault();
        if(!checkFields()) {
            return;
        }
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
            // "" = inherit the global preference; forced to "" when the picker is
            // off so no stale override is stored out of sight.
            diff_granularity: (checkboxUseDiffViewerNew.checked) ? document.getElementById('selectDiffGranularityNew').value : "",
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
    // Seed the select from the stored value: List.js keeps it in the
    // .diff_granularity hiddendata span, and the select is not one of the
    // elements it writes to.
    const granularitySelect = tr.querySelector('.diff_granularity_output');
    if(granularitySelect) {
        const stored = tr.querySelector('.diff_granularity')?.innerText.trim() || '';
        granularitySelect.value = (stored === 'words' || stored === 'sentences') ? stored : '';
    }
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

function showItemRowEditor(tr) {
    tr.querySelector('.id_output').style.display = 'inline';
    tr.querySelector('.id_show').style.display = 'none';
    tr.querySelector('.name_output').style.display = 'inline';
    tr.querySelector('.name_show').style.display = 'none';
    const text_output = tr.querySelector('.text_output');
    text_output.style.display = 'inline';
    textareaAutocomplete(text_output, autocompleteSuggestions)
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
    const diffCheckbox = tr.querySelector('input.use_diff_viewer');
    diffCheckbox.disabled = false;
    // Attached ONCE per row, guarded by the flag: the action_output listeners
    // above are added on every show/hide without ever being removed, so they
    // stack a duplicate on each edit cycle. Not replicating that here.
    if(!diffCheckbox.dataset.mztaGranularityBound) {
        diffCheckbox.dataset.mztaGranularityBound = '1';
        diffCheckbox.addEventListener('change', () => toggleDiffGranularity(tr));
    }
    tr.querySelector('.diff_granularity_output').disabled = false;
    toggleDiffGranularity(tr);
}

function hideItemRowEditor(tr) {
    tr.querySelector('.id_output').style.display = 'none';
    tr.querySelector('.id_show').style.display = 'inline';
    tr.querySelector('.name_output').style.display = 'none';
    tr.querySelector('.name_show').style.display = 'inline';
    tr.querySelector('.text_output').style.display = 'none';
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
    tr.querySelector('.diff_granularity_output').disabled = true;
    // Still shown outside edit mode - it is part of the row's visible state, like
    // the checkboxes - but read-only.
    toggleDiffGranularity(tr);
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

// New-prompt form twin of toggleDiffGranularity(tr). Same two-level condition,
// different DOM: the new form uses ids, the row editor per-row classes.
function toggleDiffGranularityNew() {
    const action = document.getElementById('selectActionNew');
    const checkbox = document.getElementById('checkboxUseDiffViewerNew');
    const wrap = document.getElementById('spanDiffGranularityNew');
    if(!action || !checkbox || !wrap) { return; }
    wrap.style.display = ((action.value === "2") && checkbox.checked) ? 'inline' : 'none';
}

// The granularity select is only meaningful when the picker actually runs, which
// is a TWO-level condition: the action must be "substitute text" AND the diff
// viewer checkbox must be ticked. Shown only then, so it cannot suggest it has
// an effect where it has none.
function toggleDiffGranularity(tr) {
    const action = tr.querySelector('.action_output').value;
    const checkbox = tr.querySelector('.use_diff_viewer');
    const wrap = tr.querySelector('.diff_granularity_wrap');
    const select = tr.querySelector('.diff_granularity_output');
    if(!wrap || !select) { return; }
    const applicable = (action === "2") && checkbox.checked;
    // hiddendata is the class this page uses to hide a field, so toggling it
    // keeps this row consistent with every other hidden element here.
    wrap.classList.toggle('hiddendata', !applicable);
    // Editable only while the row is in edit mode; showItemRowEditor owns that.
    select.disabled = checkbox.disabled || !applicable;
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
    toggleDiffGranularity(tr);
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
    // "" = inherit the global preference. Forced back to "" when the picker is
    // off, so a stale override cannot linger invisibly on a prompt that no
    // longer shows the granularity select at all.
    newValues.diff_granularity = newValues.use_diff_viewer ? tr.querySelector('.diff_granularity_output').value : "";
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
    // List.js writes the value into the .diff_granularity hiddendata span, not
    // into the select, so the select has to be put back in step by hand - the
    // same manual sync .action / .action_show needs just above.
    tr.querySelector('.diff_granularity_output').value = newValues.diff_granularity;
    // the checkboxes update is handled directly by themselves
    hideItemRowEditor(tr);
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

    if (e.target.classList.contains('need_custom_text')) {
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
    document.getElementById('txtTextNew').value = text;
    document.getElementById('selectTypeNew').value = type;
    document.getElementById('selectActionNew').value = action;
    
    document.getElementById('checkboxNeedSelectedNew').checked = need_selected;
    document.getElementById('checkboxNeedSignatureNew').checked = need_signature;
    document.getElementById('checkboxNeedCustomTextNew').checked = need_custom_text;
    document.getElementById('checkboxDefineResponseLangNew').checked = define_response_lang;
    
    let checkboxUseDiffViewerNew = document.getElementById('checkboxUseDiffViewerNew');
    checkboxUseDiffViewerNew.checked = use_diff_viewer;
    checkboxUseDiffViewerNew.disabled = (action !== "2");

    // From itemValues, not from the row's select: that select is only in step
    // with the stored value while the row is being edited, and Copy works on a
    // row that is not.
    const granularityNew = document.getElementById('selectDiffGranularityNew');
    const copiedGranularity = itemValues.diff_granularity || '';
    granularityNew.value = (copiedGranularity === 'words' || copiedGranularity === 'sentences') ? copiedGranularity : '';
    // Re-run the gate: the checkbox and action were just set from the copy.
    toggleDiffGranularityNew();

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
function decoratePromptText() {
    document.querySelectorAll('#all_prompts .text_show').forEach(span => {
        if (span.dataset.phDecorated === '1') return;
        if (!/\{%[^%]+%\}/.test(span.innerHTML)) { span.dataset.phDecorated = '1'; return; }
        span.innerHTML = span.innerHTML.replace(/\{%[^%]+%\}/g,
            m => '<span class="ph_chip">' + m + '</span>');
        span.dataset.phDecorated = '1';
    });
}

// Keep the card footer prompt count in sync with the rendered list.
function updatePromptsCount() {
    const el = document.getElementById('prompts_count');
    if (!el) return;
    const count = promptsList ? promptsList.items.length : 0;
    el.textContent = browser.i18n.getMessage('customPrompts_promptsCount', [String(count)]);
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
        valueNames: [ { data: ['idnum'] }, 'is_default', 'id', 'name', 'text', 'type', 'action', 'position_compose', 'position_display', 'show_in', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'define_response_lang', attr: 'checked_val'}, { name: 'use_diff_viewer', attr: 'checked_val'}, 'diff_granularity', 'api_type', ...api_fields ],
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
                    <div class="autocomplete-container">
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
                    <label><input type="checkbox" class="define_response_lang" disabled> __MSG_customPrompts_form_label_define_response_lang__</label>
                    <br>
                    <label title="__MSG_customPrompts_form_label_use_diff_viewer_title__"><input type="checkbox" class="use_diff_viewer" disabled> __MSG_customPrompts_form_label_use_diff_viewer__</label>
                    <span class="diff_granularity_wrap hiddendata"><br><label title="__MSG_customPrompts_form_label_diff_granularity_title__">__MSG_customPrompts_form_label_diff_granularity__ <select class="diff_granularity_output" disabled>
                        <option value="">__MSG_customPrompts_form_label_diff_granularity_inherit__</option>
                        <option value="words">__MSG_prefs_OptionText_diff_granularity_words__</option>
                        <option value="sentences">__MSG_prefs_OptionText_diff_granularity_sentences__</option>
                    </select></label></span>
                    <span class="diff_granularity hiddendata">` + (values.diff_granularity || '') + `</span>
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
    });

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


function clearFields() {
    document.getElementById('txtIdNew').value = '';
    document.getElementById('txtNameNew').value = '';
    document.getElementById('txtTextNew').value = '';
    document.getElementById('chatGPTWebModelNew').value = '';
    document.getElementById('chatGPTWebProjectNew').value = '';
    document.getElementById('chatGPTWebCustomGPTNew').value = '';
    document.getElementById('selectTypeNew').value = '0';
    document.getElementById('selectActionNew').value = '0';
    document.getElementById('checkboxNeedSelectedNew').value = '0';
    document.getElementById('checkboxNeedSignatureNew').value = '0';
    document.getElementById('checkboxNeedCustomTextNew').value = '0';
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
        checkboxes = [
            ...document.querySelectorAll('.need_selected[type="checkbox"]'),
            ...document.querySelectorAll('.need_signature[type="checkbox"]'),
            ...document.querySelectorAll('.need_custom_text[type="checkbox"]'),
            ...document.querySelectorAll('.define_response_lang[type="checkbox"]'),
            ...document.querySelectorAll('.use_diff_viewer[type="checkbox"]'),
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
    if(/{%\s*additional_text(?::.*?)?\s*%}/.test(String(curr_text))){
        if(!need_custom_text_element.checked){
            need_custom_text_element.closest('.need_custom_text_span').style.border = '2px solid red';
        }else{
            need_custom_text_element.closest('.need_custom_text_span').style.border = '';
        }
      }else{
        need_custom_text_element.closest('.need_custom_text_span').style.border = '';
      }

      let tr_ancestor2 = textarea.closest('tr');
      let selected_text_element = tr_ancestor2.querySelector('.need_selected') || tr_ancestor2.querySelector('.need_selected_new');
      if((String(curr_text).indexOf('{%selected_text%}') != -1)||(String(curr_text).indexOf('{%selected_html%}') != -1)){
        if(!selected_text_element.checked){
            selected_text_element.closest('.need_selected_span').style.border = '2px solid red';
        }else{
            selected_text_element.closest('.need_selected_span').style.border = '';
        }
      }else{
        selected_text_element.closest('.need_selected_span').style.border = '';
      }
}