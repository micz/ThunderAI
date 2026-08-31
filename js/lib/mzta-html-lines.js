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

// The DOM line-projection layer, plus the plain-text normalizer and the
// text->html converters. This is the classic-script half of the rich-text layer;
// js/mzta-richtext.js (an ES module) re-exports everything here through
// globalThis, and additionally hosts the sanitizer + tag taxonomy.
//
// It also carries the ONE hidden-element rule (mztaStripHidden), called by the
// two EXTRACTION sites only - not by the insertion side.
//
// It carries the ONE HTML -> lines projection, shared by:
//   interactive (menu/popup)  js/mzta-compose-script.js  -> getTextOnly
//   automatic  (background)   js/mzta-utils.js           -> htmlBodyToPlainText()
//   insertion  (plain text)   js/mzta-utils.js           -> stripHtmlKeepLines()
//                             mzta-background.js         -> _replaceSelectedText()
//
// Every one of those used to carry its own hand-copied twin of the conversion,
// including the block-tag list spelled out several times. They are the same rule
// and must stay the same rule: fixing a boundary in one and not the other is
// precisely how these drifted apart before.
//
// ── Why this file is a CLASSIC script, not an ES module ──────────────────────
//
// js/mzta-compose-script.js is registered with composeScripts.register /
// messageDisplayScripts.register (and injected once via tabs.executeScript), all
// of which load a classic script with no module context - it cannot `import`.
// So the shared code cannot be an ES module, and this file instead defines
// globals that both sides read:
//
//   content script  the three registrations list this file BEFORE
//                   mzta-compose-script.js, so the globals exist when it runs
//   background      mzta-background.html loads it with a plain <script> before
//                   the type="module" entry point, exactly as it already does
//                   for markdown-it.min.js
//
// Same shape as js/lib/diff.js, which is likewise a classic script shared
// through a global by a content script and a page script.

// ── The two projection tiers ─────────────────────────────────────────────────
//
// A PARAGRAPH boundary projects to a blank line (\n\n); every other block
// boundary projects to a single line break (\n). This mirrors what the two
// converters this file replaces did between them: stripHtmlKeepLines() turned
// </p> into \n\n and every other block close into a single \n, while
// mztaInjectLineBreaks() emitted a single \n for every block. Splitting the
// projection into two tiers lets ONE projection serve both contracts, with the
// choice made downstream by mztaNormalizePlain():
//
//   default              (cleanupNewlines)     collapses \n{2,} -> \n, so the
//                        body contract "one \n per block, never a blank line"
//                        holds - the \n\n a <p> produced folds away.
//   { keepParagraphs }   (keepParagraphs)      caps \n{3,} -> \n\n, so the blank
//                        line a <p> produced SURVIVES for compose insertion,
//                        while every other single \n stays single.
//
// The paragraph tier is <p> ONLY, deliberately: a blank line between every <li>
// or table row would be the regression in the other direction.
const MZTA_PARA_BLOCK_SELECTOR = 'p';

// Structural break: one \n. NOT a paragraph break. cleanupNewlines() collapses
// \n{2,} on the receiving end, which is what lets this list be blunt: nested
// blocks (a <div> inside a <div>, <li> inside <ul>) and empty Outlook spacer
// paragraphs fold away instead of doubling up. <p> is deliberately absent here -
// it is the paragraph tier above.
const MZTA_LINE_BLOCK_SELECTOR =
  'div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, section, article, header, footer';

// <br> and <hr> are VOID: they hold no text, so the break replaces them rather
// than being appended inside them (appendChild on a void element is a no-op).
const MZTA_LINE_VOID_SELECTOR = 'br, hr';

// Table cells separate with a SPACE, not a newline - the row is the line, and
// the <tr> in the block selector above already ends it.
const MZTA_LINE_CELL_SELECTOR = 'td, th';

