// Spec 04 "Google Gemini (google_gemini_api)", "Extra body data" and "Thinking output in the
// webchat UI" (js/api/google_gemini.js fetchResponse):
//  - thinking_budget coerced with parseInt and sent as the integer
//    generationConfig.thinkingConfig.thinkingBudget; empty or unparsable omits the whole
//    thinkingConfig; includeThoughts: true is sent whenever a budget is set and is not 0;
//  - max_output_tokens -> generationConfig.maxOutputTokens only when the parsed integer is > 0;
//  - top_p / top_k -> generationConfig.topP / topK, parseFloat / parseInt, only when non-empty and
//    not NaN, ranges not validated; temperature likewise;
//  - google_gemini_extra_body is merged at BOTH levels: the top level and, separately, the
//    nested generationConfig (only when it is a plain object), the managed keys applied on top;
//    root keys such as safetySettings or tools are accepted, contents and system_instruction can
//    never be overridden.
// Request: streamGenerateContent?alt=sse (generateContent when not streaming); the API key in the
// query string ("Gemini ... carry the API key in the query string", spec 04 "Logging") and in no
// header.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { jsonResponse } from './wire.mjs';

const { k, net } = areaFile('22-gemini-request');
const { GoogleGemini } = await import('../../js/api/google_gemini.js');

const KEY = 'FAKE-GEMINI-KEY-0000';
const CONTENTS = [{ role: 'user', parts: [{ text: 'Hi' }] }];

async function send(cfg) {
    net.expect(u => u.url.startsWith('https://generativelanguage.googleapis.com/'), () => jsonResponse({ candidates: [] }));
    await new GoogleGemini({ apiKey: KEY, model: 'gemini-2.5-flash', stream: true, ...cfg }).fetchResponse(CONTENTS, { maxRetries: 0 });
    return net.calls.at(-1).json();
}
const gc = async cfg => (await send(cfg)).generationConfig || {};

k.test('url-stream', 'streaming: POST models/<model>:streamGenerateContent?alt=sse with the key in the query string', async () => {
    await send({});
    const c = net.calls[0];
    const u = new URL(c.url);
    assert.equal(c.method, 'POST');
    assert.equal(u.origin + u.pathname, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent');
    assert.equal(u.searchParams.get('alt'), 'sse');
    assert.equal(u.searchParams.get('key'), KEY);
});

k.test('url-no-stream', 'not streaming: models/<model>:generateContent', async () => {
    await send({ stream: false });
    const u = new URL(net.calls[0].url);
    assert.equal(u.pathname, '/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(u.searchParams.get('key'), KEY);
});

k.test('auth-query-only', 'the key travels in no header', async () => {
    await send({});
    const h = net.calls[0].headers;
    assert.equal('authorization' in h, false);
    assert.equal('x-goog-api-key' in h, false);
    assert.equal(Object.values(h).some(v => v.includes(KEY)), false);
});

k.test('contents', 'the messages are sent as contents', async () => {
    assert.deepEqual((await send({})).contents, CONTENTS);
});

k.test('system-instruction', 'a system instruction is sent; none when empty', async () => {
    assert.equal('system_instruction' in await send({ system_instruction: '' }), false);
    assert.ok(JSON.stringify((await send({ system_instruction: 'Be brief.' })).system_instruction).includes('Be brief.'));
});

// ---- thinking -------------------------------------------------------------------------------

k.test('budget-empty', 'an empty budget omits the whole thinkingConfig', async () => {
    assert.equal('thinkingConfig' in await gc({ thinking_budget: '' }), false);
});

k.test('budget-unparsable', 'an unparsable budget omits the whole thinkingConfig', async () => {
    assert.equal('thinkingConfig' in await gc({ thinking_budget: 'lots' }), false);
});

k.test('budget-set', 'a budget is sent as an integer, with includeThoughts', async () => {
    assert.deepEqual((await gc({ thinking_budget: '1024' })).thinkingConfig, { thinkingBudget: 1024, includeThoughts: true });
    assert.deepEqual((await gc({ thinking_budget: 2048 })).thinkingConfig, { thinkingBudget: 2048, includeThoughts: true });
});

k.test('budget-dynamic', 'the dynamic budget -1 is sent, with includeThoughts', async () => {
    assert.deepEqual((await gc({ thinking_budget: '-1' })).thinkingConfig, { thinkingBudget: -1, includeThoughts: true });
});

k.test('budget-zero', 'a budget of 0 (thinking off) is sent without includeThoughts', async () => {
    assert.deepEqual((await gc({ thinking_budget: '0' })).thinkingConfig, { thinkingBudget: 0 });
});

// ---- generation parameters ------------------------------------------------------------------

k.test('max-output-tokens', 'maxOutputTokens only when the parsed integer is > 0', async () => {
    assert.equal((await gc({ max_output_tokens: 512 })).maxOutputTokens, 512);
    assert.equal((await gc({ max_output_tokens: '256' })).maxOutputTokens, 256);
    for (const v of [0, '', -5, 'x']) assert.equal('maxOutputTokens' in await gc({ max_output_tokens: v }), false, String(v));
});

k.test('sampling', 'temperature, topP, topK: parsed, sent when non-empty and not NaN, 0 included, ranges not validated', async () => {
    const g = await gc({ temperature: '0.4', top_p: '0', top_k: '40' });
    assert.equal(g.temperature, 0.4);
    assert.equal(g.topP, 0);
    assert.equal(g.topK, 40);
    assert.equal((await gc({ top_p: '7' })).topP, 7, 'an out-of-range value is left for the API to report');
});

k.test('sampling-empty', "'' or NaN: not sent", async () => {
    const g = await gc({ temperature: '', top_p: 'abc', top_k: '' });
    for (const f of ['temperature', 'topP', 'topK']) assert.equal(f in g, false, f);
});

// ---- extra body: the two-level merge --------------------------------------------------------

k.test('extra-root', 'root keys of the extra body (safetySettings, tools) are sent at the top level', async () => {
    const safetySettings = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }];
    const b = await send({ extra_body: JSON.stringify({ safetySettings, tools: [{ googleSearch: {} }] }) });
    assert.deepEqual(b.safetySettings, safetySettings);
    assert.deepEqual(b.tools, [{ googleSearch: {} }]);
});

