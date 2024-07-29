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
        margin: 0;
        line-height: 1.3;
        padding: 5px;
        border-radius: 10px;

    }
    .message p{
        margin: 0;
        padding: 0;
    }
    .token {
        display: inline;
        opacity: 0;
        animation: fadeIn 1000ms forwards;
    }
    .action-buttons {
        line-height: 1.3;
        text-align: center;
    }
    .action-buttons button {
        display: inline;
        margin: 0 10px;
        padding: 5px 10px;
        border-radius: 5px;
        cursor: pointer;
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
    hr {
        width: 100%;
    }
    .error{
        background: lightcoral;
        color: white;
        margin-bottom: var(--margin);
    }
    .info{
        background: lightblue;
        color: navy;
        margin-bottom: var(--margin);
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
            header.textContent = "ChatGTP";
            this.messages.appendChild(header);
        }

        this.accumulatingMessageEl = document.createElement('div');
        this.accumulatingMessageEl.classList.add('message', 'bot');
        this.messages.appendChild(this.accumulatingMessageEl);
    }

    init(worker) {
        this.worker = worker;
    }

    handleTokensDone(promptData = null) {
        this.flushAccumulatingMessage();
        this.addActionButtons(promptData);
        this.addDivider();
    }

    appendUserMessage(messageText, type="user") {
        this.fullTextHTML = "";
        console.log("[ThunderAI] appendUserMessage: " + messageText);
        const header = document.createElement('h2');
        let source = "You";
        switch (type) {
            case "user":
                source = "You";
                break;
            case "info":
                source = "Information";
                break;
        }
        header.textContent = source;
        this.messages.appendChild(header);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        messageElement.textContent = messageText;
        this.messages.appendChild(messageElement);
        this.scrollToBottom();
    }

    appendBotMessage(messageText, type="bot") {
        console.log("[ThunderAI] appendBotMessage: " + messageText);

        this.fullTextHTML = messageText;

        const lastMessage = this.messages.lastElementChild;
        const isLastMessageFromUser = lastMessage && lastMessage.classList.contains('user');

        if (isLastMessageFromUser) {
            const header = document.createElement('h2');
            header.textContent = "Chat GPT" + (type=='error' ? " - Error" : "");
            this.messages.appendChild(header);
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
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

    addActionButtons(promptData = null) {
        // ============================== TESTING
        // promptData = {
        //     action: "1",
        //     tabId: 1,
        //     mailMessageId: 1
        // }
        // let browser = {
        //     i18n: {
        //         getMessage: async function(key) {
        //             return key;
        //         }
        //     },
        //     storage: {
        //         sync: {
        //             get: async function(key) {
        //                 return 'apitest';
        //             }
        //         }
        //     }
        // }
        // ============================== TESTING - END
        if(promptData == null) { return; }
        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-buttons');
        const actionButton = document.createElement('button');
        actionButton.textContent = 'Use this answer';
        //actionButton.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
        const fullTextHTMLAtAssignment = this.fullTextHTML;
        actionButton.addEventListener('click', () => {
            switch(promptData.action) {
                case "1":     // do reply
                    browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: fullTextHTMLAtAssignment, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    browser.runtime.sendMessage({command: "chatgpt_close"});
                    break;
                case "2":     // replace text
                    browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: fullTextHTMLAtAssignment, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    //console.log(response);
                    browser.runtime.sendMessage({command: "chatgpt_close"});
                    break;
            }
        });
        const closeButton = document.createElement('button');
        closeButton.textContent = browser.i18n.getMessage("chatgpt_win_close");
        closeButton.addEventListener('click', () => {
            browser.runtime.sendMessage({command: "chatgpt_close"});    // close window
        });
        if(promptData.action != 0) { actionButtons.appendChild(actionButton); }
        actionButtons.appendChild(closeButton);
        this.messages.appendChild(actionButtons);
        this.scrollToBottom();
    }

    addDivider() {
        const divider = document.createElement('hr');
        this.messages.appendChild(divider);
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

}

customElements.define('messages-area', MessagesArea);