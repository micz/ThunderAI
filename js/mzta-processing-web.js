import {
    convertNewlinesToParagraphs,
    stripHtmlKeepLines
} from './mzta-utils.js';

// Owned by the background page. Originals never enter ChatGPT's DOM or history.
const sessions = new Map();

export function registerProcessingWeb(tabId, options, client) {
    disposeProcessingWeb(tabId);
    sessions.set(tabId, { ...options, tabId, session: client.createSession({ required: true }) });
}

function getSession(sender) {
    const entry = sessions.get(sender.tab?.id);
    const url = new URL(sender.url || sender.tab?.url || 'about:blank');
    if (!entry || url.protocol !== 'https:' ||
        !(url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) || sender.frameId > 0) {
        throw new Error(browser.i18n.getMessage('ai_processing_session_expired'));
    }
    return entry;
}

export function disposeProcessingWeb(tabId) {
    const entry = sessions.get(tabId);
    if (!entry) return;
    sessions.delete(tabId);
    entry.disposed = true;
    entry.session.dispose();
}

async function getCustomText(entry) {
    const fields = entry.customTextArray?.length ? entry.customTextArray :
        [{ placeholder: '{%additional_text%}', info: '' }];
    const notify = waitingForInput => browser.tabs.sendMessage(entry.tabId,
        { command: 'processing_web_status', waitingForInput }).catch(() => {});
    void notify(true);
    try {
        const values = await entry.session.collectInput(fields.map(({ info }) => ({ info: info || '' })));
        return fields.map((field, index) => ({ ...field, custom_text: values[index] }));
    } finally { void notify(false); }
}

async function preparePrompt(entry) {
    entry.progress = undefined;
    let prompt = entry.prompt;
    if (entry.needCustomText) {
        const fields = await getCustomText(entry);
        let replaced = false;
        for (const field of fields) {
            if (!prompt.includes(field.placeholder)) continue;
            replaced = true;
            prompt = prompt.split(field.placeholder).join(field.custom_text);
        }
        if (!replaced) prompt += ' ' + fields.map(field => field.custom_text).join(' ');
    }
    if (entry.disposed) throw new Error(browser.i18n.getMessage('ai_processing_cancelled'));
    const prepared = await entry.session.onBeforeSendToProvider({ message: prompt, instructions: {}, extraBody: {} }, { onProgress: progress => {
        entry.progress = progress;
        if (!entry.disposed) void browser.tabs.sendMessage(entry.tabId,
            { command: 'processing_web_status', progress }).catch(() => {});
    } });
    if (entry.disposed) throw new Error(browser.i18n.getMessage('ai_processing_cancelled'));
    return convertNewlinesToParagraphs(prepared.input.message);
}

export async function processWebAction(message, sender) {
    if (!sessions.has(sender.tab?.id) && !message.processingActive) return message;
    const entry = getSession(sender);
    const output = await entry.session.onAfterReceiveFromProvider({ content: message.text, thinking: '' }, { format: 'html' });
    return { ...message, text: output.content,
        tabId: entry.targetTabId, mailMessageId: entry.mailMessageId };
}

export async function handleProcessingWebMessage(message, sender) {
    try {
        const entry = getSession(sender);
        if (message.command === 'processing_web_prompt') {
            entry.prepared ??= preparePrompt(entry).catch(error => {
                entry.prepared = null;
                throw error;
            });
            return { ok: true, text: await entry.prepared };
        }
        if (message.command === 'processing_web_view') {
            if (typeof message.text !== 'string' || !message.text.trim()) {
                throw new Error(browser.i18n.getMessage('chatgpt_win_job_completed_select'));
            }
            await entry.session.onAfterReceiveFromProvider({ content: stripHtmlKeepLines(message.text), thinking: '' },
                { view: { original: entry.originalText || '', diff: !!message.diff } });
            return { ok: true };
        }
        throw new Error('Unknown processing operation');
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

browser.tabs.onRemoved.addListener(disposeProcessingWeb);
browser.tabs.onUpdated.addListener((tabId, change) => {
    if (sessions.has(tabId) && change.status === 'loading') disposeProcessingWeb(tabId);
});
