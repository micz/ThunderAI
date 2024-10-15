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

/*  ================= PROMPTS PROPERTIES ========================================

    ================ BASE PROPERTIES

    Types (type attribute):
    0: always show (when composing a part of the text must be selected if need_selected = 1)
    1: show when reading an email
    2: show when composing a mail (a part of the text must be selected if need_selected = 1)

    ================ USER PROPERTIES
    Enabled (enabled attribute):
    0: Disabled
    1: Enabled

*/

const defaultPlaceholders = [
    {
        id: 'mail_body',
        name: "__MSG_placeholder_mail_body__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'html_body',
        name: "__MSG_placeholder_html_body__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'mail_subject',
        name: "__MSG_placeholder_mail_subject__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'selected_text',
        name: "__MSG_placeholder_selected_text__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'additional_text',  //TODO
        name: "__MSG_placeholder_additional_text__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'junk_score',
        name: "__MSG_placeholder_junk_score__",
        text: "",
        type: 1,
        is_default: "1",
    },
    {
        id: 'recipients',
        name: "__MSG_placeholder_recipients__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'cc_list',
        name: "__MSG_placeholder_cc_list__",
        text: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'author',
        name: "__MSG_placeholder_author__",
        text: "",
        type: 0,
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


export const placeholdersUtils = {

    async extractPlaceholders(text) {
        // Regular expression to match patterns like {%...%}
        const regex = /{%\s*(.*?)\s*%}/g;
        let matches = [];
        let match;

        let activePHs = await getPlaceholders(true);
      
        // Use exec to find all matches
        while ((match = regex.exec(text)) !== null) {
          const foundPH = activePHs.find(ph => ph.id === match[1].trim());
          if (foundPH) {
            matches.push(foundPH);
          }
        }
      
        return matches;
    },

    replacePlaceholders(text, replacements) {
        // Regular expression to match patterns like {%...%}
        return text.replace(/{%\s*(.*?)\s*%}/g, function(match, p1) {
          // p1 contains the key inside {% %}
          return replacements[p1] || match; // Replace if found, otherwise keep the original
        });
    },

    hasPlaceholder(text, placeholder = "") {
        let regex;
      
        // If a specific placeholder is provided, we search for it
        if (placeholder !== "") {
          // Dynamically build the regex for the specific placeholder
          regex = new RegExp(`{%\s*${placeholder}\s*%}`);
        } else {
          // Otherwise, we search for any placeholder in the format {% ... %}
          regex = /{%\s*(.*?)\s*%}/;
        }
      
        // Check if the specific or any placeholder is present in the text
        return regex.test(text);
      },

}