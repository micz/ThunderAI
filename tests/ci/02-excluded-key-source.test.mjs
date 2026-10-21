// Spec 08 "The allowlist": isPolicyExcludedKey() is the one source of the exclusion rules, used by
// buildAllowlist() and by .github/scripts/policy-keys-diff.mjs. For every key of the real
// prefs_default it must say what the allowlist says: excluded exactly when a policy setting it is
// refused. The allowlist is observed as 04-allowlist-derivation observes it, through a policy that
// sets every key.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/browser-mock.mjs';
import { captureConsole, loadModules } from '../helpers/load.mjs';
import { buildEveryKeyPolicy } from '../fixtures/every-pref-key.mjs';

let m, isPolicyExcludedKey;

before(async () => {
    const { prefs_default } = await import('../../options/mzta-options-default.js');
    installBrowserMock({ policy: buildEveryKeyPolicy(prefs_default) });
    captureConsole();
    m = await loadModules();
    ({ isPolicyExcludedKey } = await import('../../js/mzta-managed.js'));
    await m.mztaManaged.loadManaged();
});

test('isPolicyExcludedKey() agrees with the allowlist on every key of prefs_default', () => {
    const keys = Object.keys(m.prefs_default);
    assert.ok(keys.length > 0);
    for (const key of keys) {
        assert.equal(isPolicyExcludedKey(key), !m.mztaManaged.hasManagedValue(key), key);
    }
    assert.ok(keys.some(isPolicyExcludedKey), 'no excluded key at all');
});
