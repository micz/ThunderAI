// The harness itself, not the spec: the known issues of the api area
// (helpers/known-issues/api.mjs). An entry names one test - a file of the area and a case id -
// and a reason of the form `spec 04 "<section>" [<provider>]: ...`; a case listed there runs as a
// TODO only while it fails, and fails the run once it passes. An entry naming a case its file
// does not declare fails that file's coverage test, so no entry can outlive its test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWN,
    REASONS,
    PROVIDERS,
    areaFiles,
    validateKnown,
    reasonProblems,
    caseTests
} from '../helpers/known-issues/api.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('every reason is well formed and used', () => {
    const used = new Set(Object.values(KNOWN).flatMap(cases => Object.values(cases)));
    for (const [name, reason] of Object.entries(REASONS)) {
        assert.deepEqual(reasonProblems(reason), [], name);
        assert.ok(used.has(reason), `REASONS.${name} is not used by any entry: remove it`);
    }
});

test('areaFiles() lists the files of tests/api/', () => {
    const files = areaFiles();
    assert.ok(files.includes('99-harness-known-issues'));
    assert.ok(files.includes('10-fetch-with-retry'));
    assert.equal(files.some(f => f.endsWith('.test.mjs')), false, 'stems, without the suffix');
    assert.equal(files.includes('fetch-model'), false, 'helper modules are not test files');
});

test('reasonProblems() wants a spec 04 section and a known provider', () => {
    assert.deepEqual(reasonProblems('spec 04 "Web Worker Pattern" [ollama]: what happens'), []);
    assert.deepEqual(reasonProblems('spec 04 "X" [shared]: y'), []);
    assert.ok(reasonProblems('').length);
    assert.ok(reasonProblems('spec 04 "X": no provider').length);
    assert.ok(reasonProblems('spec 02 "X" [ollama]: wrong spec').length);
    assert.ok(reasonProblems('spec 04 X [ollama]: unquoted section').length);
    assert.match(reasonProblems('spec 04 "X" [chatgpt_web]: y')[0], /unknown provider/);
    assert.ok(PROVIDERS.includes('shared'));
});

test('validateKnown() refuses what would hide too much', () => {
    const files = ['01-a', '02-b'];
    const ok = 'spec 04 "X" [anthropic]: y';
    const problems = validateKnown({
        '01-a': {
            '*': ok,
            'case-*': ok,
            'Bad Case': ok,
            'no-reason': '',
            'no-section': 'something is wrong',
        },
        '03-missing': { 'x': ok },
        '02-b': ['not', 'an', 'object'],
    }, files);
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('01-a.*: a case id names one test'), problems.join('; '));
    assert.ok(has('01-a.case-*: a case id names one test'));
    assert.ok(has('01-a.Bad Case: a case id names one test'));
    assert.ok(has('01-a.no-reason: no reason'));
    assert.ok(has('01-a.no-section: the reason is not'));
    assert.ok(has('03-missing: no such test file'));
    assert.ok(has('02-b: must be an object'));
});

test('validateKnown() accepts a well-formed entry', () => {
    assert.deepEqual(validateKnown({ '01-a': { 'some-case': 'spec 04 "Section" [ollama]: what the code does' } }, ['01-a']), []);
});

test('caseTests() refuses a case id declared twice in a file', () => {
    const k = caseTests('harness-probe', { known: {} });
    k.test('dup-probe', 'first declaration', () => {});
    assert.throws(() => k.test('dup-probe', 'second declaration', () => {}), /declared twice/);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 04 "X" [shared]: r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 04 "X" [shared]: r', () => {})).outcome, 'stale');
});