k.test('extra-protected', 'contents and system_instruction can never be overridden', async () => {
    const b = await send({
        system_instruction: 'Be brief.',
        extra_body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'INJECTED' }] }], system_instruction: { parts: { text: 'INJECTED' } } }),
    });
    assert.deepEqual(b.contents, CONTENTS);
    assert.equal(JSON.stringify(b.system_instruction).includes('INJECTED'), false);
});

k.test('extra-generation-config', "the user's generationConfig is merged into the managed one, which wins", async () => {
    const g = await gc({
        temperature: '0.4',
        thinking_budget: '1024',
        extra_body: JSON.stringify({ generationConfig: { stopSequences: ['END'], temperature: 1.5, thinkingConfig: { thinkingBudget: 99 } } }),
    });
    assert.deepEqual(g.stopSequences, ['END'], 'a key ThunderAI does not manage is kept');
    assert.equal(g.temperature, 0.4, 'the managed temperature wins');
    assert.deepEqual(g.thinkingConfig, { thinkingBudget: 1024, includeThoughts: true }, 'the managed thinkingConfig wins');
});

k.test('extra-generation-config-unmanaged', 'a parameter ThunderAI leaves empty is honoured from the extra body', async () => {
    assert.equal((await gc({ temperature: '', extra_body: JSON.stringify({ generationConfig: { temperature: 1.5 } }) })).temperature, 1.5);
});

k.test('extra-generation-config-not-object', 'a generationConfig that is not a plain object is not merged', async () => {
    for (const bad of [[1, 2], 'text', 3]) {
        const g = await gc({ temperature: '0.4', extra_body: JSON.stringify({ generationConfig: bad }) });
        assert.equal(Array.isArray(g), false, JSON.stringify(bad));
        assert.equal(typeof g, 'object');
        assert.equal(g.temperature, 0.4);
        assert.equal('0' in g, false, 'no array/string spread into the managed object');
    }
});

k.test('extra-invalid', 'an invalid extra body is ignored, the request is still sent', async () => {
    const b = await send({ extra_body: '{not json', temperature: '0.4' });
    assert.deepEqual(b.contents, CONTENTS);
    assert.equal(b.generationConfig.temperature, 0.4);
});

k.coverage();
