import { createAIProcessingSession } from './mzta-ai-processing.js';
import { stripThinkTags } from './mzta-utils.js';

// Providers retain processed history; only the UI receives postprocessed results.
export class ProcessingWorker {
    constructor(worker, { format = 'text' } = {}, session = createAIProcessingSession()) {
        this.worker = worker;
        this.session = session;
        this.format = format;
        this.generation = 0;
        this.receiveQueue = Promise.resolve();
        worker.onmessage = ({ data }) => {
            // Preserve the provider's event ordering when no processor is active,
            // including retry/abort notifications and synchronous completion.
            if (!this.active) {
                if (['tokensDone', 'error', 'requestAborted'].includes(data.type)) this.busy = false;
                this.emit(data);
                return;
            }
            this.receiveQueue = this.receiveQueue.then(() => this.receive(data)).catch(error => {
                if (!this.disposed) { this.busy = false; this.emit({ type: 'error', payload: error.message }); }
            });
        };
        worker.onerror = event => {
            if (!this.disposed) { this.busy = false; this.emit({ type: 'error', payload: event.message || 'AI provider worker failed' }); }
        };
    }
    emit(data) { if (!this.disposed) this.onmessage?.({ data }); }
    postMessage(data) {
        if (this.disposed) return;
        if (data.type === 'init') {
            this.initData = data;
            this.initializing = this.session.ready().then(() => {
                this.active = this.session.active;
                // An inactive processor needs no content preparation: preserve
                // the provider's normal init-before-first-prompt lifecycle.
                if (!this.active && !this.disposed) {
                    this.worker.postMessage(this.initData);
                    this.initialized = true;
                }
            });
            // Surface initialization failures when sending, not as an unhandled
            // rejection while an idle chat window is merely being opened.
            void this.initializing.catch(() => {});
        }
        else if (data.type === 'chatMessage') void this.send(data);
        else if (data.type === 'stop' && (this.waitingForInit || this.filtering || this.postprocessing)) {
            ++this.generation;
            this.session.cancel();
            this.busy = false;
            this.filtering = false;
            this.emit({ type: 'tokensDone' });
        }
        else this.worker.postMessage(data);
    }
    async send(data) {
        if (this.disposed) return;
        const generation = this.generation;
        let ownsTurn = false;
        this.waitingForInit = (this.waitingForInit || 0) + 1;
        try {
            await (this.initializing || this.session.ready());
            this.active = this.session.active;
            if (this.disposed || generation !== this.generation) return;
            if (!this.active) {
                this.worker.postMessage(data);
                return;
            }
            if (this.busy) {
                this.emit({ type: 'processingBusy' });
                return;
            }
            this.busy = true;
            ownsTurn = true;
            this.filtering = true;
            this.emit({ type: 'processingStarted' });
            const input = { message: data.message, instructions: {}, extraBody: {} };
            if (!this.initialized) {
                for (const key of ['chatgpt_developer_messages', 'google_gemini_system_instruction', 'anthropic_system_prompt',
                    'ollama_system_prompt', 'anthropic_stop_sequences', 'chatgpt_text_format_schema_name',
                    'chatgpt_prompt_cache_key', 'chatgpt_safety_identifier']) {
                    if (this.initData[key]) input.instructions[key] = this.initData[key];
                }
                for (const key of ['chatgpt_extra_body', 'openai_comp_extra_body', 'google_gemini_extra_body',
                    'ollama_extra_options', 'chatgpt_text_format_schema']) {
                    if (this.initData[key]?.trim()) input.extraBody[key] = this.initData[key];
                }
            }
            const prepared = await this.session.onBeforeSendToProvider(input, { onProgress: progress => {
                if (generation === this.generation) this.emit({ type: 'processingProgress', payload: progress });
            } });
            if (generation !== this.generation || this.disposed) return;
            if (!this.initialized) {
                this.worker.postMessage({ ...this.initData, ...prepared.input.instructions, ...prepared.input.extraBody });
                this.initialized = true;
            }
            this.response = '';
            this.thinking = '';
            this.filtering = false;
            if (this.active) this.emit({ type: 'processingComplete' });
            this.worker.postMessage({ ...data, message: prepared.input.message });
        } catch (error) {
            if (generation === this.generation) {
                if (ownsTurn) this.busy = false;
                this.emit({ type: 'error', payload: error.message });
            }
        } finally {
            --this.waitingForInit;
            if (ownsTurn && generation === this.generation) {
                if (this.filtering) this.busy = false;
                this.filtering = false;
            }
        }
    }
    async receive(data) {
        if (this.disposed) return;
        if (data.type === 'requestAborted') {
            this.busy = false;
            this.response = ''; this.thinking = '';
            this.emit(data);
            return;
        }
        if (this.active && (data.type === 'newToken' || data.type === 'newThinkingToken')) {
            if (!this.response && !this.thinking) this.emit({ type: 'processingReceiving' });
            if (data.type === 'newToken') this.response += data.payload.token;
            else this.thinking += data.payload.token;
            return;
        }
        if (data.type === 'tokensDone' || data.type === 'error') {
            if (this.active) {
                const generation = this.generation;
                // Separate inline reasoning before any processor restores literals
                // such as <think> inside an original value.
                const split = stripThinkTags(this.response || '', true, this.format === 'json');
                this.postprocessing = true;
                let output;
                try {
                    output = await this.session.onAfterReceiveFromProvider({ content: split.text,
                        thinking: [this.thinking || (typeof data.payload?.thinking === 'string' ? data.payload.thinking : ''), split.thinking].filter(Boolean).join('\n'),
                        ...(data.type === 'error' ? { error: String(data.payload) } : {}) }, { format: this.format });
                } catch (error) {
                    if (generation === this.generation) throw error;
                } finally { this.postprocessing = false; }
                if (this.disposed || generation !== this.generation) {
                    return;
                }
                if (output.thinking) this.emit({ type: 'newThinkingToken', payload: { token: output.thinking } });
                if (output.content) this.emit({ type: 'newToken', payload: { token: output.content, thinkingSeparated: true } });
                this.response = ''; this.thinking = '';
                if (data.type === 'error') data = { ...data, payload: output.error || data.payload };
                else data = { ...data, payload: { ...data.payload, thinking: output.thinking } };
            }
            this.busy = false;
        }
        this.emit(data);
    }
    terminate() {
        this.disposed = true;
        ++this.generation;
        this.worker.terminate();
        this.session.dispose();
    }
}
