/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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
        min-height: 100%;
        margin-left: var(--margin);
        margin-right: var(--margin);
        overflow-x: hidden;
        overflow-y: scroll;
        max-height: 100%;
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
    .sel_info{
        font-size: 0.7rem;
        color: gray;
        margin-top: 5px;
        display: none;
    }
    /* diff viewer */
    .added {
        background-color: #d4fcdc;
        display: inline;
    }
    .removed {
        background-color: #fddddd;
        display: inline;
        text-decoration: line-through;
    }
    @media (prefers-color-scheme: dark) {
        .added {
            background-color:rgb(0, 94, 0);
        }
        .removed {
            background-color:rgb(90, 0, 0);
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

        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messagesAreaTemplate.content.cloneNode(true));

        this.messages = shadowRoot.querySelector('#messages');
    }

    createNewAccumulatingMessage() {
        const lastMessage = this.messages.lastElementChild;
        const isLastMessageFromUser = lastMessage && lastMessage.classList.contains('user');

        if (isLastMessageFromUser) {
            const header = document.createElement('h2');
            header.textContent = this.llmName;
            this.messages.appendChild(header);
        }

        this.accumulatingMessageEl = document.createElement('div');
        this.accumulatingMessageEl.classList.add('message', 'bot');
        this.messages.appendChild(this.accumulatingMessageEl);
    }

    init(worker) {
        this.worker = worker;
    }

    setLLMName(llmName) {
        this.llmName = llmName;
    }

    handleTokensDone(promptData = null) {
        this.flushAccumulatingMessage();
        this.addActionButtons(promptData);
        this.addDivider();
    }

    appendUserMessage(messageText, type="user") {
        this.fullTextHTML = "";
        // console.log("[ThunderAI] appendUserMessage: " + messageText);
        const header = document.createElement('h2');
        let source = browser.i18n.getMessage("apiwebchat_you");
        switch (type) {
            case "user":
                source = browser.i18n.getMessage("apiwebchat_you");
                break;
            case "info":
                source = browser.i18n.getMessage("apiwebchat_info");
                break;
        }
        header.textContent = source;
        this.messages.appendChild(header);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        // Replace \n with <br> for correct HTML display
        messageElement.textContent = messageText;
        // Replace \n with <br> elements for correct HTML display
        messageElement.innerHTML = '';
        messageText.split('\n').forEach((line, idx, arr) => {
            messageElement.appendChild(document.createTextNode(line));
            if (idx < arr.length - 1) {
            messageElement.appendChild(document.createElement('br'));
            }
        });
        this.messages.appendChild(messageElement);
        this.scrollToBottom();
    }

    appendBotMessage(messageText, type="bot") {
        // console.log("[ThunderAI] appendBotMessage: " + messageText);

        this.fullTextHTML = messageText;

        const lastMessage = this.messages.lastElementChild;
        const isLastMessageFromUser = lastMessage && lastMessage.classList.contains('user');

        if (isLastMessageFromUser) {
            const header = document.createElement('h2');
            header.textContent = this.llmName + (type=='error' ? " - " + browser.i18n.getMessage("apiwebchat_error") : "");
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
        if(promptData == null) { return; }
        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-buttons');
        const selectionInfo = document.createElement('p');
        selectionInfo.textContent = browser.i18n.getMessage("apiwebchat_selection_info");
        selectionInfo.classList.add('sel_info');
        const actionButton = document.createElement('button');
        actionButton.textContent = browser.i18n.getMessage("apiwebchat_use_this_answer");
        const fullTextHTMLAtAssignment = this.fullTextHTML.trim().replace(/^"|"$/g, '').replace(/^<p>&quot;/, '<p>').replace(/&quot;<\/p>$/, '</p>'); // strip quotation marks
        //console.log(">>>>>>>>>>>> fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
        actionButton.addEventListener('click', async () => {
            if(promptData.mailMessageId == -1) {    // we are using the reply from the compose window!
                promptData.action = "2"; // replace text
            }
            let finalText = fullTextHTMLAtAssignment;
            const selectedHTML = this.getCurrentSelectionHTML();
            if(selectedHTML != "") {
                finalText = selectedHTML;
            }

            switch(promptData.action) {
                case "1":     // do reply
                    // console.log("[ThunderAI] (do reply) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
                case "2":     // replace text
                    //  console.log("[ThunderAI] (replace text) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
            }
        });
        const closeButton = document.createElement('button');
        closeButton.textContent = browser.i18n.getMessage("chatgpt_win_close");
        closeButton.addEventListener('click', async () => {
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});    // close window
        });
        if(promptData.action != 0) { 
            actionButtons.appendChild(actionButton);
            selectionInfo.style.display = "block"; // show selection info
        }

        // diff viewer button
        if(promptData.prompt_info?.use_diff_viewer == "1") {
            const diffvButton = document.createElement('button');
            diffvButton.textContent = browser.i18n.getMessage("btn_show_differences");
            diffvButton.addEventListener('click', async () => {
                let strippedText = fullTextHTMLAtAssignment.replace(/<\/?[^>]+(>|$)/g, "");
                let originalText = promptData.prompt_info?.selection_text;
                if((originalText == null) || (originalText == "")) {
                    originalText = promptData.prompt_info?.body_text;
                }
                this.appendDiffViewer(originalText, strippedText);
                diffvButton.disabled = true;
            });
            actionButtons.appendChild(diffvButton);
        }

        actionButtons.appendChild(closeButton);
        actionButtons.appendChild(selectionInfo);
        this.messages.appendChild(actionButtons);
        this.scrollToBottom();
    }

    addDivider() {
        const divider = document.createElement('hr');
        this.messages.appendChild(divider);
        this.scrollToBottom();
    }

    appendDiffViewer(originalText, newText) {
        const wordDiff = Diff.diffWords(originalText, newText);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot');

        // Iterate over each part of the diff to create the HTML output
        wordDiff.forEach(part => {
            const diffElement = document.createElement("span");
        
            // Apply a different class depending on whether the word is added, removed, or unchanged
            if (part.added) {
              diffElement.className = "added";
              diffElement.textContent = part.value;
            } else if (part.removed) {
              diffElement.className = "removed";
              diffElement.textContent = part.value;
            } else {
              diffElement.textContent = part.value;
            }
        
            // Add the element to the container
            messageElement.appendChild(diffElement);
          });

        const header = document.createElement('h2');
        header.textContent = browser.i18n.getMessage("chatgpt_win_diff_title");
        this.messages.appendChild(header);
        
        this.messages.appendChild(messageElement);
        this.addDivider();
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

}

customElements.define('messages-area', MessagesArea);