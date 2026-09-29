// Spec 08 "The allowlist", "Validation", "The lock convention", "Structural keys":
//  - excluded keys (per-machine / per-profile state) and unknown keys are skipped with a
//    taLogger.warn() and never applied;
//  - every value is checked against the TYPE of its prefs_default counterpart, never coerced;
//  - an array preference with a non-string element is rejected AS A WHOLE;
//  - every key present is enforced, "<key>:locked": false downgrades it to an initial value,
//    a ":locked" modifier without a value is warned about and ignored;
//  - {feature}_enabled_accounts_match is allowed while {feature}_enabled_accounts is excluded;
//  - API key values are masked in all log output.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('validation.json');
const STORED = { chatgpt_win_width: 640, custom_prompts_view: 'split', spamfilter_threshold: 55 };

let ctx, warnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
    warnings = ctx.con.warnings();
});

const warnedAbout = key => warnings.some(w => w.includes('"' + key + '"') || w.includes('"' + key + ':locked"'));

const REJECTED = {
    excluded: ['chatgpt_win_width', 'chatgpt_win_save_position', 'spamfilter_enabled_accounts',
               'add_tags_enabled_accounts', 'api_webchat_font_scale', 'custom_prompts_view'],
    unknown: ['no_such_pref'],
    wrongType: ['spamfilter', 'spamfilter_threshold', 'calendar_timezone', 'google_gemini_api_key',
                'spamfilter_skip_addresses'],
    arrayWithNonString: ['summarize_auto_senders_list'],
};

for (const [why, keys] of Object.entries(REJECTED)) {
    test('rejected (' + why + '): never applied, each warned about by name', () => {
        for (const key of keys) {
            assert.equal(ctx.mztaManaged.hasManagedValue(key), false, key);
            assert.equal(ctx.mztaManaged.isManagedLocked(key), false, key);
            assert.ok(warnedAbout(key), 'no warning for ' + key);
        }
    });
}

test('rejected values are not coerced: reads keep the stored value or the default', async () => {
    const p = ctx.mztaPrefs;
    assert.equal(await p.getPref('spamfilter'), ctx.prefs_default.spamfilter);         // not "true" -> true
    assert.equal(await p.getPref('spamfilter_threshold'), 55);                         // not "80" -> 80
    assert.deepEqual(await p.getPref('summarize_auto_senders_list'), []);              // not filtered to ["boss@..."]
    assert.equal(await p.getPref('chatgpt_win_width'), 640);
    assert.equal(await p.getPref('custom_prompts_view'), 'split');
});

test('an excluded key stays writable by the user', async () => {
    await ctx.mztaPrefs.setPref('chatgpt_win_width', 900);
    assert.equal(ctx.ctl.localData().chatgpt_win_width, 900);
});

test('valid values of every type are accepted', () => {
    const mm = ctx.mztaManaged;
    assert.equal(mm.getManagedValue('add_tags_maxnum'), 4);
    assert.deepEqual(mm.getManagedValue('add_tags_exclusions'), ['Important', 'Work']);
    assert.equal(mm.getManagedValue('connection_type'), 'chatgpt_api');
    assert.equal(mm.getManagedValue('hide_thinking'), false);
});

test('the _match counterpart of an excluded key is allowed', () => {
    assert.deepEqual(ctx.mztaManaged.getManagedValue('spamfilter_enabled_accounts_match'), ['@acme.example']);
});

test('lock convention: present = enforced, ":locked": false = initial, ":locked": true = enforced', () => {
    const mm = ctx.mztaManaged;
    assert.equal(mm.isManagedLocked('default_sign_name'), true);
    assert.equal(mm.isManagedLocked('add_tags_maxnum'), true);
    assert.equal(mm.isManagedLocked('reply_type'), false);
    assert.equal(mm.hasManagedValue('reply_type'), true);
    assert.equal(mm.isManagedLocked('translate_lang'), true);
});

test('a ":locked" modifier whose target has no value is warned about and ignored', () => {
    assert.ok(warnedAbout('diff_granularity'));
    assert.equal(ctx.mztaManaged.hasManagedValue('diff_granularity'), false);
    assert.equal(ctx.mztaManaged.isManagedLocked('diff_granularity'), false);
});

test('a non-boolean ":locked" modifier is warned about; only false downgrades, so the key stays enforced', () => {
    assert.ok(warnedAbout('hide_thinking'));
    assert.equal(ctx.mztaManaged.isManagedLocked('hide_thinking'), true);
});

test('an unknown structural key is warned about', () => {
    assert.ok(warnedAbout('_not_a_structural_key'));
});

test('warnings use taLogger.warn (not debug-gated) and never print an API key value', () => {
    assert.ok(warnings.length > 0);
    for (const e of ctx.con.entries) {
        assert.equal(e.msg.includes('AIza-LEAK-in-a-wrong-type'), false, 'leaked: ' + e.msg);
    }
});

test('no key of prefs_default starts with an underscore', () => {
    assert.deepEqual(Object.keys(ctx.prefs_default).filter(k => k.startsWith('_')), []);
});
