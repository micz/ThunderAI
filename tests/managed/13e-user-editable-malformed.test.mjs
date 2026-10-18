// Spec 08 "Strict mode", validation: a _user_editable that is not an array is warned about and
// ignored, and strict mode falls back to off - the policy resolves exactly as without either key.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('user-editable-malformed.json') });
});

test('strict mode is off: only the explicit preference is locked', () => {
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), ['default_sign_name']);
    assert.equal(ctx.mztaManaged.isLockedByDefault('reply_type'), false);
});

test('the malformed _user_editable is warned about', () => {
    assert.ok(ctx.con.warnings().some(m => m.includes('"_user_editable"') && m.includes('must be an array')));
});
