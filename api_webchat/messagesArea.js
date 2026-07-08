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
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .action-buttons button {
        display: inline;
        margin: 0 10px;
        padding: 5px 10px;
        cursor: pointer;
        border: 1px outset buttonface;
    }
    .action-buttons button.close_btn, .action-buttons button.diffv_btn {
        border-radius: 5px;
    }
    .action-buttons button.action_btn {
        margin-right: 0;
        border-top-left-radius: 5px;
        border-bottom-left-radius: 5px;
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
        font-size: 0.8em;
    }
    .info_obj{
        color:rgb(0, 71, 36);
    }
    .sel_info{
        font-size: 0.7rem;
        color: gray;
        margin-top: 5px;
        display: none;
        width: 100%;
        text-align: center;
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
    
    /* Thinking block styles */
    details.thinking-block {
        border-left: 3px solid #bbb;
        background: #f7f7f7;
        padding: 0.3em 0.6em;
        margin: 0 0 0.6em 0;
        font-size: 0.9em;
        color: #555;
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

    /* Dark mode styles */
    @media (prefers-color-scheme: dark) {
        .added {
            background-color:rgb(0, 94, 0);
        }
        .removed {
            background-color:rgb(90, 0, 0);
        }
        details.thinking-block {
            background: #2a2a2a;
            color: #bbb;
            border-left-color: #555;
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
        this.thinkingAccumulator = '';
        this.hideThinking = false;

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

    setHideThinking(val) {
        this.hideThinking = !!val;
    }

    handleNewThinkingToken(token) {
        this.thinkingAccumulator += token;
    }

    async handleTokensDone(promptData = null) {
        this.flushAccumulatingMessage();
        await this.addActionButtons(promptData);
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
        if (type === "info") {
            messageElement.appendChild(htmlStringToFragment(messageText));
        } else {
            messageElement.appendChild(textWithBrToFragment(messageText));
        }
        // messageElement.textContent = messageText;
        // // Replace \n with <br> elements for correct HTML display
        // messageElement.innerHTML = '';
        // messageText.split('\n').forEach((line, idx, arr) => {
        //     messageElement.appendChild(document.createTextNode(line));
        //     if (idx < arr.length - 1) {
        //     messageElement.appendChild(document.createElement('br'));
        //     }
        // });
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
        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-buttons');
        // selection info
        const selectionInfo = document.createElement('p');
        selectionInfo.textContent = browser.i18n.getMessage("apiwebchat_selection_info");
        selectionInfo.classList.add('sel_info');

        const fullTextHTMLAtAssignment = this.fullTextHTML.trim().replace(/^"|"$/g, '').replace(/^<p>&quot;/, '<p>').replace(/&quot;<\/p>$/, '</p>'); // strip quotation marks
        //console.log(">>>>>>>>>>>> fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
        let reply_type_pref = await browser.storage.sync.get({ reply_type: prefs_default.reply_type });

        // "use this answer" split button
        const splitButton = this._buildUseThisAnswerButton(promptData, reply_type_pref, fullTextHTMLAtAssignment);

        const closeButton = document.createElement('button');
        closeButton.textContent = browser.i18n.getMessage("chatgpt_win_close");
        closeButton.classList.add('close_btn');
        closeButton.addEventListener('click', async () => {
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});    // close window
        });
        if(promptData.action != 0) {
            actionButtons.appendChild(splitButton);
            selectionInfo.style.display = "block"; // show selection info
        }

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
        this.messages.appendChild(actionButtons);
        this.messages.appendChild(selectionInfo);
        this.scrollToBottom();
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
        saveSummaryButton.textContent = browser.i18n.getMessage("webchat_save_as_summary");
        saveSummaryButton.classList.add('action_btn');
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
        diffvButton.textContent = browser.i18n.getMessage("btn_show_differences");
        diffvButton.classList.add('diffv_btn');
        diffvButton.addEventListener('click', async () => {
            let strippedText = fullTextHTMLAtAssignment.replace(/<\/?[^>]+(>|$)/g, "");
            let originalText = promptData.prompt_info?.selection_text;
            if((originalText == null) || (originalText == "")) {
                originalText = promptData.prompt_info?.body_text;
            }
            this.appendDiffViewer(originalText, strippedText);
            diffvButton.disabled = true;
        });
        return diffvButton;
    }

    addDivider() {
        const divider = document.createElement('hr');
        this.messages.appendChild(divider);
        this.scrollToBottom();
    }

    appendDiffViewer(originalText, newText) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot');

        // Delegate the diff-node building; page-level layout stays here.
        renderDiff(messageElement, originalText, newText);

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

            // If an unterminated <think> block is present (mid-stream), defer the
            // markdown render until the closing tag arrives — tokens stay in the DOM
            // as raw fading spans, but the partial <think> content is never sent
            // through markdown-it or promoted to the final thinking block.
            const openThink = fullText.match(/<think>/i);
            const closeThink = fullText.match(/<\/think>/i);
            if (openThink && !closeThink) {
                return;
            }

            // Extract inline <think>...</think> blocks (Ollama / OpenAI Comp) and strip them from fullText.
            let inlineThinking = '';
            const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
            let match;
            while ((match = thinkRegex.exec(fullText)) !== null) {
                inlineThinking += (inlineThinking ? '\n' : '') + match[1];
            }
            fullText = fullText.replace(thinkRegex, '').replace(/^\s+/, '');

            // Combined thinking content: worker-side (Anthropic) + inline (<think> tags)
            let combinedThinking = this.thinkingAccumulator;
            if (inlineThinking) {
                combinedThinking += (combinedThinking ? '\n' : '') + inlineThinking;
            }
            this.thinkingAccumulator = '';

            // Convert Markdown to DOM nodes using the markdown-it library
            const md = window.markdownit();
            const html = md.render(fullText);

            this.fullTextHTML += html;

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
            if (combinedThinking) {
                const details = document.createElement('details');
                details.classList.add('thinking-block');
                if (!this.hideThinking) details.open = true;
                const summary = document.createElement('summary');
                summary.textContent = browser.i18n.getMessage('prefs_OptionText_thinking_summary') || 'Thinking';
                const content = document.createElement('div');
                content.classList.add('thinking-content');
                content.textContent = combinedThinking;
                details.appendChild(summary);
                details.appendChild(content);
                this.accumulatingMessageEl.appendChild(details);
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
