// Spec 02 "The text carries the response format": the feature pages check that a special prompt
// whose parser reads a JSON answer still carries a valid JSON format inside its text.
// specialPromptNeedsJson(id) is true for the ids with responseKeys in the contract (spam filter,
// add tags, both calendar ids, task, translate), false for the summarize ones.
// checkPromptTextJson(text): the candidates are the top-level {...} blocks, braces matched outside
// JSON strings, a {%placeholder%} outside a string skipped whole; a block left open runs to the
// end of the text and nothing after its opening brace is a candidate of its own; the text is fine
// when one candidate is strict JSON. No block -> found false; blocks but none valid -> the parser
// message of the longest candidate, without a "JSON.parse:" prefix. Every shipped en text passes.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('24-response-format-json');

const EN = JSON.parse(readFileSync(repoPath('_locales/en/messages.json'), 'utf8'));

let p;

before(async () => {
    p = (await startBackground({ policy: null })).prompts;
});

const ok = text => assert.deepEqual(p.checkPromptTextJson(text), { found: true, error: '' }, text);
const invalid = text => {
    const r = p.checkPromptTextJson(text);
    assert.equal(r.found, true, text);
    assert.notEqual(r.error, '', text);
    assert.doesNotMatch(r.error, /^\s*JSON\.parse:/, text);
    return r.error;
};

k.test('needs-json', 'specialPromptNeedsJson(): the ids whose parser reads a JSON answer, and only them', () => {
    for (const id of ['prompt_spamfilter', 'prompt_add_tags', 'prompt_get_calendar_event',
        'prompt_get_calendar_event_from_clipboard', 'prompt_get_task', 'prompt_translate_this']) {
        assert.equal(p.specialPromptNeedsJson(id), true, id);
    }
    for (const id of ['prompt_summarize', 'prompt_summarize_email_template',
        'prompt_summarize_email_separator', 'prompt_reply', 'not_a_prompt']) {
        assert.equal(p.specialPromptNeedsJson(id), false, id);
    }
});

k.test('shipped-texts-pass', 'every shipped en text of a JSON feature passes', () => {
    for (const key of ['prompt_spamfilter_full_text', 'prompt_add_tags_full_text',
        'prompt_get_calendar_event_full_text', 'prompt_get_task_full_text',
        'prompt_translate_this_full_text']) {
        assert.deepEqual(p.checkPromptTextJson(EN[key].message), { found: true, error: '' }, key);
    }
});

k.test('text-around', 'the instructions around the object do not matter', () => {
    ok('Answer only with JSON:\n{\n"tags": ["a", "b"]\n}\nThanks.');
    ok('{"spamValue": 0}');
});

k.test('missing', 'no {...} block at all: not found', () => {
    assert.deepEqual(p.checkPromptTextJson('Give me the tags, comma separated.'), { found: false, error: '' });
    assert.deepEqual(p.checkPromptTextJson(''), { found: false, error: '' });
});

k.test('placeholder-not-a-block', 'a {%placeholder%} is not a {...} block', () => {
    assert.deepEqual(p.checkPromptTextJson('Tags for: {%mail_text_body%} {%mail_subject%}'), { found: false, error: '' });
    // After the object, its %} is not the object's closing brace.
    ok('{"summary": "x"}\nHere\'s the text:"{%selected_text%}"');
});

k.test('placeholder-in-string', 'a placeholder inside a JSON string is string content', () => {
    ok('{"from": "{%author%}", "subject": "{%mail_subject%}"}');
});

k.test('placeholder-as-value', 'a placeholder outside a string is skipped by the scan, not valid JSON', () => {
    invalid('{"from": {%author%}}');
});

k.test('not-strict', 'strict JSON only: example notations, single quotes, trailing commas fail', () => {
    invalid('{\n"spamValue": <integer from 0 to 100>\n}');
    invalid('{"attendees": [attendee1@example.com,attendee2@example.com]}');
    invalid("{'tags': ['a']}");
    invalid('{"tags": ["a",]}');
    // A no-break space before the colon, as French typography writes it.
    invalid('{"tags" : ["a"]}');
});

k.test('open-block', 'a block left open is a candidate to the end; an inner object does not pass for it', () => {
    invalid('Format:\n{"event": {"summary": "x"}\nThe text: {%mail_text_body%}');
    invalid('Format: {"summary": "unterminated}');
});

k.test('one-valid-is-enough', 'one valid top-level block is enough, a stray {...} in the prose aside', () => {
    ok('Use { and } around the object. {"tags": ["a"]}');
});

k.test('longest-error', 'with no valid block, the error is the longest candidate\'s', () => {
    const long = '{"tags": ["a", "b", "c",]}';
    const r = p.checkPromptTextJson('Wrap it in {curly braces}. ' + long);
    let expected;
    try { JSON.parse(long); } catch (e) { expected = String(e.message).replace(/^\s*JSON\.parse:\s*/, ''); }
    assert.deepEqual(r, { found: true, error: expected });
});

k.coverage();
