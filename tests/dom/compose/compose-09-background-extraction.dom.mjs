// Group C: the background page's side of reading and writing a mail body. An empty document at the
// background page's url, with js/lib/mzta-html-lines.js loaded as the classic script
// mzta-background.html loads before its module (spec 01 "The rich-text layer": js/mzta-utils.js
// reaches it through globalThis), and js/mzta-utils.js / js/mzta-utils-prompt.js imported into it.
// browser.messages.listInlineTextParts() answers from MESSAGES below, by message id.
//
// Spec 01 "htmlBodyToPlainText() injects the line structure before reading it", "Hidden elements",
// "Non-breaking spaces", "Where the body comes from - listInlineTextParts()", "The text/HTML rule"
// (the background html keeps hidden markup), "The rich-text layer" (the plain-text fallbacks call
// cleanupNewlines()), "Writing into a plain text compose window" (stripHtmlKeepLines()).
// Spec 03 "Newline contract of the body placeholders" (the two paths in step), "`mail_text_body` vs
// `mail_plain_text_part`" (the plain part verbatim but for CRLF, a BOM and trailing whitespace).
// Spec 07 "Into a plain text compose window" (stripHtmlKeepLines() on the picker's <p>/<li>/<br>).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    fixture,
    openBackgroundDocument,
} from '../../compose/compose-doc.mjs';

const MESSAGES = {
    1: [
        { contentType: 'text/plain', content: '﻿Item      Qty\r\nBook       2   \r\n\r\n\r\nTotal\t\t2\r\n  \r\n' },
        { contentType: 'text/html', content: '<div>Fwd header</div><table class="moz-main-header"><tr><td>Subject: Old</td></tr></table>'
            + '<p>Item Qty</p><p>Book&nbsp;2</p><span style="display: none">preheader</span>' },
    ],
    2: [{ contentType: 'text/plain', content: 'first line\r\nsecond line\n\nthird' }],
    3: [{ contentType: 'text/plain', content: 'part one\n' }, { contentType: 'text/plain', content: 'part two' }],
    4: [{ contentType: 'text/html', content: '<p>Only <b>html</b></p>' }],
};

const ctx = await openBackgroundDocument({
    modules: ['js/mzta-utils.js', 'js/mzta-utils-prompt.js'],
    apis(browser) {
        browser.messages.listInlineTextParts = async (messageId) => {
            if (!Object.hasOwn(MESSAGES, messageId)) throw new Error('message ' + messageId + ' not found');
            return structuredClone(MESSAGES[messageId]);
        };
    },
});
after(() => ctx.close());
const {
    htmlBodyToPlainText,
    getMailInlineTextParts,
    cleanupNewlines,
    stripHtmlKeepLines,
} = ctx.imports['js/mzta-utils.js'];
const { taPromptUtils } = ctx.imports['js/mzta-utils-prompt.js'];
const k = composeTests('09');

const S_INJECT = 'spec 01 "`htmlBodyToPlainText()` injects the line structure before reading it"';
const S_HIDDEN = 'spec 01 "Hidden elements — `mztaStripHidden()`, and why the attribute selector was wrong"';
const S_NBSP = 'spec 01 "Non-breaking spaces, and the order of the cleanup rules"';
const S_PARTS = 'spec 01 "Where the body comes from — `listInlineTextParts()`, not a `getFull()` walk"';
const S_TEXT_HTML = 'spec 01 "The text/HTML rule: stripped from the TEXT, never from the HTML"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_PLAIN = 'spec 03 "`mail_text_body` vs `mail_plain_text_part`"';
const S_WRITE = 'spec 01 "Writing into a plain text compose window"';
const S_PICKER = 'spec 07 "Into a plain text compose window"';

// --- htmlBodyToPlainText() ---------------------------------------------------------------

k.test('paths-in-step', S_BODY, 'the background extraction gives the same text as the interactive one (compose-08) on the same mail', () => {
    const mail = fixture('html-display-newsletter.json');
    assert.equal(htmlBodyToPlainText(mail.mail_html), mail.text_body);
});

k.test('outlook-not-welded', S_INJECT, 'compact Outlook/Word paragraphs are one line each, not welded', () => {
    assert.equal(htmlBodyToPlainText('<div class=WordSection1><p class=MsoNormal>Hello,<o:p></o:p></p>'
        + '<p class=MsoNormal>quotation below:<o:p></o:p></p><p class=MsoNormal>DMS could be XXXX<o:p></o:p></p>'
        + '<p class=MsoNormal>Server 2TB<o:p></o:p></p></div>'),
    'Hello,\nquotation below:\nDMS could be XXXX\nServer 2TB');
});

k.test('boundaries', S_INJECT, '<br>, <hr>, <div>, <li>, <tr> and headings each end a line, cells are spaced', () => {
    assert.equal(htmlBodyToPlainText('a<br>b<hr><div>c</div><div>d</div><ul><li>e</li><li>f</li></ul>'
        + '<table><tr><th>g</th><td>h</td></tr><tr><td>i</td><td>j</td></tr></table><h2>k</h2>l'),
    'a\nb\nc\nd\ne\nf\ng h\ni j\nk\nl');
});

