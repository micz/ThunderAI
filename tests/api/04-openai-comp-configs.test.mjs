// Spec 04 "OpenAI-Compatible (openai_comp_api)" and "Extra body data": the pre-configured
// providers of js/api/openai_comp_configs.js are custom, DeepSeek, Grok, Mistral, OpenRouter and
// Perplexity, `custom` being the default/manual entry. The presets carry only id, name,
// chat_name, host, use_v1: there is deliberately no per-preset extra body data.
//
// The module calls browser.i18n.getMessage() while building its module-level array, so this file
// installs the core browser mock BEFORE importing it (it is not a worker file: the list is used by
// the settings pages).

import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import { areaFile } from './harness.mjs';

installBrowserMock({ policy: null });
const { k } = areaFile('04-openai-comp-configs');
const { openAICompConfigs } = await import('../../js/api/openai_comp_configs.js');

k.test('ids', 'the presets are custom, DeepSeek, Grok, Mistral, OpenRouter and Perplexity', () => {
    assert.deepEqual(openAICompConfigs.map(c => c.id).sort(), ['custom', 'deepseek', 'grok', 'mistral', 'openrouter', 'perplexity']);
});

k.test('fields', 'each preset carries exactly id, name, chat_name, host, use_v1 (no extra body data)', () => {
    for (const c of openAICompConfigs) {
        assert.deepEqual(Object.keys(c).sort(), ['chat_name', 'host', 'id', 'name', 'use_v1'], c.id);
        assert.equal(typeof c.use_v1, 'boolean', c.id);
    }
});

k.test('custom-manual', 'custom is the manual entry: no host, a localized name', () => {
    const custom = openAICompConfigs.find(c => c.id === 'custom');
    assert.equal(custom.host, '');
    assert.equal(custom.name, browser.i18n.getMessage('Custom'));
    assert.notEqual(custom.name, '');
});

k.coverage();
