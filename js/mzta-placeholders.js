/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
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

const defaultPlaceholders = [
    {
        id: 'mail_body',
        name: "__MSG_placeholder_mail_body__",
        text: "",
        is_default: "1",
    },
    {
        id: 'mail_subject',
        name: "__MSG_placeholder_mail_subject__",
        text: "",
        is_default: "1",
    },
    {
        id: 'selected_text',
        name: "__MSG_placeholder_selected_text__",
        text: "",
        is_default: "1",
    },
    {
        id: 'additional_text',
        name: "__MSG_placeholder_additional_text__",
        text: "",
        is_default: "1",
    },
];


export async function getPlaceholders(onlyEnabled = false){
    const _defaultPlaceholders = await getDefaultPlaceholders_withProps();
    // console.log('>>>>>>>>>>>> getPlaceholders _defaultPlaceholders: ' + JSON.stringify(_defaultPlaceholders));
    const customPlaceholders = await getCustomPlaceholders();
    // console.log('>>>>>>>>>>>> getPlaceholders customPlaceholders: ' + JSON.stringify(customPlaceholders));
    let output = _defaultPlaceholders.concat(customPlaceholders);
    if(onlyEnabled){
        output = output.filter(obj => obj.enabled != 0);
    }else{  // order only if we are not filtering, the filtering is for the automplete and we are ordering there after i18n
        output.sort((a, b) => a.id.localeCompare(b.id));
    }
    for(let i=1; i<=output.length; i++){
        output[i-1].idnum = i;
    }
    // console.log('>>>>>>>>>>>> getPlaceholders output: ' + JSON.stringify(output));
    return output;
}

async function getDefaultPlaceholders_withProps() {
    let prefs = await browser.storage.local.get({_default_placeholders_properties: null});
    // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps prefs: ' + JSON.stringify(prefs));
    //let defaultPlaceholders_prop = [...defaultPlaceholders];
    let defaultPlaceholders_prop = JSON.parse(JSON.stringify(defaultPlaceholders));
    // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps defaultPlaceholders: ' + JSON.stringify(defaultPlaceholders));
    // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps defaultPlaceholders_prop: ' + JSON.stringify(defaultPlaceholders_prop));
    if(prefs._default_placeholders_properties === null){     // no default Placeholders properties saved
        defaultPlaceholders_prop.forEach((placeholder) => {
            placeholder.enabled = 1;
        })
        // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps [no prop saved] defaultPlaceholders_prop: ' + JSON.stringify(defaultPlaceholders_prop));
    } else {    // we have saved default Placeholders properties
        defaultPlaceholders_prop.forEach((placeholder) => {
            if(prefs._default_Placeholders_properties?.[placeholder.id]){
                placeholder.enabled = prefs._default_Placeholders_properties[placeholder.id].enabled;
            }else{
                placeholder.enabled = 1;
            }
        })
        // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps [prop saved] defaultPlaceholders_prop: ' + JSON.stringify(defaultPlaceholders_prop));
    }
    return defaultPlaceholders_prop;
}

async function getCustomPlaceholders() {
    let prefs = await browser.storage.local.get({_custom_placeholder: null});
    if(prefs._custom_placeholder === null){
        return [];
    } else {
        return prefs._custom_placeholder;
    }
}

export async function setDefaultPlaceholdersProperties(placeholders) {
    let default_placeholders_properties = {};
    placeholders.forEach((placeholder) => {
        default_placeholders_properties[placeholder.id] = {enabled: placeholder.enabled};
    });
    //console.log('>>>>>>>>>>>>>> default_placeholders_properties: ' + JSON.stringify(default_placeholders_properties));
    await browser.storage.local.set({_default_placeholders_properties: default_placeholders_properties});
}

export async function setCustomPlaceholders(placeholders) {
    await browser.storage.local.set({_custom_placeholder: placeholders});
}