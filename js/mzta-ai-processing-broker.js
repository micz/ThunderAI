// Background-only trust boundary. Importing this module registers no listeners.
import { mztaPrefs } from './mzta-prefs.js';
import { mztaManaged } from './mzta-managed.js';
import {
    AI_PROCESSOR_ID,
    AI_PROCESSING_PROTOCOL,
    processingError
} from './mzta-ai-processing-protocol.js';

// The one activation switch, shared with the companion's settings page through
// aiProcessing.getSetting / setSetting / settingChanged.
const ENABLED_PREF = 'ai_processing_enabled';
// Policy-oriented, no UI: ask the companion to download its model when it is not ready.
const AUTODOWNLOAD_PREF = 'ai_processing_model_autodownload';
const NO_PROGRESS = () => {};

function validateStatus(status) {
    if (!status?.ok ||
        status.protocol !== AI_PROCESSING_PROTOCOL ||
        typeof status.instanceId !== 'string' ||
        typeof status.ready !== 'boolean' ||
        typeof status.downloading !== 'boolean') {
        throw processingError('ai_processing_incompatible');
    }
}

// What the options page shows about the companion's model.
function modelFields(status) {
    return {
        ready: status.ready,
        downloading: status.downloading,
        progress: Number.isFinite(status.progress) ? status.progress : null,
        error: typeof status.error === 'string' ? status.error : null
    };
}

async function settingState() {
    const enabled = await mztaPrefs.getPref(ENABLED_PREF) === true;
    return { enabled, locked: mztaManaged.isManagedLocked(ENABLED_PREF) };
}

function hello() {
    let timer;
    return Promise.race([
        browser.runtime.sendMessage(AI_PROCESSOR_ID, {
            action: 'aiProcessing.hello',
            protocol: AI_PROCESSING_PROTOCOL
        }),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(processingError('ai_processing_timeout')), 5000);
        })
    ]).finally(() => clearTimeout(timer));
}

function validateInput(input, original) {
    if (typeof input?.message !== 'string') {
        throw processingError('ai_processing_invalid_result');
    }
    for (const group of ['instructions', 'extraBody']) {
        const values = input[group];
        const keys = Object.keys(original[group] || {});
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
            throw processingError('ai_processing_invalid_result');
        }
        if (Object.keys(values).length !== keys.length) {
            throw processingError('ai_processing_invalid_result');
        }
        for (const [key, value] of Object.entries(values)) {
            if (!Object.hasOwn(original[group] || {}, key) || typeof value !== 'string') {
                throw processingError('ai_processing_invalid_result');
            }
        }
    }
    return input;
}

