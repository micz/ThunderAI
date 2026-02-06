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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { prefs_default, integration_options_config } from '../options/mzta-options-default.js';
import { placeholdersUtils } from '../js/mzta-placeholders.js';
import { getAPIsInitMessageString, convertNewlinesToBr } from '../js/mzta-utils.js';
import { loadPrompt } from '../js/mzta-prompts.js';

// Get the LLM to be used
const urlParams = new URLSearchParams(window.location.search);
const llm = urlParams.get('llm');
const call_id = urlParams.get('call_id');
const ph_def_val = urlParams.get('ph_def_val');
const prompt_id = urlParams.get('prompt_id');
const prompt_name = urlParams.get('prompt_name');

// Data received from the user
let promptData = null;

const messageInput = document.querySelector('message-input');
const messagesArea = document.querySelector('messages-area');

//console.log(">>>>>>>>>> controller.js DOMContentLoaded");

// console.log(">>>>>>>>>>> llm: " + llm);
// console.log(">>>>>>>>>>> call_id: " + call_id);

// The controller wires up all the components and workers together,
// managing the dependencies. A kind of "DI" class.
let worker = null;
const integration = llm.replace('_api', '');
const worker_path_map = {
    chatgpt: '../js/workers/model-worker-openai_responses.js',
    google_gemini: '../js/workers/model-worker-google_gemini.js',
    ollama: '../js/workers/model-worker-ollama.js',
    openai_comp: '../js/workers/model-worker-openai_comp.js',
    anthropic: '../js/workers/model-worker-anthropic.js',
};

const worker_path = worker_path_map[integration];

if (worker_path) {
    worker = new Worker(worker_path, { type: 'module' });
} else {
    console.error('[ThunderAI] API WebChat Unknown LLM type:', llm);
}

if (worker) {
    messagesArea.init(worker);
    messageInput.init(worker);
    messageInput.setMessagesArea(messagesArea);

    if (integration_options_config[integration]) {
        const integration_prefix = integration;
        const options_config = integration_options_config[integration];
        
        let prefsToGet = { do_debug: prefs_default.do_debug };
        for (const key in options_config) {
            prefsToGet[`${integration_prefix}_${key}`] = prefs_default[`${integration_prefix}_${key}`];
        }
        if (integration === 'openai_comp') {
            prefsToGet.openai_comp_chat_name = prefs_default.openai_comp_chat_name;
        }

        let prefs_api = await browser.storage.sync.get(prefsToGet);

        if (prompt_id) {
            try {
                const prompt = await loadPrompt(prompt_id);
                if (prompt && prompt.api_type === llm) {
                    for (const key in options_config) {
                        const prefKey = `${integration_prefix}_${key}`;
                        if (prompt[prefKey] !== undefined) {
                            prefs_api[prefKey] = prompt[prefKey];
                        }
                    }
                }
            } catch (e) {
                console.error("[ThunderAI] Error loading prompt settings:", e);
            }
        }

        let i18nStrings = {};
        const i18n_msg_key = integration === 'openai_comp' ? 'OpenAIComp_api_request_failed' : `${integration}_api_request_failed`;
        i18nStrings[i18n_msg_key] = browser.i18n.getMessage(i18n_msg_key);
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');

        messageInput.setModel(prefs_api[`${integration_prefix}_model`]);
        
        let llmName = "API";
        switch(integration) {
            case 'chatgpt': llmName = "ChatGPT"; break;
            case 'google_gemini': llmName = "Google Gemini"; break;
            case 'ollama': llmName = "Ollama Local"; break;
            case 'openai_comp': llmName = prefs_api.openai_comp_chat_name || "OpenAI Comp"; break;
            case 'anthropic': llmName = "Claude"; break;
        }
        messagesArea.setLLMName(llmName);

        let workerInitMessage = {
            type: 'init',
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        };

        for (const key in options_config) {
            const prefKey = `${integration_prefix}_${key}`;
            workerInitMessage[prefKey] = prefs_api[prefKey];
        }
        
        worker.postMessage(workerInitMessage);

        const additional_messages_config = {
            chatgpt: [
                { key: 'store', labelKey: 'ChatGPT_chatgpt_api_store', type: 'boolean' },
                { key: 'developer_messages', labelKey: 'ChatGPT_Developer_Messages', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' }
            ],
            google_gemini: [
                { key: 'system_instruction', labelKey: 'GoogleGemini_SystemInstruction', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'thinking_budget', labelKey: 'prefs_google_gemini_thinking_budget', type: 'string' }
            ],
            ollama: [
                { key: 'think', labelKey: 'prefs_ollama_think', type: 'boolean' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'num_ctx', labelKey: 'prefs_ollama_num_ctx', type: 'number_gt_zero' }
            ],
            openai_comp: [
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' }
            ],
            anthropic: [
                { key: 'system_prompt', labelKey: 'Anthropic_System_Prompt', type: 'string' },
                { key: 'max_tokens', labelKey: 'prefs_OptionText_anthropic_max_tokens', type: 'number_gt_zero' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' }
            ]
        };

        const getAdditionalMessages = (integration, prefs) => {
            const messages = [];
            const config = additional_messages_config[integration];
            if (!config) return messages;

            for (const item of config) {
                const prefKey = `${integration}_${item.key}`;
                const value = prefs[prefKey];

                if (value !== undefined && value !== null && value !== '') {
                    let displayValue;
                    let shouldAdd = false;

                    switch (item.type) {
                        case 'boolean':
                            displayValue = value ? 'Yes' : 'No';
                            shouldAdd = true;
                            break;
                        case 'string':
                            if (value.length > 0) {
                                displayValue = value;
                                shouldAdd = true;
                            }
                            break;
                        case 'number_gt_zero':
                            if (value > 0) {
                                displayValue = value;
                                shouldAdd = true;
                            }
                            break;
                    }
                    if (shouldAdd) {
                        messages.push({ label: browser.i18n.getMessage(item.labelKey), value: displayValue });
                    }
                }
            }
            return messages;
        };

        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        additional_text_elements.push(...getAdditionalMessages(integration, prefs_api));

        const api_strings = {
            chatgpt: "ChatGPT API",
            google_gemini: "Google Gemini API",
            ollama: "Ollama API",
            openai_comp: "OpenAI Compatible API",
            anthropic: "Claude API"
        };
        
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: api_strings[integration],
            model_string: prefs_api[`${integration_prefix}_model`],
            host_string: prefs_api[`${integration_prefix}_host`],
            version_string: prefs_api[`${integration_prefix}_version`],
            additional_messages: additional_text_elements
        }), "info");
        
        //console.log(`>>>>>>>>>>>>> command: ${llm}_ready_${call_id}`,)

        browser.runtime.sendMessage({
            command: `${llm}_ready_${call_id}`,
            window_id: (await browser.windows.getCurrent()).id
        });
    }
}

