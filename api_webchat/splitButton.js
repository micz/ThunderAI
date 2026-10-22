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

import { buildDropdownArrowIcon } from './svgIcons.js';
import { SHARED_BASE_CSS } from './sharedStyles.js';

// <split-button> encapsulates the "use this answer" action button used by
// <messages-area>. It owns a main button (label + optional info line + click
// handler) and an OPTIONAL single dropdown option (label + click handler).
//
// The important reason this is a custom element and not inline markup: the
// outside-click-to-close listener on `window` is registered in
// connectedCallback() and removed in disconnectedCallback(). Previously the
// listener was attached inline in MessagesArea.addActionButtons() on every
// chat turn and never removed, so the handlers accumulated on `window` across
// turns (memory leak + multiple stale handlers competing on the same click).
// Tying the listener to the element lifecycle fixes that leak.
//
// The API is intentionally minimal, matching the sole current usage (one main
// button + at most one dropdown option). Do not over-generalize.

const splitButtonTemplate = document.createElement('template');

const splitButtonStyle = document.createElement('style');
splitButtonStyle.textContent = SHARED_BASE_CSS + `
    :host {
      display: inline-flex;
    }
    .split-button {
      display: inline-flex;
      position: relative;
    }

    .split-button button {
      cursor: pointer;
      font: inherit;
      border: none;
      transition: background .12s ease;
    }

    .split-button button.action_btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      background: var(--accent);
      color: #fff;
      padding: 8px 14px;
      border-radius: var(--r-md) 0 0 var(--r-md);
      font-size: .84375rem;
      font-weight: 650;
      line-height: 1.1;
      text-align: left;
    }

    .split-button button.action_btn:hover {
      background: var(--accent-dark);
    }

    /* No dropdown: the main button is rounded on both sides. */
    :host([standalone]) .split-button button.action_btn {
      border-radius: var(--r-md);
    }

    .split-button .dropdown-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 9px;
      background: var(--accent-dark);
      color: #fff;
      border-radius: 0 var(--r-md) var(--r-md) 0;
    }

    .split-button .dropdown-toggle:hover {
      background: color-mix(in srgb, var(--accent-dark) 85%, #000);
    }

    .action_btn_info {
        font-size: .65625rem;
        font-weight: 500;
        opacity: .85;
        display: inline-block;
    }

    .dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      display: none;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      min-width: 150px;
      z-index: 1000;
      box-shadow: 0 10px 28px -8px var(--shadow);
      border-radius: 10px;
      padding: 5px;
    }

    .dropdown-menu button {
      padding: 9px 12px;
      background: none;
      text-align: left;
      font-size: .8125rem;
      color: var(--ink);
      border-radius: var(--r-sm);
    }

    .dropdown-menu button:hover {
      background: var(--hover);
    }

    .dropdown-menu.show {
      display: flex;
      animation: mztaDropdownIn .12s ease-out;
    }

    @keyframes mztaDropdownIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
`;
splitButtonTemplate.content.appendChild(splitButtonStyle);

const splitButtonContainer = document.createElement('div');
splitButtonContainer.className = 'split-button';
splitButtonTemplate.content.appendChild(splitButtonContainer);

class SplitButton extends HTMLElement {

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(splitButtonTemplate.content.cloneNode(true));

        this._container = shadowRoot.querySelector('.split-button');

        // Main action button
        this._actionButton = document.createElement('button');
        this._actionButton.className = 'action_btn';
        this._container.appendChild(this._actionButton);

        this._dropdown = null;
        this._toggleBtn = null;
        // "ignore the click that opened the menu" guard, preserved from the
        // original inline implementation.
        this._dropdownJustOpened = false;

        // Bound so the exact same reference can be added in connectedCallback
        // and removed in disconnectedCallback.
        this._onWindowClick = this._onWindowClick.bind(this);
        this._onWindowKeydown = this._onWindowKeydown.bind(this);
    }

    connectedCallback() {
        window.addEventListener('click', this._onWindowClick);
        window.addEventListener('keydown', this._onWindowKeydown);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this._onWindowClick);
        window.removeEventListener('keydown', this._onWindowKeydown);
    }

    // Configure the main button.
    //   line1:   primary label (string)
    //   line2:   optional secondary info line (string) rendered smaller/grayed
    //   onClick: click handler
    // When there is no dropdown, the main button gets the rounded-right styling
    // (matching the original "else" branch) via `standalone: true`.
    setMainButton({ line1, line2 = null, onClick, standalone = false }) {
        this._actionButton.textContent = '';
        const line1El = document.createElement('span');
        line1El.textContent = line1;
        this._actionButton.appendChild(line1El);

        if (line2) {
            const line2El = document.createElement('span');
            line2El.classList.add('action_btn_info');
            line2El.textContent = line2;
            this._actionButton.appendChild(document.createElement('br'));
            this._actionButton.appendChild(line2El);
        }

        if (standalone) {
            // Without a dropdown toggle the main button is rounded on both
            // sides; the :host([standalone]) rule handles the radius.
            this.setAttribute('standalone', '');
        }

        if (onClick) {
            this._actionButton.addEventListener('click', onClick);
        }
    }

    // Add the (single) dropdown option, along with the toggle arrow button.
    //   label:   option label (string)
    //   onClick: option click handler
    setDropdownOption({ label, onClick }) {
        // Dropdown toggle button
        this._toggleBtn = document.createElement('button');
        this._toggleBtn.className = 'dropdown-toggle';
        this._toggleBtn.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_show_options'));
        this._toggleBtn.setAttribute('aria-expanded', 'false');
        this._toggleBtn.setAttribute('aria-haspopup', 'true');
        this._toggleBtn.appendChild(this._buildArrowIcon());
        this._container.appendChild(this._toggleBtn);

        // Dropdown menu
        this._dropdown = document.createElement('div');
        this._dropdown.className = 'dropdown-menu';
        this._dropdown.id = 'dropdown';

        const optionBtn = document.createElement('button');
        optionBtn.textContent = label;
        optionBtn.onclick = onClick;
        this._dropdown.appendChild(optionBtn);
        this._container.appendChild(this._dropdown);

        this._toggleBtn.onclick = () => {
            this._dropdownJustOpened = true;
            this._setDropdownOpen(!this._dropdown.classList.contains('show'));
        };
    }

    // Single place that flips the menu, so aria-expanded can never drift out
    // of sync with what is on screen.
    _setDropdownOpen(open) {
        if (!this._dropdown) { return; }
        this._dropdown.classList.toggle('show', open);
        this._toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    _buildArrowIcon() {
        return buildDropdownArrowIcon();
    }

    _onWindowKeydown(e) {
        if (e.key !== 'Escape') { return; }
        if (!this._dropdown || !this._dropdown.classList.contains('show')) { return; }
        this._setDropdownOpen(false);
        this._toggleBtn.focus();
    }

    _onWindowClick(e) {
        if (!this._dropdown) { return; }
        // Delay the execution to allow other handlers (like toggle) to run first
        if (this._dropdownJustOpened) {
            this._dropdownJustOpened = false;
            return; // Skip this click because it's the one that opened the menu
        }
        setTimeout(() => {
            // e.target may be inside this element's light DOM; the original
            // used splitButton.contains(e.target). `this.contains` covers the
            // host element and its (light DOM) descendants; clicks reaching
            // `window` from inside the shadow root are retargeted to the host,
            // so `this` is the right containment check.
            if (!this.contains(e.target)) {
                this._setDropdownOpen(false);
            }
        }, 0);
    }
}

customElements.define('split-button', SplitButton);
