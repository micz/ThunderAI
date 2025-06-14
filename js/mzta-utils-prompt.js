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

import { placeholdersUtils } from './mzta-placeholders.js';

export const taPromptUtils = {

    async getDefaultSignature(){
        let prefs = await browser.storage.sync.get({default_sign_name: ''});
        if(prefs.default_sign_name===''){
            return '';
        }else{
            return browser.i18n.getMessage("sign_msg_as") + " " + prefs.default_sign_name + ".";
        }
    },

    async preparePrompt(curr_prompt, curr_message, chatgpt_lang, selection_text, selection_html, body_text, subject_text, msg_text, only_typed_text, only_quoted_text, tags_full_list){
        let fullPrompt = '';
        
        if(!placeholdersUtils.hasPlaceholder(curr_prompt.text)){
            // no placeholders, do as usual
            fullPrompt = curr_prompt.text + (String(curr_prompt.need_signature) == "1" ? " " + await taPromptUtils.getDefaultSignature():"") + " " + chatgpt_lang + " \"" + (selection_text=='' ? body_text : selection_text) + "\" ";
        }else{
            // we have at least a placeholder, do the magic!
            let finalSubs = await placeholdersUtils.getPlaceholdersValues(curr_prompt.text, curr_message, subject_text, body_text, msg_text, only_typed_text, only_quoted_text, selection_text, selection_html, tags_full_list);
            // console.log(">>>>>>>>>> finalSubs: " + JSON.stringify(finalSubs));
            let prefs_ph = await browser.storage.sync.get({placeholders_use_default_value: false});
            fullPrompt = (placeholdersUtils.replacePlaceholders(curr_prompt.text, finalSubs, prefs_ph.placeholders_use_default_value, true) + (String(curr_prompt.need_signature) == "1" ? " " + await taPromptUtils.getDefaultSignature():"") + " " + chatgpt_lang).trim();
        }

        return fullPrompt;
    },

    finalizePrompt_add_tags(fullPrompt, add_tags_maxnum, add_tags_force_lang, default_chatgpt_lang){
        if(add_tags_maxnum > 0){
            fullPrompt += " " + browser.i18n.getMessage("prompt_add_tags_maxnum") + " " + add_tags_maxnum +".";
        }
        if(add_tags_force_lang && default_chatgpt_lang !== ''){
            fullPrompt += " " + browser.i18n.getMessage("prompt_add_tags_force_lang") + " " + default_chatgpt_lang + ".";
        }

        return fullPrompt;
    },

    finalizePrompt_get_calendar_event(fullPrompt){
        fullPrompt = fullPrompt.replace("{%cc_list%}", "");
        fullPrompt = fullPrompt.replace("{%recipients%}", "");

        return fullPrompt;
    },   

    async getDefaultLang(curr_prompt){
        let chatgpt_lang = '';
        if(String(curr_prompt.define_response_lang) == "1"){
            let prefs = await browser.storage.sync.get({default_chatgpt_lang: ''});
            chatgpt_lang = prefs.default_chatgpt_lang;
            if(chatgpt_lang === ''){
                chatgpt_lang = browser.i18n.getMessage("reply_same_lang");
            }else{
                chatgpt_lang = browser.i18n.getMessage("prompt_lang") + " " + chatgpt_lang + ".";
            }
        }

        return chatgpt_lang;
    },

    /**
     * Extracts tags from the response text.
     * @param {string} response_text - The response text from which to extract tags.
     * @returns {Array} An array of tags extracted from the response text.
     * 
     * The response text should be a JSON with this structure:
     * {
     *   "tags": ["tag1", "tag2", ...]
     * }
     * 
     * For backwords compatibility, if the response text is not a valid JSON,
     * it will try to split the text by commas and return the resulting array.
     */
    getTagsFromResponse(response_text){
        let tags = [];
        if(response_text && response_text.length > 0){
            try {
                // Try to parse the response text as JSON
                let response_json = JSON.parse(response_text);
                if(response_json && Array.isArray(response_json.tags)){
                    tags = response_json.tags;
                } else if(response_json && response_json.tags && typeof response_json.tags === 'string'){
                    // If tags is a string, split it by commas
                    tags = response_json.tags.split(',').map(tag => tag.trim());
                }
            } catch (e) {
                // If parsing fails, fallback to splitting by commas
                tags = response_text.split(',').map(tag => tag.trim());
            }
        }
        return tags;
    }
};