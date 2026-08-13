/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Warns before leaving a feature settings page while a textarea still holds
// unsaved text. [Thunderbird 128+ only]
//
// The feature pages (addtags, spamfilter, summarize, translate, get-task,
// get-calendar-event) all follow the same convention: every explicitly saved
// textarea has a companion "Save" button with an id starting with `btn_save`,
// which ships `disabled` in the HTML and is toggled by the textarea's `input`
// handler. So an enabled Save button *is* the dirty flag — no separate state to
// keep in sync, and no change needed in the existing input/save handlers.
//
// The plain `.option-input` controls are excluded on purpose: they are written
// to storage on `change`, so they are never pending.

// Any enabled save button means there is pending text in its textarea.
export function hasUnsavedChanges() {
    return Array.from(document.querySelectorAll('button[id^="btn_save"]'))
        .some(btn => !btn.disabled);
}

// Call once at page setup (after the DOM is ready).
export function initUnsavedGuard() {
    window.addEventListener('beforeunload', (event) => {
        if (hasUnsavedChanges()) {
            event.preventDefault();
        }
    });
}
