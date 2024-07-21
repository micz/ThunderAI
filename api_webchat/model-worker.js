import { OpenAI } from '../js/api/openai.js';

let api_key_chatgpt = null;
let  openai = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        api_key_chatgpt = event.data.api_key_chatgpt;
        openai = new OpenAI(api_key_chatgpt, true);
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });
        
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
    const response = await openai.fetchResponse("gpt-4-1106-preview", conversationHistory); //4096);
        postMessage({ type: 'messageSent' });
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
