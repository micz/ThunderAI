// Spec 04 "Extra body data": parseExtraBody() (js/api/api-utils.js) turns the raw JSON string of
// chatgpt_extra_body / openai_comp_extra_body / ollama_extra_options / google_gemini_extra_body
// into an object at request time. Invalid input is ignored, never fatal: {} for a blank string,
// malformed JSON or a non-object (array / scalar / null), with a console.warn. The module must
// stay free of WebExtension and DOM dependencies (it runs in the Web Workers): it is imported
// here with no browser global at all.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';

assertNoBrowser();
const { k, con } = areaFile('01-api-utils');
const { parseExtraBody } = await import('../../js/api/api-utils.js');

k.test('object', 'a JSON object comes back as that object', () => {
    assert.deepEqual(parseExtraBody('{"top_p": 0.9, "nested": {"a": [1, 2]}}'), { top_p: 0.9, nested: { a: [1, 2] } });
    assert.deepEqual(con.warnings(), []);
});

k.test('blank', 'a blank string gives {}', () => {
    assert.deepEqual(parseExtraBody(''), {});
    assert.deepEqual(parseExtraBody('   \n '), {});
});

for (const [id, raw] of [
    ['malformed', '{"top_p": 0.9,}'],
    ['array', '[1, 2, 3]'],
    ['scalar-number', '42'],
    ['scalar-string', '"text"'],
    ['null', 'null'],
]) {
    k.test('invalid-' + id, `${raw} gives {} and logs a console.warn, never throws`, () => {
        let out;
        assert.doesNotThrow(() => { out = parseExtraBody(raw); });
        assert.deepEqual(out, {});
        assert.equal(con.warnings().length, 1, 'one console.warn');
    });
}

k.test('no-browser', 'the module loaded and ran with no browser global (worker-safe)', () => {
    assertNoBrowser();
});

k.coverage();
