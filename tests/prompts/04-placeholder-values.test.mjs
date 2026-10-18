// Spec 03 "Placeholder Resolution Order" step 3 (getPlaceholdersValues() is demand-driven: only the
// tokens present are resolved), "Built-in Placeholders" (what each value is), the newline contracts
// as far as level 1 sees them ("Newline contract of the compose placeholders", "...of the body
// placeholders": the value the caller extracted reaches the prompt as it is, blank lines of the
// compose placeholders included), "Selection twins" (the `_or_selected` pair), "`mail_text_body` vs
// `mail_plain_text_part`" (the source, `??` not `||`, the whitespace rule, no fallback), and "The
// address placeholders in the compose window" (`??` on field presence, address book references
// dropped, the `author` gap).
//
// The extraction itself (HTML -> lines, the compose DOM walk, selectionTwin()) runs in a DOM and in
// js/mzta-menus.js: not level 1. js/lib/mzta-html-lines.js is the background page's classic script
// (mzta-background.html loads it before the module entry point); it is run here the same way, so
// normalizePlainTextPart() finds its global.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { REPO, repoPath, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('04-placeholder-values');

let ctx, ph;

const ACCOUNTS = [{ id: 'account1', identities: [{ id: 'id1', email: 'me@example.com' }] }];

before(async () => {
    vm.runInThisContext(readFileSync(repoPath('js/lib/mzta-html-lines.js'), 'utf8'), { filename: 'js/lib/mzta-html-lines.js' });
    ctx = await startBackground({
        policy: null,
        accounts: ACCOUNTS,
        // What messages.tags.list() returns, for the paths that supply no tag list.
        tags: [
            { key: '$label1', tag: 'Important', color: '#ff0000', ordinal: '' },
            { key: '$label4', tag: 'Later', color: '#0000ff', ordinal: '' },
        ],
        local: {
            default_sign_name: 'Mic',
            default_chatgpt_lang: 'Italian',
            translate_lang: 'German',
            translate_exclude_lang: 'English',
        },
    });
    ph = (await import(new URL('js/mzta-placeholders.js', REPO).href)).placeholdersUtils;
});

const values = (prompt_text, args = {}) => ph.getPlaceholdersValues({ prompt_text, ...args });
// The text as it reaches the prompt: resolution, then substitution with the default values on, so
// a value the || chain drops shows as '' rather than as the raw token.
const resolve = async (text, args = {}, use_default_value = true) =>
    ph.replacePlaceholders({ text, replacements: await values(text, args), use_default_value });

// --- Demand-driven ------------------------------------------------------------------------------

k.test('only-present-tokens', 'only the tokens present in the prompt get a value', async () => {
    const subs = await values('Subject: {%mail_subject%}', { mail_subject: 'S', body_text: 'B', selection_text: 'T' });
    assert.deepEqual(subs, { mail_subject: 'S' });
});

k.test('no-token-no-value', 'a prompt with no token resolves nothing', async () => {
    assert.deepEqual(await values('Plain prompt.', { mail_subject: 'S', body_text: 'B' }), {});
});

k.test('prefs-read-on-demand', 'a preference-backed placeholder reads its preference only when present', async () => {
    const reads = () => ctx.ctl.calls.filter(c => c.area === 'local' && c.op === 'get' &&
        JSON.stringify(c.keys).includes('default_sign_name')).length;
    const before = reads();
    await values('{%mail_subject%}', { mail_subject: 'S' });
    assert.equal(reads(), before, 'no token, no read');
    await values('{%thunderai_def_sign%}');
    assert.ok(reads() > before, 'the token reads it');
});

// --- Sources ------------------------------------------------------------------------------------

k.test('body-verbatim', '{%mail_text_body%} is the extracted body, its lines as they are', async () => {
    assert.equal(await resolve('{%mail_text_body%}', { body_text: 'Line one\nLine two\nLine three' }),
        'Line one\nLine two\nLine three');
});

