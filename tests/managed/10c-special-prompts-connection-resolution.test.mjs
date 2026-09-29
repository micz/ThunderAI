// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "Lock semantics",
// "Implied preferences", "Overlay" and "Startup warning"; spec 04 "When a policy supplies the
// override". In the background:
//  - an accepted entry implies {prefix}_use_specific_integration = true and
//    {prefix}_connection_type = api_type, both locked, whatever the user stored;
//  - getSpecialPrompts() overlays the feature's prompts (calendar: both of them): api_type is
//    the policy's, an enforced field always wins, an unlocked field only fills a prompt value
//    that is absent or '', other fields stay the user's; the prompt is marked
//    _connection_by_policy; a feature the policy does not name is untouched;
//  - getConnectionType() resolves the policy connection with or without the prompt;
//  - the overlay reaches initWorker() with the REAL key (the background holds it);
//  - getReplacedProviderOverrides() names every stored value an enforced one replaces.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture, REPO } from '../helpers/load.mjs';

const POLICY = loadFixture('special-prompts-connection.json');
const sp = (id, extra) => ({ id, text: 'text of ' + id + ' spamValue explanation startDate endDate summary',
    is_default: '1', is_special: '1', show_in: 'context', custom_icon: '', ...extra });
const STORED_SPECIALS = [
    sp('prompt_spamfilter', { api_type: 'chatgpt_api', chatgpt_model: 'gpt-user',
        openai_comp_host: 'http://user-gateway:8080', openai_comp_model: 'user-model' }),
    sp('prompt_get_calendar_event', { api_type: 'ollama_api', ollama_host: 'http://user-ollama:11434',
        ollama_model: '' }),
    sp('prompt_get_calendar_event_from_clipboard', {}),
    sp('prompt_translate_this', { api_type: 'google_gemini_api', google_gemini_model: 'g-user' }),
];
const STORED = {
    connection_type: 'chatgpt_api',
    chatgpt_api_key: 'sk-user-global',
    spamfilter_use_specific_integration: false,
    spamfilter_connection_type: 'chatgpt_api',
    _special_prompts: STORED_SPECIALS,
};

let ctx;
const posted = [];
let savedWorker;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: STORED });
    // mzta_specialCommand creates a Web Worker; record what initWorker() sends it.
    savedWorker = globalThis.Worker;
    globalThis.Worker = class {
        constructor(url) { this.url = String(url); }
        postMessage(m) { posted.push(m); }
        terminate() {}
    };
});
after(() => { globalThis.Worker = savedWorker; });

const byId = (list, id) => list.find(p => p.id === id);
const specials = () => ctx.prompts.getSpecialPrompts();

test('each entry implies its preference pair, locked', async () => {
    const m = ctx.mztaManaged;
    for (const [prefix, type] of [['spamfilter', 'openai_comp_api'], ['summarize', 'anthropic_api'],
                                  ['get_calendar_event', 'ollama_api']]) {
        assert.equal(m.getManagedValue(prefix + '_use_specific_integration'), true, prefix);
        assert.equal(m.isManagedLocked(prefix + '_use_specific_integration'), true, prefix);
        assert.equal(m.getManagedValue(prefix + '_connection_type'), type, prefix);
        assert.equal(m.isManagedLocked(prefix + '_connection_type'), true, prefix);
    }
    // ... and they resolve over the user's stored pair.
    const prefs = await ctx.mztaPrefs.getPrefs(['spamfilter_use_specific_integration', 'spamfilter_connection_type']);
    assert.deepEqual(prefs, { spamfilter_use_specific_integration: true, spamfilter_connection_type: 'openai_comp_api' });
    assert.equal(m.hasManagedValue('translate_connection_type'), false);
    assert.equal(m.isManagedActive(), true);
});

test('the enforced control ids are `${prefix}_${field}` for the locked fields only', () => {
    const ids = ctx.mztaManaged.getEnforcedConnectionControlIds().sort();
    assert.deepEqual(ids, [
        'get_calendar_event_ollama_host', 'get_calendar_event_ollama_think',
        'spamfilter_openai_comp_api_key', 'spamfilter_openai_comp_host', 'spamfilter_openai_comp_temperature',
        'summarize_anthropic_api_key', 'summarize_anthropic_max_tokens', 'summarize_anthropic_model',
        'summarize_anthropic_version',
    ]);
    assert.equal(ctx.mztaManaged.isEnforcedConnectionControl('spamfilter_openai_comp_model'), false);
    // Not preferences: they never become lock-list entries.
    assert.equal(ctx.mztaManaged.getLockedKeys().includes('spamfilter_openai_comp_host'), false);
});

