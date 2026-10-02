// The harness itself, not the spec: helpers/restart.mjs runs a scenario in a worker thread. A
// scenario whose promise never settles lets the worker's event loop drain, so the worker exits
// with code 0 having posted nothing. restart() used to reject only on a non-zero code, leaving
// the test to fail with node:test's generic "Promise resolution is still pending"; it now rejects
// saying what happened. (A worker kept alive by an open handle is caught by its timeout.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restart } from '../helpers/restart.mjs';

test('a worker that exits without an answer rejects, it does not hang', async () => {
    await assert.rejects(restart({ policy: null }, 'neverSettles'), /without an answer|gave no answer/);
});

test('a scenario that answers still resolves', async () => {
    const r = await restart({ policy: null }, 'readPrefs', ['do_debug']);
    assert.deepEqual(r.result, { do_debug: false });
});
