// Spec 08 "Enforced special prompt texts (_special_prompts_text)":
//  - Validation: key must be a special prompt id (including the non-menu ones), value a
//    non-empty, non-whitespace string (whitespace allowed for the separator), and the text
//    must satisfy the response contract - a missing response key REJECTS the entry, a
//    missing placeholder only warns at startup (getEnforcedTextPlaceholderProblems()).
//  - Enforced only: "_special_prompts_text:locked" is warned about and ignored.
//  - An enforced prompt_get_calendar_event also applies to the clipboard variant unless the
//    policy names that id too.
//  - Application: a read-time overlay in getSpecialPrompts() (text replaced, _text_by_policy
//    set); never persisted: setSpecialPrompts() puts back the stored text (or the shipped one
//    for a prompt never stored), decided by id, not by the marker. Removing the policy
//    restores the user's text exactly, including a legacy raw i18n key.
//  - Only the text is covered: every other property stays the user's.
//  - "Every shipped text passes the contract."

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const POLICY = loadFixture('special-prompts-text.json');
const T = POLICY._special_prompts_text;
const USER_SPAM_TEXT = 'My own spam text {%mail_html_body%} -> {"explanation": "", "spamValue": 0}';
const STORED_SPECIALS = [
    { id: 'prompt_spamfilter', text: USER_SPAM_TEXT, is_default: '1', is_special: '1', show_in: 'context' },
    // A legacy stored value that is still the raw i18n key.
    { id: 'prompt_get_task', text: 'prompt_get_task_full_text', is_default: '1', is_special: '1', show_in: 'popup' },
];

const ENFORCED = ['prompt_spamfilter', 'prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard',
                  'prompt_get_task', 'prompt_translate_this', 'prompt_summarize_email_separator'];
const REJECTED = ['prompt_add_tags', 'prompt_summarize', 'prompt_summarize_email_template',
                  'prompt_does_not_exist', 'prompt_reply'];

let ctx, warnings;

before(async () => {
    ctx = await startBackground({ policy: POLICY, local: { _special_prompts: STORED_SPECIALS } });
    warnings = ctx.con.warnings();
});

// --- Validation ------------------------------------------------------------------------

test('the valid ids include the non-menu special prompts', () => {
    const ids = ctx.prompts.getSpecialPromptIds();
    for (const id of ['prompt_summarize_email_template', 'prompt_summarize_email_separator',
                      'prompt_get_calendar_event_from_clipboard', 'prompt_spamfilter', 'prompt_add_tags',
                      'prompt_get_calendar_event', 'prompt_get_task', 'prompt_translate_this', 'prompt_summarize']) {
        assert.ok(ids.includes(id), id);
    }
    assert.equal(ids.includes('prompt_reply'), false);
});

test('exactly the valid entries are enforced', () => {
    assert.deepEqual(Object.keys(ctx.mztaManaged.getSpecialPromptsText()).sort(), [...ENFORCED].sort());
    assert.equal(ctx.mztaManaged.isManagedActive(), true);
});

test('each rejected entry is warned about by name', () => {
    for (const id of REJECTED) {
        assert.ok(warnings.some(w => w.includes('"' + id + '"')), 'no warning for ' + id);
    }
});

test('a text missing a response key is rejected, naming the missing key', () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_add_tags'), undefined);
    assert.ok(warnings.some(w => w.includes('prompt_add_tags') && w.includes('"tags"')));
});

test('whitespace is a text only for the separator; the empty string never is', () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_summarize_email_separator'), '   ');
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_summarize'), undefined);
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_summarize_email_template'), undefined);
});

test('the calendar text also applies to the clipboard variant when that id is not named', () => {
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_get_calendar_event_from_clipboard'),
        T.prompt_get_calendar_event);
});

test('"_special_prompts_text:locked" is warned about and ignored: texts stay enforced', () => {
    assert.ok(warnings.some(w => w.includes('_special_prompts_text:locked')));
    assert.equal(ctx.mztaManaged.getSpecialPromptText('prompt_spamfilter'), T.prompt_spamfilter);
});

