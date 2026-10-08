// The chat window opened by a ChatGPT API prompt that carries its own model, whose name holds
// markup and a "%", with a developer message holding markup and a saved font zoom of 130%, then the
// background's api_send: start-up, the ready handshake, the worker's init message, the header, the
// startup notice, the prompt sent, and the font zoom keys.
//
// Spec 01 "API WebChat (`api_webchat/`)": "Component structure" (the controller resolves the
// provider prefs, spins up the provider's worker, sends it the init message), "Streaming data flow"
// (api_send: promptData set, the prompt sent as it came, plain text with its \n; a typed message
// likewise, its bubble showing its line breaks as text, a literal "<br>" included), "Transcript DOM
// contract" (the startup notice, the user turn), "Web Workers" (the worker file of each provider); "Component structure" also holds
// the URL parameters (prompt_name decoded once), the header (model and API, no usage), the ready
// handshake and the startup notice (every value escaped). Spec 04 "Configuration Validation"
// (the prompt's own {integration}_{key} fields over the global ones, "the rule
// api_webchat/controller.js applies"), "Anthropic / Claude (`anthropic_api`)" (the four 400 hints
// only for the anthropic integration), "Emitting to the chat window" (the chat_show_usage_data
// flag on the init message), "Rendering in the chat window" (no usage chrome in the header),
// "Font zoom in the webchat UI".
//
// The tests run in order on one window: the zoom tests come last and leave the zoom at 100%.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    typeAndSend,
    turns,
    field,
    sendButton,
    stopButton,
    statusPill,
    statusText,
    usable,
    sq,
} from '../../webchat/webchat-page.mjs';
import { executableProblems } from '../../webchat/safety.mjs';

const NAME = 'Own <b>prompt</b> 100%';
const DEV = 'Be <img src=x onerror="window.__pwned=1"> brief';
const OWN = {
    id: 'prompt_own', name: NAME, text: 'Fix this', type: '0', action: '0', is_default: '0',
    show_in: 'popup', api_type: 'chatgpt_api', chatgpt_model: 'gpt-own',
};
const { ctx, worker } = await openWebchat({
    llm: 'chatgpt_api',
    call_id: 'c01',
    prompt_id: 'prompt_own',
    prompt_name: NAME,
    local: {
        chatgpt_developer_messages: DEV,
        chatgpt_api_key: 'sk-global',
        chatgpt_model: 'gpt-global',
        api_webchat_font_scale: 1.3,
        _custom_prompt: [OWN],
    },
});
after(() => ctx.close());
const k = webchatTests('01');

const S_COMP = 'spec 01 "Component structure"';
const S_WORKERS = 'spec 01 "Web Workers (`js/workers/`)"';
const S_FLOW = 'spec 01 "Streaming data flow"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_CONF = 'spec 04 "Configuration Validation"';
const S_CLAUDE = 'spec 04 "Anthropic / Claude (`anthropic_api`)"';
const S_EMIT = 'spec 04 "Emitting to the chat window"';
const S_USAGE = 'spec 04 "Rendering in the chat window"';
const S_ZOOM = 'spec 04 "Font zoom in the webchat UI"';

const init = () => worker.posted.find(m => m.type === 'init');

k.test('worker-file', S_WORKERS, 'the window runs the worker of its connection type: ChatGPT API -> model-worker-openai_responses.js, as a module', () => {
    assert.match(worker.url, /\/js\/workers\/model-worker-openai_responses\.js$/);
    assert.deepEqual(worker.options, { type: 'module' });
    assert.deepEqual(worker.unexpected, []);
});

k.test('init-first', S_COMP, 'the first message the worker receives is its init message, before any prompt', () => {
    assert.equal(worker.posted[0]?.type, 'init');
    assert.equal(worker.posted.filter(m => m.type === 'init').length, 1);
});

k.test('init-prefs', S_COMP, 'the init message carries the provider prefs the window resolved: a global value the prompt does not set', () => {
    assert.equal(init().chatgpt_api_key, 'sk-global');
});

k.test('init-prompt-override', S_CONF, "the prompt's own {integration}_{key} field wins over the global one, in the init message", () => {
    assert.equal(init().chatgpt_model, 'gpt-own');
});

k.test('init-usage-flag', S_EMIT, 'chat_show_usage_data is on (its default) and ChatGPT API reports usage: the init message says so', () => {
    assert.equal(init().chat_show_usage_data, true);
});

k.test('no-claude-hints', S_CLAUDE, 'the four anthropic_err_hint_* strings are filled only for the anthropic integration: none for ChatGPT API', () => {
    const keys = Object.keys(init().i18nStrings || {});
    assert.deepEqual(keys.filter(key => key.startsWith('anthropic_err_hint_')), []);
});

