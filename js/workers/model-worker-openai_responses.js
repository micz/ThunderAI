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

import { OpenAI } from '../api/openai_responses.js';
import { taLogger } from '../mzta-logger.js';

let chatgpt_api_key = null;
let chatgpt_model = '';
let openai = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let previous_response_id = null;

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        chatgpt_api_key = event.data.chatgpt_api_key;
        chatgpt_model = event.data.chatgpt_model;
        openai = new OpenAI(chatgpt_api_key, chatgpt_model, event.data.chatgpt_developer_messages, true, event.data.chatgpt_api_store);
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-openai_responses', do_debug);
        previous_response_id = null;
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });

        let messagesToSend = conversationHistory;
        if (previous_response_id) {
            messagesToSend = [conversationHistory[conversationHistory.length - 1]];
            taLog.log("previous_response_id: " + previous_response_id);
        } else {
            taLog.log("no previous_response_id");
        }

        const response = await openai.fetchResponse(messagesToSend, 0, previous_response_id);
        postMessage({ type: 'messageSent' });

        if (!response.ok) {
            let error_message = '';
            let errorDetail = '';
            if(response.is_exception === true){
                error_message = response.error;
            }else{
                try{
                    const errorJSON = await response.json();
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error.message;
                }catch(e){
                    error_message = response.statusText;
                }
                taLog.log("error_message: " + JSON.stringify(error_message));
            }
            postMessage({ type: 'error', payload: i18nStrings["chatgpt_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail });
            throw new Error("[ThunderAI] OpenAI ChatGPT API request failed: " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
    
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
            const chunk = decoder.decode(value);
            buffer += chunk;
            taLog.log("buffer " + buffer);
            const lines = buffer.split("\n");
            buffer = lines.pop();
            let parsedLines = [];
            try{
                parsedLines = lines
                    .map((line) => line.trim())
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                    .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                    // .map((line) => JSON.parse(line)); // Parse the JSON string
                    .map((line) => {
                         try {
                            taLog.log("line: " + JSON.stringify(line));
                            return JSON.parse(line);
                        } catch (e) {
                            taLog.warn("JSON parse warning, skipped line: " + line + " - " + e.message);
                            return null;
                        }
                    })
                    .filter((parsed) => parsed !== null);
            }catch(e){
                taLog.error("Error parsing lines: " + e);
            }
    
            for (const parsedLine of parsedLines) {
                if (parsedLine.type === 'response.created' && parsedLine.response && parsedLine.response.id){
                    previous_response_id = parsedLine.response.id;
                } else if (parsedLine.type === 'response.output_text.delta' && parsedLine.delta) {
                    assistantResponseAccumulator += parsedLine.delta;
                    postMessage({ type: 'newToken', payload: { token: parsedLine.delta } });
                // } else if (parsedLine.type === 'response.completed' && parsedLine.response && parsedLine.response.id) {
                //     previous_response_id = parsedLine.response.id;
                }
            }
        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
