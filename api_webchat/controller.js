// The controller wires up all the components and workers together,
// managing the dependencies. A kind of "DI" class.
const worker = new Worker('model-worker.js', { type: 'module' });

const messagesArea = document.querySelector('messages-area');
messagesArea.init(worker);

// Initialize the messageInput component and pass the worker to it
const messageInput = document.querySelector('message-input');
messageInput.init(worker);
messageInput.setMessagesArea(messagesArea);

const params = new URLSearchParams(window.location.search);
let api_key_chatgpt = await browser.storage.sync.get({api_key_chatgpt: ''});
// const openaiApiKey = params.get('openapi-key');
worker.postMessage({ type: 'init', api_key_chatgpt: api_key_chatgpt });
if( api_key_chatgpt !== null ) {
    messagesArea.appendUserMessage("Will attempt to connect to OpenAI using API key provided.", "");
} else {
    messagesArea.appendUserMessage("No OpenAI API key provided. Using mock data.", "");
}


// Event listeners for worker messages
// TODO I'm sure there's a better way to do this
worker.onmessage = function(event) {
    const { type, payload } = event.data;
    switch (type) {
        case 'messageSent':
            messageInput.handleMessageSent();
            break;
        case 'newToken':
            messagesArea.handleNewToken(payload.token);
            break;
        case 'tokensDone':
            messagesArea.handleTokensDone();
            break;
        default:
            console.error('Unknown event type from worker:', type);
    }
};
