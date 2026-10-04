// Spec 02 export / import: preparePromptsForExport(prompts, include_api_settings = false) must keep
// every per-prompt API setting out of the file ("Per-Prompt API Override Properties": api_type,
// chatgpt_web_model / _project / _custom_gpt, and every chatgpt_*, ollama_*, openai_comp_*,
// google_gemini_*, anthropic_* key) - a credential in a shared export is a privacy bug;
// need_custom_text is exported for a
// built-in prompt ("The five boolean flags are normalized on read"). preparePromptsForImport():
// merges onto the complete management view, maps a legacy enabled 0 to show_in "none", and
// normalizes the flags with no fallback ("a backup file carries whatever the writing version used").
// No policy: the transient flags and the policy connection on export are spec 08a/08b.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('15-export-import');

let ctx, p, integrationKeys;

// One credential and one setting per provider, on a custom prompt and on a built-in one.
const API = {
    api_type: 'ollama_api',
    chatgpt_web_model: 'gpt-web', chatgpt_web_project: 'https://chatgpt.com/g/p', chatgpt_web_custom_gpt: 'https://chatgpt.com/g/g',
    chatgpt_api_key: 'sk-secret-chatgpt', chatgpt_model: 'gpt-x',
    ollama_api_key: 'secret-ollama', ollama_host: 'http://user:11434', ollama_model: 'llama3',
    openai_comp_api_key: 'secret-comp', openai_comp_host: 'http://comp',
    google_gemini_api_key: 'secret-gemini', google_gemini_model: 'gemini',
    anthropic_api_key: 'secret-anthropic', anthropic_model: 'claude',
};

const CUSTOM = {
    id: 'prompt_user', name: 'Mine', text: 'Mine {%mail_subject%}', type: '1', action: '1',
    need_selected: '0', need_signature: '1', need_custom_text: '0', define_response_lang: '1', use_diff_viewer: '0',
    is_default: '0', is_special: '0', show_in: 'both', custom_icon: 'star.png', ...API,
};

before(async () => {
    ctx = await startBackground({
        policy: null,
        local: {
            _custom_prompt: [structuredClone(CUSTOM)],
            _default_prompts_properties: {
                prompt_reply: { position_display: 2, position_compose: 3, position_context: 4, need_custom_text: '1',
                                show_in: 'context', custom_icon: 'mail.png', api_type: 'ollama_api',
                                chatgpt_web_model: 'gpt-web', chatgpt_web_project: 'p', chatgpt_web_custom_gpt: 'g' },
            },
        },
    });
    p = ctx.prompts;
    const { integration_options_config } = ctx.defaults;
    integrationKeys = Object.entries(integration_options_config)
        .flatMap(([integration, options]) => Object.keys(options).map(key => `${integration}_${key}`));
});

const exportAll = async (include) => JSON.parse(JSON.stringify(
    p.preparePromptsForExport(await p.getPromptsForManagement(), include)));
const byId = (list, id) => list.find(x => x.id === id);

// --- Export without the API settings ------------------------------------------------------------

k.test('integration-keys-sanity', 'the provider keys of the spec are among the integration keys', () => {
    for (const key of ['chatgpt_api_key', 'ollama_api_key', 'ollama_host', 'openai_comp_api_key', 'google_gemini_api_key', 'anthropic_api_key']) {
        assert.ok(integrationKeys.includes(key), key);
    }
});

k.test('no-credentials', 'no API key of any provider is in the export', async () => {
    const text = JSON.stringify(await exportAll(false));
    for (const secret of Object.values(API).filter(v => /secret/.test(v))) assert.equal(text.includes(secret), false, secret);
    for (const prompt of await exportAll(false)) {
        for (const key of Object.keys(prompt)) assert.equal(/api_key/.test(key), false, `${prompt.id}.${key}`);
    }
});

k.test('no-api-settings', 'no api_type and no provider setting is in the export', async () => {
    for (const prompt of await exportAll(false)) {
        assert.equal('api_type' in prompt, false, prompt.id);
        for (const key of integrationKeys) assert.equal(key in prompt, false, `${prompt.id}.${key}`);
    }
});

k.test('no-api-settings-chatgpt-web', 'no ChatGPT Web override (model, project, custom GPT) is in the export', async () => {
    for (const prompt of await exportAll(false)) {
        for (const key of ['chatgpt_web_model', 'chatgpt_web_project', 'chatgpt_web_custom_gpt']) {
            assert.equal(key in prompt, false, `${prompt.id}.${key}`);
        }
    }
});

k.test('api-settings-chatgpt-web', 'with the API settings on, every prompt exports its three ChatGPT Web overrides', async () => {
    const out = await exportAll(true);
    const mine = byId(out, 'prompt_user');
    assert.deepEqual([mine.chatgpt_web_model, mine.chatgpt_web_project, mine.chatgpt_web_custom_gpt],
        [API.chatgpt_web_model, API.chatgpt_web_project, API.chatgpt_web_custom_gpt]);
    const reply = byId(out, 'prompt_reply');
    assert.deepEqual([reply.chatgpt_web_model, reply.chatgpt_web_project, reply.chatgpt_web_custom_gpt], ['gpt-web', 'p', 'g']);
    assert.equal(reply.api_type, 'ollama_api');
});

