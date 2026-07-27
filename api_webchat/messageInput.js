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

import { buildSendIcon, buildStopIcon, buildSpinnerIcon, buildCheckIcon, buildAlertIcon, buildDotIcon } from './svgIcons.js';
import { SHARED_BASE_CSS } from './sharedStyles.js';

const messageInputTemplate = document.createElement('template');

const messagesInputStyle  = document.createElement('style');
messagesInputStyle.textContent = SHARED_BASE_CSS + `
    :host {
        display: flex;
        justify-content: space-between;
        /* flex-end, not center: the textarea grows upwards, so the send/stop
           buttons must stay pinned to the bottom line rather than drifting to
           the middle of a three-line field. */
        align-items: flex-end;
        gap: 10px;
        padding: 12px 16px 16px;
        border-top: 1px solid var(--border);
    }
    /* Heights are derived from line-height + vertical padding + borders:
       one line = 1.125rem + 2*11px + 2*1px = 42px, matching #sendButton.
       Three lines is the maximum, hence max-height = 42px + 2*1.125rem = 78px;
       beyond that the field scrolls. Recompute both if any of those change. */
    #messageInputField {
        flex-grow: 1;
        box-sizing: border-box;
        padding: 11px 14px;
        font: inherit;
        font-size: .875rem;
        line-height: 1.125rem;
        min-height: 42px;
        max-height: 78px;
        overflow-y: auto;
        resize: none;
        white-space: pre-wrap;
        border: 1px solid var(--border);
        border-radius: var(--r-lg);
        background: var(--surface);
        color: var(--ink);
        outline: none;
        transition: border-color .12s ease, box-shadow .12s ease;
    }
    #messageInputField::placeholder {
        color: var(--ink-3);
    }
    #messageInputField:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
    }
    #sendButton, #stopButton {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        cursor: pointer;
        border: none;
        border-radius: var(--r-lg);
        background: var(--accent);
        color: #fff;
        transition: background .12s ease;
    }
    #sendButton:hover:not(:disabled), #stopButton:hover:not(:disabled) {
        background: var(--accent-dark);
    }
    #sendButton:disabled, #stopButton:disabled {
        opacity: .45;
        cursor: default;
    }

    /* Floating status pill: straddles the input field's top border instead of
       taking a row of its own. Anchored to the host, which is position:relative,
       so the containing block is the host's padding box. Anchored from the
       bottom rather than the top because the textarea grows upwards: its top
       border stays at padding-bottom + one-line height above the host's bottom
       edge only while the field is one line tall, so we pin the pill to that
       baseline and let the translateY centre it on the border line whatever the
       pill's height. Keep in sync with :host padding-bottom and the field's
       min-height. */
    #statusLogger{
        position: absolute;
        bottom: calc(16px + 42px - 1px);
        transform: translateY(50%);
        right: 80px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: .75rem;
        font-weight: 600;
        padding: 5px 11px;
        border-radius: var(--r-pill);
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--ink-2);
        box-shadow: 0 6px 16px -8px var(--shadow);
        white-space: nowrap;
    }
    #statusLoggerIcon{
        display: inline-flex;
        align-items: center;
    }
    #statusLogger.status-working{
        border-color: var(--info-border);
        background: var(--info-bg);
        color: var(--info-ink);
    }
    #statusLogger.status-working #statusLoggerIcon svg{
        animation: mztaSpin .8s linear infinite;
    }
    #statusLogger.status-done{
        border-color: color-mix(in srgb, var(--ok-ink) 40%, var(--bg));
        background: var(--ok-bg);
        color: var(--ok-ink);
    }
    #statusLogger.status-error{
        border-color: var(--err-border);
        background: var(--err-bg);
        color: var(--err-ink);
    }
    @keyframes statusFadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    #statusLogger.status-fadeout{
        animation: statusFadeOut 0.5s ease-out forwards;
    }
    #mzta-custom_text{
        padding:10px;
        width:50%;
        min-width:300px;
        max-width:80%;
        height:auto;
        max-height:80%;
        border-radius:5px;
        overflow-y:auto;
        overflow-x:hidden;
        position:fixed;
        top:50%;
        left:50%;
        display:none;
        transform:translate(-50%,-50%);
        text-align:center;
        background:var(--surface);
        color:var(--ink);
        border:1px solid var(--border);
        box-shadow: 0 18px 44px -20px var(--shadow);
        box-sizing: border-box;
        z-index: 10;
    }
    #mzta-custom_loading{
        height:50px;display:none;
    }
    #mzta-custom_textarea{
        color:var(--ink);
        background:var(--surface-2);
        border:1px solid var(--border);
        border-radius:var(--r-sm);
        padding:5px;
        font:inherit;
        font-size:0.9375rem;
        width:100%;
        box-sizing: border-box;
        resize: vertical;
    }
    #mzta-custom_textarea:focus{
        outline:none;
        border-color:var(--accent);
        box-shadow:0 0 0 3px var(--accent-soft);
    }
    #mzta-custom_info{
        text-align:center;
        width:100%;
        padding-bottom:10px;
        font-size:0.9375rem;
    }
    #mzta-custom_info span{
        font-size:0.8em;
    }
    #mzta-custom_step{
        position: absolute;
        bottom: 5px;
        right: 10px;
        font-size: 0.75rem;
        color: var(--ink-3);
    }
    #mzta-custom_btn{
        margin-top:7px;
        padding: 8px 14px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: var(--r-md);
        font: inherit;
        font-size: .8125rem;
        font-weight: 650;
        cursor: pointer;
        transition: background .12s ease;
    }
    #mzta-custom_btn:hover:not(:disabled){
        background: var(--accent-dark);
    }
    #mzta-custom_btn:disabled, #mzta-custom_btn.disabled{
        opacity: .45;
        cursor: default;
    }
`;
messageInputTemplate.content.appendChild(messagesInputStyle);

