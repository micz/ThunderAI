// Spec 04 "Token usage data" and "Per-provider support": js/api/mzta-api-usage.js normalizes the
// usage every provider reports into {provider, model, input_tokens, output_tokens, total_tokens,
// cached_input_tokens, cache_creation_tokens, reasoning_tokens, tokens_per_second}. null means
// "not exposed", 0 means "reported zero", never interchanged. createUsageData() computes the
// total only when input and output are both numbers and no total was reported;
// isUsageDataEmpty(); mergeUsageData(a, b) with b's non-null values winning and the total
// recomputed, a side's total counting as reported only when it differs from its own
// input + output. Subset invariant: cached/cache_creation are part of input, reasoning part of
// output. Each API module exports supportsUsageData and extractUsage(raw), which never throws,
// and populates exactly the columns of the per-provider table. All worker-safe: no browser here.
//
// Inputs: the captured streams (captured/*.txt) where they exist, else the documented ones of
// tests/fixtures/api/*.json. Every expected number below is computed by hand from those inputs
// and the spec rules quoted with it.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';
import {
    apiFixture,
    capturedLines
} from './wire.mjs';

assertNoBrowser();
const { k } = areaFile('05-usage-data');
const usage = await import('../../js/api/mzta-api-usage.js');
const { createUsageData, isUsageDataEmpty, mergeUsageData } = usage;
const MODULES = {
    openai_responses: await import('../../js/api/openai_responses.js'),
    anthropic: await import('../../js/api/anthropic.js'),
    google_gemini: await import('../../js/api/google_gemini.js'),
    ollama: await import('../../js/api/ollama.js'),
    openai_comp: await import('../../js/api/openai_comp.js'),
};

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'cache_creation_tokens',
    'reasoning_tokens', 'tokens_per_second'];

/** The token fields of a usage object (provider and model left out: their values are not specified). */
const tokens = u => Object.fromEntries(TOKEN_FIELDS.map(f => [f, u[f]]));

// ---- createUsageData / isUsageDataEmpty -----------------------------------------------------

k.test('create-absent-null', 'every absent metric defaults to null, never 0', () => {
    const u = createUsageData({});
    for (const f of TOKEN_FIELDS) assert.equal(u[f], null, f);
    assert.equal(u.model, null);
    assert.deepEqual(Object.keys(createUsageData({ input_tokens: 1 })).sort(),
        ['provider', 'model', ...TOKEN_FIELDS].sort(), 'the normalized shape');
});

k.test('create-zero-kept', 'a reported 0 stays 0', () => {
    const u = createUsageData({ input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_tokens: 0 });
    assert.equal(u.cached_input_tokens, 0);
    assert.equal(u.reasoning_tokens, 0);
    assert.equal(u.total_tokens, 0, 'both are numbers and no total was reported: 0 + 0');
});

k.test('create-total-computed', 'the total is input + output only when both are numbers and none was reported', () => {
    assert.equal(createUsageData({ input_tokens: 10, output_tokens: 5 }).total_tokens, 15);
    assert.equal(createUsageData({ input_tokens: 10 }).total_tokens, null, 'a partial sum would be a lie');
    assert.equal(createUsageData({ output_tokens: 5 }).total_tokens, null);
    assert.equal(createUsageData({ input_tokens: 10, output_tokens: 5, total_tokens: 20 }).total_tokens, 20, 'a reported total is kept');
});

k.test('empty', 'isUsageDataEmpty: no object, or every numeric field null', () => {
    assert.equal(isUsageDataEmpty(null), true);
    assert.equal(isUsageDataEmpty(undefined), true);
    assert.equal(isUsageDataEmpty(createUsageData({ provider: 'x', model: 'm' })), true, 'provider and model only');
    assert.equal(isUsageDataEmpty(createUsageData({ cached_input_tokens: 0 })), false, 'a reported 0 is something');
    assert.equal(isUsageDataEmpty(createUsageData({ tokens_per_second: 12.5 })), false);
});

// ---- mergeUsageData -------------------------------------------------------------------------

k.test('merge-anthropic-halves', 'the message_start placeholder output 1 does not freeze the total', () => {
    // message_start: input 25 + cache read 3000 + cache creation 1200 = 4225, output 1 (placeholder).
    const start = createUsageData({ input_tokens: 4225, output_tokens: 1, cached_input_tokens: 3000, cache_creation_tokens: 1200 });
    const delta = createUsageData({ output_tokens: 15 });
    const m = mergeUsageData(start, delta);
    assert.deepEqual(tokens(m), {
        input_tokens: 4225, output_tokens: 15, total_tokens: 4240,
        cached_input_tokens: 3000, cache_creation_tokens: 1200, reasoning_tokens: null, tokens_per_second: null,
    });
});

k.test('merge-b-wins', "b's non-null values win, a's survive where b has null", () => {
    const m = mergeUsageData(createUsageData({ input_tokens: 10, cached_input_tokens: 5, reasoning_tokens: 2 }),
        createUsageData({ cached_input_tokens: 7, reasoning_tokens: null }));
    assert.equal(m.cached_input_tokens, 7);
    assert.equal(m.reasoning_tokens, 2);
    assert.equal(m.input_tokens, 10);
});