k.test('api-settings-chatgpt-web-import', 'a built-in prompt imported with them gets them back in its stored properties', async () => {
    const imported = await p.preparePromptsForImport(await exportAll(true));
    await p.setDefaultPromptsProperties(imported.filter(x => x.is_default === '1'));
    const stored = ctx.ctl.localData()._default_prompts_properties.prompt_reply;
    assert.deepEqual([stored.chatgpt_web_model, stored.chatgpt_web_project, stored.chatgpt_web_custom_gpt], ['gpt-web', 'p', 'g']);
});

k.test('default-argument', 'include_api_settings defaults to false', async () => {
    const list = await p.getPromptsForManagement();
    assert.deepEqual(JSON.parse(JSON.stringify(p.preparePromptsForExport(list))), await exportAll(false));
});

k.test('export-does-not-mutate', 'the prompts handed to the export are not modified', async () => {
    const list = await p.getPromptsForManagement();
    const copy = structuredClone(list);
    p.preparePromptsForExport(list, false);
    assert.deepEqual(list, copy);
});

k.test('custom-content-kept', 'a custom prompt is exported with its content and display properties', async () => {
    const mine = byId(await exportAll(false), 'prompt_user');
    for (const key of ['name', 'text', 'type', 'action', 'need_signature', 'define_response_lang', 'show_in', 'custom_icon', 'is_default']) {
        assert.equal(mine[key], CUSTOM[key], key);
    }
});

k.test('default-need-custom-text', 'a built-in prompt is exported with need_custom_text and its display properties', async () => {
    const reply = byId(await exportAll(false), 'prompt_reply');
    assert.equal(reply.need_custom_text, '1');
    assert.equal(reply.show_in, 'context');
    assert.deepEqual([reply.position_display, reply.position_compose, reply.position_context], [2, 3, 4]);
    assert.equal('text' in reply, false, 'never the prompt text');
});

// --- Import ---------------------------------------------------------------------------------------

k.test('round-trip', 'an export imported back gives the same prompts, content and display properties', async () => {
    const before = await p.getPromptsForManagement();
    const imported = await p.preparePromptsForImport(await exportAll(false));
    assert.deepEqual(imported.map(x => x.id).sort(), before.map(x => x.id).sort());
    const mine = byId(imported, 'prompt_user');
    for (const key of ['name', 'text', 'type', 'action', 'show_in', 'custom_icon', ...p.promptBooleanFlags]) {
        assert.equal(mine[key], CUSTOM[key], key);
    }
    const reply = byId(imported, 'prompt_reply');
    assert.deepEqual([reply.position_display, reply.position_compose, reply.position_context, reply.show_in, reply.need_custom_text],
        [2, 3, 4, 'context', '1']);
});

k.test('import-adds-new', 'a prompt the profile does not have is added', async () => {
    const imported = await p.preparePromptsForImport([
        { id: 'prompt_from_backup', name: 'B', text: 'B', type: '0', action: '0', is_default: '0', is_special: '0', show_in: 'popup' },
    ]);
    assert.ok(byId(imported, 'prompt_from_backup'));
    assert.equal(imported.length, (await p.getPromptsForManagement()).length + 1);
});

k.test('import-complete-set', 'the result starts from every prompt of the profile, so none is dropped', async () => {
    const imported = await p.preparePromptsForImport([]);
    assert.deepEqual(imported.map(x => x.id).sort(), (await p.getPromptsForManagement()).map(x => x.id).sort());
});

k.test('import-legacy-enabled', 'a legacy backup with enabled 0 imports as show_in "none", without enabled', async () => {
    const imported = await p.preparePromptsForImport([
        { id: 'prompt_legacy', name: 'L', text: 'L', type: '0', action: '0', is_default: '0', is_special: '0', show_in: 'both', enabled: 0 },
        { id: 'prompt_legacy_on', name: 'L2', text: 'L2', type: '0', action: '0', is_default: '0', is_special: '0', show_in: 'both', enabled: '1' },
    ]);
    assert.equal(byId(imported, 'prompt_legacy').show_in, 'none');
    assert.equal(byId(imported, 'prompt_legacy_on').show_in, 'both');
    for (const prompt of imported) assert.equal('enabled' in prompt, false, prompt.id);
});

k.test('import-flags-no-fallback', 'imported flags are canonical; out of domain is "0", even for a built-in', async () => {
    const imported = await p.preparePromptsForImport([
        { id: 'prompt_numbers', name: 'N', text: 'N', type: '0', action: '0', is_default: '0', is_special: '0',
          need_selected: 1, need_signature: 0, need_custom_text: '', define_response_lang: true },
        { id: 'prompt_reply_custom_command', need_custom_text: '' },
    ]);
    const numbers = byId(imported, 'prompt_numbers');
    assert.deepEqual(p.promptBooleanFlags.map(f => numbers[f]), p.promptBooleanFlags.map(f =>
        ({ need_selected: '1', need_signature: '0', need_custom_text: '0', define_response_lang: '1', use_diff_viewer: '0' })[f]));
    assert.equal(byId(imported, 'prompt_reply_custom_command').need_custom_text, '0');
});

k.coverage();
