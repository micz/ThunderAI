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

// CSS shared by the three shadow roots of the webchat window
// (<messages-area>, <message-input>, <split-button>).
//
// Colours are NOT here: they live as custom properties on :root in styles.css
// and reach every shadow root through normal inheritance. What cannot be
// inherited is plain CSS text — a rule like :focus-visible or a @keyframes
// declared in styles.css has no effect inside a shadow root — so the handful
// of rules every component needs are exported as strings and concatenated
// into each component's own <style>.textContent.

// Focus rings, the spinner keyframes and the reduced-motion opt-out.
export const SHARED_BASE_CSS = `
    :host {
        font-family: var(--font);
    }
    :focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    @keyframes mztaSpin {
        to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
        }
    }
`;

// Button families used by the action bar and the per-answer toolbar.
// Replaces the "1px outset buttonface" system look, which did not adapt to
// dark mode at all.
export const BUTTON_CSS = `
    .mzta-btn-secondary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--ink-2);
        padding: 7px 12px;
        border-radius: var(--r-md);
        cursor: pointer;
        font: inherit;
        font-size: .8125rem;
        font-weight: 550;
        transition: background .12s ease, border-color .12s ease;
    }
    .mzta-btn-secondary:hover:not(:disabled) {
        border-color: var(--border-strong);
        background: var(--hover);
    }
    .mzta-btn-secondary:disabled {
        opacity: .45;
        cursor: default;
    }
    .mzta-btn-tertiary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 1px solid transparent;
        color: var(--ink-2);
        padding: 7px 11px;
        border-radius: var(--r-md);
        cursor: pointer;
        font: inherit;
        font-size: .8125rem;
        font-weight: 550;
        transition: background .12s ease, color .12s ease;
    }
    .mzta-btn-tertiary:hover {
        background: var(--hover);
        color: var(--ink);
    }
    .mzta-btn-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-sm);
        color: var(--ink-2);
        cursor: pointer;
        transition: background .12s ease, border-color .12s ease;
    }
    .mzta-btn-icon:hover:not(:disabled) {
        border-color: var(--border-strong);
        background: var(--hover);
    }
    .mzta-btn-icon:disabled {
        opacity: .45;
        cursor: default;
    }
    .mzta-btn-secondary svg,
    .mzta-btn-tertiary svg,
    .mzta-btn-icon svg {
        flex-shrink: 0;
    }
`;
