// Spec 03 "Placeholder Resolution Order" (steps 4-5: replacePlaceholders() substitutes each {%id%}
// token looked up in defaultPlaceholders; an unresolved value becomes default_value when
// placeholders_use_default_value is on, else the raw token stays), "Adding a New Built-in
// Placeholder" (the array entry is mandatory; an empty string cannot be expressed; the spaced form
// {% id %} is accepted, also by hasPlaceholder() / hasCustomPlaceholder()), "`mail_text_body` vs
// `mail_plain_text_part`" ("What an absent part actually looks like": the || chain), "Dynamic
// Placeholders", and the additional_text late fill ("Who supplies the values":
// skip_additional_text: true).

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('02-replace-placeholders');

let ph;

before(async () => {
    await startBackground({ policy: null });
    ph = (await import(new URL('js/mzta-placeholders.js', REPO).href)).placeholdersUtils;
});

const replace = (text, replacements = {}, opts = {}) => ph.replacePlaceholders({ text, replacements, ...opts });

// --- replacePlaceholders() --------------------------------------------------------------------

k.test('replace-known', 'a built-in token is replaced by its value', () => {
    assert.equal(replace('Subject: {%mail_subject%}.', { mail_subject: 'Hello' }), 'Subject: Hello.');
});

k.test('replace-every-occurrence', 'every occurrence of a token is replaced', () => {
    assert.equal(replace('{%mail_subject%}/{%mail_subject%}', { mail_subject: 'S' }), 'S/S');
});

k.test('replace-spaced', 'the spaced form {% id %} is replaced like {%id%}', () => {
    assert.equal(replace('[{% mail_subject %}]', { mail_subject: 'S' }), '[S]');
});

k.test('replace-value-verbatim', 'the value is inserted verbatim, replacement patterns included', () => {
    assert.equal(replace('{%mail_subject%}', { mail_subject: "costs $& and $1 and $$" }), "costs $& and $1 and $$");
    assert.equal(replace('{%mail_text_body%}', { mail_text_body: 'a\n\nb\t c' }), 'a\n\nb\t c');
});

k.test('replace-unknown-id-stays', 'an id with no defaultPlaceholders entry stays raw, even with a value', () => {
    assert.equal(replace('{%not_a_placeholder%}', { not_a_placeholder: 'X' }), '{%not_a_placeholder%}');
    assert.equal(replace('{%not_a_placeholder%}', {}, { use_default_value: true }), '{%not_a_placeholder%}');
});

k.test('replace-custom-token-stays', 'a custom data placeholder token is not resolved here (expanded before)', () => {
    assert.equal(replace('{%thunderai_custom_sig%}', { thunderai_custom_sig: 'X' }), '{%thunderai_custom_sig%}');
});

k.test('unresolved-default-off', 'an unresolved token stays raw with use_default_value off', () => {
    assert.equal(replace('a {%mail_subject%} b', {}), 'a {%mail_subject%} b');
});

k.test('unresolved-default-on', 'an unresolved token becomes its default_value with use_default_value on', () => {
    assert.equal(replace('a {%mail_subject%} b', {}, { use_default_value: true }), 'a  b');
    assert.equal(replace('score {%junk_score%}', {}, { use_default_value: true }), 'score 0');
});

k.test('empty-string-is-unresolved', 'an empty string value counts as unresolved (the || chain)', () => {
    assert.equal(replace('[{%mail_plain_text_part%}]', { mail_plain_text_part: '' }), '[{%mail_plain_text_part%}]');
    assert.equal(replace('[{%mail_plain_text_part%}]', { mail_plain_text_part: '' }, { use_default_value: true }), '[]');
});

k.test('empty-placeholder', '{%empty%} always resolves to nothing, whatever use_default_value says', () => {
    for (const use_default_value of [true, false]) {
        assert.equal(replace('[{%empty%}]', { empty: '' }, { use_default_value }), '[]', String(use_default_value));
        assert.equal(replace('[{% empty %}]', {}, { use_default_value }), '[]', 'with no value supplied: ' + use_default_value);
    }
});

