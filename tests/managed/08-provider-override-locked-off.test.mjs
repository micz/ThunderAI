// Spec 08 "Interaction points" (per-feature provider override) and 04 "When a policy locks
// the override off":
//  - for every prefix whose {prefix}_use_specific_integration is managed-LOCKED to false,
//    getSpecialPrompts() returns that feature's prompts with api_type '' and every
//    {integration}_{key} override field removed (calendar: the clipboard variant too);
//  - locked-off case only: an unlocked false, a locked true and unmanaged prefixes are
//    unchanged;
//  - a read-time overlay that is never persisted: setSpecialPrompts() puts back exactly the
//    stored override fields, so the override can be neither changed nor cleared while the
//    policy holds, other edits are saved, and it returns untouched when the policy goes;
//  - getIgnoredProviderOverrides() lists each locked-off feature with a stored api_type.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('provider-override.json');
const sp = (id, extra) => ({ id, text: 'text of ' + id + ' spamValue explanation tags startDate endDate summary',
    is_default: '1', is_special: '1', show_in: 'context', ...extra });
const STORED_SPECIALS = [
    sp('prompt_spamfilter', { api_type: 'ollama_api', ollama_host: 'http://user-host:11434', ollama_model: 'llama3' }),
    sp('prompt_get_calendar_event', { api_type: 'chatgpt_api', chatgpt_model: 'gpt-user' }),
    sp('prompt_get_calendar_event_from_clipboard', { api_type: 'chatgpt_api', chatgpt_model: 'gpt-user' }),
    sp('prompt_add_tags', { api_type: 'anthropic_api', anthropic_model: 'claude-user' }),     // unlocked false
    sp('prompt_translate_this', { api_type: 'google_gemini_api', google_gemini_model: 'g-user' }), // locked true
    sp('prompt_get_task', { api_type: 'ollama_api', ollama_model: 'task-model' }),             // not managed
];
const STORED = { connection_type: 'chatgpt_api', _special_prompts: STORED_SPECIALS };

let ctx;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
});

const OVERRIDE_FIELD = /^(chatgpt|ollama|openai_comp|google_gemini|anthropic)_/;
const overrideFields = p => Object.keys(p).filter(k => OVERRIDE_FIELD.test(k) && k !== 'chatgpt_web_model' &&
    k !== 'chatgpt_web_project' && k !== 'chatgpt_web_custom_gpt');
const byId = (list, id) => list.find(p => p.id === id);

test('locked-off features lose their override on read (calendar: both prompts)', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    for (const id of ['prompt_spamfilter', 'prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard']) {
        const p = byId(specials, id);
        assert.equal(p.api_type, '', id);
        assert.deepEqual(overrideFields(p), [], id);
    }
});

test('only the locked-off case is overlaid', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    assert.equal(byId(specials, 'prompt_add_tags').api_type, 'anthropic_api');         // unlocked false
    assert.equal(byId(specials, 'prompt_add_tags').anthropic_model, 'claude-user');
    assert.equal(byId(specials, 'prompt_translate_this').api_type, 'google_gemini_api'); // locked true
    assert.equal(byId(specials, 'prompt_get_task').api_type, 'ollama_api');              // not managed
});

test('getConnectionType() then falls back to the global connection', async () => {
    const prefs = await ctx.mztaPrefs.getPrefs(['connection_type', 'spamfilter_use_specific_integration',
                                                'spamfilter_connection_type']);
    const spam = byId(await ctx.prompts.getSpecialPrompts(), 'prompt_spamfilter');
    assert.equal(ctx.utils.getConnectionType(prefs, spam, 'spamfilter'), 'chatgpt_api');
});

test('the lock itself is guarded', async () => {
    await ctx.mztaPrefs.setPref('spamfilter_use_specific_integration', true);
    assert.equal('spamfilter_use_specific_integration' in ctx.ctl.localData(), false);
    assert.equal(await ctx.mztaPrefs.getPref('spamfilter_use_specific_integration'), false);
});

test('saving the overlaid array keeps the stored override fields exactly', async () => {
    await ctx.prompts.setSpecialPrompts(await ctx.prompts.getSpecialPrompts());
    const stored = ctx.ctl.localData()._special_prompts;
    const spam = byId(stored, 'prompt_spamfilter');
    assert.equal(spam.api_type, 'ollama_api');
    assert.equal(spam.ollama_host, 'http://user-host:11434');
    assert.equal(spam.ollama_model, 'llama3');
    assert.equal(byId(stored, 'prompt_get_calendar_event').chatgpt_model, 'gpt-user');
    assert.equal(byId(stored, 'prompt_get_calendar_event_from_clipboard').api_type, 'chatgpt_api');
});

test('the override can be neither changed nor extended while locked; other edits are saved', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    const spam = byId(specials, 'prompt_spamfilter');
    spam.api_type = 'anthropic_api';
    spam.anthropic_model = 'sneaky';
    spam.show_in = 'none';
    await ctx.prompts.setSpecialPrompts(specials);
    const stored = byId(ctx.ctl.localData()._special_prompts, 'prompt_spamfilter');
    assert.equal(stored.api_type, 'ollama_api');
    assert.equal('anthropic_model' in stored, false);
    assert.equal(stored.ollama_host, 'http://user-host:11434');
    assert.equal(stored.show_in, 'none');
});

test('an unlocked prompt can still change its override', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    byId(specials, 'prompt_add_tags').anthropic_model = 'claude-new';
    await ctx.prompts.setSpecialPrompts(specials);
    assert.equal(byId(ctx.ctl.localData()._special_prompts, 'prompt_add_tags').anthropic_model, 'claude-new');
});

test('getIgnoredProviderOverrides() names each locked-off feature with a stored override', async () => {
    assert.deepEqual((await ctx.prompts.getIgnoredProviderOverrides()).sort(), ['get_calendar_event', 'spamfilter']);
});

test('removing the policy brings the override back untouched', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'specialPrompts');
    const spam = byId(r.result, 'prompt_spamfilter');
    assert.equal(spam.api_type, 'ollama_api');
    assert.equal(spam.ollama_host, 'http://user-host:11434');
    assert.equal(spam.ollama_model, 'llama3');
    assert.equal(byId(r.result, 'prompt_get_calendar_event').api_type, 'chatgpt_api');
});
