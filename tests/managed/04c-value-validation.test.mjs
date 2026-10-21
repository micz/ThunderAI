// Spec 08 "Validation": a type match is not enough - the value must be usable. A policy value
// that fails a content rule is warned about (naming the key) and never applied, never coerced:
//  - a per-provider connection key ({integration}_{key}): the rules of connectionFieldProblem(),
//    the same as for a field of _special_prompts_connection;
//  - an enumeration: one of the values the settings UI offers (connection_type a provider,
//    {prefix}_connection_type a provider the feature panels offer - never chatgpt_web);
//  - a number: a non-negative integer, within the UI's range where it has one;
//  - calendar_timezone: '' or a known time zone.
// Valid values in the same policy are applied as usual.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('value-validation.json');

const REJECTED = [
    'connection_type', 'spamfilter_connection_type', 'reply_type', 'summarize_display_mode',
    'summarize_auto', 'ollama_host', 'chatgpt_model', 'chatgpt_extra_body',
    'google_gemini_temperature', 'anthropic_max_tokens', 'spamfilter_threshold', 'add_tags_maxnum',
    'summarize_max_messages', 'summarize_max_display_length',
    'calendar_timezone',
];
const ACCEPTED = Object.keys(POLICY).filter(k => !REJECTED.includes(k));

let ctx, warnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: { reply_type: 'reply_sender' } });
    warnings = ctx.con.warnings();
});

test('every value that fails a content rule is not applied', () => {
    for (const key of REJECTED) {
        assert.equal(ctx.mztaManaged.hasManagedValue(key), false, key + ' was applied');
    }
});

test('each rejection is warned about, naming the key', () => {
    for (const key of REJECTED) {
        assert.ok(warnings.some(w => w.includes('"' + key + '"') && w.includes('ignored')),
            'no warning for ' + key);
    }
});

test('the valid values of the same policy are applied unchanged', () => {
    for (const key of ACCEPTED) {
        assert.equal(ctx.mztaManaged.hasManagedValue(key), true, key + ' was refused');
        assert.deepEqual(ctx.mztaManaged.getManagedValue(key), POLICY[key], key);
    }
});

test('a rejected value leaves the user\'s stored value in effect', async () => {
    assert.equal(await ctx.mztaPrefs.getPref('reply_type'), 'reply_sender');
    assert.equal(await ctx.mztaPrefs.getPref('spamfilter_threshold'), ctx.prefs_default.spamfilter_threshold);
});

test('calendar_timezone: empty and a listed zone are accepted, an unlisted spelling is not', async () => {
    const check = async value => (await restart({ policy: { calendar_timezone: value } },
        'managedKeys', ['calendar_timezone'])).result.calendar_timezone.managed;
    assert.equal(await check(''), true, '"" (no zone enforced) refused');
    assert.equal(await check('Europe/Rome'), true, 'Europe/Rome refused');
    // Intl.DateTimeFormat accepts it, but the select (built from supportedValuesOf) lists
    // only the canonical spelling, so the page could not show it.
    assert.equal(await check('europe/rome'), false, 'europe/rome accepted');
});

test('a rejected API key is masked in its warning', async () => {
    // The content warning prints the rejected value; an API key must never be printed (spec 08
    // "Validation": keys are masked in all log output). A fresh context, with its own policy.
    const r = await restart({ policy: { chatgpt_api_key: 'sk-SECRET', ollama_host: 'nope' } },
        'managedKeys', ['chatgpt_api_key', 'ollama_host']);
    assert.equal(r.result.chatgpt_api_key.managed, true);
    assert.equal(r.result.ollama_host.managed, false);
    assert.ok(r.warnings.some(w => w.includes('"ollama_host"')));
    assert.ok(r.warnings.every(w => !w.includes('sk-SECRET')));
});
