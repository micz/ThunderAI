// Spec 08 "The allowlist": derived from Object.keys(prefs_default) minus four exclusion
// rules, nothing else hardcoded; "103 of 112 keys are policy-settable", the nine excluded
// ones being window geometry, account ids, the webchat font zoom and the custom prompts view.
//
// If this fails only on the counts after a preference was added, the derivation is fine and
// the spec's numbers (and the key reference on micz.it) need updating.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/browser-mock.mjs';
import { captureConsole, loadModules } from '../helpers/load.mjs';
import { buildEveryKeyPolicy } from '../fixtures/every-pref-key.mjs';

let m, con, keys;

const EXCLUDED = key =>
    /^chatgpt_win_/.test(key) || /_enabled_accounts$/.test(key) ||
    key === 'api_webchat_font_scale' || key === 'custom_prompts_view';

before(async () => {
    const { prefs_default } = await import('../../options/mzta-options-default.js');
    installBrowserMock({ policy: buildEveryKeyPolicy(prefs_default) });
    con = captureConsole();
    m = await loadModules();
    await m.mztaManaged.loadManaged();
    keys = Object.keys(m.prefs_default);
});

test('every key outside the four exclusion rules is accepted', () => {
    for (const key of keys.filter(k => !EXCLUDED(k))) {
        assert.equal(m.mztaManaged.hasManagedValue(key), true, key);
    }
});

test('every key matched by an exclusion rule is refused, with a warning', () => {
    const warnings = con.warnings().join('\n');
    for (const key of keys.filter(EXCLUDED)) {
        assert.equal(m.mztaManaged.hasManagedValue(key), false, key);
        assert.ok(warnings.includes('"' + key + '"'), 'no warning for ' + key);
    }
});

test('the generated keys are covered by the derivation', () => {
    for (const k of ['spamfilter_use_specific_integration', 'translate_connection_type',
                     'anthropic_max_tokens', 'ollama_host', 'openai_comp_use_v1']) {
        assert.equal(m.mztaManaged.hasManagedValue(k), true, k);
    }
});

test('the counts in the spec hold: 103 of 112, nine excluded', () => {
    assert.equal(keys.length, 112, 'prefs_default size changed: update spec 08 "The allowlist"');
    assert.equal(keys.filter(k => m.mztaManaged.hasManagedValue(k)).length, 103);
    assert.deepEqual(keys.filter(EXCLUDED).sort(), [
        'add_tags_enabled_accounts', 'api_webchat_font_scale', 'chatgpt_win_height',
        'chatgpt_win_left', 'chatgpt_win_save_position', 'chatgpt_win_top', 'chatgpt_win_width',
        'custom_prompts_view', 'spamfilter_enabled_accounts',
    ]);
});
