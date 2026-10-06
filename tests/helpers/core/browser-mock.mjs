/*
 *  In-memory WebExtension mock, the core of the test suite.
 *
 *  js/mzta-prefs.js reads `browser.storage.local` at IMPORT time, so the mock must be on
 *  globalThis before any module under test is evaluated: call installBrowserMock() first,
 *  then load the modules with a dynamic import() (see ./load.mjs).
 *
 *  One mock = one extension context. The modules under test keep module-level state, so every
 *  test file is one context and one scenario; `node --test` runs each file in its own process.
 *
 *  It models the WebExtension APIs as such. storage.managed is one of them: its content is the
 *  `policy` option below, the one place the core knows that area exists (an area that needs
 *  more APIs adds them from its plugin, see ./plugins.mjs).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXT_ORIGIN = 'moz-extension://00000000-test-uuid/';
export const BACKGROUND_URL = EXT_ORIGIN + '_generated_background_page.html';

// Sender urls for the contexts the spec distinguishes.
export const SENDERS = {
    options: { url: EXT_ORIGIN + 'options/mzta-options.html', id: 'thunderai@micz.it' },
    featurePage: { url: EXT_ORIGIN + 'pages/spamfilter/mzta-spamfilter.html', id: 'thunderai@micz.it' },
    popup: { url: EXT_ORIGIN + 'popup/mzta-popup.html', id: 'thunderai@micz.it' },
    webchat: { url: EXT_ORIGIN + 'api_webchat/index.html?llm=chatgpt_api&call_id=x', id: 'thunderai@micz.it' },
    contentScript: { url: 'imap://mail.example.com/INBOX', id: 'thunderai@micz.it', tab: { id: 7 } },
    noUrl: { id: 'thunderai@micz.it' },
};

const clone = v => (v === undefined ? undefined : structuredClone(v));

function makeEvent() {
    const listeners = [];
    return {
        _listeners: listeners,
        addListener(fn) { if (!listeners.includes(fn)) listeners.push(fn); },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener(fn) { return listeners.includes(fn); },
    };
}

/**
 * A storage area with the real StorageArea.get() semantics:
 *  - get(null | undefined): everything
 *  - get('key') / get(['a', 'b']): only the keys present
 *  - get({key: default}): every key, the stored value when PRESENT, the default otherwise.
 *    A stored null is present and comes back as null - the default does not replace it.
 * Values are structured-cloned on the way in and out, like the real serialisation.
 */
function makeStorageArea(name, initial, onChanged, calls) {
    const data = new Map(Object.entries(clone(initial) || {}));
    const area = {
        _data: data,
        async get(keys) {
            calls.push({ area: name, op: 'get', keys: clone(keys) });
            const out = {};
            if (keys === null || keys === undefined) {
                for (const [k, v] of data) out[k] = clone(v);
            } else if (typeof keys === 'string') {
                if (data.has(keys)) out[keys] = clone(data.get(keys));
            } else if (Array.isArray(keys)) {
                for (const k of keys) if (data.has(k)) out[k] = clone(data.get(k));
            } else if (typeof keys === 'object') {
                for (const [k, def] of Object.entries(keys)) {
                    // A key whose default is undefined and which is not stored is absent,
                    // as in the real API (undefined does not survive serialisation).
                    if (data.has(k)) out[k] = clone(data.get(k));
                    else if (def !== undefined) out[k] = clone(def);
                }
            } else {
                throw new TypeError('storage.' + name + '.get: invalid keys');
            }
            return out;
        },
        async set(items) {
            calls.push({ area: name, op: 'set', items: clone(items) });
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
                if (v === undefined) continue;
                const oldValue = data.has(k) ? clone(data.get(k)) : undefined;
                data.set(k, clone(v));
                changes[k] = { oldValue, newValue: clone(v) };
            }
            if (Object.keys(changes).length > 0) fire(onChanged, changes, name);
        },
        async remove(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const changes = {};
            for (const k of list) {
                if (!data.has(k)) continue;
                changes[k] = { oldValue: clone(data.get(k)) };
                data.delete(k);
            }
            if (Object.keys(changes).length > 0) fire(onChanged, changes, name);
        },
        async clear() {
            const changes = {};
            for (const [k, v] of data) changes[k] = { oldValue: clone(v) };
            data.clear();
            if (Object.keys(changes).length > 0) fire(onChanged, changes, name);
        },
        onChanged: makeEvent(),
    };
    // Per-area onChanged fires with (changes) only.
    const fire = (globalEvent, changes, areaName) => {
        for (const fn of [...globalEvent._listeners]) fn(clone(changes), areaName);
        for (const fn of [...area.onChanged._listeners]) fn(clone(changes));
    };
    return area;
}

