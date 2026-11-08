// The ready listener of the chat window: when openChatGPT() registers it, and when it goes away.
//
// Spec 01 "Ready handshake": for every window it opens (the API chat window of the five API
// providers, the ChatGPT Web window), openChatGPT() registers one runtime.onMessage listener for
// that window's `<llm>_ready_<call_id>` and, once windows.create() returns, one windows.onRemoved
// listener for that window id. Both are removed together on each of the three ends of the
// handshake: the ready message answered with api_send / chatgpt_send (a usable configuration), the
// ready message answered with api_error (an empty key, model, host or version), the window closed
// before any ready message. Nothing of either is left registered afterwards.
//
// openChatGPT() is cut out of mzta-background.js as an extra root; the connection is the prompt's
// own (`api_type` and its `{integration}_{key}` fields), so the global preferences never change.
// What the window does with the answer is the webchat area's (and chatgptweb's for ChatGPT Web).

import assert from 'node:assert/strict';
import {
    bgContext,
    ROOTS
} from './context.mjs';
import {
    API,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    roots: [...ROOTS, 'openChatGPT'],
    // No wait before the ChatGPT Web script is injected.
    local: { ...API, chatgpt_web_load_wait_time: 0 },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', windowId: 1, active: true });
    },
});
const k = caseTests('40-chat-window-ready');
const { openChatGPT } = ctx.bg;
const onMessage = ctx.ctl.browser.runtime.onMessage;
const onRemoved = ctx.ctl.browser.windows.onRemoved;

/** Each provider's usable configuration, as the prompt's own fields, and the fields it requires. */
const PROVIDERS = {
    chatgpt_api: { fields: { chatgpt_api_key: 'sk-FAKE', chatgpt_model: 'gpt-test' } },
    google_gemini_api: { fields: { google_gemini_api_key: 'g-FAKE', google_gemini_model: 'gemini-test' } },
    ollama_api: { fields: { ollama_host: 'http://localhost:11434', ollama_model: 'llama-test' } },
    openai_comp_api: { fields: { openai_comp_host: 'http://localhost:1234', openai_comp_model: 'comp-test' } },
    anthropic_api: { fields: { anthropic_api_key: 'a-FAKE', anthropic_model: 'claude-test', anthropic_version: '2023-06-01' } },
};
/** The api_error each empty required field answers with. */
const EMPTY_ERRORS = {
    chatgpt_api_key: 'chatgpt_empty_apikey',
    chatgpt_model: 'chatgpt_empty_model',
    google_gemini_api_key: 'google_gemini_empty_apikey',
    google_gemini_model: 'google_gemini_empty_model',
    ollama_host: 'ollama_empty_host',
    ollama_model: 'ollama_empty_model',
    openai_comp_host: 'OpenAIComp_empty_host',
    openai_comp_model: 'OpenAIComp_empty_model',
    anthropic_api_key: 'anthropic_empty_apikey',
    anthropic_model: 'anthropic_empty_model',
    anthropic_version: 'anthropic_empty_version',
};

const prompt = (api_type, fields = {}) => ({ id: 'prompt_ready', name: 'Ready', api_type, body_text: 'Body', ...fields });

const baseline = [...onMessage._listeners];
const turns = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

/**
 * Open a chat window for `promptInfo` and give it its tab; asserts the two listeners are in place.
 * Returns the window, its tab id and the ready command it is waited from.
 */
async function open(promptInfo) {
    await openChatGPT('Hello', '0', 7, promptInfo.name, 0, promptInfo);
    const win = ctx.m.windows.at(-1);
    const tabId = win.id * 10;
    ctx.m.addTab({ id: tabId, type: 'content', windowId: win.id });
    const added = onMessage._listeners.filter(fn => !baseline.includes(fn));
    assert.equal(added.length, 1, 'one ready listener while the window has not answered');
    assert.equal(onRemoved._listeners.length, 1, 'one windows.onRemoved listener for that window');
    const callId = /[?&]call_id=([^&]+)/.exec(win.url)[1];
    return { win, tabId, command: promptInfo.api_type + '_ready_' + callId };
}

