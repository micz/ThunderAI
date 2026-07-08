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

// One-shot word-diff renderer. No Shadow DOM and no lifecycle: it builds the
// diff nodes and appends them into the caller-supplied `container`. The
// `.added` / `.removed` CSS lives in <messages-area>'s shared shadow-root
// style (its historical home) because the diff nodes are appended into that
// shadow root — global styles.css cannot reach shadow-DOM content.
//
// `Diff` is the global from js/lib/diff.js, loaded as a classic script in
// index.html before the module scripts.

export function renderDiff(container, originalText, newText) {
    const wordDiff = Diff.diffWords(originalText, newText);

    // Iterate over each part of the diff to create the HTML output
    wordDiff.forEach(part => {
        // Split part.value by <br> (handling <br>, <br/>, <br />)
        const brRegex = /(<br\s*\/?>)/gi;
        const segments = part.value.split(brRegex);

        segments.forEach(segment => {
        if (segment.match(brRegex)) {
            // It's a <br>, add a real <br> element
            container.appendChild(document.createElement("br"));
        } else if (segment.length > 0) {
            const diffElement = document.createElement("span");
            if (part.added) {
            diffElement.className = "added";
            diffElement.textContent = segment;
            } else if (part.removed) {
            diffElement.className = "removed";
            diffElement.textContent = segment;
            } else {
            diffElement.textContent = segment;
            }
            container.appendChild(diffElement);
        }
        });
    });
}
