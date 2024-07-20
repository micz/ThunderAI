const messagesAreaTemplate = document.createElement('template');
messagesAreaTemplate.innerHTML = `
    <style>
        :host {
            display: flex;
            flex-direction: column;
            height: 100%; /* Adjust as needed */
            overflow-y: auto; /* Makes the area scrollable */
        }
        #messages {
            display: flex;
            flex-direction: column;
            justify-content: flex-end; /* Align messages to the bottom */
            min-height: 100%; /* Ensure it takes the full height */
            margin: var(--margin);
        }
        .message {
            margin-bottom: var(--margin);
            line-height: 1.3;
        }

        .token {
            display: inline; /* Tokens are inline elements */
            opacity: 0; /* Start with the token invisible */
            animation: fadeIn 1000ms forwards; /* Apply the fade-in animation */
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


    </style>
    <div id="messages"></div>
`;


class MessagesArea extends HTMLElement {
    constructor() {
        super();
        this.accumulatingMessageEl = null; // No initial message container

        const shadowRoot = this.attachShadow({mode: 'open'});
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
        this.accumulatingMessageEl.classList.add('message', 'bot'); // Tag as 'bot' message
        this.messages.appendChild(this.accumulatingMessageEl);
    }

    init(worker) {
        this.worker = worker;
    }

    handleTokensDone() {
        this.flushAccumulatingMessage();
    }

    appendUserMessage(messageText, source="You") {
        console.log("appendUserMessage: "+messageText);
        const header = document.createElement('h2');
        header.textContent = source;
        this.messages.appendChild(header);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'user'); // Tag as 'user' message
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
            // remove all the animation spans and interpret the text as markdown. 
            let fullText = '';
            this.accumulatingMessageEl.querySelectorAll('.token').forEach(tokenEl => {
                fullText += tokenEl.textContent;
            });

            // Convert Markdown to HTML
            let htmlText = marked.parse(fullText);
            console.log("htmlText: "+htmlText);
            this.accumulatingMessageEl.innerHTML = htmlText;

            this.accumulatingMessageEl = null; // Clear the reference for the next message
        }
        //this.scrollToBottom();
    }
}

customElements.define('messages-area', MessagesArea);
