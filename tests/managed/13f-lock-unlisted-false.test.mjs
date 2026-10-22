// Spec 08 "Strict mode", rule 5: "_lock_unlisted": false is the same as no key at all - the
// existing resolution, unchanged, and nothing to warn about.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('lock-unlisted-false.json'), local: { reply_type: 'reply_sender' } });
});

test("only the explicit preference is locked; the rest is the user's", async () => {
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), ['default_sign_name']);
    assert.equal(await ctx.mztaPrefs.getPref('reply_type'), 'reply_sender');
});

test('no warning', () => {
    assert.deepEqual(ctx.con.warnings(), []);
});
