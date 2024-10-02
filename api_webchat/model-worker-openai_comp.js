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

import { OpenAIComp } from '../js/api/openai_comp.js';

let openai_comp_host = null;
let openai_comp_model = '';
let openai_comp = null;
let stopStreaming = false;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        openai_comp_host = event.data.openai_comp_host;
        openai_comp_model = event.data.openai_comp_model;
        openai_comp = new OpenAIComp(openai_comp_host, openai_comp_model, true);
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });

    const response = await openai_comp.fetchResponse(conversationHistory); //4096);
        postMessage({ type: 'messageSent' });

        if (!response.ok) {
            let error_message = '';
            let errorDetail = '';
            if(response.is_exception === true){
                error_message = response.error;
            }else{
                const errorJSON = await response.json();
                errorDetail = JSON.stringify(errorJSON);
                error_message = errorJSON.error.message;
                //console.log(">>>>>>>>>>>>> errorJSON.error.message: " + JSON.stringify(errorJSON.error.message));
            }
            postMessage({ type: 'error', payload: error_message });
            throw new Error("[ThunderAI] OpenAI Comp API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let chunk = '';
    
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
            // lots of low-level OpenAI response parsing stuff
            chunk += decoder.decode(value);
            console.log(">>>>>>>>>>>>>> [ThunderAI] chunk: " + JSON.stringify(chunk));
            const lines = chunk.split("\n");
            let parsedLines = [];
            try{
                parsedLines = lines
                    .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                    .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                    // .map((line) => JSON.parse(line)); // Parse the JSON string
                    .map((line) => {
                        console.log(">>>>>>>>>>>>> [ThunderAI] line: " + JSON.stringify(line));
                        return JSON.parse(line);
                    });
                    chunk = chunk.substring(chunk.lastIndexOf('\n') + 1);
                    console.log(">>>>>>>>>>>>>> [ThunderAI] last chunk: " + JSON.stringify(chunk));
            }catch(e){
                console.error(">>>>>>>>>>>>> [ThunderAI] error: " + JSON.stringify(e));
            }
    
            for (const parsedLine of parsedLines) {
                const { choices } = parsedLine;
                const { delta } = choices[0];
                const { content } = delta;
                // Update the UI with the new content
                if (content) {
                    assistantResponseAccumulator += content;
                    postMessage({ type: 'newToken', payload: { token: content } });
                }
            }
        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
