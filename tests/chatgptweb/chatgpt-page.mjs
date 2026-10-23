/*
 *  The ChatGPT page, for the DOM tests of the content script (tests/dom/chatgpt/chatgptweb-*).
 *
 *  openChatGPTHost() opens one document through the core openDocument(): the mock behind the
 *  strict proxy, the console capture, assertHarnessClean(). Every scenario then runs in an iframe
 *  of its own inside it (startScenario()), so each gets a fresh page and a fresh instance of the
 *  injected script, as each ChatGPT window does: the script's top-level `let`s, its listeners and
 *  its observers belong to that iframe and die with it.
 *
 *  What runs is what the background injects: the pre-script cut out of mzta-background.js
 *  (./pre-script.mjs), built from the preferences of the scenario, followed by the real
 *  `mzta_script` (the plugin hands it to the ctx as `chatgptWebScript`). It is evaluated with the
 *  iframe's DOM as its bare names (window, document, MutationObserver, KeyboardEvent...), the
 *  scenario's clock as its timers (./fake-clock.mjs), and the mock as `browser`, but for
 *  runtime.onMessage, which is the scenario's own: the background's `chatgpt_send` reaches that one
 *  iframe. Nothing of the script is replaced or stubbed: the prompt is sent through its own send
 *  function, and the completion wait runs as it does in the page until the scenario is disposed.
 *
 *  Done on the test side because jsdom does not do it:
 *   - layout: every rendered element gets a non-zero box (getBoundingClientRect, getClientRects);
 *     one that is disconnected, `hidden` or under `display: none` (itself or an ancestor, as
 *     computed) gets an empty one. The script's isElementVisible() reads exactly that;
 *   - the Radix model picker of the fixture (wirePicker()): Enter on the trigger opens a copy of
 *     the menu <template>, appended to the body and focused; Escape in the menu closes it; the
 *     simple view's toggle enters the advanced view (one way, as observed live); a model row clicked
 *     is counted (the verifier must never change the selection);
 *   - the send: a click on the fixture's send button counts a send and empties the composer, as
 *     ChatGPT does.
 *
 *  No jsdom import here: the window globals are already installed by openDocument().
 */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { openDocument } from '../helpers/core/dom-harness.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import {
    createClock,
    flush
} from './fake-clock.mjs';
import { buildPreScript } from './pre-script.mjs';

const fixture = name => readFileSync(repoPath('tests/fixtures/chatgptweb/' + name), 'utf8');

const HOST_HTML = '<!doctype html><html><head><title>ChatGPT</title></head><body></body></html>';

/** The prompt the background sends with `chatgpt_send` (action "0": a plain chat). */
export const SEND_MESSAGE = {
    command: 'chatgpt_send',
    prompt: 'ThunderAI model verification test.',
    action: '0',
    tabId: 3,
    mailMessageId: -1,
    prompt_info: {},
};

/** The one document the scenarios of a file run in. */
export async function openChatGPTHost() {
    return openDocument({ html: HOST_HTML, url: 'https://chatgpt.com/', name: 'chatgpt-web' });
}

/** Rendered boxes for the iframe's elements: see the header. */
function modelLayout(win) {
    const box = () => ({ x: 10, y: 10, top: 10, left: 10, width: 120, height: 24, right: 130, bottom: 34 });
    const empty = () => ({ x: 0, y: 0, top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 });
    const rendered = el => {
        if (!el.isConnected) return false;
        for (let n = el; n; n = n.parentElement) {
            if (n.hidden || win.getComputedStyle(n).display === 'none') return false;
        }
        return true;
    };
    win.Element.prototype.getBoundingClientRect = function () { return rendered(this) ? box() : empty(); };
    win.Element.prototype.getClientRects = function () { return rendered(this) ? [box()] : []; };
}

/** The bare names the injected script reads from its page, bound to the iframe. */
function pageScope(win, clock, browser, observers) {
    class TrackedMutationObserver extends win.MutationObserver {
        constructor(callback) {
            super(callback);
            this._record = { options: null, connected: false };
            observers.push(this._record);
        }
        observe(target, options) {
            this._record.options = options;
            this._record.connected = true;
            return super.observe(target, options);
        }
        disconnect() {
            this._record.connected = false;
            return super.disconnect();
        }
    }
    return {
        window: win,
        document: win.document,
        location: win.location,
        navigator: win.navigator,
        Node: win.Node,
        NodeFilter: win.NodeFilter,
        ShadowRoot: win.ShadowRoot,
        HTMLTextAreaElement: win.HTMLTextAreaElement,
        MutationObserver: TrackedMutationObserver,
        // the harness's stub (no layout, so it never calls back)
        ResizeObserver: globalThis.ResizeObserver,
        KeyboardEvent: win.KeyboardEvent,
        Event: win.Event,
        DOMParser: win.DOMParser,
        getComputedStyle: el => win.getComputedStyle(el),
        alert: globalThis.alert,
        ...clock.globals,
        browser,
    };
}

