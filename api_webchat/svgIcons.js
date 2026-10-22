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

// Build a stroked icon: the shape every icon here shares (square viewBox,
// no fill, currentColor stroke with rounded joins), so each builder below is
// just a size, a stroke weight and its path data.
function strokedIcon(size, paths, strokeWidth = '1.8') {
    const svg = el('svg', {
        width: String(size),
        height: String(size),
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    for (const d of paths) {
        svg.appendChild(el('path', {
            d: d,
            stroke: 'currentColor',
            'stroke-width': strokeWidth,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        }));
    }
    return svg;
}

// Send icon (message-input send button).
export function buildSendIcon() {
    return strokedIcon(20, ['M7 11L12 6L17 11M12 18V7'], '2');
}

// Stop icon (message-input stop button).
export function buildStopIcon() {
    const svg = el('svg', {
        width: '20',
        height: '20',
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    svg.appendChild(el('rect', {
        x: '6',
        y: '6',
        width: '12',
        height: '12',
        rx: '2',
        fill: 'currentColor',
    }));
    return svg;
}

// Dropdown arrow (split-button toggle).
export function buildDropdownArrowIcon() {
    return strokedIcon(15, ['M6 9.5l6 6 6-6'], '2');
}

// Sparkle (avatar of a model turn).
export function buildSparkleIcon() {
    const svg = el('svg', {
        width: '14',
        height: '14',
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    svg.appendChild(el('path', {
        d: 'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3Z',
        fill: 'currentColor',
    }));
    return svg;
}

// Chat bubble (header logo).
export function buildChatBubbleIcon() {
    const svg = el('svg', {
        width: '13',
        height: '13',
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    svg.appendChild(el('path', {
        d: 'M3 6.5C3 5.1 4.1 4 5.5 4h13C19.9 4 21 5.1 21 6.5v9c0 1.4-1.1 2.5-2.5 2.5H9l-5 3.5v-3.5H5.5C4.1 18 3 16.9 3 15.5v-9Z',
        fill: 'currentColor',
    }));
    return svg;
}

// Copy to clipboard (two overlapping sheets).
export function buildCopyIcon(size = 15) {
    const svg = el('svg', {
        width: String(size),
        height: String(size),
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    svg.appendChild(el('rect', {
        x: '9', y: '9', width: '11', height: '11', rx: '2.4',
        stroke: 'currentColor',
        'stroke-width': '1.8',
    }));
    svg.appendChild(el('path', {
        d: 'M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    }));
    return svg;
}

// Check mark (copy confirmed, "done" status pill).
export function buildCheckIcon(size = 15) {
    return strokedIcon(size, ['M5 12.5l4.5 4.5L19 7'], '2.6');
}

// Differences (centre bar with chevrons).
export function buildDiffIcon(size = 15) {
    return strokedIcon(size, ['M12 4v16M6 8l-3 4 3 4M18 8l3 4-3 4']);
}

// Three dots — stands in for the empty side of a diff-picker change: the
// missing original of an insertion, or the missing replacement of a deletion.
// Gives that side something to click, so "keep nothing here" is the same
// gesture as every other choice.
export function buildHunkMarkerIcon(size = 11) {
    const svg = el('svg', {
        width: String(size),
        height: String(size),
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    for (const cx of ['6', '12', '18']) {
        svg.appendChild(el('circle', {
            cx: cx, cy: '12', r: '2',
            fill: 'currentColor',
        }));
    }
    return svg;
}

// Chevron pointing left / right — the diff-picker's previous / next stepper.
export function buildChevronLeftIcon(size = 15) {
    return strokedIcon(size, ['M15 18l-6-6 6-6'], '2');
}

export function buildChevronRightIcon(size = 15) {
    return strokedIcon(size, ['M9 18l6-6-6-6'], '2');
}

// Check inside a circle — the diff-picker's status indicator.
export function buildCircleCheckIcon(size = 15) {
    const svg = strokedIcon(size, ['M8.5 12.2l2.4 2.4 4.6-4.8'], '2.2');
    svg.appendChild(el('circle', {
        cx: '12', cy: '12', r: '9',
        stroke: 'currentColor',
        'stroke-width': '2.2',
    }));
    return svg;
}

// Bare check mark — "accept all" in the overflow menu.
export function buildCheckMarkIcon(size = 15) {
    return strokedIcon(size, ['M20 6L9 17l-5-5'], '2.2');
}

// Cross — "reject all" in the overflow menu.
export function buildCrossIcon(size = 15) {
    return strokedIcon(size, ['M18 6L6 18M6 6l12 12'], '2.2');
}

// Pencil over a line — "edit manually" in the overflow menu.
export function buildPencilIcon(size = 15) {
    return strokedIcon(size, [
        'M12 20h9',
        'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    ], '2');
}

// Three dots in a row — the diff-picker's "more actions" overflow button.
// Horizontally laid out like buildHunkMarkerIcon but at the wider spacing and
// larger radius the toolbar button needs; kept separate so changing one glyph
// cannot silently restyle the other.
export function buildOverflowIcon(size = 16) {
    const svg = el('svg', {
        width: String(size),
        height: String(size),
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
    });
    for (const cx of ['5', '12', '19']) {
        svg.appendChild(el('circle', {
            cx: cx, cy: '12', r: '1.8',
            fill: 'currentColor',
        }));
    }
    return svg;
}

// Save (floppy-style outline) — "save as summary".
export function buildSaveIcon(size = 15) {
    return strokedIcon(size, [
        'M5 3h11l3 3v15H5V3Z',
        'M8 3v6h7V3M8 21v-7h8v7',
    ]);
}

// Arrow into a box — "use this answer", icon-only variant.
export function buildUseAnswerIcon(size = 15) {
    return strokedIcon(size, [
        'M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7',
        'M15 4h5v5M20 4l-9 9',
    ]);
}

// Arrow down onto a line — "scroll to latest" in the transcript.
export function buildScrollToBottomIcon(size = 16) {
    return strokedIcon(size, ['M12 4v12M6.5 11.5L12 17l5.5-5.5'], '2');
}

// Exclamation in a circle — error status pill.
export function buildAlertIcon(size = 13) {
    const svg = strokedIcon(size, ['M12 7.5v5.5'], '2.4');
    svg.appendChild(el('circle', {
        cx: '12', cy: '12', r: '9',
        stroke: 'currentColor',
        'stroke-width': '1.8',
    }));
    svg.appendChild(el('circle', {
        cx: '12', cy: '16.5', r: '1.1',
        fill: 'currentColor',
    }));
    return svg;
}
