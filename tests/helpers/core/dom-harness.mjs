/*
 *  DOM harness: one extension page, loaded for real, in jsdom.
 *
 *  jsdom does not execute <script type="module">, so this does what the browser does, in
 *  the browser's order:
 *
 *    1. parse the page's real HTML file at its moz-extension:// url;
 *    2. expose the jsdom window's globals (window, document, the DOM classes) on globalThis,
 *       where the page's module code looks them up;
 *    3. install the browser mock (startPage(): the page context plus whatever background the
 *       plugins start for it), extended with the page-side APIs (addPageApis() and the
 *       plugins' pageApis()) and wrapped in a Proxy that THROWS on any API it does not model;
 *    4. run the page's classic scripts in document order (js/mzta-i18n.js -> `i18n`,
 *       pages/_lib/list.js -> `List`): classic scripts run during parsing, before the
 *       deferred module script. The globals they create are mirrored onto the window, which in
 *       a browser is the global object (`window.markdownit`);
 *    5. import() the page's own module script;
 *    6. dispatch DOMContentLoaded and wait until the page has settled.
 *
 *  The background end of runtime.sendMessage is the real background code wherever it can be
 *  run without starting mzta-background.js: the plugins cut their listeners out of it verbatim
 *  (./background-source.mjs) and answer first. The few other commands a page sends get a fixed,
 *  minimal answer (defaultCommands() below, then the plugins' pageCommands(), then
 *  opts.commands); anything else is a recorded violation. The order is in ./plugins.mjs.
 *
 *  openDocument() runs the same steps on a document that is not a page file: given HTML, given
 *  classic scripts, given modules (a content script in a mail, a module that needs a DOM). The
 *  two share one implementation, openContext().
 *
 *  One file = one page = one scenario, as for the level-1 suite: the page's modules are
 *  singletons, loaded once per process.
 *
 *  This is the only core file that imports jsdom: level 1 never reaches it.
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { EXT_ORIGIN } from './browser-mock.mjs';
import {
    startPage,
    remoteFields,
    repoPath,
    REPO,
} from './load.mjs';
import { plugins } from './plugins.mjs';

/** The pages every branch has: name -> HTML path, relative to the repository root. */
const CORE_PAGES = {
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
    'webchat': 'api_webchat/index.html',
};

/**
 * Every page the suite can open: the core ones plus each plugin's `pages`, merged when this
 * module loads, so the export is complete from the first import. A name defined twice (by the
 * core and a plugin, or by two plugins) is an error, never a silent override.
 */
export const PAGES = { ...CORE_PAGES };
{
    const owner = Object.fromEntries(Object.keys(CORE_PAGES).map(name => [name, 'the core']));
    for (const p of await plugins()) {
        for (const [name, rel] of Object.entries(p.pages || {})) {
            if (Object.hasOwn(PAGES, name)) {
                throw new Error('dom-page: page "' + name + '" defined by both ' + owner[name]
                    + ' and the ' + p.name + ' plugin');
            }
            PAGES[name] = rel;
            owner[name] = 'the ' + p.name + ' plugin';
        }
    }
}

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
    // The webchat page is built from custom elements with open shadow roots.
    'customElements', 'ShadowRoot', 'NodeFilter',
];

/**
 * The background commands a page may send that no plugin's real code answers, with the minimal
 * answer that lets it run. The baseline: plugins add to it with pageCommands(), opts.commands
 * overrides both. Anything not here is recorded as a violation and rejected, like an unmocked
 * API.
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

/**
 * The page-side APIs the level-1 mock does not model, added to it in place. The baseline: a
 * plugin adds its own with pageApis(browser, opts), called right after this.
 */
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

/**
 * requestAnimationFrame, tracked like the timers: jsdom provides it (pretendToBeVisual) on the
 * window only, and page modules call it as a bare name, so the tracked pair goes on both. A
 * frame is pending from the request until its callback runs or it is cancelled.
 */
function trackFrames(window, rec) {
    const origRequest = window.requestAnimationFrame.bind(window);
    const origCancel = window.cancelAnimationFrame.bind(window);
    const request = function (callback) {
        let handle;
        handle = origRequest((time) => {
            rec.frames.delete(handle);
            callback(time);
        });
        rec.frames.add(handle);
        return handle;
    };
    const cancel = function (handle) {
        rec.frames.delete(handle);
        return origCancel(handle);
    };
    for (const host of [window, globalThis]) {
        host.requestAnimationFrame = request;
        host.cancelAnimationFrame = cancel;
    }
}

/**
 * ResizeObserver, which jsdom does not implement. With no layout nothing ever resizes, so the
 * stub never calls back: it records each observer (its callback, what it observes, whether it
 * was disconnected) in rec.resizeObservers.
 */
