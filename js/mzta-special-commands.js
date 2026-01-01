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
 */
 // Call the API to use a special prompt

 import {
    prefs_default,
    integration_options_config
 } from "../options/mzta-options-default.js";
 import { taLogger } from './mzta-logger.js';
 
 export class mzta_specialCommand {
    
    prompt = "";
    worker = null;
    llm = "";
    custom_model = "";
    full_message = "";
    logger = null;
    do_debug = false;
    config = {};

    constructor(args = {}) {
        let {
            prompt = '',
            llm = '',
            custom_model = '',
            do_debug = false,
            config = {}
        } = args;
        this.prompt = prompt;
        this.llm = llm;
        this.custom_model = custom_model;
        this.config = config;
        this.logger = new taLogger('mzta_specialCommand', do_debug);
        this.do_debug = do_debug;

        const worker_path_map = {
            chatgpt_api: './workers/model-worker-openai_responses.js',
            google_gemini_api: './workers/model-worker-google_gemini.js',
            ollama_api: './workers/model-worker-ollama.js',
            openai_comp_api: './workers/model-worker-openai_comp.js',
            anthropic_api: './workers/model-worker-anthropic.js',
        };

        const worker_path = worker_path_map[this.llm];
        if (worker_path) {
            this.worker = new Worker(new URL(worker_path, import.meta.url), { type: 'module' });
        } else {
            this.logger.log("Invalid LLM type: " + this.llm);
            throw new Error("Invalid LLM type: " + this.llm);
        }
    }

    async initWorker() {
        const integration = this.llm.replace('_api', '');
        const options_config = integration_options_config[integration];

        if (!options_config) {
            this.logger.error("Invalid integration type: " + integration);
            throw new Error("Invalid integration type: " + integration);
        }

        let prefsToGet = {};
        for (const key in options_config) {
            const prefKey = `${integration}_${key}`;
            prefsToGet[prefKey] = prefs_default[prefKey];
        }

        let prefs_api = await browser.storage.sync.get(prefsToGet);

        let workerInitMessage = {
            type: 'init',
            do_debug: this.do_debug,
            i18nStrings: ''
        };

        for (const key in options_config) {
            const prefKey = `${integration}_${key}`;
            
            const configValue = this.config[prefKey];
            
            if (configValue !== undefined) {
                 if (typeof options_config[key] === 'boolean') {
                    prefs_api[prefKey] = (configValue === true || configValue === 'true' || configValue === 1);
                 } else {
                    prefs_api[prefKey] = configValue;
                 }
            }
            
            if (key === 'model') {
                 workerInitMessage[prefKey] = this.custom_model !== '' ? this.custom_model : prefs_api[prefKey];
            } else {
                 workerInitMessage[prefKey] = prefs_api[prefKey];
            }
        }

        this.worker.postMessage(workerInitMessage);
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
                        this.logger.log("tokensDone: " + this.full_message);
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
