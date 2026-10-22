// The harness itself, not the spec: the known issues of the static area
// (helpers/known-issues/static.mjs). A group of KNOWN runs as a TODO only while one of its subjects
// still violates; a listed subject that no longer does fails the run, so an entry cannot outlive its
// bug and hide a later regression. A subject names one key or locale ('*' would hide a whole check),
// and a reason names the spec section it contradicts. An informational check (it reports, never
// fails) takes no known issue at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHECKS,
    INFORMATIONAL,
    KNOWN,
    validateKnown,
    knownFor,
    declareCheck,
    reportCheck
} from '../helpers/known-issues/static.mjs';
import { runKnown } from '../helpers/core/known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('validateKnown() refuses what would hide too much', () => {
    const problems = validateKnown({
        'dead-key': [
            { reason: 'spec 06: everything', subjects: ['*'] },
            { reason: 'spec 06: a pattern', subjects: ['prefs_*'] },
            { reason: 'spec 06: twice', subjects: ['a', 'a'] },
            { reason: '', subjects: ['b'] },
            { reason: 'no spec named here', subjects: ['c'] },
            { reason: 'spec 06: empty', subjects: [] },
        ],
        'no-such-check': [{ reason: 'spec 06', subjects: ['x'] }],
        'placeholders': { reason: 'spec 06', subjects: ['it:x'] },
    });
    const has = s => problems.some(p => p.includes(s));
    assert.ok(has('dead-key[0].*: a subject names one key or locale'), '"*" is refused');
    assert.ok(has('dead-key[1].prefs_*'), 'a pattern is refused');
    assert.ok(has('dead-key.a: listed twice'));
    assert.ok(has('dead-key[3]: no reason'));
    assert.ok(has('dead-key[4]: the reason names no spec section'));
    assert.ok(has('dead-key[5]: no subjects'));
    assert.ok(has('no-such-check: unknown check'));
    assert.ok(has('placeholders: must be an array of groups'));
});

test('validateKnown() refuses a known issue for an informational check', () => {
    assert.ok(INFORMATIONAL.length > 0 && INFORMATIONAL.every(c => CHECKS.includes(c)));
    const problems = validateKnown({ 'stale-key': [{ reason: 'spec 06 "Removing a String"', subjects: ['it:x'] }] });
    assert.ok(problems.some(p => p.includes('stale-key: an informational check takes no known issues')), problems.join('; '));
});

test('a check is declared by the helper of its kind only', () => {
    assert.throws(() => declareCheck('stale-key', 't', new Map()), /informational, use reportCheck/);
    assert.throws(() => reportCheck('placeholders', 't', new Map()), /blocking, use declareCheck/);
});

test('knownFor() has no fallback: an unlisted subject has no reason', () => {
    const known = { 'dead-key': [{ reason: 'spec 06 r', subjects: ['a'] }] };
    assert.equal(knownFor('dead-key', known).get('a'), 'spec 06 r');
    assert.equal(knownFor('dead-key', known).get('b'), undefined);
    assert.equal(knownFor('placeholders', known).size, 0);
});

test('every check named in KNOWN is one the area declares', () => {
    for (const check of Object.keys(KNOWN)) assert.ok(CHECKS.includes(check), check);
});

test('runKnown(): todo while failing, stale once passing', async () => {
    assert.equal((await runKnown('spec 06 r', () => { throw new Error('still'); })).outcome, 'todo');
    assert.equal((await runKnown('spec 06 r', () => {})).outcome, 'stale');
});
