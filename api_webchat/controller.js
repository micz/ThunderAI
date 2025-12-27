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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { prefs_default } from '../options/mzta-options-default.js';
import { placeholdersUtils } from '../js/mzta-placeholders.js';
import { getAPIsInitMessageString, convertNewlinesToBr } from '../js/mzta-utils.js';

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

switch (llm) {
    case "chatgpt_api":
        worker = new Worker('../js/workers/model-worker-openai_responses.js', { type: 'module' });
        break;
    case "google_gemini_api":
        worker = new Worker('../js/workers/model-worker-google_gemini.js', { type: 'module' });
        break;
    case "ollama_api":
        worker = new Worker('../js/workers/model-worker-ollama.js', { type: 'module' });
        break;
    case "openai_comp_api":
        worker = new Worker('../js/workers/model-worker-openai_comp.js', { type: 'module' });
        break;
    case "anthropic_api":
        worker = new Worker('../js/workers/model-worker-anthropic.js', { type: 'module' });
        break;
    default:
        console.error('[ThunderAI] API WebChat Unknown LLM type:', llm);
        break;
}

messagesArea.init(worker);

// Initialize the messageInput component and pass the worker to it
messageInput.init(worker);
messageInput.setMessagesArea(messagesArea);

switch (llm) {
    case "chatgpt_api": {
        let prefs_api = await browser.storage.sync.get({
            chatgpt_api_key: prefs_default.chatgpt_api_key,
            chatgpt_model: prefs_default.chatgpt_model,
            chatgpt_developer_messages: prefs_default.chatgpt_developer_messages,
            chatgpt_api_store: prefs_default.chatgpt_api_store,
            do_debug: prefs_default.do_debug,
        });
        let i18nStrings = {};
        i18nStrings["chatgpt_api_request_failed"] = browser.i18n.getMessage('chatgpt_api_request_failed');
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
        messageInput.setModel(prefs_api.chatgpt_model);
        messagesArea.setLLMName("ChatGPT");
        worker.postMessage({
            type: 'init',
            chatgpt_api_key: prefs_api.chatgpt_api_key,
            chatgpt_model: prefs_api.chatgpt_model,
            chatgpt_developer_messages: prefs_api.chatgpt_developer_messages,
            chatgpt_api_store: prefs_api.chatgpt_api_store,
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        });
        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        additional_text_elements.push({label: 'OpenAI Store', value: (prefs_api.chatgpt_api_store ? 'Yes' : 'No')});
        if(prefs_api.chatgpt_developer_messages && prefs_api.chatgpt_developer_messages.length > 0) {
            additional_text_elements.push({label: browser.i18n.getMessage("ChatGPT_Developer_Messages"), value: prefs_api.chatgpt_developer_messages});
        }
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: "ChatGPT API",
            model_string: prefs_api.chatgpt_model,
            additional_messages: additional_text_elements
        }), "info");
        browser.runtime.sendMessage({
            command: "openai_api_ready_" + call_id,
            window_id: (await browser.windows.getCurrent()).id
        });
        break;
    }
    case "google_gemini_api": {
        let prefs_api = await browser.storage.sync.get({
            google_gemini_api_key: prefs_default.google_gemini_api_key,
            google_gemini_model: prefs_default.google_gemini_model,
            google_gemini_system_instruction: prefs_default.google_gemini_system_instruction,
            google_gemini_temperature: prefs_default.google_gemini_temperature,
            google_gemini_thinking_budget: prefs_default.google_gemini_thinking_budget,
            do_debug: prefs_default.do_debug,
        });
        let i18nStrings = {};
        i18nStrings["google_gemini_api_request_failed"] = browser.i18n.getMessage('google_gemini_api_request_failed');
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
        messageInput.setModel(prefs_api.google_gemini_model);
        messagesArea.setLLMName("Google Gemini");
        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        if(prefs_api.google_gemini_system_instruction && prefs_api.google_gemini_system_instruction.length > 0) {
            additional_text_elements.push({label: browser.i18n.getMessage("GoogleGemini_SystemInstruction"), value: prefs_api.google_gemini_system_instruction});
        }
        if(prefs_api.google_gemini_temperature.length > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("prefs_google_gemini_temperature"), value: prefs_api.google_gemini_temperature});
        }
        if(prefs_api.google_gemini_thinking_budget.length > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("prefs_google_gemini_thinking_budget"), value: prefs_api.google_gemini_thinking_budget});
        }
        worker.postMessage({
            type: 'init',
            google_gemini_api_key: prefs_api.google_gemini_api_key,
            google_gemini_model: prefs_api.google_gemini_model,
            google_gemini_system_instruction: prefs_api.google_gemini_system_instruction,
            google_gemini_thinking_budget: prefs_api.google_gemini_thinking_budget,
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        });
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: "Google Gemini API",
            model_string: prefs_api.google_gemini_model,
            additional_messages: additional_text_elements
        }), "info");
        browser.runtime.sendMessage({
            command: "google_gemini_api_ready_" + call_id,
            window_id: (await browser.windows.getCurrent()).id
        });
        break;
    }
    case "ollama_api": {
        let prefs_api = await browser.storage.sync.get({
            ollama_host: prefs_default.ollama_host,
            ollama_model: prefs_default.ollama_model,
            ollama_num_ctx: prefs_default.ollama_num_ctx,
            ollama_think: prefs_default.ollama_think,
            do_debug: prefs_default.do_debug,
        });
        let i18nStrings = {};
        i18nStrings["ollama_api_request_failed"] = browser.i18n.getMessage('ollama_api_request_failed');
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
        messageInput.setModel(prefs_api.ollama_model);
        messagesArea.setLLMName("Ollama Local");
        worker.postMessage({
            type: 'init',
            ollama_host: prefs_api.ollama_host,
            ollama_model: prefs_api.ollama_model,
            ollama_num_ctx: prefs_api.ollama_num_ctx,
            ollama_think: prefs_api.ollama_think,
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings
        });
        browser.runtime.sendMessage({
            command: "ollama_api_ready_" + call_id,
            window_id: (await browser.windows.getCurrent()).id
        });
        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        additional_text_elements.push({label: browser.i18n.getMessage("prefs_ollama_think"), value: (prefs_api.ollama_think ? 'Yes' : 'No')});
        if(prefs_api.ollama_num_ctx > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("prefs_ollama_num_ctx"), value: prefs_api.ollama_num_ctx});
        }
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: "Ollama API",
            model_string: prefs_api.ollama_model,
            host_string: prefs_api.ollama_host,
            additional_messages: additional_text_elements
        }), "info");
        break;
    }
    case "openai_comp_api": {
        let prefs_api = await browser.storage.sync.get({
            openai_comp_host: prefs_default.openai_comp_host,
            openai_comp_model: prefs_default.openai_comp_model,
            openai_comp_api_key: prefs_default.openai_comp_api_key,
            openai_comp_use_v1: prefs_default.openai_comp_use_v1,
            openai_comp_chat_name: prefs_default.openai_comp_chat_name,
            do_debug: prefs_default.do_debug,
        });
        let i18nStrings = {};
        i18nStrings["OpenAIComp_api_request_failed"] = browser.i18n.getMessage('OpenAIComp_api_request_failed');
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
        messageInput.setModel(prefs_api.openai_comp_model);
        messagesArea.setLLMName(prefs_api.openai_comp_chat_name);
        worker.postMessage({
            type: 'init',
            openai_comp_host: prefs_api.openai_comp_host,
            openai_comp_model: prefs_api.openai_comp_model,
            openai_comp_api_key: prefs_api.openai_comp_api_key,
            openai_comp_use_v1: prefs_api.openai_comp_use_v1,
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        });
        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: "OpenAI Compatible API",
            model_string: prefs_api.openai_comp_model,
            host_string: prefs_api.openai_comp_host,
            additional_messages: additional_text_elements
        }), "info");
        browser.runtime.sendMessage({
            command: "openai_comp_api_ready_" + call_id,
            window_id: (await browser.windows.getCurrent()).id
        });
        break;
    }
    case "anthropic_api": {
        let prefs_api = await browser.storage.sync.get({
            anthropic_api_key: prefs_default.anthropic_api_key,
            anthropic_model: prefs_default.anthropic_model,
            anthropic_system_prompt: prefs_default.anthropic_system_prompt,
            anthropic_temperature: prefs_default.anthropic_temperature,
            anthropic_version: prefs_default.anthropic_version,
            anthropic_max_tokens: prefs_default.anthropic_max_tokens,
            do_debug: prefs_default.do_debug,
        });
        let i18nStrings = {};
        i18nStrings["anthropic_api_request_failed"] = browser.i18n.getMessage('anthropic_api_request_failed');
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
        messageInput.setModel(prefs_api.anthropic_model);
        messagesArea.setLLMName("Claude");
        worker.postMessage({
            type: 'init',
            anthropic_api_key: prefs_api.anthropic_api_key,
            anthropic_model: prefs_api.anthropic_model,
            anthropic_system_prompt: prefs_api.anthropic_system_prompt,
            anthropic_version: prefs_api.anthropic_version,
            anthropic_max_tokens: prefs_api.anthropic_max_tokens,
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        });
        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        if(prefs_api.anthropic_system_prompt && prefs_api.anthropic_system_prompt.length > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("Anthropic_System_Prompt"), value: prefs_api.anthropic_system_prompt});
        }
        if(prefs_api.anthropic_max_tokens > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("prefs_OptionText_anthropic_max_tokens"), value: prefs_api.anthropic_max_tokens});
        }
        if(prefs_api.anthropic_temperature && prefs_api.anthropic_temperature.length > 0){
            additional_text_elements.push({label: browser.i18n.getMessage("prefs_anthropic_temperature"), value: prefs_api.anthropic_temperature});
        }
        messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: "Claude API",
            model_string: prefs_api.anthropic_model,
            version_string: prefs_api.anthropic_version,
            additional_messages: additional_text_elements
        }), "info");
        browser.runtime.sendMessage({
            command: "anthropic_api_ready_" + call_id,
            window_id: (await browser.windows.getCurrent()).id
        });
        break;
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
