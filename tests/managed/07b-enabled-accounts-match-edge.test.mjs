// Spec 08 "Validation" (exception for the account matchers) and "Account lists by policy":
//  - a list whose entries are ALL invalid is kept, empty - "no account" - with a warning:
//    rejecting it would fail open to the user's selection;
//  - an empty array in the policy means "not managed" and is not recorded at all;
//  - the matchers are read from mztaManaged, not mztaPrefs: a stray stored value must not
//    limit anything without a policy.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const STORED = {
    spamfilter_enabled_accounts: [],
    add_tags_enabled_accounts: [],
    add_tags_enabled_accounts_match: ['nobody@nowhere.example'],   // stray, not from a policy
};

let ctx;

before(async () => {
    ctx = await startBackground({
        policy: loadFixture('accounts-match-edge.json'),
        local: STORED,
        accounts: loadFixture('accounts.json'),
    });
});

test('an all-invalid list is kept, empty, enforced, and warned about', () => {
    assert.equal(ctx.mztaManaged.hasManagedValue('spamfilter_enabled_accounts_match'), true);
    assert.deepEqual(ctx.mztaManaged.getManagedValue('spamfilter_enabled_accounts_match'), []);
    assert.equal(ctx.mztaManaged.isManagedLocked('spamfilter_enabled_accounts_match'), true);
    assert.ok(ctx.con.warnings().some(w => w.includes('spamfilter_enabled_accounts_match') && /no valid entry/i.test(w)));
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
});

test('...and resolves to no account, not to the user selection "all accounts"', async () => {
    assert.deepEqual(await ctx.utils.resolveEnabledAccounts('spamfilter', []),
        { restricted: true, accountIds: [], managed: true });
});

test('an empty policy array is "not managed" and not recorded', () => {
    assert.equal(ctx.mztaManaged.hasManagedValue('add_tags_enabled_accounts_match'), false);
    assert.equal(ctx.mztaManaged.isManagedLocked('add_tags_enabled_accounts_match'), false);
});

test('not managed: the stored list with its own semantics; the stray stored matcher limits nothing', async () => {
    assert.deepEqual(await ctx.utils.resolveEnabledAccounts('add_tags', []),
        { restricted: false, accountIds: [], managed: false });
    assert.deepEqual(await ctx.utils.resolveEnabledAccounts('add_tags', ['account3']),
        { restricted: true, accountIds: ['account3'], managed: false });
});
