// Spec 08 "Strict mode", validation: _lock_unlisted is on only for a literal true, like a
// restriction. "true" is warned about and strict mode stays off - the policy resolves exactly
// as without the key - and a _user_editable without strict mode is warned about as ignored.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('lock-unlisted-malformed.json') });
});

test('strict mode is off: only the explicit preference is locked', () => {
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), ['default_sign_name']);
    assert.equal(ctx.mztaManaged.hasManagedValue('do_debug'), false);
});

test('both keys are warned about', () => {
    const w = ctx.con.warnings();
    assert.ok(w.some(m => m.includes('"_lock_unlisted"') && m.includes('true or false')));
    assert.ok(w.some(m => m.includes('"_user_editable"') && m.includes('only meaningful')));
});
