// Session facade with an explicit transport. No listeners run at import time.
import { processingError } from './mzta-ai-processing-protocol.js';

export function createRuntimeProcessingTransport() {
    const progressCalls = new Map();
    function onMessage(message, sender) {
        if (sender.id === browser.runtime.id && message?.command === 'ai_processing_progress') {
            progressCalls.get(message.callId)?.(message.progress);
        }
    }
    return async (operation, data, onProgress) => {
        if (onProgress) {
            if (progressCalls.size === 0) {
                browser.runtime.onMessage.addListener(onMessage);
            }
            progressCalls.set(data.callId, onProgress);
        }
        try {
            return await browser.runtime.sendMessage({ command: 'ai_processing', operation, data });
        } finally {
            if (onProgress) {
                progressCalls.delete(data.callId);
                if (progressCalls.size === 0) {
                    browser.runtime.onMessage.removeListener(onMessage);
                }
            }
        }
    };
}

export function createAIProcessingClient(transport = createRuntimeProcessingTransport()) {
    function createSession({ required = false } = {}) {
        const sessionId = crypto.randomUUID();
        const inFlight = new Set();
        let ready;
        let disposed = false;
        let generation = 0;
        let request;
        let hookInFlight = false;

        async function call(operation, payload = {}, onProgress) {
            const callId = crypto.randomUUID();
            inFlight.add(callId);
            try {
                return await transport(operation, { sessionId, callId, ...payload }, onProgress);
            } finally {
                inFlight.delete(callId);
            }
        }

        // One session owns one request/context at a time. after may be called
        // again for Web selections of the same reply, but hooks never overlap.
        async function runHook(work) {
            if (hookInFlight) {
                throw processingError('ai_processing_busy');
            }
            hookInFlight = true;
            const current = generation;
            try {
                await session.ready();
                assertCurrent(current);
                const result = await work(current);
                assertCurrent(current);
                return result;
            } finally {
                hookInFlight = false;
            }
        }

        function assertCurrent(current) {
            if (disposed || current !== generation) {
                throw processingError('ai_processing_cancelled');
            }
        }

        const session = {
            active: false,
            async ready() {
                if (disposed) {
                    throw processingError('ai_processing_session_expired');
                }
                ready ??= call('createSession', { required }).then(result => {
                    session.active = result.active;
                });
                await ready;
                if (disposed) {
                    throw processingError('ai_processing_session_expired');
                }
                return session;
            },
            onBeforeSendToProvider(input, { onProgress } = {}) {
                return runHook(async current => {
                    if (session.active && request?.pending) {
                        throw processingError('ai_processing_busy');
                    }
                    const next = { requestId: crypto.randomUUID() };
                    // Invalidate the previous context even if preparation fails.
                    request = undefined;
                    const result = await call('before', {
                        input,
                        payload: { input, requestId: next.requestId }
                    }, onProgress);
                    assertCurrent(current);
                    request = { ...next, context: result.context, pending: true };
                    return result;
                });
            },
            onAfterReceiveFromProvider(output, { format = 'text', onProgress } = {}) {
                return runHook(async () => {
                    if (session.active && !request) {
                        throw processingError('ai_processing_session_expired');
                    }
                    const currentRequest = request;
                    try {
                        const result = await call('after', {
                            output,
                            payload: {
                                output,
                                format,
                                requestId: currentRequest?.requestId,
                                context: currentRequest?.context
                            }
                        }, onProgress);
                        return result.output;
                    } finally {
                        if (currentRequest) currentRequest.pending = false;
                    }
                });
            },
            cancel() {
                ++generation;
                request = undefined;
                for (const targetCallId of [...inFlight]) {
                    void call('cancel', { targetCallId }).catch(() => {});
                }
            },
            dispose() {
                if (disposed) {
                    return Promise.resolve();
                }
                disposed = true;
                session.cancel();
                return ready ? ready.then(() => call('disposeSession')).catch(() => {}) : Promise.resolve();
            }
        };
        return session;
    }

    return {
        createSession,
        getStatus() {
            return transport('status', { callId: crypto.randomUUID() });
        },
        probe() {
            return transport('probe', { callId: crypto.randomUUID() });
        },
        downloadModel() {
            return transport('downloadModel', { callId: crypto.randomUUID() });
        },
        openSettings() {
            return transport('openSettings', { callId: crypto.randomUUID() });
        }
    };
}

// Page-side default. Background consumers explicitly inject broker.dispatch.
export const pageProcessingClient = createAIProcessingClient();
