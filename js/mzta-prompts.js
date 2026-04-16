/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

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

// Modified prompts text derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/html/globals.js

/*  ================= PROMPTS PROPERTIES ========================================

    ================ BASE PROPERTIES

    Types (type attribute):
    0: always show (when composing a part of the text must be selected if need_selected = 1)
    1: show when reading an email
    2: show when composing a mail (a part of the text must be selected if need_selected = 1)

    Actions (action attribute):
    0: close button
    1: do reply
    2: substitute text

    Only if text selected (need_selected attribute):
    0: no selection needed (use all the message body)
    1: need a selection

    Signature (need_signature attribute):
    0: No signature needed
    1: Signature needed

    Custom Text (need_custom_text attribute):
    0: No custom text needed
    1: Custom text needed

    Define response language (define_response_lang attribute):
    0: Do not include a statement about the response language in the prompt
    1: Include a statement about the response language in the prompt

    Use the diff viewer (use_diff_viewer attribute):
    0: Do not use the diff viewer
    1: Use the diff viewer

    ================ DYNAMIC PROPERTIES (set at runtime via prompt_info)

    headerMessageId (set by _openSummaryWebchat in mzta-background.js):
    When present, the webchat UI shows a "Save as Summary" button to capture
    the AI response and save it as an inline summary for the message identified
    by this headerMessageId.

    summaryTabId (set by _openSummaryWebchat in mzta-background.js):
    The tab ID of the message display tab to update with the saved summary.

    Show in menu (show_in attribute):
    "popup": Show only in the popup menu
    "context": Show only in the context menu
    "both": Show in both popup and context menus
    "none": Do not show in any menu

    ================ USER PROPERTIES
    Enabled (enabled attribute):
    0: Disabled
    1: Enabled

    Position Display Message (position_display attribute):
    <num>: position number

    Position Compose Message (position_compose attribute):
    <num>: position number

    ChatGPT Web Model (chatgpt_web_model attribute):
    <model>: model name (e.g. gpt-4, gpt-3.5-turbo, etc.)

    ChatGPT Web Project (chatgpt_web_project attribute):
    <project>: project id url

    ChatGPT Web Custom GPT (chatgpt_web_custom_gpt attribute):
    <custom_gpt>: custom gpt id url

    API Connection Type
    <api_type>: api type

    << All the API settings defined in the default options, with the same IDs. >>
*/

import { integration_options_config } from "../../options/mzta-options-default.js";

