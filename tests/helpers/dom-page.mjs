/*
 *  DOM harness: one extension page, loaded for real, in jsdom.
 *
 *  jsdom does not execute <script type="module">, so this does what the browser does, in
 *  the browser's order:
 *
 *    1. parse the page's real HTML file at its moz-extension:// url;
 *    2. expose the jsdom window's globals (window, document, the DOM classes) on globalThis,
 *       where the page's module code looks them up;
 *    3. install the browser mock (startPage(): the page context plus a background instance
 *       of js/mzta-managed.js running the policy), wrapped in a Proxy that THROWS on any API
 *       it does not model;
 *    4. run the page's classic scripts in document order (js/mzta-i18n.js -> `i18n`,
 *       pages/_lib/list.js -> `List`): classic scripts run during parsing, before the
 *       deferred module script;
 *    5. import() the page's own module script;
 *    6. dispatch DOMContentLoaded and wait until the page has settled.
 *
 *  The background end of runtime.sendMessage is the real background code wherever it can be
 *  run without starting mzta-background.js: the get_managed_values listener, the one channel
 *  a page gets the policy through, is cut out of it verbatim (./background-handler.mjs). The few other commands a page sends get a fixed, minimal
 *  answer (COMMANDS below); anything else is a recorded violation.
 *
 *  One file = one page = one policy, as for the level-1 suite: the page's modules are
 *  singletons, loaded once per process.
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { EXT_ORIGIN } from './browser-mock.mjs';
import { startPage, repoPath, REPO } from './load.mjs';

/** Every page the suite can open: name -> HTML path, relative to the repository root. */
export const PAGES = {
    'options': 'options/mzta-options.html',
    'setup-wizard': 'pages/setup-wizard/mzta-setup-wizard.html',
    'spamfilter': 'pages/spamfilter/mzta-spamfilter.html',
    'addtags': 'pages/addtags/mzta-add-tags.html',
    'summarize': 'pages/summarize/mzta-summarize.html',
    'translate': 'pages/translate/mzta-translate.html',
    'get-calendar-event': 'pages/get-calendar-event/mzta-get-calendar-event.html',
    'get-task': 'pages/get-task/mzta-get-task.html',
    'customprompts': 'pages/customprompts/mzta-custom-prompts.html',
    'menu_order': 'pages/menu_order/mzta-menu-order.html',
    'customdataplaceholders': 'pages/customdataplaceholders/mzta-custom-dataplaceholders.html',
    'popup': 'popup/mzta-popup.html',
    'onboarding': 'pages/onboarding/onboarding.html',
};

/** The window globals page code reaches for as bare names. Explicit, not "everything":
 *  copying the whole window would shadow Node's own URL, fetch, structuredClone, timers... */
const WINDOW_GLOBALS = [
    'window', 'document', 'location', 'history',
    'Event', 'CustomEvent', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent',
    'UIEvent', 'PointerEvent', 'WheelEvent',
    'Node', 'NodeList', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
    'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLOptionElement',
    'HTMLTemplateElement', 'HTMLDialogElement', 'HTMLImageElement', 'HTMLDivElement',
    'HTMLSpanElement', 'HTMLLabelElement', 'HTMLFormElement', 'HTMLTableRowElement',
    'Text', 'Comment', 'DocumentFragment', 'Range', 'Selection',
    'DOMParser', 'XMLSerializer', 'XPathResult', 'Option', 'Image',
    'MutationObserver', 'getComputedStyle', 'getSelection', 'CSS',
    'FileReader', 'DataTransfer',
];

/**
 * The background commands a page may send besides the managed ones, with the minimal answer
 * that lets it run. Anything not here (and not overridden through opts.commands) is recorded
 * as a violation and rejected, like an unmocked API.
 */
function defaultCommands(mods) {
    return {
        reload_menus: () => true,
        get_active_special_ids: () => mods.prompts.getSpecialPromptIds
            ? mods.prompts.getSpecialPromptIds() : [],
        popup_menu_ready: () => ({
            batchStatus: { working: false, processed: 0 },
            lastShortcutTabId: 1,
            lastShortcutTabType: 'mail',
            lastShortcutFiltering: 0,
            lastShortcutPromptsData: [],
        }),
    };
}

// ---------------------------------------------------------------------------------------
// The strict browser proxy
// ---------------------------------------------------------------------------------------

const PASS_THROUGH = new Set(['then', 'toJSON', 'constructor', 'prototype']);