function loadEnMessages() {
    const file = fileURLToPath(new URL('../../../_locales/en/messages.json', import.meta.url));
    return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Install the mock on globalThis.browser (and globalThis.messenger).
 *
 * @param {object} opts
 *   policy      - the object storage.managed.get() resolves to; null/undefined = no policy
 *                 installed, and then get() REJECTS, as Thunderbird does.
 *   local       - initial storage.local content
 *   sync        - initial storage.sync content
 *   session     - initial storage.session content
 *   accounts    - what accounts.list() resolves to (MailAccount-like objects)
 *   tags        - what messages.tags.list() resolves to (MessageTag-like objects)
 *   remote      - (message, sender) => reply: the OTHER end of runtime.sendMessage, i.e. the
 *                 background as seen from a page. May return a value, a promise, or throw.
 *                 Without it, sendMessage rejects like a message with no receiving end.
 *   senderUrl   - the url this context sends from (what `remote` receives as sender.url)
 *   external    - (extensionId, message) => reply: another add-on, for the two-argument
 *                 sendMessage(extensionId, message). Without it that form rejects.
 * @returns the controller: { browser, calls, sent, setPolicy, setAccounts, dispatchMessage }
 */
export function installBrowserMock(opts = {}) {
    let policy = opts.policy ?? null;
    let accounts = clone(opts.accounts ?? []);
    const tags = clone(opts.tags ?? []);
    let accountsError = null;
    const calls = [];          // every storage operation, in order
    const sent = [];           // every runtime.sendMessage, in order
    const messages = loadEnMessages();
    const storageOnChanged = makeEvent();
    const onMessage = makeEvent();
    let remote = opts.remote ?? null;
    const senderUrl = opts.senderUrl ?? BACKGROUND_URL;

    const browser = {
        storage: {
            local: makeStorageArea('local', opts.local, storageOnChanged, calls),
            sync: makeStorageArea('sync', opts.sync, storageOnChanged, calls),
            session: makeStorageArea('session', opts.session, storageOnChanged, calls),
            managed: {
                async get(keys) {
                    calls.push({ area: 'managed', op: 'get', keys: clone(keys) });
                    if (policy === null || policy === undefined) {
                        throw new Error('Managed storage manifest not found');
                    }
                    return clone(policy);
                },
                async set() { throw new Error('storage.managed is read-only'); },
                onChanged: makeEvent(),
            },
            onChanged: storageOnChanged,
        },
        runtime: {
            id: 'thunderai@micz.it',
            getURL(path = '') {
                return EXT_ORIGIN + String(path).replace(/^\//, '');
            },
            async sendMessage(message, ...rest) {
                // The two-argument form sendMessage(extensionId, message) goes to ANOTHER
                // add-on (the Sparks presence check). Answered by opts.external when given.
                if (typeof message === 'string' && rest.length > 0 && typeof rest[0] === 'object') {
                    sent.push({ to: message, message: clone(rest[0]) });
                    if (!opts.external) {
                        throw new Error('Could not establish connection. Receiving end does not exist.');
                    }
                    return clone(await opts.external(message, clone(rest[0])));
                }
                sent.push(clone(message));
                if (!remote) {
                    throw new Error('Could not establish connection. Receiving end does not exist.');
                }
                return clone(await remote(clone(message), { url: senderUrl, id: 'thunderai@micz.it' }));
            },
            onMessage,
            onInstalled: makeEvent(),
            onMessageExternal: makeEvent(),
            getManifest() {
                return JSON.parse(readFileSync(
                    fileURLToPath(new URL('../../../manifest.json', import.meta.url)), 'utf8'));
            },
        },
        i18n: {
            getMessage(name, substitutions) {
                const entry = messages[name];
                if (!entry) return '';
                let text = entry.message;
                // Named placeholders ($NAME$, case-insensitive) first, as the real API does:
                // each is replaced by its "content", which may itself be a $1-style reference.
                for (const [pname, def] of Object.entries(entry.placeholders || {})) {
                    text = text.replace(new RegExp('\\$' + pname + '\\$', 'gi'), () => def.content);
                }
                const subs = substitutions === undefined ? [] :
                    (Array.isArray(substitutions) ? substitutions : [substitutions]);
                subs.forEach((s, i) => { text = text.split('$' + (i + 1)).join(String(s)); });
                return text;
            },
            getUILanguage() { return 'en'; },
        },
        accounts: {
            async list(includeSubFolders = true) {
                calls.push({ area: 'accounts', op: 'list', includeSubFolders });
                if (accountsError) throw accountsError;
                return clone(accounts);
            },
            onCreated: makeEvent(),
            onUpdated: makeEvent(),
            onDeleted: makeEvent(),
        },
        // The tag list only: the Add Tags page previews its prompt statements from it.
        messages: {
            tags: {
                async list() {
                    calls.push({ area: 'messages.tags', op: 'list' });
                    return clone(tags);
                },
            },
        },
    };

    globalThis.browser = browser;
    globalThis.messenger = browser;

    return {
        browser,
        calls,
        sent,
        /** Replace the policy (a restart is still needed for the module to re-read it). */
        setPolicy(p) { policy = p; },
        setAccounts(list) { accounts = clone(list); accountsError = null; },
        /** Make accounts.list() reject. */
        failAccounts(err = new Error('accounts unavailable')) { accountsError = err; },
        setRemote(fn) { remote = fn; },
        /** Raw storage.local content, bypassing the API (no call recorded). */
        localData() { return Object.fromEntries([...browser.storage.local._data].map(([k, v]) => [k, clone(v)])); },
        /**
         * Deliver a message to this context's runtime.onMessage listeners, the way a message
         * from `sender` arrives in the background. Resolves to the first listener's answer
         * (a returned promise/value, or a sendResponse() call after returning true), or
         * undefined when no listener answers.
         */
        async dispatchMessage(message, sender) {
            for (const fn of [...onMessage._listeners]) {
                let responded;
                const viaCallback = new Promise(r => { responded = r; });
                const ret = fn(clone(message), clone(sender), v => responded(v));
                if (ret === true) return clone(await viaCallback);
                if (ret !== undefined && ret !== false) return clone(await ret);
            }
            return undefined;
        },
    };
}