function stubResizeObserver(window, rec) {
    class ResizeObserver {
        constructor(callback) {
            this._record = { callback, targets: [], disconnected: false };
            rec.resizeObservers.push(this._record);
        }
        observe(target) { this._record.targets.push(target); }
        unobserve(target) {
            const i = this._record.targets.indexOf(target);
            if (i !== -1) this._record.targets.splice(i, 1);
        }
        disconnect() { this._record.targets.length = 0; this._record.disconnected = true; }
    }
    window.ResizeObserver = ResizeObserver;
    globalThis.ResizeObserver = ResizeObserver;
}

/**
 * navigator.clipboard, which jsdom does not implement: writeText() records the text in
 * rec.clipboard and resolves, readText() resolves to the last text written ('' before any).
 */
function stubClipboard(window, rec) {
    const clipboard = {
        writeText(text) {
            const p = Promise.resolve().then(() => { rec.clipboard.push(String(text)); });
            rec.track(p);
            return p;
        },
        readText() {
            const p = Promise.resolve(rec.clipboard.length ? rec.clipboard[rec.clipboard.length - 1] : '');
            rec.track(p);
            return p;
        },
    };
    Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true });
}

// ---------------------------------------------------------------------------------------
// openPage(), openDocument()
// ---------------------------------------------------------------------------------------

/**
 * Open a page. Returns the page context:
 *
 *   window, document, $(sel), $$(sel)
 *   ctl, con, mods                   as from startPage() (mock controller, console, modules)
 *   ...                              the fields the plugins' remote backgrounds return
 *   fire(el, type, init?)            dispatch a bubbling event, then settle()
 *   click(el)                        el.click(), then settle()
 *   settle()                         wait until the page is idle again
 *   apiCalls(api?)                   every browser.* call the page made (optionally filtered)
 *   fetchCalls                       every fetch() the page attempted (all rejected)
 *   dialogs                          alert / confirm / prompt / window.close calls
 *   clipboard                        every text written with navigator.clipboard.writeText()
 *   resizeObservers                  every ResizeObserver created: {callback, targets, disconnected}
 *   violations, rejections, jsdomErrors   what assertHarnessClean() checks
 *   close()
 *
 * @param {string} page   a PAGES key
 * @param {object} opts
 *   policy, local, session, accounts   as for startPage()
 *   permissions               {contains(q), request(q)} overrides (default: granted)
 *   commands                  {command: (message) => reply} overrides / additions
 *   confirm, prompt           what window.confirm / window.prompt return (default true / '')
 *   query                     search string appended to the page url (e.g. '?llm=...')
 */
export async function openPage(page, opts = {}) {
    const rel = PAGES[page];
    if (!rel) throw new Error('dom-page: unknown page "' + page + '"');
    const pageDir = new URL(rel, REPO);
    return openContext({
        name: page,
        html: readFileSync(repoPath(rel), 'utf8'),
        url: EXT_ORIGIN + rel + (opts.query || ''),
        // The page's own <script src> tags, in document order: the classic ones run, then the
        // module ones are imported.
        scripts(document) {
            const tags = [...document.querySelectorAll('script[src]')];
            const at = s => new URL(s.getAttribute('src'), pageDir);
            return {
                classic: tags.filter(s => s.type !== 'module').map(at),
                modules: tags.filter(s => s.type === 'module').map(at),
            };
        },
        domContentLoaded: true,
    }, opts);
}

/**
 * Open a document that is not a page file of the add-on: given HTML, given classic scripts,
 * given modules. What a content script runs in (a mail in the message display, the body of a
 * compose window), or the background page for a module that needs a DOM. Same mock, same strict
 * proxy, same tracking and the same ctx as openPage(), plus:
 *
 *   imports                          {path: namespace} of the `modules` imported
 *
 * The steps are openPage()'s, with the scripts taken from the options instead of the HTML:
 * parse `html` at `url`, expose the window globals, install the mock (`apis` extends it before
 * the strict proxy), run `scripts` in order as classic scripts (mirrored onto the window),
 * import `modules` in order, settle. No DOMContentLoaded is dispatched: a content script is
 * injected into a document that has already loaded (document_idle), and jsdom fired the
 * document's own.
 *
 * One process, one document, as for a page: the scripts' top-level `const`s and the modules'
 * singletons live in the process.
 *
 * @param {object} opts
 *   html        the document's markup (a whole document, or a body fragment jsdom completes)
 *   url         the document's url, also the sender url of its runtime.sendMessage (default
 *               'about:blank')
 *   name        a label for the error messages (default 'document')
 *   scripts     repository-relative classic scripts, run in this order
 *   modules     repository-relative modules, imported in this order after the scripts
 *   apis(browser, opts)   adds the browser.* APIs this document needs to the mock, before the
 *               strict proxy wraps it (as a plugin's pageApis(), for this document only)
 *   ...         every option of openPage() but `query`
 */
