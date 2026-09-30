// Spec 04 "Per-feature provider override" -> "The API chat window", and spec 08 "Enforced
// per-feature connections (_special_prompts_connection)": openChatGPT() in mzta-background.js,
// which opens the chat window (the summary in webchat display mode, and the prompts with a
// provider override of their own):
//  - resolves a special prompt's connection WITH its feature prefix (getSpecialPromptPrefix()),
//    like the usability check of its caller, so the {prefix}_* pair is not ignored;
//  - runs its configuration checks (empty key, model, host...) on the settings the window will
//    use: the global values with the prompt's own fields on top when the prompt's api_type is the
//    resolved connection (applyPromptConnection(), the rule of api_webchat/controller.js).
// openChatGPT() itself only runs inside the background startup, so it is covered through the two
// functions it calls, plus a check on its source that it calls them.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { backgroundSource, stripComments } from '../helpers/background-handler.mjs';

let ctx;

before(async () => {
    // The summarize connection is enforced (Claude, key and model); the global one is OpenAI with
    // no key at all, as for an organization that only configures the feature.
    ctx = await startBackground({
        policy: loadFixture('special-prompts-connection.json'),
        local: { connection_type: 'chatgpt_api', chatgpt_api_key: '', anthropic_api_key: '' },
    });
});

test('getSpecialPromptPrefix() maps each special prompt to its feature, other prompts to null', () => {
    const p = ctx.prompts.getSpecialPromptPrefix;
    assert.equal(p('prompt_summarize'), 'summarize');
    assert.equal(p('prompt_add_tags'), 'add_tags');
    assert.equal(p('prompt_get_calendar_event'), 'get_calendar_event');
    assert.equal(p('prompt_get_calendar_event_from_clipboard'), 'get_calendar_event');
    assert.equal(p('prompt_translate_this'), 'translate');
    assert.equal(p('prompt_summarize_email_template'), null);
    assert.equal(p('prompt_reply'), null);
    assert.equal(p(undefined), null);
});

test('with the prefix, the pair is honoured even when the prompt carries no api_type', () => {
    const prefs = { connection_type: 'chatgpt_web', summarize_use_specific_integration: true,
                    summarize_connection_type: 'ollama_api' };
    const prompt = { id: 'prompt_summarize', api_type: '' };
    assert.equal(ctx.utils.getConnectionType(prefs, prompt, ctx.prompts.getSpecialPromptPrefix(prompt.id)), 'ollama_api');
    // What openChatGPT() resolved before: the global chatgpt_web, not the checked connection.
    assert.equal(ctx.utils.getConnectionType(prefs, prompt), 'chatgpt_web');
});

test('the checks see the policy connection of the summary, real key included', async () => {
    const prefs = await ctx.mztaPrefs.getAllPrefs();
    const sum = await ctx.prompts.getSummarizePrompt();
    prefs.connection_type = ctx.utils.getConnectionType(prefs, sum, ctx.prompts.getSpecialPromptPrefix(sum.id));
    assert.equal(prefs.connection_type, 'anthropic_api');
    assert.equal(prefs.anthropic_api_key, '', 'global key expected empty in this scenario');
    const checked = ctx.utils.applyPromptConnection(prefs, sum);
    assert.equal(checked.anthropic_api_key, 'sk-ant-org-SECRET-sum');
    assert.equal(checked.anthropic_model, 'claude-org-sum');
    assert.equal(checked.anthropic_version, '2023-06-01');
});

test('applyPromptConnection() applies only a prompt override of the resolved type', () => {
    const prefs = { connection_type: 'ollama_api', ollama_host: 'http://global:11434', ollama_model: 'g',
                    chatgpt_api_key: 'sk-global' };
    // Same type: the prompt's fields win, an undefined one keeps the global value, '' is applied.
    const same = ctx.utils.applyPromptConnection(prefs,
        { api_type: 'ollama_api', ollama_host: 'http://own:11434', ollama_model: '' });
    assert.equal(same.ollama_host, 'http://own:11434');
    assert.equal(same.ollama_model, '');
    assert.equal(same.chatgpt_api_key, 'sk-global');
    // Another type, no override, no prompt: the global values as they are.
    for (const prompt of [{ api_type: 'chatgpt_api', chatgpt_api_key: 'sk-own' }, { api_type: '' }, {}, null]) {
        assert.deepEqual(ctx.utils.applyPromptConnection(prefs, prompt), prefs);
    }
    // It never modifies its argument.
    assert.equal(prefs.ollama_host, 'http://global:11434');
});

test('openChatGPT() resolves with the prefix and checks the combined settings', () => {
    const code = stripComments(backgroundSource());
    const start = code.indexOf('async function openChatGPT(');
    assert.ok(start !== -1, 'openChatGPT() not found');
    // Without this check a missing end marker gives -1, and slice() runs to the end of the file.
    const end = code.indexOf('switch(prefs.connection_type)', start);
    assert.ok(end !== -1, 'the switch(prefs.connection_type) that ends the checked part was not found');
    const body = code.slice(start, end);
    assert.match(body, /getConnectionType\(prefs, prompt_info, getSpecialPromptPrefix\(prompt_info\.id\)\)/);
    assert.match(body, /prefs = applyPromptConnection\(prefs, prompt_info\)/);
});
