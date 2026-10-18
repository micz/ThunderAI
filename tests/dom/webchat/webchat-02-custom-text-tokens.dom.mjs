// api_send with do_custom_text "1" for a prompt holding additional_text tokens: one labelled
// "#1" (a bare token, renumbered by preparePrompt()) and one labelled "tone", written twice with
// different spacing around the colon. Placeholder default values on (ph_def_val=1).
//
// Spec 01 "Streaming data flow" (api_send shows the custom-text field instead of sending;
// api_send_custom_text merges the text into the prompt, then sends). Spec 03 "additional_text"
// (the chat window asks one step per entry, `[ID: <info>]`, an `n/total` counter when there is more
// than one; the late fill replaces each token keyed by its inner text, every spelling of a label
// filled, an empty answer becoming "" whatever placeholders_use_default_value says).
//
// The window asks the background with api_send_custom_text and the background sends the same
// command back to it: the test plays the background, echoing what the window sent.

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
    fromBackground,
    sentCommands,
    turns,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    ph_def_val: '1',
    local: { placeholders_use_default_value: true },
    commands: { api_send_custom_text: () => true },
});
after(() => ctx.close());
const k = webchatTests('02');
// The window asks for its own active tab to tell the background where it is; the harness's
// tabs.query() answers none.
ctx.ctl.browser.tabs.query = async () => [{ id: 77, active: true }];

const S_FLOW = 'spec 01 "Streaming data flow"';
const S_AT = "spec 03 \"`additional_text`: the user's input, filled late\"";

const box = () => sq(ctx.document, 'message-input', '#mzta-custom_text');
const area = () => sq(ctx.document, 'message-input', '#mzta-custom_textarea');
const info = () => sq(ctx.document, 'message-input', '#mzta-custom_info');
const step = () => sq(ctx.document, 'message-input', '#mzta-custom_step');
const ok = () => sq(ctx.document, 'message-input', '#mzta-custom_btn');

const PROMPT = 'Translate {%additional_text:#1%} in a {%additional_text:tone%} tone ({%additional_text : tone %}).';
const ARRAY = [
    { placeholder: '{%additional_text:#1%}', info: '#1' },
    { placeholder: '{%additional_text:tone%}', info: 'tone' },
];

k.test('field-instead', S_FLOW, 'api_send with do_custom_text "1": the custom-text field is shown and nothing is sent yet', async () => {
    await apiSend(ctx, { prompt: PROMPT, do_custom_text: '1', prompt_info: { custom_text_array: ARRAY } });
    assert.equal(box().style.display, 'block');
    assert.deepEqual(worker.chatMessages(), []);
    assert.equal(turns(ctx).filter(t => t.classList.contains('turn-user')).length, 0);
});

k.test('first-step', S_AT, 'one step per entry: the first shows its label as [ID: #1] and the counter 1/2', () => {
    assert.match(info().textContent, /\[ID: #1\]/);
    assert.equal(step().textContent, '1/2');
    assert.notEqual(step().style.display, 'none');
});

k.test('second-step', S_AT, 'the button moves to the next entry: [ID: tone], 2/2, an empty field, still nothing sent', async () => {
    area().value = 'the Italian text';
    await ctx.click(ok());
    assert.match(info().textContent, /\[ID: tone\]/);
    assert.equal(step().textContent, '2/2');
    assert.equal(area().value, '');
    assert.deepEqual(worker.chatMessages(), []);
    assert.deepEqual(sentCommands(ctx, 'api_send_custom_text'), []);
});

let asked = null;

k.test('enter-submits', S_AT, 'Enter on the last step (left empty) hands the answers to the background and hides the field', async () => {
    await ctx.fire(area(), 'keydown', { key: 'Enter' });
    const sent = sentCommands(ctx, 'api_send_custom_text');
    assert.equal(sent.length, 1);
    asked = sent[0];
    assert.ok(Array.isArray(asked.custom_text));
    assert.deepEqual(asked.custom_text.map(e => [e.placeholder, e.custom_text]),
        [['{%additional_text:#1%}', 'the Italian text'], ['{%additional_text:tone%}', '']]);
    assert.equal(box().style.display, 'none');
});

k.test('late-fill', S_AT, 'api_send_custom_text: every token is replaced by its answer, every spelling of a label included, and the prompt is sent', async () => {
    await fromBackground(ctx, { command: 'api_send_custom_text', custom_text: asked.custom_text });
    const sent = worker.chatMessages();
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Translate the Italian text in a/);
    assert.doesNotMatch(sent[0], /\{%|%\}|additional_text/);
});

k.test('empty-answer', S_AT, 'an answer left empty becomes "", never the literal token, with placeholders_use_default_value on', () => {
    assert.match(worker.chatMessages()[0], /in a\s+tone\s*\(\s*\)\./);
});

k.test('user-turn', S_FLOW, 'the filled prompt is shown as the user\'s message', () => {
    const user = turns(ctx).filter(t => t.classList.contains('turn-user'));
    assert.equal(user.length, 1);
    assert.match(user[0].textContent, /Translate the Italian text/);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