const defaultPrompts = [
    {
        id: 'prompt_reply',
        name: "__MSG_prompt_reply__",
        text: "prompt_reply_full_text",
        type: "1",
        action: "1",
        need_selected: "0",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_reply_advanced',
        name: "__MSG_prompt_reply_advanced__",
        text: "prompt_reply_advanced_full_text",
        type: "1",
        action: "1",
        need_selected: "1",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_reply_custom_command',
        name: "__MSG_prompt_reply_custom_command__",
        text: "prompt_reply_custom_command_full_text",
        type: "1",
        action: "1",
        need_selected: "0",
        need_signature: "1",
        need_custom_text: "1",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_rewrite_polite',
        name: "__MSG_prompt_rewrite_polite__",
        text: "prompt_rewrite_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_rewrite_formal',
        name: "__MSG_prompt_rewrite_formal__",
        text: "prompt_rewrite_formal_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_classify',
        name: "__MSG_prompt_classify__",
        text: "prompt_classify_full_text",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_summarize_this',
        name: "__MSG_prompt_summarize_this__",
        text: "prompt_summarize_this_full_text",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_proofread_this',
        name: "__MSG_prompt_proofread_this__",
        text: "prompt_proofread_this_full_text",
        type: "2",
        action: "2",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_this',
        name: "__MSG_prompt_this__",
        text: "prompt_this_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
];

const specialPrompts = [
    {
        id: 'prompt_add_tags',
        name: "__MSG_prompt_add_tags__",
        text: "prompt_add_tags_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_get_calendar_event',
        name: "__MSG_prompt_get_calendar_event__",
        text: "prompt_get_calendar_event_full_text",
        type: "1",
        action: "0",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_get_calendar_event_from_clipboard',
        name: "__MSG_prompt_get_calendar_event_from_clipboard__",
        text: "prompt_get_calendar_event_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_get_task',
        name: "__MSG_prompt_get_task__",
        text: "prompt_get_task_full_text",
        type: "1",
        action: "0",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_spamfilter',
        name: "__MSG_prompt_spamfilter__",
        text: "prompt_spamfilter_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_summarize',
        name: "__MSG_prompt_summarize__",
        text: "prompt_summarize_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_summarize_email_template',
        name: "__MSG_prompt_summarize_email_template__",
        text: "prompt_summarize_email_template_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "none",
    },
    {
        id: 'prompt_summarize_email_separator',
        name: "__MSG_prompt_summarize_email_separator__",
        text: "prompt_summarize_email_separator_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "none",
    },
    {
        id: 'prompt_translate_this',
        name: "__MSG_prompt_translate_this__",
        text: "prompt_translate_this_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    }
];


export async function getPrompts(onlyEnabled = false, includeSpecial = [], allSpecial = false){ // includeSpecial is an array of active special prompts ids
    const _defaultPrompts = await getDefaultPrompts_withProps();
    // console.log('>>>>>>>>>>>> getPrompts _defaultPrompts: ' + JSON.stringify(_defaultPrompts));
    const customPrompts = await getCustomPrompts();
    // console.log('>>>>>>>>>>>> getPrompts customPrompts: ' + JSON.stringify(customPrompts));
    const specialPrompts = await getSpecialPrompts();
    let output = specialPrompts.concat(_defaultPrompts).concat(customPrompts);
    if((includeSpecial.length == 0) && !allSpecial){
        output = output.filter(obj => obj.is_special != 1); // we do not want special prompts
    }else{
        // console.log(">>>>>>>>>> getPrompts includeSpecial: " + JSON.stringify(includeSpecial));
        output = output.filter(obj => includeSpecial.includes(obj.id) || obj.is_special != 1 || allSpecial);
        // output = output.filter(obj => {
        //     const isIncluded = includeSpecial.includes(obj.id);
        //     const isNotSpecial = obj.is_special != 1;

        //     console.log(`>>>>>>>>>> Checking obj:`, obj);
        //     console.log(`>>>>>>>>>> isIncluded: ${isIncluded}`);
        //     console.log(`>>>>>>>>>> isNotSpecial: ${isNotSpecial}`);

        //     return isIncluded || isNotSpecial;
        //   });
    }
    if(onlyEnabled){
        output = output.filter(obj => obj.enabled != 0);
    }else{  // order only if we are not filtering, the filtering is for the menus and we are ordering there after i18n
        output.sort((a, b) => a.id.localeCompare(b.id));
    }
    for(let i=1; i<=output.length; i++){
        output[i-1].idnum = i;
    }
    // console.log('>>>>>>>>>>>> getPrompts output: ' + JSON.stringify(output));
    return output;
}

export function preparePromptsForExport(prompts, include_api_settings = false){
    let output = JSON.parse(JSON.stringify(prompts));
    output.forEach(prompt => {

        if(!include_api_settings){
            delete prompt.api_type;
            for (const [integration, options] of Object.entries(integration_options_config)) {
                for (const key of Object.keys(options)) {
                    delete prompt[`${integration}_${key}`];
                }
            }
        } else {
            if(prompt.api_type && prompt.api_type !== ''){
                const activeIntegration = prompt.api_type.replace('_api', '');
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    if(integration !== activeIntegration){
                        for (const key of Object.keys(options)) {
                            delete prompt[`${integration}_${key}`];
                        }
                    }
                }
            } else {
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    for (const key of Object.keys(options)) {
                        delete prompt[`${integration}_${key}`];
                    }
                }
            }
        }

        if(prompt.is_default == 1){
            let allowedKeys = ['id', 'enabled', 'position_compose', 'position_display', 'position_context', 'need_custom_text', 'show_in'];
            if(include_api_settings){
                allowedKeys.push('api_type');
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    for (const key of Object.keys(options)) {
                        allowedKeys.push(`${integration}_${key}`);
                    }
                }
            }
            Object.keys(prompt).forEach(key => {
                if(!allowedKeys.includes(key)){
                    delete prompt[key];
                }
            })
        }else{
            delete prompt['idnum'];
        }
        
    });
    return output;
}

