// Spec 03 "Mail links": {%mail_links%}, the targets the text extractions leave out. The real
// getMailLinks() on real markup, then through the placeholder with the selection first.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import { openBackgroundDocument } from '../../compose/compose-doc.mjs';

const ctx = await openBackgroundDocument({ modules: ['js/mzta-utils.js', 'js/mzta-placeholders.js'] });
after(() => ctx.close());
const { getMailLinks } = ctx.imports['js/mzta-utils.js'];
const { placeholdersUtils: ph } = ctx.imports['js/mzta-placeholders.js'];
const k = composeTests('21');
const S = 'spec 03 "Mail links"';

k.test('hidden-target', S, 'the target behind a link text is returned with that text', () => {
    assert.deepEqual(getMailLinks('<p><a href="https://example.org/visio?id=1">Join  the\n meeting</a> — <a href="https://example.org/p.pdf?a=1&amp;b=2#c">Programme</a></p>'), [
        { text: 'Join the meeting', url: 'https://example.org/visio?id=1' },
        { text: 'Programme', url: 'https://example.org/p.pdf?a=1&b=2#c' },
    ]);
});

k.test('filtered', S, 'only valid HTTP/HTTPS targets are kept, once, the first text winning', () => {
    assert.deepEqual(getMailLinks(`
        <a href="mailto:a@example.org">Mail</a><a href="tel:+33">Call</a><a href="#top">Top</a><a href="/relative">Relative</a>
        <a href="javascript:alert(1)">Script</a><a href="https://user:pass@example.org/">Credentials</a><a>No target</a>
        <a href=" https://example.org/a ">First</a><a href="HTTPS://EXAMPLE.ORG:443/a">Second</a>`), [
        { text: 'First', url: 'https://example.org/a' },
    ]);
});

k.test('hidden-element', S, 'a link in a hidden element is left out, like hidden text', () => {
    assert.deepEqual(getMailLinks('<div style="display: none"><a href="https://example.org/hidden">Hidden</a></div><a href="https://example.org/shown">Shown</a>'), [
        { text: 'Shown', url: 'https://example.org/shown' },
    ]);
});

k.test('bounded', S, 'the list and each text are bounded', () => {
    const anchors = Array.from({ length: 40 }, (_, i) => `<a href="https://example.org/${i}">${'x'.repeat(200)}</a>`).join('');
    const links = getMailLinks(anchors);
    assert.equal(links.length, 30);
    assert.equal(links[29].url, 'https://example.org/29');
    assert.equal(links[0].text, 'x'.repeat(100) + ' [...]');
});

k.test('image-only', S, 'a link holding only an image takes the image description as its text', () => {
    assert.deepEqual(getMailLinks('<a href="https://example.org/join"><img alt="Join the meeting" src="b.png"></a><a href="https://example.org/x"><img src="c.png"></a>'), [
        { text: 'Join the meeting', url: 'https://example.org/join' },
        { text: '', url: 'https://example.org/x' },
    ]);
});

k.test('empty', S, 'no markup gives no links', () => {
    for (const html of ['', null, undefined, '<p>Plain</p>']) assert.deepEqual(getMailLinks(html), []);
});

k.test('placeholder', S, 'the placeholder is a JSON array, of the selection when there is one', async () => {
    const text = '{%mail_links%}';
    const value = async args => ph.replacePlaceholders({ text, replacements: await ph.getPlaceholdersValues({ prompt_text: text, ...args }), use_default_value: false });
    const body = '<a href="https://example.org/body">Body, "quoted"</a>';
    const selected = '<a href="https://example.org/selected">Selected</a>';
    assert.deepEqual(JSON.parse(await value({ msg_text: { html: body } })), [{ text: 'Body, "quoted"', url: 'https://example.org/body' }]);
    assert.deepEqual(JSON.parse(await value({ msg_text: { html: body }, selection_html: selected })), [{ text: 'Selected', url: 'https://example.org/selected' }]);
});

k.test('harness-clean', S, 'the modules ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
