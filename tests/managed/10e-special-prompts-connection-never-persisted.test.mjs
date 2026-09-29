// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Why read-time
// only", "Storage gate", "Secrets" and "Export"; seen from a settings page (the feature pages
// write the whole _special_prompts array back, savePrompt() and clearPromptAPI() do a
// load-modify-save):
//  - the page holds MANAGED_SECRET_MARKER, never the real key;
//  - whatever the page writes, storage keeps the user's api_type and enforced fields;
//  - an unlocked policy default the page merely showed is never stored as the user's value;
//    a value the user typed over it is;
//  - the write guard refuses `${prefix}_${field}` for an enforced field (the pages'
//    saveOptions() writes every panel input under its id);
//  - the marker, the policy values and _connection_by_policy never reach storage or an export;
//  - removing the policy restores the user's override exactly, field by field.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('special-prompts-connection.json');
const sp = (id, extra) => ({ id, text: 'text of ' + id + ' spamValue explanation startDate endDate summary',
    is_default: '1', is_special: '1', show_in: 'context', custom_icon: '', ...extra });
const USER_SPAM = { api_type: 'chatgpt_api', chatgpt_model: 'gpt-user', chatgpt_api_key: 'sk-user-own',
    openai_comp_host: 'http://user-gateway:8080', openai_comp_model: 'user-model' };
const USER_CALENDAR = { api_type: 'ollama_api', ollama_host: 'http://user-ollama:11434', ollama_model: '' };
const STORED = {
    connection_type: 'chatgpt_api',
    _special_prompts: [
        sp('prompt_spamfilter', USER_SPAM),
        sp('prompt_get_calendar_event', USER_CALENDAR),
        sp('prompt_get_calendar_event_from_clipboard', {}),
    ],
};
const OVERRIDE_KEY = /^(api_type|(chatgpt|ollama|openai_comp|google_gemini|anthropic)_)/;
const overrideOf = p => Object.fromEntries(Object.entries(p).filter(([k]) => OVERRIDE_KEY.test(k)));
const SECRETS = ['sk-org-SECRET-spam', 'sk-ant-org-SECRET-sum'];
const POLICY_VALUES = ['https://ai-gateway.example.org', 'gpt-4o-mini', 'claude-org-sum', 'llama-org',
                       'http://ollama.example.org:11434'];

let ctx;

before(async () => {
    ctx = await startPage({ policy: POLICY, local: STORED, sender: SENDERS.featurePage });
});

const stored = id => ctx.ctl.localData()._special_prompts.find(p => p.id === id);
const byId = (list, id) => list.find(p => p.id === id);

function assertStorageClean() {
    const all = JSON.stringify(ctx.ctl.localData());
    for (const v of [...SECRETS, ctx.MANAGED_SECRET_MARKER, ...POLICY_VALUES]) {
        assert.equal(all.includes(v), false, JSON.stringify(v) + ' in storage.local');
    }
    assert.equal(all.includes('_connection_by_policy'), false);
}

test('the page sees the policy connection with the marker, never the real key', async () => {
    const spam = byId(await ctx.prompts.getSpecialPrompts(), 'prompt_spamfilter');
    assert.equal(spam.openai_comp_api_key, ctx.MANAGED_SECRET_MARKER);
    assert.equal(spam.openai_comp_host, 'https://ai-gateway.example.org');
    assert.equal(spam.chatgpt_api_key, 'sk-user-own'); // the user's own key of another provider
    const conn = ctx.mztaManaged.getSpecialPromptConnection('summarize');
    assert.equal(conn.fields.anthropic_api_key.value, ctx.MANAGED_SECRET_MARKER);
    assert.equal(JSON.stringify(ctx.mztaManaged.getSpecialPromptsConnection()).includes('SECRET'), false);
});

test('writing the whole overlaid array back keeps the user\'s override exactly', async () => {
    await ctx.prompts.setSpecialPrompts(await ctx.prompts.getSpecialPrompts());
    assert.deepEqual(overrideOf(stored('prompt_spamfilter')), USER_SPAM);
    assert.deepEqual(overrideOf(stored('prompt_get_calendar_event')), USER_CALENDAR);
    // prompt_summarize was never stored: getSpecialPrompts() added it with the shipped api_type ''.
    assert.deepEqual(overrideOf(stored('prompt_summarize')), { api_type: '' });
    assertStorageClean();
});

test('savePrompt() of the loaded prompt changes nothing either', async () => {
    await ctx.prompts.savePrompt(await ctx.prompts.loadPrompt('prompt_spamfilter'));
    assert.deepEqual(overrideOf(stored('prompt_spamfilter')), USER_SPAM);
    assertStorageClean();
});

