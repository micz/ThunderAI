/* ThunderAI — Claude Web connection, GPL-3.0-or-later. */

const calls = new Map();
const tabs = new Map();
let registration;

function isClaudeTab(sender) {
    if (!sender.tab || sender.frameId !== 0) return false;
    try {
        return new URL(sender.url).origin === 'https://claude.ai';
    } catch {
        return false;
    }
}

export function getClaudeWebCall(sender) {
    if (!isClaudeTab(sender)) return undefined;
    const call = tabs.get(sender.tab.id);
    return call?.windowId === sender.tab.windowId ? call : undefined;
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (message.command !== 'claude_web_get_prompt' || !isClaudeTab(sender)) return false;
    const initial = tabs.get(sender.tab.id) || calls.get(message.callId);
    if (!initial && !calls.size) return false;
    // Login redirects can drop the query parameter before windows.create/query
    // finish. Wait for binding, then still authorize solely by tab and window.
    const ready = initial ? initial.ready : Promise.allSettled([...calls.values()].map(call => call.ready));
    return ready.then(() => {
        const call = getClaudeWebCall(sender);
        if (!call || (initial && call !== initial)) return null;
        // A full navigation after sending must never submit the same email twice.
        return { ...call.payload, submitted: call.submitted };
    });
});

browser.runtime.onMessage.addListener((message, sender) => {
    if (message.command !== 'claude_web_mark_submitted') return false;
    const call = getClaudeWebCall(sender);
    if (!call || call.submitted) return false;
    call.submitted = true;
    return Promise.resolve(true);
});

browser.tabs.onRemoved.addListener(tabId => {
    const call = tabs.get(tabId);
    if (!call) return;
    tabs.delete(tabId);
    calls.delete(call.id);
});

export async function openClaudeWeb(windowOptions, payload) {
    // Register only after the explicit optional host permission was granted.
    // Unlike a static manifest match, this does not add install-time access.
    if (!registration) {
        registration = browser.contentScripts.register({
            matches: ['https://claude.ai/*'],
            js: [{ file: 'js/mzta-claude-web.js' }],
            runAt: 'document_start'
        }).catch(error => { registration = null; throw error; });
    }
    await registration;
    const id = crypto.randomUUID();
    const call = { id, payload, submitted: false };
    calls.set(id, call);
    call.ready = browser.windows.create({
        ...windowOptions,
        url: 'https://claude.ai/new?thunderai_call=' + encodeURIComponent(id),
        type: 'popup'
    }).then(async win => {
        const [tab] = await browser.tabs.query({ windowId: win.id });
        if (!tab) throw new Error('Claude Web window has no tab');
        call.windowId = win.id;
        tabs.set(tab.id, call);
    });
    try {
        await call.ready;
    } catch (error) {
        calls.delete(id);
        throw error;
    }
}
