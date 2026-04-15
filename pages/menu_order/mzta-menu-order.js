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

import { getPrompts, setDefaultPromptsProperties, setCustomPrompts, setSpecialPrompts, getHiddenSpecialPromptIds } from '../../js/mzta-prompts.js';
import { i18nConditionalGet } from '../../js/mzta-utils.js';

let allPrompts = [];
let allExcludedSpecialPrompts = []; // special prompts excluded from UI (hidden + inactive features), preserved on save
let currentPopupView = 'display'; // 'display' or 'compose'
let hasUnsavedChanges = false;

document.addEventListener('DOMContentLoaded', async () => {
    allPrompts = await getPrompts(false, [], true);

    // Exclude special prompts that are defined with show_in: "none" (internal prompts, not user-toggleable)
    // and special prompts whose feature is not active (e.g. add_tags disabled, sparks not present)
    const hiddenSpecialIds = getHiddenSpecialPromptIds();
    const activeSpecialIds = await browser.runtime.sendMessage({ command: "get_active_special_ids" });
    allExcludedSpecialPrompts = allPrompts.filter(p =>
        hiddenSpecialIds.includes(p.id) ||
        (String(p.is_special) === '1' && !activeSpecialIds.includes(p.id))
    );
    allPrompts = allPrompts.filter(p => !allExcludedSpecialPrompts.some(e => e.id === p.id));

    // Resolve i18n names and assign initial position_context if missing
    let contextPos = 1;
    const sortedForContext = [...allPrompts].sort((a, b) => {
        const nameA = i18nConditionalGet(a.name);
        const nameB = i18nConditionalGet(b.name);
        return nameA.localeCompare(nameB);
    });
    sortedForContext.forEach(p => {
        if (p.position_context === undefined || p.position_context === '' || p.position_context === 'undefined') {
            p.position_context = contextPos;
        }
        contextPos++;
    });

    // Resolve display names
    allPrompts.forEach(p => {
        p._displayName = i18nConditionalGet(p.name);
    });

    renderPopupList();
    renderContextList();
    initSubTabs();

    document.getElementById('btnSave').addEventListener('click', saveAll);

    i18n.updateDocument();
});

// ==================== Sub-tabs ====================

function initSubTabs() {
    document.querySelectorAll('.sub_tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sub_tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPopupView = btn.dataset.view;
            renderPopupList();
        });
    });
}

// ==================== Render Popup List ====================

function renderPopupList() {
    const posKey = currentPopupView === 'display' ? 'position_display' : 'position_compose';
    // Filter by type: reading view shows type 0+1, composing view shows type 0+2
    const allowedTypes = currentPopupView === 'display' ? ['0', '1'] : ['0', '2'];
    const typeFiltered = allPrompts.filter(p => allowedTypes.includes(String(p.type)));

    const activeItems = typeFiltered.filter(p => {
        const showIn = p.show_in || 'popup';
        return showIn === 'popup' || showIn === 'both';
    });
    const hiddenItems = typeFiltered.filter(p => {
        const showIn = p.show_in || 'popup';
        return showIn !== 'popup' && showIn !== 'both';
    });

    activeItems.sort((a, b) => (a[posKey] || 9999) - (b[posKey] || 9999));
    hiddenItems.sort((a, b) => a._displayName.localeCompare(b._displayName));

    const activeList = document.getElementById('popup_list');
    const hiddenList = document.getElementById('popup_list_hidden');

    renderListItems(activeList, activeItems, 'popup', true);
    renderListItems(hiddenList, hiddenItems, 'popup', false);

    initDragAndDrop(activeList, posKey);
}

// ==================== Render Context List ====================

function renderContextList() {
    // Only show items with type 0 or 1 (not composing-only)
    const contextEligible = allPrompts.filter(p => String(p.type) === '0' || String(p.type) === '1');

    const activeItems = contextEligible.filter(p => {
        const showIn = p.show_in || 'popup';
        return showIn === 'context' || showIn === 'both';
    });
    const hiddenItems = contextEligible.filter(p => {
        const showIn = p.show_in || 'popup';
        return showIn !== 'context' && showIn !== 'both';
    });

    activeItems.sort((a, b) => (a.position_context || 9999) - (b.position_context || 9999));
    hiddenItems.sort((a, b) => a._displayName.localeCompare(b._displayName));

    const activeList = document.getElementById('context_list');
    const hiddenList = document.getElementById('context_list_hidden');

    renderListItems(activeList, activeItems, 'context', true);
    renderListItems(hiddenList, hiddenItems, 'context', false);

    initDragAndDrop(activeList, 'position_context');
}

// ==================== Render List Items ====================

