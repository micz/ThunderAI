/*
 *  Opening the chat window, and reading it the way the user sees it.
 *
 *  openWebchat() installs the fake Worker for the provider (./fake-worker.mjs), then opens
 *  api_webchat/index.html with the query string the background builds (llm, call_id, prompt_id,
 *  prompt_name, ph_def_val) and the stored preferences given. It answers the window's
 *  `${llm}_ready_${call_id}` command; any other background command the file expects goes in
 *  `commands`, so a command nobody declared is still a harness violation.
 *
 *  The views below read only what is on screen or what was sent: the transcript's turns, the
 *  input's controls, the background commands. Nothing private of the components.
 *
 *  Imports only the core and the area: no managed layer.
 */

import { openPage } from '../helpers/core/dom-harness.mjs';
import { expectWorker } from './fake-worker.mjs';
import {
    sq,
    sqa,
} from './shadow.mjs';

/** Spec 01 "Web Workers": the worker of each API connection type. */
export const WORKER_FILES = {
    chatgpt_api: 'model-worker-openai_responses.js',
    google_gemini_api: 'model-worker-google_gemini.js',
    ollama_api: 'model-worker-ollama.js',
    openai_comp_api: 'model-worker-openai_comp.js',
    anthropic_api: 'model-worker-anthropic.js',
};

/** The sender of a message from the background to the window. */
export const FROM_BACKGROUND = { id: 'thunderai@micz.it' };

export async function openWebchat({
    llm = 'chatgpt_api',
    call_id = 'call1',
    prompt_id = 'prompt_test',
    prompt_name = 'Test prompt',
    ph_def_val = null,
    local = {},
    commands = {},
    permissions,
} = {}) {
    const worker = expectWorker(WORKER_FILES[llm]);
    // Built as the background builds it (openChatGPT() in mzta-background.js): each value through
    // one encodeURIComponent.
    let query = '?llm=' + llm + '&call_id=' + call_id;
    if (ph_def_val !== null) query += '&ph_def_val=' + ph_def_val;
    if (prompt_id !== null) query += '&prompt_id=' + encodeURIComponent(prompt_id);
    if (prompt_name !== null) query += '&prompt_name=' + encodeURIComponent(prompt_name);
    const ready = `${llm}_ready_${call_id}`;
    const ctx = await openPage('webchat', {
        query,
        local,
        permissions,
        commands: { [ready]: () => true, ...commands },
    });
    return { ctx, worker, ready };
}

/** Deliver a background command to the window (runtime.onMessage), then settle. */
export async function fromBackground(ctx, message) {
    const answer = await ctx.ctl.dispatchMessage(message, FROM_BACKGROUND);
    await ctx.settle();
    return answer;
}

/** The api_send command the background sends once the window is ready. */
export function apiSend(ctx, data) {
    return fromBackground(ctx, { command: 'api_send', action: '0', tabId: 3, mailMessageId: 11,
        do_custom_text: '0', prompt_info: {}, ...data });
}

/** Every command the window sent to the background with that name, in order. */
export function sentCommands(ctx, command) {
    return ctx.ctl.sent.filter(m => m && m.command === command);
}

/** Every background command the window sent, by name, in order (the managed handshake left out). */
export function commandNames(ctx, since = 0) {
    return ctx.ctl.sent.slice(since).map(m => m && m.command).filter(c => c && c !== 'get_managed_values');
}

// ---- the transcript ------------------------------------------------------------------
//
// Children are walked rather than queried with ':scope >': jsdom's selector engine does not
// honour ':scope' in querySelectorAll() on these elements.

const kids = (el, cls) => el ? [...el.children].filter(c => c.classList.contains(cls)) : [];
const body = turn => kids(turn, 'turn-body')[0] ?? null;

export const messagesBox = ctx => sq(ctx.document, 'messages-area', '#messages');
export const turns = ctx => kids(messagesBox(ctx), 'turn');
export const botTurns = ctx => turns(ctx).filter(t => t.classList.contains('turn-bot'));
export const lastBotTurn = ctx => botTurns(ctx).at(-1) ?? null;
/** The .message.bot elements of a turn: what the model's answer is rendered into. */
export const answerEls = turn => kids(body(turn), 'message').filter(m => m.classList.contains('bot'));
/** The answer's own content: the .message elements' children, the thinking block left out. */
export function answerHtml(turn) {
    return answerEls(turn).map(m => [...m.childNodes]
        .filter(n => !(n.nodeType === 1 && n.matches('details.thinking-block')))
        .map(n => n.nodeType === 1 ? n.outerHTML : n.nodeType === 3 ? n.data : '').join('')).join('');
}
export const actionBar = turn => kids(body(turn), 'action-bar')[0] ?? null;
export const toolbar = turn => kids(body(turn), 'turn-tools')[0] ?? null;
export const turnBody = body;

// ---- the input -----------------------------------------------------------------------

export const field = ctx => sq(ctx.document, 'message-input', '#messageInputField');
export const sendButton = ctx => sq(ctx.document, 'message-input', '#sendButton');
export const stopButton = ctx => sq(ctx.document, 'message-input', '#stopButton');
export const statusPill = ctx => sq(ctx.document, 'message-input', '#statusLogger');
export const statusText = ctx => sq(ctx.document, 'message-input', '#statusLoggerText').textContent;
export const statusIcon = ctx => sq(ctx.document, 'message-input', '#statusLoggerIcon');

/** Type a prompt in the field and press Send, as the user does. */
export async function typeAndSend(ctx, text) {
    field(ctx).value = text;
    await ctx.click(sendButton(ctx));
}

/** Whether a control is usable: present, not disabled, not display:none. */
export function usable(el) {
    return !!el && !el.disabled && !el.hasAttribute('disabled') && el.style.display !== 'none';
}

export { sq, sqa };
