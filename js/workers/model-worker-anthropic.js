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

import { Anthropic } from '../api/anthropic.js';
import { taLogger } from '../mzta-logger.js';

let anthropic_api_key = null;
let anthropic_model = '';
let anthropic = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        // console.log(">>>>>>>>>>>>>> event.data: " + JSON.stringify(event.data));
        anthropic_api_key = event.data.anthropic_api_key;
        anthropic_model = event.data.anthropic_model;
        anthropic = new Anthropic({
            apiKey: anthropic_api_key,
            version: event.data.anthropic_version,
            model: anthropic_model,
            max_tokens: event.data.anthropic_max_tokens,
            stream: true
        });
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-anthropic', do_debug);
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });

    const response = await anthropic.fetchResponse(conversationHistory);
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
            postMessage({ type: 'error', payload: i18nStrings["anthropic_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail });
            throw new Error("[ThunderAI] Claude API request failed: " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail);
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
            // lots of low-level Claude response parsing stuff
            const chunk = decoder.decode(value);
            buffer += chunk;
            taLog.log("buffer " + buffer);
            const lines = buffer.split("\n");
            buffer = lines.pop();
            
            for (const line of lines) {
                const cleanLine = line.trim();

                // Ignore ping events
                if (cleanLine === '' || cleanLine.startsWith('event: ping')) {
                    continue;
                }

                // Remove "data: " and parse the JSON
                if (cleanLine.startsWith('data: ')) {
                    const jsonPart = cleanLine.replace(/^data: /, '');
                    let parsedData = null;

                    try {
                        parsedData = JSON.parse(jsonPart);
                    } catch (e) {
                        taLog.error("JSON parse error: " + e);
                        continue;
                    }

                    // Events handling
                    switch (parsedData.type) {
                        case 'content_block_delta':
                            if (parsedData.delta && parsedData.delta.text) {
                                const token = parsedData.delta.text;
                                assistantResponseAccumulator += token;
                                postMessage({ type: 'newToken', payload: { token } });
                            }
                            break;

                        case 'content_block_start':
                            // optional
                            break;

                        case 'message_start':
                            // optional
                            break;

                        case 'message_stop':
                            conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                            assistantResponseAccumulator = '';
                            postMessage({ type: 'tokensDone' });
                            return; // end the loop
                    }
                }
            }

        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
