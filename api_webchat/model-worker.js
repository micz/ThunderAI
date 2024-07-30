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

import { OpenAI } from '../js/api/openai.js';

//========================== for testing
// const MOCK_TOKENS = ['Good', ' morning', ' Mr', ' Plop', 'py', ',', 'and', ' I', ' said',  '\n', '"', 'Good', ' morn', 'ing', ' Mrs',' Plop', 'py', ,'"', '\n', 'Oh', ' how', ' the', ' win', 'ter', ' even', 'ings', ' must', ' just', ' fly'];
//
// function mockDelay(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

// async function processMockTokens() {
//     for (const token of MOCK_TOKENS) {
//         await mockDelay(Math.random() * 50 + 50); // Random delay between 100ms and 150ms
//         postMessage({ type: 'newToken', payload: { token } });
//     }
//     postMessage({ type: 'tokensDone' });
// }
//========================== for testing - END


let chatgpt_api_key = null;
let chatgpt_model = '';
let openai = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        chatgpt_api_key = event.data.chatgpt_api_key;
        chatgpt_model = event.data.chatgpt_model;
        //console.log(">>>>>>>>>>> chatgpt_api_key: " + chatgpt_api_key);
        openai = new OpenAI(chatgpt_api_key, chatgpt_model, true);
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });
        

        // ============================== TESTING
        // // Simulate sending the message to an HTTP endpoint
        // await mockDelay(1000); // Wait for 1 second

        // // Notify that the chat message was sent
        // postMessage({ type: 'messageSent' });

        // // Start processing tokens
        // await processMockTokens();
        // return;
        // ============================== TESTING - END



        // https://platform.openai.com/docs/models/gpt-4-and-gpt-4-turbo
        // 4096 output tokens
        // 128,000 input tokens
        // const response = await fetch(API_URL, {
        //     method: "POST",
        //     headers: {
        //         "Content-Type": "application/json",
        //         "Authorization": `Bearer ${openaiApiKey}`,
        //     },
        //     body: JSON.stringify({
        //         model: "gpt-4-1106-preview",
        //         messages: conversationHistory,
        //         stream: true,
        //     }),
        // });
    const response = await openai.fetchResponse(conversationHistory); //4096);
        postMessage({ type: 'messageSent' });

        if (!response.ok) {
            const errorJSON = await response.json();
            const errorDetail = JSON.stringify(errorJSON);
            //console.log(">>>>>>>>>>>>> errorJSON.error.message: " + JSON.stringify(errorJSON.error.message));
            postMessage({ type: 'error', payload: errorJSON.error.message });
            throw new Error("[ThunderAI] OpenAI API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
    
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone' });
                break;
            }
            // lots of low-level OpenAI response parsing stuff
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");
            const parsedLines = lines
                .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                .map((line) => JSON.parse(line)); // Parse the JSON string
    
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
    }
};
