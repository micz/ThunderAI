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

import {
    getPrompts,
    setDefaultPromptsProperties,
    setCustomPrompts,
    setSpecialPrompts,
    getHiddenSpecialPromptIds
} from '../../js/mzta-prompts.js';
import { i18nConditionalGet, specialPromptToContextMenuID, contextMenuIconsPath } from '../../js/mzta-utils.js';
import { customMenuIcons, customMenuIconsPath } from './mzta-custom-menu-icons.js';

// Convert "moz-extension:images/foo.png" to a relative path usable from this page
function resolveSpecialIconPath(promptId) {
    const ctxId = specialPromptToContextMenuID[promptId];
    if (!ctxId) return '';
    const raw = contextMenuIconsPath[ctxId];
    if (!raw) return '';
    return '../../' + raw.replace(/^moz-extension:/, '');
}

let allPrompts = [];
let allExcludedSpecialPrompts = []; // special prompts excluded from UI (hidden + inactive features), preserved on save
let allDisabledPrompts = []; // default/custom prompts disabled (enabled=0), excluded from UI, preserved on save
let currentPopupView = 'display'; // 'display' or 'compose'

document.addEventListener('DOMContentLoaded', async () => {
    await loadAndRender();
    initSubTabs();

    document.getElementById('btnSaveAll').addEventListener('click', saveAll);

    // If prompts are modified elsewhere (e.g. custom prompts page saving), reload this page's data.
    // Any unsaved changes on this page are discarded to avoid overwriting the other page's changes.
    let reloadDebounce = null;
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (!(changes._default_prompts_properties || changes._custom_prompt || changes._special_prompts)) return;
        clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(() => {
            document.getElementById('btnSaveAll').disabled = true;
            const msgDisplay = document.getElementById('msgDisplay');
            msgDisplay.textContent = '';
            msgDisplay.style.display = 'none';
            loadAndRender();
        }, 200);
    });

    i18n.updateDocument();
});

async function loadAndRender() {
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

    // Exclude disabled prompts (enabled=0) from the UI, preserve them for save
    allDisabledPrompts = allPrompts.filter(p => String(p.enabled) === '0');
    allPrompts = allPrompts.filter(p => String(p.enabled) !== '0');

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
}

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

        // Icon slot (context menu only) - between handle and toggle, to keep rows aligned
        if (menuType === 'context') {
            if (String(prompt.is_special) === '1') {
                li.appendChild(buildSpecialIconDisplay(prompt));
            } else {
                li.appendChild(buildIconPicker(prompt));
            }
        }

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

// ==================== Custom icon picker ====================

let activeIconPopover = null;

function closeIconPopover() {
    if (activeIconPopover) {
        activeIconPopover.remove();
        activeIconPopover = null;
        document.removeEventListener('mousedown', onDocMouseDownForPopover, true);
        document.removeEventListener('keydown', onDocKeyDownForPopover, true);
    }
}

function onDocMouseDownForPopover(e) {
    if (activeIconPopover && !activeIconPopover.contains(e.target) && !e.target.classList.contains('item_icon_preview')) {
        closeIconPopover();
    }
}

function onDocKeyDownForPopover(e) {
    if (e.key === 'Escape') closeIconPopover();
}

function applyIconToPreview(preview, filename) {
    if (filename) {
        preview.src = '../../' + customMenuIconsPath + filename;
        preview.classList.remove('item_icon_preview_empty');
    } else {
        preview.src = '../../' + customMenuIconsPath + 'empty_icon.png';
        preview.classList.add('item_icon_preview_empty');
    }
}

function buildSpecialIconDisplay(prompt) {
    const img = document.createElement('img');
    img.classList.add('item_icon_preview', 'item_icon_preview_special');
    img.alt = '';
    const path = resolveSpecialIconPath(prompt.id);
    if (path) {
        img.src = path;
    } else {
        img.src = '../../' + customMenuIconsPath + 'empty_icon.png';
        img.classList.add('item_icon_preview_empty');
    }
    return img;
}