export function createAIProcessingBroker() {
    const sessions = new Map();
    const pending = new Map();
    // whenLoaded(), not managedReady(): the background creates the broker before it
    // loads the policy, and managedReady() there would hydrate from itself. Every
    // preference read below waits for this, external messages included.
    const ready = mztaManaged.whenLoaded();

    // Switched off, the companion is never contacted. Switched on, a missing, slow
    // or incompatible companion blocks: uninstalling it is not consent to bypass.
    async function discover() {
        if (!(await settingState()).enabled) {
            return { enabled: false };
        }
        let status;
        try {
            status = await hello();
        } catch (error) {
            if (error.code === 'ai_processing_timeout') {
                throw error;
            }
            throw processingError('ai_processing_unavailable');
        }
        validateStatus(status);
        return { ...status, enabled: true };
    }

    // For the settings page, whatever the switch: is a compatible companion installed?
    async function probe() {
        let status;
        try {
            status = await hello();
        } catch {
            return { installed: false, compatible: false };
        }
        try {
            validateStatus(status);
        } catch {
            return { installed: true, compatible: false };
        }
        return { installed: true, compatible: true, version: status.version, ...modelFields(status) };
    }

    // A short request to the companion outside any session (options page buttons,
    // autodownload). Bounded like discovery.
    async function ask(action) {
        let timer;
        let reply;
        try {
            reply = await Promise.race([
                browser.runtime.sendMessage(AI_PROCESSOR_ID, { action, protocol: AI_PROCESSING_PROTOCOL }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(processingError('ai_processing_timeout')), 5000);
                })
            ]);
        } catch (error) {
            throw error.code === 'ai_processing_timeout' ? error : processingError('ai_processing_unavailable');
        } finally {
            clearTimeout(timer);
        }
        if (!reply?.ok) {
            throw new Error(reply?.error?.message || browser.i18n.getMessage('ai_processing_failed'));
        }
        return reply;
    }

    // One attempt per companion instance: a failed download is not retried in a loop,
    // only when the companion (or ThunderAI) starts again. A model that became ready
    // and was then lost (an evicted cache) gets a new attempt.
    const autodownloaded = new Set();
    async function autodownload(status) {
        if (status.ready) {
            autodownloaded.delete(status.instanceId);
            return;
        }
        if (status.downloading || autodownloaded.has(status.instanceId) ||
            await mztaPrefs.getPref(AUTODOWNLOAD_PREF) !== true) {
            return;
        }
        autodownloaded.add(status.instanceId);
        await ask('aiProcessing.downloadModel');
    }
    async function autodownloadAtStartup() {
        if (await mztaPrefs.getPref(AUTODOWNLOAD_PREF) !== true) {
            return;
        }
        const status = await hello();
        validateStatus(status);
        await autodownload(status);
    }

    function notify(message) {
        void browser.runtime.sendMessage(AI_PROCESSOR_ID, message).catch(NO_PROGRESS);
    }

    async function remote(operation, record, payload, callId, onProgress) {
        const prefs = await mztaPrefs.getPrefs(['special_command_timeout']);
        const configured = prefs.special_command_timeout;
        const timeout = Number.isFinite(configured) && configured > 0 ? configured : 120000;
        const message = {
            action: `aiProcessing.${operation}`,
            protocol: AI_PROCESSING_PROTOCOL,
            instanceId: record.instanceId,
            sessionId: record.sessionId,
            callId,
            ...payload
        };
        const cancel = () => notify({ ...message, action: 'aiProcessing.cancel' });
        let timer;
        try {
            const reply = await new Promise((resolve, reject) => {
                const renew = () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        cancel();
                        reject(processingError('ai_processing_timeout'));
                    }, timeout);
                };
                pending.set(callId, {
                    record,
                    requestId: payload.requestId,
                    phases: new Map(),
                    renew,
                    onProgress,
                    cancel() {
                        cancel();
                        reject(processingError('ai_processing_cancelled'));
                    }
                });
                renew();
                browser.runtime.sendMessage(AI_PROCESSOR_ID, message).then(resolve, () => {
                    reject(processingError('ai_processing_unavailable'));
                });
            });
            if (!reply?.ok) {
                throw new Error(reply?.error?.message || browser.i18n.getMessage('ai_processing_failed'));
            }
            if (reply.protocol !== AI_PROCESSING_PROTOCOL ||
                reply.instanceId !== record.instanceId ||
                reply.callId !== callId) {
                throw processingError('ai_processing_incompatible');
            }
            return reply;
        } finally {
            clearTimeout(timer);
            pending.delete(callId);
        }
    }

    async function dispatch(operation, data, onProgress = NO_PROGRESS, ownerTabId) {
        await ready;
        if (operation === 'status') {
            return discover();
        }
        if (operation === 'probe') {
            return probe();
        }
        if (operation === 'downloadModel') {
            return modelFields(await ask('aiProcessing.downloadModel'));
        }
        if (operation === 'openSettings') {
            await ask('aiProcessing.openSettings');
            return {};
        }
        if (operation === 'createSession') {
            const status = await discover();
            if (data.required && !status.enabled) {
                throw processingError('ai_processing_unavailable');
            }
            const record = {
                sessionId: data.sessionId,
                active: status.enabled,
                instanceId: status.instanceId,
                ownerTabId
            };
            sessions.set(record.sessionId, record);
            try {
                if (record.active) {
                    await remote(operation, record, {}, data.callId, onProgress);
                }
            } catch (error) {
                sessions.delete(record.sessionId);
                notify({
                    action: 'aiProcessing.disposeSession',
                    protocol: AI_PROCESSING_PROTOCOL,
                    instanceId: record.instanceId,
                    sessionId: record.sessionId,
                    callId: crypto.randomUUID()
                });
                throw error;
            }
            return { active: record.active };
        }
        const record = sessions.get(data.sessionId);
        if (!record) {
            throw processingError('ai_processing_session_expired');
        }
        if (operation === 'cancel') {
            const entry = pending.get(data.targetCallId);
            if (entry?.record === record) {
                entry.cancel();
            }
            return {};
        }
        if (operation === 'disposeSession') {
            sessions.delete(record.sessionId);
            for (const entry of pending.values()) {
                if (entry.record === record) {
                    entry.cancel();
                }
            }
            if (record.active) {
                void remote(operation, record, {}, data.callId, NO_PROGRESS).catch(NO_PROGRESS);
            }
            return {};
        }
        if (!record.active) {
            if (operation === 'before') return { input: data.input, context: null };
            if (operation === 'after') return { output: data.output };
            return {};
        }
        const reply = await remote(operation, record, data.payload, data.callId, onProgress);
        if (operation === 'before') {
            if (reply.context == null) {
                throw processingError('ai_processing_invalid_result');
            }
            return { input: validateInput(reply.input, data.payload.input), context: reply.context };
        }
        if (operation === 'after') {
            const output = reply.output;
            if (typeof output?.content !== 'string' ||
                typeof output?.thinking !== 'string' ||
                (output.error != null && typeof output.error !== 'string')) {
                throw processingError('ai_processing_invalid_result');
            }
            return { output };
        }
        return {};
    }

    function onMessage(message, sender) {
        if (message?.command !== 'ai_processing') {
            return;
        }
        if (sender.id !== browser.runtime.id ||
            !sender.url?.startsWith(browser.runtime.getURL(''))) {
            return Promise.reject(processingError('ai_processing_invalid_sender'));
        }
        return dispatch(message.operation, message.data, progress => {
            void browser.runtime.sendMessage({
                command: 'ai_processing_progress',
                callId: message.data.callId,
                progress
            }).catch(NO_PROGRESS);
        }, sender.tab?.id);
    }

    function onExternalMessage(message, sender) {
        if (typeof message?.action !== 'string' || !message.action.startsWith('aiProcessing.')) {
            return;
        }
        if (sender.id !== AI_PROCESSOR_ID) {
            return Promise.resolve({ ok: false });
        }
        if (message.protocol !== AI_PROCESSING_PROTOCOL) {
            return Promise.resolve({ ok: false });
        }
        if (message.action === 'aiProcessing.getSetting') {
            return ready.then(settingState).then(state => ({ ok: true, protocol: AI_PROCESSING_PROTOCOL, ...state }));
        }
        if (message.action === 'aiProcessing.setSetting') {
            return ready.then(() => setSetting(message.enabled));
        }
        // Sent at companion startup and whenever its model changes (download progress,
        // completion, deletion): refresh open pages, and the autodownload policy.
        if (message.action === 'aiProcessing.readinessChanged') {
            try {
                validateStatus({ ...message, ok: true });
            } catch {
                return Promise.resolve({ ok: false });
            }
            void browser.runtime.sendMessage({
                command: 'ai_processing_readiness',
                ...modelFields(message)
            }).catch(NO_PROGRESS);
            void ready.then(() => autodownload(message)).catch(error => {
                console.warn('[ThunderAI] ThunderAI Privacy model autodownload failed:', error.message);
            });
            return Promise.resolve({ ok: true, protocol: AI_PROCESSING_PROTOCOL });
        }
        if (message.action === 'aiProcessing.progress') {
            const entry = pending.get(message.callId);
            const progress = message.progress;
            if (!entry ||
                message.instanceId !== entry.record.instanceId ||
                message.sessionId !== entry.record.sessionId ||
                message.requestId !== entry.requestId ||
                !Number.isInteger(progress?.current) ||
                !Number.isInteger(progress?.total) ||
                progress.current <= 0 ||
                progress.current > progress.total ||
                progress.total > 1000000) {
                return Promise.resolve({ ok: false });
            }
            const phase = String(progress.phase || '').slice(0, 128);
            if (progress.current > (entry.phases.get(phase) || 0)) {
                entry.phases.set(phase, progress.current);
                entry.renew();
                entry.onProgress(progress);
            }
            return Promise.resolve({ ok: true });
        }
    }

    // The companion's settings page writes the switch through here. Its own
    // readiness (platform, model) is checked there before it asks to enable.
    async function setSetting(enabled) {
        if (typeof enabled !== 'boolean') {
            return { ok: false, error: { code: 'ai_processing_invalid_request' } };
        }
        if ((await settingState()).locked) {
            const error = processingError('ai_processing_setting_locked');
            return { ok: false, error: { code: error.code, message: error.message } };
        }
        await mztaPrefs.setPref(ENABLED_PREF, enabled);
        return { ok: true, protocol: AI_PROCESSING_PROTOCOL, ...await settingState() };
    }

    // Every writer (options page, companion, settings import) reaches storage, so the
    // companion's mirror of the switch is refreshed from here.
    function onStorageChanged(changes, area) {
        if (area !== 'local' || !Object.hasOwn(changes, ENABLED_PREF)) {
            return;
        }
        void ready.then(settingState).then(state => notify({
            action: 'aiProcessing.settingChanged',
            protocol: AI_PROCESSING_PROTOCOL,
            ...state
        })).catch(NO_PROGRESS);
    }

    function onTabRemoved(tabId) {
        for (const record of sessions.values()) {
            if (record.ownerTabId === tabId) {
                void dispatch('disposeSession', {
                    sessionId: record.sessionId,
                    callId: crypto.randomUUID()
                }).catch(NO_PROGRESS);
            }
        }
    }

    browser.runtime.onMessage.addListener(onMessage);
    browser.runtime.onMessageExternal.addListener(onExternalMessage);
    browser.tabs.onRemoved.addListener(onTabRemoved);
    browser.storage.onChanged.addListener(onStorageChanged);
    // A companion that started first announced itself before this listener existed.
    void ready.then(autodownloadAtStartup).catch(NO_PROGRESS);
    return {
        ready,
        dispatch,
        dispose() {
            browser.runtime.onMessage.removeListener(onMessage);
            browser.runtime.onMessageExternal.removeListener(onExternalMessage);
            browser.tabs.onRemoved.removeListener(onTabRemoved);
            browser.storage.onChanged.removeListener(onStorageChanged);
            for (const entry of pending.values()) {
                entry.cancel();
            }
        }
    };
}
