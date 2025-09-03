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

    API Model
    <api_model>: api model

*/

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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
    },
    {
        id: 'prompt_translate_this',
        name: "__MSG_prompt_translate_this__",
        text: "prompt_translate_this_full_text",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "0",
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
        api_model: '',
        is_default: "1",
        is_special: "1",
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
        api_model: '',
        is_default: "1",
        is_special: "1",
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
        api_model: '',
        is_default: "1",
        is_special: "1",
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
        api_model: '',
        is_default: "1",
        is_special: "1",
    },
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

export function preparePromptsForExport(prompts){
    let output = [...prompts];
    output.forEach(prompt => {
        if(prompt.is_default == 1){
            Object.keys(prompt).forEach(key => {
                if(!['id', 'enabled', 'position_compose', 'position_display', 'need_custom_text'].includes(key)){
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
                prompt.enabled = prefs._default_prompts_properties[prompt.id].enabled;
                prompt.need_custom_text = prefs._default_prompts_properties[prompt.id].need_custom_text;
                prompt.chatgpt_web_model = prefs._default_prompts_properties[prompt.id].chatgpt_web_model;
                prompt.chatgpt_web_project = prefs._default_prompts_properties[prompt.id].chatgpt_web_project;
                prompt.chatgpt_web_custom_gpt = prefs._default_prompts_properties[prompt.id].chatgpt_web_custom_gpt;
                prompt.api_type = prefs._default_prompts_properties[prompt.id].api_type;
                prompt.api_model = prefs._default_prompts_properties[prompt.id].api_model;
            }else{
                prompt.position_display = pos;
                prompt.position_compose = pos;
                prompt.enabled = 1;
                pos++;
            }
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    }
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
            if(prompt.api_model === undefined){
                prompt.api_model = "";
            }
        });
        return prefs._custom_prompt;
    }
}

export async function setDefaultPromptsProperties(prompts) {
    let default_prompts_properties = {};
    prompts.forEach((prompt) => {
        default_prompts_properties[prompt.id] = {
            position_compose: prompt.position_compose,
            position_display: prompt.position_display,
            enabled: prompt.enabled,
            need_custom_text: prompt.need_custom_text,
            chatgpt_web_model: prompt.chatgpt_web_model,
            chatgpt_web_project: prompt.chatgpt_web_project,
            chatgpt_web_custom_gpt: prompt.chatgpt_web_custom_gpt,
            api_type: prompt.api_type,
            api_model: prompt.api_model
        };
    });
    //console.log('>>>>>>>>>>>>>> default_prompts_properties: ' + JSON.stringify(default_prompts_properties));
    await browser.storage.local.set({_default_prompts_properties: default_prompts_properties});
}

export async function setCustomPrompts(prompts) {
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
    if (prompt.is_special === "1") {
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
    if (prompt.is_default === "0") {
        let customPrompts = await getCustomPrompts();
        let index = customPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            customPrompts.push(prompt);
        } else {
            customPrompts[index] = prompt;
        }
        await setCustomPrompts(customPrompts);
    } else {       // Default Prompt
        let defaultPrompts = getDefaultPrompts_withProps();
        let index = defaultPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            defaultPrompts.push(prompt);
        } else {
            defaultPrompts[index] = prompt;
        }
        await setDefaultPromptsProperties(defaultPrompts);
    }
}