test('placeholder problems are reported for the startup warning, not rejected', async () => {
    // translate: has the body but not {%thunderai_translate_lang%}. get_task / calendar have
    // no placeholder at all, which is fine: preparePrompt() appends the message.
    const problems = await ctx.prompts.getEnforcedTextPlaceholderProblems();
    assert.deepEqual(problems.map(p => p.id), ['prompt_translate_this']);
    assert.ok(problems[0].problem.includes('thunderai_translate_lang'));
    assert.ok(ctx.mztaManaged.getSpecialPromptText('prompt_translate_this') !== undefined);
});

test('the response contract, row by row (checkSpecialPromptText)', () => {
    const check = ctx.prompts.checkSpecialPromptText;
    const miss = (id, text) => check(id, text).missingResponseKeys;
    assert.deepEqual(miss('prompt_spamfilter', 'give spamValue and explanation'), []);
    assert.deepEqual(miss('prompt_spamfilter', 'give explanation'), ['spamValue']);
    assert.deepEqual(miss('prompt_spamfilter', 'give spamvalue and explanation'), ['spamValue'], 'case-sensitive');
    assert.deepEqual(miss('prompt_spamfilter', 'give spamValues and explanation'), ['spamValue'], 'whole word');
    assert.deepEqual(miss('prompt_add_tags', 'return tags'), []);
    assert.deepEqual(miss('prompt_get_calendar_event', 'startDate endDate'), ['summary']);
    assert.deepEqual(miss('prompt_get_calendar_event_from_clipboard', 'startDate endDate summary'), []);
    assert.deepEqual(miss('prompt_get_task', 'the summary'), []);
    assert.deepEqual(miss('prompt_translate_this', 'subject body'), ['status']);
    assert.deepEqual(miss('prompt_summarize', 'anything'), []);
    assert.deepEqual(miss('prompt_summarize_email_template', 'anything'), []);

    const ph = (id, text) => check(id, text).placeholderProblem;
    const BODY = ['mail_text_body', 'mail_html_body', 'mail_text_body_or_selected', 'mail_html_body_or_selected'];
    for (const b of BODY) {
        assert.equal(ph('prompt_spamfilter', `{%${b}%}`), '', b);
        assert.equal(ph('prompt_add_tags', `{%${b}%}`), '', b);
        assert.equal(ph('prompt_summarize_email_template', `{%${b}%}`), '', b);
    }
    assert.equal(ph('prompt_spamfilter', 'no placeholder at all'), '');
    assert.notEqual(ph('prompt_spamfilter', 'only {%mail_subject%}'), '');
    assert.equal(ph('prompt_get_calendar_event', '{%selected_text%}'), '');
    assert.equal(ph('prompt_get_task', '{%selected_html%}'), '');
    assert.notEqual(ph('prompt_get_task', 'only {%mail_subject%}'), '');
    assert.equal(ph('prompt_translate_this', '{%mail_text_body%} {%thunderai_translate_lang%}'), '');
    assert.notEqual(ph('prompt_translate_this', 'no placeholder {%thunderai_translate_lang%}'), '',
        'translate never appends the message');
    assert.notEqual(ph('prompt_translate_this', '{%mail_text_body_or_selected%} {%thunderai_translate_lang%}'), '');
    assert.equal(ph('prompt_summarize', 'only {%mail_subject%}'), '');
    assert.equal(check('prompt_summarize_email_separator', '  ').blank, false);
    assert.equal(check('prompt_summarize', '  ').blank, true);
});

test('every shipped text passes the contract', async () => {
    const r = await restart({ policy: null, local: {} }, 'specialPrompts');
    for (const p of r.result) {
        const c = ctx.prompts.checkSpecialPromptText(p.id, p.text);
        assert.ok(p.text.length > 0, p.id + ' has no shipped text');
        assert.deepEqual(c.missingResponseKeys, [], p.id);
        assert.equal(c.placeholderProblem, '', p.id);
        assert.equal(c.blank, false, p.id);
    }
});

