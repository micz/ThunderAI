// The harness itself, not the spec: the known issues of the chatgptweb area
// (helpers/known-issues/chatgptweb.mjs). An entry names one test - the spec section it was written
// from and a case id NN-<slug> whose NN is the chatgptweb-NN- file that declares it - and says what
// the code does instead; a case listed there runs as a TODO only while it fails, and fails the run
// once it passes. An entry naming a case its file does not declare (under that section) fails that
// file's coverage test, so no entry can outlive its test. The area's DOM files live in several
// tests/dom/<page>/ folders, so their numbers must be unique across them.
//
// Level 1: nothing imported here reaches jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWN,
    areaFiles,
    areaDomFiles,
    duplicateNumbers,
    validateKnown,
    chatgptwebTests
} from '../helpers/known-issues/chatgptweb.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('areaFiles() finds the chatgptweb- files of every tests/dom/<page>/ folder', () => {
    const paths = areaDomFiles().map(f => f.path);
    assert.ok(paths.some(p => p.startsWith('chatgpt/chatgptweb-01-')), JSON.stringify(paths));
    assert.ok(paths.some(p => p.startsWith('options/chatgptweb-')), JSON.stringify(paths));
    for (const nn of areaFiles()) assert.match(nn, /^\d\d$/);
});

test('every NN names one file of the area', () => {
    assert.deepEqual(duplicateNumbers(), []);
    assert.deepEqual(duplicateNumbers([{ nn: '01', path: 'a/chatgptweb-01-x.dom.mjs' }, { nn: '01', path: 'b/chatgptweb-01-y.dom.mjs' }]),
        ['01: a/chatgptweb-01-x.dom.mjs, b/chatgptweb-01-y.dom.mjs']);
});

test('validateKnown() refuses what would hide too much', () => {
    const S = 'spec 04 "Model verification"';
    const problems = validateKnown({
        [S]: {
            '01-*': 'r',
            '01-Bad Case': 'r',
            '01-no-reason': '',
            '98-no-file': 'r',
        },
        'Model verification': { '01-x': 'r' },
        'spec 05 "Other"': { '01-no-reason': 'listed twice' },
        'spec 05 "Not an object"': ['a'],
    }, ['01']);
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('01-*: a case id is NN-<slug>'), problems.join('; '));
    assert.ok(has('01-Bad Case: a case id is NN-<slug>'));
    assert.ok(has('01-no-reason: no reason'));
    assert.ok(has('98-no-file: no chatgptweb-98- file'));
    assert.ok(has('Model verification: a section is'));
    assert.ok(has('01-no-reason: listed under two sections'));
    assert.ok(has('Not an object": must be an object'));
});

test('validateKnown() accepts a well-formed entry, a section title holding quotes and backticks included', () => {
    assert.deepEqual(validateKnown(
        { 'spec 04 "`checkGPTModel()` "x""': { '01-some-case': 'the code does this instead' } },
        ['01']), []);
});

test('chatgptwebTests() refuses a case declared twice, a malformed section and a bad slug', () => {
    const k = chatgptwebTests('01', { known: {} });
    k.test('dup-probe', 'spec 04 "X"', 'first declaration', () => {});
    assert.throws(() => k.test('dup-probe', 'spec 04 "X"', 'second declaration', () => {}), /declared twice/);
    assert.throws(() => k.test('other', 'Model verification', 'no spec number', () => {}), /bad section/);
    assert.throws(() => k.test('Bad Case', 'spec 04 "X"', 'bad slug', () => {}), /bad case id/);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 04 "X": r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 04 "X": r', () => {})).outcome, 'stale');
});
