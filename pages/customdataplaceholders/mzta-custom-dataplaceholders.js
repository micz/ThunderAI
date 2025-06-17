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

import { prefs_default } from "../../options/mzta-options-default.js";
import { getLocalStorageUsedSpace, sanitizeHtml, isThunderbird128OrGreater, openTab } from "../../js/mzta-utils.js";
import { taLogger } from "../../js/mzta-logger.js";
import { getPlaceholders, setCustomPlaceholders, getCustomPlaceholders, prepareCustomDataPHsForExport, prepareCustomDataPHsForImport, placeholdersUtils } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";

let prefs = null;
var customDataPHsList = null;
var somethingChanged = false;
var idnumMax = 0;
var msgTimeout = null;
let taLog = null;
let autocompleteSuggestions = [];

document.addEventListener('DOMContentLoaded', async () => {

    prefs = await browser.storage.sync.get({ do_debug: prefs_default.do_debug });
    taLog = new taLogger("mzta-custom-dataplaceholders", prefs.do_debug);
    
    setStorageSpace();
    
    let values = await getCustomPlaceholders();

    //console.log('>>>>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    loadCustomDataPHsList(values);

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
            element.addEventListener('input', (e) => {
                e.preventDefault();
                checkFields();
            });
        });
    }

    const textareas = document.querySelectorAll('.editor');
    autocompleteSuggestions = (await getPlaceholders())
        .filter(p => p.is_default == "1")
        .map(p => ({ command: '{%' + p.id + '%}', type: p.type }));

    // console.log('>>>>>>>>>>> suggestions: ' + JSON.stringify(suggestions));
    
    textareas.forEach(textarea => {
        textareaAutocomplete(textarea, autocompleteSuggestions);
        textareas.forEach(textarea => {
            textareaAutocomplete(textarea, autocompleteSuggestions);
        });
    });

    i18n.updateDocument();

    //To add a new item
    var txtIdNew = document.getElementById('txtIdNew');
    var txtNameNew = document.getElementById('txtNameNew');
    var txtTextNew = document.getElementById('txtTextNew');
	var selectTypeNew = document.getElementById('selectTypeNew');

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
            enabled: 1,
            is_default: 0,
            idnum: idnumMax + 1,
        };

        let newItem = customDataPHsList.add(newItemData);
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
        exportCustomDataPHs();
    });

    async function exportCustomDataPHs() {
        const manifest = browser.runtime.getManifest();
        const addonVersion = manifest.version;
        const outputCustomDataPHs = prepareCustomDataPHsForExport(await getCustomPlaceholders());
        let outputObj = {id: 'thunderai-custom-data-placeholders', addon_version: addonVersion, customdataplaceholders: outputCustomDataPHs};
        const blob = new Blob([JSON.stringify(outputObj, null, 2)], {
            type: "application/json",
          });
        const currentDate = new Date();
        const time_stamp = `${currentDate.getFullYear()}${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${String(currentDate.getHours()).padStart(2, '0')}${String(currentDate.getMinutes()).padStart(2, '0')}${String(currentDate.getSeconds()).padStart(2, '0')}`;
        messenger.downloads.download({
            url: URL.createObjectURL(blob),
            filename: `thunderai-custom-data-placeholders-${time_stamp}.json`,
            saveAs: true,
        });
    }

    const btnImport = document.getElementById('btnImport');
    btnImport.addEventListener('click', (e) => {
        e.preventDefault();
        importCustomDataPHs();
    });

    function importCustomDataPHs() {
        if(confirm(browser.i18n.getMessage("importCustomDataPH_confirmText") + '\n' + browser.i18n.getMessage("customDataPH_manageDataPH_info_default_2") + '\n' + browser.i18n.getMessage("customPrompts_managePrompts_info_default_3"))) {
            //ask the user to choose a JSON file, and then read it, check if the serialized JSON is valid as generated from importCustomDataPHs(), and if so, add it to the list
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.click();
            input.onchange = async () => {
                setMessage(browser.i18n.getMessage('importCustomDataPH_start_import'));
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = async () => {
                    const json = reader.result;
                    try {
                        const obj = JSON.parse(json);
                        if(obj.id !== 'thunderai-custom-data-placeholders') {
                            alert(browser.i18n.getMessage("importCustomDataPH_invalidFile"));
                            setMessage(browser.i18n.getMessage('importCustomDataPH_invalidFile'),'red');
                            return;
                        }
                        // if(obj.addon_version !== manifest.version) {
                        //     alert(browser.i18n.getMessage("importPrompts_invalidVersion"));
                        //     return;
                        // }
                        if(!Array.isArray(obj.customdataplaceholders)) {
                            alert(browser.i18n.getMessage("importCustomDataPH_invalidDataPHs"));
                            setMessage(browser.i18n.getMessage('importCustomDataPH_invalidDataPHs'),'red');
                            return;
                        }
                        customDataPHsList.clear();
                        loadCustomDataPHsList(await prepareCustomDataPHsForImport(obj.customdataplaceholders));
                        setSomethingChanged();
                        i18n.updateDocument();
                        setMessage(browser.i18n.getMessage('importCustomDataPH_import_completed'), 'orange');
                    } catch(err) {
                        alert(browser.i18n.getMessage("importCustomDataPH_invalidFile") + ' ' + err);
                        setMessage(browser.i18n.getMessage('importCustomDataPH_invalidFile'),'red');
                        return;
                    }
                };
                reader.readAsText(file);
            };
        };
    }

    document.getElementById('btnManagePrompts').addEventListener('click', () => {
        openTab('/pages/customprompts/mzta-custom-prompts.html');
    });

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
    customDataPHsList.remove("id", tr.querySelector('span.id').innerText);
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
    // the checkboxes update is handled directly by themselves
    hideItemRowEditor(tr);
    setSomethingChanged();
}

