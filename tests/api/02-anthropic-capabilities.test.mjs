// Spec 04 "Anthropic / Claude", "Capability table" (js/api/anthropic_model_capabilities.js):
// getAnthropicModelCapabilities(modelId) returns {thinkingModes, supportsBudgetTokens,
// supportsSamplingParams, supportsEffort, effortLevels, defaultThinking}, plus
// disabledThinkingMaxEffort on the one model that needs it (Opus 5). Matching is boundary-aware:
// the exact ID or its dated snapshot <prefix>-YYYYMMDD, nothing else - a point release is not
// covered by its predecessor and every point release has its own entry (claude-opus-5-5,
// claude-fable-5-1, claude-mythos-5-1); -latest and other suffixes fall back. An unknown ID falls
// back to ANTHROPIC_MODERN_CAPABILITIES, the modern contract, whose thinkingModes is ['adaptive']
// only. And, from the request rules: the models that accept temperature at all are Haiku 4.5,
// Sonnet/Opus 4.5, Sonnet/Opus 4.6; newer ones (Fable 5.x, Opus 5.5) reject thinking disabled.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';

const { k } = areaFile('02-anthropic-capabilities');
const {
    getAnthropicModelCapabilities: caps,
    ANTHROPIC_MODERN_CAPABILITIES: MODERN,
    ANTHROPIC_DEFAULT_EFFORT,
} = await import('../../js/api/anthropic_model_capabilities.js');

const KEYS = ['defaultThinking', 'effortLevels', 'supportsBudgetTokens', 'supportsEffort', 'supportsSamplingParams', 'thinkingModes'];

k.test('fallback-shape', 'the fallback is the modern contract: adaptive thinking only, no budget_tokens, no sampling params', () => {
    assert.deepEqual(Object.keys(MODERN).sort(), KEYS);
    assert.deepEqual(MODERN.thinkingModes, ['adaptive']);
    assert.equal(MODERN.supportsBudgetTokens, false);
    assert.equal(MODERN.supportsSamplingParams, false);
});

for (const id of ['', '   ', undefined, null, 'gpt-4o', 'claude-unknown-9', 'claude-sonnet-4-5-latest', 'claude-opus-5-6', 'claude-opus-4-6-1']) {
    k.test('falls-back-' + (String(id).trim().replace(/[^a-z0-9]+/g, '-') || 'empty').replace(/^-|-$/g, '') + (id === '   ' ? '-blank' : ''),
        `${JSON.stringify(id)} falls back to ANTHROPIC_MODERN_CAPABILITIES`, () => {
            assert.deepEqual(caps(id), MODERN);
        });
}

k.test('dated-snapshot', 'a dated snapshot <prefix>-YYYYMMDD matches its entry', () => {
    assert.deepEqual(caps('claude-sonnet-4-5-20250929'), caps('claude-sonnet-4-5'));
    assert.deepEqual(caps('claude-opus-5-5-20260101'), caps('claude-opus-5-5'));
    assert.notDeepEqual(caps('claude-sonnet-4-5'), MODERN, 'claude-sonnet-4-5 has an entry of its own');
});

k.test('not-a-snapshot', 'a suffix that is not exactly -YYYYMMDD does not match', () => {
    assert.deepEqual(caps('claude-sonnet-4-5-2025092'), MODERN);
    assert.deepEqual(caps('claude-sonnet-4-5-202509290'), MODERN);
    assert.deepEqual(caps('claude-sonnet-4-5x'), MODERN);
});

k.test('point-release-own-entry', 'claude-opus-5 does not cover claude-opus-5-5: each point release has its own entry', () => {
    const opus5 = caps('claude-opus-5');
    const opus55 = caps('claude-opus-5-5');
    assert.notDeepEqual(opus5, MODERN);
    assert.ok('disabledThinkingMaxEffort' in opus5);
    assert.equal('disabledThinkingMaxEffort' in opus55, false, 'claude-opus-5-5 is not claude-opus-5');
    for (const id of ['claude-fable-5-1', 'claude-mythos-5-1']) {
        // An own entry is reached by the exact ID, and its dated snapshot gives the same.
        assert.deepEqual(caps(id + '-20260101'), caps(id), id);
    }
});

k.test('opus5-max-effort', 'disabledThinkingMaxEffort is on claude-opus-5 only', () => {
    for (const id of ['claude-opus-5', 'claude-opus-5-20260101']) {
        assert.deepEqual(Object.keys(caps(id)).sort(), [...KEYS, 'disabledThinkingMaxEffort'].sort(), id);
    }
    for (const id of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-opus-4-6',
        'claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1']) {
        assert.deepEqual(Object.keys(caps(id)).sort(), KEYS, id);
    }
});

k.test('sampling-models', 'Haiku 4.5, Sonnet/Opus 4.5 and Sonnet/Opus 4.6 accept the sampling params', () => {
    for (const id of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6']) {
        assert.equal(caps(id).supportsSamplingParams, true, id);
    }
});

k.test('cannot-disable', 'Fable 5.x and Opus 5.5 do not offer thinking disabled', () => {
    for (const id of ['claude-fable-5', 'claude-fable-5-1', 'claude-opus-5-5']) {
        assert.equal(caps(id).thinkingModes.includes('disabled'), false, id);
    }
});

k.test('default-effort', 'ANTHROPIC_DEFAULT_EFFORT is high', () => {
    assert.equal(ANTHROPIC_DEFAULT_EFFORT, 'high');
});

k.coverage();
