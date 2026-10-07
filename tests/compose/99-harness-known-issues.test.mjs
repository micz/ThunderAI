// The harness itself, not the spec: the known issues of the compose area
// (helpers/known-issues/compose.mjs). An entry names one test - the spec section it was written
// from and a case id NN-<slug> whose NN is the compose-NN- file that declares it - and says what
// the code does instead; a case listed there runs as a TODO only while it fails, and fails the run
// once it passes. An entry naming a case its file does not declare (under that section) fails that
// file's coverage test, so no entry can outlive its test.
//
// Level 1: nothing imported here reaches jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWN,
    areaFiles,
    validateKnown,
    composeTests
} from '../helpers/known-issues/compose.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('areaFiles() finds the compose- files of tests/dom/compose/', () => {
    const files = areaFiles();
    assert.ok(files.includes('01'), JSON.stringify(files));
    for (const nn of files) assert.match(nn, /^\d\d$/);
});

test('validateKnown() refuses what would hide too much', () => {
    const S = 'spec 01 "Writing into a plain text compose window"';
    const problems = validateKnown({
        [S]: {
            '01-*': 'r',
            '01-Bad Case': 'r',
            '01-no-reason': '',
            '98-no-file': 'r',
        },
        'Writing into a plain text compose window': { '01-x': 'r' },
        'spec 03 "Other"': { '01-no-reason': 'listed twice' },
        'spec 03 "Not an object"': ['a'],
    }, ['01']);
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('01-*: a case id is NN-<slug>'), problems.join('; '));
    assert.ok(has('01-Bad Case: a case id is NN-<slug>'));
    assert.ok(has('01-no-reason: no reason'));
    assert.ok(has('98-no-file: no compose-98- file'));
    assert.ok(has('Writing into a plain text compose window: a section is'));
    assert.ok(has('01-no-reason: listed under two sections'));
    assert.ok(has('Not an object": must be an object'));
});

test('validateKnown() accepts a well-formed entry, a section title holding quotes and backticks included', () => {
    assert.deepEqual(validateKnown(
        { 'spec 03 "`mail_text_body` vs "x" `mail_plain_text_part`"': { '01-some-case': 'the code does this instead' } },
        ['01']), []);
});

test('composeTests() refuses a case declared twice, a malformed section and a bad slug', () => {
    const k = composeTests('01', { known: {} });
    k.test('dup-probe', 'spec 01 "X"', 'first declaration', () => {});
    assert.throws(() => k.test('dup-probe', 'spec 01 "X"', 'second declaration', () => {}), /declared twice/);
    assert.throws(() => k.test('other', 'Writing into a plain text compose window', 'no spec number', () => {}), /bad section/);
    assert.throws(() => k.test('Bad Case', 'spec 01 "X"', 'bad slug', () => {}), /bad case id/);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 01 "X": r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 01 "X": r', () => {})).outcome, 'stale');
});
