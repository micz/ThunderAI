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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { prefs_default } from '../options/mzta-options-default.js';
import './splitButton.js';   // registers the <split-button> custom element
import { renderDiff } from './diffViewer.js';
import { renderThinkingBlock } from './thinkingBlock.js';
import { StreamingMessage } from './streamingMessage.js';
import { SHARED_BASE_CSS, BUTTON_CSS } from './sharedStyles.js';
import {
    buildSparkleIcon, buildCopyIcon, buildCheckIcon, buildDiffIcon,
    buildSaveIcon, buildUseAnswerIcon,
} from './svgIcons.js';
const messagesAreaTemplate = document.createElement('template');

const messagesAreaStyle = document.createElement('style');
messagesAreaStyle.textContent = SHARED_BASE_CSS + BUTTON_CSS + `
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
    }
    #messages {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        padding: 18px 18px 8px;
        overflow-x: hidden;
        overflow-y: auto;
        max-height: 100%;
        box-sizing: border-box;
    }

    /* ---- turns ----
       Every exchange is wrapped in a .turn. The wrapper is what makes the
       per-answer toolbar possible: :hover / :focus-within need a single
       element enclosing the answer and its buttons. */
    .turn {
        margin-bottom: 18px;
        animation: mztaTurnIn .18s ease-out;
    }
    @keyframes mztaTurnIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .turn-user {
        display: flex;
        justify-content: flex-end;
    }
    .turn-user .bubble {
        max-width: 78%;
        background: var(--accent);
        color: #fff;
        padding: 10px 14px;
        border-radius: var(--r-bubble) var(--r-bubble) 4px var(--r-bubble);
        font-size: .875rem;
        line-height: 1.45;
    }

    .turn-bot {
        display: flex;
        gap: 11px;
    }
    .turn-head {
        flex-shrink: 0;
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: var(--accent-soft);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 2px;
    }
    .turn-body {
        flex: 1;
        min-width: 0;
    }
    .turn-name {
        font-size: .8125rem;
        font-weight: 650;
        color: var(--ink-2);
        margin-bottom: 5px;
    }
    .turn-error .turn-head {
        background: var(--err-bg);
        color: var(--err-ink);
    }
    .turn-error .turn-name {
        color: var(--err-ink);
    }

    .message {
        margin: 0;
        font-size: .875rem;
        line-height: 1.55;
        color: var(--ink);
    }
    .message p{
        margin: 0 0 10px;
        padding: 0;
    }
    .message p:last-child{
        margin-bottom: 0;
    }
    .token {
        display: inline;
        opacity: 0;
        animation: fadeIn 1000ms forwards;
    }
    @keyframes fadeIn {
        to {
            opacity: 1;
        }
    }

    /* ---- rendered markdown ---- */
    .message code {
        font-family: var(--font-mono);
        background: var(--code-bg);
        padding: 2px 6px;
        border-radius: 5px;
        font-size: .9em;
    }
    .message pre {
        background: var(--code-bg);
        padding: 10px 12px;
        border-radius: var(--r-md);
        overflow-x: auto;
    }
    .message pre code {
        background: none;
        padding: 0;
    }
    .message blockquote {
        margin: 0 0 10px;
        padding-left: 12px;
        border-left: 3px solid var(--border-strong);
        color: var(--ink-2);
    }
    .message ul, .message ol {
        margin: 0 0 10px;
        padding-left: 22px;
    }
    .message a {
        color: var(--accent);
    }
    .message table {
        border-collapse: collapse;
        margin-bottom: 10px;
    }
    .message th, .message td {
        border: 1px solid var(--border);
        padding: 5px 9px;
        text-align: left;
    }
    .message th {
        background: var(--surface-2);
    }

    /* ---- action bar (newest answer only) ---- */
    .action-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
    }
    .action-bar .close_btn {
        margin-left: auto;
    }

    /* ---- light toolbar (earlier answers only) ---- */
    .turn-tools {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        opacity: .55;
        transition: opacity .12s ease;
    }
    .turn-bot:hover .turn-tools,
    .turn-bot:focus-within .turn-tools {
        opacity: 1;
    }

    .error{
        background: var(--err-bg);
        color: var(--err-ink);
        border: 1px solid var(--err-border);
        border-radius: var(--r-md);
        padding: 8px 12px;
    }
    .info{
        background: var(--info-bg);
        color: var(--info-ink);
        border: 1px solid var(--info-border);
        border-radius: var(--r-md);
        padding: 8px 12px;
        font-size: .78125rem;
        line-height: 1.5;
    }
    .info_obj{
        font-weight: 600;
    }
    .sel_info{
        font-size: .71875rem;
        color: var(--ink-3);
        margin: 9px 0 0;
        display: none;
    }

    /* diff viewer */
    .added {
        background-color: var(--ok-bg);
        color: var(--ok-ink);
        display: inline;
    }
    .removed {
        background-color: var(--err-bg);
        color: var(--err-ink);
        display: inline;
        text-decoration: line-through;
    }

    /* Thinking block styles */
    details.thinking-block {
        border-left: 3px solid var(--border-strong);
        background: var(--surface-2);
        padding: 0.3em 0.6em;
        margin: 0 0 0.6em 0;
        font-size: 0.9em;
        color: var(--ink-2);
        border-radius: 4px;
    }
    details.thinking-block > summary {
        cursor: pointer;
        font-weight: 600;
    }
    details.thinking-block .thinking-content {
        white-space: pre-wrap;
        margin-top: 0.3em;
    }

    /* The token fade-in and the turn slide are decorative: with reduced motion
       the SHARED_BASE_CSS override collapses their duration, so make sure they
       still settle on the visible end state rather than at opacity 0. */
    @media (prefers-reduced-motion: reduce) {
        .token { opacity: 1; }
    }

    /* ---- narrow windows ---- */
    @media (max-width: 520px) {
        .turn-user .bubble {
            max-width: 88%;
        }
        .action-bar .close_btn {
            margin-left: 0;
            width: 100%;
            justify-content: center;
        }
        /* Secondary actions collapse to their icon; the label stays available
           to assistive tech through aria-label. */
        .action-bar .mzta-btn-secondary {
            min-width: 36px;
            justify-content: center;
        }
        .action-bar .mzta-btn-secondary .btn-label {
            display: none;
        }
    }
`;
messagesAreaTemplate.content.appendChild(messagesAreaStyle);