k.test('merge-zero-wins', "b's reported 0 wins over a's number (0 is not null)", () => {
    const m = mergeUsageData(createUsageData({ cached_input_tokens: 5 }), createUsageData({ cached_input_tokens: 0 }));
    assert.equal(m.cached_input_tokens, 0);
});

k.test('merge-reported-total', 'a total that differs from its own input + output is a reported one and is kept', () => {
    const m = mergeUsageData(createUsageData({ input_tokens: 10, output_tokens: 5, total_tokens: 100 }), createUsageData({ output_tokens: 6 }));
    assert.equal(m.total_tokens, 100);
});

k.test('merge-recomputed-total', 'a total equal to its own input + output is recomputed from the merged pair', () => {
    const m = mergeUsageData(createUsageData({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }), createUsageData({ output_tokens: 6 }));
    assert.equal(m.total_tokens, 16);
});

k.test('merge-nulls', 'merging with null keeps the other side; both null gives null', () => {
    assert.equal(mergeUsageData(null, null), null);
    assert.deepEqual(tokens(mergeUsageData(null, createUsageData({ input_tokens: 3, output_tokens: 4 }))),
        tokens(createUsageData({ input_tokens: 3, output_tokens: 4 })));
    assert.deepEqual(tokens(mergeUsageData(createUsageData({ input_tokens: 3 }), null)), tokens(createUsageData({ input_tokens: 3 })));
});

// ---- per-provider support -------------------------------------------------------------------

k.test('supports-flag', 'every API module exports supportsUsageData = true and an extractUsage()', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
        assert.equal(mod.supportsUsageData, true, name);
        assert.equal(typeof mod.extractUsage, 'function', name);
    }
});

k.test('openai-responses-completed', 'openai_responses: response.completed (captured) - input, output, total, cached, reasoning; a reported 0 stays 0', () => {
    const completed = capturedLines('openai-responses-stream.txt').map(l => JSON.parse(l)).find(e => e.type === 'response.completed');
    assert.deepEqual(tokens(MODULES.openai_responses.extractUsage(completed)), {
        input_tokens: 333, output_tokens: 37, total_tokens: 370,
        cached_input_tokens: 0, cache_creation_tokens: null, reasoning_tokens: 0, tokens_per_second: null,
    });
});

k.test('openai-responses-body', 'openai_responses: a plain response body is accepted too', () => {
    const body = apiFixture('openai_responses.json').reasoning_stream.events.at(-1).response;
    assert.deepEqual(tokens(MODULES.openai_responses.extractUsage(body)), {
        input_tokens: 20, output_tokens: 120, total_tokens: 140,
        cached_input_tokens: 8, cache_creation_tokens: null, reasoning_tokens: 100, tokens_per_second: null,
    });
});

k.test('openai-responses-not-before-completed', 'openai_responses: the events before response.completed carry no usage', () => {
    const created = capturedLines('openai-responses-stream.txt').map(l => JSON.parse(l)).find(e => e.type === 'response.created');
    assert.equal(MODULES.openai_responses.extractUsage(created), null);
});

k.test('anthropic-start', 'anthropic: message_start - input includes both cache counters, which are reported too', () => {
    const start = apiFixture('anthropic.json').stream_text.events[0].data;
    const u = MODULES.anthropic.extractUsage(start);
    assert.equal(u.input_tokens, 25 + 3000 + 1200);
    assert.equal(u.cached_input_tokens, 3000);
    assert.equal(u.cache_creation_tokens, 1200);
    assert.equal(u.reasoning_tokens, null);
    assert.equal(u.tokens_per_second, null);
});

k.test('anthropic-delta', 'anthropic: message_delta - the output tokens only', () => {
    const delta = apiFixture('anthropic.json').stream_text.events.find(e => e.event === 'message_delta').data;
    const u = MODULES.anthropic.extractUsage(delta);
    assert.equal(u.output_tokens, 15);
    assert.equal(u.input_tokens, null);
});

k.test('anthropic-stream-merged', 'anthropic: the two halves merged give the table columns, total computed', () => {
    const events = apiFixture('anthropic.json').stream_text.events.map(e => e.data);
    let acc = null;
    for (const ev of events) {
        const u = MODULES.anthropic.extractUsage(ev);
        if (u !== null) acc = mergeUsageData(acc, u);
    }
    assert.deepEqual(tokens(acc), {
        input_tokens: 4225, output_tokens: 15, total_tokens: 4240,
        cached_input_tokens: 3000, cache_creation_tokens: 1200, reasoning_tokens: null, tokens_per_second: null,
    });
});

k.test('anthropic-no-usage-event', 'anthropic: an event without usage gives null', () => {
    const ev = apiFixture('anthropic.json').stream_text.events.find(e => e.event === 'content_block_delta').data;
    assert.equal(MODULES.anthropic.extractUsage(ev), null);
});

