// The harness itself, not the spec: the known issues of the migration area
// (helpers/known-issues/migration.mjs). An entry names one test - a file of the area and a case id -
// and a reason that names the spec section it contradicts; a case listed there runs as a TODO only
// while it fails, and fails the run once it passes. An entry naming a case its file does not declare
// fails that file's coverage test, so no entry can outlive its test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWN,
    REASONS,
    REASON_PATTERN,
    areaFiles,
    validateKnown,
    caseTests
} from '../helpers/known-issues/migration.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('every reason names a spec section, and is used', () => {
    const used = new Set(Object.values(KNOWN).flatMap(cases => Object.values(cases)));
    for (const [name, reason] of Object.entries(REASONS)) {
        assert.match(reason, REASON_PATTERN, name);
        assert.ok(used.has(reason), `REASONS.${name} is not used by any entry: remove it`);
    }
});

test('areaFiles() lists the files of tests/migration/', () => {
    const files = areaFiles();
    assert.ok(files.includes('99-harness-known-issues'));
    assert.ok(files.includes('01-prefs-to-local'));
    assert.equal(files.some(f => f.endsWith('.test.mjs')), false, 'stems, without the suffix');
});

test('validateKnown() refuses what would hide too much', () => {
    const files = ['01-a', '02-b'];
    const problems = validateKnown({
        '01-a': {
            '*': 'spec 05 "X": everything',
            'case-*': 'spec 05 "X": a pattern',
            'Bad Case': 'spec 05 "X": not a slug',
            'no-reason': '',
            'no-spec': 'something is wrong',
            'unquoted': 'spec 05 without a section name',
        },
        '03-missing': { 'x': 'spec 02 "Y"' },
        '02-b': ['not', 'an', 'object'],
    }, files);
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('01-a.*: a case id names one test'), problems.join('; '));
    assert.ok(has('01-a.case-*: a case id names one test'));
    assert.ok(has('01-a.Bad Case: a case id names one test'));
    assert.ok(has('01-a.no-reason: no reason'));
    assert.ok(has('01-a.no-spec: the reason names no spec section'));
    assert.ok(has('01-a.unquoted: the reason names no spec section'));
    assert.ok(has('03-missing: no such test file'));
    assert.ok(has('02-b: must be an object'));
});

test('validateKnown() accepts a well-formed entry', () => {
    assert.deepEqual(validateKnown({ '01-a': { 'some-case': 'spec 05 "Overview": what the code does' } }, ['01-a']), []);
});

test('caseTests() refuses a case id declared twice in a file', () => {
    const k = caseTests('harness-probe', {});
    k.test('dup-probe', 'first declaration', () => {});
    assert.throws(() => k.test('dup-probe', 'second declaration', () => {}), /declared twice/);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 05 "X" r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 05 "X" r', () => {})).outcome, 'stale');
});