// A textarea, not an input: the field grows from one to three lines as the text
// wraps (see the #messageInputField rule and _autoResize below), then scrolls.
const inputField = document.createElement('textarea');
inputField.id = 'messageInputField';
inputField.rows = 1;
inputField.placeholder = '';
inputField.autocomplete = 'off';
messageInputTemplate.content.appendChild(inputField);

const sendButton = document.createElement('button');
sendButton.id = 'sendButton';
sendButton.appendChild(buildSendIcon());
messageInputTemplate.content.appendChild(sendButton);

const stopButton = document.createElement('button');
stopButton.id = 'stopButton';
stopButton.style.display = 'none';
stopButton.appendChild(buildStopIcon());
messageInputTemplate.content.appendChild(stopButton);

const statusLogger = document.createElement('div');
statusLogger.id = 'statusLogger';
statusLogger.style.display = 'none';
statusLogger.setAttribute('role', 'status');
statusLogger.setAttribute('aria-live', 'polite');
// The icon is rebuilt per state (dot / spinner / check / alert) rather than
// being a static <img>, so it inherits currentColor from the pill and the
// spin animation can be disabled by prefers-reduced-motion.
const statusLoggerIcon = document.createElement('span');
statusLoggerIcon.id = 'statusLoggerIcon';
statusLogger.appendChild(statusLoggerIcon);
const statusLoggerText = document.createElement('span');
statusLoggerText.id = 'statusLoggerText';
statusLogger.appendChild(statusLoggerText);
messageInputTemplate.content.appendChild(statusLogger);

//div per custom text
const customDiv = document.createElement('div');
customDiv.id = 'mzta-custom_text';
const customInfo = document.createElement('div');
customInfo.id = 'mzta-custom_info';
customInfo.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
customDiv.appendChild(customInfo);
const customTextArea = document.createElement('textarea');
customTextArea.id = 'mzta-custom_textarea';
customTextArea.rows = 5;
customDiv.appendChild(customTextArea);
const customLoading = document.createElement('img');
customLoading.src = browser.runtime.getURL("/images/loading.gif");
customLoading.id = "mzta-custom_loading";
customDiv.appendChild(customLoading);
const customBtn = document.createElement('button');
customBtn.id = 'mzta-custom_btn';
customBtn.textContent = browser.i18n.getMessage("chatgpt_win_send");
customBtn.classList.add('mzta-btn');
customDiv.appendChild(customBtn);
const customStep = document.createElement('div');
customStep.id = 'mzta-custom_step';
customDiv.appendChild(customStep);
messageInputTemplate.content.appendChild(customDiv);

class MessageInput extends HTMLElement {

