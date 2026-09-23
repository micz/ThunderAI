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
import { getAPIsInitMessageString, convertNewlinesToBr, supportsUsageData } from '../js/mzta-utils.js';
import { loadPrompt } from '../js/mzta-prompts.js';
import { buildChatBubbleIcon } from './svgIcons.js';
import { resolveContextWindow } from './contextWindow.js';
import { mztaPrefs } from '../js/mzta-prefs.js';

// Get the LLM to be used
const urlParams = new URLSearchParams(window.location.search);
const llm = urlParams.get('llm');
const call_id = urlParams.get('call_id');
const ph_def_val = urlParams.get('ph_def_val');
const prompt_id = urlParams.get('prompt_id');
const prompt_name = urlParams.get('prompt_name');

// Data received from the user
let promptData = null;
// Looks up the model's context window for the usage meter. Set at init only when
// the usage UI is on, and consumed by the first completed answer: run once, after
// a response, so a local Ollama model is already loaded and /api/ps can report
// the context it actually runs with.
let contextWindowLookup = null;

const messageInput = document.querySelector('message-input');
const messagesArea = document.querySelector('messages-area');

// --- Font zoom (Ctrl+ / Ctrl- / Ctrl+0), persisted across windows ---
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5, ZOOM_STEP = 0.1, ZOOM_DEFAULT = 1.0;
let currentZoom = ZOOM_DEFAULT;

function applyZoom(scale) {
    document.documentElement.style.fontSize = (scale * 100) + '%';
}

function setZoom(scale) {
    // clamp and round to avoid floating point drift
    scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(scale * 10) / 10));
    currentZoom = scale;
    applyZoom(scale);
    mztaPrefs.setPref('api_webchat_font_scale', scale);
}

// Load the saved zoom level and apply it as soon as possible.
(async () => {
    const { api_webchat_font_scale } = await mztaPrefs.getPrefs(['api_webchat_font_scale']);
    currentZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, api_webchat_font_scale));
    applyZoom(currentZoom);
})();