/** The mock as the content script sees it, but for its own runtime.onMessage. */
function contentScriptBrowser(strict, listeners) {
    const onMessage = {
        addListener(fn) { if (!listeners.includes(fn)) listeners.push(fn); },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener(fn) { return listeners.includes(fn); },
    };
    const runtime = new Proxy({}, {
        get: (_, prop) => (prop === 'onMessage' ? onMessage : strict.runtime[prop]),
        has: (_, prop) => prop === 'onMessage' || prop in strict.runtime,
    });
    return new Proxy({}, {
        get: (_, prop) => (prop === 'runtime' ? runtime : strict[prop]),
        has: (_, prop) => prop in strict,
    });
}

/**
 * Start one scenario: a fresh ChatGPT page in an iframe, the script injected with the scenario's
 * preferences. Nothing is sent yet: h.send() delivers the background's `chatgpt_send`.
 *
 * @param ctx   openChatGPTHost()
 * @param {object} o
 *   ui             'new' (the newer picker, fixtures/chatgptweb/model-picker.html), 'old' (a Radix
 *                  model switcher showing "5 Thinking", old-ui-model-picker.html) or 'free' (the
 *                  newer page with no model selector at all)
 *   model          chatgpt_web_model, as typed in the settings ('' for none)
 *   extendedCheck  chatgpt_web_model_extended_check; left out = the default, unset in the prefs
 *   effort         the trigger's data-selected-reasoning-effort
 *   selected       the label of the selected row of the menu
 *   composer       false: the page has no composer
 *   customGpt      a Custom GPT is opened
 *   debug          do_debug (default on: the tests read the script's log)
 */
