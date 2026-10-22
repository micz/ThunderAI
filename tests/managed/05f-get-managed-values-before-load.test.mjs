// Spec 08 "Hydration in every other context": the get_managed_values listener is registered
// before the startup migrations, so a page opened during startup is answered at all - but it
// answers only once loadManaged() has settled (whenLoaded()), never with an empty or partial
// policy. The background context here is one whose policy has NOT been read yet.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserMock, SENDERS } from '../helpers/browser-mock.mjs';
import { captureConsole, loadModules, loadFixture } from '../helpers/load.mjs';
import { extractManagedValuesListener } from '../helpers/background-handler.mjs';

const POLICY = loadFixture('hydration.json');

let mods, listener;

before(async () => {
    const ctl = installBrowserMock({ policy: POLICY });
    captureConsole();
    mods = await loadModules();
    listener = extractManagedValuesListener({
        browser: ctl.browser,
        mztaManaged: mods.mztaManaged,
        MANAGED_SECRET_MARKER: mods.MANAGED_SECRET_MARKER,
        prefs_default: mods.prefs_default,
    });
});

test('a request before loadManaged() waits for it, then gets the whole policy', async () => {
    let settled = false;
    const pending = listener({ command: 'get_managed_values' }, SENDERS.options);
    pending.then(() => { settled = true; });
    // Let every microtask and timer run: nothing has started the load, so it must still wait.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false, 'answered before the policy was read');
    assert.equal(mods.mztaManaged.hasLoaded(), false, 'the listener must not start the load itself');

    await mods.mztaManaged.loadManaged();
    const reply = await pending;
    assert.equal(reply.active, true);
    assert.equal(reply.values.chatgpt_model, 'gpt-org');
    assert.ok(reply.lockedKeys.includes('connection_type'));
});

test('once loaded, a request is answered directly', async () => {
    const reply = await listener({ command: 'get_managed_values' }, SENDERS.options);
    assert.equal(reply.values.chatgpt_model, 'gpt-org');
});
