// Spec 08 "The connection panel" -> "The connection mode": resolveSpecificIntegrationMode() in
// pages/_lib/managed-ui.js decides the mode of a feature's specific-integration panel once, and
// initializeSpecificIntegrationUI() acts only on it. One policy configures each feature
// differently, so every mode is checked in one page context:
//   spamfilter  {prefix}_use_specific_integration locked false          -> locked_off
//   translate   _special_prompts_connection entry                       -> policy
//   add_tags    {prefix}_use_specific_integration locked true, no entry  -> locked_on
//   summarize   {prefix}_use_specific_integration initial true          -> mandatory / free
//   get_task    nothing                                                  -> mandatory / free
// plus a locked {prefix}_connection_type (get_calendar_event), which only sets typeLocked.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, REPO } from '../helpers/load.mjs';

const POLICY = {
    spamfilter_use_specific_integration: false,
    add_tags_use_specific_integration: true,
    summarize_use_specific_integration: true,
    'summarize_use_specific_integration:locked': false,
    get_calendar_event_connection_type: 'ollama_api',
    _special_prompts_connection: {
        translate: { api_type: 'openai_comp_api', openai_comp_host: 'https://ai.example.org' },
    },
};

let resolve;

before(async () => {
    const ctx = await startPage({ policy: POLICY, sender: SENDERS.featurePage });
    await ctx.mztaPrefs.getPref('connection_type'); // the first read hydrates the page
    ({ resolveSpecificIntegrationMode: resolve } =
        await import(new URL('pages/_lib/managed-ui.js', REPO).href));
});

test('locked off: the switch is held off, nothing writes the prompt, never mandatory', () => {
    const m = resolve('spamfilter', 'chatgpt_web');
    assert.equal(m.kind, 'locked_off');
    assert.equal(m.switchValue, false);
    assert.equal(m.writesPrompt, false);
    assert.equal(m.seedsOnOpen, false);
    assert.equal(m.mandatory, false);
});

test('policy connection: the switch is held on, no page-open seeding, never mandatory', () => {
    const m = resolve('translate', 'chatgpt_web');
    assert.equal(m.kind, 'policy');
    assert.equal(m.switchValue, true);
    assert.equal(m.writesPrompt, true, 'the unlocked fields are the user\'s to change');
    assert.equal(m.seedsOnOpen, false);
    assert.equal(m.typeLocked, true, 'the entry implies a locked connection type');
    assert.equal(m.mandatory, false);
});

test('locked on without a policy connection: the switch is held on, the connection is the user\'s', () => {
    for (const global of ['chatgpt_api', 'chatgpt_web', '']) {
        const m = resolve('add_tags', global);
        assert.equal(m.kind, 'locked_on', global);
        assert.equal(m.switchValue, true, 'a re-enabled switch turned off must go back on');
        assert.equal(m.writesPrompt, true);
        assert.equal(m.seedsOnOpen, true);
        assert.equal(m.typeLocked, false);
        assert.equal(m.mandatory, false, 'the managed marker is the explanation, not the mandatory badge');
        assert.equal(m.mandatoryMsgKey, '');
    }
});

test('an initial switch holds nothing: mandatory or free, as without a policy', () => {
    for (const prefix of ['summarize', 'get_task']) {
        assert.equal(resolve(prefix, 'chatgpt_api').kind, 'free', prefix);
        assert.equal(resolve(prefix, 'chatgpt_api').switchValue, null, prefix);
        const web = resolve(prefix, 'chatgpt_web');
        assert.equal(web.kind, 'mandatory', prefix);
        assert.equal(web.mandatory, true);
        assert.equal(web.switchValue, null);
        assert.equal(web.mandatoryMsgKey, 'specific_integration_mandatory_chatgpt_web');
        assert.equal(resolve(prefix, '').mandatoryMsgKey, 'specific_integration_mandatory_no_connection');
    }
});

test('a locked connection type alone only sets typeLocked', () => {
    const m = resolve('get_calendar_event', 'chatgpt_api');
    assert.equal(m.kind, 'free');
    assert.equal(m.typeLocked, true);
});