/**
 * Wrap the mock so that reading any property it does not define THROWS and is recorded.
 * Recording matters as much as throwing: page code often wraps browser calls in try/catch,
 * and a swallowed "unmocked API" would otherwise vanish. A property deliberately modelled as
 * absent is one set to undefined - `in` sees it, so it does not throw.
 *
 * Every function call is recorded too (apiCalls), and every promise it returns is tracked
 * so settle() can wait for it.
 */
function strictProxy(root, rec, rootName = 'browser') {
    const proxies = new WeakMap();
    const fns = new WeakMap();
    const wrapFn = (fn, owner, path) => {
        let wrapped = fns.get(fn);
        if (wrapped) return wrapped;
        wrapped = function (...args) {
            rec.apiCalls.push({ api: path, args });
            const out = fn.apply(owner, args);
            if (out && typeof out.then === 'function') rec.track(out);
            return out;
        };
        fns.set(fn, wrapped);
        return wrapped;
    };
    const wrap = (obj, path) => {
        let p = proxies.get(obj);
        if (p) return p;
        p = new Proxy(obj, {
            get(target, prop, receiver) {
                if (typeof prop === 'symbol' || PASS_THROUGH.has(prop)) return Reflect.get(target, prop, receiver);
                const full = path + '.' + prop;
                if (!(prop in target)) {
                    rec.violations.push('unmocked API ' + full);
                    throw new Error('browser mock: unmocked API ' + full);
                }
                const v = Reflect.get(target, prop, receiver);
                if (typeof v === 'function') return wrapFn(v, target, full);
                if (v && typeof v === 'object' && !Array.isArray(v)) return wrap(v, full);
                return v;
            },
        });
        proxies.set(obj, p);
        return p;
    };
    return wrap(root, rootName);
}

/** The page-side APIs the level-1 mock does not model, added to it in place. */
function addPageApis(browser, opts) {
    const perm = opts.permissions || {};
    browser.permissions = {
        async contains(q) { return perm.contains ? perm.contains(q) : true; },
        async request(q) { return perm.request ? perm.request(q) : true; },
        async getAll() { return { origins: ['<all_urls>'], permissions: [] }; },
        onAdded: makeEvent(), onRemoved: makeEvent(),
    };
    let tabId = 100;
    browser.tabs = {
        async create(p) { return { id: ++tabId, ...p }; },
        async query() { return []; },
        async update(id, p) { return { id, ...p }; },
        async getCurrent() { return { id: 5 }; },
        async remove() {},
        async get(id) { return { id }; },
        onRemoved: makeEvent(), onUpdated: makeEvent(), onActivated: makeEvent(),
    };
    browser.windows = {
        async getCurrent() { return { id: 1, type: 'normal' }; },
        async create(p) { return { id: 2, ...p }; },
        async update(id, p) { return { id, ...p }; },
    };
    browser.commands = {
        async getAll() { return [{ name: '_thunderai__do_action', shortcut: 'Ctrl+Alt+A' }]; },
        onCommand: makeEvent(),
    };
    browser.downloads = { async download() { return 1; } };
    browser.runtime.getPlatformInfo = async () => ({ os: 'win', arch: 'x86-64' });
    browser.runtime.openOptionsPage = async () => {};
    browser.runtime.getBrowserInfo = async () => ({ name: 'Thunderbird', version: '140.0' });
}

function makeEvent() {
    const listeners = [];
    return {
        _listeners: listeners,
        addListener(fn) { if (!listeners.includes(fn)) listeners.push(fn); },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener(fn) { return listeners.includes(fn); },
    };
}

// ---------------------------------------------------------------------------------------
// Timers and settling
// ---------------------------------------------------------------------------------------

/** Timers longer than this are not waited for by settle() (none of the pages' init needs it). */
const MAX_WAITED_TIMER_MS = 1000;

function trackTimers(host, rec) {
    const origSet = host.setTimeout;
    const origClear = host.clearTimeout;
    host.setTimeout = function (fn, ms = 0, ...args) {
        let handle;
        const run = typeof fn === 'function' ? fn : () => {};
        handle = origSet.call(host, (...a) => {
            rec.timers.delete(handle);
            run(...a);
        }, ms, ...args);
        if (ms <= MAX_WAITED_TIMER_MS) rec.timers.add(handle);
        return handle;
    };
    host.clearTimeout = function (handle) {
        rec.timers.delete(handle);
        return origClear.call(host, handle);
    };
}

// ---------------------------------------------------------------------------------------
// openPage()
// ---------------------------------------------------------------------------------------