k.test('dynamic-value-per-token', 'each dynamic token gets the value stored under id:value', () => {
    const out = replace('{%mail_headers:X-A%}|{%mail_headers:X-B%}', { 'mail_headers:X-A': 'one', 'mail_headers:X-B': 'two' });
    assert.equal(out, 'one|two');
});

k.test('dynamic-unresolved', 'an unresolved dynamic token falls back like any other', () => {
    assert.equal(replace('[{%mail_headers:X-A%}]', {}), '[{%mail_headers:X-A%}]');
    assert.equal(replace('[{%mail_headers:X-A%}]', {}, { use_default_value: true }), '[]');
});

k.test('skip-additional-text', 'skip_additional_text keeps every additional_text token for the late fill', () => {
    const text = 'A {%additional_text%} B {%additional_text:tone%} C {%mail_subject%}';
    const subs = { additional_text: 'X', 'additional_text:tone': 'Y', mail_subject: 'S' };
    assert.equal(replace(text, subs, { skip_additional_text: true, use_default_value: true }),
        'A {%additional_text%} B {%additional_text:tone%} C S');
});

k.test('late-fill-additional-text', 'the late fill (skip off) replaces the additional_text tokens', () => {
    const text = 'A {%additional_text:tone%} B';
    assert.equal(replace(text, { 'additional_text:tone': 'formal' }), 'A formal B');
});

k.test('no-args', 'no arguments, or no text, give an empty string', () => {
    assert.equal(ph.replacePlaceholders(), '');
    assert.equal(ph.replacePlaceholders({}), '');
});

// --- hasPlaceholder() -------------------------------------------------------------------------

k.test('has-any', 'with no id it tells whether the text holds any token', () => {
    assert.equal(ph.hasPlaceholder('plain text'), false);
    assert.equal(ph.hasPlaceholder('x {%mail_subject%} y'), true);
    assert.equal(ph.hasPlaceholder('x {% anything %} y'), true);
    assert.equal(ph.hasPlaceholder('x {% unterminated'), false);
});

k.test('has-specific', 'with an id it finds exactly that token', () => {
    assert.equal(ph.hasPlaceholder('{%mail_typed_text%}', 'mail_typed_text'), true);
    assert.equal(ph.hasPlaceholder('{%mail_subject%}', 'mail_typed_text'), false);
});

k.test('has-specific-spaced', 'the spaced form {% id %} is found (the \\\\s escaping)', () => {
    assert.equal(ph.hasPlaceholder('a {% mail_plain_text_part %} b', 'mail_plain_text_part'), true);
    assert.equal(ph.hasPlaceholder('a {%  mail_typed_text%} b', 'mail_typed_text'), true);
});

k.test('has-specific-dynamic', 'a dynamic token with its value counts as the id', () => {
    assert.equal(ph.hasPlaceholder('{%additional_text:tone%}', 'additional_text'), true);
    assert.equal(ph.hasPlaceholder('{% additional_text:tone %}', 'additional_text'), true);
});

k.test('has-specific-not-a-prefix', 'an id is not found inside a longer id', () => {
    assert.equal(ph.hasPlaceholder('{%mail_text_body_or_selected%}', 'mail_text_body'), false);
    assert.equal(ph.hasPlaceholder('{%mail_html_body_or_selected%}', 'mail_html_body'), false);
});

// --- hasCustomPlaceholder() -------------------------------------------------------------------

k.test('has-custom-any', 'with no id it finds any {%thunderai_custom_...%} token', () => {
    assert.equal(ph.hasCustomPlaceholder('{%thunderai_custom_sig%}'), true);
    assert.equal(ph.hasCustomPlaceholder('{% thunderai_custom_sig %}'), true);
    assert.equal(ph.hasCustomPlaceholder('{%mail_subject%}'), false);
    assert.equal(ph.hasCustomPlaceholder('thunderai_custom_sig'), false);
});

