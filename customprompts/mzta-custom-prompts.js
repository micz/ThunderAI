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

document.addEventListener('DOMContentLoaded', async () => {
    let options = {
        valueNames: [ { data: ['idnum'] }, 'is_default', 'id', 'name', 'text', 'type', 'action', 'position_compose', 'position_display', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'enabled', attr: 'checked_val'} ],
        // item: `<tr>
        //     <td class="id"></td>
        //     <td class="name"></td>
        //     <td class="text"></td>
        //     <td class="properties">
        //         <input type="checkbox" class="need_selected"> Need Select
        //         <br>
        //         <input type="checkbox" class="need_signature"> Need Signature
        //         <br>
        //         <input type="checkbox" class="need_custom_text"> Need Custom Text
        //         <br>
        //         <span class="is_default">Is Default</span>
        //         <br>
        //         <input type="checkbox" class="enabled"> Enabled
        //     </td>
        // </tr>`
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
              `<span class="type hiddendata">type</span>
              </td>
                <td class="properties">
                    Action: <select class="input_mod"` + ((values.is_default == 1) ? ' disabled':'') + `>
                    <option value="0"` + ((values.action == 0) ? ' selected':'') + `>Close button</option>
                    <option value="1"` + ((values.action == 1) ? ' selected':'') + `>Do reply</option>
                    <option value="2"` + ((values.action == 2) ? ' selected':'') + `>Substitute text</option>
                  </select>
                  <span class="action hiddendata">action</span>
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
            return output;
        }
    };

    let values = await getPrompts();

    console.log('>>>>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    promptsList = new List('all_prompts', options, values);

    checkSelectedBoxes();

    const btnSave = document.getElementById('btnSave');
    btnSave.disabled = true;
    btnSave.addEventListener('click', (e) => {
        e.preventDefault();
        saveAll();
        clearFields();
        document.getElementById('btnSave').disabled = true;
    });

    const btnNew = document.getElementById('btnNew');
    btnNew.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('formNew').style.display = 'block';
    });

    document.querySelectorAll('.input_mod').forEach(element => {
        element.addEventListener('change', (e) => {
            e.preventDefault();
            btnSave.disabled = false;
            somethingChanged = true;
        });
    })

    let btnEditItem_elements = document.querySelectorAll(".btnEditItem");
    if(btnEditItem_elements) {
        btnEditItem_elements.forEach(element => {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                const tr = e.target.parentNode.parentNode;          //TODO
                console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
            });
        });
    }

    let btnDeleteItem_elements = document.querySelectorAll(".btnDeleteItem");
    if(btnDeleteItem_elements) {
        btnDeleteItem_elements.forEach(element => {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                const check_confirm = window.confirm("Sei sicuro di voler cancellare questo elemento?");
                if(!check_confirm) {
                    return;
                }
                const tr = e.target.parentNode.parentNode;          //TODO
                console.log('>>>>>>>> tr: ' + tr.getAttribute('data-idnum'));
            });
        });
    }

    let btnNew_elements = document.querySelectorAll(".input_new");
    if(btnNew_elements) {
        btnNew_elements.forEach(element => {
            element.addEventListener('change', (e) => {
                e.preventDefault();
                checkFields();
            });
        });
    }

    let checkbox_elements = document.querySelectorAll("input[type='checkbox']");
    if(checkbox_elements) {
        checkbox_elements.forEach(element => {
            element.addEventListener('change', (e) => {
                e.preventDefault();
                element.setAttribute('checked_val', element.checked ? '1' : '0');
                console.log('>>>>>>>> checked_val: ' + element.getAttribute('checked_val'));
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
        //TODO check the id must be unique and without spaces
        promptsList.add({
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
        });
        //checkSelectedBoxes([selectTypeNew, selectActionNew, selectNeedSelectedNew, selectNeedSignatureNew, selectNeedCustomTextNew]);
        checkSelectedBoxes();
        clearFields();
        somethingChanged = true;
        document.getElementById('btnSave').disabled = false;
        i18n.updateDocument();
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