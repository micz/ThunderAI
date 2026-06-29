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
 */
 // Call the API to use a special prompt

 import {
    prefs_default,
    integration_options_config
 } from "../options/mzta-options-default.js";
 import { taLogger } from './mzta-logger.js';

 // Fallback timeout (ms) for a special command if the special_command_timeout
 // preference is unavailable. Kept generous to accommodate slow local models.
 const SPECIAL_COMMAND_TIMEOUT_DEFAULT = 120000;

 function validateAPIConfig(llm, prefs) {
    switch (llm) {
        case 'chatgpt_api':
            if (!prefs.chatgpt_api_key) return browser.i18n.getMessage('chatgpt_empty_apikey');
            if (!prefs.chatgpt_model)   return browser.i18n.getMessage('chatgpt_empty_model');
            break;
        case 'google_gemini_api':
            if (!prefs.google_gemini_api_key) return browser.i18n.getMessage('google_gemini_empty_apikey');
            if (!prefs.google_gemini_model)   return browser.i18n.getMessage('google_gemini_empty_model');
            break;
        case 'ollama_api':
            if (!prefs.ollama_host)  return browser.i18n.getMessage('ollama_empty_host');
            if (!prefs.ollama_model) return browser.i18n.getMessage('ollama_empty_model');
            break;
        case 'openai_comp_api':
            if (!prefs.openai_comp_host)  return browser.i18n.getMessage('OpenAIComp_empty_host');
            if (!prefs.openai_comp_model) return browser.i18n.getMessage('OpenAIComp_empty_model');
            break;
        case 'anthropic_api':
            if (!prefs.anthropic_api_key) return browser.i18n.getMessage('anthropic_empty_apikey');
            if (!prefs.anthropic_model)   return browser.i18n.getMessage('anthropic_empty_model');
            if (!prefs.anthropic_version) return browser.i18n.getMessage('anthropic_empty_version');
            break;
    }
    return null;
 }
 
 export class mzta_specialCommand {
    
    prompt = "";
    worker = null;
    llm = "";
    full_message = "";
    logger = null;
    do_debug = false;
    config = {};
    timeout_ms = SPECIAL_COMMAND_TIMEOUT_DEFAULT;

    constructor(args = {}) {
        let {
            prompt = '',
            llm = '',
            do_debug = false,
            config = {}
        } = args;
        this.prompt = prompt;
        this.llm = llm;
        this.config = config;
        this.do_debug = do_debug;
        this.logger = new taLogger('mzta_specialCommand', do_debug);

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
        let integration = this.llm.replace('_api', '');
        let use_specific_api = false;

        this.logger.log("integration: " + integration);

        if (this.config.api_type && this.config.api_type !== '') {
            integration = this.config.api_type.replace('_api', '');
            use_specific_api = true;
            this.logger.log("use_specific_api: " + use_specific_api);
            this.logger.log("specific integration: " + integration);
        }
        const options_config = integration_options_config[integration];

        if (!options_config) {
            this.logger.error("Invalid integration type: " + integration);
            throw new Error("Invalid integration type: " + integration);
        }

        const prefsToGet = {};
        const configKeys = Object.keys(options_config);

        for (const key of configKeys) {
            const prefKey = `${integration}_${key}`;
            prefsToGet[prefKey] = prefs_default[prefKey];
        }

        const prefs_api = await browser.storage.sync.get(prefsToGet);

        // Load the configurable timeout used to abort a hung worker in sendPrompt().
        const prefs_timeout = await browser.storage.sync.get({ special_command_timeout: prefs_default.special_command_timeout });
        if (Number.isFinite(prefs_timeout.special_command_timeout) && prefs_timeout.special_command_timeout > 0) {
            this.timeout_ms = prefs_timeout.special_command_timeout;
        }

        if (!use_specific_api) {
            const configError = validateAPIConfig(this.llm, prefs_api);
            if (configError) {
                const err = new Error(configError);
                err.isConfigError = true;
                throw err;
            }
        }

        let workerInitMessage = {
            type: 'init',
            do_debug: this.do_debug,
            i18nStrings: ''
        };

        for (const key of configKeys) {
            const prefKey = `${integration}_${key}`;
            let value = prefs_api[prefKey];
            
            if(use_specific_api){
                const configValue = this.config[prefKey];
                
                if (configValue !== undefined) {
                    if (typeof options_config[key] === 'boolean') {
                        value = (configValue === true || configValue === 'true' || configValue === 1);
                    } else {
                        value = configValue;
                    }
                }
            }

            workerInitMessage[prefKey] = value;
        }

        this.worker.postMessage(workerInitMessage);
    }

    sendPrompt(){
        const promise = new Promise((resolve, reject) => {
            // Abort the worker if it never replies (e.g. a hung network connection),
            // so the caller's queue is not stuck waiting forever. Cleared on any outcome.
            let timeoutId = setTimeout(() => {
                this.logger.error("Special command timed out after " + this.timeout_ms + " ms");
                reject(new Error(`[ThunderAI] Special command timed out after ${this.timeout_ms} ms`));
            }, this.timeout_ms);
            const clearTimer = () => { clearTimeout(timeoutId); };

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
                        clearTimer();
                        this.logger.log("tokensDone: " + this.full_message);
                        resolve(this.full_message); // Resolve the promise with the full message
                        break;
                    case 'error':
                        clearTimer();
                        console.error('[ThunderAI] Error from API worker:', payload);
                        reject(new Error(`[ThunderAI] Error from API worker: ${payload}`)); // Use a single error object
                        break;
                    default:
                        console.error('[ThunderAI] Unknown event type from API worker:', type);
                }
            };

            this.worker.onerror = (error) => {
                clearTimer();
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
            clearTimer();
            console.error('[ThunderAI] Failed to send message to worker:', error);
            reject(error);
        }
        });
        // Always terminate the worker once the prompt settles (success, error or timeout),
        // so workers are not leaked across batch processing. .finally() preserves the
        // resolved value / rejection unchanged.
        return promise.finally(() => this.dispose());
    }

    // Terminate the worker and release its reference. Safe to call multiple times.
    // After dispose() the instance must not be reused — callers create a fresh
    // mzta_specialCommand per prompt.
    dispose() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.logger.log("[dispose] worker terminated");
        }
    }
 }
