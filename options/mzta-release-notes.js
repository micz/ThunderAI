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

// The release notes are written by hand as <h2>Version x - dd/mm/yyyy</h2> followed by its <ul>
// (the format CHANGELOG.md is generated from, see .github/scripts/changelog-sync.mjs).
// At load time each pair becomes a collapsible section: version, date, number of changes and
// a chevron; only the latest version starts open.

const SVG_NS = 'http://www.w3.org/2000/svg';

function formatDate(text) {
  const parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!parts) {
    return text.includes('?') ? browser.i18n.getMessage('releaseNotes_in_development') : text;
  }
  const date = new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
  return new Intl.DateTimeFormat(browser.i18n.getUILanguage(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function buildChevron() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'mzta_note_chevron');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'm6 9 6 6 6-6');
  svg.appendChild(path);
  return svg;
}

function buildSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  if (text !== undefined) span.textContent = text;
  return span;
}

function buildNote(h2, ul, index, open) {
  const match = h2.textContent.trim().match(/^Version\s+(\S+)\s*-\s*(.*)$/);
  const version = match ? match[1] : h2.textContent.trim();
  const date = match ? formatDate(match[2].trim()) : '';

  const items = Array.from(ul.children).filter(li => li.localName === 'li');
  let count = 0;
  for (const li of items) {
    if (li.textContent.trim() === '...') li.classList.add('mzta_note_placeholder');
    else count++;
  }

  const section = document.createElement('section');
  section.className = 'mzta_note';

  const listId = 'mzta_note_items_' + index;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mzta_note_toggle';
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.setAttribute('aria-controls', listId);
  button.append(
    buildSpan('mzta_note_version', version),
    buildSpan('mzta_note_date', date),
    buildSpan('mzta_note_spacer'),
    buildSpan('mzta_note_count', count === 1
      ? browser.i18n.getMessage('releaseNotes_one_change')
      : browser.i18n.getMessage('releaseNotes_n_changes', [String(count)])),
    buildChevron()
  );

  // keep the heading, for the document outline, with the button inside it
  h2.replaceChildren(button);

  ul.id = listId;
  ul.classList.add('mzta_note_items');
  ul.hidden = !open;

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    ul.hidden = expanded;
  });

  section.append(h2, ul);
  return section;
}

function buildNotes() {
  const container = document.getElementById('miczRelNotes');
  if (!container) return;
  const headings = Array.from(container.querySelectorAll(':scope > h2'));
  if (headings.length === 0) return;

  const notes = document.createElement('div');
  notes.className = 'mzta_notes';
  headings[0].before(notes);

  headings.forEach((h2, index) => {
    const ul = h2.nextElementSibling;
    if (!ul || ul.localName !== 'ul') return;
    notes.appendChild(buildNote(h2, ul, index, notes.children.length === 0));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  i18n.updateDocument();
  buildNotes();
}, { once: true });
