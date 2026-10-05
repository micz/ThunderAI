// Spec 04 "Per-provider support": supportsUsageData(connection_type) in js/mzta-utils.js answers
// the same question as the modules' supportsUsageData flag, by connection type, and the two must
// stay in agreement. ChatGPT Web (and any non-API web integration) is false.
//
// js/mzta-utils.js needs the WebExtension mock (it reads preferences), so this is a background
// context with no policy; it is not a worker file.

import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/api.mjs';

const ctx = await startBackground({ policy: null });
const k = caseTests('06-usage-support-by-type');

const BY_TYPE = {
    chatgpt_api: 'openai_responses',
    anthropic_api: 'anthropic',
    google_gemini_api: 'google_gemini',
    ollama_api: 'ollama',
    openai_comp_api: 'openai_comp',
};

k.test('agrees', 'each API connection type agrees with its module flag', async () => {
    for (const [type, file] of Object.entries(BY_TYPE)) {
        const mod = await import('../../js/api/' + file + '.js');
        assert.equal(ctx.utils.supportsUsageData(type), mod.supportsUsageData, type);
        assert.equal(ctx.utils.supportsUsageData(type), true, type);
    }
});

k.test('web-false', 'chatgpt_web, the empty connection and an unknown type are false', () => {
    assert.equal(ctx.utils.supportsUsageData('chatgpt_web'), false);
    assert.equal(ctx.utils.supportsUsageData(''), false);
    assert.equal(ctx.utils.supportsUsageData('something_else'), false);
});

k.coverage();