export async function preparePromptsForImport(prompts){
    // console.log(">>>>>>>>>>> preparePromptsForImport prompts: " + JSON.stringify(prompts));
    const output = await getPrompts();
    // console.log(">>>>>>>>>>> preparePromptsForImport output: " + JSON.stringify(output));
    prompts.forEach(prompt => {
        if(output.some(p => p.id == prompt.id)){
            Object.keys(prompt).forEach(key => {
               output.find(p => p.id == prompt.id)[key] = prompt[key];
            })
        }else{
            output.push(prompt);
        }
    });
    output.sort((a, b) => a.id.localeCompare(b.id));
    // console.log(">>>>>>>>>>> preparePromptsForImport final output: " + JSON.stringify(output));
    return output;
}

async function getDefaultPrompts_withProps() {
    let prefs = await browser.storage.local.get({_default_prompts_properties: null});
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps prefs: ' + JSON.stringify(prefs));
    //let defaultPrompts_prop = [...defaultPrompts];
    let defaultPrompts_prop = JSON.parse(JSON.stringify(defaultPrompts));
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps defaultPrompts: ' + JSON.stringify(defaultPrompts));
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    if(prefs._default_prompts_properties === null){     // no default prompts properties saved
        let pos = 1;
        defaultPrompts_prop.forEach((prompt) => {
            prompt.text = browser.i18n.getMessage(prompt.text);
            prompt.position_display = pos;
            prompt.position_compose = pos;
            prompt.position_context = pos;
            prompt.enabled = 1;
            pos++;
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [no prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    } else {    // we have saved default prompts properties
        let pos = 1000;
        defaultPrompts_prop.forEach((prompt) => {
            prompt.text = browser.i18n.getMessage(prompt.text);
            if(prefs._default_prompts_properties?.[prompt.id]){
                prompt.position_compose = prefs._default_prompts_properties[prompt.id].position_compose;
                prompt.position_display = prefs._default_prompts_properties[prompt.id].position_display;
                prompt.position_context = prefs._default_prompts_properties[prompt.id]?.position_context || prompt.position_display;
                prompt.enabled = prefs._default_prompts_properties[prompt.id].enabled;
                prompt.need_custom_text = prefs._default_prompts_properties[prompt.id].need_custom_text;
                prompt.chatgpt_web_model = prefs._default_prompts_properties[prompt.id].chatgpt_web_model;
                prompt.chatgpt_web_project = prefs._default_prompts_properties[prompt.id].chatgpt_web_project;
                prompt.chatgpt_web_custom_gpt = (prefs._default_prompts_properties[prompt.id]?.chatgpt_web_custom_gpt || '').trim();
                prompt.api_type = (prefs._default_prompts_properties[prompt.id]?.api_type || '').trim();
                prompt.show_in = prefs._default_prompts_properties[prompt.id]?.show_in || prompt.show_in;
            }else{
                prompt.position_display = pos;
                prompt.position_compose = pos;
                prompt.position_context = pos;
                prompt.enabled = 1;
                pos++;
            }
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    }
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [final] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    return defaultPrompts_prop;
}


async function getCustomPrompts() {
    let prefs = await browser.storage.local.get({_custom_prompt: null});
    if(prefs._custom_prompt === null){
        return [];
    } else {
        prefs._custom_prompt.forEach(prompt => {
            if (prompt.use_diff_viewer === undefined) {
                prompt.use_diff_viewer = "0";
            }
            if(prompt.chatgpt_web_model === undefined){
                prompt.chatgpt_web_model = "";
            }
            if(prompt.chatgpt_web_project === undefined){
                prompt.chatgpt_web_project = "";
            }
            if(prompt.chatgpt_web_custom_gpt === undefined){
                prompt.chatgpt_web_custom_gpt = "";
            }
            if(prompt.api_type === undefined){
                prompt.api_type = "";
            }
            if(prompt.show_in === undefined){
                prompt.show_in = "popup";
            }
        });
        return prefs._custom_prompt;
    }
}

export async function setDefaultPromptsProperties(prompts) {
    let default_prompts_properties = {};
    prompts.forEach((prompt) => {
        default_prompts_properties[prompt.id] = {
            position_compose: (prompt.position_compose === undefined || prompt.position_compose === "undefined") ? "" : prompt.position_compose,
            position_display: (prompt.position_display === undefined || prompt.position_display === "undefined") ? "" : prompt.position_display,
            position_context: (prompt.position_context === undefined || prompt.position_context === "undefined") ? "" : prompt.position_context,
            enabled: (prompt.enabled === undefined || prompt.enabled === "undefined") ? "" : prompt.enabled,
            need_custom_text: (prompt.need_custom_text === undefined || prompt.need_custom_text === "undefined") ? "" : prompt.need_custom_text,
            chatgpt_web_model: (prompt.chatgpt_web_model === undefined || prompt.chatgpt_web_model === "undefined") ? "" : prompt.chatgpt_web_model,
            chatgpt_web_project: (prompt.chatgpt_web_project === undefined || prompt.chatgpt_web_project === "undefined") ? "" : prompt.chatgpt_web_project,
            chatgpt_web_custom_gpt: (prompt.chatgpt_web_custom_gpt === undefined || prompt.chatgpt_web_custom_gpt === "undefined") ? "" : prompt.chatgpt_web_custom_gpt,
            api_type: (prompt.api_type === undefined || prompt.api_type === "undefined") ? "" : prompt.api_type,
            show_in: (prompt.show_in === undefined || prompt.show_in === "undefined") ? "popup" : prompt.show_in,
        };
    });
    //console.log('>>>>>>>>>>>>>> default_prompts_properties: ' + JSON.stringify(default_prompts_properties));
    await browser.storage.local.set({_default_prompts_properties: default_prompts_properties});
}

export async function setCustomPrompts(prompts) {
    // console.log(">>>>>>>>>>>> setCustomPrompts prompts: " + JSON.stringify(prompts));
    await browser.storage.local.set({_custom_prompt: prompts});
}

export async function getSpecialPrompts(){
    let prefs = await browser.storage.local.get({_special_prompts: null});
    if(prefs._special_prompts === null){
        let def_specPrompts = structuredClone(specialPrompts);
        def_specPrompts.forEach((prompt) => {
            // console.log(">>>>>>>>>>>>> getSpecialPrompts prompt: " + JSON.stringify(prompt));
            prompt.text = browser.i18n.getMessage(prompt.text);
        })
        return def_specPrompts;
    } else {
        let updatedPrompts = structuredClone(prefs._special_prompts);

        specialPrompts.forEach((defaultPrompt) => {
            if (!updatedPrompts.some((prompt) => prompt.id === defaultPrompt.id)) {
                let newPrompt = structuredClone(defaultPrompt);
                newPrompt.text = browser.i18n.getMessage(newPrompt.text);
                updatedPrompts.push(newPrompt);
            }
        });
        // Migrate: add show_in if missing from saved special prompts
        updatedPrompts.forEach((prompt) => {
            if (prompt.show_in === undefined) {
                prompt.show_in = "both";
            }
        });

        // console.log(">>>>>>>>>>>>> getSpecialPrompts updatedPrompts: " + JSON.stringify(updatedPrompts));
        if (updatedPrompts.length !== prefs._special_prompts.length) {
            await browser.storage.local.set({ _special_prompts: updatedPrompts });
        }

        return updatedPrompts;
    }
}

export async function setSpecialPrompts(prompts) {
    // console.log(">>>>>>>>>>>> setSpecialPrompts prompts: " + JSON.stringify(prompts));
    await browser.storage.local.set({_special_prompts: prompts});
}

export function getHiddenSpecialPromptIds() {
    return specialPrompts.filter(p => p.show_in === "none").map(p => p.id);
}

// Migration: if dynamic_menu_order_alphabet was true (or unset), assign initial positions
// so that prompts appear alphabetically with special prompts first, then disable the flag
// to switch to position-based ordering permanently.
export async function migrateMenuOrderAlphabetic() {
    const prefs = await browser.storage.sync.get({ dynamic_menu_order_alphabet: true });
    if (!prefs.dynamic_menu_order_alphabet) {
        return;
    }

    const allPrompts = await getPrompts(false, [], true);
    const hiddenSpecialIds = getHiddenSpecialPromptIds();
    const visiblePrompts = allPrompts.filter(p => !hiddenSpecialIds.includes(p.id));

    const resolveName = (p) => {
        const n = p.name || '';
        if (n.startsWith('__MSG_') && n.endsWith('__')) {
            return browser.i18n.getMessage(n.substring(6, n.length - 2));
        }
        return n;
    };

    const specials = visiblePrompts.filter(p => String(p.is_special) === '1')
        .sort((a, b) => resolveName(a).localeCompare(resolveName(b)));
    const others = visiblePrompts.filter(p => String(p.is_special) !== '1')
        .sort((a, b) => resolveName(a).localeCompare(resolveName(b)));
    const ordered = specials.concat(others);

    ordered.forEach((prompt, idx) => {
        const pos = idx + 1;
        prompt.position_display = pos;
        prompt.position_compose = pos;
        prompt.position_context = pos;
    });

    const defaultPromptsToSave = ordered.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1');
    const customPromptsToSave = ordered.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1');
    const visibleSpecialsToSave = ordered.filter(p => String(p.is_special) === '1');
    const hiddenSpecialsToPreserve = allPrompts.filter(p => hiddenSpecialIds.includes(p.id));

    await setDefaultPromptsProperties(defaultPromptsToSave);
    await setCustomPrompts(customPromptsToSave);
    await setSpecialPrompts(visibleSpecialsToSave.concat(hiddenSpecialsToPreserve));

    await browser.storage.sync.set({ dynamic_menu_order_alphabet: false });
}

export async function getSpamFilterPrompt(){
    return (await getSpecialPrompts()).find(prompt => prompt.id == 'prompt_spamfilter');
}

export async function loadPrompt(id) {
    let allPrompts = await getPrompts(false,[],true);
    // console.log(">>>>>>>>>>>> loadPrompt id: " + id + " - allPrompts: " + JSON.stringify(allPrompts));
    return allPrompts.find(prompt => prompt.id === id);
}

export async function savePrompt(prompt) {
    // console.log(">>>>>>>>>>>>> savePrompt prompt: " + JSON.stringify(prompt));
    if (prompt.id === undefined) {
        throw new Error("Invalid prompt: " + JSON.stringify(prompt));
    }
    // Special Prompt
    if ((prompt.is_special === "1")||(prompt.is_special === 1)) {
        let specialPrompts = await getSpecialPrompts();
        let index = specialPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            specialPrompts.push(prompt);
        } else {
            specialPrompts[index] = prompt;
        }
        await setSpecialPrompts(specialPrompts);
        return;
    }
    // Custom Prompt
    if ((prompt.is_default === "0")||(prompt.is_default === 0)) {
        let customPrompts = await getCustomPrompts();
        let index = customPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            customPrompts.push(prompt);
        } else {
            customPrompts[index] = prompt;
        }
        // console.log(">>>>>>>>>>>> savePrompt customPrompts: " + JSON.stringify(customPrompts));
        await setCustomPrompts(customPrompts);
    } else {       // Default Prompt
        let defaultPrompts = await getDefaultPrompts_withProps();
        let index = defaultPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            defaultPrompts.push(prompt);
        } else {
            defaultPrompts[index] = prompt;
        }
        await setDefaultPromptsProperties(defaultPrompts);
    }
}

export async function clearPromptAPI(id){
    let _prompt = await loadPrompt(id);
    // console.log(">>>>>>>>>>>>> clearPromptAPI _prompt BEFORE: " + JSON.stringify(_prompt));
    _prompt.api_type = "";
    // Reset all integration-specific settings to their default values
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            if (_prompt.hasOwnProperty(propName)) {
                _prompt[propName] = '';
            }
        }
    }
    // console.log(">>>>>>>>>>>>> clearPromptAPI _prompt AFTER: " + JSON.stringify(_prompt));
    await savePrompt(_prompt);
}