const messagesDiv = document.createElement('div');
messagesDiv.id = 'messages';
messagesAreaTemplate.content.appendChild(messagesDiv);

class MessagesArea extends HTMLElement {

    fullTextHTML = "";
    llmName = "LLM";

    constructor() {
        super();
        this.accumulatingMessageEl = null;
        // Owns the streaming/parsing state for the current bot response. A new
        // instance is created per response (see handleNewToken) and finalized in
        // handleTokensDone, so each turn's flushed HTML snapshot is isolated.
        this._streaming = null;
        this.hideThinking = false;
        // Wrapper of the turn currently being built. It must survive every
        // flush: a single response flushes on each '\n', so clearing it there
        // would start a fresh wrapper (and a second avatar) mid-answer. Only
        // appendUserMessage() and handleTokensDone() reset it.
        this._currentTurnEl = null;
        // Turn that currently owns the full action bar. When a newer answer
        // arrives its bar is removed, leaving only the light toolbar behind,
        // so a long conversation never accumulates identical bars.
        this._lastFullBarTurn = null;

        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messagesAreaTemplate.content.cloneNode(true));

        this.messages = shadowRoot.querySelector('#messages');
    }

    // Open a model turn: wrapper + avatar + model name, and return the column
    // the answer body goes into. `variant` is 'bot' or 'error'.
    _beginBotTurn(labelText, variant = 'bot') {
        const turn = document.createElement('div');
        turn.classList.add('turn', 'turn-bot');
        if (variant === 'error') {
            turn.classList.add('turn-error');
        }

        const head = document.createElement('div');
        head.classList.add('turn-head');
        head.appendChild(buildSparkleIcon());
        turn.appendChild(head);

        const body = document.createElement('div');
        body.classList.add('turn-body');
        const name = document.createElement('div');
        name.classList.add('turn-name');
        name.textContent = labelText;
        body.appendChild(name);
        turn.appendChild(body);

        this.messages.appendChild(turn);
        this._currentTurnEl = turn;
        return body;
    }

    // Open a user turn ('user' = accent bubble, 'info' = full-width notice).
    _beginUserTurn(type) {
        const turn = document.createElement('div');
        turn.classList.add('turn', type === 'info' ? 'turn-info' : 'turn-user');
        this.messages.appendChild(turn);
        return turn;
    }

    // The column of the current model turn, opening one if needed.
    _ensureBotTurnBody() {
        if (!this._currentTurnEl) {
            return this._beginBotTurn(this.llmName);
        }
        return this._currentTurnEl.querySelector('.turn-body');
    }

    createNewAccumulatingMessage() {
        const body = this._ensureBotTurnBody();
        this.accumulatingMessageEl = document.createElement('div');
        this.accumulatingMessageEl.classList.add('message', 'bot');
        body.appendChild(this.accumulatingMessageEl);
    }

    init(worker) {
        this.worker = worker;
    }

    setLLMName(llmName) {
        this.llmName = llmName;
    }

    setHideThinking(val) {
        this.hideThinking = !!val;
    }

    _ensureStreaming() {
        if (!this._streaming) {
            this._streaming = new StreamingMessage();
        }
        return this._streaming;
    }

    handleNewThinkingToken(token) {
        // Thinking tokens can arrive before the first content token (e.g. Anthropic
        // extended thinking), so ensure the streaming state exists.
        this._ensureStreaming().handleNewThinkingToken(token);
    }

    async handleTokensDone(promptData = null) {
        this.flushAccumulatingMessage();
        await this.addActionButtons(promptData);
        // Response finished: retire this turn's streaming state so the next
        // response starts a fresh instance with its own isolated HTML snapshot,
        // and close the turn wrapper.
        this._streaming = null;
        this._currentTurnEl = null;
    }

    appendUserMessage(messageText, type="user") {
        this.fullTextHTML = "";
        this._streaming = null;   // new turn: reset any streaming state
        // A user message ends the previous model turn, so the next token
        // opens a fresh one.
        this._currentTurnEl = null;
        // console.log("[ThunderAI] appendUserMessage: " + messageText);
        const turn = this._beginUserTurn(type);

        const messageElement = document.createElement('div');
        messageElement.classList.add(type === 'info' ? 'message' : 'bubble', type);
        // Replace \n with <br> for correct HTML display
        if (type === "info") {
            messageElement.appendChild(htmlStringToFragment(messageText));
        } else {
            messageElement.appendChild(textWithBrToFragment(messageText));
        }
        turn.appendChild(messageElement);
        this.scrollToBottom();
    }

    appendBotMessage(messageText, type="bot") {
        // console.log("[ThunderAI] appendBotMessage: " + messageText);

        this.fullTextHTML = messageText;

        const label = this.llmName + (type=='error' ? " - " + browser.i18n.getMessage("apiwebchat_error") : "");
        const body = this._beginBotTurn(label, type);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        messageElement.textContent = messageText;
        body.appendChild(messageElement);
        // This is a terminal message (typically an error), not a streaming
        // turn: close it so the next answer starts its own.
        this._currentTurnEl = null;
        this.scrollToBottom();
    }

    handleNewToken(token) {
        if (!this.accumulatingMessageEl) {
            this.createNewAccumulatingMessage();
        }

        // Feed the raw token to the streaming state (source of truth for parsing)
        // and also render the fading token span for live display.
        this._ensureStreaming().handleNewToken(token);

        const newTokenElement = document.createElement('span');
        newTokenElement.classList.add('token');
        newTokenElement.textContent = token;
        this.accumulatingMessageEl.appendChild(newTokenElement);

        this.scrollToBottom();

        if (token === '\n') {
            this.flushAccumulatingMessage();
        }
    }

    scrollToBottom() {
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    // click callcback for the "use this answer" button
    handleUseThisAnswerButtonClick(promptData, replyType, fullTextHTMLAtAssignment){
        return async () => {
            if(promptData.mailMessageId == -1) {    // we are using the reply from the compose window!
                promptData.action = "2"; // replace text
            }
            let finalText = removeAloneBRs(fullTextHTMLAtAssignment);
            const selectedHTML = this.getCurrentSelectionHTML();
            if(selectedHTML != "") {
                finalText = removeAloneBRs(selectedHTML);
            }

            switch(promptData.action) {
                case "1":     // do reply
                    // console.log("[ThunderAI] (do reply) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId, replyType: replyType});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
                case "2":     // replace text
                    //  console.log("[ThunderAI] (replace text) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
            }
        }
    }

    async addActionButtons(promptData = null) {
        // `promptData` is a module-level variable in controller.js, set once by the
        // `api_send` command. Its action/tabId/mailMessageId are intentionally stable
        // for the whole session (the webchat window is bound to that message/tab and
        // that action). What varies per turn is the answer text, which each turn's
        // buttons snapshot into `fullTextHTMLAtAssignment` below — so every turn's
        // buttons stay clickable and tied to their own response.
        if(promptData == null) { return; }
        const turn = this._currentTurnEl;
        if(turn == null) { return; }
        const turnBody = turn.querySelector('.turn-body');

        // Only the newest answer keeps the full bar: strip the previous one
        // first, so two full bars never coexist.
        this._degradeFullActionBar();

        const fullTextHTMLAtAssignment = this.fullTextHTML.trim().replace(/^"|"$/g, '').replace(/^<p>&quot;/, '<p>').replace(/&quot;<\/p>$/, '</p>'); // strip quotation marks
        //console.log(">>>>>>>>>>>> fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
        let reply_type_pref = await browser.storage.sync.get({ reply_type: prefs_default.reply_type });

        // Remember what the compact toolbar will need. It is only built when
        // this answer stops being the newest one (see _degradeFullActionBar):
        // showing both at once would repeat every action twice.
        turn._mztaToolsArgs = {
            promptData: promptData,
            replyType: reply_type_pref.reply_type,
            text: fullTextHTMLAtAssignment,
        };

        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-bar');
        // selection info
        const selectionInfo = document.createElement('p');
        selectionInfo.textContent = browser.i18n.getMessage("apiwebchat_selection_info");
        selectionInfo.classList.add('sel_info');

        // "use this answer" split button
        const splitButton = this._buildUseThisAnswerButton(promptData, reply_type_pref, fullTextHTMLAtAssignment);

        const closeButton = document.createElement('button');
        closeButton.textContent = browser.i18n.getMessage("chatgpt_win_close");
        closeButton.classList.add('close_btn', 'mzta-btn-tertiary');
        closeButton.addEventListener('click', async () => {
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});    // close window
        });
        if(promptData.action != "0") {
            actionButtons.appendChild(splitButton);
            selectionInfo.style.display = "block"; // show selection info
        }

        // copy button
        actionButtons.appendChild(this._buildCopyButton(fullTextHTMLAtAssignment));

        // Save as Summary button (only shown for summary webchat sessions)
        const saveSummaryButton = this._buildSaveSummaryButton(promptData, fullTextHTMLAtAssignment);
        if(saveSummaryButton) {
            actionButtons.appendChild(saveSummaryButton);
            selectionInfo.style.display = "block";
        }

        // diff viewer button
        const diffvButton = this._buildDiffButton(promptData, fullTextHTMLAtAssignment);
        if(diffvButton) {
            actionButtons.appendChild(diffvButton);
        }

        actionButtons.appendChild(closeButton);
        turnBody.appendChild(actionButtons);
        turnBody.appendChild(selectionInfo);
        this._lastFullBarTurn = turn;
        this.scrollToBottom();
    }

    // Swap the full action bar of the previously-newest answer for the compact
    // icon toolbar. The two are mutually exclusive: while an answer owns the
    // full bar it needs no toolbar, since every icon there would just duplicate
    // a button already spelled out next to it.
    _degradeFullActionBar() {
        const turn = this._lastFullBarTurn;
        if(!turn) { return; }
        const bar = turn.querySelector('.action-bar');
        const hint = turn.querySelector('.sel_info');
        // Built now rather than up front, but from the arguments captured when
        // the bar was created, so the toolbar stays bound to this turn's own
        // answer text and not to whatever is on screen later.
        const args = turn._mztaToolsArgs;
        if(bar && args) {
            bar.replaceWith(this._buildTurnTools(args.promptData, args.replyType, args.text));
        } else if(bar) {
            bar.remove();
        }
        if(hint) { hint.remove(); }
        delete turn._mztaToolsArgs;
        this._lastFullBarTurn = null;
    }

    // Icon-only toolbar shown on every earlier answer, faint until the turn is
    // hovered or focused. Shares the click handlers of the full bar.
    _buildTurnTools(promptData, replyType, fullTextHTMLAtAssignment) {
        const tools = document.createElement('div');
        tools.classList.add('turn-tools');
        tools.setAttribute('role', 'group');
        tools.setAttribute('aria-label', browser.i18n.getMessage("apiwebchat_turn_tools"));

        tools.appendChild(this._buildCopyButton(fullTextHTMLAtAssignment, true));

        if(promptData.action != "0") {
            const useBtn = this._makeIconButton(
                buildUseAnswerIcon(13),
                browser.i18n.getMessage("apiwebchat_use_this_answer"),
            );
            useBtn.addEventListener('click',
                this.handleUseThisAnswerButtonClick(promptData, replyType, fullTextHTMLAtAssignment));
            tools.appendChild(useBtn);
        }

        return tools;
    }

    // Shared shape for the 26x26 icon buttons of the light toolbar.
    _makeIconButton(icon, label) {
        const btn = document.createElement('button');
        btn.classList.add('mzta-btn-icon');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.appendChild(icon);
        return btn;
    }

    // "Copy": puts the answer on the clipboard WITHOUT closing the window, and
    // confirms with a check for 1.5s. Like the other action buttons it honours
    // a text selection and copies only that part. `iconOnly` builds the
    // light-toolbar form.
    _buildCopyButton(fullTextHTMLAtAssignment, iconOnly = false) {
        const label = browser.i18n.getMessage("apiwebchat_copy");
        let button;
        let labelEl = null;

        if(iconOnly) {
            button = this._makeIconButton(buildCopyIcon(13), label);
        } else {
            button = document.createElement('button');
            button.classList.add('copy_btn', 'mzta-btn-secondary');
            button.setAttribute('aria-label', label);
            button.appendChild(buildCopyIcon());
            labelEl = document.createElement('span');
            labelEl.classList.add('btn-label');
            labelEl.textContent = label;
            button.appendChild(labelEl);
        }

        let resetTimeout = null;
        button.addEventListener('click', async () => {
            const selectedText = this.getCurrentSelectionText();
            const plainText = selectedText !== ''
                ? selectedText
                : htmlToPlainText(fullTextHTMLAtAssignment);
            const ok = await copyTextToClipboard(plainText);
            const feedback = ok
                ? browser.i18n.getMessage("apiwebchat_copied")
                : browser.i18n.getMessage("apiwebchat_copy_failed");

            button.textContent = '';
            button.appendChild(ok ? buildCheckIcon(iconOnly ? 13 : 15) : buildCopyIcon(iconOnly ? 13 : 15));
            if(!iconOnly) {
                labelEl.textContent = feedback;
                button.appendChild(labelEl);
            }
            button.setAttribute('aria-label', feedback);
            button.title = feedback;

            if(resetTimeout) { clearTimeout(resetTimeout); }
            resetTimeout = setTimeout(() => {
                button.textContent = '';
                button.appendChild(buildCopyIcon(iconOnly ? 13 : 15));
                if(!iconOnly) {
                    labelEl.textContent = label;
                    button.appendChild(labelEl);
                }
                button.setAttribute('aria-label', label);
                button.title = label;
            }, 1500);
        });

        return button;
    }

    // Build the "use this answer" <split-button>. When replying to a real message
    // (action=="1" && mailMessageId!=-1) it gets a reply-type info line plus a single
    // dropdown option offering the opposite reply type; otherwise it is a standalone
    // button. The <split-button> element owns the outside-click listener lifecycle.
    _buildUseThisAnswerButton(promptData, reply_type_pref, fullTextHTMLAtAssignment) {
        const splitButton = document.createElement('split-button');
        const isReplyToMessage = (promptData.action == "1") && (promptData.mailMessageId != -1);

        splitButton.setMainButton({
            line1: browser.i18n.getMessage("apiwebchat_use_this_answer"),
            line2: isReplyToMessage
                ? (reply_type_pref.reply_type == 'reply_all' ? browser.i18n.getMessage("prefs_OptionText_reply_all") : browser.i18n.getMessage("prefs_OptionText_reply_sender"))
                : null,
            onClick: this.handleUseThisAnswerButtonClick(promptData, reply_type_pref.reply_type, fullTextHTMLAtAssignment),
            standalone: !isReplyToMessage,
        });

        if (isReplyToMessage) {
            splitButton.setDropdownOption({
                label: reply_type_pref.reply_type == 'reply_all' ? browser.i18n.getMessage("prefs_OptionText_reply_sender") : browser.i18n.getMessage("prefs_OptionText_reply_all"),
                onClick: this.handleUseThisAnswerButtonClick(promptData, reply_type_pref.reply_type == 'reply_all' ? 'reply_sender' : 'reply_all', fullTextHTMLAtAssignment),
            });
        }

        return splitButton;
    }

    // Build the "save as summary" button (only for summary webchat sessions). Returns
    // null when this session is not a summary session.
    _buildSaveSummaryButton(promptData, fullTextHTMLAtAssignment) {
        if(!(promptData.prompt_info?.headerMessageId && promptData.prompt_info?.summaryTabId)) {
            return null;
        }
        const saveSummaryButton = document.createElement('button');
        const saveLabel = browser.i18n.getMessage("webchat_save_as_summary");
        saveSummaryButton.classList.add('save_summary_btn', 'mzta-btn-secondary');
        saveSummaryButton.setAttribute('aria-label', saveLabel);
        saveSummaryButton.appendChild(buildSaveIcon());
        const saveLabelEl = document.createElement('span');
        saveLabelEl.classList.add('btn-label');
        saveLabelEl.textContent = saveLabel;
        saveSummaryButton.appendChild(saveLabelEl);
        saveSummaryButton.addEventListener('click', async () => {
            let finalText = removeAloneBRs(fullTextHTMLAtAssignment);
            const selectedHTML = this.getCurrentSelectionHTML();
            if(selectedHTML != "") {
                finalText = removeAloneBRs(selectedHTML);
            }
            await browser.runtime.sendMessage({
                command: "chatgpt_saveSummary",
                text: finalText,
                headerMessageId: promptData.prompt_info.headerMessageId,
                tabId: promptData.prompt_info.summaryTabId || promptData.tabId,
            });
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
        });
        return saveSummaryButton;
    }

    // Build the "show differences" button. Returns null when the prompt did not
    // request the diff viewer.
    _buildDiffButton(promptData, fullTextHTMLAtAssignment) {
        if(promptData.prompt_info?.use_diff_viewer != "1") {
            return null;
        }
        const diffvButton = document.createElement('button');
        const diffLabel = browser.i18n.getMessage("btn_show_differences");
        diffvButton.classList.add('diffv_btn', 'mzta-btn-secondary');
        diffvButton.setAttribute('aria-label', diffLabel);
        diffvButton.appendChild(buildDiffIcon());
        const diffLabelEl = document.createElement('span');
        diffLabelEl.classList.add('btn-label');
        diffLabelEl.textContent = diffLabel;
        diffvButton.appendChild(diffLabelEl);
        diffvButton.addEventListener('click', async () => {
            let strippedText = stripHtmlTags(fullTextHTMLAtAssignment);
            let originalText = promptData.prompt_info?.selection_text;
            if((originalText == null) || (originalText == "")) {
                originalText = promptData.prompt_info?.body_text;
            }
            this.appendDiffViewer(originalText, strippedText);
            diffvButton.disabled = true;
        });
        return diffvButton;
    }

    appendDiffViewer(originalText, newText) {
        // Triggered by a button that may belong to an older answer, part-way
        // through a session. _beginBotTurn moves _currentTurnEl, so save and
        // restore it: the diff must not hijack the turn being streamed, nor
        // touch which answer owns the full action bar.
        const previousTurnEl = this._currentTurnEl;

        const body = this._beginBotTurn(browser.i18n.getMessage("chatgpt_win_diff_title"));
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot');

        // Delegate the diff-node building; page-level layout stays here.
        renderDiff(messageElement, originalText, newText);
        body.appendChild(messageElement);

        this._currentTurnEl = previousTurnEl;
        this.scrollToBottom();
    }

    flushAccumulatingMessage() {
        if (this.accumulatingMessageEl) {
            // Delegate the token→HTML parsing pipeline to the streaming state.
            // A null result means the flush was deferred (unterminated <think>
            // mid-stream): leave the DOM tokens and accumulator untouched.
            const result = this._ensureStreaming().flush();
            if (result === null) {
                return;
            }

            const { html, thinkingText, fullTextHTML } = result;

            // Keep the immutable snapshot readers (addActionButtons /
            // save-as-summary / diff) working: mirror the response-wide snapshot.
            this.fullTextHTML = fullTextHTML;

            // console.log(">>>>>>>>>>>>>>>> flushAccumulatingMessage this.fullTextHTML: " + this.fullTextHTML);

            // Create a new DOM parser
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            convertTextNodeNewlinesToBr(doc.body);

            // Remove existing tokens
            while (this.accumulatingMessageEl.firstChild) {
                this.accumulatingMessageEl.removeChild(this.accumulatingMessageEl.firstChild);
            }

            // Prepend thinking block (if any). hide_thinking controls the initial
            // open/collapsed state: true -> collapsed, false -> open. Users can always
            // toggle with a click.
            renderThinkingBlock(this.accumulatingMessageEl, thinkingText, this.hideThinking);

            // Append new nodes
            Array.from(doc.body.childNodes).forEach(node => {
                this.accumulatingMessageEl.appendChild(node);
            });

            this.accumulatingMessageEl = null;
        }
    }

    getCurrentSelectionHTML() {
        const selection = window.getSelection();
        // console.log(">>>>>>>>>>>>>>>> getCurrentSelectionHTML: " + JSON.stringify(selection.toString()));
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = document.createElement('div');
            container.appendChild(range.cloneContents());
            return container.innerHTML;
        }
        return '';
    }

    // Selected text as plain text. Taken straight from the Selection rather
    // than by stripping getCurrentSelectionHTML(), so entities in the rendered
    // answer (&amp;, &lt;, &nbsp;, …) come out as the characters the user can
    // actually see instead of their HTML escapes.
    getCurrentSelectionText() {
        const selection = window.getSelection();
        return selection ? selection.toString() : '';
    }

}

