/*
 *  The chat window's Worker, scripted. The real model workers are the api area's business
 *  (tests/api/): here the window is tested against the worker-to-window contract of spec 01
 *  "Streaming data flow", from the window's side, with no model, no fetch and no worker thread.
 *
 *  expectWorker(file) installs a fake `Worker` constructor on globalThis BEFORE openPage(): the
 *  harness never touches that global (it is not a window global jsdom provides), so the page's
 *  controller.js finds it as a bare name when it runs `new Worker(path, {type: 'module'})`. The
 *  fake
 *
 *   - accepts exactly one worker, whose url (resolved against the page) is js/workers/<file>, and
 *     THROWS on any other construction: an unexpected worker makes controller.js fail at import,
 *     so openPage() rejects and the file fails loudly. It is also recorded in `unexpected`;
 *   - records every message the window posts (init, chatMessage, stop) in `posted`, cloned;
 *   - delivers worker messages to the window, in order, with deliver(): each one goes through the
 *     window's own `worker.onmessage`, whose promise is awaited, then the page is settled. No
 *     sleep: the order is the order of the calls.
 *
 *  Nothing here imports jsdom.
 */

import { EXT_ORIGIN } from '../helpers/core/browser-mock.mjs';

const PAGE_URL = EXT_ORIGIN + 'api_webchat/index.html';

/**
 * Install the fake Worker for one expected worker file (e.g. 'model-worker-ollama.js').
 * Returns its controller:
 *
 *   url, options        what the window passed to the constructor (url resolved)
 *   posted              every message the window posted, in order
 *   unexpected          every refused construction
 *   chatMessages()      the `message` of each posted chatMessage
 *   deliver(ctx, ...m)  run each worker message through the window's onmessage, then settle
 *   token / thinking / done / usage / sent / retry / aborted / error   shorthands for deliver()
 *   stream(ctx, tokens, {done})   a newToken per token, then (by default) tokensDone
 */
export function expectWorker(file) {
    const expectedUrl = EXT_ORIGIN + 'js/workers/' + file;
    const w = {
        url: null,
        options: null,
        instance: null,
        posted: [],
        unexpected: [],
        terminated: false,

        chatMessages() {
            return w.posted.filter(m => m && m.type === 'chatMessage').map(m => m.message);
        },

        async deliver(ctx, ...messages) {
            for (const data of messages) {
                const inst = w.instance;
                if (!inst || typeof inst.onmessage !== 'function') {
                    throw new Error('fake Worker: the window has no onmessage handler to deliver to');
                }
                await inst.onmessage({ data: structuredClone(data) });
                await ctx.settle();
            }
        },
        token: (ctx, token) => w.deliver(ctx, { type: 'newToken', payload: { token } }),
        thinking: (ctx, token) => w.deliver(ctx, { type: 'newThinkingToken', payload: { token } }),
        done: (ctx) => w.deliver(ctx, { type: 'tokensDone' }),
        sent: (ctx) => w.deliver(ctx, { type: 'messageSent' }),
        usage: (ctx, messageId, payload) => w.deliver(ctx, { type: 'usage', messageId, payload }),
        retry: (ctx, payload) => w.deliver(ctx, { type: 'newRetryAttempt', payload }),
        aborted: (ctx) => w.deliver(ctx, { type: 'requestAborted' }),
        error: (ctx, payload, extra = {}) => w.deliver(ctx, { type: 'error', payload, ...extra }),

        async stream(ctx, tokens, { done = true } = {}) {
            for (const t of tokens) await w.token(ctx, t);
            if (done) await w.done(ctx);
        },
    };

    globalThis.Worker = class FakeWorker {
        constructor(url, options) {
            const resolved = new URL(String(url), PAGE_URL).href;
            if (w.instance !== null || resolved !== expectedUrl) {
                w.unexpected.push(resolved);
                throw new Error('fake Worker: unexpected worker ' + resolved + ' (this file expects '
                    + (w.instance ? 'only one worker' : expectedUrl) + ')');
            }
            w.url = resolved;
            w.options = structuredClone(options);
            w.instance = this;
            this.onmessage = null;
            this.onerror = null;
        }
        postMessage(message) {
            w.posted.push(structuredClone(message));
        }
        terminate() {
            w.terminated = true;
        }
    };
    return w;
}
