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

/*  ================= PLACEHOLDERS PROPERTIES ========================================

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

import { transformTagsLabels, getCurrentIdentity } from './mzta-utils.js';

const defaultPlaceholders = [
    {
        id: 'mail_text_body',
        name: "__MSG_placeholder_mail_text_body__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'mail_html_body',
        name: "__MSG_placeholder_mail_html_body__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'mail_typed_text',
        name: "__MSG_placeholder_mail_typed_text__",
        default_value: "",
        type: 2,
        is_default: "1",
    },
    {
        id: 'mail_subject',
        name: "__MSG_placeholder_mail_subject__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'mail_folder_name',
        name: "__MSG_placeholder_folder_name__",
        default_value: "",
        type: 1,
        is_default: "1",
    },
    {
        id: 'mail_folder_path',
        name: "__MSG_placeholder_folder_path__",
        default_value: "",
        type: 1,
        is_default: "1",
    },
    {
        id: 'selected_text',
        name: "__MSG_placeholder_selected_text__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'additional_text',
        name: "__MSG_placeholder_additional_text__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'junk_score',
        name: "__MSG_placeholder_junk_score__",
        default_value: "0",
        type: 1,
        is_default: "1",
    },
    {
        id: 'recipients',
        name: "__MSG_placeholder_recipients__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'cc_list',
        name: "__MSG_placeholder_cc_list__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'author',
        name: "__MSG_placeholder_author__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'mail_datetime',
        name: "__MSG_placeholder_mail_datetime__",
        default_value: "",
        type: 1,
        is_default: "1",
    },
    {
        id: 'current_datetime',
        name: "__MSG_placeholder_current_datetime__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'account_email_address',
        name: "__MSG_placeholder_account_email_address__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'tags_current_email',
        name: "__MSG_placeholder_tags_current_email__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'tags_full_list',
        name: "__MSG_placeholder_tags_full_list__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'thunderai_def_sign',
        name: "__MSG_placeholder_thunderai_def_sign__",
        default_value: "",
        type: 0,
        is_default: "1",
    },
    {
        id: 'thunderai_def_lang',
        name: "__MSG_placeholder_thunderai_def_lang__",
        default_value: "",
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
    let prefs = await browser.storage.local.get({ add_tags: false });
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

    replacePlaceholders(text, replacements, use_default_value = false, skip_additional_text = false) {
        // Regular expression to match patterns like {%...%}
        return text.replace(/{%\s*(.*?)\s*%}/g, function(match, p1) {
          // p1 contains the key inside {% %}
          if (skip_additional_text && (p1 === 'additional_text')) {
            return match;
          }
          // Replace if found, otherwise keep the original or substitute with default value
          return replacements[p1] || (use_default_value ? defaultPlaceholders.find(ph => ph.id === p1).default_value : match);
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

    async getPlaceholdersValues(prompt_text, curr_message, mail_subject, body_text, msg_text, only_typed_text, selection_text, tags_full_list) {
        let currPHs = await placeholdersUtils.extractPlaceholders(prompt_text);
        // console.log(">>>>>>>>>> currPHs: " + JSON.stringify(currPHs));
        let finalSubs = {};
        for(let currPH of currPHs){
            switch(currPH.id){
                case 'mail_text_body':
                    finalSubs['mail_text_body'] = body_text;
                    break;
                case 'mail_html_body':
                    finalSubs['mail_html_body'] = msg_text.html;
                    break;
                case 'mail_typed_text':
                    finalSubs['mail_typed_text'] = only_typed_text;
                    break;
                case 'mail_subject':
                    finalSubs['mail_subject'] = mail_subject;
                    break;
                case 'mail_folder_name':
                    finalSubs['mail_folder_name'] = curr_message.folder.name;
                    break;
                case 'mail_folder_path':
                    finalSubs['mail_folder_path'] = curr_message.folder.path;
                    break;
                case 'selected_text':
                    finalSubs['selected_text'] = selection_text;
                    break;
                case 'author':
                    finalSubs['author'] = curr_message.author;
                    break;
                case 'recipients':
                    finalSubs['recipients'] = curr_message.recipients.join(", ");
                    break;
                case 'cc_list':
                    finalSubs['cc_list'] = curr_message.ccList.join(", ");
                    break;
                case 'junk_score':
                    finalSubs['junk_score'] = curr_message.junkScore;
                    break;
                case 'mail_datetime':
                    finalSubs['mail_datetime'] = curr_message.date;
                    break;
                case 'current_datetime':
                    finalSubs['current_datetime'] = new Date().toString();
                    break;
                case 'account_email_address':
                    let current_identity = await getCurrentIdentity(curr_message, true);
                    finalSubs['account_email_address'] = current_identity.email;
                    break;
                case 'tags_current_email':
                    let tags_current_email_array = await transformTagsLabels(curr_message.tags, tags_full_list[1]);
                    finalSubs['tags_current_email'] = tags_current_email_array.join(", ");
                    break;
                case 'tags_full_list':
                    finalSubs['tags_full_list'] = tags_full_list[0];
                    break;
                case 'thunderai_def_sign':
                    let prefs_def_sign = await browser.storage.sync.get({default_sign_name: ''});
                    finalSubs['thunderai_def_sign'] = prefs_def_sign.default_sign_name;
                    break;
                case 'thunderai_def_lang':
                    let prefs_def_lang = await browser.storage.sync.get({default_chatgpt_lang: ''});
                    finalSubs['thunderai_def_lang'] = prefs_def_lang.default_chatgpt_lang;
                    break;
                default:    // TODO Manage custom placeholders https://github.com/micz/ThunderAI/issues/156
                    break;
            }
        }

        return finalSubs;
    }

}