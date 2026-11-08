// Spec 04 "Extra body data": parseExtraBody() (js/api/api-utils.js) turns the raw JSON string of
// chatgpt_extra_body / openai_comp_extra_body / ollama_extra_options / google_gemini_extra_body
// into an object at request time. Invalid input is ignored, never fatal: {} for a blank string,
// malformed JSON or a non-object (array / scalar / null), with a console.warn. The module must
// stay free of WebExtension and DOM dependencies (it runs in the Web Workers): it is imported
// here with no browser global at all.
// Spec 04 "Extra headers": parseExtraHeaders() does the same for openai_comp_extra_headers, and
// also drops on its own an entry extraHeaderProblem() rejects (a name that is not an HTTP token,
// a header fetch() refuses to set, a value that is not a string or holds a line break); the
// warnings name the header, never its value. mergeHeaders() puts the managed headers over the
// extra ones, comparing names case-insensitively.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';

assertNoBrowser();
const { k, con } = areaFile('01-api-utils');
const {
    extraHeaderProblem,
    isCredentialHeader,
    mergeHeaders,
    parseExtraBody,
    parseExtraHeaders
} = await import('../../js/api/api-utils.js');

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

k.test('headers-object', 'a JSON object of string values comes back as that object', () => {
    assert.deepEqual(parseExtraHeaders('{"x-opencode-session": "thunderai-abc123", "api-key": "k"}'),
        { 'x-opencode-session': 'thunderai-abc123', 'api-key': 'k' });
    assert.deepEqual(con.warnings(), []);
});

k.test('headers-blank', 'a blank string gives {}, with no warning', () => {
    assert.deepEqual(parseExtraHeaders(''), {});
    assert.deepEqual(parseExtraHeaders('   \n '), {});
    assert.deepEqual(con.warnings(), []);
});

for (const [id, raw] of [
    ['malformed', '{"x-a": "1",}'],
    ['array', '["x-a", "1"]'],
    ['scalar-number', '42'],
    ['scalar-string', '"x-a"'],
    ['null', 'null'],
]) {
    k.test('headers-invalid-' + id, `${raw} gives {} and logs a console.warn, never throws`, () => {
        let out;
        assert.doesNotThrow(() => { out = parseExtraHeaders(raw); });
        assert.deepEqual(out, {});
        assert.equal(con.warnings().length, 1, 'one console.warn');
    });
}

for (const [id, name, value, problem] of [
    ['number', 'x-count', 3, 'not_string'],
    ['boolean', 'x-flag', true, 'not_string'],
    ['object', 'x-obj', { a: 1 }, 'not_string'],
    ['null-value', 'x-null', null, 'not_string'],
    ['line-break', 'x-split', 'a\r\nInjected: 1', 'invalid_value'],
    ['space-name', 'x my header', 'v', 'invalid_name'],
    ['colon-name', 'x-a:', 'v', 'invalid_name'],
    ['empty-name', '', 'v', 'invalid_name'],
    ['forbidden-host', 'Host', 'evil.example', 'forbidden'],
    ['forbidden-cookie', 'cookie', 'a=b', 'forbidden'],
    ['forbidden-proxy', 'Proxy-Authorization', 'v', 'forbidden'],
    ['forbidden-sec', 'Sec-Fetch-Site', 'v', 'forbidden'],
]) {
    k.test('headers-entry-' + id, `${JSON.stringify(name)}: ${JSON.stringify(value)} is dropped (${problem}), the valid ones kept`, () => {
        assert.equal(extraHeaderProblem(name, value), problem);
        const out = parseExtraHeaders(JSON.stringify({ [name]: value, 'x-ok': 'yes' }));
        assert.deepEqual(out, { 'x-ok': 'yes' });
        assert.equal(con.warnings().length, 1, 'one console.warn');
    });
}

k.test('headers-warn-no-value', 'a warning names the dropped header, never its value', () => {
    parseExtraHeaders('{"x-secret": "sk-SECRET-1\\n", "x-bad name": "sk-SECRET-2"}');
    const text = con.warnings().join('\n');
    assert.match(text, /x-secret/);
    assert.equal(text.includes('sk-SECRET'), false, text);
});

k.test('merge-managed-wins', 'mergeHeaders(): the managed headers win, whatever the case of the extra names', () => {
    const merged = mergeHeaders(
        { authorization: 'Bearer evil', 'CONTENT-TYPE': 'text/plain', 'x-extra': '1' },
        { 'Content-Type': 'application/json', Authorization: 'Bearer good' });
    assert.deepEqual(merged, { 'Content-Type': 'application/json', Authorization: 'Bearer good', 'x-extra': '1' });
});

k.test('merge-unmanaged-honoured', 'mergeHeaders(): an extra header ThunderAI does not send goes through', () => {
    assert.deepEqual(mergeHeaders({ Authorization: 'Bearer own' }, { 'Content-Type': 'application/json' }),
        { Authorization: 'Bearer own', 'Content-Type': 'application/json' });
    assert.deepEqual(mergeHeaders({}, { 'Content-Type': 'application/json' }), { 'Content-Type': 'application/json' });
});

k.test('credential-header', 'isCredentialHeader(): the names that usually carry a credential, whatever their case', () => {
    for (const name of ['Authorization', 'proxy-authorization', 'api-key', 'X-API-Key', 'x-goog-api-key',
        'X-Auth-Token', 'x-amz-security-token', 'X-Client-Secret', 'x-password', 'X-Credential', 'x-signature', 'Cookie2']) {
        assert.equal(isCredentialHeader(name), true, name);
    }
    for (const name of ['x-opencode-session', 'HTTP-Referer', 'X-Title', 'x-request-id', 'OpenAI-Organization']) {
        assert.equal(isCredentialHeader(name), false, name);
    }
});

k.test('no-browser', 'the module loaded and ran with no browser global (worker-safe)', () => {
    assertNoBrowser();
});

k.coverage();
