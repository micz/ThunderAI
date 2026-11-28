// Spec 04 "OpenAI-Compatible (openai_comp_api)", the worker-safe helpers of js/api/openai_comp.js
// added for #1044 (Mistral reasoning models):
//  - "Chunked content": normalizeChatContent() turns a content value into {text, thinking}: a
//    string is the answer; an array of typed chunks gives its "text" chunks to the answer and the
//    text items of its "thinking" chunks (a plain string tolerated) to the reasoning; an unknown
//    chunk type is ignored (a debug line); null / undefined / anything else give empty strings;
//  - "Error messages": findErrorMessage() / extractErrorMessage() look in error.message (or error
//    as a string), then message (which may hold the detail list), then detail[].msg (joined) or
//    detail as a string; extractErrorMessage() falls back to the raw body;
//  - isStreamErrorFrame(): {"error": ...} or {"object": "error"} sent inside a stream;
//  - "Show only chat models": filterChatModels() drops completion_chat === false and past
//    deprecation dates, keeps models without those fields, puts the "-latest" aliases first and
//    keeps the order otherwise.
// Inputs: the shapes documented at https://docs.mistral.ai/inference/conversations/reasoning and
// the /v1/models fields of Mistral (capabilities.completion_chat, deprecation). Realm: no browser.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';

const { k } = areaFile('14-openai-comp-content');
const {
    extractErrorMessage,
    filterChatModels,
    findErrorMessage,
    isStreamErrorFrame,
    normalizeChatContent
} = await import('../../js/api/openai_comp.js');

const thinkingChunk = (...texts) => ({ type: 'thinking', thinking: texts.map(text => ({ type: 'text', text })) });

k.test('content-string', 'a plain string is the answer, unchanged', () => {
    assert.deepEqual(normalizeChatContent('Hello'), { text: 'Hello', thinking: '' });
    assert.deepEqual(normalizeChatContent(''), { text: '', thinking: '' });
});

k.test('content-thinking-only', 'an array with only a thinking chunk: reasoning, no answer', () => {
    assert.deepEqual(normalizeChatContent([thinkingChunk('Let me ', 'think.')]), { text: '', thinking: 'Let me think.' });
});

k.test('content-mixed', 'thinking and text chunks (the stream transition, a non-streamed answer)', () => {
    assert.deepEqual(normalizeChatContent([thinkingChunk('Reasoning.'), { type: 'text', text: 'The answer.' }]),
        { text: 'The answer.', thinking: 'Reasoning.' });
});

k.test('content-text-only', 'an array of text chunks only: the joined answer, never [object Object]', () => {
    const r = normalizeChatContent([{ type: 'text', text: '{"spam": ' }, { type: 'text', text: 'false}' }]);
    assert.deepEqual(r, { text: '{"spam": false}', thinking: '' });
    assert.equal(r.text.includes('[object Object]'), false);
});

k.test('content-thinking-tolerant', 'a thinking chunk holding a string; non-text items of it ignored', () => {
    assert.deepEqual(normalizeChatContent([{ type: 'thinking', thinking: 'plain' }]), { text: '', thinking: 'plain' });
    assert.deepEqual(normalizeChatContent([{ type: 'thinking', thinking: [{ type: 'image', url: 'x' }, { type: 'text', text: 'ok' }] }]),
        { text: '', thinking: 'ok' });
});

k.test('content-unknown', 'an unknown chunk type is ignored, logged only with debug on', () => {
    const lines = [];
    const logger = { do_debug: true, log: line => lines.push(line) };
    assert.deepEqual(normalizeChatContent([{ type: 'reference', ref: 1 }, { type: 'text', text: 'A' }], logger), { text: 'A', thinking: '' });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /"reference"/);
    const quiet = { do_debug: false, log: line => lines.push(line) };
    normalizeChatContent([{ type: 'reference' }], quiet);
    assert.equal(lines.length, 1);
    assert.deepEqual(normalizeChatContent([null, 42, { type: 'text' }]), { text: '', thinking: '' });
});

k.test('content-null', 'null, undefined and other values: empty strings', () => {
    for (const v of [null, undefined, 0, {}, true]) {
        assert.deepEqual(normalizeChatContent(v), { text: '', thinking: '' }, String(v));
    }
});

