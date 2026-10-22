/*
 *  The compose area's documents: a mail as the content script sees it (the body of a compose
 *  window, or a message in the message display), and the background page for the modules that
 *  need a DOM. All of them go through openDocument() (helpers/core/dom-harness.mjs).
 *
 *  openMailDocument() loads what mzta-background.js registers, in its order: the classic
 *  js/lib/mzta-html-lines.js, then the classic js/mzta-compose-script.js, which uses its globals.
 *  At load the script asks the background for the displayed message and fires checkSpamReport,
 *  initSummary and initTranslation: those four get an answer here (the displayed headerMessageId,
 *  null in a compose window); any other command a file expects goes in `commands`, so a command
 *  nobody declared is still a harness violation.
 *
 *  Imports only the core: no managed layer, no other area.
 */

import { readFileSync } from 'node:fs';
import { openDocument } from '../helpers/core/dom-harness.mjs';
import { BACKGROUND_URL } from '../helpers/core/browser-mock.mjs';
import {
    loadFixture,
    repoPath,
} from '../helpers/core/load.mjs';

/** The content scripts, in the order of the three registrations in mzta-background.js. */
export const CONTENT_SCRIPTS = ['js/lib/mzta-html-lines.js', 'js/mzta-compose-script.js'];

/** A compose window's url, and a message display's (an imap message). */
export const COMPOSE_URL = 'about:blank?compose';
export const DISPLAY_URL = 'imap://mail.example.com/INBOX?number=8';

/** The sender of a message from the background to the content script. */
export const FROM_BACKGROUND = { id: 'thunderai@micz.it' };

/** A JSON fixture of the area. */
export const fixture = name => loadFixture(name, 'compose');

/**
 * A captured message (tests/fixtures/compose/captured/*.txt, an .eml as Thunderbird saved it):
 * {headers: {lower-case name: value}, body}. CRLF becomes LF, as in the DOM. `encoding` is the
 * bytes' real encoding (mail_html_reading.txt is ISO-8859-1 bytes behind a utf-8 header).
 */
export function readCapture(name, { encoding = 'utf8' } = {}) {
    const raw = readFileSync(repoPath('tests/fixtures/compose/captured/' + name), encoding).replace(/\r\n/g, '\n');
    const cut = raw.indexOf('\n\n');
    const headers = {};
    let last = null;
    for (const line of raw.slice(0, cut).split('\n')) {
        if (/^\s/.test(line) && last) { headers[last] += ' ' + line.trim(); continue; }
        const i = line.indexOf(':');
        last = line.slice(0, i).trim().toLowerCase();
        headers[last] = line.slice(i + 1).trim();
    }
    return { headers, body: raw.slice(cut + 2) };
}

/**
 * The body of a live plain text compose window (captured/plaintext_compose_body_live.html), as a
 * document; with `typed`, the variant of plaintext-compose-typed.json (three typed lines).
 */
export function plainTextComposeHtml({ typed = false } = {}) {
    let body = readFileSync(repoPath('tests/fixtures/compose/captured/plaintext_compose_body_live.html'), 'utf8').trim();
    if (typed) {
        const t = fixture('plaintext-compose-typed.json');
        const at = body.indexOf(t.replaces);
        if (at === -1) throw new Error('plaintext-compose-typed.json: the capture no longer opens with ' + t.replaces);
        body = body.slice(0, at) + t.typed_html + body.slice(at + t.replaces.length);
    }
    return '<!DOCTYPE html><html><head></head>' + body + '</html>';
}

/**
 * The body of a live message display, captured (tests/fixtures/compose/captured/<name>, a <body>
 * read with tabs.executeScript), as a document.
 */
export function liveCaptureHtml(name) {
    const body = readFileSync(repoPath('tests/fixtures/compose/captured/' + name), 'utf8').trim();
    return '<!DOCTYPE html><html><head></head>' + body + '</html>';
}

/**
 * Open a mail document with the content scripts loaded.
 *
 * @param {object} o
 *   html                the document
 *   url                 COMPOSE_URL or DISPLAY_URL
 *   displayedMessageId  what getDisplayedMessageId answers (null: a compose window)
 *   commands            the other background commands the file expects
 *   ...                 openDocument() options (confirm, local...)
 */
export async function openMailDocument({ html, url = COMPOSE_URL, displayedMessageId = null, commands = {}, ...rest }) {
    const ctx = await openDocument({
        name: url === COMPOSE_URL ? 'compose window' : 'message display',
        html,
        url,
        scripts: CONTENT_SCRIPTS,
        commands: {
            getDisplayedMessageId: () => displayedMessageId,
            checkSpamReport: () => undefined,
            initSummary: () => undefined,
            initTranslation: () => undefined,
            ...commands,
        },
        ...rest,
    });
    stubDialogs(ctx.window);
    return ctx;
}

/** The background page: an empty document with the classic rich-text globals and the modules. */
export function openBackgroundDocument({ modules = [], apis } = {}) {
    return openDocument({
        name: 'background page',
        html: '<!DOCTYPE html><html><head></head><body></body></html>',
        url: BACKGROUND_URL,
        scripts: ['js/lib/mzta-html-lines.js'],
        modules,
        apis,
    });
}

/**
 * Deliver a background command to the content script (runtime.onMessage), then settle. Resolves
 * to the listener's answer; a listener that throws rejects, after the settle.
 */
