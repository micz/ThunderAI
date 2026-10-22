// Spec 04 "OpenAI API (chatgpt_api)" and "Extra body data" (js/api/openai_responses.js,
// fetchResponse(messages, previous_response_id)):
//  - reasoning: {summary, effort} with only the sub-properties set; omitted when both are empty
//    or the model has no reasoning support;
//  - text: verbosity (gated on supportsVerbosity) and format collected into one object, the key
//    emitted only when non-empty; text_format json_object / json_schema, json_schema REQUIRING
//    both a name and a schema parsing to a non-null, non-array object, else the format dropped
//    entirely;
//  - temperature and top_p gated on supportsSamplingParams, `!= '' && !NaN`; top_p a string, so
//    '0' is sent;
//  - max_output_tokens only when it parses to >= OPENAI_MIN_MAX_OUTPUT_TOKENS (16);
//  - truncation, prompt_cache_key, service_tier, safety_identifier: plain pass-through, sent when
//    non-empty, not capability-gated;
//  - include: ['reasoning.encrypted_content'] only when the checkbox is on;
//  - the extra body is spread first (model, input, stream, reasoning, instructions... win), and the
//    capability-gated keys are DELETED from it: temperature/top_p when sampling is rejected,
//    reasoning when there is no reasoning stage, text when it carries a verbosity the model does
//    not support; keys the model accepts are honoured; instructions is assigned after the literal.
// Request: POST https://api.openai.com/v1/responses, `Authorization: Bearer <key>` (OpenAI API
// authentication).

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { jsonResponse } from './wire.mjs';

const { k, net } = areaFile('25-openai-responses-request');
const { OpenAI, OPENAI_MIN_MAX_OUTPUT_TOKENS } = await import('../../js/api/openai_responses.js');

const URL_ = 'https://api.openai.com/v1/responses';
const KEY = 'sk-FAKE-OPENAI-0000';
const MESSAGES = [{ role: 'user', content: 'Hi' }];
const OPTIONAL = ['temperature', 'top_p', 'max_output_tokens', 'truncation', 'prompt_cache_key', 'service_tier',
    'safety_identifier', 'include', 'reasoning', 'text', 'instructions'];

async function send(cfg, previous = null) {
    net.expect({ method: 'POST', url: URL_ }, () => jsonResponse({ id: 'resp_x' }));
    await new OpenAI({ apiKey: KEY, model: 'gpt-4.1-nano', stream: true, ...cfg }).fetchResponse(MESSAGES, previous, { maxRetries: 0 });
    return net.calls.at(-1).json();
}

k.test('min-tokens-const', 'OPENAI_MIN_MAX_OUTPUT_TOKENS is 16', () => {
    assert.equal(OPENAI_MIN_MAX_OUTPUT_TOKENS, 16);
});

k.test('url-auth', 'POST /v1/responses with Authorization: Bearer', async () => {
    await send({});
    assert.equal(net.calls[0].method, 'POST');
    assert.equal(net.calls[0].url, URL_);
    assert.equal(net.calls[0].headers.authorization, 'Bearer ' + KEY);
});

k.test('defaults-minimal', 'with every option at its default none of the optional fields is sent', async () => {
    const b = await send({});
    for (const f of OPTIONAL) assert.equal(f in b, false, f);
    assert.equal(b.model, 'gpt-4.1-nano');
    assert.equal(b.stream, true);
    assert.ok(JSON.stringify(b.input).includes('Hi'), 'the messages are sent as input');
});

// ---- reasoning ------------------------------------------------------------------------------

k.test('reasoning-summary', 'only the sub-properties that are set', async () => {
    assert.deepEqual((await send({ model: 'o4-mini', reasoning_summary: 'auto' })).reasoning, { summary: 'auto' });
    assert.deepEqual((await send({ model: 'o4-mini', reasoning_effort: 'low' })).reasoning, { effort: 'low' });
    assert.deepEqual((await send({ model: 'gpt-5', reasoning_summary: 'detailed', reasoning_effort: 'high' })).reasoning,
        { summary: 'detailed', effort: 'high' });
});

k.test('reasoning-empty', 'both empty: reasoning omitted', async () => {
    assert.equal('reasoning' in await send({ model: 'o4-mini' }), false);
});

k.test('reasoning-chat-model', 'a chat model never gets reasoning', async () => {
    assert.equal('reasoning' in await send({ model: 'gpt-4.1', reasoning_summary: 'auto', reasoning_effort: 'low' }), false);
});

// ---- text -----------------------------------------------------------------------------------

k.test('text-verbosity', 'verbosity on the gpt-5 family', async () => {
    assert.deepEqual((await send({ model: 'gpt-5-mini', verbosity: 'low' })).text, { verbosity: 'low' });
});

k.test('text-verbosity-gated', 'verbosity on a model without it: no text key at all', async () => {
    for (const model of ['o3', 'gpt-4.1']) assert.equal('text' in await send({ model, verbosity: 'low' }), false, model);
});

k.test('text-json-object', 'json_object', async () => {
    assert.deepEqual((await send({ text_format: 'json_object' })).text, { format: { type: 'json_object' } });
});

k.test('text-json-schema', 'json_schema with a name and an object schema', async () => {
    const schema = { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] };
    assert.deepEqual((await send({ text_format: 'json_schema', text_format_schema_name: 'tags', text_format_schema: JSON.stringify(schema) })).text,
        { format: { type: 'json_schema', name: 'tags', schema } });
});

k.test('text-json-schema-empty-object', 'an empty object is a schema too', async () => {
    assert.deepEqual((await send({ text_format: 'json_schema', text_format_schema_name: 'any', text_format_schema: '{}' })).text.format.schema, {});
});