test('enforced fields win, an unlocked one yields to a stored value, the rest stays the user\'s', async () => {
    const spam = byId(await specials(), 'prompt_spamfilter');
    assert.equal(spam.api_type, 'openai_comp_api');
    assert.equal(spam.openai_comp_host, 'https://ai-gateway.example.org'); // enforced over the stored one
    assert.equal(spam.openai_comp_api_key, 'sk-org-SECRET-spam');           // the real key, background
    assert.equal(spam.openai_comp_temperature, '0.2');
    assert.equal(spam.openai_comp_model, 'user-model');                    // unlocked: the stored value wins
    assert.equal(spam.chatgpt_model, 'gpt-user');                          // another provider's field, untouched
    assert.equal(spam._connection_by_policy, true);
});

test('an unlocked field fills a prompt value that is empty; the calendar pair is overlaid together', async () => {
    const list = await specials();
    for (const id of ['prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard']) {
        const p = byId(list, id);
        assert.equal(p.api_type, 'ollama_api', id);
        assert.equal(p.ollama_host, 'http://ollama.example.org:11434', id);
        assert.equal(p.ollama_model, 'llama-org', id);
        assert.equal(p.ollama_think, true, id);
        assert.equal(p._connection_by_policy, true, id);
    }
});

test('a prompt never stored gets the whole connection (summarize: prompt_summarize only)', async () => {
    const list = await specials();
    const sum = byId(list, 'prompt_summarize');
    assert.equal(sum.api_type, 'anthropic_api');
    assert.equal(sum.anthropic_model, 'claude-org-sum');
    assert.equal(sum.anthropic_max_tokens, 2048);
    for (const id of ['prompt_summarize_email_template', 'prompt_summarize_email_separator']) {
        assert.equal(byId(list, id).api_type, '', id);
        assert.equal(byId(list, id)._connection_by_policy, undefined, id);
    }
});

test('a feature the policy does not name is untouched', async () => {
    const tr = byId(await specials(), 'prompt_translate_this');
    assert.equal(tr.api_type, 'google_gemini_api');
    assert.equal(tr._connection_by_policy, undefined);
});

test('getConnectionType() resolves the policy connection, with or without the prompt', async () => {
    const prefs = await ctx.mztaPrefs.getAllPrefs();
    const spam = byId(await specials(), 'prompt_spamfilter');
    assert.equal(ctx.utils.getConnectionType(prefs, null, 'spamfilter'), 'openai_comp_api');
    assert.equal(ctx.utils.getConnectionType(prefs, spam, 'spamfilter'), 'openai_comp_api');
    // openChatGPT() passes the prompt without a prefix: the overlaid api_type decides.
    assert.equal(ctx.utils.getConnectionType(prefs, spam), 'openai_comp_api');
});

test('initWorker() receives the policy connection with the real key', async () => {
    const { mzta_specialCommand } = await import(new URL('js/mzta-special-commands.js', REPO).href);
    const spam = byId(await specials(), 'prompt_spamfilter');
    const prefs = await ctx.mztaPrefs.getAllPrefs();
    const cmd = new mzta_specialCommand({
        prompt: 'x', llm: ctx.utils.getConnectionType(prefs, spam, 'spamfilter'), config: spam,
    });
    posted.length = 0;
    await cmd.initWorker();
    assert.equal(posted.length, 1);
    const init = posted[0];
    assert.equal(init.openai_comp_host, 'https://ai-gateway.example.org');
    assert.equal(init.openai_comp_api_key, 'sk-org-SECRET-spam');
    assert.equal(init.openai_comp_model, 'user-model');
    assert.equal(init.openai_comp_temperature, '0.2');
    assert.notEqual(init.openai_comp_api_key, ctx.MANAGED_SECRET_MARKER);
});

test('getReplacedProviderOverrides() names each stored value an enforced one replaces', async () => {
    const replaced = (await ctx.prompts.getReplacedProviderOverrides())
        .map(r => r.prefix + ':' + r.field).sort();
    // spamfilter: its api_type and host are replaced; its model is unlocked, so it is not.
    // get_calendar_event: the stored api_type is already ollama_api; the host is replaced.
    assert.deepEqual(replaced, ['get_calendar_event:ollama_host', 'spamfilter:api_type', 'spamfilter:openai_comp_host']);
});