k.test('has-custom-specific', 'with an id it finds that token, spaced form included', () => {
    assert.equal(ph.hasCustomPlaceholder('{% thunderai_custom_sig %}', 'thunderai_custom_sig'), true);
    assert.equal(ph.hasCustomPlaceholder('{%thunderai_custom_other%}', 'thunderai_custom_sig'), false);
});

// --- getPlaceholdersAdditionalTextArray() -----------------------------------------------------
// Spec "Dynamic Placeholders": {%additional_text:my_field_id%} shows an input field labelled
// "my_field_id" in the popup. So: one field per distinct label, in order of appearance.

k.test('additional-text-fields', 'one input field per distinct additional_text label, in order', () => {
    const fields = ph.getPlaceholdersAdditionalTextArray(
        'A {%additional_text:tone%} B {%additional_text:length%} C {% additional_text:tone %}');
    assert.deepEqual(fields.map(f => f.info), ['tone', 'length']);
});

k.test('additional-text-entry-shape', 'each field is {placeholder: the token as written, info: the trimmed label}', () => {
    assert.deepEqual(ph.getPlaceholdersAdditionalTextArray('A {% additional_text:tone %} B {%additional_text:#1%}'), [
        { placeholder: '{% additional_text:tone %}', info: 'tone' },
        { placeholder: '{%additional_text:#1%}', info: '#1' },
    ]);
});

k.test('additional-text-renumbered', 'the bare tokens renumbered by preparePrompt() are one field each', () => {
    const fields = ph.getPlaceholdersAdditionalTextArray('A {%additional_text:#1%} B {%additional_text:#2%} C {%additional_text:tone%}');
    assert.deepEqual(fields.map(f => f.info), ['#1', '#2', 'tone']);
});

k.test('spaced-colon-replaced', 'a dynamic token with spaces around the colon gets the value keyed id:value', () => {
    assert.equal(replace('{%mail_headers : X-A%}|{%mail_headers: X-A%}', { 'mail_headers:X-A': 'one' }), 'one|one');
});

k.test('has-specific-spaced-colon', 'hasPlaceholder() finds a dynamic token with spaces around the colon', () => {
    assert.equal(ph.hasPlaceholder('{%additional_text : tone%}', 'additional_text'), true);
});

// The chat window's late fill (api_webchat/controller.js) keys each answer by the token as written.
const lateFill = (text, answers, use_default_value = false) => {
    const fields = ph.getPlaceholdersAdditionalTextArray(text);
    const subs = Object.fromEntries(fields.map((f, i) => [f.placeholder.replace(/^{%|%}$/g, '').trim(), answers[i]]));
    return replace(text, subs, { use_default_value });
};

k.test('late-fill-spellings', 'one label spelled with and without spaces is one field, and every spelling is filled', () => {
    const text = 'A {%additional_text: tone %} B {%additional_text:tone%} C {%additional_text :tone%}';
    assert.equal(ph.getPlaceholdersAdditionalTextArray(text).length, 1);
    assert.equal(lateFill(text, ['formal']), 'A formal B formal C formal');
});

k.test('late-fill-empty-answer', 'an empty answer becomes empty, never the literal token, whatever the default values say', () => {
    for (const use_default_value of [false, true]) {
        assert.equal(lateFill('A [{%additional_text:tone%}] B', ['']), 'A [] B', String(use_default_value));
    }
});

k.test('late-fill-unanswered', 'a token with no answer at all still follows the || chain', () => {
    assert.equal(replace('[{%additional_text:tone%}]', {}), '[{%additional_text:tone%}]');
    assert.equal(replace('[{%additional_text:tone%}]', {}, { use_default_value: true }), '[]');
});

k.test('additional-text-none', 'no additional_text token, no field', () => {
    assert.deepEqual(ph.getPlaceholdersAdditionalTextArray('{%mail_subject%}'), []);
});

k.coverage();