// Detects whether an HTML fragment carries its own line structure (a block-level
// element or a <br>). The ONE surviving heuristic, used only for FRAGMENTS - a
// selection Range or a compose-window twin - where no authoritative format
// exists (a Range is not a MIME part; in a plain-text window it has no tags at
// all). Never used to decide the format of a whole message, which has an
// authoritative source.
const MZTA_LINE_STRUCTURE_RE = /<\s*(br|p|div|li|ul|ol|tr|table|h[1-6]|pre|blockquote)\b/i;

// ── Hidden elements ──────────────────────────────────────────────────────────
//
// Matches the inline-style forms that mean "this element is not shown". Anchored
// on (?:^|;) so it is a DECLARATION match, not a substring one, and closed with
// \s*(?:;|!|$) so "display:none !important" and a trailing ";" both count.
//
// Why not the CSS attribute selector this replaces:
//
//   doc.querySelectorAll('[style*="display:none"]')
//
// [style*="..."] is a LITERAL SUBSTRING test. It matches only the unspaced
// spelling, so `display: none` - the form virtually every mail client,
// newsletter builder and Word/Outlook export actually emits - sailed straight
// through, and so did any mixed case. Newsletter preheaders (the preview blurb
// meant for the inbox list, not the body) and tracking markup therefore landed
// in {%mail_text_body%}. It was also wrong in the other direction: being
// unanchored it removed an element whose style merely ENDED in that text, e.g.
// a vendor longhand like "mso-hide:all;-x-display:none".
//
// Deliberately NOT a CSS parse. Inline style attributes are what mail uses for
// this; anything beyond them needs a real parser for no practical gain.
const MZTA_HIDDEN_STYLE_RE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|!|$)/i;

// Remove elements hidden by an inline style or the `hidden` attribute, IN PLACE.
// Same contract as mztaInjectLineBreaks: `root` MUST be a node the caller owns.
//
// This is a SEPARATE, OPT-IN pass rather than part of mztaInjectLineBreaks,
// because that projection also serves the INSERTION side (mztaHtmlToLines ->
// stripHtmlKeepLines, and _replaceSelectedText in mzta-background.js), which
// writes the AI answer OUT to a compose window. Dropping content on that path
// would be silent mangling. Only the two EXTRACTION sites call this:
// htmlBodyToPlainText() (background) and getCleanBodyHtml() (interactive).
//
// LIMITATION, by design: an element hidden only by a <style> block or an
// external/class rule is NOT removed. We never resolve CSS - the projection runs
// on a DETACHED DOM with no layout and no computed style, the same reason
// innerText is unusable here - and <style> is already stripped by both callers,
// so its rules are not even present to consult.
function mztaStripHidden(root) {
  for (const el of root.querySelectorAll('[style], [hidden]')) {
    if (el.hasAttribute('hidden') ||
        MZTA_HIDDEN_STYLE_RE.test(el.getAttribute('style') || '')) {
      el.remove();
    }
  }
  return root;
}

// Inject the line structure into `root`, IN PLACE, then let the caller read the
// text out of it.
//
// Why inject at all: textContent emits no break for a block-level element and
// none for <br>, so <p>/<div>/<br>/<tr>/<li> boundaries vanish from it entirely.
// Source whitespace between tags was the only thing ever keeping the lines
// apart, and Outlook/Word markup is compact - it has none - so every paragraph
// came out welded to the next ("...quotation below:DMS could be XXXXServer 2TB").
// innerText would respect the boundaries, but it is defined in terms of LAYOUT
// and returns nothing useful on a detached node, which is exactly what the
// callers hand in (a DOMParser document, or a cloned body).
//
// `root` MUST be a node the caller owns (a parsed document's body, or a clone) -
// this mutates it.
function mztaInjectLineBreaks(root) {
  const doc = root.ownerDocument || document;
  // Cells first, so the <tr> newline still wins at row level.
  for (const cell of root.querySelectorAll(MZTA_LINE_CELL_SELECTOR)) {
    cell.appendChild(doc.createTextNode(' '));
  }
  for (const el of root.querySelectorAll(MZTA_LINE_VOID_SELECTOR)) {
    el.replaceWith(doc.createTextNode('\n'));
  }
  for (const el of root.querySelectorAll(MZTA_LINE_BLOCK_SELECTOR)) {
    el.appendChild(doc.createTextNode('\n'));
  }
  // Paragraph tier: a blank line. Runs after the structural pass; <p> is not in
  // that selector, so the two never touch the same element.
  for (const el of root.querySelectorAll(MZTA_PARA_BLOCK_SELECTOR)) {
    el.appendChild(doc.createTextNode('\n\n'));
  }
  return root;
}

