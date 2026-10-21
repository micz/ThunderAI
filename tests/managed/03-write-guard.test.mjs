// Spec 08 "The write guard": setPref() and setPrefs() skip a locked key with a taLogger
// warning, silently for the caller. setPrefs() skips PER KEY, not atomically. An enforced
// value must never reach storage.local, or it would outlive the policy.
// Spec 08 "Policy-supplied API keys": setPref()/setPrefs() refuse to write
// MANAGED_SECRET_MARKER (per key, like the lock guard).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('write-guard.json');
const STORED = {
    connection_type: 'ollama_api',
    chatgpt_api_key: 'sk-user-own',
    spamfilter: false,
};

let ctx, changes;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
    changes = [];
    ctx.ctl.browser.storage.onChanged.addListener((c, area) => changes.push({ area, keys: Object.keys(c) }));
});

const setCalls = () => ctx.ctl.calls.filter(c => c.area === 'local' && c.op === 'set');
const policyValues = () => Object.entries(POLICY).filter(([k]) => !k.startsWith('_') && !k.includes(':'));

test('setPref on a locked key: skipped, warned, returns normally', async () => {
    ctx.ctl.calls.length = 0;
    ctx.con.clear();
    const ret = await ctx.mztaPrefs.setPref('connection_type', 'anthropic_api');
    assert.equal(ret, undefined);
    assert.equal(setCalls().length, 0);
    assert.equal(ctx.ctl.localData().connection_type, 'ollama_api');
    assert.ok(ctx.con.warnings().some(w => w.includes('connection_type')));
    assert.equal(await ctx.mztaPrefs.getPref('connection_type'), 'chatgpt_api');
});

test('setPref cannot store the policy value itself either', async () => {
    await ctx.mztaPrefs.setPref('spamfilter', true);
    await ctx.mztaPrefs.setPref('default_sign_name', 'ACME Staff');
    const local = ctx.ctl.localData();
    assert.equal(local.spamfilter, false);
    assert.equal('default_sign_name' in local, false);
});

test('setPref on an unlocked policy key writes, and the user value then wins', async () => {
    await ctx.mztaPrefs.setPref('chatgpt_model', 'my-model');
    assert.equal(ctx.ctl.localData().chatgpt_model, 'my-model');
    assert.equal(await ctx.mztaPrefs.getPref('chatgpt_model'), 'my-model');
});

test('setPrefs skips locked keys per key and writes the rest in one operation', async () => {
    ctx.ctl.calls.length = 0;
    ctx.con.clear();
    await ctx.mztaPrefs.setPrefs({
        connection_type: 'anthropic_api',   // locked
        chatgpt_api_key: 'sk-typed',        // locked
        chatgpt_temperature: '0.3',
        chatgpt_developer_messages: 'be brief',
        spamfilter: true,                   // locked
    });
    const sets = setCalls();
    assert.equal(sets.length, 1);
    assert.deepEqual(sets[0].items, { chatgpt_temperature: '0.3', chatgpt_developer_messages: 'be brief' });
    const w = ctx.con.warnings().join('\n');
    for (const k of ['connection_type', 'chatgpt_api_key', 'spamfilter']) assert.ok(w.includes(k), k);
});

test('setPrefs with only locked keys performs no storage write at all', async () => {
    ctx.ctl.calls.length = 0;
    await ctx.mztaPrefs.setPrefs({ connection_type: 'x', spamfilter: true });
    assert.equal(setCalls().length, 0);
});

test('MANAGED_SECRET_MARKER is refused by setPref and, per key, by setPrefs', async () => {
    const M = ctx.MANAGED_SECRET_MARKER;
    await ctx.mztaPrefs.setPref('google_gemini_api_key', M);
    await ctx.mztaPrefs.setPrefs({ anthropic_api_key: M, anthropic_model: 'claude-x' });
    const local = ctx.ctl.localData();
    assert.equal('google_gemini_api_key' in local, false);
    assert.equal('anthropic_api_key' in local, false);
    assert.equal(local.anthropic_model, 'claude-x');
});

test('no storage.onChanged was ever fired for a locked key', () => {
    const locked = new Set(ctx.mztaManaged.getLockedKeys());
    for (const c of changes) {
        for (const k of c.keys) assert.equal(locked.has(k), false, k);
    }
});

test('no policy value ever reached storage.local', () => {
    const local = ctx.ctl.localData();
    for (const [key, value] of policyValues()) {
        assert.notDeepEqual(local[key], value, key + ' holds the policy value');
    }
    const storedValues = JSON.stringify(Object.values(local));
    assert.equal(storedValues.includes('sk-org-SECRET-guard'), false);
    assert.equal(storedValues.includes(ctx.MANAGED_SECRET_MARKER), false);
});

test('removing the policy leaves no residue: the next start sees the user values', async () => {
    const keys = ['connection_type', 'chatgpt_api_key', 'spamfilter', 'default_sign_name',
                  'chatgpt_model', 'chatgpt_temperature'];
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'readPrefs', keys);
    assert.deepEqual(r.result, {
        connection_type: 'ollama_api',
        chatgpt_api_key: 'sk-user-own',
        spamfilter: false,
        default_sign_name: ctx.prefs_default.default_sign_name,
        chatgpt_model: 'my-model',
        chatgpt_temperature: '0.3',
    });
    assert.deepEqual(r.warnings, []);
});
