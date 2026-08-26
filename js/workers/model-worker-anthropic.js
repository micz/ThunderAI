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

import {
    Anthropic,
    describeAnthropicError
} from '../api/anthropic.js';
import { taLogger } from '../mzta-logger.js';

let anthropic = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        // console.log(">>>>>>>>>>>>>> event.data: " + JSON.stringify(event.data));
        let config = { stream: true };
        for (const key in event.data) {
            if (key.startsWith('anthropic_')) {
                let newKey = key.replace('anthropic_', '');
                if (newKey === 'api_key') newKey = 'apiKey';
                config[newKey] = event.data[key];
            }
        }
        anthropic = new Anthropic(config);
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
            let error_text = '';
            if(response.is_exception === true){
                error_message = response.error;
                // Network-level failure: no status/statusText exist on the returned object,
                // and error_message already carries the provider name.
                error_text = error_message;
            }else{
                try{
                    const errorJSON = await response.json();
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error.message;
                    if(response.status === 400){
                        // A 400 naming a request parameter usually means the
                        // selected model rejects an option the user configured;
                        // say which one instead of only echoing the raw detail.
                        error_message = describeAnthropicError(error_message, anthropic ? anthropic.model : '', i18nStrings);
                    }
                }catch(e){
                    error_message = response.statusText;
                }
                taLog.log("error_message: " + JSON.stringify(error_message));
                error_text = i18nStrings["anthropic_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
            }
            postMessage({ type: 'error', payload: error_text });
            throw new Error("[ThunderAI] Claude API request failed: " + error_text);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
    
        while (true) {
            if (stopStreaming) {
                stopStreaming = false;
                reader.cancel();
                taLog.log("AI full reasoning [STOPPED]: " + thinkingAccumulator);
                taLog.log("AI full response [STOPPED]: " + assistantResponseAccumulator);
                conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            const { done, value } = await reader.read();
            if (done) {
                taLog.log("AI full reasoning: " + thinkingAccumulator);
                taLog.log("AI full response: " + assistantResponseAccumulator);
                conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            // lots of low-level Claude response parsing stuff
            const chunk = decoder.decode(value);
            buffer += chunk;
            // No per-chunk dump of `buffer`: taLog.log() only gates the console call,
            // so the whole unconsumed buffer would be re-concatenated on every SSE
            // chunk even with debug off.
            const lines = buffer.split("\n");
            buffer = lines.pop();
            
            for (const line of lines) {
                const cleanLine = line.trim();

                // Ignore ping events
                if (cleanLine === '' || cleanLine.startsWith('event: ping')) {
                    continue;
                }

                // Guarded at the call site: taLog.log() gates only the console call,
                // so an unguarded concatenation would run per SSE line even with debug
                // off. Placed after the ping filter so keep-alives stay out of the log,
                // and logs cleanLine rather than JSON.stringify() as the other workers
                // do: this stream is raw SSE ('event: ...' / 'data: {...}'), already a
                // string, so stringifying would only re-quote it.
                if (taLog.do_debug) taLog.log("line: " + cleanLine);

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
                            if (parsedData.delta && parsedData.delta.type === 'thinking_delta' && typeof parsedData.delta.thinking === 'string') {
                                const token = parsedData.delta.thinking;
                                thinkingAccumulator += token;
                                postMessage({ type: 'newThinkingToken', payload: { token } });
                            } else if (parsedData.delta && typeof parsedData.delta.text === 'string') {
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
                            taLog.log("AI full reasoning: " + thinkingAccumulator);
                            taLog.log("AI full response: " + assistantResponseAccumulator);
                            conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                            assistantResponseAccumulator = '';
                            postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                            thinkingAccumulator = '';
                            return; // end the loop
                    }
                }
            }

        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
