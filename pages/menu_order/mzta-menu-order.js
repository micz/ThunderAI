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
    getHiddenSpecialPromptIds,
    getFactoryShowIn
} from '../../js/mzta-prompts.js';
import {
    i18nConditionalGet,
    getBuiltInPromptIcon
} from '../../js/mzta-utils.js';
import {
    customMenuIcons,
    customMenuIconsPath
} from './mzta-custom-menu-icons.js';

let allPrompts = [];
let allExcludedSpecialPrompts = []; // special prompts excluded from UI (hidden + inactive features), preserved on save
let currentPopupView = 'display'; // 'display' or 'compose'
let highlightTargetId = null; // id of a prompt to visually highlight, null when none
// The highlight (blue outline) persists until another highlightPrompt() call
// targets a different prompt or a drag interaction starts — it does not time out.
// Debounce shared between the storage.onChanged reloader and the highlight message
// handler, so the latter can cancel a pending reload before doing its own.
let reloadDebounce = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadAndRender();
    initSubTabs();

    document.getElementById('btnSaveAll').addEventListener('click', saveAll);
    document.getElementById('btnResetAll').addEventListener('click', resetAll);

    // If prompts are modified elsewhere (e.g. custom prompts page saving), reload this page's data.
    // Any unsaved changes on this page are discarded to avoid overwriting the other page's changes.
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

    // A "Menu position" deep-link (from the Custom Prompts editor) can ask this
    // page to highlight a prompt. When the tab was already open, the message
    // arrives here; sequence the reload before the highlight so a just-saved
    // prompt is present in the DOM, and cancel any pending debounced reload so
    // it does not wipe the highlight afterwards.
    browser.runtime.onMessage.addListener((message) => {
        if (message && message.command === 'menu_order_highlight') {
            clearTimeout(reloadDebounce);
            (async () => {
                await loadAndRender();
                highlightPrompt(message.promptId);
            })();
        }
        return false; // fire-and-forget: do not keep the message channel open
    });

    // When the tab was just created by the deep-link, the target id was stashed
    // in session storage before load. Pick it up (and clear it) now.
    const stash = await browser.storage.session.get({ menu_order_highlight_target: null });
    if (stash.menu_order_highlight_target) {
        await browser.storage.session.remove('menu_order_highlight_target');
        highlightPrompt(stash.menu_order_highlight_target);
    }

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
            setPopupView(btn.dataset.view);
            renderPopupList();
        });
    });
}

// Switch the popup panel to a sub-tab view, syncing the button state. Does not
// render: callers decide when to re-render (the click handler renders the popup
// list only, the deep-link path renders both panels).
function setPopupView(view) {
    currentPopupView = view;
    document.querySelectorAll('.sub_tab').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });
}

// Whether a prompt shows up at all in a given popup sub-tab view. Single source
// of truth for the type filtering used by both renderPopupList() and the
// deep-link sub-tab logic: reading view shows type 0+1, composing view 0+2.
function promptInPopupView(prompt, view) {
    const allowedTypes = view === 'display' ? ['0', '1'] : ['0', '2'];
    return allowedTypes.includes(String(prompt.type));
}

// ==================== Highlight (Menu position deep-link) ====================

// Apply the current highlight target to every matching rendered item, in both
// panels. Called at the tail of each render so the highlight survives re-renders
// and sub-tab switches (only one popup sub-tab is in the DOM at a time, so
// "highlight all instances" is achieved by re-applying on every render).
function applyHighlight() {
    document.querySelectorAll('.sortable_item.mzta_highlight').forEach(el => {
        el.classList.remove('mzta_highlight');
    });
    applyTabDots();
    if (!highlightTargetId) return;
    const matches = document.querySelectorAll(`.sortable_item[data-id="${CSS.escape(highlightTargetId)}"]`);
    matches.forEach(el => el.classList.add('mzta_highlight'));
    if (matches.length > 0) {
        matches[0].scrollIntoView({ block: 'nearest' });
    }
}

