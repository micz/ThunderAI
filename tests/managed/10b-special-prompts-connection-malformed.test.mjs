// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Validation":
// a value that is not a plain object is warned about and ignored as a whole, and a policy that
// supplies nothing else is therefore not active.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('special-prompts-connection-malformed.json') });
});

test('an array is ignored with a warning', () => {
    assert.ok(ctx.con.warnings().some(w => /"_special_prompts_connection" must be an object/.test(w)));
    assert.deepEqual(ctx.mztaManaged.getSpecialPromptsConnection(), {});
    assert.deepEqual(ctx.mztaManaged.getEnforcedConnectionControlIds(), []);
});

test('nothing else in the policy: not active', () => {
    assert.equal(ctx.mztaManaged.isManagedActive(), false);
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), []);
});
