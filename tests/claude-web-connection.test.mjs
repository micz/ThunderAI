import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

async function setup() {
    const listeners = [], removed = [];
    let resolveWindow, resolveStarted;
    const started = new Promise(resolve => { resolveStarted = resolve; });
    const context = vm.createContext({
        URL, Map, Promise, Error, crypto: { randomUUID: () => 'test-call' },
        browser: {
            contentScripts: { register: async () => ({}) },
            runtime: { onMessage: { addListener: listener => listeners.push(listener) } },
            tabs: { onRemoved: { addListener: listener => removed.push(listener) }, query: async () => [{ id: 20 }] },
            windows: { create: options => { context.windowOptions = options; return new Promise(resolve => { resolveWindow = resolve; resolveStarted(); }); } }
        }
    });
    const source = await readFile(new URL('../js/mzta-claude-web-connection.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => { throw new Error('Unexpected import'); });
    await module.evaluate();
    const payload = { prompt: 'private test email', action: '2', tabId: 10 };
    const opening = module.namespace.openClaudeWeb({ width: 800 }, payload);
    await started;
    const sender = { tab: { id: 20, windowId: 2 }, frameId: 0, url: 'https://claude.ai/new' };
    return { module, listeners, removed, payload, opening, sender, context, resolve: () => resolveWindow({ id: 2 }) };
}

test('early handshake waits for the actual created tab; binds payload only to it', async () => {
    const s = await setup();
    const response = s.listeners[0]({ command: 'claude_web_get_prompt', callId: 'test-call' }, s.sender);
    s.resolve();
    await s.opening;
    assert.equal((await response).prompt, s.payload.prompt);
    assert.equal(s.context.windowOptions.url, 'https://claude.ai/new?thunderai_call=test-call');
    const wrongTab = { ...s.sender, tab: { id: 99, windowId: 2 } };
    assert.equal(await s.listeners[0]({ command: 'claude_web_get_prompt', callId: 'test-call' }, wrongTab), null);
});

test('rejects other origins, child frames, and spoofed window IDs', async () => {
    const s = await setup(); s.resolve(); await s.opening;
    const message = { command: 'claude_web_get_prompt', callId: 'test-call' };
    assert.equal(s.listeners[0](message, { ...s.sender, url: 'https://claude.ai.attacker.example/new' }), false);
    assert.equal(s.listeners[0](message, { ...s.sender, frameId: 1 }), false);
    assert.equal(await s.listeners[0](message, { ...s.sender, tab: { id: 20, windowId: 99 } }), null);
});

test('early login redirect without the call query still binds to the created tab', async () => {
    const s = await setup();
    const response = s.listeners[0]({ command: 'claude_web_get_prompt' }, { ...s.sender, url: 'https://claude.ai/login' });
    s.resolve(); await s.opening;
    assert.equal((await response).prompt, s.payload.prompt);
});

test('reload after submission cannot auto-submit again; closing releases prompt data', async () => {
    const s = await setup(); s.resolve(); await s.opening;
    assert.equal(await s.listeners[1]({ command: 'claude_web_mark_submitted' }, s.sender), true);
    assert.equal(s.listeners[1]({ command: 'claude_web_mark_submitted' }, s.sender), false);
    const response = await s.listeners[0]({ command: 'claude_web_get_prompt' }, s.sender);
    assert.equal(response.submitted, true);
    s.removed[0](20);
    assert.equal(s.module.namespace.getClaudeWebCall(s.sender), undefined);
    assert.equal(s.listeners[0]({ command: 'claude_web_get_prompt', callId: 'test-call' }, s.sender), false);
});

test('plain-text compose conversion escapes model markup and keeps line breaks', async () => {
    const source = await readFile(new URL('../js/lib/mzta-html-lines.js', import.meta.url), 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const html = vm.runInContext('mztaLinesToHtml("<img src=x onerror=alert(1)>\\nHello & goodbye", {mode:"p"})', context);
    assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;</p><p>Hello &amp; goodbye</p>');
});

test('both web providers are rejected by API-only feature gates', async () => {
    const { isWebConnection, isApiUsableConnection, getConnectionType } = await import('../js/mzta-utils.js');
    for (const type of ['chatgpt_web', 'claude_web']) {
        assert.equal(isWebConnection(type), true);
        assert.equal(isApiUsableConnection(type), false);
        const prefs = { connection_type: type, summarize_use_specific_integration: true, summarize_connection_type: 'anthropic_api' };
        assert.equal(isApiUsableConnection(getConnectionType(prefs, {}, 'summarize')), true);
    }
    assert.equal(isApiUsableConnection(''), false);
    assert.equal(isApiUsableConnection('anthropic_api'), true);
});
