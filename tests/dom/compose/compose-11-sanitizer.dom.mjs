// Group D, the sanitizer: model output carrying executable markup, drawn into the message display
// through the summary panel (summary_html) and the translation panel (translated_text, HTML branch).
// Every payload of fixtures/compose/sanitizer-payloads.json, plain and "split" (entities, case,
// controls and whitespace in the scheme, tags split around tags, unclosed tags, comments).
//
// Spec 01 "Stale-result guard (rapid message switching)" -> "Panel HTML sanitization": the
// background sanitizes first, and the content script's _renderSafeHtml() is the defense in depth,
// "used by both the summary and the translation panel": it removes script, img, style, link,
// iframe, frame, frameset, object, embed, form, meta, base, svg, math, template, noscript, every on*
// and style attribute, and javascript: / vbscript: / data: URLs. That last step is what is tested
// here, on its own: the payloads reach the content script unsanitized. Nothing executable may reach
// the message display, and the panel is still drawn.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    fixture,
    openMailDocument,
    readCapture,
    send,
} from '../../compose/compose-doc.mjs';
import {
    UNSAFE_TAGS,
    executableProblems,
} from '../../compose/safety.mjs';

const ID = 'msg-A@example.com';
const { payloads, formatting } = fixture('sanitizer-payloads.json');
const capture = readCapture('mail_html_reading.txt', { encoding: 'latin1' });
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: ID,
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html" lang="x-unicode">'
        + capture.body + '</div></body></html>',
});
after(() => ctx.close());
const k = composeTests('11');

const S_SAN = 'spec 01 "Stale-result guard (rapid message switching)"';

const summaryContent = () => ctx.$('#mzta-summary-banner .thunderai-summary-content');
// The translation banner: its header, then the text wrapper whose first child holds the text.
const translationContent = () => ctx.$('#mzta-translation-banner')?.children[1]?.firstElementChild ?? null;

/** Anything executable in the whole document's body: tags the mail itself does not have, on* attributes. */
function documentProblems() {
    const problems = [];
    const own = new Set(['img']);      // the panels' own icons
    for (const tag of UNSAFE_TAGS) {
        if (own.has(tag)) continue;
        for (const el of ctx.document.body.querySelectorAll(tag)) problems.push(`<${tag}> in the document`);
    }
    for (const el of ctx.document.body.querySelectorAll('*')) {
        for (const attr of el.attributes) if (attr.name.toLowerCase().startsWith('on')) problems.push(`${attr.name} in the document`);
    }
    for (const img of ctx.document.body.querySelectorAll('img')) {
        if (!img.getAttribute('src').startsWith('moz-extension://')) problems.push(`<img src="${img.getAttribute('src')}"> in the document`);
    }
    return problems;
}

for (const p of payloads) {
    const kind = p.split ? ' (split)' : '';
    k.test(`${p.id}-summary`, S_SAN, `summary panel, ${p.id}${kind}: drawn, nothing executable`, async () => {
        await send(ctx, { command: 'showSummary', data: { summary: 'fallback text', summary_html: p.html, headerMessageId: ID } });
        const content = summaryContent();
        assert.ok(content, 'the summary panel is drawn');
        assert.deepEqual(executableProblems(content), []);
        assert.deepEqual(documentProblems(), []);
        if (p.html.includes('<p>ok')) assert.ok(content.textContent.includes('ok'), 'the safe part is kept');
    });
    k.test(`${p.id}-translation`, S_SAN, `translation panel, ${p.id}${kind}: drawn, nothing executable`, async () => {
        await send(ctx, { command: 'showTranslation', data: { translated_text: p.html, headerMessageId: ID } });
        const content = translationContent();
        assert.ok(content, 'the translation panel is drawn');
        assert.deepEqual(executableProblems(content), []);
        assert.deepEqual(documentProblems(), []);
        if (p.html.includes('<p>ok')) assert.ok(content.textContent.includes('ok'), 'the safe part is kept');
    });
}

k.test('formatting-kept', S_SAN, 'the formatting the panels rely on survives: paragraphs, lists, bold/italic, line breaks, https links', async () => {
    await send(ctx, { command: 'showSummary', data: { summary: 'x', summary_html: formatting, headerMessageId: ID } });
    const c = summaryContent();
    for (const sel of ['p', 'b', 'i', 'em', 'strong', 'br', 'ul > li', 'ol > li']) assert.ok(c.querySelector(sel), sel);
    assert.equal(c.querySelector('a').getAttribute('href'), 'https://example.com/x');
    assert.deepEqual(executableProblems(c), []);
});

k.test('harness-clean', S_SAN, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
