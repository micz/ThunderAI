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

import { GoogleGemini } from '../api/google_gemini.js';
import { taLogger } from '../mzta-logger.js';

let google_gemini = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        let config = { stream: true };
        for (const key in event.data) {
            if (key.startsWith('google_gemini_')) {
                let newKey = key.replace('google_gemini_', '');
                if (newKey === 'api_key') newKey = 'apiKey';
                config[newKey] = event.data[key];
            }
        }
        google_gemini = new GoogleGemini(config);
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-google_gemini', do_debug);
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', parts: [{"text": event.data.message}] });

        const response = await google_gemini.fetchResponse(conversationHistory);
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
                error_text = i18nStrings["google_gemini_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
            }
            postMessage({ type: 'error', payload: error_text });
            throw new Error("[ThunderAI] Google Gemini API request failed: " + error_text);
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
                conversationHistory.push({ role: 'model', parts: [{"text": assistantResponseAccumulator}] });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            const { done, value } = await reader.read();
            if (done) {
                taLog.log("AI full reasoning: " + thinkingAccumulator);
                taLog.log("AI full response: " + assistantResponseAccumulator);
                conversationHistory.push({ role: 'model', parts: [{"text": assistantResponseAccumulator}] });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            // lots of low-level Google Gemini response parsing stuff
            const chunk = decoder.decode(value);
            buffer += chunk;
            taLog.log("buffer " + buffer);
            const lines = buffer.split("\n");
            buffer = lines.pop();
            let parsedLines = [];
            try{
                parsedLines = lines
                    .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                    .filter((line) => line !== "" ) // Remove empty lines
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
                const { candidates } = parsedLine;

                if (!Array.isArray(candidates) || candidates.length === 0) {
                    taLog.warn('[ThunderAI] Gemini stream skipped: candidates is not a non-empty array');
                    continue;
                }

                const { content } = candidates[0];
                if (!content || typeof content !== 'object') {
                    taLog.warn('[ThunderAI] Gemini stream skipped: missing candidate content');
                    continue;
                }

                const { parts } = content;
                if (!Array.isArray(parts) || parts.length === 0) {
                    taLog.warn('[ThunderAI] Gemini stream skipped: parts is not a non-empty array. [finishReason: ' + candidates[0].finishReason + ']');
                    continue;
                }

                // Every part must be examined, not just parts[0]: when the model
                // reasons, the reasoning arrives as additional parts flagged with
                // thought: true, and a thought part can come first. Detection relies
                // only on that flag, so a model that reasons without
                // google_gemini_thinking_budget being set is handled too.
                for (const part of parts) {
                    if (!part || typeof part.text !== 'string' || part.text === '') {
                        continue;
                    }
                    // Update the UI with the new thinking content
                    if (part.thought === true) {
                        thinkingAccumulator += part.text;
                        postMessage({ type: 'newThinkingToken', payload: { token: part.text } });
                        continue;
                    }
                    // Update the UI with the new content
                    assistantResponseAccumulator += part.text;
                    postMessage({ type: 'newToken', payload: { token: part.text } });
                }
            }
        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};
