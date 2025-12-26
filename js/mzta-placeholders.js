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

import { prefs_default } from '../options/mzta-options-default.js';
import { getMailHeader } from './mzta-utils.js';

/*  ================= PLACEHOLDERS PROPERTIES ========================================

    ================ BASE PROPERTIES

    id: unique identifier, used to identify the placeholder
    name: name of the placeholder, used for display purposes
    default_value: default value of the placeholder, used when the placeholder is not replaced (only for default placeholders)

    type attribute:
    0: always show (when composing a part of the text must be selected if need_selected = 1)
    1: show when reading an email
    2: show when composing a mail (a part of the text must be selected if need_selected = 1)

    is_default attribute:
    0: Custom placeholder
    1: Default placeholder (not editable, cannot be deleted)

    is_dynamic attribute:
    0: it's a fixed placeholder
    1: it's a dynamic placehoder (it means that it will have a : and then a value, like {%my_placeholder:test_value%})

    ================ USER PROPERTIES
    enabled attribute:
    0: Disabled
    1: Enabled

    text: text of the placeholder (only for custom placeholders)

*/

import { transformTagsLabels, getCurrentIdentity } from './mzta-utils.js';

const defaultPlaceholders = [
    {
        id: 'mail_text_body',
        name: "__MSG_placeholder_mail_text_body__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_html_body',
        name: "__MSG_placeholder_mail_html_body__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_typed_text',
        name: "__MSG_placeholder_mail_typed_text__",
        default_value: "",
        type: 2,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_quoted_text',
        name: "__MSG_placeholder_mail_quoted_text__",
        default_value: "",
        type: 2,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_subject',
        name: "__MSG_placeholder_mail_subject__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_folder_name',
        name: "__MSG_placeholder_folder_name__",
        default_value: "",
        type: 1,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_folder_path',
        name: "__MSG_placeholder_folder_path__",
        default_value: "",
        type: 1,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_headers',
        name: "__MSG_placeholder_mail_headers__",
        default_value: "",
        type: 1,
        is_default: "1",
        is_dynamic: "1",
        enabled: 1,
    },
    {
        id: 'selected_text',
        name: "__MSG_placeholder_selected_text__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'selected_html',
        name: "__MSG_placeholder_selected_html__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'additional_text',
        name: "__MSG_placeholder_additional_text__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'junk_score',
        name: "__MSG_placeholder_junk_score__",
        default_value: "0",
        type: 1,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'recipients',
        name: "__MSG_placeholder_recipients__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'cc_list',
        name: "__MSG_placeholder_cc_list__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'author',
        name: "__MSG_placeholder_author__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_datetime',
        name: "__MSG_placeholder_mail_datetime__",
        default_value: "",
        type: 1,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'current_datetime',
        name: "__MSG_placeholder_current_datetime__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'account_email_address',
        name: "__MSG_placeholder_account_email_address__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'tags_current_email',
        name: "__MSG_placeholder_tags_current_email__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'tags_full_list',
        name: "__MSG_placeholder_tags_full_list__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'thunderai_def_sign',
        name: "__MSG_placeholder_thunderai_def_sign__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'thunderai_def_lang',
        name: "__MSG_placeholder_thunderai_def_lang__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'empty',
        name: "__MSG_placeholder_empty__",
        default_value: "",
        type: 0,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    },
    {
        id: 'mail_attachments_info',
        name: "__MSG_placeholder_mail_attachments_info__",
        default_value: "",
        type: 1,
        is_default: "1",
        is_dynamic: "0",
        enabled: 1,
    }
];


