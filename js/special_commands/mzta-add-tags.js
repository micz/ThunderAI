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
 */
 // Call the API to get the tags

 import { taLogger } from '../mzta-logger.js';

 
 export class mzta_specialCommand_AddTags {
    
    prompt = "";
    worker = null;
    llm = "";
    full_message = "";
    logger = null;
    do_debug = false;

    constructor(prompt, llm, do_debug = false) {
        this.prompt = prompt;
        this.llm = llm;
        this.logger = new taLogger('mzta_specialCommand_AddTags', do_debug);
        this.do_debug = do_debug;
        switch (this.llm) {
            case "chatgpt_api":
                this.worker = new Worker(new URL('../workers/model-worker-openai.js', import.meta.url), { type: 'module' });
                break;
            case "google_gemini_api":
                this.worker = new Worker(new URL('../workers/model-worker-google_gemini.js', import.meta.url), { type: 'module' });
                break;
            case "ollama_api":
                this.worker = new Worker(new URL('../workers/model-worker-ollama.js', import.meta.url), { type: 'module' });
                break;
            case "openai_comp_api":
                this.worker = new Worker(new URL('../workers/model-worker-openai_comp.js', import.meta.url), { type: 'module' });
                break;
        }
    }

    async initWorker() {
        switch (this.llm) {
            case "chatgpt_api": {
                let prefs_api = await browser.storage.sync.get({chatgpt_api_key: '', chatgpt_model: ''});
                this.worker.postMessage({ type: 'init', chatgpt_api_key: prefs_api.chatgpt_api_key, chatgpt_model: prefs_api.chatgpt_model, do_debug: this.do_debug, i18nStrings: ''});
                break;
            }
            case "google_gemini_api": {
                let prefs_api = await browser.storage.sync.get({google_gemini_api_key: '', google_gemini_model: '', google_gemini_system_instruction: ''});
                this.worker.postMessage({ type: 'init', google_gemini_api_key: prefs_api.google_gemini_api_key, google_gemini_model: prefs_api.google_gemini_model, google_gemini_system_instruction: prefs_api.google_gemini_system_instruction, do_debug: this.do_debug, i18nStrings: ''});
                break;
            }
            case "ollama_api": {
                let prefs_api = await browser.storage.sync.get({ollama_host: '', ollama_model: ''});
                this.worker.postMessage({ type: 'init', ollama_host: prefs_api.ollama_host, ollama_model: prefs_api.ollama_model, do_debug: this.do_debug, i18nStrings: ''});
                break;
            }
            case "openai_comp_api": {
                let prefs_api = await browser.storage.sync.get({openai_comp_host: '', openai_comp_model: '', openai_comp_api_key: '', openai_comp_use_v1: true, openai_comp_chat_name: '', do_debug: false});
                console.log(">>>>>>>>>>>> [ThunderAI] prefs_api: " + JSON.stringify(prefs_api));
                this.worker.postMessage({ type: 'init', openai_comp_host: prefs_api.openai_comp_host, openai_comp_model: prefs_api.openai_comp_model, openai_comp_api_key: prefs_api.openai_comp_api_key, openai_comp_use_v1: prefs_api.openai_comp_use_v1, do_debug: this.do_debug, i18nStrings: ''});
                break;
            }
        }
    }

    sendPrompt(){
        return new Promise((resolve, reject) => {
            // Event listeners for worker messages
            this.worker.onmessage = (event) => {
                const { type, payload } = event.data;
                // console.log(`>>>>>>>>>>>> [Worker Message Received] type: ${type}`, payload);
                switch (type) {
                    case 'messageSent':
                        break;
                    case 'newToken':
                        this.full_message += payload.token;
                        break;
                    case 'tokensDone':
                        console.log(">>>>>>>>>>>> [ThunderAI] tokensDone: " + this.full_message);
                        resolve(this.full_message); // Resolve the promise with the full message
                        break;
                    case 'error':
                        console.error('[ThunderAI] Error from API worker:', payload);
                        reject(new Error(`[ThunderAI] Error from API worker: ${payload}`)); // Use a single error object
                        break;
                    default:
                        console.error('[ThunderAI] Unknown event type from API worker:', type);
                }
            };
            
            this.worker.onerror = (error) => {
                console.error('[ThunderAI] Worker Error Details:');
                console.error('Message:', error.message);
                console.error('Filename:', error.filename);
                console.error('Line Number:', error.lineno);
                console.error('Column Number:', error.colno);
                console.error('Event:', error);
                reject(error);
            };

        try {
            // console.log('[ThunderAI] Sending prompt to worker:', this.prompt);
            this.worker.postMessage({ type: 'chatMessage', message: this.prompt });
        } catch (error) {
            console.error('[ThunderAI] Failed to send message to worker:', error);
            reject(error);
        }
        });
    }
 }