k.test('header-model', S_USAGE, 'the header shows the model in use (the prompt\'s own) and the API', () => {
    const model = ctx.$('#appHeaderModel');
    assert.match(model.textContent, /gpt-own/);
    assert.doesNotMatch(model.textContent, /gpt-global/);
    const api = ctx.$('#appHeaderApi');
    assert.equal(api.hidden, false);
    assert.match(api.textContent, /ChatGPT API/);
});

k.test('header-no-usage', S_USAGE, 'no usage chrome in the window header: nothing marked data-mzta-usage, no token count', () => {
    const header = ctx.$('#appHeader');
    assert.equal(header.querySelector('[data-mzta-usage]'), null);
    assert.doesNotMatch(header.textContent, /token/i);
});

k.test('ready', S_COMP, 'the window announces itself once with {command: "${llm}_ready_${call_id}", window_id}, before any prompt', () => {
    const ready = ctx.ctl.sent.filter(m => m && typeof m.command === 'string' && m.command.endsWith('_ready_c01'));
    assert.deepEqual(ready, [{ command: 'chatgpt_api_ready_c01', window_id: 1 }]);
    assert.deepEqual(worker.chatMessages(), []);
});

k.test('model-chip', S_COMP, 'the model chip reads "<prompt name> | <model>" as text, and its title repeats it', () => {
    const chip = ctx.$('#appHeaderModel');
    assert.equal(chip.textContent, NAME + ' | gpt-own');
    assert.equal(chip.title, chip.textContent);
});

k.test('api-chip', S_COMP, 'the API chip names the API and is tinted with the connection type', () => {
    const api = ctx.$('#appHeaderApi');
    assert.equal(ctx.$('#appHeaderApiName').textContent, 'ChatGPT API');
    assert.ok(api.classList.contains('tint_chatgpt_api'));
});

k.test('name-percent', S_COMP, 'prompt_name is decoded once: a name holding "%" and markup opens the window and reaches the header as written', () => {
    assert.ok(ctx.$('#appHeaderModel').textContent.includes(NAME), ctx.$('#appHeaderModel').textContent);
    assert.equal(ctx.$('#appHeaderModel b'), null);
});

k.test('notice-escaped', S_COMP, 'the startup notice shows the prompt name and the text settings as text: nothing they hold becomes an element', () => {
    const notice = turns(ctx)[0].querySelector('.message.info');
    assert.ok(notice.textContent.includes('[prompt_own] ' + NAME), notice.textContent);
    assert.ok(notice.textContent.includes(DEV), notice.textContent);
    assert.equal(notice.querySelector('b, img'), null);
    assert.deepEqual(executableProblems(notice), []);
});

k.test('startup-notice', S_DOM, 'the transcript opens with the startup notice: a .turn-info holding a .message.info, and no user turn', () => {
    const t = turns(ctx);
    assert.equal(t.length, 1);
    assert.ok(t[0].classList.contains('turn-info'));
    assert.ok(t[0].querySelector('.message.info'));
});

k.test('idle-input', S_FLOW, 'before api_send the input is usable and nothing was sent to the worker but init', () => {
    assert.ok(usable(field(ctx)));
    assert.ok(usable(sendButton(ctx)));
    assert.equal(usable(stopButton(ctx)), false);
    assert.deepEqual(worker.chatMessages(), []);
});

const PROMPT = 'Rewrite this:\nDear <b>Bob</b>,\nsee <img src=x onerror="window.__pwned=1"> you';

k.test('api-send-user-turn', S_FLOW, 'api_send: the prompt is shown as the user\'s message, in a .turn-user .bubble', async () => {
    await apiSend(ctx, { prompt: PROMPT, action: '0' });
    const t = turns(ctx);
    assert.equal(t.length, 2);
    const user = t[1];
    assert.ok(user.classList.contains('turn-user'));
    const bubble = user.querySelector('.bubble');
    assert.ok(bubble);
    for (const word of ['Rewrite this:', 'Dear', 'Bob', 'see', 'you']) {
        assert.ok(bubble.textContent.includes(word), word + ' missing from ' + bubble.textContent);
    }
    assert.equal(bubble.querySelectorAll('br').length, 2, 'one line break per newline of the prompt');
});

k.test('api-send-bubble-safe', S_FLOW, 'the prompt carries mail content: nothing executable reaches the user bubble', () => {
    assert.deepEqual(executableProblems(turns(ctx)[1]), []);
    assert.equal(turns(ctx)[1].querySelector('img, b'), null);
});

k.test('api-send-worker', S_FLOW, 'api_send: the prompt is sent to the worker as one chatMessage', () => {
    const sent = worker.chatMessages();
    assert.equal(sent.length, 1);
    for (const word of ['Rewrite this:', 'Dear', 'Bob', 'see', 'you']) {
        assert.ok(sent[0].includes(word), word + ' missing from ' + sent[0]);
    }
});

