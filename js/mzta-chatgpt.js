/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


// Some original methods derived from https://github.com/KudoAI/chatgpt.js/blob/7eb8463cd61143fa9e1d5a8ec3c14d3c1b286e54/chatgpt.js
// Using a full string to inject it in the ChatGPT page to avoid any security error

export const mzta_script = `
let force_go = false;
let do_force_completion = false;
let current_message = null;
let current_action = null;
let current_tabId = null;
let current_mailMessageId = null;
let selectionChangeTimeout = null;
let isDragging = false;
let delay_wait_completion = 7000; // milliseconds
let _customTextArray = [];
let _currentCustomTextIndex = 0;
let lastSelectedHtml = "";
// composer the user clicked into when no selector matched, reused on retry
let user_selected_composer = null;
// composer used for the last send, needed by the completion diagnostics
let current_composer_el = null;
// message counts taken just before sending, so an older answer is never taken as the new one
let send_baseline = null;
let last_send_button_strategy = null;

// Composer lookup, in priority order. ChatGPT rolls out different composers
// (A/B tests), so a single id lookup is not enough (issues #890, #920, #924).
const PROMPT_INPUT_SELECTORS = [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"][data-composer-markdown]',
    '[contenteditable="true"][role="textbox"][data-virtualkeyboard]',
    'div.ProseMirror[contenteditable="true"]',
    'form [contenteditable="true"]',
    'textarea[name="prompt-textarea"]',
    'form textarea',
    'main [contenteditable="true"]'
];
const SHADOW_WALK_MAX_NODES = 5000;
const SHADOW_WALK_MAX_DEPTH = 5;

// null when visible, otherwise why the element is considered invisible
function getHiddenReason(el) {
    if (!el || !el.isConnected) return 'disconnected';
    if (el.hidden) return 'hidden-attr';
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return 'display-none';
    if (style.visibility === 'hidden') return 'visibility-hidden';
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 'zero-size';
    return null;
}

function isElementVisible(el) {
    return getHiddenReason(el) === null;
}

// Our own injected UI (e.g. the custom text textarea) must never be taken for the composer
function isOwnUiElement(el) {
    return el.closest('.mzta-header-fixed, [id^="mzta-"]') !== null;
}

// Bounded recursive walk collecting the open shadow roots of the page
function getOpenShadowRoots() {
    const roots = [];
    const budget = { left: SHADOW_WALK_MAX_NODES };
    const walk = (root, depth) => {
        if (depth > SHADOW_WALK_MAX_DEPTH) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode();
        while (node && budget.left > 0) {
            budget.left--;
            if (node.shadowRoot) {
                roots.push(node.shadowRoot);
                walk(node.shadowRoot, depth + 1);
            }
            node = walker.nextNode();
        }
    };
    walk(document.documentElement, 0);
    // true when the walk stopped early, so some shadow roots may be missing
    roots.truncated = budget.left <= 0;
    return roots;
}

// Per selector: how many elements match, how many are visible, how many are our own UI
function getSelectorStats(roots) {
    return PROMPT_INPUT_SELECTORS.map(selector => {
        const stat = { selector: selector, matches: 0, visible: 0, ownUi: 0 };
        for (const root of roots) {
            for (const el of root.querySelectorAll(selector)) {
                stat.matches++;
                if (isOwnUiElement(el)) stat.ownUi++;
                else if (isElementVisible(el)) stat.visible++;
            }
        }
        return stat;
    });
}

function queryPromptInput(roots) {
    for (const selector of PROMPT_INPUT_SELECTORS) {
        for (const root of roots) {
            for (const el of root.querySelectorAll(selector)) {
                if (!isOwnUiElement(el) && isElementVisible(el)) {
                    return { el: el, selector: selector, inShadow: root !== document };
                }
            }
        }
    }
    return null;
}

// Resolves with the composer element as soon as it appears, or null after timeoutMs
async function findPromptInput(timeoutMs) {
    return new Promise(resolve => {
        let done = false;
        let observer = null;
        let pollId = null;
        let timeoutId = null;
        let progressId = null;
        const startTime = Date.now();
        doLog("findPromptInput start, timeout " + timeoutMs + " ms, readyState " + document.readyState);
        const finish = (found) => {
            if (done) return;
            done = true;
            if (observer) observer.disconnect();
            clearInterval(pollId);
            clearInterval(progressId);
            clearTimeout(timeoutId);
            if (found) {
                doLog("Prompt input found after " + (Date.now() - startTime) + " ms with selector: " + found.selector + (found.inShadow ? " (shadow DOM)" : ""));
                resolve(found.el);
            } else {
                doLog("Prompt input not found after " + timeoutMs + " ms");
                resolve(null);
            }
        };
        // the shadow DOM walk is the costly part, so it runs only on the polling tick
        const check = (withShadow) => {
            if (done) return;
            try {
                const roots = withShadow ? [document].concat(getOpenShadowRoots()) : [document];
                const found = queryPromptInput(roots);
                if (found) finish(found);
            } catch (err) {
                console.error('[ThunderAI] findPromptInput: ', err);
            }
        };
        check(true);
        if (done) return;
        observer = new MutationObserver(() => check(false));
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'contenteditable'] });
        pollId = setInterval(() => check(true), 250);
        timeoutId = setTimeout(() => finish(null), timeoutMs);
        if (mztaDoDebug == 1) {
            // shows whether the composer never appears or appears and disappears
            progressId = setInterval(() => {
                try {
                    const stats = getSelectorStats([document].concat(getOpenShadowRoots()));
                    doLog("findPromptInput still waiting after " + (Date.now() - startTime) + " ms, readyState " + document.readyState + ", selectors: " + JSON.stringify(stats.map(s => s.matches + "/" + s.visible + "/" + s.ownUi)) + " (matches/visible/ownUi)");
                } catch (err) {
                    console.error('[ThunderAI] findPromptInput progress: ', err);
                }
            }, 3000);
        }
    });
}

function getElementClass(el) {
    return typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
}

// "tag#id.firstClass" for up to 3 ancestors, closest first
function describeAncestors(el) {
    const parts = [];
    let node = el.parentElement;
    while (node && parts.length < 3) {
        const firstClass = getElementClass(node).trim().split(' ')[0];
        parts.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (firstClass ? '.' + firstClass.substring(0, 40) : ''));
        node = node.parentElement;
    }
    return parts.join(' < ');
}

// Runs one diagnostics section, so a failure there does not lose the whole log line
function diagSection(fn) {
    try {
        return fn();
    } catch (err) {
        return 'error: ' + (err && err.message ? err.message : String(err));
    }
}

// Logs page structure only: never page text or the prompt, users paste these logs on GitHub
function logPromptInputDiagnostics() {
    try {
        const shadowRoots = getOpenShadowRoots();
        const allRoots = [document].concat(shadowRoots);
        const queryAll = (selector) => allRoots.reduce((list, root) => list.concat(Array.from(root.querySelectorAll(selector))), []).filter(el => !isOwnUiElement(el));
        const countAll = (selector) => queryAll(selector).length;
        const countVisible = (selector) => queryAll(selector).filter(el => isElementVisible(el)).length;
        const candidates = diagSection(() => {
            const list = [];
            for (const root of allRoots) {
                for (const el of root.querySelectorAll('textarea, [contenteditable], input[type="text"]')) {
                    if (list.length >= 10) break;
                    if (isOwnUiElement(el)) continue;
                    const rect = el.getBoundingClientRect();
                    list.push({
                        tag: el.tagName.toLowerCase(),
                        id: el.id || '',
                        name: el.getAttribute('name') || '',
                        class: getElementClass(el).substring(0, 100),
                        role: el.getAttribute('role') || '',
                        testid: el.getAttribute('data-testid') || '',
                        ariaLabel: (el.getAttribute('aria-label') || '').substring(0, 60),
                        contenteditable: el.getAttribute('contenteditable'),
                        visible: isElementVisible(el),
                        hiddenReason: getHiddenReason(el),
                        w: Math.round(rect.width),
                        h: Math.round(rect.height),
                        inForm: el.closest('form') !== null,
                        inShadow: root !== document,
                        parents: describeAncestors(el)
                    });
                }
                if (list.length >= 10) break;
            }
            return list;
        });
        const title = document.title || '';
        const diag = {
            extVersion: diagSection(() => browser.runtime.getManifest().version),
            url: location.origin + location.pathname,
            authUrl: location.pathname.startsWith('/auth'),
            title: title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            hasFocus: diagSection(() => document.hasFocus()),
            msSinceLoad: Math.round(performance.now()),
            viewport: window.innerWidth + 'x' + window.innerHeight,
            lang: document.documentElement.lang || '',
            navigatorLang: navigator.language,
            selectors: diagSection(() => getSelectorStats(allRoots)),
            contenteditable: countAll('[contenteditable]'),
            textarea: countAll('textarea'),
            form: countAll('form'),
            main: countAll('main'),
            sendButton: countAll('[data-testid="send-button"]'),
            dialogs: diagSection(() => countVisible('[role="dialog"], [aria-modal="true"]')),
            alerts: diagSection(() => countVisible('[role="alert"]')),
            iframe: countAll('iframe'),
            iframeOrigins: diagSection(() => queryAll('iframe').slice(0, 5).map(f => {
                try { return new URL(f.src, location.href).origin; } catch (e) { return ''; }
            })),
            openShadowRoots: shadowRoots.length,
            shadowWalkTruncated: shadowRoots.truncated,
            // a composer inside a closed shadow root is visible only as its custom element
            customTags: diagSection(() => {
                const tags = new Set();
                for (const el of document.querySelectorAll('*')) {
                    if (tags.size >= 10) break;
                    if (el.tagName.includes('-')) tags.add(el.tagName.toLowerCase());
                }
                return Array.from(tags);
            }),
            candidates: candidates,
            loginButton: document.querySelector('button[data-testid*=login]') !== null,
            cloudflare: document.querySelector('#challenge-form, #challenge-running, [id^="cf-"], iframe[src*="challenges.cloudflare.com"]') !== null || title.toLowerCase().includes('just a moment'),
            userAgent: navigator.userAgent
        };
        console.warn("[ThunderAI] Diagnostics: " + JSON.stringify(diag));
    } catch (err) {
        console.warn("[ThunderAI] Diagnostics failed: ", err);
    }
}

// The composer's form, or without a form the closest ancestor (max 6 levels) holding a button
function getComposerContainer(el) {
    if (!el) return null;
    const form = el.closest('form');
    if (form) return form;
    let node = el.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
        if (node.querySelector('button')) return node;
    }
    return null;
}

// Button structure for diagnostics. aria-labels are localized: logged here, never matched.
function describeButtons(container, max, extended) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('button')).filter(b => !isOwnUiElement(b)).slice(0, max).map((b, index) => {
        const use = b.querySelector('use');
        const path = b.querySelector('path');
        const desc = {
            index: index,
            type: b.getAttribute('type') || '',
            id: b.id || '',
            testid: b.getAttribute('data-testid') || '',
            disabled: b.hasAttribute('disabled'),
            ariaLabel: (b.getAttribute('aria-label') || '').substring(0, 40),
            dataState: b.getAttribute('data-state') || '',
            useHref: use ? (use.getAttribute('href') || use.getAttribute('xlink:href') || '') : '',
            pathD: path ? (path.getAttribute('d') || '').substring(0, 30) : '',
            visible: isElementVisible(b)
        };
        // completion diagnostics only, the send button diagnostics keep their format
        if (extended) {
            desc.ariaHaspopup = b.getAttribute('aria-haspopup') || '';
            desc.class = getElementClass(b).substring(0, 60);
        }
        return desc;
    });
}

// Same rules as logPromptInputDiagnostics: structure only, no page text
function logSendButtonDiagnostics(composerEl) {
    try {
        const buttons = Array.from(document.querySelectorAll('form button, [data-testid$="-button"]')).filter(el => !isOwnUiElement(el));
        const diag = {
            buttons: buttons.length,
            formButtons: document.querySelectorAll('form button').length,
            testids: Array.from(new Set(buttons.map(b => b.getAttribute('data-testid')).filter(Boolean))).slice(0, 15),
            ariaLabels: Array.from(new Set(buttons.map(b => (b.getAttribute('aria-label') || '').substring(0, 40)).filter(Boolean))).slice(0, 15),
            composerInForm: diagSection(() => composerEl ? composerEl.closest('form') !== null : false),
            composerButtons: diagSection(() => describeButtons(getComposerContainer(composerEl), 12))
        };
        console.warn("[ThunderAI] Send button diagnostics: " + JSON.stringify(diag));
    } catch (err) {
        console.warn("[ThunderAI] Send button diagnostics failed: ", err);
    }
}

function firstUsableButton(list) {
    for (const b of list) {
        if (b && !isOwnUiElement(b) && isElementVisible(b)) return b;
    }
    return null;
}

// Send button lookup, existing selectors first so the old UI keeps working.
// The newer composer has no data-testid on its buttons (issue #920).
function findSendButton(composerEl) {
    const strategies = [
        ['existing', () => [].concat(
            Array.from(document.querySelectorAll('[data-testid="send-button"]')),   // pre-GPT-4o
            Array.from(document.querySelectorAll('path[d*="M15.1918 8.90615C15.6381"]')).map(p => p.parentNode?.parentNode),   // from sept-2024
            Array.from(document.querySelectorAll('path[d*="M15.192 8.906a1.143"]')).map(p => p.parentNode?.parentNode))],   // post-GPT-4o
        ['composer-submit-button', () => [document.getElementById('composer-submit-button')]],
        ['form-submit', () => {
            const form = composerEl ? composerEl.closest('form') : null;
            return form ? Array.from(form.querySelectorAll('button[type="submit"]')) : [];
        }],
        ['composer-size-token-submit', () => {
            const form = composerEl ? composerEl.closest('form') : null;
            return form ? Array.from(form.querySelectorAll('button.size-token-button-composer[type="submit"]')) : [];
        }],
        ['ancestor-submit', () => {
            if (!composerEl || composerEl.closest('form')) return [];
            let node = composerEl.parentElement;
            for (let i = 0; node && i < 6; i++, node = node.parentElement) {
                const b = firstUsableButton(node.querySelectorAll('button[type="submit"]'));
                if (b) return [b];
            }
            return [];
        }]
    ];
    for (const [name, getCandidates] of strategies) {
        let button = null;
        try {
            button = firstUsableButton(getCandidates());
        } catch (err) {
            console.error('[ThunderAI] findSendButton ' + name + ': ', err);
        }
        if (button) {
            // logged only on change, this runs every 25 ms while the button is disabled
            if (last_send_button_strategy !== name) {
                last_send_button_strategy = name;
                doLog("Send button found with strategy: " + name);
            }
            return button;
        }
    }
    return null;
}

function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
}

// From a focus target up to the element the user types into, crossing open shadow boundaries
function findEditableHost(el) {
    let node = el;
    for (let i = 0; node && i < 12; i++) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.isContentEditable) {
                // the editing host is the topmost element that is still editable
                while (node.parentElement && node.parentElement.isContentEditable) node = node.parentElement;
                return node;
            }
            if (node.tagName === 'TEXTAREA' || node.getAttribute('role') === 'textbox') return node;
        }
        const root = node.getRootNode ? node.getRootNode() : null;
        node = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return null;
}

// "tag#id" or "tag:nth-of-type(n)" parts up to the nearest id, form or body
function getSelectorPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 12) {
        const tag = node.tagName.toLowerCase();
        if (node.id) {
            parts.unshift(tag + '#' + CSS.escape(node.id));
            break;
        }
        if (tag === 'body') {
            parts.unshift(tag);
            break;
        }
        let index = 1;
        for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (sibling.tagName === node.tagName) index++;
        }
        parts.unshift(tag + ':nth-of-type(' + index + ')');
        if (tag === 'form') break;
        node = node.parentElement;
    }
    return parts.join(' > ');
}

// Same rules as logPromptInputDiagnostics: structure only, never the composer's content,
// aria-label or placeholder
function logComposerDiagnostics(source, el) {
    try {
        const element = !el ? null : diagSection(() => {
            const root = el.getRootNode ? el.getRootNode() : null;
            const inShadow = root instanceof ShadowRoot;
            const ancestors = [];
            let node = el.parentElement;
            while (node && ancestors.length < 8) {
                ancestors.push({
                    tag: node.tagName.toLowerCase(),
                    id: node.id || '',
                    role: node.getAttribute('role') || '',
                    class: getElementClass(node).substring(0, 60)
                });
                if (node.tagName === 'FORM') break;
                node = node.parentElement;
            }
            return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                name: el.getAttribute('name') || '',
                role: el.getAttribute('role') || '',
                contenteditable: el.getAttribute('contenteditable'),
                ariaMultiline: el.getAttribute('aria-multiline'),
                dataAttributes: Array.from(el.attributes).map(a => a.name).filter(n => n.startsWith('data-')).slice(0, 20),
                class: getElementClass(el).substring(0, 150),
                shadowRoot: inShadow ? root.mode : '',
                // focus inside a closed shadow root is retargeted to its host
                possibleClosedShadowHost: !inShadow && el.tagName.includes('-') && !el.shadowRoot && !el.isContentEditable,
                // focus inside an iframe never reaches our listener, the iframe itself is the active element
                inIframe: el.tagName === 'IFRAME' || window.self !== window.top,
                ancestors: ancestors,
                selectorPath: getSelectorPath(el)
            };
        });
        const countOwnFree = (selector) => Array.from(document.querySelectorAll(selector)).filter(e => !isOwnUiElement(e)).length;
        const title = document.title || '';
        const diag = {
            source: source,
            element: element,
            path: location.pathname,
            title: title,
            readyState: document.readyState,
            forms: diagSection(() => {
                const forms = Array.from(document.querySelectorAll('form')).filter(f => !isOwnUiElement(f));
                return {
                    count: forms.length,
                    details: forms.slice(0, 3).map(f => ({
                        buttons: f.querySelectorAll('button').length,
                        editables: f.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]').length
                    }))
                };
            }),
            contenteditable: countOwnFree('[contenteditable]'),
            textarea: countOwnFree('textarea'),
            textbox: countOwnFree('[role="textbox"]'),
            iframes: diagSection(() => {
                const frames = Array.from(document.querySelectorAll('iframe'));
                return {
                    count: frames.length,
                    origins: frames.slice(0, 5).map(f => {
                        try { return new URL(f.src, location.href).origin; } catch (e) { return ''; }
                    })
                };
            }),
            shadowHosts: diagSection(() => {
                const shadowRoots = getOpenShadowRoots();
                return {
                    count: shadowRoots.length,
                    truncated: shadowRoots.truncated,
                    tags: Array.from(new Set(shadowRoots.map(r => r.host.tagName.toLowerCase()))).slice(0, 10)
                };
            }),
            openDialogs: diagSection(() => Array.from(document.querySelectorAll('[role="dialog"], dialog[open]'))
                .filter(d => !isOwnUiElement(d) && isElementVisible(d)).slice(0, 5)
                .map(d => ({ id: d.id || '', labelledby: d.getAttribute('aria-labelledby') || '' }))),
            loginButton: document.querySelector('button[data-testid*=login]') !== null,
            cloudflare: document.querySelector('#challenge-form, #challenge-running, [id^="cf-"], iframe[src*="challenges.cloudflare.com"]') !== null || title.toLowerCase().includes('just a moment'),
            userAgent: navigator.userAgent
        };
        console.warn("[ThunderAI] Composer diagnostics: " + JSON.stringify(diag));
    } catch (err) {
        console.warn("[ThunderAI] Composer diagnostics failed: ", err);
    }
}

// Last resort when no selector matches: the user shows us the composer by clicking into it.
// Resolves with the editable element, or null after timeoutMs.
function waitForUserComposerFocus(timeoutMs) {
    return new Promise(resolve => {
        const curr_msg = document.getElementById('mzta-curr_msg');
        const loading = document.getElementById('mzta-loading');
        let lastIgnored = null;
        let timeoutId = null;
        const accept = (target) => {
            if (!target || target.nodeType !== Node.ELEMENT_NODE || isOwnUiElement(target)) return null;
            const host = findEditableHost(target);
            if (!host || isOwnUiElement(host)) {
                lastIgnored = target;
                return null;
            }
            return host;
        };
        const onFocusIn = (event) => {
            const path = event.composedPath ? event.composedPath() : [];
            const el = accept(path[0] || event.target);
            if (el) finish(el);
        };
        const finish = (el) => {
            document.removeEventListener('focusin', onFocusIn, true);
            clearTimeout(timeoutId);
            if (el) {
                doLog("Composer selected by user focus: " + el.tagName.toLowerCase());
                if (curr_msg) curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_working");
                if (loading) loading.style.display = 'inline-block';
                logComposerDiagnostics('focus', el);
            } else {
                doLog("No composer selected by the user after " + timeoutMs + " ms");
                logComposerDiagnostics('timeout', lastIgnored || getDeepActiveElement());
            }
            resolve(el);
        };
        if (curr_msg) {
            curr_msg.textContent = browser.i18n.getMessage("chatgpt_composer_click_to_continue");
            curr_msg.style.display = 'block';
        }
        if (loading) loading.style.display = 'none';
        // clicking into an element that already has focus fires no focusin
        const alreadyFocused = accept(getDeepActiveElement());
        lastIgnored = null;
        if (alreadyFocused) {
            finish(alreadyFocused);
            return;
        }
        document.addEventListener('focusin', onFocusIn, true);
        timeoutId = setTimeout(() => finish(null), timeoutMs);
    });
}

// Plain text for a real <textarea>: one line per block element (the prompt arrives as one <p> per line)
function htmlToPlainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blockTags = ['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    let out = '';
    const walk = (node) => {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                out += child.nodeValue;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'BR') {
                    out += '\\n';
                    continue;
                }
                const isBlock = blockTags.includes(child.tagName);
                if (isBlock && out !== '' && !out.endsWith('\\n')) out += '\\n';
                walk(child);
                if (isBlock) out += '\\n';
            }
        }
    };
    walk(doc.body);
    return out.endsWith('\\n') ? out.slice(0, -1) : out;
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function countElements(selector) {
    return document.querySelectorAll(selector).length;
}

function takeSendBaseline() {
    return {
        assistant: countElements('[data-message-author-role="assistant"]'),
        user: countElements('[data-message-author-role="user"]'),
        article: countElements('main article')
    };
}

function getLastAssistantMessage() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length > 0) return { el: messages[messages.length - 1], count: messages.length, kind: 'assistant' };
    const articles = document.querySelectorAll('main article');
    if (articles.length > 0) return { el: articles[articles.length - 1], count: articles.length, kind: 'article' };
    return null;
}

// The last assistant message, only if it appeared after the send. Without the role attribute
// every turn is an article, so the new user turn and the answer make at least 2 more.
function getNewAssistantMessage() {
    const last = getLastAssistantMessage();
    if (!last || !send_baseline) return last;
    const minCount = last.kind === 'assistant' ? send_baseline.assistant + 1 : send_baseline.article + 2;
    return last.count >= minCount ? last : null;
}

function getMessageTurn(el) {
    return el.closest('article') || el.parentElement || el;
}

// Language-neutral signals that ChatGPT is still generating, any one of them is enough:
// - stopButton: the old UI's stop button, which replaces the send button while streaming
// - ariaBusy: aria-busy="true" on the last turn or inside it
// - streamingClass: a class containing "streaming" in the last turn (ChatGPT has used
//   result-streaming and streaming-animation on the answer being written)
// None of them is guaranteed in the newer UI, so the completion fallback also requires
// the answer length to be stable for a while.
function getGenerationSignals(turn) {
    return {
        stopButton: document.querySelector('[data-testid="stop-button"]') !== null,
        ariaBusy: turn ? (turn.getAttribute('aria-busy') === 'true' || turn.querySelector('[aria-busy="true"]') !== null) : false,
        streamingClass: turn ? (getElementClass(turn).includes('streaming') || turn.querySelector('[class*="streaming"]') !== null) : false
    };
}

function isGenerationInProgress(turn) {
    const signals = getGenerationSignals(turn);
    return signals.stopButton || signals.ariaBusy || signals.streamingClass;
}

function isComposerEmpty(el) {
    if (el.tagName === 'TEXTAREA') return el.value.trim() === '';
    return (el.textContent || '').trim() === '';
}

// Sent when the composer was cleared or re-rendered away, or a new message or the stop button appeared
function isSendVerified(el, baseline) {
    if (!el.isConnected || isComposerEmpty(el)) return true;
    if (baseline && (countElements('[data-message-author-role="user"]') > baseline.user || countElements('[data-message-author-role="assistant"]') > baseline.assistant)) return true;
    return getGenerationSignals(null).stopButton;
}

function dispatchEnter(el) {
    try { el.focus(); } catch (err) { /* the keydown below does not depend on it */ }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
}

// Waits for the button to be enabled, then sends. Resolves 'sent', or 'timeout' after 10 s.
function sendWithButton(sendButton, composerEl, method) {
    return new Promise(resolve => {
        const startTime = Date.now();
        const delaySend = setInterval(() => {
            try {
                if (sendButton && sendButton.isConnected && !sendButton.hasAttribute('disabled')) { // send msg
                    clearInterval(delaySend);
                    method.toLowerCase() == 'click' ? sendButton.click() : dispatchEnter(composerEl);
                    resolve('sent');
                } else if (Date.now() - startTime > 10000) {
                    clearInterval(delaySend);
                    resolve('timeout');
                } else {
                    // the button can be re-rendered while disabled, keep the old one if the lookup fails
                    sendButton = findSendButton(composerEl) || sendButton;
                }
            } catch (err) {
                clearInterval(delaySend);
                console.error('[ThunderAI] sendWithButton: ', err);
                resolve('error');
            }
        }, 25);
    });
}

// A form without a page submit handler would navigate the popup and drop this script,
// so the submit is cancelled if the page did not cancel it itself
function requestSubmitGuarded(form) {
    const guard = (event) => {
        if (!event.defaultPrevented) event.preventDefault();
    };
    window.addEventListener('submit', guard);
    try {
        form.requestSubmit();
    } finally {
        window.removeEventListener('submit', guard);
    }
}

async function chatgpt_sendMsg(msg, method ='') {       // return -1 message not sent, -2 textarea not found
    let textArea = null;
    if (user_selected_composer && isElementVisible(user_selected_composer)) {
        doLog("Reusing the composer selected by the user");
        textArea = user_selected_composer;
    } else {
        textArea = await findPromptInput(15000);
    }
    //check if the textarea has been found
    if(!textArea) {
        console.error("[ThunderAI] Textarea not found!");
        logPromptInputDiagnostics();
        textArea = await waitForUserComposerFocus(60000);
        if (!textArea) return -2;
        user_selected_composer = textArea;
    }
    current_composer_el = textArea;
    send_baseline = takeSendBaseline();
    if (textArea.tagName === 'TEXTAREA') {
        // native setter, so React's value tracking notices the change
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textArea, htmlToPlainText(msg));
    } else {
        // from sept 2024
        // Remove existing content
        while (textArea.firstChild) {
            textArea.removeChild(textArea.firstChild);
        }
        // Parse msg as HTML and append its nodes
        const parser = new DOMParser();
        const doc = parser.parseFromString(msg, 'text/html');
        Array.from(doc.body.childNodes).forEach(node => {
            textArea.appendChild(node.cloneNode(true));
        });
    }
    textArea.dispatchEvent(new Event('input', { bubbles: true }));
    // lengths only, never the prompt itself
    doLog("Prompt input filled: tag " + textArea.tagName.toLowerCase() + ", content length " + (textArea.tagName === 'TEXTAREA' ? textArea.value.length : (textArea.textContent || '').length) + " (prompt length " + msg.length + ")");
    //wait for the button to change from the audio button to the send button (from nov-2024),
    //the newer composer renders its submit button only once there is text
    await waitMs(1000);
    let diagLogged = false;
    const sendButton = findSendButton(textArea);
    if (sendButton) {
        const outcome = await sendWithButton(sendButton, textArea, method);
        if (outcome !== 'sent') {
            doLog("Send button not usable (" + outcome + "), sending Enter");
            dispatchEnter(textArea);
        }
    } else {
        console.error("[ThunderAI] Send button not found, sending Enter");
        logSendButtonDiagnostics(textArea);
        diagLogged = true;
        dispatchEnter(textArea);
    }
    await waitMs(1500);
    if (!isSendVerified(textArea, send_baseline)) {
        const form = textArea.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
            doLog("Send not verified, trying form.requestSubmit()");
            try {
                requestSubmitGuarded(form);
            } catch (err) {
                console.error('[ThunderAI] requestSubmit: ', err);
            }
            await waitMs(1500);
        }
        if (!isSendVerified(textArea, send_baseline)) {
            console.error("[ThunderAI] The prompt could not be sent!");
            if (!diagLogged) logSendButtonDiagnostics(textArea);
            return -1;
        }
    }
    doLog("Send verified");
    return 0;   //everything is ok
}

// Buttons of the last answer turn (copy, thumbs, regenerate...), outside the composer
function getTurnButtonsContainer(el) {
    let node = el.closest('article') || el;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) {
        if (node.querySelector('button') && !node.contains(current_composer_el)) return node;
    }
    return null;
}

// Same rules as logPromptInputDiagnostics: structure and lengths only, never the answer
function logCompletionDiagnostics(last, length, stableMs, waitingMs, state) {
    try {
        const turn = last ? getMessageTurn(last.el) : null;
        const composer = current_composer_el && current_composer_el.isConnected ? current_composer_el : queryPromptInput([document])?.el;
        const diag = {
            waitingMs: waitingMs,
            kind: last ? last.kind : '',
            assistant: countElements('[data-message-author-role="assistant"]'),
            user: countElements('[data-message-author-role="user"]'),
            article: countElements('main article'),
            baseline: send_baseline,
            length: length,
            stableMs: stableMs,
            signals: diagSection(() => getGenerationSignals(turn)),
            turnButtons: diagSection(() => last ? describeButtons(getTurnButtonsContainer(last.el), 12, true) : []),
            composerButtons: diagSection(() => describeButtons(getComposerContainer(composer), 12, true)),
            generationObserved: state ? state.generationObserved : null,
            isGeneratingNow: state ? state.isGeneratingNow : null,
            assistantAtStart: state ? state.assistantAtStart : null,
            assistantNow: countElements('[data-message-author-role="assistant"]'),
            minTurnIndex: state ? state.minTurnIndex : null
        };
        console.warn("[ThunderAI] Completion diagnostics: " + JSON.stringify(diag));
    } catch (err) {
        console.warn("[ThunderAI] Completion diagnostics failed: ", err);
    }
}

async function chatgpt_isIdle() {
    return new Promise(resolve => {
        const startTime = Date.now();
        let lastEl = null;
        let lastLength = -1;
        let lastChange = Date.now();
        let diagLogged = false;
        // per-call state, isIdle can run more than once in the same page (custom texts)
        const assistantAtStart = countElements('[data-message-author-role="assistant"]');
        // the new turn usually exists already when this starts (send verification waits 1.5 s)
        const minTurnIndex = send_baseline ? send_baseline.assistant : assistantAtStart;
        let generationObserved = false;
        let lastGeneratingAt = 0;
        // Stop button of the newer UI (issue #920), matched by icon or composer classes, never by label
        const stopButtonPresent = () => {
            const stopPath = document.querySelector('button path[d^="M4.5 5.75C4.5 5.05964"]');
            if (stopPath && !isOwnUiElement(stopPath)) return true;
            const form = current_composer_el && current_composer_el.isConnected ? current_composer_el.closest('form') : null;
            if (form) return form.querySelector('button.size-token-button-composer.bg-composer-primary[type="button"]') !== null;
            return document.querySelector('form button.size-token-button-composer.bg-composer-primary[type="button"]') !== null;
        };
        const intervalId = setInterval(() => {
            const regenerateButton = chatgpt_getRegenerateButton(minTurnIndex);
            if (regenerateButton || do_force_completion) {
                if (do_force_completion) doLog("Completion forced by the user");
                else if (isNewUiActionButton(regenerateButton)) doLog("Completion detected by the new UI action button");
                else doLog("Completion detected by the regenerate button");
                clearInterval(intervalId); resolve(true);
                return;
            }
            // Fallback for UIs where the regenerate button markers are missing: the new answer
            // counts as complete once its length has been stable for 4 s and no generation
            // signal is left (see getGenerationSignals)
            try {
                const generatingNow = stopButtonPresent();
                if (generatingNow) {
                    generationObserved = true;
                    lastGeneratingAt = Date.now();
                } else if (generationObserved && Date.now() - lastGeneratingAt >= 4000) {
                    // Stop gone for 1 s, then 3 s more without a new UI action button: covers icon changes
                    doLog("Completion detected by the end of generation (stop button gone for " + (Date.now() - lastGeneratingAt) + " ms)");
                    clearInterval(intervalId); resolve(true);
                    return;
                }
                const last = getNewAssistantMessage();
                const length = last ? (last.el.textContent || '').trim().length : -1;
                if (!last || last.el !== lastEl || length !== lastLength) {
                    lastEl = last ? last.el : null;
                    lastLength = length;
                    lastChange = Date.now();
                } else if (length > 0 && Date.now() - lastChange >= 4000 && !isGenerationInProgress(getMessageTurn(last.el)) && !generatingNow) {
                    // !generatingNow: the text stays unchanged during thinking pauses too
                    doLog("Completion detected by the stability fallback (" + last.kind + ", length " + length + ", stable for " + (Date.now() - lastChange) + " ms, no stop button)");
                    clearInterval(intervalId); resolve(true);
                    return;
                }
                if (!diagLogged && Date.now() - startTime > 60000) {
                    diagLogged = true;
                    logCompletionDiagnostics(last, length, Date.now() - lastChange, Date.now() - startTime, {
                        generationObserved: generationObserved,
                        isGeneratingNow: generatingNow,
                        assistantAtStart: assistantAtStart,
                        minTurnIndex: minTurnIndex
                    });
                }
            } catch (err) {
                console.error('[ThunderAI] chatgpt_isIdle: ', err);
            }
        }, 100);
    });
}

// Regenerate and copy icons of the newer UI (issue #920): cursor-interaction, inline paths, no testid
const NEW_UI_ACTION_PATHS = 'path[d^="M14.0219 8.22363"], path[d^="M13.468 11.1216"]';

function isNewUiActionButton(el) {
    return !!el && typeof el.querySelector === 'function' && el.querySelector(NEW_UI_ACTION_PATHS) !== null;
}

// Index of the assistant message the element belongs to, -1 if none
function getAssistantTurnIndex(el) {
    const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    const own = el.closest('[data-message-author-role="assistant"]');
    if (own) return messages.indexOf(own);
    const article = el.closest('article');
    if (!article) return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (article.contains(messages[i])) return i;
    }
    return -1;
}

function chatgpt_getRegenerateButton(minTurnIndex) {
    let first_try = [...document.querySelectorAll('use')]
                        .find(u => u.getAttribute('href')?.includes('#' + 'ec66f0'))
                        ?.closest('button') || null;
    if(first_try != null) return first_try;
    for (const mainSVG of document.querySelectorAll('.cursor-pointer')) {
        if (mainSVG.querySelector('path[d^="M3.502 16.666v-3.333c0-.367.298-.665.665"]') || mainSVG.querySelector('path[d^="M3.502 16.6663V13"]') || mainSVG.querySelector('path[d^="M3.06957"]') || mainSVG.querySelector('path[d^="M10.9153 1.83987L11.2942 1.88772L11.4749"]') || document.querySelector("button[data-testid=good-response-turn-action-button]")){ // regen icon or thumb-up icon found
            //console.log(">>>>>>>>>> found regen icon!");
            return mainSVG.parentNode.parentNode;
        }
    }
    for (const mainSVG of document.querySelectorAll('main svg.icon')) {
        if (mainSVG.querySelector('path[d^="M9.75122 4.09203C9.75122"]') || mainSVG.querySelector('path[d^="M11 4.9099C11 4.47485"]')){ // read aloud icon found
            //console.log(">>>>>>>>>> found read aloud icon!");
            return mainSVG.parentNode.parentNode;
        }
    }
    // newer UI, only in turns at or after minTurnIndex when given
    for (const path of document.querySelectorAll(NEW_UI_ACTION_PATHS)) {
        const button = path.closest('button');
        if (!button || isOwnUiElement(button)) continue;
        if (typeof minTurnIndex === 'number' && getAssistantTurnIndex(button) < minTurnIndex) continue;
        return button;
    }
    return null;
}

function chatpgt_scrollToBottom () {
    try { 
        //document.querySelector('button[class*="cursor"][class*="bottom"]').click();
        document.querySelector('path[d^="M9.33468 3.33333C9.33468"]')?.parentNode?.parentNode?.click();
    }
    catch (err) { console.error('[ThunderAI] ', err); }
}

function addCustomDiv(prompt_action,tabId,mailMessageId) {
    // Create <style> element for the CSS
    var style = document.createElement('style');
    style.textContent = ".mzta-header-fixed {position:fixed;bottom:0;left: 0;height:100px;width:100%;background-color: #333;color: white;text-align: center;padding: 10px 0;z-index: 1000;border-top: 3px solid white;}"
    style.textContent += "body {padding-bottom: 100px !important;} [id^='headlessui-dialog-panel-:r']{padding-bottom: 100px !important;} [data-testid='screen-thread']{padding-bottom: 100px !important;} [slot='content']{padding-bottom: 100px !important;}";
    style.textContent += ".mzta-btn {background-color: #007bff;border: none;color: white;padding: 8px 15px;text-align: center;text-decoration: none;display: inline-block;font-size: 16px;margin: 4px 2px;transition-duration: 0.4s;cursor: pointer;border-radius: 5px;}";
    style.textContent += ".mzta-btn:hover {background-color:#0056b3;color:white;}";
    style.textContent += ".btn_disabled {background-color: #6a829b !important;color: white !important;cursor: not-allowed;}";
    style.textContent += ".btn_disabled:hover {background-color:#6a829b !important;color:white !important;}";
    style.textContent += "#mzta-loading{height:50px;display:inline-block;}";
    style.textContent += "#mzta-model_warn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-height:100%px;min-width:30%;max-width:50%;padding:3px;border-radius:5px;text-align:center;background-color:#FFBABA;border:1px solid;font-size:13px;color:#D8000C;display:none;}#mzta-model_warn a{color:blue;text-decoration: underline;}";
    style.textContent += "#mzta-btn_model {background-color: #007bff;border: none;color: white;padding: 2px 4px;text-align: center;text-decoration: none;display: none;font-size: 13px;margin-left: 4px;transition-duration: 0.4s;cursor: pointer;border-radius: 2px;}";
    style.textContent += "#mzta-status-page{position:fixed;bottom:0;left:0;padding-left:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-force-completion{cursor:pointer;position:fixed;bottom:0;right:0;padding-right:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-status-page:hover, #mzta-force-completion:hover{color:#007bff;}";
    style.textContent += "#mzta-custom_text{padding:10px;width:auto;max-width:80%;height:auto;max-height:80%;border-radius:5px;overflow:auto;position:fixed;top:50%;left:50%;display:none;transform:translate(-50%,-50%);text-align:center;background-color:#333;color:white;border:3px solid white;}";
    style.textContent += "#mzta-custom_loading{height:50px;display:none;}";
    // explicit colors: newer ChatGPT CSS resets textarea to a transparent background and no border
    style.textContent += "#mzta-custom_textarea{color:black;background-color:white;caret-color:black;color-scheme:light;border:1px solid #ccc;border-radius:3px;font-family:sans-serif;padding:1px;font-size:15px;width:100%;}";
    style.textContent += "#mzta-custom_info{text-align:center;width:100%;padding-bottom:10px;font-size:15px;}";
    style.textContent += "#mzta-custom_info span{font-size:0.8em;}";
    style.textContent += "#mzta-custom_step{position: absolute;bottom: 5px;right: 10px;font-size: 12px;color: #ccc;}";
    style.textContent += "#mzta-prompt-name{font-size:13px;font-style:italic;color:#919191;position:fixed;bottom:75px;;left:0;padding-left:5px;}";
    style.textContent += "#mzta-diff-overlay{position: fixed;top:0;left:0;width:100vw;height:100vh;background: rgba(0, 0, 0, 0.5);display:flex;justify-content:center;align-items:center;z-index:999;}";
    style.textContent += "#mzta-diff{padding:10px;border:2px solid white;border-radius:1em;position:fixed;top:50%;left:50%;width:80%;height:30em;transform:translate(-50%,-50%);z-index:9999;background-color: #333;color: white;}";
    style.textContent += "#mzta-diff_title{font-size:16px;font-weight:bold;text-align:center;padding-bottom:10px;}";
    style.textContent += "#mzta-diff_content{overflow-y:scroll;text-align:justify;width:100%;height:22.5em;}";
    style.textContent += "#mzta-diff span.added{background-color: rgb(0, 94, 0);display:inline;} #mzta-diff span.removed{background-color: rgb(90, 0, 0);display:inline;text-decoration:line-through;}";
    style.textContent += "#mzta-btn_close_diff{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);}";
    style.textContent += "#mzta-btn_change_reply_type{padding-left:4px;padding-right:10px;margin-left:0px;border-bottom-left-radius:0px;border-top-left-radius:0px;height:2.7em;}";
    style.textContent += ".mzta-btn_reply{padding-right:4px;margin-right:0px;border-bottom-right-radius:0px;border-top-right-radius:0px;}";
    style.textContent += "#mzta-forcecomp-hint{display:none;position:fixed;bottom:30px;right:90px;width:20em;background: #c3cefeff;color: #111827;padding:10px 14px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.2);font-size:14px;font-weight:bold;z-index:2000;pointer:default;}";
    style.textContent += "#mzta-forcecomp-hint .label{display:block;line-height:1.3;}";
    style.textContent += "#mzta-forcecomp-hint svg{position:absolute;bottom:-10px;right:-20px;width:40px;height:40px;}";
    style.textContent += "#thread-bottom-container{padding-bottom: 100px !important;box-sizing: border-box;}";



    // Add <style> to the page's <head>
    document.head.appendChild(style);

    // Fixed div
    var fixedDiv = document.createElement('div');
    fixedDiv.classList.add('mzta-header-fixed');
    fixedDiv.textContent = '';

    // Model warning div
    var modelWarnDiv = document.createElement('div');
    modelWarnDiv.id = 'mzta-model_warn';
    modelWarnDiv.textContent = browser.i18n.getMessage("chatgpt_win_model_warning");
    fixedDiv.appendChild(modelWarnDiv);

    // GPT Model Button
    var btn_model = document.createElement('button');
    btn_model.id="mzta-btn_model";
    btn_model.textContent = browser.i18n.getMessage("chatgpt_btn_model");
    btn_model.onclick = async function() {
        force_go = true;
        document.getElementById('mzta-model_warn').style.display = 'none';
    };
    modelWarnDiv.appendChild(btn_model);
    
    //prompt name
    var prompt_name_div = document.createElement('div');
    prompt_name_div.id = 'mzta-prompt-name';
    prompt_name_div.title= browser.i18n.getMessage("currently_used_prompt");
    prompt_name_div.textContent = mztaPromptName;
    fixedDiv.appendChild(prompt_name_div);

    //status page
    var status_page_div = document.createElement('div');
    status_page_div.id = 'mzta-status-page';
    status_page_div.innerHTML = '<a href="https://micz.it/thunderbird-addon-thunderai/status/">'+ mztaStatusPageDesc +'</a>';
    fixedDiv.appendChild(status_page_div);

    //force completion
    var force_completion_div = document.createElement('div');
    force_completion_div.id = 'mzta-force-completion';
    force_completion_div.textContent = mztaForceCompletionDesc;
    force_completion_div.title = mztaForceCompletionTitle;
    force_completion_div.addEventListener('click', function() {
        do_force_completion = true;
    });
    fixedDiv.appendChild(force_completion_div);

    // span for the text
    var curr_msg = document.createElement('span');
    curr_msg.id='mzta-curr_msg';
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_working");
    curr_msg.style.display = 'block';
    fixedDiv.appendChild(curr_msg);

    // loading gif
    var loading = document.createElement('img');
    loading.src = browser.runtime.getURL("/images/loading.gif");
    loading.id = "mzta-loading";
    fixedDiv.appendChild(loading);

    // OK button
    var btn_ok = document.createElement('button');
    btn_ok.id="mzta-btn_ok";
    btn_ok.classList.add('mzta-btn');
    // Prevent the button from stealing focus and clearing the selection
    btn_ok.addEventListener('mousedown', function(e) {
        e.preventDefault();
    });
    //console.log('>>>>>>>>>>>>>>> default: '+prompt_action)
    switch(String(prompt_action)){ 
        default:
        case "0":     // close window
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_close");
            btn_ok.onclick = async function() {
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId}).catch(() => {});
            };
            fixedDiv.appendChild(btn_ok);
            break;
        case "1":     // do reply
            disableButton(btn_ok);
            const btn_ok_line1 = document.createElement('span');
            btn_ok_line1.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            const btn_ok_line2 = document.createElement('span');
            btn_ok_line2.classList.add('action_btn_info');
            btn_ok_line2.textContent = mztaReplyType == 'reply_all' ? browser.i18n.getMessage("prefs_OptionText_reply_all") : browser.i18n.getMessage("prefs_OptionText_reply_sender");
            btn_ok_line1.style.display = 'block';
            btn_ok_line1.style.margin = '0';
            btn_ok_line1.style.padding = '0';
            btn_ok_line1.style.lineHeight = '1';
            btn_ok_line2.style.display = 'block';
            btn_ok_line2.style.margin = '0';
            btn_ok_line2.style.padding = '0';
            btn_ok_line2.style.lineHeight = '1';
            btn_ok_line2.style.fontSize = '0.7em';
            btn_ok.appendChild(btn_ok_line1);
            //btn_ok.appendChild(document.createElement('br'));
            btn_ok.appendChild(btn_ok_line2);
            btn_ok.setAttribute('data-reply-type', mztaReplyType);
            btn_ok.addEventListener('click', async function() {
                const response = getSelectedHtml();
                const currentReplyType = btn_ok.getAttribute('data-reply-type');
                // console.log(">>>>>>>>>> btn_ok reply type: " + JSON.stringify(currentReplyType));
                await browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: response, tabId: tabId, mailMessageId: mailMessageId, replyType: currentReplyType});
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId}).catch(() => {});
            });
            btn_ok.classList.add('mzta-btn_reply');
            // change reply type button
            var btn_change_reply_type = document.createElement('button');
            disableButton(btn_change_reply_type);
            btn_change_reply_type.id = 'mzta-btn_change_reply_type';
            // Prevent the button from stealing focus and clearing the selection
            btn_change_reply_type.addEventListener('mousedown', function(e) {
                e.preventDefault();
            });
            btn_change_reply_type.classList.add('mzta-btn');
            btn_change_reply_type.title = browser.i18n.getMessage("chatgpt_win_change_reply_type");
            // Create SVG element
            let currentIcon = createReplyToAllIcon();
            // Append SVG to button
            btn_change_reply_type.appendChild(currentIcon);
            btn_change_reply_type.addEventListener('click', function() {
                // console.log('>>>>>>>>>> change reply type clicked');
                btn_change_reply_type.removeChild(currentIcon);
                if(mztaReplyType == 'reply_all'){
                    mztaReplyType = 'reply_sender';
                    currentIcon = createReplyToSenderIcon();
                    btn_change_reply_type.appendChild(currentIcon);
                    btn_ok_line2.textContent = browser.i18n.getMessage("prefs_OptionText_reply_sender");
                }else{
                    mztaReplyType = 'reply_all';
                    currentIcon = createReplyToAllIcon();
                    btn_change_reply_type.appendChild(currentIcon);
                    btn_ok_line2.textContent = browser.i18n.getMessage("prefs_OptionText_reply_all");
                }
                btn_ok.setAttribute('data-reply-type', mztaReplyType);
            });
            fixedDiv.appendChild(btn_ok);
            fixedDiv.appendChild(btn_change_reply_type);
            btn_change_reply_type.style.display = 'none';
            break;
        case "2":     // replace text
            disableButton(btn_ok);
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = getSelectedHtml();
                //console.log('replace text: '+tabId)
                await browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: response, tabId: tabId, mailMessageId: mailMessageId});
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId}).catch(() => {});
            };
            fixedDiv.appendChild(btn_ok);
            break;
    }
    btn_ok.style.display = 'none';

    if(mztaUseDiffViewer == '1'){
        // diff overlay div
        var diffOverlay = document.createElement('div');
        diffOverlay.id = 'mzta-diff-overlay';
        diffOverlay.style.display = 'none';
        // diff div
        var diffDiv = document.createElement('div');
        diffDiv.id = 'mzta-diff';
        // diff div title
        var diffTitle = document.createElement('div');
        diffTitle.id = 'mzta-diff_title';
        diffTitle.textContent = browser.i18n.getMessage('chatgpt_win_diff_title');
        diffDiv.appendChild(diffTitle);
        // diff div content
        var diffContent = document.createElement('div');
        diffContent.id = 'mzta-diff_content';
        diffDiv.appendChild(diffContent);
        // diff div close button
        var btn_close_diff = document.createElement('button');
        btn_close_diff.id = 'mzta-btn_close_diff';
        btn_close_diff.classList.add('mzta-btn');
        btn_close_diff.textContent = browser.i18n.getMessage('chatgpt_win_close');
        btn_close_diff.onclick = function() {
            document.getElementById('mzta-diff-overlay').style.display = 'none';
        };
        diffDiv.appendChild(btn_close_diff);
        diffOverlay.appendChild(diffDiv);
        fixedDiv.appendChild(diffOverlay);

        // diff viewer button
        var btn_diff = document.createElement('button');
        btn_diff.id='mzta-btn_diff';
        btn_diff.classList.add('mzta-btn');
        // Prevent the button from stealing focus and clearing the selection
        btn_diff.addEventListener('mousedown', function(e) {
            e.preventDefault();
        });
        btn_diff.textContent = browser.i18n.getMessage('btn_show_differences');
        btn_diff.style.display = 'none';
        disableButton(btn_diff);
        btn_diff.onclick = async function() {
            diffContent.innerHTML = '';
            const response = getSelectedHtml();
            const wordDiff = Diff.diffWords(mztaOriginalText, response.replace(/<\\/?[^>]+(>|$)/g, ''));
            wordDiff.forEach(part => {
                // Split part.value by <br> (handling <br>, <br/>, <br />)
                const brRegex = /(<br\s*\\/?>)/gi;
                const segments = part.value.split(brRegex);

                segments.forEach(segment => {
                if (segment.match(brRegex)) {
                    // It's a <br>, add a real <br> element
                    diffContent.appendChild(document.createElement("br"));
                } else if (segment.length > 0) {
                    const diffElement = document.createElement("span");
                    if (part.added) {
                    diffElement.className = "added";
                    diffElement.textContent = segment;
                    } else if (part.removed) {
                    diffElement.className = "removed";
                    diffElement.textContent = segment;
                    } else {
                    diffElement.textContent = segment;
                    }
                    diffContent.appendChild(diffElement);
                }
                });
            });
            diffOverlay.style.display = 'block';
        };
        fixedDiv.appendChild(btn_diff);
    }

    //div per custom text
    let customDiv = document.createElement('div');
    customDiv.id = 'mzta-custom_text';
    let customInfo = document.createElement('div');
    customInfo.id = 'mzta-custom_info';
    customInfo.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
    customDiv.appendChild(customInfo);
    let customTextArea = document.createElement('textarea');
    customTextArea.id = 'mzta-custom_textarea';
    customTextArea.rows = 5;
    customDiv.appendChild(customTextArea);
    let customLoading = document.createElement('img');
    customLoading.src = browser.runtime.getURL("/images/loading.gif");
    customLoading.id = "mzta-custom_loading";
    customDiv.appendChild(customLoading);
    let customBtn = document.createElement('button');
    customBtn.id = 'mzta-custom_btn';
    customBtn.textContent = browser.i18n.getMessage("chatgpt_win_send");
    customBtn.classList.add('mzta-btn');
    customBtn.addEventListener("click", () => { customTextBtnClick({customBtn:customBtn,customLoading:customLoading,customDiv:customDiv}) });
    customTextArea.addEventListener("keydown", (event) => { if(event.code == "Enter" && event.ctrlKey) customTextBtnClick({customBtn:customBtn,customLoading:customLoading,customDiv:customDiv}) });
    customDiv.appendChild(customBtn);
    let customStep = document.createElement('div');
    customStep.id = 'mzta-custom_step';
    customDiv.appendChild(customStep);
    fixedDiv.appendChild(customDiv);

    // light background hint with diagonal thick arrow
    let forcecompletionHint_div = document.createElement('div');
    forcecompletionHint_div.id = 'mzta-forcecomp-hint';
    forcecompletionHint_div.addEventListener("click", () => {
       do_force_completion = true;
    });

    let arrowLabel = document.createElement('span');
    arrowLabel.className = 'label';
    forcecompletionHint_div.style.cursor = 'default';
    arrowLabel.textContent = browser.i18n.getMessage("chatgpt_click_force_completion");
    forcecompletionHint_div.appendChild(arrowLabel);
    arrowLabel.addEventListener("click", () => {
       do_force_completion = true;
    });

    // SVG solid arrow (triangle)
    const svgNS = 'http://www.w3.org/2000/svg';
    let hintArrow = document.createElementNS(svgNS, 'svg');
    hintArrow.setAttribute('viewBox', '0 0 40 40');
    hintArrow.addEventListener("click", () => {
       do_force_completion = true;
    });

    let arrowPolygon = document.createElementNS(svgNS, 'polygon');
    arrowPolygon.setAttribute('points', '0,0 40,40 0,28');
    arrowPolygon.setAttribute('fill', '#c3cefeff');

    hintArrow.appendChild(arrowPolygon);
    forcecompletionHint_div.appendChild(hintArrow);

    fixedDiv.appendChild(forcecompletionHint_div);

    document.body.insertBefore(fixedDiv, document.body.firstChild);
}

// Create SVG icons as functions
function createReplyToSenderIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  const path1 = document.createElementNS(svgNS, 'path');
  path1.setAttribute('d', 'M0 0h24v24H0z');
  path1.setAttribute('fill', 'none');
  const path2 = document.createElementNS(svgNS, 'path');
  path2.setAttribute('d', 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z');
  svg.appendChild(path1);
  svg.appendChild(path2);
  return svg;
}


function createReplyToAllIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  const path1 = document.createElementNS(svgNS, 'path');
  path1.setAttribute('d', 'M0 0h24v24H0z');
  path1.setAttribute('fill', 'none');
  const path2 = document.createElementNS(svgNS, 'path');
  path2.setAttribute('d', 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z');
  svg.appendChild(path1);
  svg.appendChild(path2);
  return svg;
}

function renderCustomTextStep() {
    const currentItem = _customTextArray[_currentCustomTextIndex];
    const infoDiv = document.getElementById('mzta-custom_info');
    const customTextArea = document.getElementById('mzta-custom_textarea');
    const customStep = document.getElementById('mzta-custom_step');
    
    customTextArea.value = "";
    infoDiv.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
    
    if (currentItem.info && currentItem.info.trim() !== "") {
        infoDiv.appendChild(document.createElement("br"));
        const infoSpan = document.createElement("span");
        infoSpan.textContent = "[" + browser.i18n.getMessage("customPrompts_form_label_ID") + ": " + currentItem.info + "]";
        infoDiv.appendChild(infoSpan);
    }

    if(_customTextArray.length > 1) {
        customStep.textContent = (_currentCustomTextIndex + 1) + "/" + _customTextArray.length;
        customStep.style.display = 'block';
    } else {
        customStep.style.display = 'none';
    }
    
    customTextArea.focus();
}

function customTextBtnClick(args) {
    const customText = document.getElementById('mzta-custom_textarea').value;
    
    if (_customTextArray[_currentCustomTextIndex]) {
        _customTextArray[_currentCustomTextIndex].custom_text = customText;
    }

    _currentCustomTextIndex++;

    if (_currentCustomTextIndex < _customTextArray.length) {
        renderCustomTextStep();
    } else {
        args.customBtn.disabled = true;
        args.customBtn.classList.add('disabled');
        args.customLoading.style.display = 'inline-block';
        args.customLoading.style.display = 'none';
        doProceed(current_message, _customTextArray);
        args.customDiv.style.display = 'none';
        
        args.customBtn.disabled = false;
        args.customBtn.classList.remove('disabled');
    }
}

function checkGPTModel(model) {
    if(model == '') return Promise.resolve();
    doLog("checkGPTModel model: " + model);
  return new Promise((resolve, reject) => {
    // Set up an interval that shows the warning after 2 seconds
    const intervalId2 = setTimeout(() => {
        let modelWarn = document.getElementById('mzta-model_warn');
        let btnModel = document.getElementById('mzta-btn_model');
        if (modelWarn) modelWarn.style.display = 'inline-block';
        if (btnModel) btnModel.style.display = 'inline';
    }, 2000);
    // Set up an interval that checks the value every 100 milliseconds
    const intervalId = setInterval(() => {
      // Get the '.text-token-text-secondary' element
     // const element = document.querySelector('div#radix-\\\\:ri2\\\\: > div > span.text-token-text-secondary');
     const elements = document.querySelectorAll('[id*=radix] span')

     // If there are no elements, we are using a free account, so go on immediately
     if (elements.length === 0) {
        doLog("checkGPTModel no model found in DOM, we are using free account.");
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        resolve('free');
        return;
      }

     // Loop through the elements to find the one with the specified text content
     for(let element of elements){
      // Check if the element exists and its content is '4' or '4o'
      doLog("checkGPTModel model found in DOM: " + element.textContent);
      if ((element && element.textContent === model)||(force_go)) {
        doLog("The GPT Model is now " + model);
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        resolve(model);
        break;
      } else if (!element) {
        console.error("[ThunderAI | ChatGPT Web] Model string element not found! [" + model + "]");
        clearInterval(intervalId);
        reject("Model string element not found: " + model);
      }
     }
    }, 200);
  });
}

function operation_done(){
    let curr_msg = document.getElementById('mzta-curr_msg');
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_job_completed");
    if(current_action != '0'){
        curr_msg.textContent += " " + browser.i18n.getMessage("chatgpt_win_job_completed_select"); 
    }
    curr_msg.style.display = 'block';
    document.getElementById('mzta-btn_ok').style.display = 'inline';
    if(current_action == '1'){
        document.getElementById('mzta-btn_change_reply_type').style.display = 'inline';
    }
    if(mztaUseDiffViewer == '1'){
        document.getElementById('mzta-btn_diff').style.display = 'inline';
    }
    document.getElementById('mzta-loading').style.display = 'none';
    document.getElementById('mzta-force-completion').style.display = 'none';
    document.getElementById('mzta-forcecomp-hint').style.display = 'none';
    chatpgt_scrollToBottom();
}

function checkLoggedIn(){
    return !window.location.href.startsWith('https://chatgpt.com/auth/') && document.querySelector('button[data-testid*=login]') === null;
}

function showCustomTextField(){
    let rawArray = current_message.prompt_info?.custom_text_array;
    _customTextArray = Array.isArray(rawArray) ? rawArray : [];
    if (_customTextArray.length === 0) {
            _customTextArray.push({ placeholder: "{%additional_text%}", info: "" });
    }
    _currentCustomTextIndex = 0;
    document.getElementById('mzta-custom_text').style.display = 'block';
    renderCustomTextStep();
}

async function doProceed(message, customText = ''){
    let _gpt_model = mztaGPTModel;
    doLog("doProceed _gpt_model: " + JSON.stringify(_gpt_model));
    if(_gpt_model != ''){
        await checkGPTModel(_gpt_model);
    }
    let final_prompt = message.prompt;

    if (Array.isArray(customText)) {
        let anyReplaced = false;
        customText.forEach(obj => {
            if (final_prompt.includes(obj.placeholder)) {
                anyReplaced = true;
                let escapedPH = obj.placeholder.replace(/[.*+?^{$}()|[\\]\\\\]/g, '\\\\$&');
                let regex = new RegExp(escapedPH, 'g');
                final_prompt = final_prompt.replace(regex, obj.custom_text);
            }
        });
        if (!anyReplaced) {
            const inputText = customText.map(obj => obj.custom_text).join(' ');
            if (inputText !== '') {
                final_prompt += ' ' + inputText;
            }
        }
    } else {
        //check if there is the additional_text placeholder
        if(final_prompt.includes('{%additional_text%}')){
            final_prompt = final_prompt.replace('{%additional_text%}', customText || (mztaPhDefVal == '1'?'':'{%additional_text%}'));
        }else{
            if(customText != ''){
                final_prompt += ' '+customText;
            }
        }
    }

    let send_result = await chatgpt_sendMsg(final_prompt,'click');
    //console.log(">>>>>>>>>>> send_result: " + send_result);
    switch(send_result){
        case -1:        // prompt not sent, it is still in the composer
            let curr_msg = document.getElementById('mzta-curr_msg');
            curr_msg.style.display = 'block';
            curr_msg.textContent = browser.i18n.getMessage("chatgpt_sendbutton_not_found_error");
            // no return: the user is asked to click Send, then the idle wait below catches the answer
            break;
        case -2:    // textarea not found
            let curr_model_warn = document.getElementById('mzta-model_warn');
            curr_model_warn.textContent = browser.i18n.getMessage("chatgpt_textarea_not_found_error");
            curr_model_warn.style.display = 'inline-block';
            document.getElementById('mzta-curr_msg').textContent = "";
            document.getElementById('mzta-loading').style.display = 'none';
            let btn_retry = document.createElement('button');
            btn_retry.id="mzta-btn_retry";
            btn_retry.classList.add('mzta-btn');
            btn_retry.style.position = 'absolute';
            btn_retry.style.top = '5px';
            btn_retry.style.right = '5px';
            btn_retry.textContent = browser.i18n.getMessage("chatgpt_btn_retry");
            btn_retry.addEventListener('click', function() {
                doRetry();
            });
            curr_model_warn.insertAdjacentElement('afterend', btn_retry);
            // nothing was sent: stop here, the retry runs its own idle wait
            return;
    }
    let forcecompletionHintTimeout;
    if(send_result == 0){
            forcecompletionHintTimeout = setTimeout(() => {
            document.getElementById('mzta-forcecomp-hint').style.display = 'block';
        }, delay_wait_completion);
    }
    await chatgpt_isIdle();
    if(send_result == 0){
        clearTimeout(forcecompletionHintTimeout);
    }
    operation_done();
}

async function doRetry(){
    document.getElementById('mzta-model_warn').style.display = 'none';
    document.getElementById('mzta-btn_retry')?.remove();
    document.getElementById('mzta-loading').style.display = 'inline-block';
    let curr_msg = document.getElementById('mzta-curr_msg');
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_retrying");
    curr_msg.style.display = 'block';
    // visible feedback, so a retry that fails again does not look like a dead button
    await waitMs(800);
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_working");
    if (_customTextArray.length > 0) {
        doProceed(current_message, _customTextArray);
    } else {
        doProceed(current_message);
    }
}

async function showForceCompletionHint(){
    const forcecompletionHintTimeout = setTimeout(() => {
        document.getElementById('mzta-forcecomp-hint').style.display = 'block';
    }, delay_wait_completion);
    await chatgpt_isIdle();
    clearTimeout(forcecompletionHintTimeout);
}

function removeTagsAndReturnHTML(rootElement, removeTags, preserveTags) {
    const fragment = document.createDocumentFragment();

    function handleElement(element) {
        let child = element.firstChild;
        while (child) {
            const nextSibling = child.nextSibling;
            if (preserveTags.includes(child.nodeName.toLowerCase())) {
                //console.log(">>>>>>>>>>>> preserve child: " + child.tagName.toLowerCase());
                fragment.appendChild(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                //console.log(">>>>>>>>>>>> handleElement(child): " + child.tagName.toLowerCase());
                handleElement(child);
            }
            child = nextSibling;
        }
    }

    removeTags.forEach(tag => {
        const elements = Array.from(rootElement.getElementsByTagName(tag));
        elements.forEach(element => {
            handleElement(element);
            element.parentNode.insertBefore(fragment.cloneNode(true), element);
            element.parentNode.removeChild(element);
            //console.log(">>>>>>>>>>>> removeChild: " + element.tagName.toLowerCase());
        });
    });

    replaceNewlinesWithBr(rootElement);
    //console.log(">>>>>>>>>>>> rootElement.innerHTML: " + rootElement.innerHTML);
    // Return the updated HTML as a string
    return rootElement.innerHTML;
}

// Replace newline characters with <br> tags
function replaceNewlinesWithBr(node) {
    for (let child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const parts = child.textContent.split('\\n');
            if (parts.length > 1) {
                const fragment = document.createDocumentFragment();
                parts.forEach((part, index) => {
                    fragment.appendChild(document.createTextNode(part));
                    if (index < parts.length - 1) {
                        fragment.appendChild(document.createElement('br'));
                    }
                });
                child.parentNode.replaceChild(fragment, child);
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            replaceNewlinesWithBr(child);
        }
    }
}

function getSelectedHtml() {
    // Get the Selection object
    var selection = window.getSelection();
    // console.log(">>>>>>>>>>>>> getSelectedHtml selection.rangeCount: " + selection.rangeCount);
    if (selection.rangeCount > 0) {
        // Get the first selected range
        var range = selection.getRangeAt(0);
        
        // Create a new temporary div
        var tempDiv = document.createElement("div");
        
        // Clone the contents of the range into the temporary div
        tempDiv.appendChild(range.cloneContents());
        // console.log(">>>>>>>>>>>>>>>>>> tempDiv.innerHTML: " + tempDiv.innerHTML);
        // Return the HTML of the selected content
        return tempDiv.innerHTML.replace(/^<p>&quot;/, '<p>').replace(/&quot;<\\/p>$/, '</p>'); // strip quotation marks;
    }
    if (lastSelectedHtml) {
        // console.log(">>>>>>>>>>>>> getSelectedHtml using cached selection lastSelectedHtml: "+ lastSelectedHtml);
        return lastSelectedHtml;
    }
    return "";
}

function isSomethingSelected() {
    // Get the Selection object
    var selection = window.getSelection();
    
    // Check if the selection range count is greater than 0 and the selection is not empty
    return selection.rangeCount > 0 && !selection.isCollapsed;
}

document.addEventListener("selectionchange", function() {
     // Clear any previous timeout to reset the delay
     clearTimeout(selectionChangeTimeout);
     if(current_action === '0'){
         return;
     }
     // Set a timeout to delay the execution of the callback
     selectionChangeTimeout = setTimeout(function() {
        let btn_ok = document.getElementById('mzta-btn_ok');
        let btn_diff = document.getElementById('mzta-btn_diff');
        if (isSomethingSelected()) {
            // Cache the selection
            var selection = window.getSelection();
            if (selection.rangeCount > 0) {
                var range = selection.getRangeAt(0);
                var tempDiv = document.createElement("div");
                tempDiv.appendChild(range.cloneContents());
                lastSelectedHtml = tempDiv.innerHTML.replace(/^<p>&quot;/, '<p>').replace(/&quot;<\\/p>$/, '</p>');
            }
            enableButton(btn_ok);
            if(current_action == '1'){
                let btn_reply_type = document.getElementById('mzta-btn_change_reply_type');
                enableButton(btn_reply_type);
            }
            if(mztaUseDiffViewer == '1'){
                enableButton(btn_diff);
            }
        } else {
            disableButton(btn_ok);
            if(current_action == '1'){
                let btn_reply_type = document.getElementById('mzta-btn_change_reply_type');
                disableButton(btn_reply_type);
            }
            if(mztaUseDiffViewer == '1'){
                disableButton(btn_diff);
            }
        }
     }, 300); // Delay in milliseconds
});

function enableButton(btn){
    btn.disabled = false;
    btn.classList.remove('btn_disabled');
}

function disableButton(btn){
    btn.disabled = true;
    btn.classList.add('btn_disabled');
}

function selectContentOnMouseDown(event) {
    // Reset the dragging flag when the mouse is pressed down
    isDragging = false;
}

function selectContentOnMouseMove(event) {
    // Set the dragging flag to true if the mouse moves
    isDragging = true;
}

function selectContentOnMouseUp(event) {
    var excludedArea = document.querySelector('.mzta-header-fixed');

    if (excludedArea && excludedArea.contains(event.target)) {
        // If the click was inside the excluded area, do nothing
        return;
    }
    // console.log(">>>>>>>>>>>>> selectContentOnMouseUp isDragging: " + isDragging);
    // Reset the dragging flag when the mouse is released")
    if ((!isDragging)&&(!isSomethingSelected())) {
        // If no dragging has occurred, execute the selection code
        selectContentOnClick(event);
    }
    // Remove the event listeners to prevent future executions
    // document.removeEventListener('mousedown', selectContentOnMouseDown);
    // document.removeEventListener('mousemove', selectContentOnMouseMove);
    // document.removeEventListener('mouseup', selectContentOnMouseUp);
}

function selectContentOnClick(event) {
    if(current_action === '0'){
        return;
    }

    // Prevent the default behavior of the click
    event.preventDefault();

    // Get the element that was clicked
    var clickedElement = event.target;

    // Traverse the DOM upwards to find the nearest parent div
    var parentDiv = clickedElement.closest('div');

    // console.log(">>>>>>>>>>>>> parentDiv: " + parentDiv.classList);

    if (parentDiv) {
        // Create a range object
        var range = document.createRange();

        // Select the contents of the div
        range.selectNodeContents(parentDiv);

        // Get the selection object
        var selection = window.getSelection();

        // Clear any existing selections
        selection.removeAllRanges();

        // Add the new range to the selection
        selection.addRange(range);
        // console.log(">>>>>>>>>>>>> selectContentOnClick selection.rangeCount: " + selection.rangeCount);
    }
}

function doLog(msg){
    if(mztaDoDebug == 1){
        console.log("[ThunderAI | ChatGPT Web] " + msg);
    }
}

function run(checkTab = null) {
    if(!checkLoggedIn()){
        // User not logged in
        if(checkTab){
            clearInterval(checkTab);
        }
        doLog("User not logged in, showing warning message.");
        alert(browser.i18n.getMessage("chatgpt_user_not_logged_in"));
        // we are not closing the window, because the user could try to log in
        // doLog("User not logged in, closing window.");
        // browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId});
    }else{
        addCustomDiv(current_action,current_tabId,current_mailMessageId);
        (async () => {
            if(mztaDoCustomText === "1"){
                showCustomTextField();
            } else {
                await doProceed(current_message);
            }
            // Add an event listener to the document to detect clicks
            document.addEventListener('mousedown', selectContentOnMouseDown);
            document.addEventListener('mousemove', selectContentOnMouseMove);
            document.addEventListener('mouseup', selectContentOnMouseUp);
        })();
    }
}

// In the content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    //console.log(">>>>>>>>>>>>> content.js onMessage: " + JSON.stringify(message));
    switch(message.command) {
        case "chatgpt_send":
            current_action = message.action;
            current_message = message;
            current_tabId = message.tabId;
            current_mailMessageId = message.mailMessageId;
            if((current_mailMessageId == -1) && (current_action == '1')) {    // we are using the reply from the compose window!
                current_action = '2'; // replace text
            }
            run(checkTab);
            break;
        case "chatgpt_alive":
            sendResponse({isAlive: true});
            break;
    }
});

let checkTab = setInterval(() => {
    let customDiv = document.getElementById('mzta-custom_text');
    if(customDiv){
        clearInterval(checkTab);
    }else{
        run(checkTab);
    }
}, 1000);

`