// Enable save button on input change
function handleInputChange(e) {
    e.preventDefault();
    setSomethingChanged();
}

//========= handling an item in a row - END


function loadCustomDataPHsList(values){
    // console.log('>>>>>>>> loadCustomDataPHsList values: ' + JSON.stringify(values));
    let options = {
        valueNames: [
            { data: ['idnum'] },
            'is_default',
            'id',
            'name',
            'text',
            'type',
            { name: 'enabled', attr: 'checked_val'}
        ],
        item: function(values) {
            values.id = placeholdersUtils.stripCustomDataPH_ID_Prefix(values.id);
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
            let output = `<tr ` + ((values.is_default == 1) ? 'class="is_default"':'') + `>
                <td class="w08"><i>thunderai_custom_</i><span class="id id_show"></span><input type="text" class="hiddendata id_output" value="` + values.id + `" /></td>
                <td class="w08"><span class="name name_show"></span><input type="text" class="hiddendata name_output" value="` + values.name + `" /></td>
                <td class="w40">
                    <span class="text text_show"></span>
                    <div class="autocomplete-container">
                        <textarea class="hiddendata text_output editor">` + values.text.replace(/<br\s*\/?>/gi, "\n") + `</textarea>
                        <ul class="autocomplete-list hidden"></ul>
                    </div>
                </td>
				<td class="w08"><span class="field_title_s">__MSG_customDataPH_add_to_menu__:</span>
                <br>
	                <span class="type_show">` + type_output + `</span>
	                <select class="type_output hiddendata">
	                <option value="0"` + ((values.type == "0") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_always__</option>
	                <option value="1"` + ((values.type == "1") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_reading__</option>
	                <option value="2"` + ((values.type == "2") ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_composing__</option>
	              </select>` +
	              `<span class="type hiddendata"></span>
              </td>
                <td class="w17">
                    <label><input type="checkbox" class="enabled input_mod"> __MSG_customPrompts_form_label_enabled__</label>
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
            idnumMax = Math.max(idnumMax, values.idnum);
            return output;
        }
    };

    // console.log('>>>>>>>>>>>>> options: ' + JSON.stringify(options));
    // console.log('>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    customDataPHsList = new List('all_custom_dataplaceholders', options, values);

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

    document.querySelectorAll('.input_mod').forEach(element => {
        element.addEventListener('change', handleInputChange);
    });
}

function checkFields() {
    //console.log('>>>>>>>>>>>>> typeof customDataPHsList: ' + typeof customDataPHsList);
    //console.log('>>>>>>>>>>>>> Array.isArray(customDataPHsList): ' + Array.isArray(customDataPHsList));
    // the id must be unique and without spaces
    let is_error = false;
    let id_value = document.getElementById('txtIdNew').value.trim();
    if ((id_value == '')||
    (/\s/.test(id_value))) {
        inputSetError('txtIdNew');
        is_error = true;
    } else {
        let exists = customDataPHsList.get("id", id_value);
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

//Save all custom data placeholders
async function saveAll() {
    setMessage(browser.i18n.getMessage('customDataPH_saving_custom'));
    setNothingChanged();
    if(customDataPHsList != null) {
        setMessage(browser.i18n.getMessage('customPrompts_reindexing_list'));
        customDataPHsList.reIndex();
        let newCustomDataPHs = customDataPHsList.items.filter(item => item.values().is_default == 0).map(item => item.values());
        taLog.log('newCustomDataPlaceholders: ' + JSON.stringify(newCustomDataPHs));
        // newCustomDataPHs.forEach(prompt => {
        //     console.log('>>>>>>>>>>>>> id: ' + JSON.stringify(prompt));
        // });
        //console.log('>>>>>>>>>>>>> saveAll: ' + JSON.stringify(newCustomDataPHs));
        await setCustomPlaceholders(newCustomDataPHs);
        setMessage(browser.i18n.getMessage('customDataPH_saved'),'green');
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


if(await isThunderbird128OrGreater()){
    window.addEventListener('beforeunload', function (event) {
        // Check if any changes have been made (Only for Thunderbird 128+ see https://github.com/micz/ThunderAI/issues/88)
        if (somethingChanged) {
            event.preventDefault();
        }
    });    
}