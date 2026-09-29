// Spec 08 "Account lists by policy (*_enabled_accounts_match)":
//  - entries: an address, "@domain" / "*@domain", or "local"; case-insensitive, surrounding
//    whitespace ignored, stored lowercased; only the shape extractEmail() recognises, so an
//    address with a "+" tag is rejected; each bad entry (non-strings included) is skipped
//    with a warning naming its index, the rest still apply;
//  - always enforced: ":locked": false is warned about and ignored;
//  - an account matches when any identity matches; Local Folders (type none) only via
//    "local"; RSS feeds never;
//  - managed => restricted is ALWAYS true, and an empty result means NO account, warned once
//    per context and again only after the list matched something in between;
//  - resolved at each call (accounts.list(false)), never cached, never written to
//    {feature}_enabled_accounts; an unreadable account list fails closed.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('accounts-match.json');
const ACCOUNTS = loadFixture('accounts.json');
const STORED = { spamfilter_enabled_accounts: ['account2'], add_tags_enabled_accounts: ['account1'] };

let ctx, loadWarnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED, accounts: ACCOUNTS });
    loadWarnings = ctx.con.warnings();
});

const resolve = (feature, stored) => ctx.utils.resolveEnabledAccounts(feature, stored);

test('isAccountMatcherEntry() follows the entry table', () => {
    const ok = ctx.managedModule.isAccountMatcherEntry;
    for (const e of ['user@acme.example', '@acme.example', '*@acme.example', 'local', 'LOCAL', '  Local ',
                     ' User@ACME.Example ']) {
        assert.equal(ok(e), true, JSON.stringify(e));
    }
    for (const e of ['user+tag@acme.example', '@acme', 'acme.example', '*acme.example', 'locals', '',
                     '   ', 42, null, undefined, ['local'], {}]) {
        assert.equal(ok(e), false, JSON.stringify(e));
    }
});

test('valid entries are kept, trimmed and lowercased; invalid ones skipped by index', () => {
    assert.deepEqual(ctx.mztaManaged.getManagedValue('spamfilter_enabled_accounts_match'),
        ['user@acme.example', '*@partner.example', 'local']);
    for (const index of [3, 4, 5, 6]) {
        assert.ok(loadWarnings.some(w => w.includes('spamfilter_enabled_accounts_match') && w.includes('[' + index + ']')),
            'no warning for index ' + index);
    }
});

test('":locked": false is warned about and ignored: the list is enforced', () => {
    assert.equal(ctx.mztaManaged.isManagedLocked('spamfilter_enabled_accounts_match'), true);
    assert.equal(ctx.mztaManaged.isManagedLocked('add_tags_enabled_accounts_match'), true);
    assert.ok(loadWarnings.some(w => w.includes('spamfilter_enabled_accounts_match:locked')));
});

test('address, domain and "local" resolve to account ids, replacing the stored list', async () => {
    assert.deepEqual(await resolve('spamfilter', STORED.spamfilter_enabled_accounts), {
        restricted: true,
        accountIds: ['account1', 'account3', 'account4'],   // address, domain (2nd identity), local
        managed: true,
    });
});

test('RSS feeds and a "+"-tagged identity outside the domains are never matched', async () => {
    const { accountIds } = await resolve('spamfilter', []);
    assert.equal(accountIds.includes('account5'), false);
    assert.equal(accountIds.includes('account6'), false);
    assert.equal(accountIds.includes('account2'), false, 'an address entry is not a domain');
});

test('managed means restricted even when the stored list is empty ("all accounts")', async () => {
    assert.equal((await resolve('spamfilter', [])).restricted, true);
});

test('no match means NO account, never all accounts, warned once', async () => {
    ctx.con.clear();
    assert.deepEqual(await resolve('add_tags', []), { restricted: true, accountIds: [], managed: true });
    assert.deepEqual(await resolve('add_tags', ['account1']), { restricted: true, accountIds: [], managed: true });
    assert.equal(ctx.con.warnings().filter(w => w.includes('add_tags_enabled_accounts_match')).length, 1);
});

test('the warning comes back only after the list has matched something in between', async () => {
    ctx.con.clear();
    await resolve('add_tags', []);
    assert.equal(ctx.con.warnings().length, 0);
    ctx.ctl.setAccounts([...ACCOUNTS, { id: 'account9', type: 'imap', identities: [{ email: 'x@nomatch.example' }] }]);
    assert.deepEqual((await resolve('add_tags', [])).accountIds, ['account9']);
    ctx.ctl.setAccounts(ACCOUNTS);
    await resolve('add_tags', []);
    assert.equal(ctx.con.warnings().filter(w => w.includes('add_tags_enabled_accounts_match')).length, 1);
});

test('resolved at every call from accounts.list(false): a new identity is picked up at once', async () => {
    ctx.ctl.calls.length = 0;
    ctx.ctl.setAccounts([...ACCOUNTS, { id: 'account7', type: 'imap', identities: [{ email: 'USER@acme.example' }] }]);
    assert.ok((await resolve('spamfilter', [])).accountIds.includes('account7'));
    await resolve('spamfilter', []);
    const lists = ctx.ctl.calls.filter(c => c.area === 'accounts' && c.op === 'list');
    assert.equal(lists.length, 2);
    assert.ok(lists.every(c => c.includeSubFolders === false));
    ctx.ctl.setAccounts(ACCOUNTS);
});

test('an unreadable account list fails closed: no account', async () => {
    ctx.ctl.failAccounts();
    assert.deepEqual(await resolve('spamfilter', ['account1']), { restricted: true, accountIds: [], managed: true });
    ctx.ctl.setAccounts(ACCOUNTS);
});

test('the resolved ids are never written; the stored selection is untouched', () => {
    const local = ctx.ctl.localData();
    assert.deepEqual(local.spamfilter_enabled_accounts, ['account2']);
    assert.deepEqual(local.add_tags_enabled_accounts, ['account1']);
    assert.equal('spamfilter_enabled_accounts_match' in local, false);
    assert.equal(ctx.ctl.calls.filter(c => c.op === 'set').length, 0);
});

test('the matcher key is covered by the write guard', async () => {
    await ctx.mztaPrefs.setPref('spamfilter_enabled_accounts_match', ['local']);
    assert.equal('spamfilter_enabled_accounts_match' in ctx.ctl.localData(), false);
});

test('removing the policy restores the user selection', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData(), accounts: ACCOUNTS },
        'resolveAccounts', ['spamfilter', ['account2']]);
    assert.deepEqual(r.result, { restricted: true, accountIds: ['account2'], managed: false });
});