// --- The read-time overlay -------------------------------------------------------------

test('getSpecialPrompts() overlays the enforced texts and marks them', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    for (const id of ENFORCED) {
        const p = specials.find(s => s.id === id);
        assert.equal(p.text, ctx.mztaManaged.getSpecialPromptText(id), id);
        assert.equal(p._text_by_policy, true, id);
    }
    const tags = specials.find(s => s.id === 'prompt_add_tags');
    assert.equal(tags.text, ctx.ctl.browser.i18n.getMessage('prompt_add_tags_full_text'));
    assert.equal('_text_by_policy' in tags, false);
});

test('the overlay is never persisted: a page saving the whole array keeps the stored texts', async () => {
    await ctx.prompts.setSpecialPrompts(await ctx.prompts.getSpecialPrompts());
    const stored = ctx.ctl.localData()._special_prompts;
    const byId = id => stored.find(p => p.id === id);
    assert.equal(byId('prompt_spamfilter').text, USER_SPAM_TEXT);
    assert.equal(byId('prompt_get_task').text, 'prompt_get_task_full_text');
    assert.equal(byId('prompt_get_calendar_event').text,
        ctx.ctl.browser.i18n.getMessage('prompt_get_calendar_event_full_text'));
    assert.ok(stored.every(p => !('_text_by_policy' in p)));
    for (const text of Object.values(ctx.mztaManaged.getSpecialPromptsText())) {
        if (text.trim() !== '') assert.equal(JSON.stringify(stored).includes(JSON.stringify(text).slice(1, -1)), false);
    }
});

test('the decision is by id, not by the marker: an edited text without the marker is still not saved', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    const spam = specials.find(p => p.id === 'prompt_spamfilter');
    delete spam._text_by_policy;
    spam.text = 'edited while enforced spamValue explanation';
    await ctx.prompts.setSpecialPrompts(specials);
    const stored = ctx.ctl.localData()._special_prompts.find(p => p.id === 'prompt_spamfilter');
    assert.equal(stored.text, USER_SPAM_TEXT);
});

test('only the text is covered: other properties of an enforced prompt are still saved', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    const spam = specials.find(p => p.id === 'prompt_spamfilter');
    spam.show_in = 'none';
    spam.custom_icon = 'star';
    await ctx.prompts.setSpecialPrompts(specials);
    const stored = ctx.ctl.localData()._special_prompts.find(p => p.id === 'prompt_spamfilter');
    assert.equal(stored.show_in, 'none');
    assert.equal(stored.custom_icon, 'star');
    assert.equal(stored.text, USER_SPAM_TEXT);
});

test('export strips _text_by_policy', async () => {
    const out = ctx.prompts.preparePromptsForExport(await ctx.prompts.getSpecialPrompts());
    assert.ok(out.every(p => !('_text_by_policy' in p)));
});

test('a prompt never stored gets the shipped text on save, not the enforced one', async () => {
    const r = await restart({ policy: POLICY, local: {} }, 'saveSpecialPromptsAsIs');
    const stored = r.local._special_prompts;
    assert.equal(stored.find(p => p.id === 'prompt_spamfilter').text,
        ctx.ctl.browser.i18n.getMessage('prompt_spamfilter_full_text'));
    assert.equal(stored.find(p => p.id === 'prompt_get_task').text,
        ctx.ctl.browser.i18n.getMessage('prompt_get_task_full_text'));
    assert.ok(stored.every(p => !('_text_by_policy' in p)));
});

test('removing the policy restores the user texts exactly', async () => {
    const r = await restart({ policy: null, local: ctx.ctl.localData() }, 'specialPrompts');
    const byId = id => r.result.find(p => p.id === id);
    assert.equal(byId('prompt_spamfilter').text, USER_SPAM_TEXT);
    assert.equal(byId('prompt_get_task').text, 'prompt_get_task_full_text');
    assert.ok(r.result.every(p => !('_text_by_policy' in p)));
});
