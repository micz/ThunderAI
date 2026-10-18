// The harness itself, not the spec: the known-issue mechanism of the DOM tests
// (helpers/dom-known-issues.mjs). A failing test is run as a TODO only while it fails; once it
// passes its entry is stale and the run fails, so an entry cannot outlive its bug and hide a
// later regression. A per-key entry names its key ('*' would hide a whole page), and the harness
// check is never a known issue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN, validateKnown, todoFor, runKnown } from '../helpers/dom-known-issues.mjs';

test('the KNOWN entries in use are valid', () => {
    assert.deepEqual(validateKnown(KNOWN), []);
});

test('validateKnown() refuses what would hide too much', () => {
    const problems = validateKnown({
        options: {
            locked: {
                '*': { value: 'all keys at once', writes: 'the page-wide write test' },
                chatgpt_model: { disabled: '', colour: 'no such aspect', harness: 'never' },
            },
            unlocked: { '*': { editable: 'all keys' } },
            sideways: {},
        },
    });
    assert.ok(problems.some(p => p.includes('options.locked.*.value')), 'per-key aspect under "*"');
    assert.ok(!problems.some(p => p.includes('options.locked.*.writes')), '"*" is fine for writes');
    assert.ok(problems.some(p => p.includes('chatgpt_model.disabled: no reason')));
    assert.ok(problems.some(p => p.includes('chatgpt_model.colour: unknown aspect')));
    assert.ok(problems.some(p => p.includes('chatgpt_model.harness')));
    assert.ok(problems.some(p => p.includes('options.unlocked.*.editable')));
    assert.ok(problems.some(p => p.includes('unknown sweep "sideways"')));
});

test('todoFor() has no "*" fallback for a key', () => {
    const todo = { '*': { value: 'x', writes: 'w' }, a: { value: 'only a' } };
    assert.equal(todoFor(todo, 'a', 'value'), 'only a');
    assert.equal(todoFor(todo, 'b', 'value'), undefined);
    assert.equal(todoFor(todo, '*', 'writes'), 'w');
    assert.equal(todoFor(undefined, 'a', 'value'), undefined);
});

test('a known issue that still fails is a TODO carrying the reason and the failure', async () => {
    const r = await runKnown('bug #1', () => { throw new Error('still broken'); });
    assert.equal(r.outcome, 'todo');
    assert.match(r.message, /bug #1 -- still broken/);
});

test('a known issue that passes is stale', async () => {
    assert.deepEqual(await runKnown('bug #1', () => {}), { outcome: 'stale' });
});

test('without a reason a test is a plain test', async () => {
    assert.deepEqual(await runKnown(undefined, () => {}), { outcome: 'pass' });
    await assert.rejects(runKnown(undefined, () => { throw new Error('real failure'); }), /real failure/);
});
