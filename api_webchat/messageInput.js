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

const messageInputTemplate = document.createElement('template');

const messagesInputStyle  = document.createElement('style');
messagesInputStyle.textContent = `
    :host {
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: 24px;
        margin: var(--margin);
        margin-bottom: 20px;
    }
    #messageInputField {
        flex-grow: 1;
        padding: 10px;
        font-size: 1rem;
        border: 1px solid lightgrey;
        border-radius: 10px;
        margin-right: var(--padding);
        outline: none;
    }
    #messageInputField:focus {
        border-color: darkgrey;
    }
    #sendButton {
        width: 44px;
        height: 36px;
        cursor: pointer;
        border-radius: 10px;
        border: 1px outset buttonface;
    }
    #stopButton {
        width: 44px;
        height: 36px;
        cursor: pointer;
        border-radius: 10px;
    }
    #statusLogger{
        font-size: 0.8rem;
        position: absolute;
        bottom: 1.5em;
        right: 5em;
        border: 1px solid lightgrey;
        border-radius: 5px;
        padding: 5px;
        background: #F2F2F2;
    }
    #mzta-custom_text{
        padding:10px;
        width:auto;
        max-width:80%;
        height:auto;
        max-height:80%;
        border-radius:5px;
        overflow:auto;
        position:fixed;
        top:50%;
        left:50%;
        display:none;
        transform:translate(-50%,-50%);
        text-align:center;
        background:#333;
        color:white;
        border:3px solid white;
    }
    #mzta-custom_loading{
        height:50px;display:none;
    }
    #mzta-custom_textarea{
        color:black;
        padding:1px;
        font-size:15px;
        width:100%;
    }
    #mzta-custom_info{
        text-align:center;
        width:100%;
        padding-bottom:10px;
        font-size:15px;
    }
    @media (prefers-color-scheme: dark) {
        #messageInputField {
            background-color: #303030;
            color: #ffffff;
        }
        #statusLogger{
            background: #212121;
            color: #ffffff;
        }
    }
`;
messageInputTemplate.content.appendChild(messagesInputStyle);

const inputField = document.createElement('input');
inputField.type = 'text';
inputField.id = 'messageInputField';
inputField.placeholder = '';
inputField.autocomplete = 'off';
messageInputTemplate.content.appendChild(inputField);

const sendButton = document.createElement('button');
sendButton.id = 'sendButton';

const sendIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
sendIcon.setAttribute('width', '24');
sendIcon.setAttribute('height', '24');
sendIcon.setAttribute('viewBox', '0 0 24 24');
sendIcon.setAttribute('fill', 'none');
sendIcon.classList.add('text-white', 'dark:text-black');

const sendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
sendPath.setAttribute('d', 'M7 11L12 6L17 11M12 18V7');
sendPath.setAttribute('stroke', 'currentColor');
sendPath.setAttribute('stroke-width', '2');
sendPath.setAttribute('stroke-linecap', 'round');
sendPath.setAttribute('stroke-linejoin', 'round');

sendIcon.appendChild(sendPath);
sendButton.appendChild(sendIcon);
messageInputTemplate.content.appendChild(sendButton);

const stopButton = document.createElement('button');
stopButton.id = 'stopButton';
stopButton.style.display = 'none';

const stopIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
stopIcon.setAttribute('width', '24');
stopIcon.setAttribute('height', '24');
stopIcon.setAttribute('viewBox', '0 0 24 24');
stopIcon.setAttribute('fill', 'none');
stopIcon.classList.add('text-white', 'dark:text-black');

const stopRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
stopRect.setAttribute('x', '6');
stopRect.setAttribute('y', '6');
stopRect.setAttribute('width', '12');
stopRect.setAttribute('height', '12');
stopRect.setAttribute('fill', 'currentColor');

stopIcon.appendChild(stopRect);
stopButton.appendChild(stopIcon);
messageInputTemplate.content.appendChild(stopButton);

const statusLogger = document.createElement('div');
statusLogger.id = 'statusLogger';
statusLogger.textContent = '';
statusLogger.style.display = 'none';
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
messageInputTemplate.content.appendChild(customDiv);

class MessageInput extends HTMLElement {

    model = '';

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messageInputTemplate.content.cloneNode(true));

        this._messageInputField = shadowRoot.querySelector('#messageInputField');
        this._sendButton = shadowRoot.querySelector('#sendButton');
        this._stopButton = shadowRoot.querySelector('#stopButton');
        this._statusLogger = shadowRoot.querySelector('#statusLogger');

        this._messageInputField.addEventListener('keydown', this._handleKeyDown.bind(this));
        this._sendButton.addEventListener('click', this._handleClick.bind(this));
        this._stopButton.addEventListener('click', this._handleStopClick.bind(this));

        this._customText = shadowRoot.querySelector('#mzta-custom_text');
        this._customTextArea = shadowRoot.querySelector('#mzta-custom_textarea');
        this._customLoading = shadowRoot.querySelector('#mzta-custom_loading');
        this._customBtn = shadowRoot.querySelector('#mzta-custom_btn');
        this._customBtn.addEventListener("click", () => { this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText}) });
        this._customTextArea.addEventListener("keydown", (event) => { if(event.code == "Enter" && event.ctrlKey) this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText}) });
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
    }

    enableInput() {
        // console.log("[ThunderAI] enableInput");
        this._messageInputField.value = '';
        this._messageInputField.removeAttribute('disabled');
        this._sendButton.removeAttribute('disabled');
        this._sendButton.style.display = 'block';
        this._stopButton.setAttribute('disabled', 'disabled');
        this._stopButton.style.display = 'none';
        this._stopButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
        this.hideStatusMessage();
        this.setStatusMessage('');
    }

    setStatusMessage(message) {
        this._statusLogger.textContent = message;
    }

    showStatusMessage() {
        this._statusLogger.style.display = 'block';
    }

    hideStatusMessage() {
        this._statusLogger.style.display = 'none';
    }

    _handleKeyDown(event) {
        if (event.key === 'Enter') {
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
        if (this.messagesAreaComponent) {
            this.messagesAreaComponent.appendUserMessage(messageContent);
        }
        this.setStatusMessage(browser.i18n.getMessage('WaitingServerResponse') + '...');
        this.showStatusMessage();
        this.worker.postMessage({ type: 'chatMessage', message: messageContent });
    }

    _setMessageInputValue(msg) {
        this._messageInputField.value = msg;
    }

    _showCustomTextField(){
        this._customText.style.display = 'block';
        this._customTextArea.focus();
    }

    async _customTextBtnClick(args) {
        const customText = this._customTextArea.value;
        // console.log(">>>>>>>>>>>>>>>> customText: " + customText);
        args.customBtn.disabled = true;
        args.customBtn.classList.add('disabled');
        args.customLoading.style.display = 'inline-block';
        args.customLoading.style.display = 'none';
        let tab = await browser.tabs.query({ active: true, currentWindow: true });
        browser.runtime.sendMessage({ command: "api_send_custom_text", custom_text: customText, tabId: tab[0].id });
        args.customDiv.style.display = 'none';
    }
}

customElements.define('message-input', MessageInput);