k.test('compose-keep-paragraphs', 'the compose placeholders keep the blank line between paragraphs', async () => {
    const text = 'First paragraph,\nsecond line.\n\nSecond paragraph.';
    assert.equal(await resolve('{%mail_typed_text%}', { only_typed_text: text }), text);
    assert.equal(await resolve('{%mail_quoted_text%}', { only_quoted_text: '> a\n>\n> b' }), '> a\n>\n> b');
});

k.test('html-body', '{%mail_html_body%} is the HTML body', async () => {
    assert.equal(await resolve('{%mail_html_body%}', { msg_text: { html: '<p>Hi</p>', text: 'Hi' } }), '<p>Hi</p>');
});

k.test('selection', '{%selected_text%} / {%selected_html%} are the selection twins', async () => {
    const args = { selection_text: 'sel', selection_html: '<b>sel</b>', body_text: 'body', msg_text: { html: '<p>body</p>' } };
    assert.equal(await resolve('{%selected_text%}|{%selected_html%}', args), 'sel|<b>sel</b>');
});

k.test('body-ignores-selection', '{%mail_text_body%} / {%mail_html_body%} are the body even with a selection', async () => {
    const args = { selection_text: 'sel', selection_html: '<b>sel</b>', body_text: 'body', msg_text: { html: '<p>body</p>' } };
    assert.equal(await resolve('{%mail_text_body%}|{%mail_html_body%}', args), 'body|<p>body</p>');
});

k.test('or-selected-prefers-selection', 'the _or_selected pair is the selection when there is one', async () => {
    const args = { selection_text: 'sel', selection_html: '<b>sel</b>', body_text: 'body', msg_text: { html: '<p>body</p>' } };
    assert.equal(await resolve('{%mail_text_body_or_selected%}|{%mail_html_body_or_selected%}', args), 'sel|<b>sel</b>');
});

k.test('or-selected-falls-back', 'with no selection the _or_selected pair is the body', async () => {
    const args = { body_text: 'body', msg_text: { html: '<p>body</p>' } };
    assert.equal(await resolve('{%mail_text_body_or_selected%}|{%mail_html_body_or_selected%}', args), 'body|<p>body</p>');
});

k.test('subject', '{%mail_subject%} is the subject', async () => {
    assert.equal(await resolve('{%mail_subject%}', { mail_subject: 'Quarterly report' }), 'Quarterly report');
});

k.test('header-fields', 'folder name and path, date and junk score come from the message header', async () => {
    const curr_message = { folder: { name: 'Inbox', path: '/Inbox' }, date: '2026-10-05T10:00:00Z', junkScore: 87 };
    assert.equal(await resolve('{%mail_folder_name%}|{%mail_folder_path%}|{%mail_datetime%}|{%junk_score%}', { curr_message }),
        'Inbox|/Inbox|2026-10-05T10:00:00Z|87');
});

k.test('junk-score-zero', 'a junk score of 0 reaches the prompt as 0 (with the default values on)', async () => {
    assert.equal(await resolve('{%junk_score%}', { curr_message: { junkScore: 0 } }), '0');
});

k.test('prefs-placeholders', 'the four preference placeholders are their preferences', async () => {
    assert.equal(await resolve('{%thunderai_def_sign%}|{%thunderai_def_lang%}|{%thunderai_translate_lang%}|{%thunderai_translate_exclude_lang%}'),
        'Mic|Italian|German|English');
});

k.test('translate-lang-fallback', '{%thunderai_translate_lang%} falls back on default_chatgpt_lang', async () => {
    await ctx.mztaPrefs.setPref('translate_lang', '');
    try {
        assert.equal(await resolve('{%thunderai_translate_lang%}'), 'Italian');
    } finally {
        await ctx.mztaPrefs.setPref('translate_lang', 'German');
    }
});

k.test('tags-full-list', '{%tags_full_list%} is the tag list the caller supplies', async () => {
    assert.equal(await resolve('{%tags_full_list%}', { tags_full_list: ['Important, Work', {}] }), 'Important, Work');
});

k.test('tags-current-email', '{%tags_current_email%} names the tags on the email', async () => {
    const out = await resolve('{%tags_current_email%}', {
        curr_message: { tags: ['$label1'] },
        tags_full_list: ['Important', { $label1: { tag: 'Important' } }],
    });
    assert.equal(out, 'Important');
});