test('enforced fields and api_type cannot be changed; clearPromptAPI() cannot clear them', async () => {
    const spam = await ctx.prompts.loadPrompt('prompt_spamfilter');
    spam.api_type = 'anthropic_api';
    spam.openai_comp_host = 'http://sneaky:1';
    spam.openai_comp_temperature = '1.9';
    await ctx.prompts.savePrompt(spam);
    await ctx.prompts.clearPromptAPI('prompt_get_calendar_event');
    const s = stored('prompt_spamfilter');
    assert.equal(s.api_type, 'chatgpt_api');
    assert.equal(s.openai_comp_host, 'http://user-gateway:8080');
    assert.equal('openai_comp_temperature' in s, false);
    const c = stored('prompt_get_calendar_event');
    assert.equal(c.api_type, 'ollama_api');
    assert.equal(c.ollama_host, 'http://user-ollama:11434');
});

test('an unlocked field the user edits is saved; the untouched policy default is not', async () => {
    const cal = await ctx.prompts.loadPrompt('prompt_get_calendar_event');
    assert.equal(cal.ollama_model, 'llama-org'); // the policy default, the user has none
    await ctx.prompts.savePrompt(cal);
    assert.equal(stored('prompt_get_calendar_event').ollama_model, '');
    const spam = await ctx.prompts.loadPrompt('prompt_spamfilter');
    assert.equal(spam.openai_comp_model, 'user-model');
    spam.openai_comp_model = 'user-model-2';
    await ctx.prompts.savePrompt(spam);
    assert.equal(stored('prompt_spamfilter').openai_comp_model, 'user-model-2');
    // and the user's own value is what the page shows from now on
    assert.equal((await ctx.prompts.loadPrompt('prompt_spamfilter')).openai_comp_model, 'user-model-2');
});

test('a stale copy holding the policy default never overwrites the user\'s own value', async () => {
    // What a feature page's text Save does: it writes back the array it loaded at page open.
    const stale = await ctx.prompts.getSpecialPrompts();
    byId(stale, 'prompt_spamfilter').openai_comp_model = 'gpt-4o-mini'; // the unlocked policy default
    delete byId(stale, 'prompt_spamfilter').chatgpt_api_key;            // a field the writer never had
    await ctx.prompts.setSpecialPrompts(stale);
    assert.equal(stored('prompt_spamfilter').openai_comp_model, 'user-model-2');
    assert.equal(stored('prompt_spamfilter').chatgpt_api_key, undefined, 'not a policy field: the writer decides');
    // put the user's other key back for the checks below
    const again = await ctx.prompts.getSpecialPrompts();
    byId(again, 'prompt_spamfilter').chatgpt_api_key = 'sk-user-own';
    await ctx.prompts.setSpecialPrompts(again);
});

test('the write guard refuses the enforced panel fields, not the unlocked ones', async () => {
    await ctx.mztaPrefs.setPref('spamfilter_openai_comp_host', 'https://ai-gateway.example.org');
    await ctx.mztaPrefs.setPrefs({ summarize_anthropic_model: 'claude-org-sum', spamfilter_openai_comp_model: 'm' });
    const local = ctx.ctl.localData();
    assert.equal('spamfilter_openai_comp_host' in local, false);
    assert.equal('summarize_anthropic_model' in local, false);
    assert.equal(local.spamfilter_openai_comp_model, 'm'); // not enforced: as without a policy
    // The implied pair is guarded like any locked preference.
    await ctx.mztaPrefs.setPrefs({ spamfilter_use_specific_integration: false, spamfilter_connection_type: '' });
    assert.equal('spamfilter_use_specific_integration' in ctx.ctl.localData(), false);
    assert.equal('spamfilter_connection_type' in ctx.ctl.localData(), false);
});

test('an export carries neither the policy connection, nor the marker, nor the flag', async () => {
    const list = await ctx.prompts.getSpecialPrompts();
    for (const include of [false, true]) {
        const out = ctx.prompts.preparePromptsForExport(list, include);
        const raw = JSON.stringify(out);
        for (const v of [ctx.MANAGED_SECRET_MARKER, ...POLICY_VALUES, '_connection_by_policy']) {
            assert.equal(raw.includes(v), false, JSON.stringify(v) + ' exported (include_api_settings ' + include + ')');
        }
        assert.equal('api_type' in byId(out, 'prompt_summarize'), false);
    }
});

test('the storage holds no secret, no marker, no policy value', () => assertStorageClean());

test('removing the policy restores the user\'s override field by field', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'specialPrompts');
    const spam = byId(r.result, 'prompt_spamfilter');
    assert.deepEqual(overrideOf(spam), { ...USER_SPAM, openai_comp_model: 'user-model-2' });
    assert.equal(spam._connection_by_policy, undefined);
    assert.deepEqual(overrideOf(byId(r.result, 'prompt_get_calendar_event')), USER_CALENDAR);
    assert.equal(byId(r.result, 'prompt_summarize').api_type, '');
    const prefs = await restart({ policy: null, local: ctx.ctl.localData() }, 'readPrefs',
        ['spamfilter_use_specific_integration', 'spamfilter_connection_type']);
    assert.deepEqual(prefs.result, { spamfilter_use_specific_integration: false, spamfilter_connection_type: 'chatgpt_api' });
});