customElements.define('messages-area', MessagesArea);


function stripHtmlTags(htmlString) {
    return htmlString.replace(/<\/?[^>]+(>|$)/g, "");
}

// HTML → the text the user actually sees. Unlike stripHtmlTags() this parses
// the markup, so entities are decoded (&amp; → &) instead of being copied as
// their escape sequences, and <br>/</p> become real line breaks.
function htmlToPlainText(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    doc.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
    // Block-level boundaries would otherwise run together into one long line.
    doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(el => {
        el.appendChild(document.createTextNode('\n'));
    });
    return (doc.body.textContent || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Clipboard write with a fallback for the (unlikely) case the async API is
// unavailable or rejects. moz-extension: pages are a secure context and these
// handlers always run inside a click, so the first path normally succeeds.
async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const helper = document.createElement('textarea');
            helper.value = text;
            helper.setAttribute('readonly', '');
            helper.style.position = 'fixed';
            helper.style.opacity = '0';
            document.body.appendChild(helper);
            helper.select();
            const ok = document.execCommand('copy');
            helper.remove();
            return ok;
        } catch (e2) {
            console.error("[ThunderAI] Unable to copy the answer to the clipboard:", e2);
            return false;
        }
    }
}

function textWithBrToFragment(text) {
    const fragment = document.createDocumentFragment();
    const segments = text.split(/<br\s*\/?>/gi);
    segments.forEach((segment, idx) => {
        if (segment.length > 0) {
            fragment.appendChild(document.createTextNode(segment));
        }
        if (idx < segments.length - 1) {
            fragment.appendChild(document.createElement('br'));
        }
    });
    return fragment;
}

