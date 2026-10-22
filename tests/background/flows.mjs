/*
 *  What the flow tests share: the preferences of a usable API connection, the way a mail arrives
 *  (the onNewMailReceived listener the background registered), a responder that answers each
 *  feature's prompt, and a driver that runs a batch under node:test's mock timers.
 *
 *  Not a test file (no .test.mjs suffix). Imports only the area's helpers and the core.
 */

import assert from 'node:assert/strict';
import { answering } from './fake-worker.mjs';

/** A usable global API connection (OpenAI Responses, the chatgpt_api worker). */
export const API = {
    connection_type: 'chatgpt_api',
    chatgpt_api_key: 'sk-FAKE',
    chatgpt_model: 'gpt-test',
};

/** The headerMessageId a prompt was built for: the model's bodies name their message. */
export function messageOf(prompt) {
    const m = /SUMMARIZE (\S+)|Body of <([^>]+)>/.exec(String(prompt));
    return m ? (m[1] || m[2]) : null;
}

/** Which feature a prompt belongs to, from the shipped prompt texts. */
export function featureOf(prompt) {
    const p = String(prompt);
    if (p.startsWith('SUMMARIZE ')) return 'summary';
    if (/determine if it is spam/.test(p)) return 'spam';
    if (/generate a JSON array of tags/.test(p)) return 'add_tags';
    if (/^Translate the email below/.test(p)) return 'translation';
    return 'unknown';
}

/** Default answers, per feature. `over` replaces one: {spam: (hid, prompt) => answer}. */
export function featureResponder(over = {}) {
    const def = {
        spam: () => '{"spamValue": 10, "explanation": "Looks fine"}',
        add_tags: () => '{"tags": ["Work"]}',
        summary: hid => 'Summary of **' + hid + '**',
        translation: hid => JSON.stringify({ subject: 'Oggetto ' + hid, body: 'Corpo ' + hid, status: '1' }),
    };
    return answering(prompt => {
        const f = featureOf(prompt);
        const fn = over[f] || def[f];
        if (!fn) throw new Error('featureResponder: no answer for a prompt of feature ' + f + ': ' + String(prompt).slice(0, 80));
        return fn(messageOf(prompt), prompt);
    });
}

/** The prompts sent, as [{feature, message}] in the order they reached a worker. */
export function sentPrompts(ctx) {
    return ctx.workers.prompts().map(p => ({ feature: featureOf(p), message: messageOf(p) }));
}

/** The onNewMailReceived listener the background registered, checked to be the only one. */
export function newMailListener(ctx) {
    const ev = ctx.ctl.browser.messages.onNewMailReceived;
    assert.equal(ev._listeners.length, 1, 'one onNewMailReceived listener');
    return ev._listeners[0];
}

/**
 * New mail in `folder`: what Thunderbird does, a call of the registered listener with the folder
 * and a MessageList of the headers. Resolves when the listener's promise does (processEmails()
 * awaited), or at once when it did not start one.
 */
export async function receive(ctx, headers, { folder = { name: 'Inbox', path: '/INBOX' }, pageSize = 100 } = {}) {
    return newMailListener(ctx)(folder, ctx.m.messageList(headers, pageSize));
}

/**
 * Run `promise` (a batch) to its end under mock timers: turn the event loop and fire the timers
 * that are due (the setTimeout(0) yield between chunks of 5 messages), never advancing the clock.
 * Requires t.mock.timers.enable({apis: ['setTimeout']}) before the batch starts.
 */
export async function drive(t, promise, { maxTurns = 2000 } = {}) {
    let settled = false;
    let value, err;
    promise.then(v => { settled = true; value = v; }, e => { settled = true; err = e; });
    for (let i = 0; i < maxTurns && !settled; i++) {
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(0);
    }
    if (!settled) throw new Error('drive: the batch did not end in ' + maxTurns + ' turns');
    if (err) throw err;
    return value;
}

/** The stored record of a message (storage.local, raw). */
export function record(ctx, headerMessageId) {
    return ctx.ctl.localData()['msg:' + headerMessageId] ?? null;
}

/**
 * Change preferences the way a settings page does (a storage.local write), and let the
 * background's own storage.onChanged handling refresh its snapshot: the 200 ms debounce, fired on
 * the mock clock (twice: the flag repair it runs may write and re-fire it). Requires mock timers.
 */
export async function setPrefs(t, ctx, prefs) {
    await ctx.ctl.browser.storage.local.set(prefs);
    for (let i = 0; i < 2; i++) {
        t.mock.timers.tick(200);
        for (let j = 0; j < 30; j++) await new Promise(r => setImmediate(r));
    }
}

/**
 * A content script's message to the background, from tab `tabId` (sender.tab), through the
 * background's real runtime.onMessage listener; then the event loop runs until the fire-and-forget
 * work it started is done (`turns` turns).
 */
export async function fromTab(ctx, tabId, message, { type = 'mail', turns = 60 } = {}) {
    const answer = await ctx.ctl.dispatchMessage(message, { id: 'thunderai@micz.it', url: 'imap://mail.example.test/INBOX', tab: { id: tabId, type } });
    for (let i = 0; i < turns; i++) await new Promise(r => setImmediate(r));
    return answer;
}

/**
 * A click on a context menu item, in tab `tab` with `selected` (headers) selected: the
 * background's own menus.onClicked listener (the one routing `mzta-ctx-` ids; mzta_Menus registers
 * another), awaited.
 */
export async function clickContextMenu(ctx, menuItemId, tab, selected) {
    const listeners = ctx.ctl.browser.menus.onClicked._listeners.filter(fn => String(fn).includes("'mzta-ctx-'"));
    assert.equal(listeners.length, 1, 'one background menus.onClicked listener');
    const t = ctx.m.tab(tab.id);
    if (t) t.selected = selected.map(h => h.id);
    return listeners[0]({ menuItemId, selectedMessages: ctx.m.messageList(selected) }, tab);
}

/**
 * The end of every flow file: no worker left alive, no unexpected worker, no unmodelled API
 * touched, no promise rejection left unhandled by the background.
 */
export function assertClean(ctx) {
    assert.deepEqual(ctx.workers.live().map(w => w.file), [], 'workers left alive');
    assert.deepEqual(ctx.workers.unexpected, [], 'unexpected workers');
    assert.deepEqual(ctx.m.unmodelled, [], 'unmodelled APIs touched');
    assert.deepEqual(ctx.unhandled.map(e => String(e?.stack || e)), [], 'unhandled rejections');
}
