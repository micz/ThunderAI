// Spec 02 "The text carries the response format" (prompt_add_tags_full_text asks for
// {"tags": [...]}, which taPromptUtils.getTagsFromResponse() parses) and spec 05 "Add Tags"
// (add_tags_auto_uselist / add_tags_auto_uselist_list: the tag allow-list, which the automatic flow
// passes as filter_tags / filter_tags_list). The comma-split fallback for a non-JSON answer is only
// in the function's own comment ("backwards compatibility"), not in a spec: not tested.

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

k.coverage();
