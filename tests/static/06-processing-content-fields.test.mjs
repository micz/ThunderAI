// Spec 09: every provider string option requires an explicit boundary decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    integration_options_config,
    integration_content_fields
} from '../../options/mzta-options-default.js';

function checkCoverage(options, classification) {
    assert.deepEqual(Object.keys(classification).sort(), Object.keys(options).sort());
    for (const [provider, fields] of Object.entries(options)) {
        const groups = classification[provider];
        assert.deepEqual(Object.keys(groups).sort(), ['json', 'nonContent', 'text']);
        const decisions = Object.values(groups).flat();
        for (const field of decisions) {
            assert.equal(typeof fields[field], 'string', `${provider}.${field}: unknown/non-string field`);
        }
        for (const [field, value] of Object.entries(fields)) {
            if (typeof value === 'string') {
                assert.equal(decisions.filter(name => name === field).length, 1,
                    `${provider}.${field}: missing or duplicate classification`);
            }
        }
    }
}

test('all provider string fields are classified exactly once; defaults and non-content stay explicit', () => {
    checkCoverage(integration_options_config, integration_content_fields);
});
test('a new provider string field fails coverage until a decision is declared', () => {
    const options = structuredClone(integration_options_config);
    options.ollama.new_system_text = '';
    assert.throws(() => checkCoverage(options, integration_content_fields), /missing or duplicate/);
});
test('stale, duplicate and numeric-field classifications also fail coverage', () => {
    for (const field of ['not_an_option', 'system_prompt', 'num_ctx']) {
        const groups = structuredClone(integration_content_fields);
        groups.ollama.text.push(field);
        assert.throws(() => checkCoverage(integration_options_config, groups));
    }
});
