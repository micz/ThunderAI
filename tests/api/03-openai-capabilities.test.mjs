// Spec 04 "OpenAI API (chatgpt_api)", "Capability table" (js/api/openai_model_capabilities.js):
// getOpenAIModelCapabilities(modelId) matches by model ID PREFIX (dated and sized variants such as
// o3-2025-04-16 and gpt-5-mini resolve to their family, longest prefix first) and returns
// {supportsSamplingParams, supportsReasoning, supportsVerbosity}. The reasoning models (gpt-5, o1,
// o3, o4) reject temperature and top_p; the chat models (gpt-4, chatgpt-4o, gpt-3.5) reject
// reasoning and text.verbosity; text.verbosity only in the gpt-5 family. An unknown ID falls back
// to OPENAI_PERMISSIVE_CAPABILITIES, which allows everything.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';

const { k } = areaFile('03-openai-capabilities');
const {
    getOpenAIModelCapabilities: caps,
    OPENAI_PERMISSIVE_CAPABILITIES: PERMISSIVE,
} = await import('../../js/api/openai_model_capabilities.js');

const REASONING_GPT5 = { supportsSamplingParams: false, supportsReasoning: true, supportsVerbosity: true };
const REASONING_O = { supportsSamplingParams: false, supportsReasoning: true, supportsVerbosity: false };
const CHAT = { supportsSamplingParams: true, supportsReasoning: false, supportsVerbosity: false };

k.test('permissive', 'the fallback allows everything', () => {
    assert.deepEqual(PERMISSIVE, { supportsSamplingParams: true, supportsReasoning: true, supportsVerbosity: true });
});

k.test('gpt5-family', 'gpt-5 and its sized/dated variants: no sampling, reasoning, verbosity', () => {
    for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07']) assert.deepEqual(caps(id), REASONING_GPT5, id);
});

k.test('o-series', 'o1, o3, o4 and their variants: no sampling, reasoning, no verbosity', () => {
    for (const id of ['o1', 'o1-pro', 'o3', 'o3-mini', 'o3-2025-04-16', 'o4-mini']) assert.deepEqual(caps(id), REASONING_O, id);
});

k.test('chat-models', 'gpt-4*, chatgpt-4o*, gpt-3.5*: sampling, no reasoning, no verbosity', () => {
    for (const id of ['gpt-4', 'gpt-4o', 'gpt-4.1-nano', 'gpt-4o-mini-2024-07-18', 'chatgpt-4o-latest', 'gpt-3.5-turbo']) {
        assert.deepEqual(caps(id), CHAT, id);
    }
});

for (const id of ['', '  ', undefined, null, 'my-finetune', 'codex-mini-latest']) {
    k.test('unknown-' + (String(id).trim().replace(/[^a-z0-9]+/g, '-') || (id === '' ? 'empty' : 'blank')),
        `${JSON.stringify(id)} falls back to the permissive capabilities`, () => {
            assert.deepEqual(caps(id), PERMISSIVE);
        });
}

k.coverage();
