// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Validation" and
// "Lock semantics":
//  - the key of an entry must be a feature of special_prompts_with_integration;
//  - api_type is required, and must be a connection type the feature's panel offers - an API
//    connection, never chatgpt_web - or the whole feature entry is skipped;
//  - every other field is `${integration}_${key}` for the entry's api_type, of the type of its
//    integration_options_config default, with the content rules (http(s) host, non-empty model,
//    numeric ranges, JSON object extra body); an invalid field is skipped on its own;
//  - "api_type:locked": false is ignored (always enforced); "<field>:locked" must be a boolean
//    (otherwise ignored, the field stays enforced) and have a valid field to act on;
//  - "_special_prompts_connection:locked" is ignored;
//  - every problem is a taLogger.warn(), and the rest of the policy still applies.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('special-prompts-connection-invalid.json');

let ctx;

before(async () => {
    ctx = await startBackground({ policy: POLICY });
});

const warned = re => ctx.con.warnings().some(w => re.test(w));

test('only the entries with a valid api_type survive', () => {
    assert.deepEqual(Object.keys(ctx.mztaManaged.getSpecialPromptsConnection()).sort(),
        ['get_calendar_event', 'summarize']);
});

test('an unknown feature is skipped with a warning', () => {
    assert.ok(warned(/"not_a_feature"\] is not a feature with a specific integration, skipped/));
});

test('chatgpt_web is not a connection a feature panel offers: the entry is skipped', () => {
    assert.ok(warned(/"spamfilter"\] has an invalid "api_type" \("chatgpt_web"\), the whole feature entry is skipped/));
    assert.equal(ctx.mztaManaged.hasManagedValue('spamfilter_connection_type'), false);
});

test('a missing, unknown or non-object entry is skipped', () => {
    assert.ok(warned(/"translate"\] has no "api_type", the whole feature entry is skipped/));
    assert.ok(warned(/"get_task"\] has an invalid "api_type" \("bogus_api"\)/));
    assert.ok(warned(/"add_tags"\] must be an object, skipped/));
});

test('a skipped entry implies no preference', () => {
    for (const prefix of ['spamfilter', 'translate', 'get_task', 'add_tags']) {
        assert.equal(ctx.mztaManaged.hasManagedValue(prefix + '_use_specific_integration'), false, prefix);
        assert.equal(ctx.mztaManaged.hasManagedValue(prefix + '_connection_type'), false, prefix);
    }
});

test('"api_type:locked": false is ignored: the connection type stays enforced', () => {
    assert.ok(warned(/"summarize"\]\["api_type:locked"\] is not supported, ignored/));
    assert.equal(ctx.mztaManaged.getSpecialPromptConnection('summarize').api_type, 'openai_comp_api');
    assert.equal(ctx.mztaManaged.isManagedLocked('summarize_connection_type'), true);
});

test('invalid fields are skipped one by one, valid ones kept', () => {
    const fields = ctx.mztaManaged.getSpecialPromptConnection('summarize').fields;
    assert.deepEqual(Object.keys(fields), ['openai_comp_chat_name']);
    assert.ok(warned(/"openai_comp_host"\] must be an http:\/\/ or https:\/\/ URL, skipped/));
    assert.ok(warned(/"openai_comp_model"\] must not be empty, skipped/));
    assert.ok(warned(/"openai_comp_api_key"\] must be of type string, got number, skipped/));
    assert.ok(warned(/"openai_comp_temperature"\] must be empty or a number not below 0, skipped/));
    assert.ok(warned(/"openai_comp_use_v1"\] must be of type boolean, got string, skipped/));
    assert.ok(warned(/"openai_comp_extra_body"\] must be a JSON object, skipped/));
});

test('a field of another provider is named as such; an unknown one as unknown', () => {
    assert.ok(warned(/"ollama_model"\] belongs to the "ollama" connection, not to "openai_comp_api", skipped/));
    assert.ok(warned(/"made_up_field"\] is not a connection field, skipped/));
});

test('a non-boolean ":locked" is ignored and the field stays enforced', () => {
    assert.ok(warned(/\["openai_comp_chat_name:locked"\] must be true or false, ignored/));
    assert.deepEqual(ctx.mztaManaged.getSpecialPromptConnection('summarize').fields.openai_comp_chat_name,
        { value: 'Gateway', locked: true });
});

test('a ":locked" whose field was rejected has nothing to act on', () => {
    assert.ok(warned(/\["openai_comp_model:locked"\] has no valid value for "openai_comp_model", ignored/));
});

test('numeric ranges: max_tokens >= 1, integer budgets', () => {
    const fields = ctx.mztaManaged.getSpecialPromptConnection('get_calendar_event').fields;
    assert.ok(warned(/"anthropic_max_tokens"\] must be at least 1, skipped/));
    assert.ok(warned(/"anthropic_extended_thinking_budget"\] must be a non-negative integer, skipped/));
    assert.deepEqual(Object.keys(fields).sort(),
        ['anthropic_model', 'anthropic_system_prompt', 'anthropic_temperature', 'anthropic_version']);
    assert.equal(fields.anthropic_system_prompt.locked, false);
    assert.equal(fields.anthropic_model.locked, true);
});

test('"_special_prompts_connection:locked" is ignored', () => {
    assert.ok(warned(/"_special_prompts_connection:locked" is not supported, ignored/));
});

test('the accepted entries still imply their locked preferences', () => {
    assert.equal(ctx.mztaManaged.getManagedValue('get_calendar_event_use_specific_integration'), true);
    assert.equal(ctx.mztaManaged.getManagedValue('get_calendar_event_connection_type'), 'anthropic_api');
    assert.equal(ctx.mztaManaged.isManagedLocked('get_calendar_event_connection_type'), true);
});

test('no API key value ever reaches the log', () => {
    assert.equal(ctx.con.all().some(m => m.includes('12345')), false);
});