export async function getPlaceholders(onlyEnabled = false){
    const _defaultPlaceholders = await getDefaultPlaceholders();
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

async function getDefaultPlaceholders() {
    let defaultPlaceholders_prop = JSON.parse(JSON.stringify(defaultPlaceholders));
    // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps defaultPlaceholders: ' + JSON.stringify(defaultPlaceholders));
    // console.log('>>>>>>>>>>>> getDefaultPlaceholders_withProps defaultPlaceholders_prop: ' + JSON.stringify(defaultPlaceholders_prop));
    return defaultPlaceholders_prop;
}

export async function getCustomPlaceholders() {
    let prefs = await browser.storage.local.get({_custom_placeholder: null});
    if(prefs._custom_placeholder === null){
        return [];
    } else {
        return prefs._custom_placeholder;
    }
}

export async function setCustomPlaceholders(placeholders) {
    placeholders.forEach(ph => {
        ph.id = placeholdersUtils.validateCustomDataPH_ID(ph.id);
        ph.is_default = "0";
        ph.is_dynamic = "0";
    });
    await browser.storage.local.set({_custom_placeholder: placeholders});
}

export function prepareCustomDataPHsForExport(placeholders){
    let output = [...placeholders];
    output.forEach(placeholder => {
        if(placeholder.is_default == 0){
            delete placeholder['idnum'];
        }
    });
    return output;
}

export async function prepareCustomDataPHsForImport(placeholders){
    // console.log(">>>>>>>>>>> prepareCustomDataPHsForImport prompts: " + JSON.stringify(prompts));
    const output = await getCustomPlaceholders();
    // console.log(">>>>>>>>>>> prepareCustomDataPHsForImport output: " + JSON.stringify(output));
    placeholders.forEach(placeholder => {
        if(output.some(p => p.id == placeholder.id)){
            Object.keys(placeholder).forEach(key => {
               output.find(p => p.id == placeholder.id)[key] = placeholder[key];
            })
        }else{
            output.push(placeholder);
        }
    });
    output.sort((a, b) => a.id.localeCompare(b.id));
    // console.log(">>>>>>>>>>> prepareCustomDataPHsForImport final output: " + JSON.stringify(output));
    return output;
}

export function mapPlaceholderToSuggestion(p) {
    // console.log(">>>>>>>>>> mapPlaceholderToSuggestion p" + JSON.stringify(p));
    return {
        command: '{%' + p.id + (p.is_dynamic == 1 ? ':' : '') + '%}',
        type: p.type,
        is_dynamic: p.is_dynamic,
    };
}

export const placeholdersUtils = {

    customPrefix: 'thunderai_custom_',

    validateCustomDataPH_ID(placeholder_id){
        if (!placeholder_id.startsWith(this.customPrefix)) {
            return this.customPrefix + placeholder_id;
        }
        return placeholder_id;
    },

    stripCustomDataPH_ID_Prefix(placeholder_id){
        if (placeholder_id.startsWith(this.customPrefix)) {
            return placeholder_id.substring(this.customPrefix.length);
        }
        return placeholder_id;
    },

    async extractPlaceholders(text) {
        // Regular expression to match patterns like {%...%}
        const regex = /{%\s*(.*?)\s*%}/g;
        let matches = [];
        let match;

        let activePHs = await getPlaceholders(true);
      
        // Use exec to find all matches
        while ((match = regex.exec(text)) !== null) {
            // console.log(">>>>>>>>>> extractPlaceholders match: " + JSON.stringify(match));
          const foundPH = activePHs.find(ph => ph.id === match[1].trim() || (ph.is_dynamic == 1 && match[1].startsWith(ph.id + ':')));
            if (foundPH) {
                if (foundPH.is_dynamic == 1 && match[1].includes(':')) {
                    const [id, custom_value] = match[1].split(':', 2);
                    const dynamicPH = { ...foundPH }; // Create a copy to avoid modifying the original
                    dynamicPH.id = id.trim();
                    dynamicPH.custom_value = custom_value.trim();
                    matches.push(dynamicPH);
                    // console.log(">>>>>>>>>> extractPlaceholders dynamicPH: " + JSON.stringify(dynamicPH));
                } else {
                    matches.push(foundPH);
                    // console.log(">>>>>>>>>> extractPlaceholders foundPH: " + JSON.stringify(foundPH));
                }
            }
        }
      
        return matches;
    },

    replacePlaceholders(args) {
        const {
            text = "",
            replacements = {},
            use_default_value = false,
            skip_additional_text = false
        } = args || {};
        // console.log(">>>>>>>>>> replacePlaceholders replacements: " + JSON.stringify(replacements));
        // Regular expression to match patterns like {%...%}
        return text.replace(/{%\s*(.*?)\s*%}/g, function(match, p1) {
            // console.log(">>>>>>>>>> replacePlaceholders match: " + JSON.stringify(match));
            // console.log(">>>>>>>>>> replacePlaceholders p1: " + JSON.stringify(p1));
            // p1 contains the key inside {% %}
            if (skip_additional_text && (p1 === 'additional_text')) {
                return match;
            }
            const currPlaceholder = defaultPlaceholders.find(ph => (ph.id === p1) || (ph.is_dynamic == 1 && p1.startsWith(ph.id + ':')));
            // console.log(">>>>>>>>>> replacePlaceholders currPlaceholder: " + JSON.stringify(currPlaceholder));
            if (!currPlaceholder) {
                return match;
            }
            // Replace if found, otherwise keep the original or substitute with default value
            return replacements[p1] || (use_default_value ? currPlaceholder.default_value : match);
        });
    },

    async replaceCustomPlaceholders(text) {
        let customPlaceholders = await getCustomPlaceholders(true);
        // Regular expression to match patterns like {%thunderai_custom_...%}
        return text.replace(/{%\s*thunderai_custom_(.*?)\s*%}/g, function(match, p1) {
          // p1 contains the key inside {% %}
          const currPlaceholder = customPlaceholders.find(ph => ph.id === 'thunderai_custom_' + p1);
          if (!currPlaceholder) {
            return match;
          }
          return currPlaceholder.text;
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

    hasCustomPlaceholder(text, placeholder = "") {
        let regex;
      
        // If a specific placeholder is provided, we search for it
        if (placeholder !== "") {
          // Dynamically build the regex for the specific placeholder
          regex = new RegExp(`{%\s*${placeholder}\s*%}`);
        } else {
          // Otherwise, we search for any placeholder in the format {%thunderai_custom_ ... %}
          regex = /{%\s*thunderai_custom_(.*?)\s*%}/;
        }
      
        // Check if the specific or any placeholder is present in the text
        return regex.test(text);
    },

    async getPlaceholdersValues(args) {
        const {
            prompt_text = "",
            curr_message = {},
            mail_subject = "",
            body_text = "",
            msg_text = {},
            only_typed_text = "",
            only_quoted_text = "",
            selection_text = "",
            selection_html = "",
            tags_full_list = ["", []]
        } = args || {};
        let currPHs = await placeholdersUtils.extractPlaceholders(prompt_text);
        // console.log(">>>>>>>>>> currPHs: " + JSON.stringify(currPHs));
        // console.log(">>>>>>>>>> curr_message: " + JSON.stringify(curr_message));
        let finalSubs = {};
        for(let currPH of currPHs){
            // console.log(">>>>>>>>>> currPH: " + JSON.stringify(currPH));
            switch(currPH.id){
                case 'mail_text_body':
                    finalSubs['mail_text_body'] = placeholdersUtils.failSafePlaceholders(body_text);
                    break;
                case 'mail_html_body':
                    finalSubs['mail_html_body'] = placeholdersUtils.failSafePlaceholders(msg_text?.html);
                    break;
                case 'mail_typed_text':
                    finalSubs['mail_typed_text'] = placeholdersUtils.failSafePlaceholders(only_typed_text);
                    break;
                case 'mail_quoted_text':
                    finalSubs['mail_quoted_text'] = placeholdersUtils.failSafePlaceholders(only_quoted_text);
                    break;
                case 'mail_subject':
                    finalSubs['mail_subject'] = placeholdersUtils.failSafePlaceholders(mail_subject);
                    break;
                case 'mail_folder_name':
                    finalSubs['mail_folder_name'] = placeholdersUtils.failSafePlaceholders(curr_message.folder?.name);
                    break;
                case 'mail_folder_path':
                    finalSubs['mail_folder_path'] = placeholdersUtils.failSafePlaceholders(curr_message.folder?.path);
                    break;
                case 'mail_headers':
                    finalSubs['mail_headers:' + currPH.custom_value] = placeholdersUtils.failSafePlaceholders(await getMailHeader(curr_message, currPH.custom_value));
                    break;
                case 'selected_text':
                    finalSubs['selected_text'] = placeholdersUtils.failSafePlaceholders(selection_text);
                    break;
                case 'selected_html':
                    finalSubs['selected_html'] = placeholdersUtils.failSafePlaceholders(selection_html);
                    break;
                case 'author':
                    finalSubs['author'] = placeholdersUtils.failSafePlaceholders(curr_message.author);
                    break;
                case 'recipients':
                    finalSubs['recipients'] = placeholdersUtils.failSafePlaceholders(curr_message.recipients?.join(", "));
                    break;
                case 'cc_list':
                    finalSubs['cc_list'] = placeholdersUtils.failSafePlaceholders(curr_message.ccList?.join(", "));
                    break;
                case 'junk_score':
                    finalSubs['junk_score'] = placeholdersUtils.failSafePlaceholders(curr_message.junkScore);
                    break;
                case 'mail_datetime':
                    finalSubs['mail_datetime'] = placeholdersUtils.failSafePlaceholders(curr_message.date);
                    break;
                case 'current_datetime':
                    finalSubs['current_datetime'] = placeholdersUtils.failSafePlaceholders(new Date().toString());
                    break;
                case 'account_email_address':
                    let current_identity = await getCurrentIdentity(curr_message, true);
                    finalSubs['account_email_address'] = placeholdersUtils.failSafePlaceholders(current_identity.email);
                    break;
                case 'tags_current_email':
                    let tags_current_email_array = await transformTagsLabels(curr_message.tags, tags_full_list[1]);
                    finalSubs['tags_current_email'] = placeholdersUtils.failSafePlaceholders(tags_current_email_array.join(", "));
                    break;
                case 'tags_full_list':
                    finalSubs['tags_full_list'] = placeholdersUtils.failSafePlaceholders(tags_full_list[0]);
                    break;
                case 'thunderai_def_sign':
                    let prefs_def_sign = await browser.storage.sync.get({ default_sign_name: prefs_default.default_sign_name });
                    finalSubs['thunderai_def_sign'] = placeholdersUtils.failSafePlaceholders(prefs_def_sign.default_sign_name);
                    break;
                case 'thunderai_def_lang':
                    let prefs_def_lang = await browser.storage.sync.get({ default_chatgpt_lang: prefs_default.default_chatgpt_lang });
                    finalSubs['thunderai_def_lang'] = placeholdersUtils.failSafePlaceholders(prefs_def_lang.default_chatgpt_lang);
                    break;
                case 'mail_attachments_info':
                    let attachments_info_string = "";
                    let attachments_info = await browser.messages.listAttachments(curr_message.id);
                    if(attachments_info && attachments_info.length > 0){
                        attachments_info_string = attachments_info.map(att => "\"" + att.name + "\" [" + att.contentType + "] (" + Math.round(att.size / 1024) + " KB)").join("\n");
                    }
                    attachments_info_string = attachments_info_string.trimEnd();
                    finalSubs['mail_attachments_info'] = placeholdersUtils.failSafePlaceholders(attachments_info_string);
                    // console.log(">>>>>>>>>> mail_attachments_info: " + finalSubs['mail_attachments_info']);
                    break;
                case 'empty':
                    finalSubs['empty'] = '';
                    break;
                default:    // TODO Manage custom placeholders https://github.com/micz/ThunderAI/issues/156
                    break;
            }
        }
        // console.log(">>>>>>>>>> finalSubs: " + JSON.stringify(finalSubs));
        return finalSubs;
    },

    failSafePlaceholders(element){
        //console.log(">>>>>>>>>> failSafePlaceholders element: " + JSON.stringify(element));
        if(element === null || element === undefined){
            return '';
        }
        return element;
    },

}