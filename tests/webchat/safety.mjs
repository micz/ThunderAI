/*
 *  "Nothing executable reached the DOM", as checks a test can assert on.
 *
 *  Spec 01 "One render path, no router" and spec 07 "The sanitizer is a security boundary": the
 *  model's answer is untrusted HTML on its way into the user's outgoing mail, and the ONE allowlist
 *  stands between the two. jsdom runs no script and fires no inline handler, so "nothing ran"
 *  proves nothing here: the checks are structural, on what reached the DOM (and what is sent to the
 *  background), which is what a browser would execute.
 *
 *  Two checks, complementary:
 *
 *   - allowlistProblems(container): every element under `container` is one the spec allows
 *     (spec 07's inline list, the segmentation BLOCK_TAGS, and the widening of BLOCK_ALLOWED with
 *     ul/ol, the table family and hr), and carries no attribute but an `href` on <a> matching
 *     `^(https?:|mailto:)`. Used on the region that holds model HTML, and on the HTML the window
 *     sends out.
 *   - executableProblems(root): wherever the window's own chrome lives too (icons, buttons, the
 *     components' <style>), nothing that executes: no <script> (SVG's included), no frame, object,
 *     embed, applet, base, link, meta, form, no SVG animation or foreignObject, no on* attribute,
 *     no javascript:/data:/vbscript: URL in a URL-bearing attribute, no script-bearing inline style.
 *     A <style> that is a direct child of a shadow root is a component's own stylesheet.
 *
 *  Nothing here imports jsdom: the DOM comes from the caller.
 */

import { deepElements } from './shadow.mjs';

/** Spec 07 "The sanitizer is a security boundary": the inline allowlist. */
export const INLINE_ALLOWED = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'code', 'a', 'br', 'span', 'sub', 'sup'];
/** Spec 07: the segmentation BLOCK_TAGS, "deliberately narrow". */
export const BLOCK_TAGS = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
/** Spec 01 / 07: BLOCK_ALLOWED = inline + BLOCK_TAGS + ul/ol + the table family + hr. */
export const ANSWER_ALLOWED = new Set([...INLINE_ALLOWED, ...BLOCK_TAGS,
    'ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr']);
/** Spec 07: an href survives only when it matches this. */
export const SAFE_HREF = /^(https?:|mailto:)/i;

const EXECUTABLE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
    'base', 'link', 'meta', 'form', 'animate', 'set', 'animatetransform', 'animatemotion',
    'foreignobject', 'handler', 'listener', 'portal']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc', 'data',
    'poster', 'background', 'srcset', 'codebase', 'dynsrc', 'lowsrc', 'ping', 'to', 'from', 'values']);
const BAD_SCHEME = /^(javascript|data|vbscript):/i;

const describe = el => '<' + el.localName + [...el.attributes].map(a => ' ' + a.name + '="' + a.value + '"').join('') + '>';

/**
 * The model-HTML region under `container` against the allowlist.
 *   skip(el)     true to leave an element and its subtree out (the window's own chrome inside the
 *                region, e.g. the thinking block it builds itself)
 *   tokenSpans   accept the live token spans of a streaming answer: <span class="token"> holding
 *                text only (the sanitizer drops every class, so the model cannot produce one)
 */
export function allowlistProblems(container, { skip = () => false, tokenSpans = false } = {}) {
    const problems = [];
    const walk = (node) => {
        for (const el of node.children) {
            if (skip(el)) continue;
            if (tokenSpans && el.localName === 'span' && el.getAttribute('class') === 'token'
                && el.attributes.length === 1 && el.children.length === 0) {
                continue;
            }
            if (!ANSWER_ALLOWED.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
                problems.push('element not allowed: ' + describe(el));
            }
            for (const attr of el.attributes) {
                const ok = el.localName === 'a' && attr.name === 'href' && SAFE_HREF.test(attr.value.trim());
                if (!ok) problems.push('attribute not allowed: ' + attr.name + '="' + attr.value + '" on ' + describe(el));
            }
            walk(el);
        }
    };
    walk(container);
    return problems;
}

/** Everything executable under `root`, shadow roots and template contents included. */
export function executableProblems(root) {
    const problems = [];
    for (const el of deepElements(root)) {
        const tag = el.localName.toLowerCase();
        const isComponentStyle = tag === 'style' && el.parentNode && el.parentNode.host !== undefined
            && el.parentNode.nodeType === 11;
        if (EXECUTABLE_TAGS.has(tag) || (tag === 'style' && !isComponentStyle)) {
            problems.push('executable element: ' + describe(el));
        }
        for (const attr of el.attributes) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) problems.push('event handler: ' + describe(el));
            // eslint-disable-next-line no-control-regex
            const value = attr.value.replace(/[\u0000- ]/g, '');
            if (URL_ATTRS.has(name) && BAD_SCHEME.test(value)) problems.push('script URL: ' + describe(el));
            if (name === 'style' && /javascript:|expression\(|url\(/i.test(attr.value)) problems.push('script in style: ' + describe(el));
        }
    }
    return problems;
}

/** allowlistProblems() over an HTML string, parsed with the page's own DOMParser. */
export function htmlProblems(window, html) {
    const doc = new window.DOMParser().parseFromString(String(html), 'text/html');
    return [...allowlistProblems(doc.body), ...executableProblems(doc.body)];
}