// The whole of `root` (a NODE) projected to text with its line structure intact.
// Clones first, so the caller's node is left untouched.
function mztaHtmlNodeToLines(root) {
  return mztaInjectLineBreaks(root.cloneNode(true)).textContent || '';
}

// The same projection with a STRING entry point, for the module-world callers
// (htmlToLines): parse to an owned document, then project. Returns text with the
// two-tier line structure; the caller runs mztaNormalizePlain() to pick the
// body-vs-paragraph contract.
function mztaHtmlToLines(htmlString) {
  const doc = new DOMParser().parseFromString(String(htmlString == null ? '' : htmlString), 'text/html');
  return mztaInjectLineBreaks(doc.body).textContent || '';
}

// The ONE plain-text normalizer, parameterized by two flags.
//
//   default              cleanupNewlines: CRLF->LF, both spellings of the
//                        non-breaking space -> ' ' (BEFORE the whitespace rules,
//                        so they collapse like any space; dropping either welds
//                        words), trailing-per-line trim, \n{2,} -> \n, space
//                        runs -> ' ', trim. The {%mail_text_body%} contract.
//   { keepParagraphs }   as above but \n{3,} -> \n\n: a single blank line
//                        survives. Feeds the compose extractions
//                        ({%mail_typed_text%}/{%mail_quoted_text%}) and plain-
//                        text insertion, whose point is that the typed/answer
//                        lines reach their target intact.
//   { keepColumns }      VERBATIM: only CRLF/CR->LF, a leading BOM and trailing
//                        whitespace. Never collapses blank lines, space runs, or
//                        the non-breaking space - the column alignment
//                        {%mail_plain_text_part%} exists to deliver, and a U+00A0
//                        the sender really put in the plain part. keepColumns
//                        wins over keepParagraphs when both are set.
function mztaNormalizePlain(text, { keepParagraphs = false, keepColumns = false } = {}) {
  if (keepColumns) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/^﻿/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\s+$/, '');
  }
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(keepParagraphs ? /\n{3,}/g : /\n{2,}/g, keepParagraphs ? '\n\n' : '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function mztaEscapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// text -> html. mode:'br' turns every \n into a <br> (for a value inserted into
// an HTML body where the breaks are carried by \n); mode:'p' wraps each line in
// an escaped <p>. Only for PLAIN text: on already-formed HTML the 'br' mode
// would inject a spurious <br> at every source newline.
function mztaLinesToHtml(text, { mode = 'br' } = {}) {
  const s = String(text == null ? '' : text);
  if (mode === 'p') {
    return s.split('\n').map(line => `<p>${mztaEscapeHtml(line)}</p>`).join('');
  }
  return s.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

// true iff the fragment carries its own line structure (a block/line tag). The
// ONE surviving heuristic - used only for fragments (see MZTA_LINE_STRUCTURE_RE).
function mztaHasLineStructure(html) {
  return (html != null) && MZTA_LINE_STRUCTURE_RE.test(String(html));
}

// All of the above are plain top-level declarations, so in a classic script they
// are already globals - there is deliberately no export here (`export` is a
// syntax error outside a module, and this file must stay loadable as a content
// script). js/mzta-utils.js and js/mzta-richtext.js reach them through globalThis
// for the same reason.
