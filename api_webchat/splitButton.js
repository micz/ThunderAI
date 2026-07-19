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
splitButtonStyle.textContent = `
    :host {
      display: inline-flex;
      /* Matches the original ".action-buttons button { margin: 0 10px }" spacing
         that applied to the main button when it lived directly in the row. */
      margin: 0 10px;
    }
    .split-button {
      display: inline-flex;
      position: relative;
      font-family: sans-serif;
    }

    .split-button button {
      padding: 5px 0px 5px 10px;
      cursor: pointer;
      font-size: 0.875rem;
      border: 1px outset buttonface;
    }

    .split-button button.action_btn {
      margin-right: 0;
      border-top-left-radius: 5px;
      border-bottom-left-radius: 5px;
    }

    .split-button .dropdown-toggle {
      border-left: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      margin-left:-1px;
      border-top-right-radius: 5px;
      border-bottom-right-radius: 5px;
      padding:0;
    }

    .dropdown-toggle svg {
      fill: #555;
      margin-left: -4px;
    }

    .action_btn_info {
        font-size: 0.6rem;
        color: gray;
        display: inline-block;
    }

    .dropdown-menu {
      position: absolute;
      top: 2.55rem;
      right:0;
      display: none;
      flex-direction: column;
      background-color: white;
      border: 1px solid #ccc;
      min-width: 160px;
      z-index: 1000;
      margin-top: 2px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      border-radius: 5px;
      text-align: right;
      width: -moz-available;
    }

    .dropdown-menu button {
      padding: 10px 14px;
      border: none;
      background-color: white;
      text-align: right;
      cursor: pointer;
      font-size: 0.6rem;
      color: gray;
    }

    .dropdown-menu button:hover {
      background-color: #f0f0f0;
    }

    .dropdown-menu.show {
      display: flex;
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
    }

    connectedCallback() {
        window.addEventListener('click', this._onWindowClick);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this._onWindowClick);
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
            // Without a dropdown toggle the main button is rounded on both sides.
            // (Outer spacing is provided by :host margin, not the button itself.)
            this._actionButton.style.paddingRight = '10px';
            this._actionButton.style.borderTopRightRadius = '5px';
            this._actionButton.style.borderBottomRightRadius = '5px';
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
        this._toggleBtn.setAttribute('aria-label', 'Show options');
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
            this._dropdown.classList.toggle('show');
        };
    }

    _buildArrowIcon() {
        return buildDropdownArrowIcon();
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
                this._dropdown.classList.remove('show');
            }
        }, 0);
    }
}

customElements.define('split-button', SplitButton);
