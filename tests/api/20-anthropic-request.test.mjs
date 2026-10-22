// Spec 04 "Anthropic / Claude", "Request body construction" (js/api/anthropic.js fetchResponse):
// entirely driven by the capability table, every field opt-in.
//  - The thinking decision first: {type:'enabled', budget_tokens: N} only when
//    supportsBudgetTokens and ANTHROPIC_MIN_THINKING_BUDGET (1024) <= N < max_tokens; a budget
//    failing a constraint warns and FALLS THROUGH to the disabled/omitted logic;
//    {type:'disabled'} only where defaultThinking is 'adaptive' (and the model offers it); on
//    models that default to no thinking the field stays omitted; the fallback (unknown model)
//    never gets disabled. Opus 5 carries disabledThinkingMaxEffort; an impossible configuration
//    degrades to a valid request.
//  - temperature only with supportsSamplingParams, a value set, and thinking not active; top_p
//    and top_k the same, except that while thinking is active top_k is never sent and top_p only
//    within 0.95..1; each value dropped while thinking warns; the three are independent; a 0 is
//    sent.
//  - stop_sequences: one per line, CRLF-safe, trimmed, blanks dropped, omitted when empty.
//  - system omitted entirely when blank.
//  - output_config: {effort} whenever the level is non-empty, supportsEffort and the level is in
//    effortLevels, including 'high'; omitted for ''.
// Auth: the x-api-key and anthropic-version headers of the Messages API
// (https://docs.anthropic.com/en/api/messages); nothing in an Authorization header.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { jsonResponse } from './wire.mjs';

const { k, net, con } = areaFile('20-anthropic-request');
const { Anthropic, ANTHROPIC_MIN_THINKING_BUDGET } = await import('../../js/api/anthropic.js');

const MSG_URL = 'https://api.anthropic.com/v1/messages';
const KEY = 'sk-ant-FAKE-0000';
const MESSAGES = [{ role: 'user', content: 'Hi' }];

/** The request body sent for a configuration, and the warnings it logged. */
async function send(cfg) {
    net.expect({ method: 'POST', url: MSG_URL }, () => jsonResponse({ ok: true }));
    const r = await new Anthropic({ apiKey: KEY, version: '2023-06-01', ...cfg }).fetchResponse(MESSAGES, { maxRetries: 0 });
    assert.equal(r.status, 200);
    return net.calls.at(-1).json();
}

k.test('min-budget', 'ANTHROPIC_MIN_THINKING_BUDGET is 1024', () => {
    assert.equal(ANTHROPIC_MIN_THINKING_BUDGET, 1024);
});

k.test('url-auth', 'POST /v1/messages with x-api-key and anthropic-version, no Authorization header', async () => {
    await send({ model: 'claude-sonnet-4-5' });
    const c = net.calls[0];
    assert.equal(c.method, 'POST');
    assert.equal(c.url, MSG_URL);
    assert.equal(c.headers['x-api-key'], KEY);
    assert.equal(c.headers['anthropic-version'], '2023-06-01');
    assert.equal('authorization' in c.headers, false);
    assert.equal(c.url.includes(KEY), false, 'the key is not in the URL');
});

k.test('base-body', 'defaults on a model without adaptive thinking: model, max_tokens 4096, messages, stream - nothing else', async () => {
    assert.deepEqual(await send({ model: 'claude-sonnet-4-5', stream: true }),
        { model: 'claude-sonnet-4-5', max_tokens: 4096, messages: MESSAGES, stream: true });
});

k.test('system-blank', 'a blank system prompt is omitted, not sent empty', async () => {
    for (const system_prompt of ['', '   \n ']) {
        assert.equal('system' in await send({ model: 'claude-sonnet-4-5', system_prompt }), false, JSON.stringify(system_prompt));
    }
});

k.test('system-set', 'a system prompt is sent', async () => {
    assert.equal((await send({ model: 'claude-sonnet-4-5', system_prompt: 'Be brief.' })).system, 'Be brief.');
});

k.test('stop-sequences', 'stop_sequences: one per line, CRLF-safe, trimmed, blank lines dropped', async () => {
    assert.deepEqual((await send({ model: 'claude-sonnet-4-5', stop_sequences: 'END\r\n\r\n  STOP  \n\n###' })).stop_sequences,
        ['END', 'STOP', '###']);
});

k.test('stop-sequences-empty', 'no usable line: stop_sequences omitted', async () => {
    assert.equal('stop_sequences' in await send({ model: 'claude-sonnet-4-5', stop_sequences: ' \n\r\n ' }), false);
});

// ---- effort ---------------------------------------------------------------------------------

k.test('effort-high', "a non-empty level the model offers is sent, 'high' included", async () => {
    assert.deepEqual((await send({ model: 'claude-opus-4-6', effort: 'high' })).output_config, { effort: 'high' });
    assert.deepEqual((await send({ model: 'claude-opus-4-6', effort: 'low' })).output_config, { effort: 'low' });
});

k.test('effort-default', "the empty 'Default' level omits output_config", async () => {
    assert.equal('output_config' in await send({ model: 'claude-opus-4-6', effort: '' }), false);
});

k.test('effort-unsupported', 'a model without effort support (Haiku 4.5) gets no output_config', async () => {
    assert.equal('output_config' in await send({ model: 'claude-haiku-4-5', effort: 'high' }), false);
});

k.test('effort-not-offered', "a level outside the model's effortLevels is omitted (xhigh on Opus 4.5)", async () => {
    assert.equal('output_config' in await send({ model: 'claude-opus-4-5', effort: 'xhigh' }), false);
});

// ---- thinking -------------------------------------------------------------------------------