k.test('gemini-captured', 'google_gemini: the last captured chunk - output = candidates + thoughts, cached not reported', () => {
    const lines = capturedLines('gemini-503-retry-then-stream.txt').map(l => JSON.parse(l));
    // 39 candidates + 597 thoughts.
    assert.deepEqual(tokens(MODULES.google_gemini.extractUsage(lines.at(-1))), {
        input_tokens: 321, output_tokens: 636, total_tokens: 957,
        cached_input_tokens: null, cache_creation_tokens: null, reasoning_tokens: 597, tokens_per_second: null,
    });
});

k.test('gemini-cached', 'google_gemini: cachedContentTokenCount is reported as cached input (already part of the prompt count)', () => {
    const last = apiFixture('google_gemini.json').stream_thoughts.chunks.at(-1);
    assert.deepEqual(tokens(MODULES.google_gemini.extractUsage(last)), {
        input_tokens: 12, output_tokens: 3 + 36, total_tokens: 51,
        cached_input_tokens: 4, cache_creation_tokens: null, reasoning_tokens: 36, tokens_per_second: null,
    });
});

k.test('gemini-no-candidates', 'google_gemini: usageMetadata on a chunk without candidates is read', () => {
    const u = MODULES.google_gemini.extractUsage(apiFixture('google_gemini.json').usage_only_chunk.chunk);
    assert.equal(u.input_tokens, 12);
    assert.equal(u.output_tokens, 5 + 43);
});

k.test('ollama-captured', 'ollama: the captured final chunk - total computed, no duration so tokens_per_second null', () => {
    const last = JSON.parse(capturedLines('ollama-thinking-stream.txt').at(-1));
    assert.deepEqual(tokens(MODULES.ollama.extractUsage(last)), {
        input_tokens: 359, output_tokens: 389, total_tokens: 748,
        cached_input_tokens: null, cache_creation_tokens: null, reasoning_tokens: null, tokens_per_second: null,
    });
});

k.test('ollama-rate', 'ollama: tokens_per_second = eval_count / (eval_duration / 1e9), one decimal', () => {
    // 282 / 4.535599 s = 62.17... -> 62.2
    const u = MODULES.ollama.extractUsage(apiFixture('ollama.json').final_chunk_with_durations.chunk);
    assert.equal(u.tokens_per_second, 62.2);
    assert.equal(u.input_tokens, 26);
    assert.equal(u.output_tokens, 282);
    assert.equal(u.total_tokens, 308);
});

k.test('ollama-zero-duration', 'ollama: a zero duration yields null, never Infinity or NaN', () => {
    const chunk = { ...apiFixture('ollama.json').final_chunk_with_durations.chunk, eval_duration: 0 };
    assert.equal(MODULES.ollama.extractUsage(chunk).tokens_per_second, null);
});

k.test('ollama-not-final', 'ollama: a chunk that is not done carries no usage', () => {
    assert.equal(MODULES.ollama.extractUsage(JSON.parse(capturedLines('ollama-thinking-stream.txt')[0])), null);
});

k.test('openai-comp-usage-frame', 'openai_comp: the usage frame (empty choices) - input, output, total, cached, reasoning', () => {
    const frame = apiFixture('openai_comp.json').deepseek_reasoner_stream.chunks.at(-1);
    assert.deepEqual(tokens(MODULES.openai_comp.extractUsage(frame)), {
        input_tokens: 13, output_tokens: 200, total_tokens: 213,
        cached_input_tokens: 0, cache_creation_tokens: null, reasoning_tokens: 150, tokens_per_second: null,
    });
});

k.test('openai-comp-best-effort', 'openai_comp: details not sent stay null; a server sending no usage gives null', () => {
    const last = apiFixture('openai_comp.json').openrouter_stream.chunks.at(-1);
    const u = MODULES.openai_comp.extractUsage(last);
    assert.equal(u.input_tokens, 10);
    assert.equal(u.cached_input_tokens, null);
    assert.equal(u.reasoning_tokens, null);
    for (const chunk of apiFixture('openai_comp.json').plain_stream_no_usage.chunks) {
        assert.equal(MODULES.openai_comp.extractUsage(chunk), null);
    }
});

const HOSTILE = [null, undefined, 'text', 42, [], { usage: 'x' }, { usageMetadata: 7 }, { message: { usage: [] } },
    { response: { usage: null } }, { done: true, eval_count: 'many', eval_duration: {} }];

k.test('never-throws', 'extractUsage() never throws, whatever the payload', () => {
    const trap = new Proxy({}, { get() { throw new Error('trap'); } });
    for (const [name, mod] of Object.entries(MODULES)) {
        for (const raw of [...HOSTILE, trap, { usage: trap }, { usageMetadata: trap }, { message: trap }, { response: trap }]) {
            let out;
            assert.doesNotThrow(() => { out = mod.extractUsage(raw); }, name);
            assert.ok(out === null || typeof out === 'object', name);
        }
    }
});

k.coverage();
