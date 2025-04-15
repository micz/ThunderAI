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

import { getPrompts, setDefaultPromptsProperties, setCustomPrompts, preparePromptsForExport, preparePromptsForImport } from "../../js/mzta-prompts.js";
import { isThunderbird128OrGreater, getCustomPromptsUsedSpace, sanitizeHtml } from "../../js/mzta-utils.js";
import { taLogger } from "../../js/mzta-logger.js";
import { getPlaceholders } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";

var promptsList = null;
var somethingChanged = false;
var positionMax_compose = 0;
var positionMax_display = 0;
var idnumMax = 0;
var msgTimeout = null;
let taLog = null;
let autocompleteSuggestions = [];

document.addEventListener('DOMContentLoaded', async () => {

    let prefs_debug = await browser.storage.sync.get({do_debug: false});
    taLog = new taLogger("mzta-custom-prompts", prefs_debug.do_debug);
    
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
            element.addEventListener('change', (e) => {
                e.preventDefault();
                checkFields();
            });
        });
    }

    const textareas = document.querySelectorAll('.editor');
    autocompleteSuggestions = (await getPlaceholders(true)).map(p => ({command: '{%'+p.id+'%}', type: p.type}));

    // console.log('>>>>>>>>>>> suggestions: ' + JSON.stringify(suggestions));
    
    textareas.forEach(textarea => {
        textareaAutocomplete(textarea, autocompleteSuggestions);
        textareas.forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                checkPromptsConfigForPlaceholders(e.target);
            });
        textareaAutocomplete(textarea, autocompleteSuggestions);
        });
    });

    // document.addEventListener('click', (e) => {
    //     // Check if the click was outside the textarea or suggestion list
    //     const isClickInsideTextarea = e.target.closest('.editor');
    //     const isClickInsideAutocompleteList = e.target.closest('.autocomplete-list');
      
    //     if (!isClickInsideTextarea && !isClickInsideAutocompleteList) {
    //       textareas.forEach(textarea => {
    //         const container = textarea.closest('.autocomplete-container');
    //         const autocompleteList = container.querySelector('.autocomplete-list');
    //         hideSuggestions(autocompleteList);
    //       });
    //     }
    // });

    i18n.updateDocument();

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
    var checkboxUseDiffViewerNew_span = document.getElementById('checkboxUseDiffViewerNew_span');

    selectActionNew.addEventListener('change', (e) => {
        if (e.target.value === "2") {
            checkboxUseDiffViewerNew_span.style.display = 'inline';
        } else {
            checkboxUseDiffViewerNew_span.style.display = 'none';
        }
    });

    const btnAddNew = document.getElementById('btnAddNew');
    btnAddNew.addEventListener('click', (e) => {
        e.preventDefault();
        if(!checkFields()) {
            return;
        }
        let newItem = promptsList.add({
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
            enabled: 1,
            position_compose: positionMax_compose + 1,
            position_display: positionMax_display + 1,
            is_default: 0,
            idnum: idnumMax + 1,
        });
        idnumMax++;
        let curr_idnum = newItem[0].values().idnum;
        let checkboxes = document.querySelectorAll(`tr[data-idnum="${curr_idnum}"] input[type="checkbox"]`);
        checkSelectedBoxes(checkboxes);
        let editBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnEditItem`);
        //console.log(`>>>>>>>>>>>> tr[data-idnum="${curr_idnum}"] button.btnEditItem`);
        editBtn.addEventListener('click', handleEditClick);
        //console.log('>>>>>>>>>>>>> editBtn: ' + JSON.stringify(editBtn));
        let deleteBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnDeleteItem`);
        //console.log(`>>>>>>>>>>>> tr[data-idnum="${curr_idnum}"] button.btnDeleteItem`);
        deleteBtn.addEventListener('click', handleDeleteClick);
        let okBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnConfirmItem`);
        okBtn.addEventListener('click', handleConfirmClick);
        let cancelBtn = document.querySelector(`tr[data-idnum="${curr_idnum}"] button.btnCancelItem`);
        cancelBtn.addEventListener('click', handleCancelClick);
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
        const outputPrompts = preparePromptsForExport(await getPrompts());
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

}, { once: true });

//========= handling an item in a row 
function handleEditClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    //console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    e.target.style.display = 'none';    // Edit btn
    tr.querySelector('.btnConfirmItem').style.display = 'inline';   // Save btn
    tr.querySelector('.btnCancelItem').style.display = 'inline';   // Cancel btn
//        tr.querySelector('.btnEditItem').style.display = 'none';   // Edit btn
    tr.querySelector('.btnDeleteItem').style.display = 'none';   // Delete btn
    showItemRowEditor(tr);
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
    tr.querySelector('.type_output').style.display = 'inline';
    tr.querySelector('.type_show').style.display = 'none';
    tr.querySelector('.action_output').style.display = 'inline';
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
    tr.querySelector('.text_output').style.display = 'none';
    tr.querySelector('.text_show').style.display = 'inline';
    tr.querySelector('.type_output').style.display = 'none';
    tr.querySelector('.type_show').style.display = 'inline';
    tr.querySelector('.action_output').style.display = 'none';
    tr.querySelector('.action_show').style.display = 'inline';
    tr.querySelector('input.need_selected').disabled = true;
    tr.querySelector('input.need_signature').disabled = true;
    tr.querySelector('input.need_custom_text').disabled = true;
    tr.querySelector('input.define_response_lang').disabled = true;
    tr.querySelector('input.use_diff_viewer').disabled = true;
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
    tr.querySelector('.btnEditItem').style.display = 'inline';   // Edit btn
    tr.querySelector('.btnDeleteItem').style.display = 'inline';   // Delete btn
    tr.querySelector('.id_output').value = tr.querySelector('.id_show').innerText.toLocaleUpperCase();
    tr.querySelector('.name_output').value = tr.querySelector('.name_show').innerText;
    tr.querySelector('.text_output').value = sanitizeHtml(tr.querySelector('.text_show').innerHTML).replace(/<br\s*\/?>/gi, "\n");
    tr.querySelector('.type_output').value = tr.querySelector('.type').innerText;
    // tr.querySelector('.type_output').selectedOptions[0].text = tr.querySelector('.type_show').innerText;
    tr.querySelector('.action_output').value = tr.querySelector('.action').innerText;
    // tr.querySelector('.action_output').selectedOptions[0].text = tr.querySelector('.action_show').innerText;
    hideItemRowEditor(tr);
}

function handleConfirmClick(e) {
    e.preventDefault();
    const tr = e.target.parentNode.parentNode;
    e.target.style.display = 'none';    // Ok btn
//        tr.querySelector('.btnConfirmItem').style.display = 'none';   // Ok btn
    tr.querySelector('.btnCancelItem').style.display = 'none';   // Cancel btn
    tr.querySelector('.btnEditItem').style.display = 'inline';   // Edit btn
    tr.querySelector('.btnDeleteItem').style.display = 'inline';   // Delete btn
    // Update item data
    tr.querySelector('.id_show').innerText = String(tr.querySelector('.id_output').value).toLocaleLowerCase();
    tr.querySelector('.name_show').innerText = tr.querySelector('.name_output').value;
    tr.querySelector('.text_show').innerText = tr.querySelector('.text_output').value;
    tr.querySelector('.type').innerText = tr.querySelector('.type_output').value;
    tr.querySelector('.type_show').innerText = tr.querySelector('.type_output').selectedOptions[0].text;
    tr.querySelector('.action').innerText = tr.querySelector('.action_output').value;
    tr.querySelector('.action_show').innerText = tr.querySelector('.action_output').selectedOptions[0].text;
    // the checkboxes update is handled directly by themselves
    hideItemRowEditor(tr);
    setSomethingChanged();
}

// Handle checkbox changes and log new state
function handleCheckboxChange(e) {
    e.preventDefault();
    e.target.setAttribute('checked_val', e.target.checked ? '1' : '0');
    //console.log('>>>>>>>> checked_val: ' + e.target.getAttribute('checked_val'));
    if (e.target.classList.contains('need_selected') || e.target.classList.contains('need_custom_text') || e.target.classList.contains('need_selected_new') || e.target.classList.contains('need_custom_text_new')) {
        let textarea = e.target.closest('tr').querySelector('.text_output');
        checkPromptsConfigForPlaceholders(textarea);
    }
    
}

// Enable save button on input change
function handleInputChange(e) {
    e.preventDefault();
    setSomethingChanged();
}

//========= handling an item in a row - END


function loadPromptsList(values){
    // console.log('>>>>>>>> loadPromptsList values: ' + JSON.stringify(values));
    let options = {
        valueNames: [ { data: ['idnum'] }, 'is_default', 'id', 'name', 'text', 'type', 'action', 'position_compose', 'position_display', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'define_response_lang', attr: 'checked_val'}, { name: 'use_diff_viewer', attr: 'checked_val'}, { name: 'enabled', attr: 'checked_val'} ],
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
            //console.log('>>>>>>>>>>>>> action_output: ' + JSON.stringify(action_output));

            let output = `<tr ` + ((values.is_default == 1) ? 'class="is_default"':'') + `>
                <td class="w08"><span class="id id_show"></span><input type="text" class="hiddendata id_output" value="` + values.id + `" /></td>
                <td class="w08"><span class="name name_show"></span><input type="text" class="hiddendata name_output" value="` + values.name + `" /></td>
                <td class="w40"><span class="text text_show"></span><div class="autocomplete-container"><textarea class="hiddendata text_output editor">` + values.text.replace(/<br\s*\/?>/gi, "\n") + `</textarea><ul class="autocomplete-list hidden"></ul></div></td>
                <td class="w08"><span class="type_show">` + type_output + `</span>
                <select class="type_output hiddendata">
                <option value="0"` + ((values.type == "0") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_always__</option>
                <option value="1"` + ((values.type == "1") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_reading__</option>
                <option value="2"` + ((values.type == "2") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_composing__</option>
              </select>` +
              `<span class="type hiddendata"></span>
              </td>
                <td class="w17">
                    Action: <span class="action_show">` + action_output + `</span>
                    <select class="action_output hiddendata">
                    <option value="0"` + ((values.action == "0") ? ' selected':'') + `>__MSG_customPrompts_close_button__</option>
                    <option value="1"` + ((values.action == "1") ? ' selected':'') + `>__MSG_customPrompts_do_reply__</option>
                    <option value="2"` + ((values.action == "2") ? ' selected':'') + `>__MSG_customPrompts_substitute_text__</option>
                  </select>` +
                  `<span class="action hiddendata"></span>
                    <br>
                    <span class="need_selected_span"><input type="checkbox" class="need_selected" disabled> __MSG_customPrompts_form_label_need_selected__</span>
                    <br>
                    <input type="checkbox" class="need_signature" disabled> __MSG_customPrompts_form_label_need_signature__
                    <br>
                    <span class="need_custom_text_span"><input type="checkbox" class="need_custom_text` + ((values.is_default == 1) ? ' input_mod':'') + `"` + ((values.is_default == 0) ? ' disabled':'') + ` > __MSG_customPrompts_form_label_need_custom_text__</span>
                    <br>
                    <input type="checkbox" class="define_response_lang" disabled> __MSG_customPrompts_form_label_define_response_lang__
                    <br>
                    <input type="checkbox" class="use_diff_viewer" disabled> __MSG_customPrompts_form_label_use_diff_viewer__
                    <br>
                    <input type="checkbox" class="enabled input_mod"> __MSG_customPrompts_form_label_enabled__
                    <span class="is_default hiddendata"></span>
                    <span class="position_compose hiddendata"></span>
                    <span class="position_display hiddendata"></span>
                </td>
                <td>
                <button class="btnEditItem"` + ((values.is_default == 1) ? ' disabled':'') + `>__MSG_customPrompts_btnEdit__</button>
                <button class="btnCancelItem hiddendata"` + ((values.is_default == 1) ? ' disabled':'') + `>__MSG_customPrompts_btnCancel__</button>
                <br><br>
                <button class="btnConfirmItem hiddendata"` + ((values.is_default == 1) ? ' disabled':'') + `>__MSG_customPrompts_btnOK__</button>
                <button class="btnDeleteItem"` + ((values.is_default == 1) ? ' disabled':'') + `>__MSG_customPrompts_btnDelete__</button>
               </td>
            </tr>`;
            //console.log('>>>>>>>> values.name: ' + JSON.stringify(values.name));
            positionMax_compose = Math.max(positionMax_compose, values.position_compose);
            positionMax_display = Math.max(positionMax_display, values.position_display);
            idnumMax = Math.max(idnumMax, values.idnum);
            return output;
        }
    };

    promptsList = new List('all_prompts', options, values);

    checkSelectedBoxes();
    let btnEditItem_elements = document.querySelectorAll(".btnEditItem");
    btnEditItem_elements.forEach(element => {
        element.addEventListener('click', handleEditClick);
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
    document.getElementById('selectTypeNew').value = '0';
    document.getElementById('selectActionNew').value = '0';
    document.getElementById('checkboxNeedSelectedNew').value = '0';
    document.getElementById('checkboxNeedSignatureNew').value = '0';
    document.getElementById('checkboxNeedCustomTextNew').value = '0';
    document.getElementById('formNew').style.display = 'none';
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
            ...document.querySelectorAll('.enabled[type="checkbox"]'),
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
        setMessage(browser.i18n.getMessage('customPrompts_reindexing_list'));
        promptsList.reIndex();
        let newPrompts = promptsList.items.map(item => {
            // For each item in the array, return only the '_values' part
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
        browser.runtime.sendMessage({command: "reload_menus"});
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
    let storage_space = await getCustomPromptsUsedSpace();
    document.getElementById('storage_space').textContent = storage_space;
}


if(await isThunderbird128OrGreater()){
    window.addEventListener('beforeunload', function (event) {
        // Check if any changes have been made (Only for Thunderbird 128+ see https://github.com/micz/ThunderAI/issues/88)
        if (somethingChanged) {
            event.preventDefault();
        }
    });    
}

function checkPromptsConfigForPlaceholders(textarea){
    // check additional_text and selected_text placeholders presence and the corrispondent checkboxes
    let tr_ancestor = textarea.closest('tr');
    let need_custom_text_element = tr_ancestor.querySelector('.need_custom_text') || tr_ancestor.querySelector('.need_custom_text_new');
    if(String(textarea.value).indexOf('{%additional_text%}') != -1){
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
      if(String(textarea.value).indexOf('{%selected_text%}') != -1){
        if(!selected_text_element.checked){
            selected_text_element.closest('.need_selected_span').style.border = '2px solid red';
        }else{
            selected_text_element.closest('.need_selected_span').style.border = '';
        }
      }else{
        selected_text_element.closest('.need_selected_span').style.border = '';
      }
}