function htmlStringToFragment(htmlString) {
//   console.log(">>>>>>>>>>>>>>>> htmlStringToFragment htmlString: " + htmlString);
  const normalizedHtml = htmlString.replace(/\n/g, '<br>');
//   console.log(">>>>>>>>>>>>>>>> htmlStringToFragment normalizedHtml: " + normalizedHtml);
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedHtml, 'text/html');
  const fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach(node => fragment.appendChild(node));
  return fragment;
}

function convertTextNodeNewlinesToBr(element) {
    element.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.includes('\n') && node.textContent.trim() !== '') {
                const fragment = document.createDocumentFragment();
                node.textContent.split('\n').forEach((part, idx, arr) => {
                    fragment.appendChild(document.createTextNode(part));
                    if (idx < arr.length - 1) {
                        fragment.appendChild(document.createElement('br'));
                    }
                });
                node.parentNode.replaceChild(fragment, node);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            convertTextNodeNewlinesToBr(node);
        }
    });
}

function removeAloneBRs(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  const brElements = Array.from(doc.querySelectorAll('br'));

  brElements.forEach(br => {
    let current = br;
    let isInsideP = false;

    while (current.parentElement) {
      if (current.parentElement.tagName.toLowerCase() === 'p') {
        isInsideP = true;
        break;
      }
      current = current.parentElement;
    }

    if (!isInsideP) {
      br.remove();
    }
  });

  return doc.body.innerHTML;
}
