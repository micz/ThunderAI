/*
 *  ThunderAI [https://micz.it/thunderdbird-addon-thunderai/]
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

import { getPrompts, setDefaultPromptsProperties, setCustomPrompts } from "../js/mzta-prompts.js";

var promptsList = null;
var somethingChanged = false;
var positionMax_compose = 0;
var positionMax_display = 0;
var idnumMax = 0;

document.addEventListener('DOMContentLoaded', async () => {
    let options = {
        valueNames: [ { data: ['idnum'] }, 'is_default', 'id', 'name', 'text', 'type', 'action', 'position_compose', 'position_display', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'enabled', attr: 'checked_val'} ],
        item: function(values) {        //TODO: manage ACTION and TYPE edit with the select
            let type_output = '';
            switch(values.type){
                case 0:
                    type_output = `<span>__MSG_customPrompts_add_to_menu_always__</span>`;
                    break;
                case 1:
                    type_output = `<span>__MSG_customPrompts_add_to_menu_reading__</span>`;
                    break;
                case 2:
                    type_output = `<span>__MSG_customPrompts_add_to_menu_composing__</span>`;
                    break;
            }

            let action_output = '';
            switch(values.action){
                case 0:
                    action_output = `<span>__MSG_customPrompts_close_button__</span>`;
                    break;
                case 1:
                    action_output = `<span>__MSG_customPrompts_save_button__</span>`;
                    break;
                case 2:
                    action_output = `<span>__MSG_customPrompts_do_reply__</span>`;
                    break;
            }

            let output = `<tr ` + ((values.is_default == 1) ? 'class="is_default"':'') + `>
                <td class="id"></td>
                <td class="name"></td>
                <td class="text"></td>
                <td>` + ((values.is_default == 1) ? type_output :                
                `<select class="input_mod">
                <option value="0"` + ((values.type == 0) ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_always__</option>
                <option value="1"` + ((values.type == 1) ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_reading__</option>
                <option value="2"` + ((values.type == 2) ? ' selected':'') + `>__MSG_customPrompts_add_to_menu_composing__</option>
              </select>`) +
              `<span class="type hiddendata"></span>
              </td>
                <td class="properties">
                    Action: ` + ((values.is_default == 1) ? action_output :
                    `<select class="input_mod">
                    <option value="0"` + ((values.action == 0) ? ' selected':'') + `>__MSG_customPrompts_close_button__</option>
                    <option value="1"` + ((values.action == 1) ? ' selected':'') + `>__MSG_customPrompts_do_reply__</option>
                    <option value="2"` + ((values.action == 2) ? ' selected':'') + `>__MSG_customPrompts_substitute_text__</option>
                  </select>`) +
                  `<span class="action hiddendata"></span>
                    <br>
                    <input type="checkbox" class="need_selected input_mod"` + ((values.is_default == 1) ? ' disabled':'') + `> Need Select
                    <br>
                    <input type="checkbox" class="need_signature input_mod" ` + ((values.is_default == 1) ? ' disabled':'') + `> Need Signature
                    <br>
                    <input type="checkbox" class="need_custom_text input_mod"` + ((values.is_default == 1) ? ' disabled':'') + `> Need Custom Text
                    <br>
                    <input type="checkbox" class="enabled input_mod"> Enabled
                    <span class="is_default hiddendata"></span>
                    <span class="position_compose hiddendata"></span>
                    <span class="position_display hiddendata"></span>
                </td>
                <td>
                <button class="btnEditItem"` + ((values.is_default == 1) ? ' disabled':'') + `>Edit</button>
                <br>
                <button class="btnDeleteItem"` + ((values.is_default == 1) ? ' disabled':'') + `>Delete</button>
               </td>
            </tr>`;
            //console.log('>>>>>>>> values.name: ' + JSON.stringify(values.name));
            positionMax_compose = Math.max(positionMax_compose, values.position_compose);
            positionMax_display = Math.max(positionMax_display, values.position_display);
            idnumMax = Math.max(idnumMax, values.idnum);
            return output;
        }
    };

    let values = await getPrompts();

    console.log('>>>>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    promptsList = new List('all_prompts', options, values);

    checkSelectedBoxes();

    const btnSave = document.getElementById('btnSave');
    btnSave.disabled = true;
    
    // Disable save button and handle save actions
    function handleSaveClick(e) {
        e.preventDefault();
        saveAll();
        clearFields();
        btnSave.disabled = true;
    }
    btnSave.addEventListener('click', handleSaveClick);
    
    const btnNew = document.getElementById('btnNew');
    
    // Show the new item form
    function handleNewClick(e) {
        e.preventDefault();
        document.getElementById('formNew').style.display = 'block';
    }
    btnNew.addEventListener('click', handleNewClick);
    
    // Enable save button on input change
    function handleInputChange(e) {
        e.preventDefault();
        btnSave.disabled = false;
        somethingChanged = true; // Assumes declaration somewhere in your script
    }
    document.querySelectorAll('.input_mod').forEach(element => {
        element.addEventListener('change', handleInputChange);
    });
    
    // Display selected value next to select input
    function handleSelectChange(e) {
        e.preventDefault();
        const spanElement = e.target.nextElementSibling;
        spanElement.textContent = e.target.value;
    }
    document.querySelectorAll('select.input_mod').forEach(element => {
        element.addEventListener('change', handleSelectChange);
    });
    
    // Log data ID number from item row and prepare for edit action
    function handleEditClick(e) {           //TODO
        e.preventDefault();
        const tr = e.target.parentNode.parentNode;
        console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    }
    let btnEditItem_elements = document.querySelectorAll(".btnEditItem");
    btnEditItem_elements.forEach(element => {
        element.addEventListener('click', handleEditClick);
    });
    
    // Confirm and log deletion action
    function handleDeleteClick(e) {             //TODO
        e.preventDefault();
        const checkConfirm = window.confirm("Are you sure you want to delete this item?");
        if (!checkConfirm) {
            return;
        }
        const tr = e.target.parentNode.parentNode;
        console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
    }
    let btnDeleteItem_elements = document.querySelectorAll(".btnDeleteItem");
    btnDeleteItem_elements.forEach(element => {
        element.addEventListener('click', handleDeleteClick);
    });


    // Handle checkbox changes and log new state
    function handleCheckboxChange(e) {
        e.preventDefault();
        e.target.setAttribute('checked_val', e.target.checked ? '1' : '0');
        console.log('>>>>>>>> checked_val: ' + e.target.getAttribute('checked_val'));
    }
    let checkbox_elements = document.querySelectorAll("input[type='checkbox']");
    checkbox_elements.forEach(element => {
        element.addEventListener('change', handleCheckboxChange);
    });
    

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

    i18n.updateDocument();

    //To add a new item
    var txtIdNew = document.getElementById('txtIdNew');
    var txtNameNew = document.getElementById('txtNameNew');
    var txtTextNew = document.getElementById('txtTextNew');
    var selectTypeNew = document.getElementById('selectTypeNew');
    var selectActionNew = document.getElementById('selectActionNew');
    var selectNeedSelectedNew = document.getElementById('selectNeedSelectedNew');
    var selectNeedSignatureNew = document.getElementById('selectNeedSignatureNew');
    var selectNeedCustomTextNew = document.getElementById('selectNeedCustomTextNew');

    const btnAddNew = document.getElementById('btnAddNew');
    btnAddNew.addEventListener('click', (e) => {    //TODO
        e.preventDefault();
        if(!checkFields()) {
            return;
        }
        let newItem = promptsList.add({
            id: txtIdNew.value.trim(),
            name: txtNameNew.value.trim(),
            text: txtTextNew.value.trim(),
            type: selectTypeNew.value,
            action: selectActionNew.value,
            need_selected: selectNeedSelectedNew.value,
            need_signature: selectNeedSignatureNew.value,
            need_custom_text: selectNeedCustomTextNew.value,
            enabled: 1,
            position_compose: positionMax_compose + 1,
            position_display: positionMax_display + 1,
            is_default: 0,
            idnum: idnumMax + 1,
        });
        idnumMax++;
        //checkSelectedBoxes([selectTypeNew, selectActionNew, selectNeedSelectedNew, selectNeedSignatureNew, selectNeedCustomTextNew]);
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
        // console.log('>>>>>>>>>>>>> deleteBtn: ' + JSON.stringify(deleteBtn));
        // console.log('>>>>>>>>>>>>> newItem: ' + JSON.stringify(newItem));
        clearFields();
        somethingChanged = true;
        document.getElementById('btnSave').disabled = false;
        i18n.updateDocument();
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
          });
    });

}, { once: true });
 

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
    document.getElementById('selectNeedSelectedNew').value = '0';
    document.getElementById('selectNeedSignatureNew').value = '0';
    document.getElementById('selectNeedCustomTextNew').value = '0';
    document.getElementById('formNew').style.display = 'none';
}

function inputSetError(input) {
    document.getElementById(input).style.borderColor = 'red';
}

function inputClearError(input) {
    document.getElementById(input).style.borderColor = 'green';
}

function checkSelectedBoxes(checkboxes = null) {
    if(checkboxes == null){
        checkboxes = [
            ...document.querySelectorAll('.need_selected[type="checkbox"]'),
            ...document.querySelectorAll('.need_signature[type="checkbox"]'),
            ...document.querySelectorAll('.need_custom_text[type="checkbox"]'),
            ...document.querySelectorAll('.enabled[type="checkbox"]'),
        ];
    }

    // Iterate through the checkboxes
    checkboxes.forEach(checkbox => {
        // Check if the 'checked' attribute is "0"
        if (checkbox.getAttribute('checked_val') === "0") {
            // Uncheck the checkbox
            checkbox.checked = false;
        } else {
            checkbox.checked = true;
        }
    });
}

//Save all prompts
function saveAll() {                //TODO
    somethingChanged = false;
    if(promptsList != null) {
        promptsList.reIndex();
        let newPrompts = promptsList.items.map(item => {
            // For each item in the array, return only the '_values' part
            return item.values();
        });
        // newPrompts.forEach(prompt => {
        //     console.log('>>>>>>>>>>>>> id: ' + JSON.stringify(prompt));
        // });
        console.log('>>>>>>>>>>>>> saveAll: ' + JSON.stringify(newPrompts));
        let newDefaultPrompts = newPrompts.filter(item => item.is_default == 1);
        console.log('>>>>>>>>>>>>> newDefaultPrompts: ' + JSON.stringify(newDefaultPrompts));
        //let newCustomPrompts = newPrompts.filter(item => item.is_default == 0);
        setDefaultPromptsProperties(newDefaultPrompts);
    }
}

// window.addEventListener('beforeunload', function (event) {
//     // Check if any changes have been made
//     if (somethingChanged) {
//         event.preventDefault();
//     }
// });