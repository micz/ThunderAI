// Spec 02 "The text carries the response format" (prompt_add_tags_full_text asks for
// {"tags": [...]}, which taPromptUtils.getTagsFromResponse() parses) and spec 05 "Add Tags"
// (add_tags_auto_uselist / add_tags_auto_uselist_list: the tag allow-list, which the automatic flow
// passes as filter_tags / filter_tags_list), and spec 02 "Add tags: extra prompt statements" →
// "Reading the answer" (the JSON and plain-list forms, a malformed object giving no tag, the
// cleaning of every tag, the allow-list returning the list's spelling).

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('22-response-tags');

let u;

before(async () => {
    await startBackground({ policy: null });
    u = (await import(new URL('js/mzta-utils-prompt.js', REPO).href)).taPromptUtils;
});

k.test('tags-json', 'the {"tags": [...]} answer gives its tags, in order', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Work", "Invoice", "Urgent"]}'), ['Work', 'Invoice', 'Urgent']);
});

k.test('tags-json-whitespace', 'surrounding whitespace and newlines do not matter', () => {
    assert.deepEqual(u.getTagsFromResponse('\n  {\n  "tags": ["Work"]\n}\n  '), ['Work']);
});

k.test('tags-empty-list', 'an empty tag list gives no tags', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": []}'), []);
});

k.test('tags-no-answer', 'no answer gives no tags', () => {
    assert.deepEqual(u.getTagsFromResponse(''), []);
    assert.deepEqual(u.getTagsFromResponse(undefined), []);
    assert.deepEqual(u.getTagsFromResponse(null), []);
});

k.test('filter-off', 'with the allow-list off every tag is kept', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Work", "Other"]}', false, 'Work'), ['Work', 'Other']);
});

k.test('filter-on', 'with the allow-list on only its tags are kept, in the answer order', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Other", "Home", "Work"]}', true, 'Work, Home'), ['Home', 'Work']);
});

k.test('filter-empty-list', 'an allow-list that is on but empty filters nothing', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Work", "Other"]}', true, ''), ['Work', 'Other']);
});

k.test('filter-nothing-left', 'an answer with no allowed tag gives no tags', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Other"]}', true, 'Work, Home'), []);
});

// --- Spec 02 "Reading the answer" -------------------------------------------------------------

k.test('tags-code-fence', 'a JSON answer in a code fence, or with text around it, gives its tags', () => {
    assert.deepEqual(u.getTagsFromResponse('```json\n{"tags": ["Work", "Invoice"]}\n```'), ['Work', 'Invoice']);
    assert.deepEqual(u.getTagsFromResponse('Here they are:\n{"tags": ["Work"]}\nDone.'), ['Work']);
});

k.test('tags-string-value', '"tags" as a comma separated string is split on the commas', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": "Work, Invoice ,Urgent"}'), ['Work', 'Invoice', 'Urgent']);
});

k.test('tags-other-shape', 'a JSON answer without a usable "tags" gives no tag', () => {
    assert.deepEqual(u.getTagsFromResponse('{"labels": ["Work"]}'), []);
    assert.deepEqual(u.getTagsFromResponse('{"tags": null}'), []);
});

k.test('tags-malformed-json', 'a malformed JSON answer gives no tag, never pieces of the raw text', () => {
    for (const answer of ['{"tags": ["Work", }', 'Use {"tags": ["Work"]} as asked {ok}', '{"tags": ["A"]}\n{"tags": ["B"]}', 'Work, {weird}, Urgent']) {
        assert.deepEqual(u.getTagsFromResponse(answer), [], answer);
    }
});

k.test('tags-plain-list', 'a plain comma separated list (no brace) is still accepted', () => {
    assert.deepEqual(u.getTagsFromResponse('Work, Invoice,Urgent'), ['Work', 'Invoice', 'Urgent']);
});

k.test('tags-plain-list-prose', 'in a plain list, an item spanning several lines is dropped', () => {
    assert.deepEqual(u.getTagsFromResponse('Work, I think this email is about\nan invoice, Urgent'), ['Work', 'Urgent']);
});

k.test('tags-cleaned', 'only non-empty strings, trimmed, each once ignoring case (first spelling wins)', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["Work", "", "  ", 42, null, "work", " Spaced "]}'), ['Work', 'Spaced']);
});

k.test('filter-ignores-case', 'the allow-list matches ignoring case and returns the list\'s spelling', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": ["work", "HOME", "Other"]}', true, 'Work, home'), ['Work', 'home']);
});

k.test('filter-trimmed', 'the answer\'s tags are trimmed before the allow-list match', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": [" Work "]}', true, 'Work'), ['Work']);
});

k.test('filter-non-string', 'a non-string item with the allow-list on is dropped, never an error', () => {
    assert.deepEqual(u.getTagsFromResponse('{"tags": [42, "Work"]}', true, 'Work'), ['Work']);
});

k.coverage();
