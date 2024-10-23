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
    0: Do not include a statement about the response language in the prompt.
    1: Include a statement about the response language in the prompt.

    ================ USER PROPERTIES
    Enabled (enabled attribute):
    0: Disabled
    1: Enabled

    Position Display Message (position_display attribute):
    <num>: position number

    Position Compose Message (position_compose attribute):
    <num>: position number

*/

const defaultPrompts = [
    {
        id: 'prompt_reply',
        name: "__MSG_prompt_reply__",
        text: "Reply to the following email. Reply with only the needed text and with no extra comments or other text.",
        type: "1",
        action: "1",
        need_selected: "0",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_reply_advanced',
        name: "__MSG_prompt_reply_advanced__",
        text: "Reply to the following email \"{%selected_text%}\", considering this is the full thread of emails \"{%mail_html_body%}\". Reply with only the needed text and with no extra comments or other text.",
        type: "1",
        action: "1",
        need_selected: "1",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_rewrite_polite',
        name: "__MSG_prompt_rewrite_polite__",
        text: "Rewrite the following text to be more polite. Reply with only the re-written text and with no extra comments or other text.",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_rewrite_formal',
        name: "__MSG_prompt_rewrite_formal__",
        text: "Rewrite the following text to be more formal. Reply with only the re-written text and with no extra comments or other text.",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_classify',
        name: "__MSG_prompt_classify__",
        text: "Classify the following text in terms of Politeness, Warmth, Formality, Assertiveness, Offensiveness giving a percentage for each category. Reply with only the category and score with no extra comments or other text.",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_summarize_this',
        name: "__MSG_prompt_summarize_this__",
        text: "Summarize the following email into a bullet point list.",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        is_default: "1",
    },
    {
        id: 'prompt_translate_this',
        name: "__MSG_prompt_translate_this__",
        text: "Translate the following email in ",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        is_default: "1",
    },
    {
        id: 'prompt_this',
        name: "__MSG_prompt_this__",
        text: "Reply with only the needed text and with no extra comments or other text.",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        is_default: "1",
    },
];


export async function getPrompts(onlyEnabled = false){
    const _defaultPrompts = await getDefaultPrompts_withProps();
    // console.log('>>>>>>>>>>>> getPrompts _defaultPrompts: ' + JSON.stringify(_defaultPrompts));
    const customPrompts = await getCustomPrompts();
    // console.log('>>>>>>>>>>>> getPrompts customPrompts: ' + JSON.stringify(customPrompts));
    let output = _defaultPrompts.concat(customPrompts);
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
            prompt.position_display = pos;
            prompt.position_compose = pos;
            prompt.enabled = 1;
            pos++;
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [no prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    } else {    // we have saved default prompts properties
        let pos = 1000;
        defaultPrompts_prop.forEach((prompt) => {
            if(prefs._default_prompts_properties?.[prompt.id]){
                prompt.position_compose = prefs._default_prompts_properties[prompt.id].position_compose;
                prompt.position_display = prefs._default_prompts_properties[prompt.id].position_display;
                prompt.enabled = prefs._default_prompts_properties[prompt.id].enabled;
                prompt.need_custom_text = prefs._default_prompts_properties[prompt.id].need_custom_text;
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
        return prefs._custom_prompt;
    }
}

export async function setDefaultPromptsProperties(prompts) {
    let default_prompts_properties = {};
    prompts.forEach((prompt) => {
        default_prompts_properties[prompt.id] = {position_compose: prompt.position_compose, position_display: prompt.position_display, enabled: prompt.enabled, need_custom_text: prompt.need_custom_text};
    });
    //console.log('>>>>>>>>>>>>>> default_prompts_properties: ' + JSON.stringify(default_prompts_properties));
    await browser.storage.local.set({_default_prompts_properties: default_prompts_properties});
}


export async function setCustomPrompts(prompts) {
    await browser.storage.local.set({_custom_prompt: prompts});
}
