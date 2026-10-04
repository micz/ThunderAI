// Spec 02 "Translate: Inline-Only Prompt System" (buildTranslationPrompt(fullMessage, messageId): the
// prompt_translate_this text, its placeholders resolved by the standard system; the target language
// is translate_lang, falling back to default_chatgpt_lang), spec 03 "Placeholder Resolution Order",
// "Who supplies the values" (Translation: msg_text and mail_subject only - no body_text, so
// {%mail_text_body%} is empty there), spec 02 "Summarize: Dual-Mode Prompt System"
// (getSummaryLang(): chatgpt_lang and force_lang_statement), and "Missing special prompts"
// (getDefaultLang() of a missing prompt is '', issue #855).
//
// buildTranslationPrompt() reads the body with messages.listInlineTextParts(), which the core mock
// does not model: it is added for this file only through startPage({decorate}), as the attachments
// file does. The parts are text/plain only, so getMailInlineTextParts() synthesizes the HTML with
// the background's classic script js/lib/mzta-html-lines.js (run here as mzta-background.html
// does) and needs no DOMParser. buildSummaryPrompt() always converts HTML to text, which needs a
// DOM: it is not covered at level 1.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { REPO, repoPath, startPage } from '../helpers/core/load.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('23-translation-summary');

const PARTS = { 42: [{ contentType: 'text/plain', content: 'Ciao Bob,\ngrazie.' }] };
const FULL_MESSAGE = { headers: { subject: ['Riunione di lunedi'] } };

let ctx, u, prompts;

before(async () => {
    vm.runInThisContext(readFileSync(repoPath('js/lib/mzta-html-lines.js'), 'utf8'), { filename: 'js/lib/mzta-html-lines.js' });
    ctx = await startPage({
        policy: null,
        sender: SENDERS.popup,
        local: { default_chatgpt_lang: 'Italian', translate_lang: 'German', translate_exclude_lang: 'English' },
        decorate(ctl) {
            ctl.browser.messages.listInlineTextParts = async (id) => structuredClone(PARTS[id] ?? []);
        },
    });
    u = (await import(new URL('js/mzta-utils-prompt.js', REPO).href)).taPromptUtils;
    prompts = ctx.prompts;
});

const msg = id => ctx.ctl.browser.i18n.getMessage(id);
const setPrefs = obj => ctx.ctl.browser.storage.local.set(obj);

// --- buildTranslationPrompt() -------------------------------------------------------------------

k.test('translate-shipped', 'the shipped translate prompt, every placeholder resolved', async () => {
    await setPrefs({ translate_lang: 'German', translate_exclude_lang: 'English' });
    const { promptText, promptInfo } = await u.buildTranslationPrompt(FULL_MESSAGE, 42);
    assert.equal(promptInfo.id, 'prompt_translate_this');
    const expected = msg('prompt_translate_this_full_text')
        .split('{%thunderai_translate_lang%}').join('German')
        .split('{%thunderai_translate_exclude_lang%}').join('English')
        .split('{%mail_subject%}').join('Riunione di lunedi')
        .split('{%mail_html_body%}').join('Ciao Bob,<br>grazie.');
    assert.equal(promptText, expected);
});

k.test('translate-lang-fallback', 'translate_lang empty: the target language is default_chatgpt_lang', async () => {
    await setPrefs({ translate_lang: '', translate_exclude_lang: 'English' });
    const { promptText } = await u.buildTranslationPrompt(FULL_MESSAGE, 42);
    assert.ok(promptText.includes('into Italian.'), promptText.slice(0, 80));
    assert.equal(promptText.includes('{%thunderai_translate_lang%}'), false, 'no unresolved target language');
});

k.test('translate-empty-values', 'an empty exclusion list or subject is sent empty, never as the token, whatever the preference', async () => {
    for (const placeholders_use_default_value of [false, true]) {
        await setPrefs({ translate_lang: 'German', translate_exclude_lang: '', placeholders_use_default_value });
        const { promptText } = await u.buildTranslationPrompt({ headers: { subject: [] } }, 42);
        assert.equal(promptText.includes('{%'), false, `use_default_value ${placeholders_use_default_value}: ${promptText}`);
        assert.ok(promptText.includes('one of these languages "" or in the German language'), promptText);
        assert.ok(promptText.includes('Mail subject: \n'), promptText);
    }
    await setPrefs({ translate_exclude_lang: 'English', placeholders_use_default_value: false });
});

