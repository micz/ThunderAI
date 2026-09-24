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

import { Ollama, extractUsage } from '../api/ollama.js';
import { taLogger } from '../mzta-logger.js';
import { initUsageEmitter, nextUsageMessageId, postUsageData } from './usage-emitter.js';

let ollama = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';
let usageData = null;

// The id the window binds this response's usage badge to. Assigned when the
// request goes out, so the 'usage' message and the answer it belongs to agree.
let usageMessageId = null;

// The usage captured for the last completed request. Accumulated here and nowhere
// else: it is deliberately NOT posted anywhere yet, NOT appended to the response
// text, and NOT pushed into conversationHistory -- the text the callers receive
// must stay byte-identical to what it was before this layer existed.
export function getUsageData() {
    return usageData;
}

// Only the provider, the model and the token counts. Never the request URL or the
// headers: Gemini and some OpenAI-compatible endpoints carry the API key in the
// query string, and a header map carries it outright.
function logUsageData(usage) {
    if (!taLog || !taLog.do_debug || usage === null) return;
    taLog.log("usage data captured: " + JSON.stringify(usage));
}

self.onmessage = async function(event) {
    switch (event.data.type) {
        case 'init':
            let config = { stream: true };
            for (const key in event.data) {
                if (key.startsWith('ollama_')) {
                    let newKey = key.replace('ollama_', '');
                    config[newKey] = event.data[key];
                }
            }
            // NEVER log `config` (or any header map built from it): it carries
            // ollama_api_key. Log individual non-secret fields if a debug trace is
            // ever needed here.
            ollama = new Ollama(config);
            // Prepended once, here, and never in the chatMessage branch:
            // conversationHistory is module-level state that survives every turn,
            // so prepending per message would stack one system message per turn.
            // The history is still empty at this point, so push() *is* the prepend.
            if (config.system_prompt && config.system_prompt.trim() !== '') {
                conversationHistory.push({ role: 'system', content: config.system_prompt });
            }
            do_debug = event.data.do_debug;
            i18nStrings = event.data.i18nStrings;
            taLog = new taLogger('model-worker-ollama', do_debug);
            initUsageEmitter(event.data);
            break;  // init
        case 'chatMessage':
            conversationHistory.push({ role: 'user', content: event.data.message });
            usageData = null;
            usageMessageId = nextUsageMessageId();
            //console.log(">>>>>>>>>>> conversationHistory: " + JSON.stringify(conversationHistory));
            const response = await ollama.fetchResponse(conversationHistory); //4096);
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
                    }catch(e){
                        error_message = response.statusText;
                    }
                    taLog.log("error_message: " + JSON.stringify(error_message));
                    error_text = i18nStrings["ollama_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
                }
                postMessage({ type: 'error', payload: error_text });
                throw new Error("[ThunderAI] Ollama API request failed: " + error_text);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer= '';
    
            try {
                while (true) {
                    if (stopStreaming) {
                        stopStreaming = false;
                        reader.cancel();
                        taLog.log("AI full reasoning [STOPPED]: " + thinkingAccumulator);
                        taLog.log("AI full response [STOPPED]: " + assistantResponseAccumulator);
                        conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                        assistantResponseAccumulator = '';
                        // Separate from tokensDone and free of any response text: see usage-emitter.js.
                        postUsageData(usageData, usageMessageId);
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
                        // Separate from tokensDone and free of any response text: see usage-emitter.js.
                        postUsageData(usageData, usageMessageId);
                        postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                        thinkingAccumulator = '';
                        break;
                    }
                    // lots of low-level Ollama response parsing stuff
                    const chunk = decoder.decode(value);
                    buffer += chunk;
                    // No per-chunk dump of `buffer`: taLog.log() only gates the console
                    // call, so the whole unconsumed buffer would be re-concatenated on
                    // every chunk even with debug off. The per-line log below covers it.
                    const lines = buffer.split("\n");
                    buffer = lines.pop();
                    let parsedLines = [];
                    try{
                        parsedLines = lines
                            .map((line) => line.replace(/^chunk: /, "").trim()) // Remove the "chunk: " prefix
                            .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                            // .map((line) => JSON.parse(line)); // Parse the JSON string
                            .map((line) => {
                                try {
                                    // Guarded at the call site: taLog.log() gates only the
                                    // console call, so an unguarded JSON.stringify() would run
                                    // per line even with debug off.
                                    if (taLog.do_debug) taLog.log("line: " + JSON.stringify(line));
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
                        // Only the final chunk (done === true) carries the counters;
                        // extractUsage() returns null for every other one.
                        const usage = extractUsage(parsedLine);
                        if (usage !== null) {
                            usageData = usage;
                            logUsageData(usageData);
                        }

                        const { message } = parsedLine;
                        const { content, thinking } = message;
                        // Update the UI with the new thinking content
                        if (thinking) {
                            thinkingAccumulator += thinking;
                            postMessage({ type: 'newThinkingToken', payload: { token: thinking } });
                        }
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
