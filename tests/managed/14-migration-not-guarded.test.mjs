// Spec 08 "Why the migration is not guarded": the sync -> local preference migration
// (migratePrefsToLocal(), js/mzta-prefs-migration.js) copies what the USER already chose, not
// something the administrator imposed, and is deliberately left outside the write guard. A locked
// policy value wins on every read regardless, so a migrated value is never observable while the
// policy is active. The residual case - a 5.0.x profile, its preferences still in storage.sync,
// and a policy installed - only means the user's own prior value reappears once the policy is
// removed.
//
// In mzta-background.js the migration runs before loadManaged(); here the managed plugin loads the
// policy first. The migration never consults the policy, so the order changes nothing it does.
// The startup sequence itself is the migration area's (tests/migration/).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
    startBackground,
    loadFixture
} from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('migration-not-guarded.json');

// A 5.0.x profile: the user's own choices, still in storage.sync, over every key the policy sets.
const SYNC = {
    connection_type: 'ollama_api',
    chatgpt_model: 'my-model',
    spamfilter: false,
    default_sign_name: 'Mic',
};
const KEYS = Object.keys(SYNC);

let ctx, migrated;

before(async () => {
    ctx = await startBackground({ policy: POLICY, sync: SYNC, local: {} });
    const { migratePrefsToLocal } = await import('../../js/mzta-prefs-migration.js');
    migrated = await migratePrefsToLocal();
});

test('the migration runs under a policy and copies the user\'s own values, locked keys included', () => {
    assert.equal(migrated, true);
    const local = ctx.ctl.localData();
    for (const key of KEYS) assert.deepEqual(local[key], SYNC[key], key);
});

test('no policy value is copied into storage.local', () => {
    const local = ctx.ctl.localData();
    for (const [key, value] of Object.entries(POLICY)) {
        if (key.startsWith('_') || key.includes(':')) continue;
        assert.notDeepEqual(local[key], value, key + ' holds the policy value');
    }
});

test('while the policy is active a migrated value is never observable on a locked key', async () => {
    const prefs = await ctx.mztaPrefs.getPrefs(KEYS);
    assert.equal(prefs.connection_type, 'chatgpt_api');
    assert.equal(prefs.chatgpt_model, 'gpt-org');
    assert.equal(prefs.spamfilter, true);
});

test('on an unlocked key the user\'s migrated value wins over the initial policy value', async () => {
    assert.equal(await ctx.mztaPrefs.getPref('default_sign_name'), 'Mic');
});

test('once the policy is removed, the user\'s own prior values reappear', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'readPrefs', KEYS);
    assert.deepEqual(r.result, SYNC);
    assert.deepEqual(r.warnings, []);
});
