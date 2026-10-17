import {
    integration_options_config,
    integration_content_fields
} from '../options/mzta-options-default.js';
import { pageProcessingClient } from './mzta-ai-processing-client.js';
import { processingError } from './mzta-ai-processing-protocol.js';
import { stripThinkTags } from './mzta-utils.js';

function contentInput(init, message) {
    const input = { message, instructions: {}, extraBody: {} };
    for (const [provider, options] of Object.entries(integration_options_config)) {
        const fields = integration_content_fields[provider];
        for (const [field, defaultValue] of Object.entries(options)) {
            const key = `${provider}_${field}`;
            if (typeof defaultValue !== 'string' || !Object.hasOwn(init, key)) {
                continue;
            }
            const groups = ['text', 'json', 'nonContent'].filter(group => fields?.[group]?.includes(field));
            if (groups.length !== 1) {
                throw processingError('ai_processing_unclassified_field');
            }
            const group = groups[0];
            const value = init[key];
            if (group === 'nonContent' || value == null || value === '') {
                continue;
            }
            if (typeof value !== 'string') {
                throw processingError('ai_processing_invalid_result');
            }
            input[group === 'text' ? 'instructions' : 'extraBody'][key] = value;
        }
    }
    return input;
}

// Discovery happens once, before construction. Inactive users get the actual
// provider Worker, not an adapter that has to emulate its behavior.
export async function createProviderWorker(path, { format = 'text', client = pageProcessingClient } = {}) {
    const session = client.createSession();
    try {
        await session.ready();
        if (!session.active) {
            await session.dispose();
            return new Worker(path, { type: 'module' });
        }
        return new ProcessingWorker(new Worker(path, { type: 'module' }), session, { format });
    } catch (error) {
        await session.dispose();
        throw error;
    }
}

// Active processing only. Providers retain prepared history; UI-only restored
// results never go back into that history. Status has its own callback, separate
// from the provider event stream. thinkingSeparated annotates restored content.
export class ProcessingWorker {
    constructor(worker, session, { format = 'text' } = {}) {
        this.worker = worker;
        this.session = session;
        this.format = format;
        this.generation = 0;
        this.receiveQueue = Promise.resolve();
        worker.onmessage = ({ data }) => {
            this.receiveQueue = this.receiveQueue.then(() => this.receive(data)).catch(error => {
                if (!this.disposed) {
                    this.busy = false;
                    this.emit({ type: 'error', payload: error.message });
                }
            });
        };
        worker.onerror = event => {
            if (this.disposed) return;
            this.busy = false;
            if (this.onerror) {
                this.onerror(event);
            } else {
                this.emit({ type: 'error', payload: event.message });
            }
        };
    }

    emit(data) {
        if (!this.disposed) this.onmessage?.({ data });
    }

    status(type, progress) {
        if (!this.disposed) this.onprocessingstatus?.({ type, progress });
    }

    postMessage(data) {
        if (this.disposed) return;
        if (data.type === 'init') {
            this.initData = data;
        } else if (data.type === 'chatMessage') {
            void this.send(data);
        } else if (data.type === 'stop' && (this.preparing || this.postprocessing)) {
            ++this.generation;
            this.session.cancel();
            this.busy = false;
            this.preparing = false;
            this.emit({ type: 'tokensDone' });
        } else {
            this.worker.postMessage(data);
        }
    }

    async send(data) {
        if (this.busy) {
            this.status('busy');
            return;
        }
        this.busy = true;
        this.preparing = true;
        const generation = ++this.generation;
        try {
            this.status('started');
            const input = this.initialized ? { message: data.message, instructions: {}, extraBody: {} } :
                contentInput(this.initData, data.message);
            const prepared = await this.session.onBeforeSendToProvider(input, {
                onProgress: progress => {
                    if (generation === this.generation) this.status('progress', progress);
                }
            });
            if (this.disposed || generation !== this.generation) return;
            if (!this.initialized) {
                this.worker.postMessage({ ...this.initData, ...prepared.input.instructions, ...prepared.input.extraBody });
                this.initialized = true;
            }
            this.response = '';
            this.thinking = '';
            this.preparing = false;
            this.status('complete');
            this.worker.postMessage({ ...data, message: prepared.input.message });
        } catch (error) {
            if (generation === this.generation) {
                this.busy = false;
                this.emit({ type: 'error', payload: error.message });
            }
        } finally {
            if (generation === this.generation) this.preparing = false;
        }
    }

    async receive(data) {
        if (this.disposed) return;
        if (data.type === 'requestAborted') {
            this.session.cancel();
            this.busy = false;
            this.response = '';
            this.thinking = '';
        } else if (data.type === 'newToken' || data.type === 'newThinkingToken') {
            if (!this.response && !this.thinking) this.status('receiving');
            if (data.type === 'newToken') this.response += data.payload.token;
            else this.thinking += data.payload.token;
            return;
        } else if (data.type === 'tokensDone' || data.type === 'error') {
            const generation = this.generation;
            const split = stripThinkTags(this.response || '', true, this.format === 'json');
            const thinking = this.thinking || data.payload?.thinking || '';
            this.postprocessing = true;
            let output;
            try {
                output = await this.session.onAfterReceiveFromProvider({
                    content: split.text,
                    thinking: [thinking, split.thinking].filter(Boolean).join('\n'),
                    ...(data.type === 'error' ? { error: String(data.payload) } : {})
                }, { format: this.format });
            } catch (error) {
                if (generation === this.generation) throw error;
            } finally {
                this.postprocessing = false;
            }
            if (this.disposed || generation !== this.generation) return;
            if (output.thinking) this.emit({ type: 'newThinkingToken', payload: { token: output.thinking } });
            if (output.content) this.emit({ type: 'newToken', payload: { token: output.content, thinkingSeparated: true } });
            this.response = '';
            this.thinking = '';
            this.busy = false;
            data = data.type === 'error' ? { ...data, payload: output.error || data.payload } :
                { ...data, payload: { ...data.payload, thinking: output.thinking } };
        }
        this.emit(data);
    }

    terminate() {
        this.disposed = true;
        ++this.generation;
        this.worker.terminate();
        void this.session.dispose();
    }
}
