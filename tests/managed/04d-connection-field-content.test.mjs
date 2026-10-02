// Spec 08 "Validation": the content rules of the connection fields added in 5.1.0, for a global
// {integration}_{key} preference and for a field of _special_prompts_connection alike (both go
// through connectionFieldProblem()):
//  - top_p: '' or a number from 0 to 1; top_k: '' or a non-negative integer;
//  - the fixed selects (chatgpt verbosity, text_format, truncation, service_tier): one of their
//    options; ollama_think, whose options depend on the model: '', 'false', 'true' or any
//    lowercase word;
//  - text_format_schema and ollama extra_options: '' or a JSON object, like extra_body;
//  - ollama keep_alive: '', a whole number of seconds or a Go duration;
//  - chatgpt max_output_tokens: 0 (not set) or at least 16.
// And the one documented exception to "never coerced": a boolean ollama_think (its format
// before 5.1.0) is read as 'true' / 'false', with a warning.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const ACCEPTED = {
    chatgpt_top_p: '0.9',
    google_gemini_top_p: '',
    anthropic_top_k: '40',
    chatgpt_verbosity: 'low',
    chatgpt_text_format: 'json_schema',
    chatgpt_truncation: 'auto',
    chatgpt_service_tier: 'flex',
    chatgpt_text_format_schema: '{"type": "object"}',
    chatgpt_max_output_tokens: 16,
    ollama_extra_options: '{"top_k": 20}',
    ollama_keep_alive: '1h30m',
};
const REJECTED = {
    anthropic_top_p: '1.5',
    google_gemini_top_k: '-3',
    chatgpt_verbosity: 'loud',
    chatgpt_truncation: 'sometimes',
    chatgpt_service_tier: 'turbo',
    chatgpt_text_format_schema: '{not json',
    chatgpt_max_output_tokens: 8,
    ollama_extra_options: '[1, 2]',
    ollama_keep_alive: 'forever',
    ollama_think: 'High',
};

let ctx;

before(async () => {
    ctx = await startBackground({ policy: { ...ACCEPTED, ollama_think: true } });
});

test('valid values of the 5.1.0 connection fields are applied unchanged', () => {
    for (const [key, value] of Object.entries(ACCEPTED)) {
        assert.equal(ctx.mztaManaged.hasManagedValue(key), true, key + ' was refused');
        assert.deepEqual(ctx.mztaManaged.getManagedValue(key), value, key);
    }
});

test('a boolean ollama_think (the format before 5.1.0) is read as a level, with a warning', () => {
    assert.equal(ctx.mztaManaged.getManagedValue('ollama_think'), 'true');
    assert.equal(ctx.mztaManaged.isManagedLocked('ollama_think'), true);
    assert.ok(ctx.con.warnings().some(w =>
        /"ollama_think" is true, the format before 5\.1\.0: read as "true"/.test(w)));
});

test('ollama_think accepts a level only some model reports', async () => {
    const r = await restart({ policy: { ollama_think: 'xhigh' } }, 'managedKeys', ['ollama_think']);
    assert.deepEqual(r.result.ollama_think, { managed: true, value: 'xhigh', locked: true });
});

test('a value that fails their content rule is not applied, and is warned about', async () => {
    const keys = Object.keys(REJECTED);
    const r = await restart({ policy: REJECTED }, 'managedKeys', keys);
    for (const key of keys) {
        assert.equal(r.result[key].managed, false, key + ' was applied');
        assert.ok(r.warnings.some(w => w.includes('"' + key + '"') && w.includes('ignored')),
            'no warning for ' + key);
    }
});

test('the same rules apply to a _special_prompts_connection field', async () => {
    const r = await restart({ policy: {
        _special_prompts_connection: {
            summarize: { api_type: 'ollama_api', ollama_host: 'http://ollama.example.org:11434',
                ollama_think: false, ollama_keep_alive: 'forever' },
            translate: { api_type: 'chatgpt_api', chatgpt_verbosity: 'high', chatgpt_top_p: '2' },
        },
    } }, 'specialPrompts');
    const byId = id => r.result.find(p => p.id === id);
    const sum = byId('prompt_summarize');
    assert.equal(sum.ollama_think, 'false');
    assert.notEqual(sum.ollama_keep_alive, 'forever', 'invalid keep_alive applied');
    assert.ok(r.warnings.some(w => /\["ollama_think"\] is false, the format before 5\.1\.0: read as "false"/.test(w)));
    assert.ok(r.warnings.some(w => /\["ollama_keep_alive"\] must be empty, a number of seconds or a duration/.test(w)));

    const tr = byId('prompt_translate_this');
    assert.equal(tr.chatgpt_verbosity, 'high');
    assert.notEqual(tr.chatgpt_top_p, '2', 'invalid top_p applied');
    assert.ok(r.warnings.some(w => /\["chatgpt_top_p"\] must be empty or a number from 0 to 1/.test(w)));
});