for (const [id, name, schema] of [
    ['no-name', '', '{"type":"object"}'],
    ['blank-name', '   ', '{"type":"object"}'],
    ['no-schema', 'tags', ''],
    ['malformed', 'tags', '{"type":'],
    ['array', 'tags', '[{"type":"object"}]'],
    ['null', 'tags', 'null'],
]) {
    k.test('text-json-schema-' + id, `json_schema with ${id}: the format is dropped entirely`, async () => {
        assert.equal('text' in await send({ text_format: 'json_schema', text_format_schema_name: name, text_format_schema: schema }), false);
    });
}

k.test('text-mixed', 'verbosity kept when the format is dropped', async () => {
    assert.deepEqual((await send({ model: 'gpt-5', verbosity: 'high', text_format: 'json_schema', text_format_schema_name: '' })).text,
        { verbosity: 'high' });
});

// ---- sampling, limits, pass-through ---------------------------------------------------------

k.test('sampling', 'temperature and top_p on a chat model, 0 included', async () => {
    const b = await send({ model: 'gpt-4.1', temperature: '0.5', top_p: '0' });
    assert.equal(b.temperature, 0.5);
    assert.equal(b.top_p, 0);
});

k.test('sampling-gated', 'never on a reasoning model', async () => {
    for (const model of ['gpt-5', 'o3-mini']) {
        const b = await send({ model, temperature: '0.5', top_p: '0.9' });
        assert.equal('temperature' in b, false, model);
        assert.equal('top_p' in b, false, model);
    }
});

k.test('sampling-empty', "'' and NaN are not sent", async () => {
    const b = await send({ model: 'gpt-4.1', temperature: '', top_p: 'x' });
    assert.equal('temperature' in b, false);
    assert.equal('top_p' in b, false);
});

k.test('max-output-tokens', 'sent only when >= 16', async () => {
    assert.equal((await send({ max_output_tokens: 16 })).max_output_tokens, 16);
    assert.equal((await send({ max_output_tokens: '2000' })).max_output_tokens, 2000);
    for (const v of [15, 0, '', 'x']) assert.equal('max_output_tokens' in await send({ max_output_tokens: v }), false, String(v));
});

k.test('pass-through', 'truncation, prompt_cache_key, service_tier, safety_identifier: sent when set, on any model', async () => {
    const cfg = { truncation: 'auto', prompt_cache_key: 'thunderai-tags', service_tier: 'flex', safety_identifier: 'user-hash-1' };
    for (const model of ['gpt-5', 'gpt-4.1', 'some-new-model']) {
        const b = await send({ model, ...cfg });
        for (const [f, v] of Object.entries(cfg)) assert.equal(b[f], v, model + ' ' + f);
    }
});

k.test('include', 'include only when the checkbox is on', async () => {
    assert.deepEqual((await send({ include_encrypted_reasoning: true })).include, ['reasoning.encrypted_content']);
    assert.equal('include' in await send({ include_encrypted_reasoning: false }), false);
});

k.test('instructions', 'developer messages are sent as instructions', async () => {
    assert.equal((await send({ developer_messages: 'Be brief.' })).instructions, 'Be brief.');
});

// ---- extra body -----------------------------------------------------------------------------

k.test('extra-top-level', 'the extra body goes at the top level', async () => {
    assert.equal((await send({ extra_body: '{"metadata": {"app": "tb"}}' })).metadata.app, 'tb');
});

k.test('extra-managed-win', 'model, input, stream, reasoning and instructions win over the extra body', async () => {
    const b = await send({
        model: 'o4-mini',
        reasoning_summary: 'auto',
        developer_messages: 'Be brief.',
        extra_body: JSON.stringify({ model: 'evil', input: [], stream: false, reasoning: { summary: 'detailed' }, instructions: 'evil' }),
    });
    assert.equal(b.model, 'o4-mini');
    assert.ok(JSON.stringify(b.input).includes('Hi'));
    assert.equal(b.stream, true);
    assert.deepEqual(b.reasoning, { summary: 'auto' });
    assert.equal(b.instructions, 'Be brief.');
});

k.test('extra-gated-sampling', 'temperature/top_p are deleted from the extra body when the model rejects sampling', async () => {
    const b = await send({ model: 'gpt-5', extra_body: '{"temperature": 1, "top_p": 0.5, "metadata": {"k": "v"}}' });
    assert.equal('temperature' in b, false);
    assert.equal('top_p' in b, false);
    assert.deepEqual(b.metadata, { k: 'v' }, 'the other keys stay');
});

k.test('extra-gated-reasoning', 'reasoning is deleted from the extra body on a model without reasoning', async () => {
    assert.equal('reasoning' in await send({ model: 'gpt-4.1', extra_body: '{"reasoning": {"effort": "low"}}' }), false);
});

k.test('extra-gated-text', 'a text object carrying an unsupported verbosity is deleted', async () => {
    assert.equal('text' in await send({ model: 'gpt-4.1', extra_body: '{"text": {"verbosity": "low"}}' }), false);
});

k.test('extra-accepted-honoured', 'keys the model accepts are honoured from the extra body', async () => {
    assert.equal((await send({ model: 'gpt-4.1', temperature: '', extra_body: '{"temperature": 1.2}' })).temperature, 1.2);
    assert.deepEqual((await send({ model: 'gpt-5', extra_body: '{"text": {"verbosity": "low"}}' })).text, { verbosity: 'low' });
    assert.deepEqual((await send({ model: 'o3', extra_body: '{"reasoning": {"effort": "high"}}' })).reasoning, { effort: 'high' });
});

k.coverage();
