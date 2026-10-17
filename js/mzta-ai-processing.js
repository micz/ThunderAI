// Versioned, content-only companion hooks. No models, mappings or privacy settings.
import { mztaPrefs } from './mzta-prefs.js';
export const AI_PROCESSOR_ID = 'thunderai-privacy@micz.it';
export const AI_PROCESSING_PROTOCOL = 1;
const STATE_KEY = 'aiProcessingRegistration';
const sessions = new Map();
const pending = new Map();
const listeners = new Map();
let localDispatch;
let expected = false;
let absentUntil = 0;

function failure(message) { return new Error(browser.i18n.getMessage(message) || message); }
function validateStatus(status) {
    if (!status?.ok || status.protocol !== AI_PROCESSING_PROTOCOL ||
        typeof status.instanceId !== 'string' || typeof status.enabled !== 'boolean') {
        throw failure('ai_processing_incompatible');
    }
    return status;
}
async function remember(enabled) {
    absentUntil = 0;
    expected = enabled;
    await browser.storage.local.set({ [STATE_KEY]: { expected: enabled } });
}
async function discover() {
    if (!expected && Date.now() < absentUntil) return { enabled: false };
    let status;
    let timer;
    try { status = await Promise.race([
        browser.runtime.sendMessage(AI_PROCESSOR_ID, { action: 'aiProcessing.hello', protocol: AI_PROCESSING_PROTOCOL }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(failure('ai_processing_timeout')), 5000); }),
    ]); }
    catch (error) {
        if (error.message === browser.i18n.getMessage('ai_processing_timeout')) throw error;
        if (expected) throw failure('ai_processing_unavailable');
        absentUntil = Date.now() + 2000;
        return { enabled: false };
    }
    finally { clearTimeout(timer); }
    // Never treat an active or previously active processor as an optional,
    // incompatible add-on. Only a never-enabled legacy/inactive one may be ignored.
    if (status?.enabled === true) await remember(true);
    try { validateStatus(status); }
    catch (error) {
        if (expected) throw error;
        console.warn('[ThunderAI] Ignoring an incompatible inactive content processor.');
        return { enabled: false };
    }
    await remember(status.enabled);
    return status;
}

async function remote(operation, record, payload, callId, onProgress) {
    const { special_command_timeout: configured } = await mztaPrefs.getPrefs(['special_command_timeout']);
    const timeout = Number.isFinite(configured) && configured > 0 ? configured : 120000;
    let timer;
    const message = { action: `aiProcessing.${operation}`, protocol: AI_PROCESSING_PROTOCOL,
        instanceId: record.instanceId, sessionId: record.sessionId, callId, ...payload };
    const cancel = () => {
        void browser.runtime.sendMessage(AI_PROCESSOR_ID, { ...message, action: 'aiProcessing.cancel' }).catch(() => {});
    };
    try {
        const reply = await new Promise((resolve, reject) => {
            const renew = () => {
                clearTimeout(timer);
                // Waiting for a person to complete a companion form is not a stalled hook.
                if (operation === 'collectInput') return;
                timer = setTimeout(() => { cancel(); reject(failure('ai_processing_timeout')); }, timeout);
            };
            pending.set(callId, { record, requestId: payload.requestId, renew, onProgress,
                phases: new Map(), cancel: () => { cancel(); reject(failure('ai_processing_cancelled')); } });
            renew();
            browser.runtime.sendMessage(AI_PROCESSOR_ID, message).then(resolve, () => reject(failure('ai_processing_unavailable')));
        });
        if (!reply?.ok) throw new Error(reply?.error?.message || browser.i18n.getMessage('ai_processing_failed'));
        if (reply.protocol !== AI_PROCESSING_PROTOCOL || reply.instanceId !== record.instanceId || reply.callId !== callId) {
            throw failure('ai_processing_incompatible');
        }
        return reply;
    } finally { clearTimeout(timer); pending.delete(callId); }
}

