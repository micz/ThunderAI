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

// Small dependency-free helper to build static icon elements from trusted,
// hardcoded SVG string constants — replacing verbose createElementNS chains.
//
// The strings below are compile-time constants (no interpolation, no user or
// network data), so parsing them via <template>.innerHTML is safe under the
// strict default MV2 CSP: it involves no eval and injects no dynamic markup.
// This is intentionally NOT a template library (uhtml/lit-html): those assume
// a build step and their CSP behavior under the addons.thunderbird.net review
// policy is unverified. These icons are static and built once.

function svgFromString(svgString) {
    const template = document.createElement('template');
    // Trusted static constant only — see module note above.
    template.innerHTML = svgString.trim();
    // Import into this document so the node isn't owned by the (inert)
    // <template> content document.
    return document.importNode(template.content.firstElementChild, true);
}

// Send icon (message-input send button).
export const SEND_ICON_SVG = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="text-white dark:text-black">
  <path d="M7 11L12 6L17 11M12 18V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Stop icon (message-input stop button).
export const STOP_ICON_SVG = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="text-white dark:text-black">
  <rect x="6" y="6" width="12" height="12" fill="currentColor"/>
</svg>`;

// Dropdown arrow (split-button toggle).
export const DROPDOWN_ARROW_SVG = `
<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" stroke-width="2">
  <path d="M19 9l-7 7-7-7"/>
</svg>`;

export { svgFromString };