document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    switch (event.key) {
        case '+':
        case '=':
            event.preventDefault();
            setZoom(currentZoom + ZOOM_STEP);
            break;
        case '-':
            event.preventDefault();
            setZoom(currentZoom - ZOOM_STEP);
            break;
        case '0':
            event.preventDefault();
            setZoom(ZOOM_DEFAULT);
            break;
    }
});

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
        
        let prefsToGet = {
            do_debug: prefs_default.do_debug,
            hide_thinking: prefs_default.hide_thinking,
            chat_show_usage_data: prefs_default.chat_show_usage_data,
        };
        for (const key in options_config) {
            prefsToGet[`${integration_prefix}_${key}`] = prefs_default[`${integration_prefix}_${key}`];
        }
        if (integration === 'openai_comp') {
            prefsToGet.openai_comp_chat_name = prefs_default.openai_comp_chat_name;
        }

        let prefs_api = await mztaPrefs.getPrefs(Object.keys(prefsToGet));

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
        messagesArea.setHideThinking(!!prefs_api.hide_thinking);
        // Only integrations that can report token counts get the usage UI at all:
        // the option row is hidden for the web-only setups, but a stale "on" value
        // from a previous provider must not resurrect an empty session counter here.
        const show_usage = !!prefs_api.chat_show_usage_data && supportsUsageData(llm);
        messagesArea.setShowUsageData(show_usage);
        if (show_usage) {
            contextWindowLookup = () => resolveContextWindow(integration, prefs_api);
        }

        // Shared by the header chip and the startup info message below.
        const api_strings = {
            chatgpt: "ChatGPT API",
            google_gemini: "Google Gemini API",
            ollama: "Ollama API",
            openai_comp: "OpenAI Compatible API",
            anthropic: "Claude API"
        };

        // Header bar: the logo icon plus two static chips, the API in use and
        // the model. Every live state (waiting / streaming / done / error)
        // belongs to the status pill above the input, so there is only one
        // thing to keep in sync with the request lifecycle.
        document.getElementById('appHeaderLogo').appendChild(buildChatBubbleIcon());
        const apiChip = document.getElementById('appHeaderApi');
        if (api_strings[integration]) {
            document.getElementById('appHeaderApiName').textContent = api_strings[integration];
            // `llm` is the connection type (chatgpt_api, anthropic_api, …), the
            // same key the settings pages tint their connection pill with.
            apiChip.classList.add('tint_' + llm);
            apiChip.hidden = false;
        }
        // Model chip: "prompt name | model", dropping either half when missing.
        const modelChip = document.getElementById('appHeaderModel');
        const model_label = prefs_api[`${integration_prefix}_model`] || llmName;
        const prompt_label = decodeURIComponent(prompt_name ?? '').trim();
        modelChip.textContent = prompt_label ? `${prompt_label} | ${model_label}` : model_label;
        modelChip.title = modelChip.textContent;

        document.title += " [" + llmName + " | " + decodeURIComponent(prompt_name) + "]";

        let workerInitMessage = {
            type: 'init',
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
            // Gates the 'usage' message at the source: with this false the worker
            // still extracts and debug-logs the usage, but emits nothing.
            chat_show_usage_data: show_usage,
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
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'reasoning_summary', labelKey: 'prefs_OptionText_chatgpt_reasoning_summary', type: 'string' },
                { key: 'reasoning_effort', labelKey: 'prefs_OptionText_chatgpt_reasoning_effort', type: 'string' },
                { key: 'max_output_tokens', labelKey: 'prefs_api_max_output_tokens', type: 'number_gt_zero' },
                { key: 'top_p', labelKey: 'prefs_api_top_p', type: 'string' },
                { key: 'verbosity', labelKey: 'prefs_OptionText_chatgpt_verbosity', type: 'string' },
                { key: 'text_format', labelKey: 'prefs_OptionText_chatgpt_text_format', type: 'string' },
                { key: 'text_format_schema_name', labelKey: 'prefs_OptionText_chatgpt_text_format_schema_name', type: 'string' },
                { key: 'text_format_schema', labelKey: 'prefs_OptionText_chatgpt_text_format_schema', type: 'string' },
                { key: 'truncation', labelKey: 'prefs_OptionText_chatgpt_truncation', type: 'string' },
                { key: 'prompt_cache_key', labelKey: 'prefs_OptionText_chatgpt_prompt_cache_key', type: 'string' },
                { key: 'service_tier', labelKey: 'prefs_OptionText_chatgpt_service_tier', type: 'string' },
                { key: 'safety_identifier', labelKey: 'prefs_OptionText_chatgpt_safety_identifier', type: 'string' },
                { key: 'include_encrypted_reasoning', labelKey: 'prefs_OptionText_chatgpt_include_encrypted_reasoning', type: 'boolean' },
                { key: 'extra_body', labelKey: 'prefs_api_extra_body', type: 'string' }
            ],
            google_gemini: [
                { key: 'system_instruction', labelKey: 'GoogleGemini_SystemInstruction', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'thinking_budget', labelKey: 'prefs_google_gemini_thinking_budget', type: 'string' },
                { key: 'max_output_tokens', labelKey: 'prefs_api_max_output_tokens', type: 'number_gt_zero' },
                { key: 'top_p', labelKey: 'prefs_api_top_p', type: 'string' },
                { key: 'top_k', labelKey: 'prefs_api_top_k', type: 'string' },
                { key: 'extra_body', labelKey: 'prefs_api_extra_body', type: 'string' }
            ],
            ollama: [
                // A level now ('' | 'true' | low | medium | high | max), not a flag:
                // 'string' both shows the chosen level and hides the row when off.
                { key: 'think', labelKey: 'prefs_ollama_think', type: 'string' },
                { key: 'system_prompt', labelKey: 'Ollama_System_Prompt', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'num_ctx', labelKey: 'prefs_ollama_num_ctx', type: 'number_gt_zero' },
                { key: 'keep_alive', labelKey: 'prefs_ollama_keep_alive', type: 'string' },
                { key: 'extra_options', labelKey: 'prefs_OptionText_ollama_extra_options', type: 'string' }
            ],
            openai_comp: [
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'extra_body', labelKey: 'prefs_api_extra_body', type: 'string' }
            ],
            anthropic: [
                { key: 'system_prompt', labelKey: 'Anthropic_System_Prompt', type: 'string' },
                { key: 'max_tokens', labelKey: 'prefs_OptionText_anthropic_max_tokens', type: 'number_gt_zero' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'top_p', labelKey: 'prefs_api_top_p', type: 'string' },
                { key: 'top_k', labelKey: 'prefs_api_top_k', type: 'string' },
                { key: 'stop_sequences', labelKey: 'prefs_OptionText_anthropic_stop_sequences', type: 'string' },
                { key: 'extended_thinking_budget', labelKey: 'prefs_OptionText_anthropic_extended_thinking_budget', type: 'number_gt_zero' }
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
            messageInput.showStreamingStatus();
            break;
        case 'newThinkingToken':
            messagesArea.handleNewThinkingToken(payload.token);
            messageInput.showStreamingStatus();
            break;
        case 'usage':
            // A message of its own, carrying no response text. Handled BEFORE the
            // turn is closed by 'tokensDone', which the worker guarantees by posting
            // this first.
            messagesArea.handleUsageData(event.data.messageId, payload);
            break;
        case 'tokensDone':
            await messagesArea.handleTokensDone(promptData);
            messageInput.enableInput();
            // The session meter updates once per completed answer, never mid-stream.
            messageInput.setUsageMeter(messagesArea.getUsageMeterState());
            if (contextWindowLookup !== null) {
                const lookup = contextWindowLookup;
                contextWindowLookup = null;
                // Not awaited: the meter shows the session total meanwhile, and
                // turns into a bar once the window is known.
                lookup().then((tokens) => {
                    if (tokens === null) return;
                    messagesArea.setContextWindow(tokens);
                    messageInput.setUsageMeter(messagesArea.getUsageMeterState());
                });
            }
            break;
        case 'error':
            messagesArea.appendBotMessage(payload,'error');
            messageInput.enableInput(false);
            messageInput.showErrorStatus();
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
                messageInput._showCustomTextField(message.prompt_info?.custom_text_array);
            }else{
                sendPrompt(message);
            }
            break;
        case 'api_send_custom_text':
            let userInput = message.custom_text;    // From version 4.0.0 this is an array
                if(userInput !== null) {
                    if(!placeholdersUtils.hasPlaceholder(promptData.prompt, 'additional_text')){
                        // no additional_text placeholder, do as usual
                        const inputText = Array.isArray(userInput) ? userInput.map(obj => obj.custom_text).join(' ') : userInput;
                        promptData.prompt += " " + inputText;
                    }else{
                        // we have the additional_text placeholder, do the magic!
                        let finalSubs = {};
                        
                        if (Array.isArray(userInput)) {
                            userInput.forEach(obj => {
                                finalSubs[obj.placeholder.replace(/^{%|%}$/g, '').trim()] = obj.custom_text;
                            });
                        } else {
                            finalSubs["additional_text"] = userInput;
                        }
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
            messageInput.enableInput(false);
            messageInput.showErrorStatus();
            break;
    }
});

function sendPrompt(message){
    messageInput._setMessageInputValue(convertNewlinesToBr(message.prompt));
    messageInput._handleNewChatMessage();
}