// Gmail writes the first line of a message bare and every following line in a <div> of its own.
k.test('gmail-div-lines', S_BODY, 'one \n per block boundary: text followed by a block is not welded to it (Gmail\'s line shape)', () => {
    assert.equal(htmlBodyToPlainText('<div dir="ltr">Hi Bob,<div>thanks for the file.</div><div>Mario</div></div>'),
        'Hi Bob,\nthanks for the file.\nMario');
});

k.test('never-blank', S_INJECT, 'pretty-printed HTML and empty spacer paragraphs give no blank line', () => {
    // Compared trimmed: the cleanup keeps one space where the indentation was (README "Under-specified").
    const t = htmlBodyToPlainText('<div>\n  <p>a</p>\n\n  <p class=MsoNormal><o:p>&nbsp;</o:p></p>\n  <p>b</p>\n</div>\n');
    assert.ok(!t.includes('\n\n'), JSON.stringify(t));
    assert.deepEqual(t.split('\n').map(l => l.trim()), ['a', 'b']);
});

k.test('source-newline-not-a-line', S_BODY, 'one \\n per block boundary: a newline inside a paragraph\'s source is not a line', () => {
    assert.equal(htmlBodyToPlainText('<p>A long sentence wrapped\nby the HTML generator.</p><p>Next.</p>'),
        'A long sentence wrapped by the HTML generator.\nNext.');
});

k.test('pre-keeps-lines', S_INJECT, 'inside <pre> and under an inline white-space: pre-wrap the source newlines ARE lines', () => {
    assert.equal(htmlBodyToPlainText('<p>wrapped\nsource</p><pre>line one\nline two</pre>'
        + '<div style="white-space: pre-wrap">kept one\nkept two</div>'),
    'wrapped source\nline one\nline two\nkept one\nkept two');
});

k.test('style-gone', S_INJECT, '<style> in the head or the body is not read', () => {
    assert.equal(htmlBodyToPlainText('<html><head><style>.a{color:red}</style></head><body><style>p{x:y}</style><p>text</p></body></html>'),
        'text');
});

k.test('moz-main-header', S_PARTS, 'the moz-main-header table of a forwarded message is not read', () => {
    const t = htmlBodyToPlainText('<div>Fwd</div><table class="moz-main-header"><tr><td>Subject: Old</td></tr></table><p>Body</p>');
    assert.ok(!t.includes('Subject: Old'), t);
    assert.ok(t.split('\n').includes('Body'), t);
});

const HIDDEN = ['display:none', 'display: none', 'DISPLAY : NONE', 'display:none !important', 'display: none;',
    'color: red; display: none', 'visibility:hidden', 'Visibility: Hidden !important'];
k.test('hidden-spellings', S_HIDDEN, 'every spelling of an inline display:none / visibility:hidden, and the hidden attribute, is removed', () => {
    for (const style of HIDDEN) {
        assert.equal(htmlBodyToPlainText(`<p>seen</p><span style="${style}">gone</span>`), 'seen', style);
    }
    assert.equal(htmlBodyToPlainText('<p>seen</p><div hidden>gone</div>'), 'seen');
});

k.test('hidden-not-substring', S_HIDDEN, 'a declaration that merely ends in display:none is not one: the vendor longhand stays', () => {
    assert.equal(htmlBodyToPlainText('<div style="mso-hide:all;-x-display:none">kept</div>'), 'kept');
});

k.test('nbsp-spaced', S_NBSP, 'both spellings of the non-breaking space become a space, collapsed, never dropped', () => {
    assert.equal(htmlBodyToPlainText('<p>Ciao&nbsp;Mario</p><p>a&nbsp;&nbsp; b c</p>'), 'Ciao Mario\na b c');
    assert.equal(cleanupNewlines('Ciao&nbsp;Mario   x'), 'Ciao Mario x');
});

// --- getMailInlineTextParts() --------------------------------------------------------------

let msg1;
k.test('parts-both', S_PARTS, 'text/plain parts make the text, verbatim; text/html parts the html, the moz-main-header table removed', async () => {
    msg1 = await getMailInlineTextParts(1);
    assert.equal(msg1.text, MESSAGES[1][0].content);
    assert.ok(!msg1.html.includes('moz-main-header') && !msg1.html.includes('Subject: Old'), msg1.html);
    assert.ok(msg1.html.includes('<p>Item Qty</p>'), msg1.html);
});

k.test('parts-html-keeps-hidden', S_TEXT_HTML, 'the background html keeps the hidden markup', () => {
    assert.ok(msg1.html.includes('<span style="display: none">preheader</span>'), msg1.html);
});