function validateInput(input, original) {
    if (typeof input?.message !== 'string') throw failure('ai_processing_invalid_result');
    for (const group of ['instructions', 'extraBody']) {
        if (!input[group] || typeof input[group] !== 'object' || Array.isArray(input[group])) throw failure('ai_processing_invalid_result');
        if (Object.keys(input[group]).length !== Object.keys(original[group] || {}).length) throw failure('ai_processing_invalid_result');
        for (const [key, value] of Object.entries(input[group])) {
            if (!Object.hasOwn(original[group] || {}, key) || typeof value !== 'string') throw failure('ai_processing_invalid_result');
        }
    }
    return input;
}

async function broker(operation, data, onProgress, ownerTabId) {
    if (operation === 'status') return discover();
    if (operation === 'createSession') {
        const status = await discover();
        if (data.required && !status.enabled) throw failure('ai_processing_unavailable');
        const record = { sessionId: data.sessionId, active: status.enabled, instanceId: status.instanceId, ownerTabId };
        sessions.set(record.sessionId, record);
        try {
            if (record.active) await remote('createSession', record, {}, data.callId, onProgress);
        } catch (error) {
            sessions.delete(record.sessionId);
            void browser.runtime.sendMessage(AI_PROCESSOR_ID, { action: 'aiProcessing.disposeSession',
                protocol: AI_PROCESSING_PROTOCOL, instanceId: record.instanceId, sessionId: record.sessionId,
                callId: crypto.randomUUID() }).catch(() => {});
            throw error;
        }
        return { active: record.active };
    }
    const record = sessions.get(data.sessionId);
    if (!record) throw failure('ai_processing_session_expired');
    if (operation === 'cancel') {
        const entry = pending.get(data.targetCallId);
        if (entry?.record === record) entry.cancel();
        return {};
    }
    if (operation === 'disposeSession') {
        sessions.delete(record.sessionId);
        for (const entry of pending.values()) if (entry.record === record) entry.cancel();
        if (record.active) void remote('disposeSession', record, {}, data.callId, () => {}).catch(() => {});
        return {};
    }
    if (!record.active) {
        if (operation === 'before') return { input: data.input, context: null };
        if (operation === 'after') return { output: data.output };
        return {};
    }
    const reply = await remote(operation, record, data.payload, data.callId, onProgress);
    if (operation === 'collectInput') {
        if (!Array.isArray(reply.values) || reply.values.length !== data.payload.fields.length ||
            reply.values.some(value => typeof value !== 'string')) throw failure('ai_processing_invalid_result');
        return { values: reply.values };
    }
    if (operation === 'before') {
        if (reply.context == null) throw failure('ai_processing_invalid_result');
        return { input: validateInput(reply.input, data.payload.input), context: reply.context };
    }
    if (operation === 'after') {
        if (typeof reply.output?.content !== 'string' || typeof reply.output?.thinking !== 'string' ||
            (reply.output.error != null && typeof reply.output.error !== 'string')) throw failure('ai_processing_invalid_result');
        return { output: reply.output };
    }
    return {};
}