// Mark the inactive popup sub-tab with a dot when the highlighted prompt also
// appears in that view (always the case for type 0 "always" prompts). Driven by
// applyHighlight(), so the dot has exactly the same lifetime as the highlight.
function applyTabDots() {
    const target = highlightTargetId
        ? allPrompts.find(p => p.id === highlightTargetId)
        : undefined;
    document.querySelectorAll('.sub_tab').forEach(btn => {
        const show = target !== undefined &&
            btn.dataset.view !== currentPopupView &&
            promptInPopupView(target, btn.dataset.view);
        btn.classList.toggle('mzta_has_target', show);
        if (show) {
            btn.title = browser.i18n.getMessage('menu_order_tab_dot_tooltip');
        } else {
            btn.removeAttribute('title');
        }
    });
}

// Clear the highlight and remove the class from the DOM.
function clearHighlight() {
    highlightTargetId = null;
    document.querySelectorAll('.sortable_item.mzta_highlight').forEach(el => {
        el.classList.remove('mzta_highlight');
    });
    applyTabDots();
}

// Set a prompt as the highlight target and re-render both panels so it is
// applied. The highlight persists (applyHighlight re-adds it on every render)
// until clearHighlight() is called (next highlight target or drag start).
// When the target is not present in the current popup sub-tab but exists in the
// other one (a composing-only prompt while Reading is active, or vice versa),
// switch to that sub-tab first — otherwise the deep-link would produce no
// visible feedback at all, as the row is not in the DOM.
function highlightPrompt(promptId) {
    highlightTargetId = promptId;
    const target = allPrompts.find(p => p.id === promptId);
    if (target && !promptInPopupView(target, currentPopupView)) {
        const otherView = currentPopupView === 'display' ? 'compose' : 'display';
        if (promptInPopupView(target, otherView)) {
            setPopupView(otherView);
        }
    }
    renderPopupList();
    renderContextList();
}

// ==================== Render Popup List ====================

function renderPopupList() {
    const posKey = currentPopupView === 'display' ? 'position_display' : 'position_compose';
    // Filter by type: reading view shows type 0+1, composing view shows type 0+2
    const typeFiltered = allPrompts.filter(p => promptInPopupView(p, currentPopupView));

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

    initPanelDragAndDrop('popup', activeList, hiddenList, posKey);

    // Re-apply any active highlight after every render (this is how all instances
    // of the target stay highlighted across sub-tab switches and re-renders).
    applyHighlight();
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

    initPanelDragAndDrop('context', activeList, hiddenList, 'position_context');

    // Re-apply any active highlight after every render (see renderPopupList).
    applyHighlight();
}

// ==================== Render List Items ====================

