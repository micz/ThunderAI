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

const messagesAreaTemplate = document.createElement('template');

const messagesAreaStyle = document.createElement('style');
messagesAreaStyle.textContent = `
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
    }
    #messages {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: 100%;
        margin-left: var(--margin);
        margin-right: var(--margin);
    }
    .message {
        margin-bottom: var(--margin);
        line-height: 1.3;
    }
    .token {
        display: inline;
        opacity: 0;
        animation: fadeIn 1000ms forwards;
    }
    .action-buttons {
        line-height: 1.3;
    }
    @keyframes fadeIn {
        to {
            opacity: 1;
        }
    }
    h2 {
        font-weight: bold;
        font-size: 1rem;
        margin-top: 20px;
    }
`;
messagesAreaTemplate.content.appendChild(messagesAreaStyle);

const messagesDiv = document.createElement('div');
messagesDiv.id = 'messages';
messagesAreaTemplate.content.appendChild(messagesDiv);

class MessagesArea extends HTMLElement {

    fullTextHTML = "";

    constructor() {
        super();
        this.accumulatingMessageEl = null;

        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messagesAreaTemplate.content.cloneNode(true));

        this.messages = shadowRoot.querySelector('#messages');
    }

    createNewAccumulatingMessage() {
        const lastMessage = this.messages.lastElementChild;
        const isLastMessageFromUser = lastMessage && lastMessage.classList.contains('user');

        if (isLastMessageFromUser) {
            const header = document.createElement('h2');
            header.textContent = "Bot";
            this.messages.appendChild(header);
        }

        this.accumulatingMessageEl = document.createElement('div');
        this.accumulatingMessageEl.classList.add('message', 'bot');
        this.messages.appendChild(this.accumulatingMessageEl);
    }

    init(worker) {
        this.worker = worker;
    }

    handleTokensDone() {
        this.flushAccumulatingMessage();
        this.addActionButtons();
    }

    appendUserMessage(messageText, source="You") {
        this.fullTextHTML = "";
        console.log("appendUserMessage: " + messageText);
        const header = document.createElement('h2');
        header.textContent = source;
        this.messages.appendChild(header);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'user');
        messageElement.textContent = messageText;
        this.messages.appendChild(messageElement);
        this.scrollToBottom();
    }

    handleNewToken(token) {
        if (!this.accumulatingMessageEl) {
            this.createNewAccumulatingMessage();
        }

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

    addActionButtons() {
        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-buttons');
        const actionButton = document.createElement('button');
        actionButton.textContent = 'Send';
        actionButton.addEventListener('click', () => {
            alert(this.fullTextHTML);
        });
        actionButtons.appendChild(actionButton);
        this.messages.appendChild(actionButtons);
        this.scrollToBottom();
    }

    flushAccumulatingMessage() {
        if (this.accumulatingMessageEl) {
            // Collect all tokens in a full text
            let fullText = '';
            this.accumulatingMessageEl.querySelectorAll('.token').forEach(tokenEl => {
                fullText += tokenEl.textContent;
            });
    
            // Convert Markdown to DOM nodes using the markdown-it library
            const md = window.markdownit();
            const html = md.render(fullText);

            this.fullTextHTML += html;
    
            // Create a new DOM parser
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
    
            // Remove existing tokens
            while (this.accumulatingMessageEl.firstChild) {
                this.accumulatingMessageEl.removeChild(this.accumulatingMessageEl.firstChild);
            }
    
            // Append new nodes
            Array.from(doc.body.childNodes).forEach(node => {
                this.accumulatingMessageEl.appendChild(node);
            });
  
            this.accumulatingMessageEl = null;
        }
    }


    appendBotMessage(messageText) {
        console.log("appendBotMessage: " + messageText);

        this.fullTextHTML = messageText;

        const lastMessage = this.messages.lastElementChild;
        const isLastMessageFromUser = lastMessage && lastMessage.classList.contains('user');

        if (isLastMessageFromUser) {
            const header = document.createElement('h2');
            header.textContent = "Bot";
            this.messages.appendChild(header);
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot');
        messageElement.textContent = messageText;
        this.messages.appendChild(messageElement);
        this.scrollToBottom();
    }

}

customElements.define('messages-area', MessagesArea);