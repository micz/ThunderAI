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

// Small dependency-free builders for static icon elements, constructed
// programmatically via createElementNS (no string parsing, no innerHTML).
//
// The addons.thunderbird.net review policy does not permit .innerHTML, so
// icons are built directly as DOM nodes in the SVG namespace — the same
// pattern used by the createReplyTo*Icon helpers in js/mzta-chatgpt.js. This
// is CSP-safe (no eval, no dynamic markup) and dependency-free. These icons
// are static and built once per button.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Create an SVG-namespaced element and apply the given attributes.
function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, value);
    }
    return node;
}

// Send icon (message-input send button).
export function buildSendIcon() {
    const svg = el('svg', {
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        class: 'text-white dark:text-black',
    });
    svg.appendChild(el('path', {
        d: 'M7 11L12 6L17 11M12 18V7',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    }));
    return svg;
}

// Stop icon (message-input stop button).
export function buildStopIcon() {
    const svg = el('svg', {
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        class: 'text-white dark:text-black',
    });
    svg.appendChild(el('rect', {
        x: '6',
        y: '6',
        width: '12',
        height: '12',
        fill: 'currentColor',
    }));
    return svg;
}

// Dropdown arrow (split-button toggle).
export function buildDropdownArrowIcon() {
    const svg = el('svg', {
        viewBox: '0 0 20 20',
        width: '16',
        height: '16',
        fill: 'currentColor',
        'stroke-width': '2',
    });
    svg.appendChild(el('path', {
        d: 'M19 9l-7 7-7-7',
    }));
    return svg;
}
