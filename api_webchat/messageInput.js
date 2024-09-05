/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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
messagesInputStyle .textContent = `
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
        this._sendButton.title = browser.i18n.getMessage("chagtp_api_send_button") + ": " + this.model;
        this._stopButton.title = browser.i18n.getMessage("chagtp_api_send_button") + ": " + this.model;
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
        this._stopButton.title = browser.i18n.getMessage("chagtp_api_send_button") + ": " + this.model;
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
        this._stopButton.title = 'Stopping...';
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
        this.setStatusMessage(browser.i18n.getMessage('WaitingServerReponse') + '...');
        this.showStatusMessage();
        this.worker.postMessage({ type: 'chatMessage', message: messageContent });
    }

    _setMessageInputValue(msg) {
        this._messageInputField.value = msg;
    }
}

customElements.define('message-input', MessageInput);