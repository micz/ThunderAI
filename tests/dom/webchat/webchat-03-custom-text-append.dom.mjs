// api_send with do_custom_text "1" for a prompt with no additional_text token, and no
// custom_text_array: a single text, appended to the prompt.
//
// Spec 01 "Streaming data flow" (api_send shows the custom-text field; api_send_custom_text merges
// the text into the prompt, then sends). Spec 03 "`additional_text`: the user's input, filled
// late" (step 3: "A prompt with need_custom_text "1" and no additional_text token asks a single
// text, which is appended to the prompt after a space"; one step, so no n/total counter; "The legacy
// string form" and "A token missing from the array", played by the test as an older producer would).

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
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({ commands: { api_send_custom_text: () => true } });
after(() => ctx.close());
const k = webchatTests('03');
// The window asks for its own active tab; the harness's tabs.query() answers none.
ctx.ctl.browser.tabs.query = async () => [{ id: 78, active: true }];

const S_FLOW = 'spec 01 "Streaming data flow"';
const S_AT = "spec 03 \"`additional_text`: the user's input, filled late\"";

const box = () => sq(ctx.document, 'message-input', '#mzta-custom_text');
const area = () => sq(ctx.document, 'message-input', '#mzta-custom_textarea');
const info = () => sq(ctx.document, 'message-input', '#mzta-custom_info');
const step = () => sq(ctx.document, 'message-input', '#mzta-custom_step');
const ok = () => sq(ctx.document, 'message-input', '#mzta-custom_btn');

k.test('single-step', S_AT, 'no token and no entries: one step, no ID label, no n/total counter', async () => {
    await apiSend(ctx, { prompt: 'Summarize this mail', do_custom_text: '1', prompt_info: {} });
    assert.equal(box().style.display, 'block');
    assert.doesNotMatch(info().textContent, /\[ID:/);
    assert.equal(step().style.display, 'none');
    assert.deepEqual(worker.chatMessages(), []);
});

k.test('appended', S_AT, 'the text is appended to the prompt after a space, and the prompt sent', async () => {
    area().value = 'in two lines';
    await ctx.click(ok());
    const sent = sentCommands(ctx, 'api_send_custom_text');
    assert.equal(sent.length, 1);
    await fromBackground(ctx, { command: 'api_send_custom_text', custom_text: sent[0].custom_text });
    assert.deepEqual(worker.chatMessages(), ['Summarize this mail in two lines']);
});

k.test('field-gone', S_FLOW, 'once sent, the custom-text field is hidden', () => {
    assert.equal(box().style.display, 'none');
});

// ---- what an older producer can send: each case is a fresh api_send, played by the test ------

k.test('legacy-string-append', S_AT, 'the legacy string form, no token in the prompt: the string is appended after a space', async () => {
    await apiSend(ctx, { prompt: 'Translate this', do_custom_text: '1', prompt_info: {} });
    await fromBackground(ctx, { command: 'api_send_custom_text', custom_text: 'to French' });
    assert.equal(worker.chatMessages().at(-1), 'Translate this to French');
});

k.test('legacy-string-tokens', S_AT, 'the legacy string form with tokens: through the || chain the one string fills every token, labelled or not', async () => {
    await apiSend(ctx, { prompt: 'Write {%additional_text:#1%} in a {%additional_text:tone%} way', do_custom_text: '1', prompt_info: {} });
    await fromBackground(ctx, { command: 'api_send_custom_text', custom_text: 'warmly' });
    assert.equal(worker.chatMessages().at(-1), 'Write warmly in a warmly way');
});

k.test('missing-entry', S_AT, 'a token the array has no entry for follows the chain to its end: with default values off (ph_def_val not 1) it stays as written', async () => {
    await apiSend(ctx, { prompt: 'Write {%additional_text:#1%} in a {%additional_text:tone%} way', do_custom_text: '1', prompt_info: {} });
    await fromBackground(ctx, { command: 'api_send_custom_text',
        custom_text: [{ placeholder: '{%additional_text:#1%}', info: '#1', custom_text: 'a note' }] });
    assert.equal(worker.chatMessages().at(-1), 'Write a note in a {%additional_text:tone%} way');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
