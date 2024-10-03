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

import { Ollama } from '../js/api/ollama.js';

let ollama_host = null;
let ollama_model = '';
let ollama = null;
let stopStreaming = false;
let i18nStrings = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    switch (event.data.type) {
        case 'init':
            ollama_host = event.data.ollama_host;
            ollama_model = event.data.ollama_model;
            //console.log(">>>>>>>>>>> ollama_host: " + ollama_host);
            ollama = new Ollama(ollama_host, ollama_model, true);
            i18nStrings = event.data.i18nStrings;
            break;  // init
        case 'chatMessage':
            conversationHistory.push({ role: 'user', content: event.data.message });
            //console.log(">>>>>>>>>>> conversationHistory: " + JSON.stringify(conversationHistory));
            const response = await ollama.fetchResponse(conversationHistory); //4096);
            postMessage({ type: 'messageSent' });

            if (!response.ok) {
                let error_message = '';
                let errorDetail = '';
                if(response.is_exception === true){
                    error_message = response.error;
                }else{
                    const errorJSON = await response.json();
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error;
                    //console.log(">>>>>>>>>>>>> errorJSON.error.message: " + JSON.stringify(errorJSON.error.message));
                }
                postMessage({ type: 'error', payload: i18nStrings["ollama_api_request_failed"] + ": " + error_message });
                throw new Error("[ThunderAI] Ollama API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let chunk = '';
    
            try {
                while (true) {
                    if (stopStreaming) {
                        stopStreaming = false;
                        reader.cancel();
                        conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                        assistantResponseAccumulator = '';
                        postMessage({ type: 'tokensDone' });

                        break;
                    }
                    const { done, value } = await reader.read();
                    if (done) {
                        conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                        assistantResponseAccumulator = '';
                        postMessage({ type: 'tokensDone' });
                        break;
                    }
                    // lots of low-level Ollama response parsing stuff
                    chunk += decoder.decode(value);
                    //console.log(">>>>>>>>>>>>> chunk: " + chunk);
                    const lines = chunk.split("\n");
                    let parsedLines = [];
                    chunk = chunk.substring(chunk.lastIndexOf('\n') + 1);
                    try{
                        parsedLines = lines
                            .map((line) => line.replace(/^chunk: /, "").trim()) // Remove the "chunk: " prefix
                            .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                            .map((line) => JSON.parse(line)); // Parse the JSON string
                    }catch(e){
                        console.warn("[ThunderAI | model-worker-ollama] broken chunk: " + e);
                    }
            
                    for (const parsedLine of parsedLines) {
                        const { message } = parsedLine;
                        const { content } = message;
                        // Update the UI with the new content
                        if (content) {
                            assistantResponseAccumulator += content;
                            postMessage({ type: 'newToken', payload: { token: content } });
                        }
                    }
                }
            } catch (error) {
                if (error instanceof TypeError && error.message.includes('Error in input stream')) {
                    console.error('[ThudenderAI] The connection to the server was unexpectedly interrupted:', error);
                    postMessage({ type: 'error', payload: i18nStrings['error_connection_interrupted'] + ": " + error.message });
                } else {
                    console.error('[ThudenderAI] Ollama API request failed:', error);
                    postMessage({ type: 'error', payload: i18nStrings["ollama_api_request_failed"] + ": " + error.message });
                }
            }
            break; //chatMessage
        case 'stop':
            stopStreaming = true;
            break; //stop
     }
};
