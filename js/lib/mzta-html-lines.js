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

// The ONE HTML -> plain text line projection, shared by the two extractions that
// feed {%mail_text_body%}:
//
//   interactive (menu/popup)  js/mzta-compose-script.js  -> getTextOnly
//   automatic  (background)   js/mzta-utils.js           -> htmlBodyToPlainText()
//
// Both used to carry their own hand-copied twin of this, including the block-tag
// list spelled out twice. They are the same rule and must stay the same rule:
// fixing a boundary in one and not the other is precisely how these two drifted
// apart before.
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

// Structural break: one \n. NOT a paragraph break (\n\n) - the consumers'
// contract for the mail body is one line per block and never a blank line, and
// cleanupNewlines() collapses \n{2,} on the receiving end anyway. That collapse
// is what lets this list be blunt: nested blocks (a <p> inside a <div>, <li>
// inside <ul>) and empty Outlook spacer paragraphs
// (<p class=MsoNormal><o:p>&nbsp;</o:p></p>) fold away instead of doubling up.
const MZTA_LINE_BLOCK_SELECTOR =
  'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, section, article, header, footer';

// <br> and <hr> are VOID: they hold no text, so the break replaces them rather
// than being appended inside them (appendChild on a void element is a no-op).
const MZTA_LINE_VOID_SELECTOR = 'br, hr';

// Table cells separate with a SPACE, not a newline - the row is the line, and
// the <tr> in the block selector above already ends it.
const MZTA_LINE_CELL_SELECTOR = 'td, th';

// Inject the line structure into `root`, IN PLACE, then let the caller read the
// text out of it.
//
// Why inject at all: textContent emits no break for a block-level element and
// none for <br>, so <p>/<div>/<br>/<tr>/<li> boundaries vanish from it entirely.
// Source whitespace between tags was the only thing ever keeping the lines
// apart, and Outlook/Word markup is compact - it has none - so every paragraph
// came out welded to the next ("...quotation below:DMS could be XXXXServer 2TB").
// innerText would respect the boundaries, but it is defined in terms of LAYOUT
// and returns nothing useful on a detached node, which is exactly what both
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
  return root;
}

// The whole of `root` projected to text with its line structure intact.
// Clones first, so the caller's node is left untouched.
function mztaHtmlNodeToLines(root) {
  return mztaInjectLineBreaks(root.cloneNode(true)).textContent || '';
}

// Both functions are plain top-level declarations, so in a classic script they
// are already globals - there is deliberately no export here (`export` is a
// syntax error outside a module, and this file must stay loadable as a content
// script). js/mzta-utils.js reaches them through globalThis for the same reason.