export async function openDocument(opts = {}) {
    if (typeof opts.html !== 'string') throw new Error('dom-page: openDocument() needs the html');
    const scripts = (opts.scripts || []).map(rel => new URL(rel, REPO));
    const modules = (opts.modules || []).map(rel => new URL(rel, REPO));
    return openContext({
        name: opts.name || 'document',
        html: opts.html,
        url: opts.url || 'about:blank',
        scripts: () => ({ classic: scripts, modules }),
        domContentLoaded: false,
        apis: opts.apis,
        keepImports: opts.modules || [],
    }, opts);
}

/**
 * What openPage() and openDocument() share: everything from the parse to the returned ctx.
 *
 * @param {object} what
 *   name, html, url
 *   scripts(document) -> {classic: [file URL], modules: [file URL]}
 *   domContentLoaded   dispatch DOMContentLoaded once the scripts ran (a page), or not
 *   apis               optional (browser, opts) => void, before the strict proxy
 *   keepImports        the repository paths of `modules`, to return their namespaces as `imports`
 */
async function openContext(what, opts) {
    const { name: page, html, url } = what;

    const rec = {
        violations: [],
        rejections: [],
        jsdomErrors: [],
        apiCalls: [],
        fetchCalls: [],
        dialogs: [],
        clipboard: [],
        resizeObservers: [],
        timers: new Set(),
        frames: new Set(),
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
    trackFrames(window, rec);
    stubResizeObserver(window, rec);
    stubClipboard(window, rec);

    const onRejection = reason => rec.rejections.push(String(reason && reason.stack || reason));
    process.on('unhandledRejection', onRejection);

    // 3. mock + modules + background
    const pluginList = await plugins();
    let mods = null;
    let commands = null;
    const ctx = await startPage({
        policy: opts.policy ?? null,
        local: opts.local,
        session: opts.session,
        accounts: opts.accounts,
        sender: { url, id: 'thunderai@micz.it' },
        external: async () => null, // no other add-on (the Sparks presence check)
        decorate(ctl) {
            addPageApis(ctl.browser, opts);
            for (const p of pluginList) if (p.pageApis) p.pageApis(ctl.browser, opts);
            if (what.apis) what.apis(ctl.browser, opts);
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
    commands = { ...defaultCommands(mods) };
    for (const p of pluginList) if (p.pageCommands) Object.assign(commands, p.pageCommands(mods));
    Object.assign(commands, opts.commands || {});

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
                    + rec.inflight + ' browser promises, ' + rec.timers.size + ' timers, '
                    + rec.frames.size + ' animation frames pending)');
            }
            const before = mutations;
            if (rec.inflight === 0 && (rec.timers.size > 0 || rec.frames.size > 0)) {
                await new Promise(r => setImmediate(r));
            }
            await new Promise(r => setImmediate(r));
            if (rec.inflight === 0 && rec.timers.size === 0 && rec.frames.size === 0
                && mutations === before) quiet++;
            else quiet = 0;
        }
    };

    // 4. classic scripts, in order
    const scripts = what.scripts(document);
    const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
    for (const file of scripts.classic) {
        vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file.pathname });
    }
    // In a browser the window IS the global object, so what a classic script defines is reachable
    // both as a bare name and as window.<name> (markdown-it.min.js -> window.markdownit). Here the
    // scripts ran in Node's global context: mirror every global they created onto the jsdom window,
    // never over a property the window already has.
    for (const name of Object.getOwnPropertyNames(globalThis)) {
        if (globalsBefore.has(name) || name in window) continue;
        Object.defineProperty(window, name, {
            get: () => globalThis[name],
            set: (v) => { globalThis[name] = v; },
            configurable: true,
            enumerable: false,
        });
    }
    // 5. the module script(s)
    const imported = [];
    for (const file of scripts.modules) imported.push(await import(file.href));
    // 6. DOMContentLoaded (a page only)
    if (what.domContentLoaded) {
        document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    }
    await settle();

    const page_ctx = {
        page, url, window, document,
        ...(what.keepImports
            ? { imports: Object.fromEntries(what.keepImports.map((rel, i) => [rel, imported[i]])) }
            : {}),
        $: sel => document.querySelector(sel),
        $$: sel => [...document.querySelectorAll(sel)],
        ctl: ctx.ctl, con: ctx.con, mods,
        ...remoteFields(ctx),
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
        clipboard: rec.clipboard,
        resizeObservers: rec.resizeObservers,
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