export async function send(ctx, message) {
    let answer, error = null;
    try {
        answer = await ctx.ctl.dispatchMessage(message, FROM_BACKGROUND);
    } catch (e) {
        error = e;
    }
    await ctx.settle();
    if (error) throw error;
    return answer;
}

/** Every command the content script sent to the background with that name, in order. */
export function sentCommands(ctx, command) {
    return ctx.ctl.sent.filter(m => m && m.command === command);
}

/**
 * <dialog>'s showModal() / close(), which jsdom does not implement (the sendAlert and getTags
 * dialogs of a message display). Modelled on HTML: showModal() sets `open`, close() removes it and
 * QUEUES the close event, so a listener added right after close() - as the content script does -
 * still gets it. The task is a tracked timer, so settle() waits for it.
 */
function stubDialogs(window) {
    const proto = window.HTMLDialogElement.prototype;
    if (typeof proto.showModal === 'function') return;
    proto.showModal = function () { this.setAttribute('open', ''); };
    proto.show = function () { this.setAttribute('open', ''); };
    proto.close = function () {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        window.setTimeout(() => this.dispatchEvent(new window.Event('close')), 0);
    };
}

/**
 * The compose editor's document.execCommand(), which jsdom does not implement, and the window's
 * focus(). Modelled on the two commands replaceSelectedText uses, acting on the CURRENT selection
 * as Gecko's editor does: insertHTML replaces it with the markup's nodes, insertText with a Text
 * node. What Gecko's plain text editor makes of a \n (a line break) and the undo stack itself are
 * not modelled: those are the manual test in Thunderbird.
 *
 * `editor.mode`, changeable between tests: 'ok' (the command runs, true), 'refuse' (false,
 * nothing changes) or 'throw'. `editor.calls`: one {command, showUI, value, range, focusCalls}
 * per call - `range` the selection's range as it was at the call (null with none: a snapshot,
 * see below), `focusCalls` how many window.focus() calls came before it. `editor.focusCalls`: the
 * running count.
 */
export function stubEditor(ctx, { mode = 'ok' } = {}) {
    const editor = { mode, calls: [], focusCalls: 0 };
    ctx.window.focus = () => { editor.focusCalls++; };
    ctx.document.execCommand = (command, showUI, value) => {
        const sel = ctx.window.getSelection();
        const range = sel.rangeCount ? sel.getRangeAt(0) : null;
        editor.calls.push({ command, showUI, value, range: range && snapshot(range), focusCalls: editor.focusCalls });
        if (editor.mode === 'throw') throw new Error('execCommand: modelled failure');
        if (editor.mode === 'refuse' || !range) return false;
        if (command !== 'insertHTML' && command !== 'insertText') return false;
        range.deleteContents();
        let inserted;
        if (command === 'insertText') {
            inserted = ctx.document.createTextNode(value);
        } else {
            const template = ctx.document.createElement('template');
            template.innerHTML = value;
            inserted = template.content;
        }
        range.insertNode(inserted);
        range.collapse(false);
        return true;
    };
    return editor;
}

/**
 * A range as it is now, frozen (a cloned Range is live and moves with the insertion): its text,
 * whether it is collapsed, its start, and the node right after its start when that is an element
 * (null at its end).
 */
function snapshot(range) {
    const { startContainer, startOffset } = range;
    return {
        text: range.toString(),
        collapsed: range.collapsed,
        startContainer,
        startOffset,
        nodeAfterStart: startContainer.nodeType === 1 ? (startContainer.childNodes[startOffset] ?? null) : null,
    };
}

/** The error lines the content script logged since `from` (an index into ctx.con.entries). */
export function errorsSince(ctx, from) {
    return ctx.con.entries.slice(from).filter(e => e.level === 'error');
}

// ---------------------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------------------

/** The text nodes under `root`, in document order. */
export function textNodes(ctx, root = ctx.document.body) {
    const out = [];
    const walker = ctx.document.createTreeWalker(root, ctx.window.NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
}

/**
 * [text node, offset] of the first occurrence of `str` inside one text node (its end with `end`),
 * at or after `[fromNode, fromOffset]` in document order when given.
 */
function locate(ctx, str, { end = false, after = null } = {}) {
    const nodes = textNodes(ctx);
    const first = after ? nodes.indexOf(after[0]) : 0;
    for (const node of nodes.slice(first)) {
        const i = node.data.indexOf(str, after && node === after[0] ? after[1] : 0);
        if (i !== -1) return [node, end ? i + str.length : i];
    }
    throw new Error('selection: no text node holds ' + JSON.stringify(str));
}

/** Select from the start of `from` to the end of the first `to` after it (each inside one text node). */
export function select(ctx, from, to = from) {
    const range = ctx.document.createRange();
    const start = locate(ctx, from);
    range.setStart(...start);
    range.setEnd(...locate(ctx, to, { end: true, after: start }));
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
}

/** A collapsed selection (the caret) right after `str`. */
export function caretAfter(ctx, str) {
    const range = ctx.document.createRange();
    const [node, offset] = locate(ctx, str, { end: true });
    range.setStart(node, offset);
    range.collapse(true);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
}

export function clearSelection(ctx) {
    ctx.window.getSelection().removeAllRanges();
}

/** The add-on's own elements in the document (MZTA_INJECTED_SELECTORS' first two). */
export function injected(ctx) {
    return ctx.$$('#mzta-container, .mzta_dialog');
}