// Spec 03 "Value formats".

k.test('tags-current-email-names', '{%tags_current_email%}: the tag names, joined with ", "', async () => {
    const out = await resolve('{%tags_current_email%}', {
        curr_message: { tags: ['$label1', '$label4'] },
        tags_full_list: ['Important, Later', { $label1: { tag: 'Important' }, $label4: { tag: 'Later' } }],
    });
    assert.equal(out, 'Important, Later');
});

k.test('tags-unknown-key-raw', 'a tag key not in the list (deleted tag) is kept as its raw key, never an error', async () => {
    const out = await resolve('[{%tags_current_email%}]', {
        curr_message: { tags: ['$gone', '$label1'] },
        tags_full_list: ['Important', { $label1: { tag: 'Important' } }],
    });
    assert.equal(out, '[$gone, Important]');
});

k.test('tags-no-tags-field', 'an email without tags, or a ComposeDetails (no tags field), gives an empty value', async () => {
    assert.equal(await resolve('[{%tags_current_email%}]', { curr_message: { tags: [] } }), '[]');
    assert.equal(await resolve('[{%tags_current_email%}]', { curr_message: { to: ['a@example.com'] } }), '[]');
});

k.test('tags-list-read-when-missing', 'with no tag list from the caller, the list is read from Thunderbird, once', async () => {
    const reads = () => ctx.ctl.calls.filter(c => c.area === 'messages.tags' && c.op === 'list').length;
    const before = reads();
    const out = await resolve('{%tags_current_email%}|{%tags_full_list%}', { curr_message: { tags: ['$label1', '$gone'] } });
    assert.equal(out, 'Important, $gone|Important, Later');
    assert.equal(reads() - before, 1, 'one read for both placeholders');
    await resolve('{%mail_subject%}', { mail_subject: 'S', curr_message: { tags: ['$label1'] } });
    assert.equal(reads() - before, 1, 'no tag placeholder, no read');
});

k.test('address-escaped', 'author, recipients and cc_list have < and > escaped, and nothing else', async () => {
    const curr_message = { author: 'Mic <m@example.com>', recipients: ['A & B <ab@example.com>'], ccList: ['"C" <c@example.com>'] };
    assert.equal(await resolve('{%author%}|{%recipients%}|{%cc_list%}', { curr_message }),
        'Mic &lt;m@example.com&gt;|A & B &lt;ab@example.com&gt;|"C" &lt;c@example.com&gt;');
});

k.test('not-escaped', 'the other placeholders carry their value unescaped', async () => {
    const args = { mail_subject: 'Re: <draft> & more', body_text: 'a < b', selection_html: '<b>x</b>', msg_text: { html: '<p>y</p>' } };
    assert.equal(await resolve('{%mail_subject%}|{%mail_text_body%}|{%selected_html%}|{%mail_html_body%}', args),
        'Re: <draft> & more|a < b|<b>x</b>|<p>y</p>');
});

k.test('mail-datetime-date', '{%mail_datetime%}: a Date reaches the prompt as its toString()', async () => {
    const date = new Date(2026, 9, 5, 10, 30);
    assert.equal(await resolve('{%mail_datetime%}', { curr_message: { date } }), date.toString());
});

k.test('empty', '{%empty%} resolves to nothing, with the default values on or off', async () => {
    assert.equal(await resolve('[{%empty%}]'), '[]');
    assert.equal(await resolve('[{%empty%}]', {}, false), '[]');
});

k.test('current-datetime', '{%current_datetime%} is a non-empty date', async () => {
    const out = await resolve('{%current_datetime%}');
    assert.ok(out.length > 0 && !Number.isNaN(Date.parse(out)), out);
});

k.test('account-email', '{%account_email_address%} is the address of the matching identity', async () => {
    const curr_message = { author: 'me@example.com', recipients: [], ccList: [], bccList: [] };
    assert.equal(await resolve('{%account_email_address%}', { curr_message }), 'me@example.com');
});

// --- The address placeholders -------------------------------------------------------------------

