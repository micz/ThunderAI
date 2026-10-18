// The harness itself, not the spec: the known issues of the ui area
// (helpers/known-issues/ui.mjs). An entry names one test - a page, the spec section the test was
// written from, and a case id NN-<slug> whose NN is the ui-NN- file that declares it - and says
// what the page does instead; a case listed there runs as a TODO only while it fails, and fails
// the run once it passes. An entry naming a case its file does not declare (under that section)
// fails that file's coverage test, so no entry can outlive its test.
//
// Level 1: nothing imported here reaches jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWN,
    areaFiles,
    validateKnown,
    uiTests
} from '../helpers/known-issues/ui.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('areaFiles() finds the ui- files of tests/dom/, by page', () => {
    const files = areaFiles();
    assert.ok(files.options?.includes('01'), JSON.stringify(files));
    for (const nums of Object.values(files)) for (const nn of nums) assert.match(nn, /^\d\d$/);
});

test('validateKnown() refuses what would hide too much', () => {
    const files = { options: ['01', '02'] };
    const S = 'spec 05 "Feature Flags"';
    const problems = validateKnown({
        options: {
            [S]: {
                '01-*': 'r',
                '*': 'r',
                '01-Bad Case': 'r',
                '01-no-reason': '',
                '03-no-file': 'r',
            },
            'Feature Flags': { '01-x': 'r' },
            'spec 05 "Other"': { '01-no-reason': 'listed twice' },
        },
        popup: { [S]: { '01-x': 'r' } },
        translate: ['not', 'an', 'object'],
    }, { ...files, translate: ['01'] });
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('01-*: a case id is NN-<slug>'), problems.join('; '));
    assert.ok(has('.*: a case id is NN-<slug>'));
    assert.ok(has('01-Bad Case: a case id is NN-<slug>'));
    assert.ok(has('01-no-reason: no reason'));
    assert.ok(has('03-no-file: no ui-03- file'));
    assert.ok(has('Feature Flags: a section is'));
    assert.ok(has('options.01-no-reason: listed under two sections'));
    assert.ok(has('popup: no ui- file'));
    assert.ok(has('translate: must be an object'));
});

test('validateKnown() accepts a well-formed entry', () => {
    assert.deepEqual(validateKnown(
        { options: { 'spec 05 "Feature Flags"': { '01-some-case': 'the page does this instead' } } },
        { options: ['01'] }), []);
});

test('uiTests() refuses a case declared twice and a malformed section', () => {
    const k = uiTests('harness-probe', '01', { known: {} });
    k.test('dup-probe', 'spec 05 "X"', 'first declaration', () => {});
    assert.throws(() => k.test('dup-probe', 'spec 05 "X"', 'second declaration', () => {}), /declared twice/);
    assert.throws(() => k.test('other', 'Feature Flags', 'no spec number', () => {}), /bad section/);
    assert.throws(() => k.test('Bad Case', 'spec 05 "X"', 'bad slug', () => {}), /bad case id/);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 05 "X": r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 05 "X": r', () => {})).outcome, 'stale');
});