    model = '';
    _doneTimeout = null;
    _customTextArray = [];
    _currentCustomTextIndex = 0;

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messageInputTemplate.content.cloneNode(true));

        this._messageInputField = shadowRoot.querySelector('#messageInputField');
        this._sendButton = shadowRoot.querySelector('#sendButton');
        this._stopButton = shadowRoot.querySelector('#stopButton');
        this._statusLogger = shadowRoot.querySelector('#statusLogger');
        this._statusLoggerIcon = shadowRoot.querySelector('#statusLoggerIcon');
        this._statusLoggerText = shadowRoot.querySelector('#statusLoggerText');

        this._messageInputField.addEventListener('keydown', this._handleKeyDown.bind(this));
        this._messageInputField.addEventListener('input', this._autoResize.bind(this));
        this._sendButton.addEventListener('click', this._handleClick.bind(this));
        this._stopButton.addEventListener('click', this._handleStopClick.bind(this));

        this._customText = shadowRoot.querySelector('#mzta-custom_text');
        this._customTextArea = shadowRoot.querySelector('#mzta-custom_textarea');
        this._customLoading = shadowRoot.querySelector('#mzta-custom_loading');
        this._customBtn = shadowRoot.querySelector('#mzta-custom_btn');
        this._customStep = shadowRoot.querySelector('#mzta-custom_step');
        this._customBtn.addEventListener("click", () => { this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText}) });
        this._customTextArea.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText});
            }
        });
    }

    connectedCallback() {
        // Set focus to the input field when the element is added to the DOM
        this._messageInputField.focus();
    }

    async init(worker) {
        this.worker = worker;
    }

    setMessagesArea(messagesAreaComponent) {
        this.messagesAreaComponent = messagesAreaComponent;
    }

    setModel(model){
        this.model = model;
        this._sendButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
        this._stopButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
    }

    handleMessageSent() {
        // console.log("[ThunderAI] handleMessageSent");
        this._messageInputField.value = '';
        this._autoResize();
    }

    enableInput(showDone = true) {
        // console.log("[ThunderAI] enableInput");
        this._messageInputField.value = '';
        this._autoResize();
        this._messageInputField.removeAttribute('disabled');
        this._sendButton.removeAttribute('disabled');
        this._sendButton.style.display = 'block';
        this._stopButton.setAttribute('disabled', 'disabled');
        this._stopButton.style.display = 'none';
        this._stopButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
        if (showDone) {
            this.showDoneStatus();
        } else {
            this.hideStatusMessage();
            this.setStatusMessage('');
        }
    }

    setStatusMessage(message) {
        this._statusLoggerText.textContent = message;
    }

    showStatusMessage(state = 'working') {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
            this._doneTimeout = null;
        }
        this._setStatusClass('status-' + state);
        this._statusLogger.style.display = 'inline-flex';
    }

    hideStatusMessage() {
        this._statusLogger.style.display = 'none';
        this._setStatusIcon(null);
        this._setStatusClass(null);
    }

    _setStatusClass(className) {
        this._statusLogger.classList.remove('status-working', 'status-done', 'status-error', 'status-fadeout');
        if (className) {
            this._statusLogger.classList.add(className);
        }
    }

    // Swap the pill's leading icon. Passing null clears it.
    _setStatusIcon(buildIcon) {
        this._statusLoggerIcon.textContent = '';
        if (buildIcon) {
            this._statusLoggerIcon.appendChild(buildIcon());
        }
    }

    // Request sent, nothing back from the server yet.
    showWaitingStatus() {
        this.setStatusMessage(browser.i18n.getMessage('WaitingServerResponse') + '...');
        this._setStatusIcon(buildDotIcon);
        this.showStatusMessage('waiting');
    }

    // Tokens are arriving.
    showStreamingStatus() {
        this.setStatusMessage(browser.i18n.getMessage('apiwebchat_receiving_data') + '...');
        // Only rebuild the spinner when we are not already streaming: this runs
        // on every single token, and replacing the node each time would restart
        // the CSS animation and leave the spinner frozen at frame 0.
        if (!this._statusLogger.classList.contains('status-working')) {
            this._setStatusIcon(buildSpinnerIcon);
            this.showStatusMessage('working');
        }
    }

    showDoneStatus() {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
        }
        this.setStatusMessage(browser.i18n.getMessage('apiwebchat_done'));
        this._setStatusIcon(buildCheckIcon);
        this._setStatusClass('status-done');
        this._statusLogger.style.display = 'inline-flex';

        this._doneTimeout = setTimeout(() => {
            this._statusLogger.classList.add('status-fadeout');
            this._doneTimeout = setTimeout(() => {
                this.hideStatusMessage();
                this.setStatusMessage('');
            }, 500);
        }, 3500);
    }

    // Unlike "done", the error pill has no timeout: it stays until the next
    // request replaces it, so a failure is never silently swallowed.
    showErrorStatus(message = null) {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
            this._doneTimeout = null;
        }
        this.setStatusMessage(message || browser.i18n.getMessage('apiwebchat_status_error'));
        this._setStatusIcon(buildAlertIcon);
        this._setStatusClass('status-error');
        this._statusLogger.style.display = 'inline-flex';
    }

    // Grow the field to fit its content, letting the CSS max-height cap it at
    // three lines: clear the inline height first so shrinking works too, then
    // measure. Must run after every programmatic .value change, not just on
    // input, or the field stays tall after a long message is sent.
    _autoResize() {
        this._messageInputField.style.height = 'auto';
        this._messageInputField.style.height = this._messageInputField.scrollHeight + 'px';
    }

    _handleKeyDown(event) {
        // Plain Enter is the long-standing way to send and stays as it is; the
        // preventDefault stops the textarea inserting a newline on the way out.
        // Shift+Enter falls through and adds a line break instead.
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this._handleNewChatMessage();
        }
    }

    _handleClick() {
        this._handleNewChatMessage();
    }

    _handleStopClick() {
        this.worker.postMessage({ type: 'stop' });
        this._stopButton.setAttribute('disabled', 'disabled');
        this._stopButton.title = browser.i18n.getMessage("apiwebchat_stopping") +  '...';
    }

    _handleNewChatMessage() {
        //do nothing if input is empty
        if ((!this._messageInputField.value)||(this._messageInputField.value.trim().length === 0)) {
            return;
        }
        // prevent user from interacting while we're waiting
        this._sendButton.setAttribute('disabled', 'disabled');
        this._sendButton.style.display = 'none';
        this._stopButton.removeAttribute('disabled');
        this._stopButton.style.display = 'block';
        this._messageInputField.setAttribute('disabled', 'disabled');
        let messageContent = this._messageInputField.value;
        this._messageInputField.value = '';
        this._autoResize();
        if (this.messagesAreaComponent) {
            this.messagesAreaComponent.appendUserMessage(messageContent);
        }
        this.showWaitingStatus();
        this.worker.postMessage({ type: 'chatMessage', message: messageContent });
    }

    _setMessageInputValue(msg) {
        this._messageInputField.value = msg;
        this._autoResize();
    }

    _showCustomTextField(custom_text_array){
        this._customTextArray = custom_text_array || [];
        if (this._customTextArray.length === 0) {
             this._customTextArray.push({ placeholder: "{%additional_text%}", info: "" });
        }
        this._currentCustomTextIndex = 0;
        this._customText.style.display = 'block';
        this._renderCustomTextStep();
    }

    _renderCustomTextStep() {
        const currentItem = this._customTextArray[this._currentCustomTextIndex];
        const infoDiv = this.shadowRoot.querySelector('#mzta-custom_info');
        
        this._customTextArea.value = "";
        infoDiv.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
        
        if (currentItem.info && currentItem.info.trim() !== "") {
            infoDiv.appendChild(document.createElement("br"));
            const infoSpan = document.createElement("span");
            infoSpan.textContent = "[" + browser.i18n.getMessage("customPrompts_form_label_ID") + ": " + currentItem.info + "]";
            infoDiv.appendChild(infoSpan);
        }

        if(this._customTextArray.length > 1) {
            this._customStep.textContent = (this._currentCustomTextIndex + 1) + "/" + this._customTextArray.length;
            this._customStep.style.display = 'block';
        } else {
            this._customStep.style.display = 'none';
        }
        
        this._customTextArea.focus();
    }

    async _customTextBtnClick(args) {
        const customText = this._customTextArea.value;
        
        if (this._customTextArray[this._currentCustomTextIndex]) {
            this._customTextArray[this._currentCustomTextIndex].custom_text = customText;
        }

        this._currentCustomTextIndex++;

        if (this._currentCustomTextIndex < this._customTextArray.length) {
            this._renderCustomTextStep();
        } else {
            args.customBtn.disabled = true;
            args.customBtn.classList.add('disabled');
            args.customLoading.style.display = 'inline-block';
            
            let tab = await browser.tabs.query({ active: true, currentWindow: true });
            browser.runtime.sendMessage({ command: "api_send_custom_text", custom_text: this._customTextArray, tabId: tab[0].id });
            args.customDiv.style.display = 'none';
            
            args.customBtn.disabled = false;
            args.customBtn.classList.remove('disabled');
            args.customLoading.style.display = 'none';
        }
    }
}

customElements.define('message-input', MessageInput);