k.test('recipients-reading', 'reading: recipients and cc_list from the MessageHeader, joined with ", "', async () => {
    const curr_message = { recipients: ['a@example.com', 'b@example.com'], ccList: ['c@example.com'] };
    assert.equal(await resolve('{%recipients%}|{%cc_list%}', { curr_message }), 'a@example.com, b@example.com|c@example.com');
});

k.test('cc-empty-no-fallthrough', 'an empty ccList is the value: no fall-through to a ComposeDetails field', async () => {
    const curr_message = { recipients: ['a@example.com'], ccList: [], cc: ['stray@example.com'] };
    assert.equal(await resolve('[{%cc_list%}]', { curr_message }), '[]');
});

k.test('recipients-composing', 'composing: to / cc from the ComposeDetails', async () => {
    const curr_message = { to: ['a@example.com'], cc: ['c@example.com', 'd@example.com'] };
    assert.equal(await resolve('{%recipients%}|{%cc_list%}', { curr_message }), 'a@example.com|c@example.com, d@example.com');
});

k.test('address-book-refs-dropped', 'address book references are dropped, never "[object Object]"', async () => {
    const curr_message = {
        to: ['a@example.com', { id: 'contact1', type: 'contact' }],
        cc: [{ id: 'list1', type: 'mailingList' }],
    };
    assert.equal(await resolve('{%recipients%}|[{%cc_list%}]', { curr_message }), 'a@example.com|[]');
});

k.test('author-reading', 'reading: {%author%} is the sender', async () => {
    assert.equal(await resolve('{%author%}', { curr_message: { author: 'sender@example.com' } }), 'sender@example.com');
});

k.test('author-composing-gap', 'composing: {%author%} is empty (the documented gap)', async () => {
    assert.equal(await resolve('[{%author%}]', { curr_message: { to: ['a@example.com'], from: 'me@example.com' } }), '[]');
});

// --- mail_plain_text_part ---------------------------------------------------------------------

k.test('plain-part-preferred', 'the explicit plain_part wins over msg_text.text', async () => {
    assert.equal(await resolve('{%mail_plain_text_part%}', { msg_text: { plain_part: 'part', text: 'scrape' } }), 'part');
});

k.test('plain-part-automatic-path', 'with no plain_part field, msg_text.text is the part (automatic paths)', async () => {
    assert.equal(await resolve('{%mail_plain_text_part%}', { msg_text: { text: 'inline part' } }), 'inline part');
});

k.test('plain-part-empty-wins', 'an empty plain_part wins over msg_text.text (??, never the DOM scrape)', async () => {
    const msg_text = { plain_part: '', text: 'scrape', html: '<p>scrape</p>' };
    assert.equal(await resolve('[{%mail_plain_text_part%}]', { msg_text }), '[]');
    assert.equal(await resolve('[{%mail_plain_text_part%}]', { msg_text }, false), '[{%mail_plain_text_part%}]',
        'with the default values off the literal token survives');
});

k.test('plain-part-no-html-fallback', 'no text/plain part: empty, never the HTML conversion', async () => {
    const out = await resolve('[{%mail_plain_text_part%}]', { msg_text: { html: '<p>Hi</p>' }, body_text: 'Hi' });
    assert.equal(out, '[]');
});

k.test('plain-part-whitespace', 'only CRLF/CR, a leading BOM and trailing whitespace are touched', async () => {
    const part = '﻿Item      Qty\tPrice  \r\n\r\n\r\n  Widget    2\t9.90 EUR \rTotal\t \n\n\n';
    const expected = 'Item      Qty\tPrice\n\n\n  Widget    2\t9.90 EUR\nTotal';
    assert.equal(await resolve('{%mail_plain_text_part%}', { msg_text: { plain_part: part } }), expected);
});

k.test('missing-sources-are-empty', 'a placeholder whose source the caller did not supply is empty', async () => {
    const subs = await values('{%mail_text_body%}{%mail_html_body%}{%selected_text%}{%mail_subject%}{%mail_typed_text%}');
    assert.deepEqual(subs, { mail_text_body: '', mail_html_body: '', selected_text: '', mail_subject: '', mail_typed_text: '' });
});

k.coverage();
