// Group C: the background page's side of the SmartBar's compose operation. An empty document at
// the background page's url, with js/lib/mzta-html-lines.js loaded as mzta-background.html loads
// it, and js/mzta-utils.js imported into it (as compose-09).
//
// Spec 10 "Compose": the email the compose operation sends is cut to smartbar_max_body_length,
// the quoted part first. splitQuotedHtml() tells a received HTML mail's own text from its quoted
// part: the document is cut at the first citation (Thunderbird's blockquote and cite prefix, the
// forward container, Gmail's quote, Outlook's reply header), at every nesting level, and each half
// is read by htmlBodyToPlainText(), so both keep the {%mail_text_body%} contract (spec 03).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import { openBackgroundDocument } from '../../compose/compose-doc.mjs';

const ctx = await openBackgroundDocument({ modules: ['js/mzta-utils.js'] });
after(() => ctx.close());
const { splitQuotedHtml, htmlBodyToPlainText } = ctx.imports['js/mzta-utils.js'];
const k = composeTests('22');

const S = 'spec 10 "Compose"';

k.test('thunderbird-reply', S, 'a Thunderbird reply: the cite prefix and the blockquote are the quoted part', () => {
    const html = '<p>Fine for me.</p><p>Mario</p>'
        + '<div class="moz-cite-prefix">On 01/11/2026 Bob wrote:<br></div>'
        + '<blockquote type="cite"><p>Can we meet?</p></blockquote>';
    assert.deepEqual(splitQuotedHtml(html), { own: 'Fine for me.\nMario', quoted: 'On 01/11/2026 Bob wrote:\nCan we meet?' });
});

k.test('nested', S, 'a quote nested in the mail\'s wrapper: everything after it, at every level, is quoted', () => {
    const html = '<div class="moz-text-html"><div>Top line</div><div>Second line</div>'
        + '<blockquote type="cite"><div>quoted 1</div></blockquote><div>after the quote</div></div><p>trailer</p>';
    assert.deepEqual(splitQuotedHtml(html), { own: 'Top line\nSecond line', quoted: 'quoted 1\nafter the quote\ntrailer' });
});

k.test('gmail-outlook-forward', S, 'Gmail\'s quote, Outlook\'s reply header and a forward container start the quoted part', () => {
    assert.deepEqual(splitQuotedHtml('<div dir="ltr">Thanks!</div><div class="gmail_quote"><div>Il giorno lun Bob ha scritto:</div><blockquote>x</blockquote></div>'),
        { own: 'Thanks!', quoted: 'Il giorno lun Bob ha scritto:\nx' });
    assert.deepEqual(splitQuotedHtml('<p>Ok</p><hr><div id="divRplyFwdMsg"><b>From:</b> Bob</div><div>old text</div>'),
        { own: 'Ok', quoted: 'From: Bob\nold text' });
    assert.deepEqual(splitQuotedHtml('<p>See below</p><div class="moz-forward-container">-------- Forwarded Message --------<p>body</p></div>'),
        { own: 'See below', quoted: '-------- Forwarded Message --------\nbody' });
});

k.test('first-wins', S, 'the first citation in document order wins', () => {
    const html = '<p>Mine</p><div class="gmail_quote">first</div><blockquote type="cite">second</blockquote>';
    assert.deepEqual(splitQuotedHtml(html), { own: 'Mine', quoted: 'first\nsecond' });
});

k.test('no-quote', S, 'no citation: the whole mail is the author\'s text, read as htmlBodyToPlainText() reads it', () => {
    const html = '<p>Hello</p><blockquote>a plain blockquote is not a citation</blockquote><span style="display:none">pre</span>';
    assert.deepEqual(splitQuotedHtml(html), { own: htmlBodyToPlainText(html), quoted: '' });
    assert.deepEqual(splitQuotedHtml(''), { own: '', quoted: '' });
});

k.test('quote-only', S, 'a mail that opens with its quote: no own text', () => {
    assert.deepEqual(splitQuotedHtml('<blockquote type="cite"><p>only quoted</p></blockquote>'), { own: '', quoted: 'only quoted' });
});

k.test('harness-clean', S, 'the background module ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
