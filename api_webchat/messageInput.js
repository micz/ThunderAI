const messageInputTemplate = document.createElement('template');
messageInputTemplate.innerHTML = `
    <style>
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
            padding: 10px; /* Increased padding */
            font-size: 1rem; /* Adjusted font size to match message output */
            border: 1px solid lightgrey; /* Light grey border */
            border-radius: 10px; /* More rounded edges */
            margin-right: var(--padding);
            outline: none;
        }
        #messageInputField:focus {
            border-color: darkgrey; /* Dark grey border on focus */
        }
        #sendButton {
            width: 44px;
            height: 36px;
            cursor: pointer; 
            border-radius: 10px;
            border: 2px solid darkgrey;
        }
    </style>
    <input type="text" id="messageInputField" placeholder="" focus="true" autocomplete="off">
    <button id="sendButton"><span class="" height="24" width="24" data-state="closed"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="text-white dark:text-black"><path d="M7 11L12 6L17 11M12 18V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span></button>
`;

// stop button <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-2 w-2 text-gizmo-gray-950 dark:text-gray-200" height="16" width="16"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2z" stroke-width="0"></path></svg>
class MessageInput extends HTMLElement {
    constructor() {
        super();
        const shadowRoot = this.attachShadow({mode: 'open'});
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