k.test('budget-enabled', 'a budget within 1024 <= N < max_tokens on a budget model: thinking enabled', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, max_tokens: 4096 });
    assert.deepEqual(b.thinking, { type: 'enabled', budget_tokens: 2048 });
    assert.deepEqual(con.warnings(), []);
});

k.test('budget-below-min', 'a budget below 1024 warns and is not requested', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 500 });
    assert.equal('thinking' in b, false, 'claude-sonnet-4-5 defaults to no thinking: omitted');
    assert.equal(con.warnings().length, 1);
});

k.test('budget-at-max', 'a budget not below max_tokens warns and is not requested', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 4096, max_tokens: 4096 });
    assert.equal('thinking' in b, false);
    assert.equal(con.warnings().length, 1);
});

k.test('budget-falls-through', 'a failing budget on an adaptive-default model falls through to disabled', async () => {
    const b = await send({ model: 'claude-sonnet-5', extended_thinking_budget: 500 });
    assert.deepEqual(b.thinking, { type: 'disabled' });
    assert.equal(con.warnings().length, 1);
});

k.test('disabled-adaptive', 'no budget on an adaptive-default model that offers disabled: thinking disabled', async () => {
    assert.deepEqual((await send({ model: 'claude-sonnet-5', extended_thinking_budget: 0 })).thinking, { type: 'disabled' });
});

k.test('omitted-default-none', 'no budget on a model that defaults to no thinking: field omitted', async () => {
    for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-4-8']) {
        assert.equal('thinking' in await send({ model, extended_thinking_budget: 0 }), false, model);
    }
});

k.test('omitted-cannot-disable', 'no budget on Fable 5.1 / Opus 5.5 (cannot disable): field omitted', async () => {
    for (const model of ['claude-fable-5-1', 'claude-opus-5-5']) {
        assert.equal('thinking' in await send({ model, extended_thinking_budget: 0 }), false, model);
    }
});

k.test('omitted-unknown', 'an unknown model never gets thinking disabled', async () => {
    assert.equal('thinking' in await send({ model: 'claude-future-9', extended_thinking_budget: 0 }), false);
});

k.test('opus5-effort-high', 'Opus 5 with effort high (its disabledThinkingMaxEffort): thinking disabled is sent', async () => {
    const b = await send({ model: 'claude-opus-5', extended_thinking_budget: 0, effort: 'high' });
    assert.deepEqual(b.thinking, { type: 'disabled' });
    assert.deepEqual(b.output_config, { effort: 'high' });
});

k.test('opus5-effort-max', 'Opus 5 with effort max: disabled thinking would be impossible, so it is omitted', async () => {
    const b = await send({ model: 'claude-opus-5', extended_thinking_budget: 0, effort: 'max' });
    assert.equal('thinking' in b, false);
    assert.deepEqual(b.output_config, { effort: 'max' });
});

// ---- sampling -------------------------------------------------------------------------------

k.test('sampling-independent', 'without thinking, temperature, top_p and top_k are sent independently', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', temperature: '0.5', top_p: '0.9', top_k: '40' });
    assert.equal(b.temperature, 0.5);
    assert.equal(b.top_p, 0.9);
    assert.equal(b.top_k, 40);
});

k.test('sampling-zero', 'a 0 is sent (strings keep it distinct from empty)', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', temperature: '0', top_p: '0', top_k: '0' });
    assert.equal(b.temperature, 0);
    assert.equal(b.top_p, 0);
    assert.equal(b.top_k, 0);
});

k.test('sampling-empty', "'' or unparsable: not sent", async () => {
    const b = await send({ model: 'claude-sonnet-4-5', temperature: '', top_p: 'abc', top_k: '' });
    for (const f of ['temperature', 'top_p', 'top_k']) assert.equal(f in b, false, f);
});

k.test('sampling-unsupported', 'a model that rejects sampling params never gets them', async () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-4-7', 'claude-unknown']) {
        const b = await send({ model, temperature: '0.5', top_p: '0.9', top_k: '40' });
        for (const f of ['temperature', 'top_p', 'top_k']) assert.equal(f in b, false, model + ' ' + f);
    }
});

k.test('thinking-drops-temperature', 'thinking enabled: temperature is not sent and warns', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, temperature: '0.5' });
    assert.equal('temperature' in b, false);
    assert.equal(con.warnings().length, 1);
});

k.test('thinking-drops-top-k', 'thinking enabled: top_k is never sent and warns', async () => {
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, top_k: '40' });
    assert.equal('top_k' in b, false);
    assert.equal(con.warnings().length, 1);
});

k.test('thinking-top-p-range', 'thinking enabled: top_p only within 0.95..1, otherwise dropped with a warning', async () => {
    assert.equal((await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, top_p: '0.95' })).top_p, 0.95);
    assert.equal((await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, top_p: '1' })).top_p, 1);
    assert.deepEqual(con.warnings(), []);
    const b = await send({ model: 'claude-sonnet-4-5', extended_thinking_budget: 2048, top_p: '0.9' });
    assert.equal('top_p' in b, false);
    assert.equal(con.warnings().length, 1);
});

k.test('disabled-keeps-sampling', 'thinking explicitly disabled is not active: sampling params are sent', async () => {
    // claude-sonnet-4-6 accepts sampling and defaults to no thinking; with a failing budget the
    // field is omitted (not adaptive), so thinking is not active.
    const b = await send({ model: 'claude-sonnet-4-6', extended_thinking_budget: 100, temperature: '0.3', top_k: '5' });
    assert.equal(b.temperature, 0.3);
    assert.equal(b.top_k, 5);
});

k.coverage();
