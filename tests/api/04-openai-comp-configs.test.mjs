// Spec 04 "OpenAI-Compatible (openai_comp_api)" and "Extra body data": the pre-configured
// providers of js/api/openai_comp_configs.js are custom, DeepSeek, Grok, Mistral, OpenRouter and
// Perplexity, `custom` being the default/manual entry. The presets carry id, name, chat_name,
// host, use_v1, and optionally `defaults`: suggested values of openai_comp option keys (Mistral:
// chat_models_only on, #1044). There is deliberately no per-preset extra body data.
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

k.test('fields', 'each preset carries id, name, chat_name, host, use_v1 and optionally defaults (no extra body data)', () => {
    for (const c of openAICompConfigs) {
        assert.deepEqual(Object.keys(c).filter(key => key !== 'defaults').sort(), ['chat_name', 'host', 'id', 'name', 'use_v1'], c.id);
        assert.equal(typeof c.use_v1, 'boolean', c.id);
    }
});

k.test('defaults-keys', 'a preset default names an openai_comp option, with a value of its type; never extra_body', async () => {
    const { integration_options_config } = await import('../../options/mzta-options-default.js');
    const options = integration_options_config.openai_comp;
    for (const c of openAICompConfigs.filter(c => c.defaults !== undefined)) {
        for (const [key, value] of Object.entries(c.defaults)) {
            assert.ok(Object.hasOwn(options, key), c.id + ': ' + key + ' is not an openai_comp option');
            assert.equal(typeof value, typeof options[key], c.id + '.' + key);
            assert.notEqual(key, 'extra_body', c.id);
        }
    }
});

k.test('mistral-defaults', 'Mistral: "Show only chat models" on, the reasoning effort not set', () => {
    const mistral = openAICompConfigs.find(c => c.id === 'mistral');
    assert.deepEqual(mistral.defaults, { chat_models_only: true });
});

k.test('custom-manual', 'custom is the manual entry: no host, a localized name', () => {
    const custom = openAICompConfigs.find(c => c.id === 'custom');
    assert.equal(custom.host, '');
    assert.equal(custom.name, browser.i18n.getMessage('Custom'));
    assert.notEqual(custom.name, '');
});

k.coverage();
