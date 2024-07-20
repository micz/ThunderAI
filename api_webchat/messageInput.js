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
        border: 2px solid darkgrey;
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

class MessageInput extends HTMLElement {
    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messageInputTemplate.content.cloneNode(true));

        this._messageInputField = shadowRoot.querySelector('#messageInputField');
        this._sendButton = shadowRoot.querySelector('#sendButton');

        this._messageInputField.addEventListener('keydown', this._handleKeyDown.bind(this));
        this._sendButton.addEventListener('click', this._handleClick.bind(this));
    }

    connectedCallback() {
        // Set focus to the input field when the element is added to the DOM
        this._messageInputField.focus();
    }

    init(worker) {
        this.worker = worker;
    }

    setMessagesArea(messagesAreaComponent) {
        this.messagesAreaComponent = messagesAreaComponent;
    }

    handleMessageSent() {
        console.log("handleMessageSent");
        this._messageInputField.value = '';
        this._sendButton.removeAttribute('disabled');
        this._messageInputField.removeAttribute('disabled');
    }

    _handleKeyDown(event) {
        if (event.key === 'Enter') {
            this._handleNewChatMessage();
        }
    }

    _handleClick() {
        this._handleNewChatMessage();
    }

    _handleNewChatMessage() {
        // prevent user from interacting while we're waiting
        this._sendButton.setAttribute('disabled', 'disabled');
        this._messageInputField.setAttribute('disabled', 'disabled');
        let messageContent = this._messageInputField.value;
        if (this.messagesAreaComponent) {
            this.messagesAreaComponent.appendUserMessage(messageContent);
        }
        this.worker.postMessage({ type: 'chatMessage', message: messageContent });
    }
}

customElements.define('message-input', MessageInput);