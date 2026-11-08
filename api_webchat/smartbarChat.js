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

/*
 *  The API chat window in Smart bar mode (claude-spec/10-smartbar.md "Chat"): loaded by
 *  controller.js only when the page is opened with ?smartbar=1, never otherwise.
 *
 *  The page makes no call itself. The channel stands where the provider worker would stand:
 *  <message-input> posts { type: 'chatMessage' } and { type: 'stop' } to it unchanged, and it
 *  forwards them to the background (smartbar_chat_send / smartbar_chat_stop). The background
 *  routes every message, runs its operations or answers it, and sends the turns back:
 *    smartbar_chat_init     the session's records, when the window is ready
 *    smartbar_chat_update   a record changed (its seq: an older one is ignored)
 *    smartbar_chat_stream   the reasoning (cumulative) and the tokens of a free answer
 *    smartbar_chat_prefill  an instruction to put in the input, with an attached context
 *
 *  One turn per record: the user's message, then a model turn holding the reasoning (the chat's
 *  thinking block, never stored), the free answer (through <messages-area>'s one render path), the
 *  drafts (Create email) and the result lines, which read as in the bar
 *  (js/lib/mzta-smartbar-lines.js).
 */

// A classic script with no import or export: imported for its effect, it defines
// globalThis.mztaSmartbarLines, as the bar loads it.
import '../js/lib/mzta-smartbar-lines.js';
import { renderThinkingBlock } from './thinkingBlock.js';
import { buildStyleSheet } from './sharedStyles.js';

const msg = (key, subs) => browser.i18n.getMessage(key, subs) || key;

// The look of the turns this module builds, adopted into <messages-area>'s shadow root (where
// they live) in this mode only.
const TURNS_CSS = `
    .sb-lines { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .sb-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--ink); }
    .sb-line .st { width: 1.2em; text-align: center; }
    .sb-line .tx { flex: 1; min-width: 10em; }
    .sb-line.error .tx { color: var(--err-ink); }
    .sb-line.done .st { color: var(--ok-ink); }
    .sb-line.running .st { color: var(--accent); }
    .sb-line.pending_confirmation .st { color: var(--warn); }
    .sb-line.note .tx, .sb-line.report .tx { color: var(--ink-2); }
    .sb-line .countdown { color: var(--ink-2); }
    .sb-line button { border: none; background: none; color: var(--accent); cursor: pointer; font: inherit; padding: 0 4px; text-decoration: underline; }
    .sb-draft { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); padding: 8px 10px; margin-top: 6px; }
    .sb-draft-label { color: var(--ink-2); font-size: .85em; margin-bottom: 4px; }
    .sb-draft-subject { font-weight: 600; margin-bottom: 6px; }
    .sb-draft-body { white-space: pre-wrap; }
    .sb-draft .action-bar { margin-top: 8px; }
`;

// The header button and the note above the input live in the page's own document: their rules
// are in styles.css (matching nothing without this mode).

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
}

// The refusals of the background (smartbar_chat_send, smartbar_chat_create), as the user reads
// them; any other error is already a text.
const REFUSALS = {
    disabled: 'smartbar_chat_error_disabled',
    not_found: 'smartbar_chat_error_not_found',
    not_chat: 'smartbar_chat_error_closed',
    no_chat: 'smartbar_chat_error_closed',
};