k.test('parts-text-only', S_PARTS, 'a text/plain-only mail: its html is synthesized, each \\n a <br>', async () => {
    const m = await getMailInlineTextParts(2);
    assert.equal(m.text, MESSAGES[2][0].content);
    assert.equal(m.html, 'first line<br>second line<br><br>third');
});

k.test('parts-concatenated', S_PARTS, 'several inline text/plain parts are concatenated', async () => {
    assert.equal((await getMailInlineTextParts(3)).text, 'part one\npart two');
});

k.test('parts-failure', S_PARTS, 'a failed call still yields a well-formed {text: \'\', html: \'\'}', async () => {
    assert.deepEqual(await getMailInlineTextParts(99), { text: '', html: '' });
    assert.ok(ctx.con.entries.some(e => e.level === 'error'), 'logged through console.error');
});

// --- the body placeholders, from the parts ------------------------------------------------

/** The background's body read (mzta-background.js _loadMessageBody()), and the two placeholders. */
async function placeholders(messageId) {
    const msg_text = await getMailInlineTextParts(messageId);
    let body_text = htmlBodyToPlainText(msg_text.html);
    if (body_text.length === 0) body_text = cleanupNewlines(msg_text.text);
    const out = await taPromptUtils.preparePrompt({
        curr_prompt: { id: 'compose_test', text: 'B<{%mail_text_body%}>P<{%mail_plain_text_part%}>', need_signature: '0' },
        body_text,
        msg_text,
    });
    const m = /^B<([\s\S]*)>P<([\s\S]*)>$/.exec(out);
    assert.ok(m, out);
    return { body: m[1], plain: m[2] };
}

k.test('placeholder-text-body', S_BODY, '{%mail_text_body%} is the html part as text: one \\n per block, hidden gone, no header', async () => {
    assert.equal((await placeholders(1)).body, 'Item Qty\nBook 2');
});

k.test('placeholder-plain-part', S_PLAIN, '{%mail_plain_text_part%} keeps columns, blank lines, tabs and U+00A0; only CRLF, the BOM and trailing whitespace go', async () => {
    assert.equal((await placeholders(1)).plain, 'Item      Qty\nBook       2\n\n\nTotal\t\t2');
});

k.test('placeholder-text-only-mail', S_BODY, 'a text/plain-only mail: the body text comes from the synthesized html, the plain part is the part', async () => {
    const p = await placeholders(2);
    assert.equal(p.body, 'first line\nsecond line\nthird');
    assert.equal(p.plain, 'first line\nsecond line\n\nthird');
});

k.test('placeholder-no-plain-fallback', S_PLAIN, 'an html-only mail has no plain part: msg_text.text is empty, no fallback to the conversion', async () => {
    const m = await getMailInlineTextParts(4);
    assert.equal(m.text, '');
    assert.equal(htmlBodyToPlainText(m.html), 'Only html');
});

// --- stripHtmlKeepLines(): the insertion side ---------------------------------------------

k.test('strip-paragraphs', S_PICKER, 'the picker\'s output: a <p> boundary is a blank line, a <br> one \\n, an <li> one \\n', () => {
    assert.equal(stripHtmlKeepLines('<p>Dear Bob,</p><p>Line one<br>Line two</p><ul><li>x</li><li>y</li></ul><p>End</p>'),
        'Dear Bob,\n\nLine one\nLine two\n\nx\ny\n\nEnd');
});

k.test('markdown-br-newline', S_WRITE, 'markdown-it\'s "<br>\\n" and "</p>\\n<p>": the pretty-printing newline after the tag is consumed', () => {
    assert.equal(stripHtmlKeepLines('<p>Dear Bob,<br>\nthanks.</p>\n<p>Bye</p>\n'), 'Dear Bob,\nthanks.\n\nBye');
});

k.test('markdown-list', S_WRITE, 'a markdown-it list: one line per item, no blank line between items', () => {
    assert.equal(stripHtmlKeepLines('<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n'), 'one\ntwo');
});

k.test('strip-block-boundaries', S_PICKER, 'every block boundary other than <p> is one \\n: consecutive <div> and <li> get no blank line, text before a <div> is its own line', () => {
    assert.equal(stripHtmlKeepLines('<div>a</div><div>b</div><ul><li>c</li><li>d</li></ul>'), 'a\nb\nc\nd');
    assert.equal(stripHtmlKeepLines('<div>Hi Bob,<div>thanks</div><div>Mario</div></div>'), 'Hi Bob,\nthanks\nMario');
});

k.test('strip-keeps-hidden', S_HIDDEN, 'the insertion side does not strip hidden elements: nothing of the answer is dropped', () => {
    assert.equal(stripHtmlKeepLines('<p>a<span style="display:none">b</span></p>'), 'ab');
});

k.test('harness-clean', S_INJECT, 'the background modules ran on modelled APIs only', () => {
    // getMailInlineTextParts(99) logs on purpose (parts-failure); nothing else may be pending.
    assertHarnessClean(ctx);
});

k.coverage();
