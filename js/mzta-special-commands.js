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
import { mztaPrefs } from './mzta-prefs.js';
 import { taLogger } from './mzta-logger.js';
 import { stripThinkTags } from './mzta-utils.js';
 import {
     createProviderWorker,
     ProcessingWorker
 } from './mzta-processing-worker.js';
 import { resolveEndpointAccess } from './mzta-endpoint-approvals.js';
 import { saveEndpointRedirect } from './mzta-endpoint-redirects.js';

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
    worker_path = "";
    llm = "";
    full_message = "";
    thinking_message = "";
    logger = null;
    do_debug = false;
    config = {};
    timeout_ms = SPECIAL_COMMAND_TIMEOUT_DEFAULT;

    constructor(args = {}) {
        let {
            prompt = '',
            llm = '',
            do_debug = false,
            config = {},
            processingClient,
            // Ask the provider for a JSON answer where it has a reliable JSON mode (OpenAI
            // json_object, Gemini responseMimeType, Ollama format json). Used by the Smart bar
            // router; the parser stays tolerant for every provider.
            jsonMode = false,
            // An AbortSignal: when it aborts, the worker is disposed and sendPrompt() rejects
            // with an error named 'AbortError' (err.aborted = true).
            signal = null,
            // Called with the reasoning received so far, on each thinking token: the Smart bar
            // shows it while the router works. Never part of the resolved value.
            onThinking = null,
            // Called with each answer token as it arrives: the Smart bar's chat streams its free
            // answer through it. Never called while ThunderAI Privacy prepares the request (a
            // ProcessingWorker): its tokens would show the protected values, restored only in
            // the resolved answer. The resolved value is the same either way.
            onToken = null
        } = args;
        this.onThinking = typeof onThinking === 'function' ? onThinking : null;
        this.onToken = typeof onToken === 'function' ? onToken : null;
        this.jsonMode = jsonMode === true;
        this.signal = signal;
        this.prompt = prompt;
        this.llm = llm;
        this.config = config;
        this.processingClient = processingClient;
        this.do_debug = do_debug;
        this.logger = new taLogger('mzta_specialCommand', do_debug);

        const worker_path_map = {
            chatgpt_api: './workers/model-worker-openai_responses.js',
            google_gemini_api: './workers/model-worker-google_gemini.js',
            ollama_api: './workers/model-worker-ollama.js',
            openai_comp_api: './workers/model-worker-openai_comp.js',
            anthropic_api: './workers/model-worker-anthropic.js',
        };

        // The Worker itself is created only by initWorker(), once the configuration
        // is known to be usable: a configuration error then leaves nothing to terminate.
        const worker_path = worker_path_map[this.llm];
        if (worker_path) {
            this.worker_path = worker_path;
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

        const prefs_api = await mztaPrefs.getPrefs(Object.keys(prefsToGet));

        // Load the configurable timeout used to abort a hung worker in sendPrompt().
        const prefs_timeout = await mztaPrefs.getPrefs(['special_command_timeout', 'api_stream_idle_timeout']);
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

        // The strings the worker builds its error texts from: a Web Worker has no
        // browser.i18n. Same set as api_webchat/controller.js; without it an HTTP error
        // would read "undefined: 429 ...".
        const i18n_msg_key = integration === 'openai_comp' ? 'OpenAIComp_api_request_failed' : `${integration}_api_request_failed`;
        const i18nStrings = {
            [i18n_msg_key]: browser.i18n.getMessage(i18n_msg_key),
            error_connection_interrupted: browser.i18n.getMessage('error_connection_interrupted'),
            // The worker fills in the literal $SECONDS$ with the timeout it applies.
            error_stream_idle_timeout: browser.i18n.getMessage('error_stream_idle_timeout', ['$SECONDS$']),
            api_error_redirect: browser.i18n.getMessage('api_error_redirect'),
        };
        if (integration === 'anthropic') {
            // describeAnthropicError() replaces the literal $MODEL$ with the model actually sent.
            for (const key of ['anthropic_err_hint_temperature', 'anthropic_err_hint_budget_tokens', 'anthropic_err_hint_thinking_type', 'anthropic_err_hint_effort']) {
                i18nStrings[key] = browser.i18n.getMessage(key, ['$MODEL$']);
            }
        }

        let workerInitMessage = {
            type: 'init',
            do_debug: this.do_debug,
            i18nStrings: i18nStrings,
            // Validated by the worker (resolveIdleTimeoutMs()), like in the chat window.
            api_stream_idle_timeout: prefs_timeout.api_stream_idle_timeout,
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

        // JSON mode, only where the provider has a reliable one, and never over a format the
        // user chose. OpenAI-compatible servers (json_object or json_schema support varies, and
        // an unsupported one is a hard 400) and Claude (no JSON mode) rely on the parser.
        if (this.jsonMode) {
            if (integration === 'chatgpt' && !workerInitMessage.chatgpt_text_format) {
                workerInitMessage.chatgpt_text_format = 'json_object';
            } else if (integration === 'ollama') {
                workerInitMessage.ollama_format_json = true;
            } else if (integration === 'google_gemini') {
                workerInitMessage.google_gemini_json_mode = true;
            }
        }

        // A custom endpoint is checked before the worker exists [#1000]. Nobody may be
        // looking (the automatic processing of incoming mail), so nothing is asked here:
        // an unencrypted server not yet confirmed fails like a missing setting, and the
        // message sends the user to the settings, where the confirmation is asked.
        if (Object.prototype.hasOwnProperty.call(options_config, 'host')) {
            const access = await resolveEndpointAccess(workerInitMessage[`${integration}_host`]);
            if (!access.ok) {
                const err = new Error(access.message);
                err.isConfigError = true;
                throw err;
            }
            workerInitMessage.approved_insecure_origins = access.approvedOrigins;
        }

        this.worker = await createProviderWorker(new URL(this.worker_path, import.meta.url), {
            format: 'json',
            client: this.processingClient
        });
        this.responsePrepared = this.worker instanceof ProcessingWorker;
        this.worker.postMessage(workerInitMessage);
    }

    sendPrompt(){
        const promise = new Promise((resolve, reject) => {
            // HTTP status of the last retried failure. Long Retry-After waits can outlast
            // special_command_timeout, so a request still retrying a 429 when the timer
            // fires is reported as rate limited too, not as a plain timeout.
            let lastRetryStatus = null;
            // Each local chunk gets the configured timeout; dispatch starts a
            // fresh provider budget. A stalled chunk or queue still times out.
            let timeoutId;
            const resetTimer = () => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    this.logger.error("Special command timed out after " + this.timeout_ms + " ms");
                    const err = new Error(`[ThunderAI] Special command timed out after ${this.timeout_ms} ms`);
                    if (lastRetryStatus === 429) err.rateLimited = true;
                    reject(err);
                }, this.timeout_ms);
            };
            resetTimer();
            const clearTimer = () => { clearTimeout(timeoutId); };

            // A caller that stops the command (the Smart bar's Stop, or a new instruction that
            // replaces the running one): the worker is disposed at once by the finally below,
            // and no late answer is delivered.
            if (this.signal) {
                const onAbort = () => {
                    clearTimer();
                    const err = new Error('[ThunderAI] Special command aborted');
                    err.name = 'AbortError';
                    err.aborted = true;
                    reject(err);
                };
                if (this.signal.aborted) {
                    onAbort();
                    return;
                }
                this.signal.addEventListener('abort', onAbort, { once: true });
            }

            if (this.responsePrepared) {
                this.worker.onprocessingstatus = status => {
                    if (['started', 'progress', 'complete'].includes(status.type)) resetTimer();
                };
            }

            // Event listeners for worker messages
            this.worker.onmessage = (event) => {
                const { type, payload } = event.data;
                // console.log(`>>>>>>>>>>>> [Worker Message Received] type: ${type}`, payload);
                switch (type) {
                    case 'messageSent':
                        break;
                    case 'newRetryAttempt':
                        // Transient failure being retried by the worker: nothing to
                        // show, the overall special_command_timeout still applies.
                        this.logger.log("Retrying the API request: " + JSON.stringify(payload));
                        lastRetryStatus = payload?.status ?? null;
                        break;
                    case 'endpoint_redirect':
                        // The redirect outcome of a request to a custom endpoint [#1000]:
                        // saved for the note under the host field of the connection panels.
                        // Not awaited: a storage write must not delay the answer.
                        saveEndpointRedirect(payload.host, payload.info);
                        break;
                    case 'newToken':
                        this.full_message += payload.token;
                        if (this.onToken && !this.responsePrepared) {
                            try { this.onToken(payload.token); } catch (e) { /* a display callback never breaks the command */ }
                        }
                        break;
                    case 'newThinkingToken':
                        // A special command's response is parsed, not displayed, so the
                        // model's reasoning must never reach full_message. Kept apart here
                        // for the providers that stream it in a dedicated field: it is only
                        // written to the debug log, never handed to the caller.
                        this.thinking_message += payload.token;
                        if (this.onThinking) {
                            try { this.onThinking(this.thinking_message); } catch (e) { /* a display callback never breaks the command */ }
                        }
                        break;
                    case 'tokensDone': {
                        clearTimer();
                        // Models that emit their reasoning inline instead (<think> blocks in
                        // the content stream) need it stripped for the same reason. An
                        // unterminated block means a truncated reply: drop the leftover too,
                        // rather than handing raw reasoning to the caller's parser.
                        // The whole response is passed here, so the leading whitespace a
                        // removed block leaves behind is safe to trim (third argument).
                        // Filtered output has reasoning stripped before restoration,
                        // so literal <think> text in an original value stays intact.
                        const cleaned = this.responsePrepared ? this.full_message : stripThinkTags(this.full_message, true, true).text;
                        this.logger.log("tokensDone: " + cleaned);
                        resolve(cleaned); // Resolve the promise with the full message
                        break;
                    }
                    case 'error': {
                        clearTimer();
                        console.error('[ThunderAI] Error from API worker:', payload);
                        const err = new Error(`[ThunderAI] Error from API worker: ${payload}`); // Use a single error object
                        // Set by the workers on a 429 that outlived the retries: the
                        // batch loop in processEmails() stops on it.
                        if (event.data.rateLimited === true) err.rateLimited = true;
                        // The wait the provider asked for, when too long to retry: shown to the user.
                        if (Number.isFinite(event.data.retryAfterMs)) err.retryAfterMs = event.data.retryAfterMs;
                        reject(err);
                        break;
                    }
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
            this.logger.log("fullPrompt: " + this.prompt)
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