/** The text of a background error: a known refusal code localized, else the error itself. */
export function refusalText(error) {
    const e = String(error ?? '');
    return Object.hasOwn(REFUSALS, e) ? msg(REFUSALS[e]) : (e || msg('apiwebchat_status_error'));
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Whether a record is still being understood or answered (no operation, no answer, no error). */
export function turnInProgress(record) {
    return !!record && record.state === 'running' && (record.operations || []).length === 0 && !record.errorType && !record.answer;
}

export function createSmartbarChannel(options) {
    return new SmartbarChannel(options);
}

class SmartbarChannel {
    constructor({ messagesArea, messageInput, chatId, headerMessageId }) {
        this.ma = messagesArea;
        this.mi = messageInput;
        this.chatId = chatId;
        this.headerMessageId = headerMessageId;
        this.sessionId = null;
        // recordId -> { record, seq, userTurn, turn, body, linesEl, thinkingEl, thinkingText,
        // streamStarted, answerDone }
        this.views = new Map();
        // The message the input drew and sent, until its record arrives: { clientId, turn }.
        this.pending = null;
        // The record of the message the input sent, while it is understood or answered.
        this.localRecordId = null;
        // The record whose answer is streaming: new turns wait for its end.
        this.streamingRecordId = null;
        this.deferred = [];
        this.clientSeq = 0;
        // The rate-limit countdowns (key: record|index -> interval) and the lines that already
        // retried by themselves once.
        this.countdowns = new Map();
        this.autoRetried = new Set();
        this._installStyles();
        this._buildPageParts();
    }

    // ── The worker's side, for <message-input> ────────────────────────────────────────────────
    postMessage(message) {
        if (message?.type === 'chatMessage') this._send(message.message);
        else if (message?.type === 'stop') this._stop();
        // 'init' (the provider's settings) and anything else: the background makes the calls.
    }

    terminate() {}

    _command(command, extra = {}) {
        return browser.runtime.sendMessage({ command: command, headerMessageId: this.headerMessageId, chatId: this.chatId, ...extra })
            .catch(e => ({ ok: false, error: String(e?.message || e) }));
    }

    async _send(text) {
        const clientId = 'c' + (++this.clientSeq);
        const turns = this._turnsEl()?.querySelectorAll('.turn-user');
        this.pending = { clientId: clientId, turn: turns?.length ? turns[turns.length - 1] : null };
        this._dropContextNote(false);
        const res = await this._command('smartbar_chat_send', { text: text, clientId: clientId });
        if (!res?.ok) {
            this.pending = null;
            this.ma.appendBotMessage(refusalText(res?.error), 'error');
            this.mi.enableInput(false);
            this.mi.showErrorStatus();
            return;
        }
        // The record may have arrived before this answer: its turn is then in progress already.
        if (this.views.has(res.recordId) && turnInProgress(this.views.get(res.recordId).record)) this.localRecordId = res.recordId;
    }

    _stop() {
        this._command('smartbar_chat_stop', { recordId: this.localRecordId ?? null });
    }

    // ── From the background ──────────────────────────────────────────────────────────────────
    handleBackground(message, sender) {
        // Only the background's own messages to this window: a content script's message (the
        // bar's commands reach every extension page) carries its tab.
        if (sender?.tab || message?.chatId !== this.chatId || message?.headerMessageId !== this.headerMessageId) return;
        switch (message.command) {
            case 'smartbar_chat_init':
                this._init(message);
                break;
            case 'smartbar_chat_update':
                this._update(message.record, message.seq, message.clientId ?? null);
                break;
            case 'smartbar_chat_stream':
                this._stream(message);
                break;
            case 'smartbar_chat_prefill':
                if (message.text) this.mi._setMessageInputValue(message.text);
                this._showContextNote(message.hasRawContext === true);
                break;
        }
    }

    _init({ sessionId, records = [], total = 0, seq = 0 }) {
        this.sessionId = sessionId ?? null;
        if (total > records.length) {
            this.ma.appendUserMessage(escapeHtml(msg('smartbar_chat_earlier_hidden', [String(total - records.length)])), 'info');
        }
        for (const record of records) this._update(record, seq, null, true);
        this._syncNewConversation();
    }

    // resumed: a record of the session the window was opened on (smartbar_chat_init), not one of
    // this window's life.
    _update(record, seq, clientId, resumed = false) {
        if (!record || record.id === undefined) return;
        let view = this.views.get(record.id);
        if (!view) {
            // Another session's record (one still running after New conversation): not shown.
            if (this.sessionId !== null && record.sessionId !== this.sessionId && !(clientId && this.pending?.clientId === clientId)) return;
            // A new turn waits while an answer streams: drawing it would cut the stream.
            if (this.streamingRecordId !== null) {
                this.deferred.push([record, seq, clientId, resumed]);
                return;
            }
            if (this.sessionId === null) this.sessionId = record.sessionId ?? null;
            view = this._newView(record, clientId, resumed);
        }
        if (Number.isFinite(seq) && seq < view.seq) return;
        if (Number.isFinite(seq)) view.seq = seq;
        view.record = record;
        this._render(view);
        // The input comes back once the message it sent is planned, answered, failed or stopped,
        // also when its first update arrives already ended (a fast answer).
        if ((this.localRecordId === record.id || (view.local && !view.released)) && !turnInProgress(record)) {
            view.released = true;
            if (this.localRecordId === record.id) this.localRecordId = null;
            if (record.errorType) {
                this.mi.enableInput(false);
                this.mi.showErrorStatus();
            } else if (record.state === 'replaced') {
                this.mi.enableInput(false);
            } else {
                this.mi.enableInput(true);
            }
        }
        this._syncNewConversation();
    }

    _newView(record, clientId, resumed = false) {
        let userTurn = null;
        let local = false;
        if (clientId && this.pending?.clientId === clientId) {
            userTurn = this.pending.turn;
            local = true;
            this.pending = null;
        }
        if (!userTurn) {
            // A message the input did not draw: from the bar, a Retry, or a resumed session.
            this.ma.appendUserMessage(String(record.instruction ?? ''));
            const turns = this._turnsEl()?.querySelectorAll('.turn-user');
            userTurn = turns?.length ? turns[turns.length - 1] : null;
        }
        const { turn, body } = this.ma.beginCustomBotTurn();
        const view = {
            record: record, seq: -1, userTurn: userTurn, turn: turn, body: body,
            linesEl: el('div', { class: 'sb-lines' }), thinkingEl: null, thinkingText: '',
            streamStarted: false, answerDone: false, resumed: resumed, local: local, released: false,
        };
        body.appendChild(view.linesEl);
        this.views.set(record.id, view);
        if (local && turnInProgress(record)) this.localRecordId = record.id;
        return view;
    }

    _stream({ recordId, thinking, tokens }) {
        const view = this.views.get(recordId);
        if (!view) return;
        if (typeof thinking === 'string') {
            view.thinkingText = thinking;
            if (turnInProgress(view.record)) this._showThinkingLive(view);
        }
        if (typeof tokens === 'string' && tokens !== '' && !view.answerDone) {
            if (!view.streamStarted) {
                view.streamStarted = true;
                this.streamingRecordId = recordId;
                this._removeThinkingLive(view);
                this.ma.streamInto(view.turn);
            }
            this.ma.handleNewToken(tokens);
            this.mi.showStreamingStatus();
        }
    }

    // ── Drawing a record ─────────────────────────────────────────────────────────────────────
    async _render(view) {
        const record = view.record;
        const inProgress = turnInProgress(record);
        if (inProgress) {
            if (view.thinkingText) this._showThinkingLive(view);
        } else {
            this._removeThinkingLive(view);
            if (view.thinkingText && !view.thinkingBlock) {
                const holder = el('div');
                renderThinkingBlock(holder, view.thinkingText, this.ma.hideThinking !== false);
                view.thinkingBlock = holder.firstElementChild;
                if (view.thinkingBlock) this._afterName(view, view.thinkingBlock);
            }
        }
        if (typeof record.answer === 'string' && record.answer !== '' && !view.answerDone) {
            view.answerDone = true;
            if (!view.streamStarted) {
                // Not streamed (ThunderAI Privacy on, or a resumed session): rendered whole. The
                // turns after it wait meanwhile, as for a stream.
                this.streamingRecordId = record.id;
                this.ma.streamInto(view.turn);
                this.ma.handleNewToken(record.answer);
            }
            await this.ma.handleTokensDone(null);
            this.streamingRecordId = null;
            this._drainDeferred();
        }
        this._renderLines(view);
        // The lines stay under the answer.
        view.body.appendChild(view.linesEl);
        this._syncNewConversation();
    }

    _afterName(view, node) {
        const name = view.body.querySelector('.turn-name');
        view.body.insertBefore(node, name ? name.nextSibling : view.body.firstChild);
    }

    _showThinkingLive(view) {
        if (view.thinkingEl) return;
        const spinner = el('img', { class: 'thinking-spinner', src: '../images/mzta-thinking.svg', alt: '' });
        view.thinkingEl = el('div', { class: 'thinking-live' }, [spinner, el('span', { text: msg('prefs_OptionText_thinking_summary') + '...' })]);
        this._afterName(view, view.thinkingEl);
    }

    _removeThinkingLive(view) {
        view.thinkingEl?.remove();
        view.thinkingEl = null;
    }

    _drainDeferred() {
        const waiting = this.deferred.splice(0);
        for (const [record, seq, clientId, resumed] of waiting) this._update(record, seq, clientId, resumed);
    }

    _button(label, onClick, cls = '') {
        const b = el('button', { type: 'button', class: cls, text: label });
        b.addEventListener('click', onClick);
        return b;
    }

    _line(cls, icon, text, extra = []) {
        return el('div', { class: 'sb-line ' + cls }, [el('span', { class: 'st', text: icon }), el('span', { class: 'tx', text: text }), ...extra.filter(Boolean)]);
    }

    // A rate-limited error (spec 10 "Result lines", as in the bar): the seconds left, then ONE
    // automatic retry. Not for a resumed record (history: Retry only), never twice for a line
    // (autoRetried, also stored on an operation), and for the message itself (index null) only
    // while it is the newest turn: its retry is a new message. Returns the node, or null.
    _countdown(view, index, retryAt, autoRetried) {
        const key = view.record.id + '|' + (index ?? 'router');
        this._clearCountdown(key);
        if (view.resumed || autoRetried || this.autoRetried.has(key) || !Number.isFinite(retryAt)) return null;
        if (index === null && [...this.views.keys()].pop() !== view.record.id) return null;
        const span = el('span', { class: 'countdown' });
        const tick = () => {
            const left = Math.ceil((retryAt - Date.now()) / 1000);
            if (left <= 0) {
                this._clearCountdown(key);
                this.autoRetried.add(key);
                span.remove();
                this._command('smartbar_chat_retry', { recordId: view.record.id, index: index, auto: true });
                return;
            }
            span.textContent = msg('smartbar_retry_in', [String(left)]);
        };
        tick();
        if (this.autoRetried.has(key)) return null;
        this.countdowns.set(key, setInterval(tick, 1000));
        return span;
    }

    _clearCountdown(key) {
        if (!this.countdowns.has(key)) return;
        clearInterval(this.countdowns.get(key));
        this.countdowns.delete(key);
    }

    _renderLines(view) {
        const L = globalThis.mztaSmartbarLines;
        const record = view.record;
        const box = view.linesEl;
        box.replaceChildren();
        const id = record.id;
        // The countdowns of this record are drawn again below, if its lines still need one.
        for (const key of [...this.countdowns.keys()]) if (key.startsWith(id + '|')) this._clearCountdown(key);
        if (turnInProgress(record) && !view.streamStarted) {
            box.appendChild(this._line('running', L.STATE_ICON.running, msg('smartbar_routing')));
        }
        if (record.errorType && !record.dismissed?.error) {
            box.appendChild(this._line('error', L.STATE_ICON.error, msg('smartbar_line_router_error', [String(record.error || '')]), [
                record.errorType === 'rate_limit' ? this._countdown(view, null, record.retryAt, false) : null,
                this._button(msg('smartbar_retry'), () => this._command('smartbar_chat_retry', { recordId: id, index: null }), 'retry'),
                this._button(msg('smartbar_remove'), () => this._command('smartbar_chat_dismiss', { recordId: id, what: 'error' }), 'remove'),
            ]));
        }
        let lines = 0;
        for (const op of record.operations || []) {
            if (op.dismissed) continue;
            const isDraft = op.id === 'compose' && op.result && typeof op.result.body === 'string' && op.result.body !== '' &&
                (op.state === 'drafted' || op.state === 'done');
            if (isDraft) box.appendChild(this._draftBlock(record, op));
            // A draft speaks for itself; once created, its line says the window opened.
            if (isDraft && op.state === 'drafted') continue;
            const extra = [];
            if (op.state === 'running') extra.push(this._button(msg('smartbar_stop'), () => this._command('smartbar_chat_stop', { recordId: id, index: op.index }), 'stop'));
            else if (op.state === 'done' || op.state === 'cancelled') extra.push(this._button('×', () => this._command('smartbar_chat_dismiss', { recordId: id, what: op.index }), 'dismiss'));
            else if (op.state === 'pending_confirmation') {
                extra.push(this._button(msg('smartbar_confirm'), () => this._command('smartbar_chat_confirm', { recordId: id, index: op.index }), 'confirm'));
                extra.push(this._button(msg('smartbar_cancel'), () => this._command('smartbar_chat_cancel', { recordId: id, index: op.index }), 'cancel'));
            } else if (op.state === 'error') {
                // "Open in chat" is the bar's: here the user is in the chat already.
                if (op.errorType === 'rate_limit') {
                    const countdown = this._countdown(view, op.index, op.retryAt, op.autoRetried === true);
                    if (countdown) extra.push(countdown);
                }
                extra.push(this._button(msg('smartbar_retry'), () => this._command('smartbar_chat_retry', { recordId: id, index: op.index }), 'retry'));
                extra.push(this._button(msg('smartbar_remove'), () => this._command('smartbar_chat_dismiss', { recordId: id, what: op.index }), 'remove'));
            }
            box.appendChild(this._line(op.state, L.STATE_ICON[op.state] || '', L.opText(op), extra));
            lines++;
        }
        if (!record.dismissed?.reports) {
            for (const report of record.reports || []) {
                box.appendChild(this._line('report', 'ℹ', msg('smartbar_report_' + report.kind, [String(report.id || '')]),
                    [this._button('×', () => this._command('smartbar_chat_dismiss', { recordId: id, what: 'reports' }), 'dismiss')]));
            }
        }
        // The part no operation covers, when some were recognized: a note (no free answer).
        if (record.unrecognized && (record.operations || []).length > 0 && !record.dismissed?.unrecognized) {
            box.appendChild(this._line('note', '?', msg('smartbar_chat_unrecognized_note', [record.unrecognized]),
                [this._button('×', () => this._command('smartbar_chat_dismiss', { recordId: id, what: 'unrecognized' }), 'dismiss')]));
        }
        if (record.state === 'interrupted') box.appendChild(this._line('interrupted', L.STATE_ICON.cancelled, msg('smartbar_interrupted')));
        // Stopped from outside (the feature turned off; for a turn of the bar, a new instruction).
        if (record.state === 'replaced') box.appendChild(this._line('cancelled', L.STATE_ICON.cancelled, msg('smartbar_chat_replaced')));
        if (lines > 0) {
            box.appendChild(el('div', { class: 'sb-line details' }, [
                this._button(msg('smartbar_details'), () => browser.runtime.sendMessage({ command: 'smartbar_open_page' }).catch(() => {}), 'details'),
            ]));
        }
    }

    // A draft turn: the subject of a new email, the body, and its actions toolbar (Create email,
    // Copy). Create email delivers it as the bar's compose operation would; again, a second window.
    _draftBlock(record, op) {
        const L = globalThis.mztaSmartbarLines;
        const result = op.result;
        const block = el('div', { class: 'sb-draft' });
        block.appendChild(el('div', { class: 'sb-draft-label', text: msg('smartbar_chat_draft_label', [L.opLabel('compose', { type: result.type || op.params?.type })]) }));
        if (result.subject) block.appendChild(el('div', { class: 'sb-draft-subject', text: msg('smartbar_chat_draft_subject', [result.subject]) }));
        block.appendChild(el('div', { class: 'sb-draft-body', text: result.body }));
        const bar = el('div', { class: 'action-bar' });
        const create = el('button', { type: 'button', class: 'create_btn mzta-btn-secondary', text: msg('smartbar_chat_create_email') });
        const status = el('span', { class: 'sb-draft-status' });
        create.addEventListener('click', async () => {
            create.disabled = true;
            status.textContent = '';
            const res = await this._command('smartbar_chat_create', { recordId: record.id, index: op.index });
            create.disabled = false;
            if (!res?.ok) status.textContent = msg('smartbar_chat_create_failed', [refusalText(res?.error)]);
        });
        const copy = el('button', { type: 'button', class: 'copy_btn mzta-btn-secondary', text: msg('apiwebchat_copy') });
        copy.addEventListener('click', () => {
            const text = (result.subject ? result.subject + '\n\n' : '') + result.body;
            navigator.clipboard?.writeText(text).catch(() => {});
        });
        bar.appendChild(create);
        bar.appendChild(copy);
        bar.appendChild(status);
        block.appendChild(bar);
        return block;
    }

    // ── The parts of the page outside the transcript ─────────────────────────────────────────
    _turnsEl() {
        return this.ma.shadowRoot?.querySelector('#messages') || null;
    }

    _installStyles() {
        if (this.ma.shadowRoot) this.ma.shadowRoot.adoptedStyleSheets = [...this.ma.shadowRoot.adoptedStyleSheets, buildStyleSheet(TURNS_CSS)];
    }

    _buildPageParts() {
        const header = document.getElementById('appHeader');
        this.newConversationBtn = el('button', { type: 'button', id: 'smartbarNewConversation', text: msg('smartbar_chat_new_conversation') });
        this.newConversationBtn.addEventListener('click', () => this._newConversation());
        header?.appendChild(this.newConversationBtn);

        const close = el('button', { type: 'button', title: msg('smartbar_remove'), text: '×' });
        close.addEventListener('click', () => this._dropContextNote(true));
        this.contextNote = el('div', { id: 'smartbarContextNote' }, [el('span', { text: msg('smartbar_chat_raw_context_note') }), close]);
        this.contextNote.hidden = true;
        const input = document.querySelector('message-input');
        input?.parentNode?.insertBefore(this.contextNote, input);
    }

    _showContextNote(show) {
        this.contextNote.hidden = !show;
    }

    // The attached context goes with the next message: the note goes too. × drops it unsent.
    _dropContextNote(tellBackground) {
        if (this.contextNote.hidden) return;
        this.contextNote.hidden = true;
        if (tellBackground) this._command('smartbar_chat_drop_context');
    }

    _busy() {
        return this.localRecordId !== null || this.streamingRecordId !== null ||
            [...this.views.values()].some(v => turnInProgress(v.record));
    }

    _syncNewConversation() {
        this.newConversationBtn.disabled = this._busy();
    }

    // New conversation: a new session for this message (the bar's next instruction joins it
    // too). The turns shown go; the startup notice stays.
    async _newConversation() {
        if (this._busy()) return;
        const res = await this._command('smartbar_chat_new_session');
        if (!res?.ok) return;
        this.sessionId = res.sessionId;
        this.views.clear();
        for (const key of [...this.countdowns.keys()]) this._clearCountdown(key);
        this.deferred = [];
        const turns = [...(this._turnsEl()?.querySelectorAll('.turn') || [])];
        const keep = turns.find(t => t.classList.contains('turn-info'));
        for (const turn of turns) if (turn !== keep) turn.remove();
        this._dropContextNote(false);
        this.ma.appendUserMessage(escapeHtml(msg('smartbar_chat_new_conversation_started')), 'info');
        this._syncNewConversation();
    }
}