/**
 * Open a page. Returns the page context:
 *
 *   window, document, $(sel), $$(sel)
 *   ctl, con, mods                   as from startPage() (mock controller, console, modules)
 *   fire(el, type, init?)            dispatch a bubbling event, then settle()
 *   click(el)                        el.click(), then settle()
 *   settle()                         wait until the page is idle again
 *   apiCalls(api?)                   every browser.* call the page made (optionally filtered)
 *   fetchCalls                       every fetch() the page attempted (all rejected)
 *   dialogs                          alert / confirm / prompt / window.close calls
 *   violations, rejections, jsdomErrors   what assertHarnessClean() checks
 *   close()
 *
 * @param {string} page   a PAGES key
 * @param {object} opts
 *   policy, local, accounts   as for startPage()
 *   permissions               {contains(q), request(q)} overrides (default: granted)
 *   commands                  {command: (message) => reply} overrides / additions
 *   confirm, prompt           what window.confirm / window.prompt return (default true / '')
 *   query                     search string appended to the page url (e.g. '?llm=...')
 */
export async function openPage(page, opts = {}) {
    const rel = PAGES[page];
    if (!rel) throw new Error('dom-page: unknown page "' + page + '"');
    const html = readFileSync(repoPath(rel), 'utf8');
    const url = EXT_ORIGIN + rel + (opts.query || '');

    const rec = {
        violations: [],
        rejections: [],
        jsdomErrors: [],
        apiCalls: [],
        fetchCalls: [],
        dialogs: [],
        timers: new Set(),
        inflight: 0,
        track(p) {
            rec.inflight++;
            Promise.resolve(p).then(() => { rec.inflight--; }, () => { rec.inflight--; });
        },
    };

    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', e => rec.jsdomErrors.push(String(e && e.message || e)));
    const dom = new JSDOM(html, { url, pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    const { document } = window;

    // Let jsdom finish its own parse-time events first, so the DOMContentLoaded dispatched
    // below is the only one the page ever sees (menu_order does not listen with {once}).
    if (document.readyState !== 'complete') {
        await new Promise(r => window.addEventListener('load', r, { once: true }));
    }

    // 2. window globals
    for (const name of WINDOW_GLOBALS) {
        if (window[name] === undefined) continue;
        const value = name === 'window' ? window : window[name];
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
    globalThis.self = window;

    // Stubs for what jsdom does not implement (listed in tests/README.md).
    const answerConfirm = opts.confirm ?? true;
    const answerPrompt = opts.prompt ?? '';
    const dialog = (kind, ret) => (...args) => { rec.dialogs.push({ kind, args }); return ret; };
    for (const host of [window, globalThis]) {
        host.alert = dialog('alert', undefined);
        host.confirm = dialog('confirm', answerConfirm);
        host.prompt = dialog('prompt', answerPrompt);
    }
    window.close = dialog('close', undefined);
    window.scrollTo = () => {};
    window.Element.prototype.scrollIntoView = function () {};
    globalThis.fetch = async (...args) => {
        rec.fetchCalls.push({ url: String(args[0] && args[0].url || args[0]), init: args[1] });
        throw new TypeError('fetch is disabled in the DOM tests');
    };
    trackTimers(globalThis, rec);
    trackTimers(window, rec);

    const onRejection = reason => rec.rejections.push(String(reason && reason.stack || reason));
    process.on('unhandledRejection', onRejection);

    // 3. mock + modules + background
    let mods = null;
    let commands = null;
    const ctx = await startPage({
        policy: opts.policy ?? null,
        local: opts.local,
        accounts: opts.accounts,
        sender: { url, id: 'thunderai@micz.it' },
        external: async () => null, // no other add-on (the Sparks presence check)
        decorate(ctl) {
            addPageApis(ctl.browser, opts);
            const strict = strictProxy(ctl.browser, rec);
            globalThis.browser = strict;
            globalThis.messenger = strict;
        },
        onOtherMessage(message, sender) {
            const command = message && message.command;
            if (commands && Object.hasOwn(commands, command)) return commands[command](message, sender);
            rec.violations.push('unmocked background command ' + JSON.stringify(message));
            throw new Error('dom-page: unmocked background command ' + JSON.stringify(command ?? message));
        },
    });
    mods = ctx;
    commands = { ...defaultCommands(mods), ...(opts.commands || {}) };

    // Mutations, for settle().
    let mutations = 0;
    const observer = new window.MutationObserver(list => { mutations += list.length; });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

    // The cap is a safety net against a page that never goes idle, not a timing assumption:
    // it is wall-clock time and includes the page's whole init, which a loaded CI machine
    // running many jsdom files in parallel can stretch well past a few seconds.
    const settle = async ({ cap = 30000 } = {}) => {
        const start = Date.now();
        let quiet = 0;
        while (quiet < 3) {
            if (Date.now() - start > cap) {
                throw new Error('dom-page: ' + page + ' did not settle within ' + cap + ' ms ('
                    + rec.inflight + ' browser promises, ' + rec.timers.size + ' timers pending)');
            }
            const before = mutations;
            if (rec.inflight === 0 && rec.timers.size > 0) {
                await new Promise(r => setImmediate(r));
            }
            await new Promise(r => setImmediate(r));
            if (rec.inflight === 0 && rec.timers.size === 0 && mutations === before) quiet++;
            else quiet = 0;
        }
    };

    // 4. classic scripts, in document order
    const scripts = [...document.querySelectorAll('script[src]')];
    const pageDir = new URL(rel, REPO);
    for (const s of scripts) {
        if (s.type === 'module') continue;
        const file = new URL(s.getAttribute('src'), pageDir);
        vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file.pathname });
    }
    // 5. the module script(s)
    for (const s of scripts) {
        if (s.type !== 'module') continue;
        await import(new URL(s.getAttribute('src'), pageDir).href);
    }
    // 6. DOMContentLoaded
    document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await settle();

    const page_ctx = {
        page, url, window, document,
        $: sel => document.querySelector(sel),
        $$: sel => [...document.querySelectorAll(sel)],
        ctl: ctx.ctl, con: ctx.con, mods,
        bgManaged: ctx.bgManaged,
        settle,
        async fire(el, type, init = {}) {
            const Ctor = type === 'input' ? window.InputEvent
                : (type === 'keydown' || type === 'keyup') ? window.KeyboardEvent
                : (type === 'click' || type === 'mousedown') ? window.MouseEvent : window.Event;
            el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
            await settle();
        },
        async click(el) {
            el.click();
            await settle();
        },
        apiCalls: api => rec.apiCalls.filter(c => !api || c.api === api),
        fetchCalls: rec.fetchCalls,
        dialogs: rec.dialogs,
        violations: rec.violations,
        rejections: rec.rejections,
        jsdomErrors: rec.jsdomErrors,
        /** The storage.local writes made since `since` (an index into ctl.calls). */
        localWrites(since = 0) {
            return ctx.ctl.calls.slice(since).filter(c => c.area === 'local' && c.op === 'set');
        },
        close() {
            observer.disconnect();
            process.off('unhandledRejection', onRejection);
            window.close = () => {};
            dom.window.close();
        },
    };
    return page_ctx;
}

/**
 * The check every DOM test file ends with: the page ran entirely on modelled APIs, with no
 * unhandled rejection and no "not implemented" from jsdom. A page the harness cannot run
 * shows up here, with the reason, instead of silently passing fewer tests.
 */
export function assertHarnessClean(ctx) {
    assert.deepEqual(ctx.violations, [], 'unmocked APIs / background commands');
    assert.deepEqual(ctx.rejections, [], 'unhandled promise rejections');
    assert.deepEqual(ctx.jsdomErrors, [], 'jsdom errors (not implemented / script errors)');
}

/** browser.i18n.getMessage, from the real _locales/en/messages.json. */
export const msg = (key, subs) => globalThis.browser.i18n.getMessage(key, subs);

/** Every control managed-ui.js considers: .option-input and [data-mzta-pref]. */
export function managedControls(document) {
    return [...document.querySelectorAll('.option-input, [data-mzta-pref]')];
}

/** The preference key of a control, by the spec's rule: data-mzta-pref, else the id. */
export function controlKey(el) {
    if (el.dataset.mztaPref) return el.dataset.mztaPref;
    if (el.classList.contains('option-input')) return el.id || '';
    return '';
}

/** Everything the managed code leaves in a page, for the "no policy" checks. */
export function managedArtifacts(document) {
    return {
        marked: [...document.querySelectorAll('[data-mzta-managed]')].map(e => e.id || e.tagName),
        markers: document.querySelectorAll('.managed_marker').length,
        secrets: document.querySelectorAll('.managed_secret').length,
        disabledLinks: document.querySelectorAll('.managed_disabled').length,
        bannerShown: !!document.querySelector('#managed_config_banner.shown'),
        restrictionNotes: [...document.querySelectorAll('.managed_restriction_note.shown, #managed_restriction_note.shown, #managed_restriction_defaults_note.shown')].length,
    };
}

