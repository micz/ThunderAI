/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// The rich-text layer: the ONE security taxonomy + the ONE sanitizer, plus
// module-world re-exports of the DOM projection that lives in the classic
// js/lib/mzta-html-lines.js.
//
// Three representations flow through the add-on, and every value knows which it
// is:
//   text  - line structure carried by \n (paragraph = \n\n)
//   html  - line structure carried by tags
//   model - markdown that MAY embed inline and block HTML (CommonMark)
//
// ── Why the split between this module and js/lib/mzta-html-lines.js ───────────
//
// The DOM line-projection primitives (htmlToLines / linesToHtml / normalizePlain
// / hasLineStructure) are needed by js/mzta-compose-script.js, which is a CLASSIC
// content script (composeScripts.register / messageDisplayScripts.register /
// tabs.executeScript) and CANNOT `import`. So they live as globals in the classic
// js/lib/mzta-html-lines.js, and this module re-exports them via globalThis for
// the module-world consumers (background, menus, utils).
//
// The sanitizer, by contrast, is only ever needed in module world (the webchat
// renderer and the diff picker) - the content script never sanitizes, because
// model output is already sanitized upstream before it reaches the compose
// window. So the sanitizer + taxonomy live HERE, self-contained, with no
// dependency on the classic globals. That is deliberate: this module also loads
// on the api_webchat page, which has no classic script at all.

// ── The tag taxonomy ─────────────────────────────────────────────────────────
//
// NOTE there are THREE legitimately different tag sets in the add-on, and they
// must NOT be merged:
//   1. the PROJECTION selectors (js/lib/mzta-html-lines.js) - where a line break
//      lands when flattening arbitrary incoming mail to text. Broad on purpose
//      (breaks on ul/ol/tr/table/section/...).
//   2. the SEGMENTATION set (BLOCK_TAGS, below) - what becomes an independently
//      diffable block in the picker. Narrow on purpose (NO ul/ol/tr/table).
//   3. the SANITIZER allowlist (INLINE_ALLOWED / BLOCK_ALLOWED) - what tag
//      survives into the user's outgoing mail. A security boundary.
// Only 2 and 3 live here. 1 stays in the classic script.

// Elements that become their own block in the picker's segmentation. Everything
// else is inline (or is unwrapped by the sanitizer). This is BLOCK_TAGS the
// segmenter understands - it deliberately does NOT include ul/ol (containers,
// not blocks) or tr/table, because segmentBlocks() must not treat a table row as
// a diffable block.
export const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);

// The inline allowlist. THIS IS A SECURITY BOUNDARY, not a tidiness pass: the
// answer is model output on its way into the user's outgoing mail, and the
// plain-text path this replaces escaped absolutely everything. Anything not
// listed here is unwrapped (its children survive, the element does not).
export const INLINE_ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'code', 'a', 'br', 'span', 'sub', 'sup']);

// The table family, allowed into outgoing mail but ADDED TO BLOCK_ALLOWED ONLY -
// never to BLOCK_TAGS. Putting tr/td/... into the segmentation set would make
// segmentBlocks() treat every table row as a diffable block. Every tag here is a
// pure structural container with no script vector.
export const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th']);

// Only http(s) and mailto survive on <a href>. javascript: and data: must not.
export const SAFE_HREF = /^(https?:|mailto:)/i;

// The block allowlist: a superset of everything markdown-it legitimately emits,
// so a normal markdown answer (tables, hr, lists) does not regress. img stays
// out (stripped) - keep it that way unless there is a concrete reason not to.
//
// The table family and hr are a SEPARATE ADDEND on purpose (see TABLE_TAGS): the
// widening must reach the sanitizer without reaching the segmenter's BLOCK_TAGS.
export const BLOCK_ALLOWED = new Set([...INLINE_ALLOWED, ...BLOCK_TAGS, 'ul', 'ol', ...TABLE_TAGS, 'hr']);

// ── The ONE sanitizer ────────────────────────────────────────────────────────
//
// Every model-origin HTML crosses this before entering the mail (or the webchat
// DOM). Serialization goes back out through innerHTML, which encodes entities
// correctly for free. Deliberately NOT through a hand-rolled escapeHtml(): on
// HTML input that would escape the very tags we are trying to keep.
function sanitizeAgainst(html, allowed) {
    const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    // Walk a static list: unwrapping mutates the tree under a live collection.
    const els = Array.from(doc.body.querySelectorAll('*'));
    for (const el of els) {
        const tag = el.tagName.toLowerCase();
        if (!allowed.has(tag)) {
            // Unwrap: keep what the user can read, drop the element itself.
            // <script>/<style> are unwrapped too, but their children are TEXT
            // nodes, so the code is neutralized into visible text rather than
            // being left executable.
            el.replaceWith(...Array.from(el.childNodes));
            continue;
        }
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const keep = (tag === 'a' && name === 'href' && SAFE_HREF.test(attr.value.trim()));
            if (!keep) { el.removeAttribute(attr.name); }
        }
    }
    return doc.body.innerHTML;
}

// The single, parameterized sanitizer. allowBlocks:true is the whole-answer gate
// (block + inline); allowBlocks:false is the inline-only gate the diff picker
// applies to a single block's inner HTML at segmentation time.
export function sanitize(html, { allowBlocks = true } = {}) {
    return sanitizeAgainst(html, allowBlocks ? BLOCK_ALLOWED : INLINE_ALLOWED);
}

// Thin named wrappers kept for the existing call sites.
export function sanitizeInlineHtml(html) {
    return sanitize(html, { allowBlocks: false });
}

export function sanitizeBlockHtml(html) {
    return sanitize(html, { allowBlocks: true });
}

// ── Module-world re-exports of the classic DOM projection ────────────────────
//
// These forward to the globals defined in js/lib/mzta-html-lines.js. The lookup
// is at CALL time (not module-eval time), so this module's load order relative
// to the classic script never matters, and the api_webchat page - which has no
// classic script and never calls these - is unaffected by their absence.
export const htmlToLines = (html) => globalThis.mztaHtmlToLines(html);
export const htmlNodeToLines = (node) => globalThis.mztaHtmlNodeToLines(node);
export const stripHidden = (node) => globalThis.mztaStripHidden(node);
export const linesToHtml = (text, opts) => globalThis.mztaLinesToHtml(text, opts);
export const normalizePlain = (text, opts) => globalThis.mztaNormalizePlain(text, opts);
export const hasLineStructure = (html) => globalThis.mztaHasLineStructure(html);