k.test('api-send-worker-exact', S_FLOW, 'api_send: the worker receives the prompt exactly as the background sent it, plain text, its line breaks as \\n and no <br> added', () => {
    assert.deepEqual(worker.chatMessages(), [PROMPT]);
});

k.test('api-send-waiting', S_FLOW, 'while the request is out the input is locked, Stop is offered, and the pill says it is waiting', () => {
    assert.equal(field(ctx).disabled, true);
    assert.equal(usable(sendButton(ctx)), false);
    assert.ok(usable(stopButton(ctx)));
    assert.ok(statusPill(ctx).classList.contains('status-waiting'));
    assert.match(statusText(ctx), /^Waiting for the server response/);
});

k.test('message-sent', S_FLOW, 'messageSent: the field is emptied (messageInput.handleMessageSent())', async () => {
    await worker.sent(ctx);
    assert.equal(field(ctx).value, '');
});

// A typed message on two lines, holding a literal "<br>" the user wrote.
const TYPED = 'Shorter, please:\nkeep the <br> as written';

k.test('typed-worker-exact', S_FLOW, 'a typed message reaches the worker exactly as typed, its \\n kept, like the first prompt', async () => {
    await worker.stream(ctx, ['Done.']);
    await typeAndSend(ctx, TYPED);
    assert.deepEqual(worker.chatMessages(), [PROMPT, TYPED]);
});

k.test('typed-bubble-lines', S_FLOW, 'its bubble shows its line break, as text nodes and a <br>: the literal "<br>" stays text', () => {
    const bubble = turns(ctx).at(-1).querySelector('.bubble');
    assert.equal(bubble.querySelectorAll('br').length, 1, 'one line break per newline of the message');
    assert.deepEqual([...bubble.childNodes].map(n => n.nodeName), ['#text', 'BR', '#text']);
    assert.equal(bubble.textContent, TYPED.replace('\n', ''));
});

k.test('typed-done', S_FLOW, 'the answer to the typed message gives the input back', async () => {
    await worker.sent(ctx);
    await worker.stream(ctx, ['Done again.']);
    assert.ok(usable(field(ctx)));
});

// ---- font zoom -------------------------------------------------------------------------

const root = () => ctx.document.documentElement.style.fontSize;
const stored = () => ctx.ctl.localData().api_webchat_font_scale;
const key = (k2, init2 = { ctrlKey: true }) => ctx.fire(ctx.document, 'keydown', { key: k2, ...init2 });

k.test('zoom-restored', S_ZOOM, 'on open the saved level is re-applied to the root font size, as a percentage', () => {
    assert.equal(root(), '130%');
});

k.test('zoom-plus', S_ZOOM, 'Ctrl + "+" and Ctrl + "=" increase by 0.1, applied and persisted', async () => {
    await key('+');
    assert.equal(root(), '140%');
    assert.equal(stored(), 1.4);
    await key('=');
    assert.equal(root(), '150%');
    assert.equal(stored(), 1.5);
});

k.test('zoom-minus', S_ZOOM, 'Ctrl + "-" decreases by 0.1, applied and persisted', async () => {
    await key('-');
    assert.equal(root(), '140%');
    assert.equal(stored(), 1.4);
});

k.test('zoom-meta', S_ZOOM, 'Cmd (meta) works as Ctrl', async () => {
    await key('-', { metaKey: true });
    assert.equal(stored(), 1.3);
});

k.test('zoom-no-modifier', S_ZOOM, 'without Ctrl or Cmd the keys change nothing', async () => {
    const before = ctx.ctl.calls.length;
    await key('+', {});
    await key('0', {});
    assert.equal(root(), '130%');
    assert.equal(ctx.localWrites(before).length, 0);
});

k.test('zoom-from-component', S_ZOOM, 'a key typed inside a component (composed) reaches the document listener', async () => {
    const fieldEl = field(ctx);
    fieldEl.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
    await ctx.settle();
    assert.equal(stored(), 1.4);
});

k.test('zoom-clamp-max', S_ZOOM, 'the level is clamped at 2.5', async () => {
    for (let i = 0; i < 15; i++) await key('+');
    assert.equal(stored(), 2.5);
    assert.equal(root(), '250%');
});

k.test('zoom-clamp-min', S_ZOOM, 'the level is clamped at 0.5', async () => {
    for (let i = 0; i < 25; i++) await key('-');
    assert.equal(stored(), 0.5);
    assert.equal(root(), '50%');
});

k.test('zoom-reset', S_ZOOM, 'Ctrl + "0" resets to 100%, persisted as 1', async () => {
    await key('0');
    assert.equal(root(), '100%');
    assert.equal(stored(), 1);
});

k.test('zoom-components-rem', S_ZOOM, 'the components scale with the root: the input field is sized in rem, not px', () => {
    const style = sq(ctx.document, 'message-input', 'style').textContent;
    assert.match(style, /#messageInputField\s*\{[^}]*font-size:\s*[\d.]+rem/);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