k.test('error-message', 'error.message first, then error as a string', () => {
    assert.equal(extractErrorMessage('{"error": {"message": "Bad key", "type": "auth"}, "message": "other"}'), 'Bad key');
    assert.equal(extractErrorMessage('{"error": "Model not loaded"}'), 'Model not loaded');
});

k.test('error-top-message', 'message (Mistral {"object": "error"})', () => {
    assert.equal(extractErrorMessage('{"object": "error", "message": "Invalid model: mistral-x", "type": "invalid_model", "code": "1500"}'),
        'Invalid model: mistral-x');
});

k.test('error-detail', 'detail[].msg joined; detail inside message; detail as a string', () => {
    const body = { detail: [{ type: 'value_error', loc: ['body', 'reasoning_effort'], msg: 'Input should be low, medium or high' }, { msg: 'Second' }] };
    assert.equal(extractErrorMessage(JSON.stringify(body)), 'Input should be low, medium or high; Second');
    assert.equal(extractErrorMessage(JSON.stringify({ object: 'error', message: body })), 'Input should be low, medium or high; Second');
    assert.equal(extractErrorMessage('{"detail": "Not Found"}'), 'Not Found');
});

k.test('error-fallback', 'no known field, or not JSON: the raw body; an empty body: empty', () => {
    assert.equal(extractErrorMessage('{"status": 500}'), '{"status": 500}');
    assert.equal(extractErrorMessage('<html>502 Bad Gateway</html>'), '<html>502 Bad Gateway</html>');
    assert.equal(extractErrorMessage(''), '');
    assert.equal(findErrorMessage({ status: 500 }), '');
    assert.equal(findErrorMessage(null), '');
});

k.test('error-parsed', 'an already parsed body (a stream frame)', () => {
    assert.equal(extractErrorMessage({ error: { message: 'Upstream error' }, choices: [] }), 'Upstream error');
    assert.equal(extractErrorMessage({ error: {} }), '{"error":{}}');
});

k.test('stream-error-frame', 'an error frame is {"error": ...} or {"object": "error"}; a normal frame is not', () => {
    assert.equal(isStreamErrorFrame({ error: { message: 'x' } }), true);
    assert.equal(isStreamErrorFrame({ object: 'error', message: 'x' }), true);
    assert.equal(isStreamErrorFrame({ object: 'chat.completion.chunk', choices: [] }), false);
    assert.equal(isStreamErrorFrame({ error: null, choices: [] }), false);
    assert.equal(isStreamErrorFrame(null), false);
});

const NOW = Date.parse('2026-06-01T00:00:00Z');

k.test('models-filter', 'non-chat and deprecated models dropped, models without the fields kept', () => {
    const models = [
        { id: 'mistral-embed', capabilities: { completion_chat: false } },
        { id: 'mistral-small-2603', capabilities: { completion_chat: true }, deprecation: null },
        { id: 'open-mistral-7b', capabilities: { completion_chat: true }, deprecation: '2025-03-30T12:00:00Z' },
        { id: 'mistral-large-4', capabilities: { completion_chat: true }, deprecation: '2027-01-01T00:00:00Z' },
        { id: 'local-model' },
        { id: 'odd-date', deprecation: 'not a date' },
    ];
    assert.deepEqual(filterChatModels(models, NOW).map(m => m.id), ['mistral-small-2603', 'mistral-large-4', 'local-model', 'odd-date']);
});

k.test('models-latest-first', 'the "-latest" aliases first, the order kept otherwise', () => {
    const ids = ['b-2603', 'mistral-large-latest', 'a-2601', 'mistral-small-latest', 'c'];
    assert.deepEqual(filterChatModels(ids.map(id => ({ id })), NOW).map(m => m.id),
        ['mistral-large-latest', 'mistral-small-latest', 'b-2603', 'a-2601', 'c']);
});

k.test('models-epoch', 'a deprecation given as a number (seconds or ms) is read too', () => {
    const past = NOW / 1000 - 3600;
    assert.deepEqual(filterChatModels([{ id: 's', deprecation: past }, { id: 'ms', deprecation: past * 1000 }, { id: 'ok' }], NOW).map(m => m.id), ['ok']);
});

k.test('models-not-array', 'not a list: an empty list, never a throw', () => {
    assert.deepEqual(filterChatModels(undefined), []);
    assert.deepEqual(filterChatModels([null, 'x', { id: 'm' }], NOW).map(m => m.id), ['m']);
});

k.coverage();
