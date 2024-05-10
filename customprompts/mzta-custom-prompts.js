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

import { defaultPrompts } from "../js/mzta-prompts.js";

document.addEventListener('DOMContentLoaded', async () => {
    let options = {
        valueNames: [ 'id', 'name', 'text', 'type', 'action', { name: 'need_selected', attr: 'checked_val'}, { name: 'need_signature', attr: 'checked_val'}, { name: 'need_custom_text', attr: 'checked_val'}, { name: 'is_default', attr: 'is_default_val'}, { name: 'enabled', attr: 'enabled_val'} ],
        item: `<tr>
            <td class="id"></td>
            <td class="name"></td>
            <td class="text"></td>
            <td class="properties">
                <input type="checkbox" class="need_selected"> Need Select
                <br>
                <input type="checkbox" class="need_signature"> Need Signature
                <br>
                <input type="checkbox" class="need_custom_text"> Need Custom Text
                <br>
                <span class="is_default">Is Default</span>
                <br>
                <span class="enabled">Enabled</span>
            </td>
        </tr>`
    };

    let values = defaultPrompts; // test in browser
    //let values = await getPrompts();  // production

    console.log('>>>>>>>>>>>>>>>> values: ' + JSON.stringify(values));

    let promptsList = new List('all_prompts', options, values);

    checkSelectedBoxes();

    //i18n.updateDocument();    // production
}, { once: true });
  

function checkSelectedBoxes() {
    // Get all elements with the class 'need_selected' that are checkboxes
    const checkboxes = [
        ...document.querySelectorAll('.need_selected[type="checkbox"]'),
        ...document.querySelectorAll('.need_signature[type="checkbox"]'),
        ...document.querySelectorAll('.need_custom_text[type="checkbox"]'),
    ];

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