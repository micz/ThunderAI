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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

// Get the LLM to be used
const urlParams = new URLSearchParams(window.location.search);
const llm = urlParams.get('llm');

//console.log(">>>>>>>>>>> llm: " + llm);

// The controller wires up all the components and workers together,
// managing the dependencies. A kind of "DI" class.
let worker = null;

switch (llm) {
    case "chatgpt_api":
        worker = new Worker('model-worker-openai.js', { type: 'module' });
        break;
    case "ollama_api": {
        worker = new Worker('model-worker-ollama.js', { type: 'module' });
        break;
    }
}

const messagesArea = document.querySelector('messages-area');
messagesArea.init(worker);

// Initialize the messageInput component and pass the worker to it
const messageInput = document.querySelector('message-input');
messageInput.init(worker);
messageInput.setMessagesArea(messagesArea);

// Data received from the user
let promptData = null;

// ============================== TESTING
// let browser = {
//     i18n: {
//         getMessage: async function(key) {
//             return key;
//         }
//     },
//     storage: {
//         sync: {
//             get: async function(key) {
//                 return 'apitest';
//             }
//         }
//     }
// }
// ============================== TESTING - END

switch (llm) {
    case "chatgpt_api":
        let prefs_api = await browser.storage.sync.get({chatgpt_api_key: '', chatgpt_model: ''});
        //console.log(">>>>>>>>>>> chatgpt_api_key: " + prefs_api_key.chatgpt_api_key);
        messageInput.setModel(prefs_api.chatgpt_model);
        messagesArea.setLLMName("ChatGPT");
        worker.postMessage({ type: 'init', chatgpt_api_key: prefs_api.chatgpt_api_key, chatgpt_model: prefs_api.chatgpt_model});
        messagesArea.appendUserMessage(browser.i18n.getMessage("chagpt_api_connecting") + " " +browser.i18n.getMessage("AndModel") + " " + prefs_api.chatgpt_model + " ...", "info");
        break;
    case "ollama_api": {
        let prefs_api = await browser.storage.sync.get({ollama_host: '', ollama_model: ''});
        //console.log(">>>>>>>>>>> ollama_host: " + prefs_api_key.ollama_host);
        messageInput.setModel(prefs_api.ollama_model);
        messagesArea.setLLMName("Ollama Local");
        worker.postMessage({ type: 'init', ollama_host: prefs_api.ollama_host, ollama_model: prefs_api.ollama_model});
        messagesArea.appendUserMessage(browser.i18n.getMessage("ollama_api_connecting") + " " + prefs_api.ollama_host + " " +browser.i18n.getMessage("AndModel") + " " + prefs_api.ollama_model + " ...", "info");
        break;
    }
}


// Event listeners for worker messages
worker.onmessage = function(event) {
    const { type, payload } = event.data;
    switch (type) {
        case 'messageSent':
            messageInput.handleMessageSent();
            break;
        case 'newToken':
            messagesArea.handleNewToken(payload.token);
            break;
        case 'tokensDone':
            messagesArea.handleTokensDone(promptData);
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
    //console.log(">>>>>>>>>>>>> controller.js onMessage: " + JSON.stringify(message));
    switch (message.command) {
        case "api_send":
            //send the received prompt to the llm api
            if(message.do_custom_text=="1") {
                let userInput = prompt(browser.i18n.getMessage("chatgpt_win_custom_text"));
                if(userInput !== null) {
                    message.prompt += " " + userInput;
                }
            }
            promptData = message;
            messageInput._setMessageInputValue(message.prompt);
            messageInput._handleNewChatMessage();
            break;
        case "api_error":
            messagesArea.appendBotMessage(message.error,'error');
            messageInput.enableInput();
            break;
    }
});