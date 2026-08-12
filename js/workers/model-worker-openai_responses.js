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

import { OpenAI } from '../api/openai_responses.js';
import { taLogger } from '../mzta-logger.js';

let openai = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';
let previous_response_id = null;

// Reasoning stream events: reasoning_summary_text.delta carries the summary the
// Responses API exposes for the o-series / gpt-5 models, while some models emit
// reasoning_text.delta instead. Either is forwarded as soon as it appears, with no
// preference gating the detection.
// A third source is handled below: models that do not stream those deltas still
// deliver the summary inside the reasoning item of response.output_item.done. Note
// that the summary is only ever populated when the request asks for it through the
// chatgpt_reasoning_summary preference; without it the item carries just the opaque
// encrypted_content, which cannot be displayed.
const REASONING_DELTA_EVENTS = ['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'];

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        let config = { stream: true };
        for (const key in event.data) {
            if (key.startsWith('chatgpt_')) {
                if (key.startsWith('chatgpt_web_')) continue; // Exclude chatgpt_web_ prefixed keys
                let newKey = key.replace('chatgpt_', '');
                if (newKey === 'api_key') newKey = 'apiKey';
                config[newKey] = event.data[key];
            }
        }
        openai = new OpenAI(config);
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
                error_text = i18nStrings["chatgpt_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
            }
            postMessage({ type: 'error', payload: error_text });
            throw new Error("[ThunderAI] OpenAI ChatGPT API request failed: " + error_text);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        let streamError = false;

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
                } else if (REASONING_DELTA_EVENTS.includes(parsedLine.type) && typeof parsedLine.delta === 'string' && parsedLine.delta !== '') {
                    thinkingAccumulator += parsedLine.delta;
                    postMessage({ type: 'newThinkingToken', payload: { token: parsedLine.delta } });
                } else if (parsedLine.type === 'response.output_item.done' && parsedLine.item && parsedLine.item.type === 'reasoning' && thinkingAccumulator === '') {
                    // Fallback for models that never stream the reasoning deltas: the whole
                    // summary shows up at once here. Skipped when the accumulator already
                    // holds streamed text, so the reasoning is never emitted twice.
                    const summary_text = Array.isArray(parsedLine.item.summary)
                        ? parsedLine.item.summary.map((part) => (part && typeof part.text === 'string') ? part.text : '').join('')
                        : '';
                    if (summary_text !== '') {
                        thinkingAccumulator += summary_text;
                        postMessage({ type: 'newThinkingToken', payload: { token: summary_text } });
                    }
                // } else if (parsedLine.type === 'response.completed' && parsedLine.response && parsedLine.response.id) {
                //     previous_response_id = parsedLine.response.id;
                } else if (parsedLine.type === 'response.failed' && parsedLine.response && parsedLine.response.error) {
                    const error = parsedLine.response.error;
                    const errorMessage = error.message || JSON.stringify(error);
                    taLog.error("response.failed: " + JSON.stringify(error));
                    postMessage({ type: 'error', payload: i18nStrings["chatgpt_api_request_failed"] + ": " + errorMessage });
                    reader.cancel();
                    assistantResponseAccumulator = '';
                    thinkingAccumulator = '';
                    streamError = true;
                    break;
                }
            }
            if (streamError) break;
        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