function renderListItems(listEl, items, menuType, isActive) {
    listEl.innerHTML = '';
    items.forEach(prompt => {
        const li = document.createElement('li');
        li.classList.add('sortable_item');
        li.dataset.id = prompt.id;
        if (isActive) {
            li.draggable = true;
        }

        // Drag handle
        const handle = document.createElement('span');
        handle.classList.add('drag_handle');
        handle.textContent = '\u2630';
        li.appendChild(handle);

        // Toggle checkbox
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.classList.add('item_toggle');
        toggle.checked = isActive;
        toggle.addEventListener('change', () => {
            toggleShowIn(prompt, menuType, toggle.checked);
        });
        li.appendChild(toggle);

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.classList.add('item_name');
        nameSpan.textContent = prompt._displayName;
        li.appendChild(nameSpan);

        // Type badge
        const typeBadge = document.createElement('span');
        typeBadge.classList.add('badge', 'badge_type');
        if (String(prompt.type) === '1') {
            typeBadge.textContent = browser.i18n.getMessage('menu_order_type_reading');
        } else if (String(prompt.type) === '2') {
            typeBadge.textContent = browser.i18n.getMessage('menu_order_type_composing');
        } else {
            typeBadge.textContent = browser.i18n.getMessage('menu_order_type_always');
        }
        li.appendChild(typeBadge);

        // Source badge
        const sourceBadge = document.createElement('span');
        sourceBadge.classList.add('badge');
        if (String(prompt.is_special) === '1') {
            sourceBadge.classList.add('badge_special');
            sourceBadge.textContent = browser.i18n.getMessage('menu_order_badge_special');
        } else if (String(prompt.is_default) === '1') {
            sourceBadge.classList.add('badge_default');
            sourceBadge.textContent = browser.i18n.getMessage('menu_order_badge_default');
        } else {
            sourceBadge.classList.add('badge_custom');
            sourceBadge.textContent = browser.i18n.getMessage('menu_order_badge_custom');
        }
        li.appendChild(sourceBadge);

        listEl.appendChild(li);
    });
}

// ==================== Toggle show_in ====================

function toggleShowIn(prompt, menuType, isOn) {
    const current = prompt.show_in || 'popup';

    if (menuType === 'popup') {
        if (isOn) {
            prompt.show_in = (current === 'none') ? 'popup' : (current === 'context') ? 'both' : current;
        } else {
            prompt.show_in = (current === 'popup') ? 'none' : (current === 'both') ? 'context' : current;
        }
    } else { // context
        if (isOn) {
            prompt.show_in = (current === 'none') ? 'context' : (current === 'popup') ? 'both' : current;
        } else {
            prompt.show_in = (current === 'context') ? 'none' : (current === 'both') ? 'popup' : current;
        }
    }

    markUnsaved();
    renderPopupList();
    renderContextList();
}

// ==================== Drag and Drop ====================

function initDragAndDrop(listEl, positionKey) {
    let draggedItem = null;

    listEl.addEventListener('dragstart', (e) => {
        const li = e.target.closest('.sortable_item');
        if (!li) return;
        draggedItem = li;
        draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.id);
    });

    listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!draggedItem) return;

        // Remove previous drag-over indicators
        listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        const afterElement = getDragAfterElement(listEl, e.clientY);
        if (afterElement) {
            afterElement.classList.add('drag-over');
            listEl.insertBefore(draggedItem, afterElement);
        } else {
            listEl.appendChild(draggedItem);
        }
    });

    listEl.addEventListener('dragleave', (e) => {
        if (e.target.classList) {
            e.target.classList.remove('drag-over');
        }
    });

    listEl.addEventListener('drop', (e) => {
        e.preventDefault();
        listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    listEl.addEventListener('dragend', () => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            updatePositionsFromDOM(listEl, positionKey);
            draggedItem = null;
            markUnsaved();
        }
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.sortable_item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updatePositionsFromDOM(listEl, positionKey) {
    const items = listEl.querySelectorAll('.sortable_item');
    items.forEach((li, index) => {
        const promptId = li.dataset.id;
        const prompt = allPrompts.find(p => p.id === promptId);
        if (prompt) {
            prompt[positionKey] = index + 1;
        }
    });
}

// ==================== Save ====================

async function saveAll() {
    const btnSave = document.getElementById('btnSave');
    const msgDisplay = document.getElementById('msgDisplay');
    btnSave.disabled = true;

    const defaultPromptsToSave = allPrompts.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1');
    const customPromptsToSave = allPrompts.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1');
    const specialPromptsToSave = allPrompts.filter(p => String(p.is_special) === '1').concat(allExcludedSpecialPrompts);

    await setDefaultPromptsProperties(defaultPromptsToSave);
    await setCustomPrompts(customPromptsToSave);
    await setSpecialPrompts(specialPromptsToSave);

    await browser.runtime.sendMessage({ command: "reload_menus" });

    hasUnsavedChanges = false;
    msgDisplay.textContent = browser.i18n.getMessage('menu_order_saved');
    setTimeout(() => { msgDisplay.textContent = ''; }, 3000);
}

function markUnsaved() {
    hasUnsavedChanges = true;
    document.getElementById('btnSave').disabled = false;
    document.getElementById('msgDisplay').textContent = '';
}
