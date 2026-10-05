/*
 *  The worker realm of the api area: what a ThunderAI model worker sees in Thunderbird.
 *
 *  Not to be confused with tests/helpers/core/worker.mjs, which runs a fresh EXTENSION context in
 *  a Node worker thread. This file is about ThunderAI's own Web Workers (js/workers/*), which
 *  this area runs in-process, as plain modules, in a realm shaped like a module worker's:
 *
 *   - `self` is the global object, as in a DedicatedWorkerGlobalScope. The workers assign
 *     `self.onmessage`; send() calls it with `{data}` and resolves when the handler settles (a
 *     chatMessage handler settles when its stream ends);
 *   - `postMessage` is the GLOBAL function the workers call (never `self.postMessage` explicitly,
 *     but the two are the same object here, as there): a spy that records every message,
 *     structured-cloned, in `posted`;
 *   - `fetch` is the fetch model (fetch-model.mjs), installed by the caller;
 *   - there is NO `browser` and NO `messenger` global: a Web Worker has no WebExtension API, so
 *     worker code that touches one throws a ReferenceError, which fails the test. loadWorker()
 *     refuses to run when either exists, and assertNoBrowser() checks nothing installed one.
 *
 *  A worker module is a singleton (its conversationHistory, usage counter and so on are module
 *  state), so one test file is one worker instance: loadWorker() is called once per file and the
 *  file's tests run in order against it, like the turns of one chat window. A scenario that needs
 *  a fresh worker gets its own file.
 */

import assert from 'node:assert/strict';
import { REPO } from '../helpers/core/load.mjs';

export function assertNoBrowser() {
    assert.equal('browser' in globalThis, false, 'a worker realm has no browser global');
    assert.equal('messenger' in globalThis, false, 'a worker realm has no messenger global');
}

/** Turn the event loop until `pred()` holds (real setImmediate, so mocked timers do not matter). */
export async function until(pred, what = 'the condition', turns = 2000) {
    for (let i = 0; i < turns; i++) {
        if (pred()) return;
        await new Promise(r => setImmediate(r));
    }
    throw new Error('timed out waiting for ' + what);
}

/** Let pending promise work run (a few event-loop turns). */
export async function flush(turns = 20) {
    for (let i = 0; i < turns; i++) await new Promise(r => setImmediate(r));
}

/**
 * Load one model worker (e.g. 'model-worker-anthropic') into the realm.
 * @returns {{posted, send, types, since, mod}}
 */
export async function loadWorker(name) {
    assertNoBrowser();
    if (globalThis.self !== undefined && globalThis.self !== globalThis) {
        throw new Error('globalThis.self already exists and is not the global object');
    }
    const posted = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (msg) => { posted.push(structuredClone(msg)); };
    const mod = await import(new URL('js/workers/' + name + '.js', REPO).href);
    assert.equal(typeof globalThis.self.onmessage, 'function', name + ' assigns self.onmessage');
    return {
        mod,
        posted,
        /** Dispatch a message to the worker; resolves (or rejects) with its handler. */
        send(data) {
            return globalThis.self.onmessage({ data });
        },
        /** The types of the messages posted from index `from` on. */
        types(from = 0) { return posted.slice(from).map(m => m.type); },
        /** The messages posted from index `from` on. */
        since(from = 0) { return posted.slice(from); },
    };
}

/**
 * Start one chatMessage turn without awaiting it. `done` settles with the handler; `from` is the
 * index of the first message the turn posts; `settled()` tells whether the handler is over.
 */
export function startTurn(w, message) {
    const from = w.posted.length;
    let over = false;
    const done = Promise.resolve(w.send({ type: 'chatMessage', message })).finally(() => { over = true; });
    done.catch(() => {});
    return { from, done, settled: () => over, posted: () => w.posted.slice(from) };
}

/**
 * The messages of a turn in protocol order, without 'messageSent' (whose position spec 04 does
 * not fix) - each as [type, the field that matters]: newToken/newThinkingToken -> token,
 * usage -> messageId, tokensDone -> thinking, error -> payload, newRetryAttempt -> status.
 */
export function shape(msgs) {
    return msgs.filter(m => m.type !== 'messageSent').map(m => {
        switch (m.type) {
            case 'newToken':
            case 'newThinkingToken': return [m.type, m.payload.token];
            case 'usage': return [m.type, m.messageId];
            case 'tokensDone': return [m.type, m.payload.thinking];
            case 'error': return [m.type, m.payload];
            case 'newRetryAttempt': return [m.type, m.payload.status];
            default: return [m.type];
        }
    });
}

/** The init message the chat window sends (api_webchat/controller.js shape). */
export function initMessage(fields, { do_debug = false, chat_show_usage_data = true, i18nStrings = {} } = {}) {
    return { type: 'init', do_debug, i18nStrings, chat_show_usage_data, ...fields };
}
