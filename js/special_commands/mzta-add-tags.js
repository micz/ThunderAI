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

 import { taLogger } from './mzta-logger.js';

 
 export class mzta_specialCommand_AddTags {
    
    prompt = "";
    worker = null;
    llm = "";
    full_message = "";
    logger = null;
    do_debug = false;

    constructor(prompt, worker, llm, do_debug = false) {
        this.prompt = prompt;
        this.worker = worker;
        this.llm = llm;
        this.logger = new taLogger('mzta_specialCommand_AddTags', do_debug);
        this.do_debug = do_debug;
        switch (this.llm) {
            case "chatgpt_api":
                this.worker = new Worker('../workers/model-worker-openai.js', { type: 'module' });
                break;
            case "ollama_api":
                this.worker = new Worker('../workers/model-worker-ollama.js', { type: 'module' });
                break;
            case "openai_comp_api":
                this.worker = new Worker('../workers/model-worker-openai_comp.js', { type: 'module' });
                break;
        }

        // Event listeners for worker messages
        this.worker.onmessage = function(event) {
            const { type, payload } = event.data;
            switch (type) {
                case 'messageSent':
                    break;
                case 'newToken':
                    this.full_message += payload.token;
                    break;
                case 'tokensDone':
                    console.log(">>>>>>>>>>>> [ThunderAI] tokensDone: " + this.full_message);
                    break;
                case 'error':
                    console.error('[ThunderAI] Error from API worker:', payload);
                    break;
                default:
                    console.error('[ThunderAI] Unknown event type from API worker:', type);
            }
        };
    }

    async initWorker() {
        switch (this.llm) {
            case "chatgpt_api":
                let prefs_api = await browser.storage.sync.get({chatgpt_api_key: '', chatgpt_model: ''});
                this.worker.postMessage({ type: 'init', chatgpt_api_key: prefs_api.chatgpt_api_key, chatgpt_model: prefs_api.chatgpt_model, do_debug: this.do_debug, i18nStrings: ''});
                break;
            // case "ollama_api": {
            //     let prefs_api = await browser.storage.sync.get({ollama_host: '', ollama_model: '', do_debug: false});
            //     let i18nStrings = {};
            //     i18nStrings["ollama_api_request_failed"] = browser.i18n.getMessage('ollama_api_request_failed');
            //     i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
            //     messageInput.setModel(prefs_api.ollama_model);
            //     messagesArea.setLLMName("Ollama Local");
            //     worker.postMessage({ type: 'init', ollama_host: prefs_api.ollama_host, ollama_model: prefs_api.ollama_model, do_debug: prefs_api.do_debug, i18nStrings: i18nStrings});
            //     browser.runtime.sendMessage({command: "ollama_api_ready_" + call_id, window_id: (await browser.windows.getCurrent()).id});
            //     messagesArea.appendUserMessage(browser.i18n.getMessage("ollama_api_connecting") + " \"" + prefs_api.ollama_host + "\" " +browser.i18n.getMessage("AndModel") + " \"" + prefs_api.ollama_model + "\"...", "info");
            //     break;
            // }
            // case "openai_comp_api": {
            //     let prefs_api = await browser.storage.sync.get({openai_comp_host: '', openai_comp_model: '', openai_comp_api_key: '', openai_comp_use_v1: true, openai_comp_chat_name: '', do_debug: false});
            //     let i18nStrings = {};
            //     i18nStrings["OpenAIComp_api_request_failed"] = browser.i18n.getMessage('OpenAIComp_api_request_failed');
            //     i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');
            //     messageInput.setModel(prefs_api.openai_comp_model);
            //     messagesArea.setLLMName(prefs_api.openai_comp_chat_name);
            //     worker.postMessage({ type: 'init', openai_comp_host: prefs_api.openai_comp_host, openai_comp_model: prefs_api.openai_comp_model, openai_comp_api_key: prefs_api.openai_comp_api_key, openai_comp_use_v1: prefs_api.openai_comp_use_v1, do_debug: prefs_api.do_debug, i18nStrings: i18nStrings});
            //     messagesArea.appendUserMessage(browser.i18n.getMessage("OpenAIComp_api_connecting") + " \"" + prefs_api.openai_comp_host + "\" " +browser.i18n.getMessage("AndModel") + " \"" + prefs_api.openai_comp_model + "\"...", "info");
            //     browser.runtime.sendMessage({command: "openai_comp_api_ready_" + call_id, window_id: (await browser.windows.getCurrent()).id});
            //     break;
            // }
        }
    }

    sendPrompt(){
        this.worker.postMessage({ type: 'chatMessage', message: this.prompt });
    }

 }