k.test('translate-no-body-text', 'the translation path supplies no body_text: {%mail_text_body%} gets no body', async () => {
    await setPrefs({ translate_lang: 'German' });
    await prompts.saveSpecialPromptTexts({ prompt_translate_this: 'Into {%thunderai_translate_lang%}: {%mail_subject%} / {%mail_text_body%} status subject body' });
    const { promptText } = await u.buildTranslationPrompt(FULL_MESSAGE, 42);
    assert.ok(promptText.startsWith('Into German: Riunione di lunedi / '), promptText);
    assert.equal(promptText.includes('Ciao Bob'), false, promptText);
});

k.test('translate-user-text', 'a user text of prompt_translate_this is the one used', async () => {
    await prompts.saveSpecialPromptTexts({ prompt_translate_this: 'To {%thunderai_translate_lang%}: {%mail_html_body%} subject body status' });
    const { promptText } = await u.buildTranslationPrompt(FULL_MESSAGE, 42);
    assert.equal(promptText, 'To German: Ciao Bob,<br>grazie. subject body status');
});

// --- getDefaultLang() ---------------------------------------------------------------------------

k.test('default-lang-missing-prompt', 'a missing special prompt yields "" (no forced language), never a throw', async () => {
    assert.equal(await u.getDefaultLang(undefined), '');
    assert.equal(await u.getDefaultLang(null), '');
});

k.test('default-lang-off', 'define_response_lang "0": no language statement', async () => {
    assert.equal(await u.getDefaultLang({ define_response_lang: '0' }), '');
});

k.test('default-lang-on', 'define_response_lang "1": a statement naming default_chatgpt_lang', async () => {
    await setPrefs({ default_chatgpt_lang: 'Italian' });
    const lang = await u.getDefaultLang({ define_response_lang: '1' });
    assert.ok(lang.includes('Italian'), lang);
});

// --- getSummaryLang() ---------------------------------------------------------------------------

k.test('summary-lang-off', 'summarize_force_lang off: chatgpt_lang is getDefaultLang(), no forced statement', async () => {
    await setPrefs({ summarize_force_lang: false, summarize_lang: 'French', default_chatgpt_lang: 'Italian' });
    const summarize = (await prompts.getSpecialPrompts()).find(p => p.id === 'prompt_summarize');
    assert.deepEqual(await u.getSummaryLang(summarize), { chatgpt_lang: await u.getDefaultLang(summarize), force_lang_statement: '' });
    assert.deepEqual(await u.getSummaryLang(summarize), { chatgpt_lang: '', force_lang_statement: '' }, 'define_response_lang is "0"');
});

k.test('summary-lang-forced', 'summarize_force_lang on: "prompt_summarize_force_lang LANG.", chatgpt_lang ""', async () => {
    await setPrefs({ summarize_force_lang: true, summarize_lang: 'French', default_chatgpt_lang: 'Italian' });
    assert.deepEqual(await u.getSummaryLang({ define_response_lang: '1' }),
        { chatgpt_lang: '', force_lang_statement: msg('prompt_summarize_force_lang') + ' French.' });
});

k.test('summary-lang-forced-fallback', 'summarize_lang empty: default_chatgpt_lang', async () => {
    await setPrefs({ summarize_force_lang: true, summarize_lang: '', default_chatgpt_lang: 'Italian' });
    assert.deepEqual(await u.getSummaryLang({ define_response_lang: '0' }),
        { chatgpt_lang: '', force_lang_statement: msg('prompt_summarize_force_lang') + ' Italian.' });
});

k.test('summary-lang-forced-none', 'both languages empty: nothing forced, never reply_same_lang', async () => {
    await setPrefs({ summarize_force_lang: true, summarize_lang: '', default_chatgpt_lang: '' });
    assert.deepEqual(await u.getSummaryLang({ define_response_lang: '1' }), { chatgpt_lang: '', force_lang_statement: '' });
});

k.coverage();