export function initializeAIProcessing() {
    const ready = browser.storage.local.get(STATE_KEY).then(data => { expected = !!data[STATE_KEY]?.expected; });
    localDispatch = async (operation, data, onProgress) => { await ready; return broker(operation, data, onProgress); };
    browser.runtime.onMessage.addListener((message, sender) => {
        if (message?.command !== 'ai_processing') return;
        if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(''))) {
            return Promise.reject(failure('ai_processing_invalid_sender'));
        }
        return ready.then(() => broker(message.operation, message.data, progress => {
            void browser.runtime.sendMessage({ command: 'ai_processing_progress', callId: message.data.callId, progress }).catch(() => {});
        }, sender.tab?.id));
    });
    browser.runtime.onMessageExternal.addListener((message, sender) => {
        if (!message?.action?.startsWith('aiProcessing.')) return;
        if (sender.id !== AI_PROCESSOR_ID) return Promise.resolve({ ok: false });
        if (message.action === 'aiProcessing.register') return ready.then(async () => {
            if (message.enabled === true) await remember(true);
            validateStatus({ ...message, ok: true });
            await remember(message.enabled);
            return { ok: true, protocol: AI_PROCESSING_PROTOCOL };
        });
        if (message.protocol !== AI_PROCESSING_PROTOCOL) return Promise.resolve({ ok: false });
        if (message.action === 'aiProcessing.progress') {
            const entry = pending.get(message.callId);
            const progress = message.progress;
            if (entry && message.instanceId === entry.record.instanceId && message.sessionId === entry.record.sessionId &&
                message.requestId === entry.requestId && Number.isInteger(progress?.current) && Number.isInteger(progress?.total) &&
                progress.current > 0 && progress.current <= progress.total && progress.total <= 1000000) {
                const phase = String(progress.phase || '').slice(0, 128);
                if (progress.current > (entry.phases.get(phase) || 0)) {
                    entry.phases.set(phase, progress.current);
                    entry.renew();
                    entry.onProgress(progress);
                }
            }
            return Promise.resolve({ ok: true });
        }
    });
    browser.tabs.onRemoved.addListener(tabId => {
        for (const record of sessions.values()) if (record.ownerTabId === tabId) {
            void localDispatch('disposeSession', { sessionId: record.sessionId, callId: crypto.randomUUID() }, () => {}).catch(() => {});
        }
    });
    return ready;
}

browser.runtime.onMessage.addListener(message => {
    if (message?.command === 'ai_processing_progress') listeners.get(message.callId)?.(message.progress);
});
async function dispatch(operation, data, onProgress = () => {}) {
    if (localDispatch) return localDispatch(operation, data, onProgress);
    listeners.set(data.callId, onProgress);
    try { return await browser.runtime.sendMessage({ command: 'ai_processing', operation, data }); }
    finally { listeners.delete(data.callId); }
}
export const getAIProcessingStatus = () => dispatch('status', { callId: crypto.randomUUID() });

export function createAIProcessingSession({ required = false } = {}) {
    const sessionId = crypto.randomUUID();
    const inFlight = new Set();
    let ready, disposed = false, generation = 0, requestId, context;
    const call = async (operation, payload = {}, onProgress) => {
        const callId = crypto.randomUUID();
        inFlight.add(callId);
        try { return await dispatch(operation, { sessionId, callId, ...payload }, onProgress); }
        finally { inFlight.delete(callId); }
    };
    const session = {
        active: false,
        async ready() {
            if (disposed) throw failure('ai_processing_session_expired');
            ready ??= call('createSession', { required }).then(result => { Object.assign(session, result); });
            await ready;
            if (disposed) throw failure('ai_processing_session_expired');
            return session;
        },
        async onBeforeSendToProvider(input, { onProgress } = {}) {
            const current = generation;
            await session.ready();
            if (current !== generation) throw failure('ai_processing_cancelled');
            requestId = crypto.randomUUID();
            const result = await call('before', { input, payload: { input, requestId } }, onProgress);
            if (disposed || current !== generation) throw failure('ai_processing_cancelled');
            context = result.context;
            return result;
        },
        async onAfterReceiveFromProvider(output, { format = 'text', view, onProgress } = {}) {
            const current = generation;
            await session.ready();
            if (current !== generation) throw failure('ai_processing_cancelled');
            const result = await call('after', { output, payload: { output, format, context, requestId, view } }, onProgress);
            if (disposed || current !== generation) throw failure('ai_processing_cancelled');
            return result.output;
        },
        async collectInput(fields) {
            const current = generation;
            await session.ready();
            if (!session.active || current !== generation) throw failure('ai_processing_cancelled');
            const result = await call('collectInput', { payload: { fields, requestId: crypto.randomUUID() } });
            if (disposed || current !== generation) throw failure('ai_processing_cancelled');
            return result.values;
        },
        cancel() {
            ++generation;
            for (const targetCallId of inFlight) void dispatch('cancel', { sessionId, callId: crypto.randomUUID(), targetCallId }).catch(() => {});
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            session.cancel();
            if (ready) void ready.then(() => call('disposeSession')).catch(() => {});
        },
    };
    return session;
}