async function sendReady(w) {
    await ctx.ctl.dispatchMessage(
        { command: w.command, window_id: w.win.id, readyReason: 'composer', readyStateAtSend: 'complete' },
        { id: 'thunderai@micz.it', tab: { id: w.tabId, windowId: w.win.id } });
    await turns();
}

async function closeWindow(id) {
    for (const fn of [...onRemoved._listeners]) fn(id);
    await turns();
}

function assertNoneLeft(what) {
    assert.deepEqual(onMessage._listeners.filter(fn => !baseline.includes(fn)), [], what + ': no ready listener left');
    assert.equal(onRemoved._listeners.length, 0, what + ': no windows.onRemoved listener left');
}

for (const [type, { fields }] of Object.entries(PROVIDERS)) {
    k.test(`${type}-ready-valid`, `${type}: the ready message with a usable configuration sends api_send and removes both listeners`, async () => {
        const w = await open(prompt(type, fields));
        await sendReady(w);
        assert.deepEqual(ctx.m.commandsTo(w.tabId), ['api_send']);
        assertNoneLeft(type);
        await closeWindow(w.win.id);
        assertNoneLeft(type + ' then closed');
    });

    for (const field of Object.keys(fields)) {
        k.test(`${type}-ready-empty-${field}`, `${type}: the ready message with ${field} empty sends api_error and removes both listeners`, async () => {
            const w = await open(prompt(type, { ...fields, [field]: '' }));
            await sendReady(w);
            assert.deepEqual(ctx.m.sentTo(w.tabId), [{ command: 'api_error', error: ctx.ctl.browser.i18n.getMessage(EMPTY_ERRORS[field]) }]);
            assertNoneLeft(type);
        });
    }

    k.test(`${type}-closed`, `${type}: the window closed before its ready message removes both listeners`, async () => {
        const w = await open(prompt(type, fields));
        await closeWindow(w.win.id + 1000);
        assert.equal(onRemoved._listeners.length, 1, 'another window closing changes nothing');
        await closeWindow(w.win.id);
        assertNoneLeft(type);
        await sendReady(w);
        assert.deepEqual(ctx.m.sentTo(w.tabId), [], 'a late ready message is not answered');
    });
}

k.test('chatgpt_web-ready', 'chatgpt_web: the ready message injects the script, sends chatgpt_send and removes both listeners', async () => {
    const w = await open(prompt('chatgpt_web'));
    await sendReady(w);
    assert.deepEqual(ctx.m.calls.filter(c => c.api === 'tabs.executeScript').map(c => c.args[0]), [w.tabId]);
    assert.deepEqual(ctx.m.commandsTo(w.tabId), ['chatgpt_send']);
    assertNoneLeft('chatgpt_web');
});

k.test('chatgpt_web-closed', 'chatgpt_web: the window closed before its ready message removes both listeners', async () => {
    const w = await open(prompt('chatgpt_web'));
    await closeWindow(w.win.id);
    assertNoneLeft('chatgpt_web');
});

k.test('several-windows', 'two windows waiting at once: closing one removes only its own listeners', async () => {
    const a = await open(prompt('chatgpt_api', PROVIDERS.chatgpt_api.fields));
    const before = [...onMessage._listeners];
    await openChatGPT('Hello', '0', 7, 'Ready', 0, prompt('ollama_api', PROVIDERS.ollama_api.fields));
    const b = { win: ctx.m.windows.at(-1) };
    assert.equal(onMessage._listeners.length, before.length + 1);
    assert.equal(onRemoved._listeners.length, 2);
    await closeWindow(b.win.id);
    assert.equal(onRemoved._listeners.length, 1);
    await sendReady(a);
    assert.deepEqual(ctx.m.commandsTo(a.tabId), ['api_send']);
    assertNoneLeft('both');
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
