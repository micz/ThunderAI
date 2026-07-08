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

// One-shot renderer for the collapsible "thinking" block. No Shadow DOM and no
// lifecycle: after rendering, open/close is handled natively by
// <details>/<summary>. It builds the <details class="thinking-block"> and
// appends it into the caller-supplied `container`.
//
// The `details.thinking-block` CSS (incl. the dark-mode variant) lives in
// <messages-area>'s shared shadow-root style, because this block is appended
// into that shadow root — global styles.css cannot reach shadow-DOM content.
//
//   container:    element to append the block into
//   thinkingText: the thinking content (nothing is rendered if empty)
//   collapsed:    initial open/collapsed state (true -> collapsed, false -> open).
//                 Mirrors the `hide_thinking` preference; users can toggle after.

export function renderThinkingBlock(container, thinkingText, collapsed) {
    if (!thinkingText) { return; }

    const details = document.createElement('details');
    details.classList.add('thinking-block');
    if (!collapsed) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = browser.i18n.getMessage('prefs_OptionText_thinking_summary') || 'Thinking';
    const content = document.createElement('div');
    content.classList.add('thinking-content');
    content.textContent = thinkingText;
    details.appendChild(summary);
    details.appendChild(content);
    container.appendChild(details);
}
