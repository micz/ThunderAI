// Group A on the captured HTML reply (captured/mail_html_compose_signature_quote_text.txt): the
// draft as Thunderbird saved it, reopened in an HTML compose window in Paragraph mode, so the body
// carries the serializer's indentation between the elements. Three <p>, an empty <p><br></p>, the
// moz-cite-prefix, the blockquote type=cite, the moz-signature.
//
// Spec 03 "Newline contract of the compose placeholders" (typed / quoted: one \n between lines, a
// blank line between paragraphs, after cleanupNewlinesKeepParagraphs()), "Newline contract of the
// body placeholders" (getTextOnly: one \n per block, never a blank line, after cleanupNewlines()).
// Spec 01 "The text/HTML rule" (getFullHtml keeps the markup), and the add-on's own elements
// (MZTA_INJECTED_SELECTORS) never read back: a generic panel drawn in the compose window.
//
// The values the content script returns are raw; the placeholder is that value through the cleanup
// the spec names for it, the real function (js/mzta-utils.js), so that is what is compared.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    readCapture,
    send,
    injected,
} from '../../compose/compose-doc.mjs';

const capture = readCapture('mail_html_compose_signature_quote_text.txt');
const ctx = await openMailDocument({ html: capture.body, url: COMPOSE_URL });
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const k = composeTests('01');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_TEXT_HTML = 'spec 01 "The text/HTML rule: stripped from the TEXT, never from the HTML"';
const S_RICHTEXT = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';

const typed = async () => cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' }));
const quoted = async () => cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyQuotedText' }));
const textBody = async () => cleanupNewlines(await send(ctx, { command: 'getTextOnly' }));
const fullHtml = () => send(ctx, { command: 'getFullHtml' });

const originalBodyHtml = ctx.document.body.innerHTML;
const before = {};

k.test('capture-shape', S_COMPOSE, 'the captured draft is an HTML Paragraph-mode reply with quote and signature', () => {
    assert.match(capture.headers['content-type'], /^text\/html/);
    assert.equal(ctx.$$('body > p').length, 4);
    assert.ok(ctx.$('body > div.moz-cite-prefix'));
    assert.ok(ctx.$('body > blockquote[type="cite"]'));
    assert.ok(ctx.$('body > div.moz-signature'));
});

k.test('typed-paragraphs', S_COMPOSE, 'the typed text is the three paragraphs, a blank line between them, the indentation gone', async () => {
    before.typed = await typed();
    assert.equal(before.typed, 'Here we use HTML because we are pretty!\n\nRegards!!!\n\nBye!!');
});

// The draft carries the serializer's indentation: a newline and spaces between the elements and
// after each <br>. That whitespace is HTML whitespace, rendered as nothing (or one space): it is not
// a line of the mail, and no line starts with it.
const splitLines = s => s.split('\n');

k.test('quoted-starts-at-prefix', S_COMPOSE, 'the quoted text starts at the citation line and holds the quote on a line of its own', async () => {
    before.quoted = await quoted();
    const lines = splitLines(before.quoted);
    assert.match(lines[0], /^On 05\/11\/2024 08:27,/);
    assert.ok(lines.includes('This is the body of test email number 8. It was received.'), JSON.stringify(before.quoted));
    assert.ok(!before.quoted.includes('Here we use HTML'), 'no typed text in the quoted text');
});

k.test('quoted-blank-line-before-quote', S_COMPOSE, 'the blockquote is a paragraph boundary: a blank line before the quote, never two', async () => {
    const q = before.quoted ?? await quoted();
    assert.match(q, /wrote:\n\nThis is the body of test email number 8/);
    assert.ok(!/\n\n\n/.test(q), JSON.stringify(q));
});

k.test('quoted-br-single-break', S_COMPOSE, 'a <br> is one line break: the signature\'s "-- <br>" is followed by its next line, not by a blank line', async () => {
    const q = before.quoted ?? await quoted();
    assert.match(q, /--\nThis is my best signature!!!/, JSON.stringify(q));
});

k.test('text-body-never-blank', S_BODY, 'the body text has every paragraph on a line of its own and no blank line', async () => {
    before.text = await textBody();
    assert.ok(!before.text.includes('\n\n'), JSON.stringify(before.text));
    const lines = splitLines(before.text);
    for (const line of ['Here we use HTML because we are pretty!', 'Regards!!!', 'Bye!!',
        'This is the body of test email number 8. It was received.']) {
        assert.ok(lines.includes(line), `${JSON.stringify(line)} in ${JSON.stringify(before.text)}`);
    }
});

k.test('text-body-citation-one-line', S_BODY, 'one line break per block boundary: the citation, one block, is one line', async () => {
    const lines = splitLines(before.text ?? await textBody());
    assert.ok(lines.includes('On 05/11/2024 08:27, sender8@example.com wrote:'), JSON.stringify(lines));
});

k.test('full-html-is-the-body', S_TEXT_HTML, 'getFullHtml hands over the body markup unedited (no style, no script, nothing injected here)', async () => {
    before.html = await fullHtml();
    assert.equal(before.html, originalBodyHtml);
});

// The add-on's own elements: a generic info panel (spec 04 "Generic panels": rendered in the
// compose window too) puts #mzta-container at the top of the compose body, and an alert dialog is
// appended at its end, after the quote.
k.test('panel-drawn', 'spec 04 "Batch cancellation (user-triggered stop)"', 'a generic info panel is drawn at the top of the compose body, a dialog at its end', async () => {
    assert.equal(await send(ctx, { command: 'showGenericInfo', data: { message: 'Email processing stopped.', source: 'Batch' } }), true);
    assert.equal(await send(ctx, { command: 'sendAlert', curr_tab_type: 'mail', message: 'An alert.' }), true);
    assert.equal(injected(ctx).length, 2);
    assert.equal(ctx.document.body.firstElementChild.id, 'mzta-container');
    assert.ok(ctx.document.body.lastElementChild.matches('dialog.mzta_dialog'));
});

k.test('text-body-skips-injected', S_BODY, 'the body text does not read the panel', async () => {
    assert.equal(await textBody(), before.text);
});

k.test('full-html-skips-injected', S_TEXT_HTML, 'the HTML body does not carry the panel', async () => {
    assert.equal(await fullHtml(), before.html);
});

k.test('quoted-skips-injected', S_COMPOSE, 'the quoted text reads neither the panel nor the dialog after the quote', async () => {
    assert.equal(await quoted(), before.quoted);
});

k.test('typed-skips-injected', S_RICHTEXT, 'the typed text does not read the panel', async () => {
    assert.equal(await typed(), before.typed);
});

k.test('autoselect-skips-injected', S_RICHTEXT, 'the autoselect range of the typed text leaves the panel out', async () => {
    ctx.window.getSelection().removeAllRanges();
    await send(ctx, { command: 'getOnlyTypedText', do_autoselect: true });
    const range = ctx.window.getSelection().getRangeAt(0);
    assert.ok(!range.intersectsNode(ctx.$('#mzta-container')), 'the panel is outside the range');
    assert.ok(range.intersectsNode(ctx.$('body > p')), 'the first paragraph is inside it');
    ctx.window.getSelection().removeAllRanges();
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
