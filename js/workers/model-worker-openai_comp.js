
// --- Patch fetch in the worker to delegate to main thread with streaming support ---
let fetchCounter = 0;
self.fetch = (...args) => {
  const requestId = 'fetch_' + (++fetchCounter);
  postMessage({ type: 'proxy-fetch', requestId, args });

  return new Promise((resolve) => {
    if (!self._fetchResolvers) self._fetchResolvers = {};
    self._fetchResolvers[requestId] = resolve;
  });
};

onmessage = (e) => {
  if (e.data.type === 'proxy-fetch-response') {
    const { requestId, response } = e.data;
    const resolve = self._fetchResolvers?.[requestId];
    if (resolve) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(response.body));
          controller.close();
        }
      });

      const fakeResponse = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: {
          get: (name) => response.headers[name.toLowerCase()] || null
        },
        body: stream,
        text: async () => response.body,
        json: async () => JSON.parse(response.body)
      };

      resolve(fakeResponse);
      delete self._fetchResolvers[requestId];
    }
  }
};
// --- End patch ---


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

import { OpenAIComp } from '../api/openai_comp.js';
import { taLogger } from '../mzta-logger.js';

let openai_comp_host = null;
let openai_comp_model = '';
let openai_comp_api_key = '';
let openai_comp_use_v1 = true;
let openai_comp = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        openai_comp_host = event.data.openai_comp_host;
        openai_comp_model = event.data.openai_comp_model;
        openai_comp_api_key = event.data.openai_comp_api_key;
        openai_comp_use_v1 = event.data.openai_comp_use_v1;
        openai_comp = new OpenAIComp(openai_comp_host, openai_comp_model, openai_comp_api_key, true, openai_comp_use_v1);
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-openai_comp', do_debug);
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
                try{
                    const errorJSON = await response.json();
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error.message;
                }catch(e){
                    error_message = response.statusText;
                }
                taLog.log("error_message: " + JSON.stringify(error_message));
            }
            postMessage({ type: 'error', payload: i18nStrings["OpenAIComp_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail });
            throw new Error("[ThunderAI] OpenAI Comp API request failed: " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail);
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
            taLog.log("buffer: " + buffer);
            const lines = buffer.split("\n");
            buffer = lines.pop();
            let parsedLines = [];
            try{
                parsedLines = lines
                    .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                    .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                    // .map((line) => JSON.parse(line)); // Parse the JSON string
                    .map((line) => {
                        taLog.log("line: " + JSON.stringify(line));
                        return JSON.parse(line);
                    });
            }catch(e){
                taLog.error("Error parsing lines: " + e);
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