export async function startScenario(ctx, {
    ui = 'new',
    model = 'gpt-6',
    extendedCheck,
    effort = 'none',
    selected = 'GPT-6',
    composer = true,
    customGpt = false,
    debug = true,
} = {}) {
    const iframe = ctx.document.createElement('iframe');
    ctx.document.body.append(iframe);
    const win = iframe.contentWindow;
    const doc = win.document;
    modelLayout(win);
    doc.body.innerHTML = fixture(ui === 'old' ? 'old-ui-model-picker.html' : 'model-picker.html');
    if (ui === 'free') doc.getElementById('radix-model-trigger').remove();
    if (!composer) doc.getElementById('prompt-textarea').remove();

    const events = { sends: 0, opens: 0, closes: 0, viewClicks: 0, modelClicks: 0, sentTexts: [] };
    const template = doc.getElementById('model-menu-fixture')?.content ?? null;
    if (template) template.querySelector('[data-model-selected] [data-menu-row-content] > span').textContent = selected;
    const trigger = doc.getElementById('radix-model-trigger');
    if (trigger) trigger.setAttribute('data-selected-reasoning-effort', effort);

    /** The Radix picker model on a trigger (the fixture's, or a test's replacement). */
    function wirePicker(button) {
        button.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || button.getAttribute('aria-expanded') === 'true') return;
            events.opens++;
            button.setAttribute('aria-expanded', 'true');
            const menu = doc.getElementById('model-menu-fixture').content.firstElementChild.cloneNode(true);
            menu.setAttribute('aria-labelledby', button.id);
            menu.querySelector('[data-model-picker-view-toggle]').addEventListener('click', () => {
                events.viewClicks++;
                menu.querySelector('[data-model-picker-view]').setAttribute('data-model-picker-view', 'advanced');
                const simpleTrack = menu.querySelector('[data-model-picker-view-toggle]').closest('[data-active]');
                simpleTrack.setAttribute('aria-hidden', 'true');
                simpleTrack.setAttribute('data-active', 'false');
                simpleTrack.setAttribute('inert', '');
                const modelTrack = menu.querySelector('[role="menuitemradio"]').closest('[data-active]');
                modelTrack.setAttribute('aria-hidden', 'false');
                modelTrack.setAttribute('data-active', 'true');
                modelTrack.removeAttribute('inert');
            });
            menu.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                events.closes++;
                button.setAttribute('aria-expanded', 'false');
                menu.remove();
            });
            menu.querySelectorAll('[role="menuitemradio"]').forEach(row => row.addEventListener('click', () => events.modelClicks++));
            doc.body.append(menu);
            menu.focus();
        });
    }
    if (trigger) wirePicker(trigger);

    const composerEl = () => doc.getElementById('prompt-textarea');
    doc.getElementById('composer-submit-button').addEventListener('click', () => {
        const el = composerEl();
        events.sends++;
        events.sentTexts.push(el ? el.textContent : null);
        if (el) el.innerHTML = '';
    });

    const prefs = { ...ctx.mods.prefs_default, chatgpt_web_model: model, do_debug: debug };
    if (extendedCheck !== undefined) prefs.chatgpt_web_model_extended_check = extendedCheck;
    const preScript = buildPreScript({ browser: globalThis.browser, utils: ctx.mods.utils, prefs, customGpt });

    const clock = createClock();
    const observers = [];
    const listeners = [];
    const scope = pageScope(win, clock, contentScriptBrowser(globalThis.browser, listeners), observers);
    const logStart = ctx.con.entries.length;
    // eslint-disable-next-line no-new-func
    new Function(...Object.keys(scope), preScript + ctx.mods.chatgptWebScript)(...Object.values(scope));
    await flush();

    const $ = sel => doc.querySelector(sel);
    const h = {
        win, doc, $, clock, events, trigger, preScript,
        wirePicker,
        composer: composerEl,
        /** The open model menu, if any. */
        menu: () => $('[role="menu"]'),
        /**
         * Another Radix element of the page (an account menu): the page is not free of Radix
         * elements, so the legacy check cannot take it for a free account.
         */
        addOtherRadixElement() {
            const b = doc.createElement('button');
            b.id = 'radix-account-menu';
            b.setAttribute('aria-haspopup', 'menu');
            b.innerHTML = '<span>Account</span>';
            doc.body.prepend(b);
            return b;
        },
        /** The selected row's label in the menu template (what the next opened menu shows). */
        template,
        advance: ms => clock.advance(ms),
        flush,
        /** The background's chatgpt_send, delivered to this page's script. */
        async send(message = SEND_MESSAGE) {
            for (const fn of [...listeners]) fn(structuredClone(message), { id: 'thunderai@micz.it' }, () => {});
            await flush();
        },
        /** The user opens the picker (Enter on the trigger, as Radix expects). */
        openMenu(button = trigger) {
            button.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        },
        /** The model warning and its "Use the current model" button, as shown. */
        warningShown: () => $('#mzta-model_warn')?.style.display === 'inline-block',
        manualButtonShown: () => $('#mzta-btn_model')?.style.display === 'inline',
        async clickManual() {
            $('#mzta-btn_model').click();
            await flush();
        },
        async pagehide() {
            win.dispatchEvent(new win.Event('pagehide'));
            await flush();
        },
        /** The script's own log lines since the scenario started (do_debug on). */
        logs: () => ctx.con.entries.slice(logStart).map(e => e.msg).filter(m => m.startsWith('[ThunderAI | ChatGPT Web] ')),
        /**
         * What the model check holds while it runs: its MutationObserver (the only one of the script
         * that watches characterData), its 200 ms poll (`check`) and its deadline (`onTimeout`).
         */
        verifierResources: () => ({
            observers: observers.filter(o => o.connected && o.options?.characterData).length,
            timers: clock.pending().filter(t => t.name === 'onTimeout' || (t.kind === 'interval' && t.name === 'check')).length,
        }),
        /** The model check holds nothing any more, never changed the model, and nothing threw. */
        assertVerifierClean() {
            assert.deepEqual(h.verifierResources(), { observers: 0, timers: 0 }, 'the model check left an observer or a timer');
            assert.equal(events.modelClicks, 0, 'a model row was clicked: the selection was changed');
        },
        dispose() {
            listeners.length = 0;
            iframe.remove();
        },
    };
    return h;
}

/**
 * Run `fn(h)` on a new scenario (see startScenario()), then check that no callback of the page
 * threw, and dispose of it whatever happened.
 */
export async function scenario(ctx, opts, fn) {
    const h = await startScenario(ctx, opts);
    try {
        await fn(h);
        assert.deepEqual(h.clock.errors.map(e => String(e && e.stack || e)), [], 'a timer callback of the page threw');
    } finally {
        h.dispose();
    }
}
