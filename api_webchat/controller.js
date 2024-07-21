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



// The controller wires up all the components and workers together,
// managing the dependencies. A kind of "DI" class.
const worker = new Worker('model-worker.js', { type: 'module' });

const messagesArea = document.querySelector('messages-area');
messagesArea.init(worker);

// Initialize the messageInput component and pass the worker to it
const messageInput = document.querySelector('message-input');
messageInput.init(worker);
messageInput.setMessagesArea(messagesArea);

const params = new URLSearchParams(window.location.search);
let prefs_api_key = await browser.storage.sync.get({api_key_chatgpt: ''});
// const openaiApiKey = params.get('openapi-key');
//console.log(">>>>>>>>>>> api_key_chatgpt: " + prefs_api_key.api_key_chatgpt);
worker.postMessage({ type: 'init', api_key_chatgpt: prefs_api_key.api_key_chatgpt });
if( prefs_api_key.api_key_chatgpt !== null ) {
    messagesArea.appendUserMessage("Will attempt to connect to OpenAI using API key provided.", "");
} else {
    messagesArea.appendUserMessage("No OpenAI API key provided. Using mock data.", "");
}


// Event listeners for worker messages
// TODO I'm sure there's a better way to do this
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
            messagesArea.handleTokensDone();
            break;
        default:
            console.error('Unknown event type from worker:', type);
    }
};