function renderListItems(listEl, items, menuType, isActive) {
    listEl.innerHTML = '';
    items.forEach(prompt => {
        const li = document.createElement('li');
        li.classList.add('sortable_item');
        li.dataset.id = prompt.id;
        li.dataset.menu = menuType;
        li.dataset.active = isActive ? '1' : '0';
        li.draggable = true;

        // Drag handle
        const handle = document.createElement('span');
        handle.classList.add('drag_handle');
        handle.textContent = '\u2630';
        li.appendChild(handle);

        // Icon slot - between handle and name, to keep rows aligned.
        // Present in every list of both panels: this page is the only place icons are
        // chosen (the popup menu itself only displays them). Every prompt gets a picker,
        // special ones included: their hard-coded icon is just the default to restore.
        li.appendChild(buildIconPicker(prompt));

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

// filename is the user-chosen custom icon ('' when none). promptId is optional and
// only used to fall back to the prompt's built-in icon when nothing is chosen.
function applyIconToPreview(preview, filename, promptId) {
    const builtIn = promptId ? getBuiltInPromptIcon(promptId) : '';
    if (filename) {
        preview.src = '../../' + customMenuIconsPath + filename;
        preview.classList.remove('item_icon_preview_empty');
    } else if (builtIn) {
        preview.src = '../../' + builtIn.replace(/^moz-extension:/, '');
        preview.classList.remove('item_icon_preview_empty');
    } else {
        preview.src = '../../' + customMenuIconsPath + 'empty_icon.png';
        preview.classList.add('item_icon_preview_empty');
    }
}

function buildIconPicker(prompt) {
    const preview = document.createElement('img');
    preview.classList.add('item_icon_preview', 'item_icon_preview_editable');
    preview.alt = '';
    // Images are natively draggable: without this, starting a drag on the icon drags
    // the image instead of the row it belongs to.
    preview.draggable = false;
    preview.title = browser.i18n.getMessage('menu_order_icon_label');
    applyIconToPreview(preview, prompt.custom_icon || '', prompt.id);

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

    // "None" option: for a prompt that ships a built-in icon, clearing the custom icon
    // reverts to that icon rather than to nothing, so the cell previews the built-in one.
    const builtInIcon = getBuiltInPromptIcon(prompt.id);
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.classList.add('icon_picker_cell', 'icon_picker_cell_none');
    noneBtn.title = browser.i18n.getMessage(builtInIcon ? 'menu_order_icon_default' : 'menu_order_icon_none');
    const noneImg = document.createElement('img');
    if (builtInIcon) {
        noneImg.src = '../../' + builtInIcon.replace(/^moz-extension:/, '');
    } else {
        noneImg.src = '../../' + customMenuIconsPath + 'empty_icon.png';
        noneImg.classList.add('icon_picker_none_empty');   // dark-mode inversion target
    }
    noneImg.alt = '';
    noneBtn.appendChild(noneImg);
    if (!prompt.custom_icon) noneBtn.classList.add('selected');
    noneBtn.addEventListener('click', () => {
        prompt.custom_icon = '';
        applyIconToPreview(anchorEl, '', prompt.id);
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

// Pure transition table: given the current show_in value, which menu is being
// toggled, and whether it is turned on, return the new show_in value.
function computeShowIn(current, menuType, isOn) {
    current = current || 'popup';
    if (menuType === 'popup') {
        if (isOn) {
            return (current === 'none') ? 'popup' : (current === 'context') ? 'both' : current;
        }
        return (current === 'popup') ? 'none' : (current === 'both') ? 'context' : current;
    }
    // context
    if (isOn) {
        return (current === 'none') ? 'context' : (current === 'popup') ? 'both' : current;
    }
    return (current === 'context') ? 'none' : (current === 'both') ? 'popup' : current;
}

// Apply a show_in change (used by the drag path). show_in is the single source
// of truth for reachability: show_in='none' means the prompt is in no menu.
function setPromptShowIn(prompt, newShowIn) {
    prompt.show_in = newShowIn;
}

// ==================== Drag and Drop ====================

// A drag can start in the active list and end in the hidden list (or vice
// versa) of the same menu panel. Both lists share the same drag state so an
// item can cross between them: dropping into the active list makes the prompt
// visible in that menu, dropping into the hidden list removes it from that menu
// (and disables the prompt if it becomes hidden everywhere).
function initPanelDragAndDrop(menuType, activeList, hiddenList, positionKey) {
    const state = { draggedItem: null, afterElement: null };
    wireDragList(activeList, true, menuType, positionKey, state);
    wireDragList(hiddenList, false, menuType, positionKey, state);
}

// Remove any insertion indicators (top line / bottom-of-list line) from a list.
function clearDropIndicators(listEl) {
    listEl.querySelectorAll('.drag-over, .drag-over-end').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-end');
    });
}

function wireDragList(listEl, isActiveList, menuType, positionKey, state) {
    listEl.addEventListener('dragstart', (e) => {
        const li = e.target.closest('.sortable_item');
        if (!li) return;
        clearHighlight(); // any transient highlight ends on the next drag interaction
        state.draggedItem = li;
        state.afterElement = null;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.id);
    });

    // The dragged node is NOT moved during dragover: doing so on every mouse tick
    // reorders the DOM live and feels sluggish. Instead we only show an insertion
    // indicator and remember the target; the actual move happens on drop.
    listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!state.draggedItem) return;

        // Remove previous indicators across this list before drawing the new one.
        clearDropIndicators(listEl);

        const afterElement = getDragAfterElement(listEl, e.clientY);
        state.afterElement = afterElement || null;
        if (afterElement) {
            // Insert before this element: line on its top edge.
            afterElement.classList.add('drag-over');
        } else {
            // Insert at the end: line on the bottom edge of the last item (there is
            // no following element to draw a top border on).
            const items = listEl.querySelectorAll('.sortable_item:not(.dragging)');
            const last = items[items.length - 1];
            if (last) last.classList.add('drag-over-end');
        }
    });

    listEl.addEventListener('dragleave', (e) => {
        if (e.target.classList) {
            e.target.classList.remove('drag-over', 'drag-over-end');
        }
    });

    listEl.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!state.draggedItem) return;
        // Perform the real DOM move only now, once, at the drop position.
        if (state.afterElement) {
            listEl.insertBefore(state.draggedItem, state.afterElement);
        } else {
            listEl.appendChild(state.draggedItem);
        }
        clearDropIndicators(listEl);
    });

    listEl.addEventListener('dragend', () => {
        const li = state.draggedItem;
        // Clear any indicator left behind if the drop happened outside a list.
        clearDropIndicators(listEl);
        state.afterElement = null;
        if (!li) return;
        li.classList.remove('dragging');
        state.draggedItem = null;

        // The list the item now physically lives in determines its new state.
        const droppedInActive = li.parentElement === document.getElementById(
            menuType === 'popup' ? 'popup_list' : 'context_list');
        const wasActive = li.dataset.active === '1';

        if (droppedInActive === wasActive) {
            // Stayed within the same list: pure reorder. Positions are only
            // meaningful for the active list.
            if (droppedInActive) {
                updatePositionsFromDOM(li.parentElement, positionKey);
            }
            markUnsaved();
            return;
        }

        // Crossed between active and hidden: toggle this menu's visibility.
        const prompt = allPrompts.find(p => p.id === li.dataset.id);
        if (prompt) {
            const newShowIn = computeShowIn(prompt.show_in, menuType, droppedInActive);
            setPromptShowIn(prompt, newShowIn);
        }
        // If it landed in the active list, capture the drop position so the item
        // keeps where the user dropped it (positions drive active-list order).
        if (droppedInActive) {
            updatePositionsFromDOM(li.parentElement, positionKey);
        }
        markUnsaved();
        // Re-render so badges/positions and the item's section settle.
        renderPopupList();
        renderContextList();
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

// ==================== Reset ====================

// Restore the factory state of everything this page can customize: positions,
// visibility (show_in) and icons, for default, special and custom prompts alike.
// The factory order is the same one a fresh install gets — special prompts first
// in alphabetical order, then all the others alphabetically — as computed by
// migrateMenuOrderAlphabetic() in mzta-prompts.js.
// This only touches the in-memory state and marks the page unsaved, exactly like
// a drag or an icon pick: nothing is written until Save All, so reloading the
// page discards the reset and no confirmation prompt is needed.
function resetAll() {
    const specials = allPrompts.filter(p => String(p.is_special) === '1')
        .sort((a, b) => a._displayName.localeCompare(b._displayName));
    const others = allPrompts.filter(p => String(p.is_special) !== '1')
        .sort((a, b) => a._displayName.localeCompare(b._displayName));

    specials.concat(others).forEach((prompt, idx) => {
        const pos = idx + 1;
        prompt.position_display = pos;
        prompt.position_compose = pos;
        prompt.position_context = pos;
        prompt.show_in = getFactoryShowIn(prompt.id);
        prompt.custom_icon = '';    // empty means "use the built-in icon", see getBuiltInPromptIcon()
    });

    // allExcludedSpecialPrompts is intentionally left alone: those rows are not
    // shown here and saveAll() re-appends them verbatim.

    closeIconPopover();     // a picker may be open on a row about to be re-rendered
    clearHighlight();
    renderPopupList();
    renderContextList();
    markUnsaved();
}

// ==================== Save ====================

async function saveAll() {
    const btnSaveAll = document.getElementById('btnSaveAll');
    const msgDisplay = document.getElementById('msgDisplay');
    btnSaveAll.disabled = true;

    const defaultPromptsToSave = allPrompts.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1');
    const customPromptsToSave = allPrompts.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1');
    const specialPromptsToSave = allPrompts.filter(p => String(p.is_special) === '1').concat(allExcludedSpecialPrompts);

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