function buildIconPicker(prompt) {
    const preview = document.createElement('img');
    preview.classList.add('item_icon_preview');
    preview.alt = '';
    preview.title = browser.i18n.getMessage('menu_order_icon_label');
    applyIconToPreview(preview, prompt.custom_icon || '');

    preview.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeIconPopover && activeIconPopover.dataset.forId === prompt.id) {
            closeIconPopover();
            return;
        }
        closeIconPopover();
        openIconPopover(preview, prompt);
    });

    return preview;
}

function openIconPopover(anchorEl, prompt) {
    const popover = document.createElement('div');
    popover.classList.add('icon_picker_popover');
    popover.dataset.forId = prompt.id;

    // "None" option
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.classList.add('icon_picker_cell', 'icon_picker_cell_none');
    noneBtn.title = browser.i18n.getMessage('menu_order_icon_none');
    const noneImg = document.createElement('img');
    noneImg.src = '../../' + customMenuIconsPath + 'empty_icon.png';
    noneImg.alt = '';
    noneBtn.appendChild(noneImg);
    if (!prompt.custom_icon) noneBtn.classList.add('selected');
    noneBtn.addEventListener('click', () => {
        prompt.custom_icon = '';
        applyIconToPreview(anchorEl, '');
        markUnsaved();
        closeIconPopover();
    });
    popover.appendChild(noneBtn);

    customMenuIcons.forEach(filename => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('icon_picker_cell');
        btn.title = filename.replace(/\.[^.]+$/, '');
        if (filename === prompt.custom_icon) btn.classList.add('selected');

        const img = document.createElement('img');
        img.src = '../../' + customMenuIconsPath + filename;
        img.alt = '';
        btn.appendChild(img);

        btn.addEventListener('click', () => {
            prompt.custom_icon = filename;
            applyIconToPreview(anchorEl, filename);
            markUnsaved();
            closeIconPopover();
        });
        popover.appendChild(btn);
    });

    document.body.appendChild(popover);
    activeIconPopover = popover;

    // Position popover below the anchor
    const rect = anchorEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 4;
    if (left + popRect.width > window.scrollX + document.documentElement.clientWidth - 8) {
        left = window.scrollX + document.documentElement.clientWidth - popRect.width - 8;
    }
    if (left < window.scrollX + 4) left = window.scrollX + 4;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    document.addEventListener('mousedown', onDocMouseDownForPopover, true);
    document.addEventListener('keydown', onDocKeyDownForPopover, true);
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
    const btnSaveAll = document.getElementById('btnSaveAll');
    const msgDisplay = document.getElementById('msgDisplay');
    btnSaveAll.disabled = true;

    const disabledDefaults = allDisabledPrompts.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1');
    const disabledCustoms = allDisabledPrompts.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1');
    const disabledSpecials = allDisabledPrompts.filter(p => String(p.is_special) === '1');

    const defaultPromptsToSave = allPrompts.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1').concat(disabledDefaults);
    const customPromptsToSave = allPrompts.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1').concat(disabledCustoms);
    const specialPromptsToSave = allPrompts.filter(p => String(p.is_special) === '1').concat(disabledSpecials).concat(allExcludedSpecialPrompts);

    await setDefaultPromptsProperties(defaultPromptsToSave);
    await setCustomPrompts(customPromptsToSave);
    await setSpecialPrompts(specialPromptsToSave);

    await browser.runtime.sendMessage({ command: "reload_menus" });

    msgDisplay.textContent = browser.i18n.getMessage('menu_order_saved');
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = 'green';
    setTimeout(() => {
        msgDisplay.textContent = '';
        msgDisplay.style.display = 'none';
    }, 3000);
}

function markUnsaved() {
    document.getElementById('btnSaveAll').disabled = false;
    const msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = browser.i18n.getMessage('customPrompts_unsaved_changes');
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = 'red';
}
