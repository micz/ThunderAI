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

import { getEditorHighlight } from './mzta-editor-highlight.js';

// The token being typed, from '{%' up to the caret. Kept as a module constant so
// the trigger test and the insertion agree on what is being replaced.
const TRIGGER_RE = /{%[^\s]*$/;

const GAP = 4;          // px between the caret and the list
const MIN_SPACE = 120;  // px of room below the caret before flipping above

let idCounter = 0;

/* ---------------------------------------------------------------------------
   Shared close controller.

   One document-level listener for the whole page, not one per textarea: the
   previous version registered a 'click' handler inside textareaAutocomplete(),
   so a page with N rows accumulated N listeners, each closing over a textarea
   that might since have been removed from the DOM.
   --------------------------------------------------------------------------- */
const openInstances = new Set();
let controllerAttached = false;

function closeAllExcept(keep) {
    for (const inst of Array.from(openInstances)) {
        if (inst !== keep) inst.close();
    }
}

function attachController() {
    if (controllerAttached) return;
    controllerAttached = true;

    document.addEventListener('mousedown', (e) => {
        // mousedown, not click: the list items also act on mousedown, and they
        // stop propagation, so anything reaching here is genuinely outside.
        for (const inst of Array.from(openInstances)) {
            if (!inst.ownsEvent(e)) inst.close();
        }
    }, true);

    // Reposition-or-close: the list is position:fixed, so once the page or a
    // scroll container moves, its coordinates are stale. Closing is the simpler
    // and more predictable of the two options allowed by the design.
    window.addEventListener('scroll', () => closeAllExcept(null), true);
    window.addEventListener('resize', () => closeAllExcept(null));
}

/* ---------------------------------------------------------------------------
   Caret position.

   Phase 1's highlight mirror can locate the caret exactly, by planting a
   zero-width anchor at selectionStart and measuring it. Pages without a mirror
   (the six single-textarea settings pages) fall back to the bottom-left of the
   textarea, which is where the list used to open unconditionally.
   --------------------------------------------------------------------------- */
function caretRect(textarea) {
    const highlight = getEditorHighlight(textarea);
    if (highlight) {
        const rect = highlight.getCaretRect();
        if (rect) return rect;
    }
    const box = textarea.getBoundingClientRect();
    return { left: box.left, top: box.top, bottom: box.bottom, height: box.height };
}

export function textareaAutocomplete(textarea, suggestions, type_value = -1) {
    const container = textarea.closest('.autocomplete-container');
    if (!container) return null;
    const autocompleteList = container.querySelector('.autocomplete-list');
    if (!autocompleteList) return null;

    // Re-registration guard. showItemRowEditor() calls this again on every entry
    // into edit mode, and the load-time loop may also have covered the same
    // textarea; without this each call would stack a full set of listeners.
    if (textarea._mztaAutocomplete) return textarea._mztaAutocomplete;

    let activeIndex = -1;
    let current = [];   // suggestion objects currently listed

    if (!autocompleteList.id) autocompleteList.id = 'mzta_ac_list_' + (++idCounter);
    autocompleteList.setAttribute('role', 'listbox');
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-expanded', 'false');
    textarea.setAttribute('aria-controls', autocompleteList.id);

    attachController();

    function isOpen() {
        return !autocompleteList.classList.contains('hidden');
    }

    // Places the list at the caret. Flips above when there is not enough room
    // below, and clamps horizontally so it never leaves the viewport.
    // Must run with the list already un-hidden: a display:none element measures
    // 0x0, which would defeat both the flip test and the horizontal clamp.
    function position() {
        const rect = caretRect(textarea);
        const listBox = autocompleteList.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom;
        const flip = below < Math.min(MIN_SPACE, listBox.height + GAP)
                     && rect.top > below;

        const top = flip ? Math.max(GAP, rect.top - listBox.height - GAP)
                         : rect.bottom + GAP;
        const maxLeft = window.innerWidth - listBox.width - GAP;
        const left = Math.max(GAP, Math.min(rect.left, maxLeft));

        autocompleteList.style.top = top + 'px';
        autocompleteList.style.left = left + 'px';
    }

    function render(matches, typedLength) {
        autocompleteList.replaceChildren();
        current = matches;
        activeIndex = -1;

        matches.forEach((s, index) => {
            const li = document.createElement('li');
            li.id = autocompleteList.id + '_opt' + index;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            // The typed prefix is bold so it is obvious what is being matched.
            // Built through the DOM rather than an HTML string: suggestion
            // commands and labels are user data (custom placeholders), so no
            // escaping step can be forgotten here.
            const cmd = document.createElement('span');
            cmd.className = 'ac_cmd';
            const typed = document.createElement('b');
            typed.textContent = s.command.slice(0, typedLength);
            cmd.appendChild(typed);
            cmd.appendChild(document.createTextNode(s.command.slice(typedLength)));
            li.appendChild(cmd);
            if (s.label && s.label !== s.command) {
                const desc = document.createElement('span');
                desc.className = 'ac_desc';
                desc.textContent = s.label;
                li.appendChild(desc);
            }
            li.addEventListener('mousedown', (e) => {
                // mousedown + preventDefault, not click: a click lets the
                // textarea lose focus and collapse its selection before the
                // insertion runs, and the insertion needs the caret intact.
                e.preventDefault();
                e.stopPropagation();
                insertAutocomplete(s.command);
                close();
            });
            autocompleteList.appendChild(li);
        });

        autocompleteList.classList.remove('hidden');
        textarea.setAttribute('aria-expanded', 'true');
        openInstances.add(instance);
        position();
    }

    function close() {
        autocompleteList.classList.add('hidden');
        textarea.setAttribute('aria-expanded', 'false');
        textarea.removeAttribute('aria-activedescendant');
        activeIndex = -1;
        current = [];
        openInstances.delete(instance);
    }

    function setActive(index) {
        const items = autocompleteList.querySelectorAll('li');
        if (items.length === 0) return;
        activeIndex = index;
        items.forEach((item, i) => {
            const on = i === activeIndex;
            item.classList.toggle('active', on);
            item.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) {
                item.scrollIntoView({ block: 'nearest' });
                textarea.setAttribute('aria-activedescendant', item.id);
            }
        });
    }

    function accept() {
        if (current.length === 0) return false;
        const index = activeIndex === -1 ? 0 : activeIndex;
        if (index < 0 || index >= current.length) return false;
        insertAutocomplete(current[index].command);
        close();
        return true;
    }

    function insertAutocomplete(command) {
        const cursorPosition = textarea.selectionStart;
        const textBefore = textarea.value.substring(0, cursorPosition);
        const match = textBefore.match(TRIGGER_RE);
        if (!match) return;

        const completion = command.substring(match[0].length);
        // Insert through the editing host rather than assigning .value: a direct
        // assignment wipes the native undo stack and fires no 'input' event,
        // which would leave the highlight mirror painting stale text while the
        // caret advances over glyphs that are never repainted.
        textarea.focus();
        if (!document.execCommand('insertText', false, completion)) {
            textarea.setRangeText(completion, cursorPosition, cursorPosition, 'end');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Dynamic placeholders complete to '{%id:%}': leave the caret before the
        // ':%}' so the value can be typed straight away.
        const back = command.endsWith(':%}') ? 2 : 0;
        const newCursorPosition = cursorPosition + completion.length - back;
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    }

    function onInput() {
        const text = textarea.value.substring(0, textarea.selectionStart);
        const match = text.match(TRIGGER_RE);
        if (!match) {
            if (isOpen()) close();
            return;
        }
        const lastWord = match[0];
        let type = type_value;
        if (type_value === -1) {
            // Resolve the prompt type lazily from the row, so changing the
            // selector mid-edit takes effect immediately. Uses closest() rather
            // than a fixed parentNode chain: the editor markup nests the
            // textarea inside a backdrop wrapper, and any further change to that
            // depth must not silently break type filtering.
            const tr = textarea.closest('tr');
            const type_select = tr ? tr.querySelector('.type_output') : null;
            if (type_select) type = type_select.value;
        }
        const matches = suggestions.filter(s => s.command.startsWith(lastWord)
            && (String(s.type) === String(type) || String(s.type) === '0'));
        if (matches.length === 0) {
            if (isOpen()) close();
            return;
        }
        render(matches, lastWord.length);
    }

    function onKeydown(e) {
        if (!isOpen()) return;
        const items = autocompleteList.querySelectorAll('li');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((activeIndex + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((activeIndex - 1 + items.length) % items.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            // Tab accepts like Enter rather than moving focus away mid-token.
            if (accept()) e.preventDefault();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeydown);
    textarea.addEventListener('blur', () => { if (isOpen()) close(); });

    const instance = {
        close,
        // True when the event happened inside this instance's own textarea or
        // list, i.e. it must not dismiss it.
        ownsEvent(e) {
            return e.target === textarea || autocompleteList.contains(e.target);
        },
        destroy() {
            close();
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('keydown', onKeydown);
            textarea.removeAttribute('aria-autocomplete');
            textarea.removeAttribute('aria-expanded');
            textarea.removeAttribute('aria-controls');
            delete textarea._mztaAutocomplete;
        },
    };

    textarea._mztaAutocomplete = instance;
    return instance;
}
