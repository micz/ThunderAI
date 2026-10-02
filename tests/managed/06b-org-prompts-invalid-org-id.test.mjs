// Spec 08 "Organization prompts": _org_id may not contain an underscore, and without a
// valid _org_id the whole prompt set is refused rather than given ambiguous ids.
// Scenario: _org_id "acme_corp" contains an underscore.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

let ctx;

before(async () => {
    ctx = await startBackground({ policy: loadFixture('org-prompts-invalid-org-id.json') });
});

test('the whole organization prompt set is refused', async () => {
    assert.deepEqual(ctx.mztaManaged.getOrgPrompts(), []);
    const all = await ctx.prompts.getPrompts();
    assert.ok(all.every(p => String(p.is_org) !== '1'));
    assert.ok(all.every(p => !String(p.id).startsWith('org_')));
});

test('the refusal is warned about', () => {
    assert.ok(ctx.con.warnings().some(w => w.includes('_org_id')), ctx.con.warnings().join('\n'));
});
