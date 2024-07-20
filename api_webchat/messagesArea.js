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
        margin: var(--margin);
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
    }

    appendUserMessage(messageText, source="You") {
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

    flushAccumulatingMessage() {
        if (this.accumulatingMessageEl) {
            // Raccogliere tutti i token in un testo completo
            let fullText = '';
            this.accumulatingMessageEl.querySelectorAll('.token').forEach(tokenEl => {
                fullText += tokenEl.textContent;
            });

            // Convertire Markdown in nodi DOM usando la libreria markdown-it
            const md = window.markdownit();
            const html = md.render(fullText);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            this.accumulatingMessageEl.innerHTML = ''; // Rimuovere i token esistenti
            Array.from(tempDiv.childNodes).forEach(node => {
                this.accumulatingMessageEl.appendChild(node);
            });

            this.accumulatingMessageEl = null;
        }
    }
}

customElements.define('messages-area', MessagesArea);
