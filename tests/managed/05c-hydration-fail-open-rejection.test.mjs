// Spec 08 "Hydration in every other context": hydration FAILS OPEN. A rejected sendMessage leaves the
// context unmanaged, with a taLogger.warn(); nothing is retried.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, loadFixture } from '../helpers/load.mjs';

const STORED = { connection_type: 'ollama_api', chatgpt_model: 'user-model' };

let ctx;

before(async () => {
    ctx = await startPage({
        policy: loadFixture('hydration.json'),
        local: STORED,
        sender: SENDERS.options,
        remote: () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });
});

test('reads resolve as an unmanaged context: stored value, else default', async () => {
    assert.deepEqual(await ctx.mztaPrefs.getPrefs(['connection_type', 'chatgpt_model', 'default_sign_name']), {
        connection_type: 'ollama_api',
        chatgpt_model: 'user-model',
        default_sign_name: ctx.prefs_default.default_sign_name,
    });
    assert.deepEqual(ctx.mztaManaged.getLockedKeys(), []);
});

test('the failure is warned about', () => {
    assert.ok(ctx.con.warnings().some(w => /hydrate/i.test(w)), ctx.con.warnings().join('\n'));
});

test('nothing is retried', async () => {
    await ctx.mztaPrefs.getPref('connection_type');
    await ctx.mztaPrefs.setPref('reply_type', 'reply_sender');
    assert.equal(ctx.ctl.sent.filter(m => m.command === 'get_managed_values').length, 1);
});

test('the page never falls back to storage.managed', () => {
    // The single read is the background instance's own loadManaged().
    assert.equal(ctx.ctl.calls.filter(c => c.area === 'managed').length, 1);
});

test('writes go through unguarded, as without a policy', async () => {
    await ctx.mztaPrefs.setPref('connection_type', 'anthropic_api');
    assert.equal(ctx.ctl.localData().connection_type, 'anthropic_api');
});