//let prefs_ph = await browser.storage.sync.get({placeholders_use_default_value: false});

// Event listeners for worker messages
worker.onmessage = async function(event) {
    const { type, payload } = event.data;
    switch (type) {
        case 'messageSent':
            messageInput.handleMessageSent();
            break;
        case 'newToken':
            messagesArea.handleNewToken(payload.token);
            messageInput.setStatusMessage(browser.i18n.getMessage("apiwebchat_receiving_data") + '...');
            break;
        case 'tokensDone':
            await messagesArea.handleTokensDone(promptData);
            messageInput.enableInput();
            break;
        case 'error':
            messagesArea.appendBotMessage(payload,'error');
            messageInput.enableInput();
            break;
        default:
            console.error('[ThunderAI] Unknown event type from API worker:', type);
    }
};

// handling commands from the backgound page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.command) {
        case "api_send":
            promptData = message;
            //send the received prompt to the llm api
            if(message.do_custom_text=="1") {
                messageInput._showCustomTextField();
            }else{
                sendPrompt(message);
            }
            break;
        case 'api_send_custom_text':
            let userInput = message.custom_text;
                if(userInput !== null) {
                    if(!placeholdersUtils.hasPlaceholder(promptData.prompt, 'additional_text')){
                        // no additional_text placeholder, do as usual
                        promptData.prompt += " " + userInput;
                    }else{
                        // we have the additional_text placeholder, do the magic!
                        let finalSubs = {};
                        finalSubs["additional_text"] = userInput;
                        promptData.prompt = placeholdersUtils.replacePlaceholders({
                            text: promptData.prompt,
                            replacements: finalSubs,
                            use_default_value: ph_def_val==='1'
                        })
                    }
                    sendPrompt(promptData);
                }
            break;
        case "api_error":
            messagesArea.appendBotMessage(message.error,'error');
            messageInput.enableInput();
            break;
    }
});

function sendPrompt(message){
    messageInput._setMessageInputValue(convertNewlinesToBr(message.prompt));
    messageInput._handleNewChatMessage();
}
