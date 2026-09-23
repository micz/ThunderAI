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

/*
 *  Manage Custom Prompts — design "2a": one List.js list, two views.
 *
 *  - The list (#prompts_list) is the only List.js instance. Its rows are rendered by
 *    refreshRow() from item.values(), never from List.js' templater, so a localized
 *    name, the type badge, the option chips and the placeholder chips all survive a
 *    values() write (the templater only owns data-idnum here).
 *  - #prompts_card carries view-split or view-table. The two views are the SAME rows
 *    laid out by CSS, so search, count and selection carry across a switch for free.
 *  - #detail_pane is a single static editor. Editing no longer happens inside a row:
 *    loadDetail() fills the pane from an item, commitDetail() writes it back with
 *    item.values(). Nothing is persisted until Save All, exactly as before.
 */

import {
    integration_options_config
} from "../../options/mzta-options-default.js";
import {
    getPromptsForManagement,
    setDefaultPromptsProperties,
    setCustomPrompts,
    preparePromptsForExport,
    preparePromptsForImport,
    promptBooleanFlags,
    isPromptFlagOn
} from "../../js/mzta-prompts.js";
import {
    injectConnectionUI,
    showConnectionOptions,
    updateWarnings,
    checkJsonFieldsByPrefix,
    getConnectionTypeLabel
} from "../../pages/_lib/connection-ui.js";
import {
    getLocalStorageUsedSpace,
    validateCustomData_ChatGPTWeb,
    openTab,
    setTomSelectBorder,
    revealPromptInMenuOrder
} from "../../js/mzta-utils.js";
import { taLogger } from "../../js/mzta-logger.js";
import {
    getPlaceholders,
    placeholdersUtils,
    mapPlaceholderToSuggestion
} from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";
import {
    attachEditorHighlight,
    getEditorHighlight,
    makeTokenStateResolver,
    classifyPlaceholderType,
    PLACEHOLDER_RE
} from "../../js/mzta-editor-highlight.js";
import { mztaPrefs } from '../../js/mzta-prefs.js';
import {
    getManagedState,
    isPromptManagementDisabled,
    areDefaultPromptsDisabled,
    disableForManagedRestriction
} from "../_lib/managed-ui.js";

// Id prefix of the detail editor's injected connection fields. The pane is the only
// host on the page, so injectConnectionUI() runs exactly once with this prefix.
const DETAIL_PREFIX = 'detail_prompt_';

let prefs = null;

// Managed-configuration context. The organization name labels the org prompt badge;
// shadowed_org_ids holds the ids where an org prompt is currently hiding a custom prompt
// of the user's, so the org prompt's banner can say so.
let org_name_label = '';
let shadowed_org_ids = new Set();
// Captured once from the managed state, because rendering is synchronous and cannot
// await the accessor. Set before loadPromptsList() renders the first row.
let prompt_mgmt_disabled = false;
let default_prompts_disabled = false;
var promptsList = null;
var somethingChanged = false;
var positionMax_compose = 0;
var positionMax_display = 0;
var idnumMax = 0;
var msgTimeout = null;
let taLog = null;
let autocompleteSuggestions = [];
let activePlaceholders = [];

// View and detail-editor state.
let currentView = 'split';          // 'split' | 'table', persisted in custom_prompts_view
let detailMode = 'none';            // 'none' | 'edit' | 'new'
let selectedIdnum = null;           // idnum of the item shown in 'edit' mode
let detailDirty = false;            // the pane holds edits not yet applied to the item
let detailLoading = false;          // true while the pane is being filled programmatically
let connectionUiReady = false;      // injectConnectionUI() has completed
let previousSelectionIdnum = null;  // where Cancel returns to from 'new' mode

document.addEventListener('DOMContentLoaded', async () => {

    prefs = await mztaPrefs.getAllPrefs();
    taLog = new taLogger("mzta-custom-prompts", prefs.do_debug);

    setStorageSpace();

    // getPromptsForManagement(), not getPrompts(): this page must also list a custom
    // prompt that an organization prompt is currently shadowing. It is shown disabled with
    // an explanation, and - crucially - it is still saved, because saveAll() rewrites the
    // whole _custom_prompt store from what is listed here.
    let values = await getPromptsForManagement();

    // One round trip for the managed state, through the shared helper: this page never
    // reads browser.storage.managed itself, which is known to fail on options pages in
    // Thunderbird. Awaited here so the synchronous restriction accessors below can be used.
    const managed = await getManagedState(prefs.do_debug);
    if (managed.active) org_name_label = managed.orgName || '';
    prompt_mgmt_disabled = isPromptManagementDisabled();
    default_prompts_disabled = areDefaultPromptsDisabled();
    shadowed_org_ids = new Set(
        values.filter(p => p._shadowed_by_org === true)
              .map(p => String(p.id).toLowerCase()));

    currentView = (prefs.custom_prompts_view === 'table') ? 'table' : 'split';
    applyView();

    loadPromptsList(values);
    bindListEvents();
    bindToolbar();
    bindDetailEvents();
    // Localize the static markup now; the injected connection UI is localized again
    // below, once it exists.
    i18n.updateDocument();

    // A policy may forbid prompt management. Creation, import and export are blocked here;
    // the user's existing prompts are additionally rendered read-only (rowState().locked)
    // and are filtered out of every menu by getPrompts().
    if (prompt_mgmt_disabled) {
        disableForManagedRestriction(document.getElementById('btnNew'));
        document.getElementById('import_export').style.display = 'none';
        document.getElementById('managed_restriction_note').classList.add('shown');
    }

    // An independent policy may take the built-in prompts out of the menus. They stay
    // listed here - they were already read-only - but a prompt that has silently vanished
    // from every menu needs saying so, per prompt and once for the page.
    if (default_prompts_disabled) {
        document.getElementById('managed_restriction_defaults_note').classList.add('shown');
    }

    // Kept as the raw list too: the highlight backdrop validates tokens against it on
    // every keystroke and needs the placeholder objects, not the mapped suggestions.
    activePlaceholders = await getPlaceholders(true);
    autocompleteSuggestions = activePlaceholders.map(mapPlaceholderToSuggestion);

    // The first render ran before the placeholder list was in, so it could not tell a
    // valid token from an invalid one. Repaint now so unknown placeholders turn red.
    refreshAllRows();

    const detailText = document.getElementById('detail_text');
    const detailType = document.getElementById('detail_type');
    // The type getter replaces the old closest('tr') lookup: the pane is not a row.
    textareaAutocomplete(detailText, autocompleteSuggestions, () => detailType.value);
    const highlight = attachEditorHighlight(detailText);
    if (highlight) {
        highlight.setTokenStateResolver(makeTokenStateResolver(
            placeholdersUtils.findPlaceholder,
            activePlaceholders,
            () => detailType.value));
    }

    await injectConnectionUI({
        afterTrId: 'detail_api_anchor',
        selectId: DETAIL_PREFIX + 'api_type',
        modelId_prefix: DETAIL_PREFIX,
        no_chatgpt_web: true,
        taLog: taLog,
        customButtonLabel: browser.i18n.getMessage("Reset"),
        customButtonCallback: () => {
            resetApiSettings();
        }
    });
    const apiScope = document.getElementById('detail_api_panel');
    relocateConnAdvRows(apiScope);
    const apiSelect = document.getElementById(DETAIL_PREFIX + 'api_type');
    if (apiSelect) {
        apiSelect.addEventListener('change', () => {
            showConnectionOptions(apiSelect, DETAIL_PREFIX);
            showAdvConnectionOptions(apiScope, apiSelect.value);
            updateChatGPTWebVisibility();
        });
    }
    connectionUiReady = true;

    i18n.updateDocument();

    // Open on the first visible prompt, so the detail view is never empty on arrival.
    // If the user already picked a prompt while the connection UI was loading, reload
    // that one instead: its connection fields could not be filled until now.
    if (detailMode === 'edit' && !detailDirty && currentItem()) {
        loadDetail(currentItem());
    } else if (detailMode === 'none') {
        const first = promptsList.visibleItems[0];
        if (first) loadDetail(first);
    }

}, { once: true });

document.getElementById('btnManageCustomDataPH').addEventListener('click', () => {
    openTab('/pages/customdataplaceholders/mzta-custom-dataplaceholders.html');
});

/* ===========================================================================
   Row model
   =========================================================================== */

// Every reason a prompt can be read-only here, derived from the flags
// getPromptsForManagement() marks on it.
function rowState(values) {
    const is_default = (values.is_default == 1);
    const is_org = (values.is_org == 1);
    const is_shadowed = (values._shadowed_by_org === true);
    // _disable_prompt_management: the user's own prompts become read-only, not just
    // uncreatable. Kept apart from read_only so the two reasons stay distinguishable.
    const is_inert = (values._inert_by_policy === true);
    // _disable_default_prompts: the built-ins are already read-only, so this changes no
    // control; it exists to EXPLAIN the prompt, which has vanished from every menu.
    const is_default_inert = (values._default_inert_by_policy === true);
    const read_only = is_default || is_org || is_shadowed;
    return {
        is_default, is_org, is_shadowed, is_inert, is_default_inert,
        locked: read_only || is_inert || is_default_inert,
    };
}

// Whether a flag can be toggled for a prompt in this state. On a built-in only
// need_custom_text is the user's: it is the only one of the five flags persisted in
// _default_prompts_properties (see setDefaultPromptsProperties); the other four always
// come back from the built-in definition.
function isFlagEditable(flag, st, mode) {
    if (mode === 'new' || !st.locked) return true;
    return flag === 'need_custom_text' && st.is_default;
}

function itemFromIdnum(idnum) {
    if (!promptsList || idnum === null || idnum === undefined) return null;
    const found = promptsList.get('idnum', idnum);
    return (found && found.length > 0) ? found[0] : null;
}

function itemFromRow(row) {
    return row ? itemFromIdnum(row.getAttribute('data-idnum')) : null;
}

function currentItem() {
    return (detailMode === 'edit') ? itemFromIdnum(selectedIdnum) : null;
}

// Built-in prompts store their name as a "__MSG_key__" token. Resolve it so both the
// display and the search use the label the user actually sees. Same approach as
// resolveName() in mzta-prompts.js.
function resolvePromptName(name) {
    const n = name ?? '';
    if (typeof n === 'string' && n.startsWith('__MSG_') && n.endsWith('__')) {
        return browser.i18n.getMessage(n.substring(6, n.length - 2)) || n;
    }
    return String(n);
}

// Stored prompt text encodes newlines as <br>; the editor works on raw \n.
function textForEditor(text) {
    return String(text ?? '').replace(/<br\s*\/?>/gi, "\n");
}

// One-line form for the list preview and the search.
function textForPreview(text) {
    return textForEditor(text).replace(/\s*\n\s*/g, ' ');
}

// Old versions stored a missing string override as the literal 'undefined'.
function cleanString(val) {
    return (val === undefined || val === null || val === 'undefined') ? '' : String(val);
}

function typeLabel(type) {
    switch (String(type)) {
        case "0": return browser.i18n.getMessage('customPrompts_add_to_menu_always');
        case "1": return browser.i18n.getMessage('customPrompts_add_to_menu_reading');
        case "2": return browser.i18n.getMessage('customPrompts_add_to_menu_composing');
    }
    return '';
}

function actionLabel(action) {
    switch (String(action)) {
        case "0": return browser.i18n.getMessage('customPrompts_close_button');
        case "1": return browser.i18n.getMessage('customPrompts_do_reply');
        case "2": return browser.i18n.getMessage('customPrompts_substitute_text');
    }
    return '';
}

const FLAG_LABEL_KEYS = {
    need_selected: 'customPrompts_form_label_need_selected',
    need_signature: 'customPrompts_form_label_need_signature',
    need_custom_text: 'customPrompts_form_label_need_custom_text',
    define_response_lang: 'customprompts_form_label_define_response_lang',
    use_diff_viewer: 'customPrompts_form_label_use_diff_viewer',
};

// The row template is a static skeleton on purpose: every value is written by
// refreshRow() through textContent / DOM nodes, never interpolated into markup, so a
// prompt name or id can never be parsed as HTML.
function rowTemplate() {
    return `<div class="p_row p_grid" tabindex="0">
        <div class="p_cell p_cell_prompt">
            <div class="p_line1">
                <span class="p_name_wrap"><span class="p_lock" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span><span class="p-name"></span></span>
                <span class="p-type type_badge"></span>
            </div>
            <span class="p-id mono_id"></span>
        </div>
        <div class="p_cell p_cell_text"><span class="p-text"></span></div>
        <div class="p_cell p_cell_menu"><span class="p_menu"></span><span class="p_action"></span></div>
        <div class="p_cell p_cell_chips"></div>
        <div class="p_cell p_cell_actions">
            <button type="button" class="btnRowEdit"></button>
            <button type="button" class="btnRowMenu" aria-haspopup="menu">⋯</button>
        </div>
    </div>`;
}

// Paint one row from its item. Called after the list is built, after every
// item.values() write and after add; it is the only writer of row content.
function refreshRow(item) {
    const el = item && item.elm;
    if (!el) return;
    const v = item.values();
    const st = rowState(v);

    el.classList.toggle('is_locked', st.locked);
    el.classList.toggle('is_dimmed', st.is_shadowed || st.is_inert || st.is_default_inert);
    el.classList.toggle('is_selected', detailMode === 'edit' && String(v.idnum) === String(selectedIdnum));

    const lock = el.querySelector('.p_lock');
    lock.hidden = !st.locked;
    lock.title = browser.i18n.getMessage('customPrompts_system_tooltip');

    el.querySelector('.p-name').textContent = resolvePromptName(v.name);
    el.querySelector('.p-id').textContent = cleanString(v.id);

    const badge = el.querySelector('.p-type');
    badge.classList.remove('badge_system', 'badge_personal', 'badge_org');
    if (st.is_org) {
        badge.classList.add('badge_org');
        badge.textContent = org_name_label || browser.i18n.getMessage('customPrompts_org_badge');
        badge.title = badge.textContent;
    } else if (st.is_default) {
        badge.classList.add('badge_system');
        badge.textContent = browser.i18n.getMessage('customPrompts_badge_system');
        badge.title = '';
    } else {
        badge.classList.add('badge_personal');
        badge.textContent = browser.i18n.getMessage('customPrompts_badge_personal');
        badge.title = '';
    }

    renderPreviewText(el.querySelector('.p-text'), textForPreview(v.text), v.type);

    el.querySelector('.p_menu').textContent = typeLabel(v.type);
    el.querySelector('.p_action').textContent = actionLabel(v.action);

    renderChips(el.querySelector('.p_cell_chips'), v);

    el.querySelector('.btnRowEdit').textContent = browser.i18n.getMessage(st.locked ? 'customPrompts_btnOpen' : 'customPrompts_btnEdit');
    const menuBtn = el.querySelector('.btnRowMenu');
    menuBtn.title = browser.i18n.getMessage('customPrompts_more_actions');
    menuBtn.setAttribute('aria-label', menuBtn.title);

    highlightSearchMatchesIn(el);
}

function refreshAllRows() {
    if (!promptsList) return;
    promptsList.items.forEach(refreshRow);
}

// Read-only option chips for the table view: every active flag, plus the first
// inactive one so an all-off prompt still reads as "no options" rather than blank.
function renderChips(container, values) {
    const active = promptBooleanFlags.filter(f => isPromptFlagOn(values[f]));
    const inactive = promptBooleanFlags.filter(f => !isPromptFlagOn(values[f]));
    const shown = active.concat(inactive.slice(0, 1));
    const frag = document.createDocumentFragment();
    shown.forEach(flag => {
        const on = active.includes(flag);
        const chip = document.createElement('span');
        chip.className = 'flag_chip ' + (on ? 'chip_on' : 'chip_off');
        chip.title = browser.i18n.getMessage(FLAG_LABEL_KEYS[flag]);
        chip.textContent = (on ? '● ' : '○ ') + browser.i18n.getMessage('customPrompts_chip_' + flag);
        frag.appendChild(chip);
    });
    container.replaceChildren(frag);
}

// Write the preview text, wrapping {%placeholder%} tokens in a chip. Validity uses
// PLACEHOLDER_RE and placeholdersUtils.findPlaceholder, the very pattern and predicate
// the edit-mode highlight uses, so the list and the editor can never disagree on what
// is a token or whether it resolves. Built from text nodes only: the text is user
// authored and must never be re-parsed as markup.
function renderPreviewText(span, text, type) {
    // Before activePlaceholders has loaded findPlaceholder() resolves nothing, so
    // classifying then would paint every token as invalid; refreshAllRows() repaints
    // once the list is in.
    const canValidate = Array.isArray(activePlaceholders) && activePlaceholders.length > 0;
    const promptType = (type === undefined || type === null || type === '') ? null : String(type);
    const frag = document.createDocumentFragment();
    PLACEHOLDER_RE.lastIndex = 0;
    let pos = 0;
    let m;
    while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
        if (m.index > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.index)));
        const chip = document.createElement('span');
        chip.className = 'ph_chip';
        if (canValidate) {
            // Same two tiers as edit mode: red when the id does not exist at all,
            // amber when it exists but does not fit this prompt's type.
            if (!placeholdersUtils.findPlaceholder(m[1], activePlaceholders, null)) {
                chip.classList.add('ph_chip_invalid_read', 'ph_chip_error_read');
                chip.title = browser.i18n.getMessage('editor_placeholder_missing');
            } else {
                const state = classifyPlaceholderType(
                    placeholdersUtils.findPlaceholder, activePlaceholders, m[1], promptType);
                if (state) {
                    chip.classList.add('ph_chip_invalid_read');
                    chip.title = state.title;
                }
            }
        }
        chip.textContent = m[0];
        frag.appendChild(chip);
        pos = m.index + m[0].length;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    span.replaceChildren(frag);
}

function updateSelectionMarks() {
    if (!promptsList) return;
    promptsList.items.forEach(item => {
        if (!item.elm) return;
        item.elm.classList.toggle('is_selected',
            detailMode === 'edit' && String(item.values().idnum) === String(selectedIdnum));
    });
}

/* ===========================================================================
   List
   =========================================================================== */

function loadPromptsList(values) {
    positionMax_compose = 0;
    positionMax_display = 0;
    idnumMax = 0;
    values.forEach(v => {
        positionMax_compose = Math.max(positionMax_compose, Number(v.position_compose) || 0);
        positionMax_display = Math.max(positionMax_display, Number(v.position_display) || 0);
        idnumMax = Math.max(idnumMax, Number(v.idnum) || 0);
    });

    let options = {
        // Only data-idnum is owned by List.js' templater: it is what the delegated row
        // handlers resolve an item from. Everything visible is painted by refreshRow().
        valueNames: [ { data: ['idnum'] } ],
        item: rowTemplate
    };

    promptsList = new List('prompts_card', options, values);

    refreshAllRows();
    updatePromptsCount();
    promptsList.on('updated', () => {
        updatePromptsCount();
        updateFilterIndicator();
    });

    setupPromptsSearch();
}

// Delegated, bound once on the list container: List.js re-appends row elements on every
// search, so per-row listeners would need re-wiring after every add and every import.
let listEventsBound = false;
function bindListEvents() {
    if (listEventsBound) return;
    listEventsBound = true;
    const list = document.getElementById('prompts_list');

    list.addEventListener('click', async (e) => {
        const row = e.target.closest('.p_row');
        if (!row) return;
        const item = itemFromRow(row);
        if (!item) return;

        const menuBtn = e.target.closest('.btnRowMenu');
        if (menuBtn) {
            e.preventDefault();
            toggleRowMenu(item, menuBtn);
            return;
        }
        if (e.target.closest('.btnRowEdit')) {
            e.preventDefault();
            await openInDetail(item);
            return;
        }
        if (currentView === 'split') await selectPrompt(item);
    });

    list.addEventListener('keydown', async (e) => {
        if (currentView !== 'split') return;
        const row = e.target.closest('.p_row');
        if (!row || e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            await selectPrompt(itemFromRow(row));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = (e.key === 'ArrowDown') ? row.nextElementSibling : row.previousElementSibling;
            if (next) next.focus();
        }
    });
}

// Keep the toolbar prompt count in sync with the rendered list. While the search is
// narrowing the list, report "shown of total" instead.
function updatePromptsCount() {
    const el = document.getElementById('prompts_count');
    if (!el) return;
    const total = promptsList ? promptsList.items.length : 0;
    const shown = promptsList ? promptsList.matchingItems.length : total;
    if (promptsList && promptsList.searched && shown !== total) {
        el.textContent = browser.i18n.getMessage('customPrompts_promptsCount_filtered', [String(shown), String(total)]);
    } else {
        el.textContent = browser.i18n.getMessage('customPrompts_promptsCount', [String(total)]);
    }
}

/* ===========================================================================
   Search
   =========================================================================== */

// The needle currently painted into the visible rows.
let currentSearchNeedle = '';

// Wrap every occurrence of the search needle in one row's name and id with
// <mark class="search_hit">. refreshRow() rewrites those spans from the stored values,
// so it calls this for its row; the input handler calls it for all rows. Reading the
// text back with textContent also strips the previous pass's marks, so this is
// idempotent and marks can never nest.
function highlightSearchMatchesIn(root) {
    const needle = currentSearchNeedle;
    root.querySelectorAll('.p-name, .p-id').forEach(span => {
        const plain = span.textContent;
        const hasMarks = !!span.querySelector('mark.search_hit');
        const lower = plain.toLowerCase();
        let at = needle === '' ? -1 : lower.indexOf(needle);
        if (at === -1) {
            if (hasMarks) span.textContent = plain;
            return;
        }
        // DOM nodes, never innerHTML: both the needle and the text are user supplied.
        const frag = document.createDocumentFragment();
        let pos = 0;
        while (at !== -1) {
            if (at > pos) frag.appendChild(document.createTextNode(plain.slice(pos, at)));
            const mark = document.createElement('mark');
            mark.className = 'search_hit';
            mark.textContent = plain.slice(at, at + needle.length);
            frag.appendChild(mark);
            pos = at + needle.length;
            at = lower.indexOf(needle, pos);
        }
        if (pos < plain.length) frag.appendChild(document.createTextNode(plain.slice(pos)));
        span.replaceChildren(frag);
    });
}

function highlightSearchMatches() {
    const list = document.getElementById('prompts_list');
    if (list) highlightSearchMatchesIn(list);
}

// Show/hide the toolbar badge announcing that the list is filtered.
//
// This is deliberately NOT routed through #msgDisplay: that span is owned exclusively
// by setSomethingChanged() / setNothingChanged() / setMessage(), which overwrite its
// text and toggle its display. The two states are independent and must be able to
// show at the same time.
function updateFilterIndicator() {
    const badge = document.getElementById('filter_badge');
    const label = document.getElementById('filter_badge_text');
    if (!badge || !label) return;

    const filtering = !!(promptsList && promptsList.searched && currentSearchNeedle !== '');
    if (!filtering) {
        badge.classList.add('hiddendata');
        label.textContent = '';
        return;
    }

    const total = promptsList.items.length;
    const shown = promptsList.matchingItems.length;
    label.textContent = (shown === 0)
        ? browser.i18n.getMessage('customPrompts_filter_noMatches')
        : browser.i18n.getMessage('customPrompts_filter_active', [String(shown), String(total)]);
    badge.classList.toggle('filter_badge_empty', shown === 0);
    badge.classList.remove('hiddendata');
}

// Filter the list on prompt name, id and text.
// Called from loadPromptsList(), which runs again after an import — the listener is
// therefore attached only once, while the handler reads the current promptsList
// instance through the module-level variable.
let promptsSearchBound = false;
function setupPromptsSearch() {
    const searchInput = document.getElementById('prompts_search');
    if (!searchInput) return;

    // An import replaces the List instance; the field must not keep showing a filter
    // that is no longer applied to the freshly built list.
    searchInput.value = '';
    currentSearchNeedle = '';
    updateFilterIndicator();

    if (promptsSearchBound) return;
    promptsSearchBound = true;

    const btnClearFilter = document.getElementById('btnClearFilter');
    if (btnClearFilter) {
        btnClearFilter.addEventListener('click', (e) => {
            e.preventDefault();
            clearPromptsSearch();
            searchInput.focus();
        });
    }

    // List.js lowercases and regex-escapes the search string before handing it to a
    // custom search function, so compare against the raw input value. The name is
    // resolved first: built-ins store a __MSG_ token, which is not what the user sees.
    const promptsSearch = () => {
        const needle = searchInput.value.trim().toLowerCase();
        promptsList.items.forEach(item => {
            const values = item.values();
            const name = resolvePromptName(values.name).toLowerCase();
            const id = String(values.id ?? '').toLowerCase();
            const text = textForPreview(values.text).toLowerCase();
            item.found = name.includes(needle) || id.includes(needle) || text.includes(needle);
        });
    };

    searchInput.addEventListener('input', () => {
        if (!promptsList) return;
        closeRowMenu();
        // The detail pane keeps its prompt (and any pending edits) even when the
        // search filters its row out: nothing is hidden from the user, only listed.
        const needle = searchInput.value.trim();
        currentSearchNeedle = needle.toLowerCase();
        // An empty string makes List.js reset the filter entirely.
        promptsList.search(needle, ['name', 'id', 'text'], promptsSearch);
        // search() fires 'updated' only when the visible set changes; repaint
        // unconditionally so narrowing the needle within the same result set still
        // moves the marks.
        highlightSearchMatches();
        updateFilterIndicator();
        updatePromptsCount();
    });
}

// Drop any active search filter and empty the search field.
function clearPromptsSearch() {
    const searchInput = document.getElementById('prompts_search');
    if (searchInput) searchInput.value = '';
    currentSearchNeedle = '';
    if (promptsList && promptsList.searched) promptsList.search('');
    highlightSearchMatches();
    updateFilterIndicator();
    updatePromptsCount();
}

/* ===========================================================================
   Toolbar and view switch
   =========================================================================== */

function bindToolbar() {
    document.getElementById('btnSaveAll').addEventListener('click', async (e) => {
        e.preventDefault();
        // Pending edits in the pane are part of "all": ask before saving without them.
        if (!(await confirmLeaveDetail())) return;
        saveAll();
    });

    document.getElementById('btnNew').addEventListener('click', async (e) => {
        e.preventDefault();
        if (prompt_mgmt_disabled) return;
        if (!(await confirmLeaveDetail())) return;
        startNewPrompt();
    });

    document.querySelectorAll('#view_switch button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setView(btn.dataset.view);
        });
    });

    document.getElementById('btnExportAll').addEventListener('click', async (e) => {
        e.preventDefault();
        // getPromptsForManagement(): an export is a backup of everything the user has,
        // so it must not silently omit a shadowed or policy-inert prompt of theirs.
        exportPrompts(await getPromptsForManagement(), 'thunderai-prompts');
    });

    document.getElementById('btnImport').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!(await confirmLeaveDetail())) return;
        importPrompts();
    });
}

// Switching view does not touch the list: only the card's class changes, so search,
// count and the selected prompt carry over unchanged.
function setView(view) {
    const next = (view === 'table') ? 'table' : 'split';
    closeRowMenu();
    if (next === currentView) return;
    currentView = next;
    applyView();
    mztaPrefs.setPref('custom_prompts_view', currentView);
}

function applyView() {
    const card = document.getElementById('prompts_card');
    card.classList.toggle('view-split', currentView === 'split');
    card.classList.toggle('view-table', currentView === 'table');
    document.querySelectorAll('#view_switch button').forEach(btn => {
        btn.setAttribute('aria-pressed', btn.dataset.view === currentView ? 'true' : 'false');
    });
}

/* ===========================================================================
   Row menu (table view)
   =========================================================================== */

let openMenu = null;    // { idnum, btn, popover, overlay }

function toggleRowMenu(item, btn) {
    const idnum = String(item.values().idnum);
    const wasOpen = openMenu && openMenu.idnum === idnum;
    closeRowMenu();
    if (!wasOpen) openRowMenu(item, btn);
}

function openRowMenu(item, btn) {
    const card = document.getElementById('prompts_card');
    const v = item.values();
    const st = rowState(v);

    const entries = st.locked
        ? [
            { icon: '⧉', key: 'customPrompts_btnDuplicateEdit', disabled: prompt_mgmt_disabled, run: () => duplicatePrompt(item) },
        ]
        : [
            { icon: '⧉', key: 'customPrompts_btnDuplicate', disabled: prompt_mgmt_disabled, run: () => duplicatePrompt(item) },
            { icon: '⇩', key: 'customPrompts_btnExport', disabled: prompt_mgmt_disabled, run: () => exportPrompts([item.values()], 'thunderai-prompt-' + cleanString(v.id)) },
            { divider: true },
            { icon: '✕', key: 'customPrompts_btnDelete', danger: true, run: () => deletePrompt(item) },
        ];

    // A transparent overlay catches the outside click, so no document-wide listener
    // has to decide what "outside" means.
    const overlay = document.createElement('div');
    overlay.className = 'row_menu_overlay';
    overlay.addEventListener('click', closeRowMenu);

    const popover = document.createElement('div');
    popover.className = 'row_menu';
    popover.setAttribute('role', 'menu');
    entries.forEach(entry => {
        if (entry.divider) {
            const d = document.createElement('div');
            d.className = 'row_menu_divider';
            popover.appendChild(d);
            return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'row_menu_item' + (entry.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        b.disabled = !!entry.disabled;
        const icon = document.createElement('span');
        icon.className = 'row_menu_icon';
        icon.textContent = entry.icon;
        const label = document.createElement('span');
        label.textContent = browser.i18n.getMessage(entry.key);
        b.append(icon, label);
        b.addEventListener('click', (e) => {
            e.preventDefault();
            closeRowMenu();
            entry.run();
        });
        popover.appendChild(b);
    });

    card.append(overlay, popover);

    // Positioned against the card, right-aligned to the button. The last two visible
    // rows open upwards so the scrolling list cannot clip the menu.
    const cardRect = card.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const visible = promptsList.visibleItems;
    const index = visible.indexOf(item);
    const upward = visible.length > 3 && index >= visible.length - 2;
    popover.style.right = (cardRect.right - btnRect.right) + 'px';
    if (upward) {
        popover.style.bottom = (cardRect.bottom - btnRect.top + 6) + 'px';
    } else {
        popover.style.top = (btnRect.bottom - cardRect.top + 6) + 'px';
    }

    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    openMenu = { idnum: String(v.idnum), btn, popover, overlay };
    const firstEnabled = popover.querySelector('.row_menu_item:not(:disabled)');
    if (firstEnabled) firstEnabled.focus();
}

function closeRowMenu() {
    if (!openMenu) return;
    openMenu.popover.remove();
    openMenu.overlay.remove();
    openMenu.btn.classList.remove('open');
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openMenu) {
        const btn = openMenu.btn;
        closeRowMenu();
        btn.focus();
    }
});

// The list scrolls on its own: a menu anchored to a row that scrolled away would
// float over the wrong one.
document.getElementById('prompts_list').addEventListener('scroll', closeRowMenu);
window.addEventListener('resize', closeRowMenu);

/* ===========================================================================
   Detail editor
   =========================================================================== */

function detailEl(id) {
    return document.getElementById(id);
}

function bindDetailEvents() {
    const pane = detailEl('detail_body');

    // Any user edit in the pane marks it dirty. The one exception is a flag that is
    // editable on a read-only prompt (need_custom_text on a built-in): that is applied
    // straight to the item, see handleFlagChange().
    const markDirty = (e) => {
        if (detailLoading) return;
        if (e.target.classList && e.target.classList.contains('flag_switch')) return;
        setDetailDirty(true);
    };
    pane.addEventListener('input', markDirty);
    pane.addEventListener('change', markDirty);

    pane.querySelectorAll('.flag_switch').forEach(cb => {
        cb.addEventListener('change', handleFlagChange);
    });

    detailEl('detail_text').addEventListener('input', () => checkPromptsConfigForPlaceholders());
    detailEl('detail_action').addEventListener('change', () => updateDiffViewerState());
    detailEl('detail_type').addEventListener('change', () => {
        const h = getEditorHighlight(detailEl('detail_text'));
        if (h) h.refresh();
    });

    detailEl('detail_cgw_project').addEventListener('input', validateCustomData_ChatGPTWeb);
    detailEl('detail_cgw_custom_gpt').addEventListener('input', validateCustomData_ChatGPTWeb);

    detailEl('detail_api_toggle').addEventListener('click', (e) => {
        e.preventDefault();
        setDisclosure('detail_api_toggle', 'detail_api_panel', detailEl('detail_api_panel').classList.contains('hiddendata'));
    });
    detailEl('detail_cgw_toggle').addEventListener('click', (e) => {
        e.preventDefault();
        setDisclosure('detail_cgw_toggle', 'detail_cgw_panel', detailEl('detail_cgw_panel').classList.contains('hiddendata'));
    });

    detailEl('btnDetailSave').addEventListener('click', async (e) => {
        e.preventDefault();
        await commitDetail();
    });
    detailEl('btnDetailCancel').addEventListener('click', (e) => {
        e.preventDefault();
        cancelDetail();
    });
    detailEl('btnDetailDelete').addEventListener('click', (e) => {
        e.preventDefault();
        const item = currentItem();
        if (item) deletePrompt(item);
    });
    detailEl('btnDetailDuplicate').addEventListener('click', (e) => {
        e.preventDefault();
        const item = currentItem();
        if (item) duplicatePrompt(item);
    });
    detailEl('btnDetailDuplicateEdit').addEventListener('click', (e) => {
        e.preventDefault();
        const item = currentItem();
        if (item) duplicatePrompt(item);
    });
    detailEl('btnDetailMenuPosition').addEventListener('click', (e) => {
        e.preventDefault();
        const item = currentItem();
        if (item) revealPromptInMenuOrder(String(item.values().id).toLowerCase());
    });
}

function setDisclosure(toggleId, panelId, open) {
    detailEl(panelId).classList.toggle('hiddendata', !open);
    detailEl(toggleId).setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setDetailDirty(dirty) {
    detailDirty = dirty;
    updateDetailButtons();
}

// Ask what to do with unapplied edits before the pane is repointed. Resolves true when
// it is fine to continue (applied or discarded), false when the user stays.
async function confirmLeaveDetail() {
    if (!detailDirty) return true;
    const choice = await showChoiceDialog(browser.i18n.getMessage('customPrompts_dirty_confirm'), [
        { value: 'cancel', label: browser.i18n.getMessage('customPrompts_btnCancel') },
        { value: 'discard', label: browser.i18n.getMessage('customPrompts_dirty_discard') },
        { value: 'apply', label: browser.i18n.getMessage('customPrompts_dirty_apply'), primary: true },
    ]);
    if (choice === 'apply') return await commitDetail();
    if (choice === 'discard') {
        setDetailDirty(false);
        return true;
    }
    return false;
}

async function selectPrompt(item) {
    if (!item) return;
    if (detailMode === 'edit' && String(item.values().idnum) === String(selectedIdnum)) return;
    if (!(await confirmLeaveDetail())) return;
    loadDetail(item);
}

// Table view "Edit"/"Open": show the prompt in the detail view.
async function openInDetail(item) {
    if (!(await confirmLeaveDetail())) return;
    closeRowMenu();
    loadDetail(item);
    setView('split');
    if (item.elm) item.elm.scrollIntoView({ block: 'nearest' });
}

function loadDetail(item) {
    const v = item.values();
    detailMode = 'edit';
    selectedIdnum = String(v.idnum);
    fillDetail(v, false);
    applyDetailState(rowState(v));
    setDetailDirty(false);
    updateSelectionMarks();
}

function showDetailBody() {
    detailEl('detail_empty').classList.add('hiddendata');
    detailEl('detail_body').classList.remove('hiddendata');
}

function showDetailEmpty() {
    detailMode = 'none';
    selectedIdnum = null;
    setDetailDirty(false);
    detailEl('detail_body').classList.add('hiddendata');
    detailEl('detail_empty').classList.remove('hiddendata');
    updateSelectionMarks();
}

// Fill every field of the pane from a prompt's values. `isNew` means the values seed a
// prompt that does not exist yet (a blank one or a copy): its display name is resolved,
// so a copy of a built-in gets a real name rather than a __MSG_ token.
function fillDetail(v, isNew) {
    detailLoading = true;
    try {
        showDetailBody();
        clearDetailError();

        detailEl('detail_id').value = cleanString(v.id);
        detailEl('detail_name').value = isNew ? cleanString(v.name) : resolvePromptName(v.name);
        // Type before text: token validity depends on it and setEditorValue() repaints
        // immediately, so writing the text first would paint one frame validated
        // against the previous prompt's type.
        detailEl('detail_type').value = String(v.type ?? '0');
        setEditorValue(detailEl('detail_text'), textForEditor(v.text));
        detailEl('detail_action').value = String(v.action ?? '0');

        promptBooleanFlags.forEach(flag => {
            const cb = detailEl('detail_' + flag);
            cb.checked = isPromptFlagOn(v[flag]);
            cb.classList.remove('invalid_flag');
        });

        detailEl('detail_cgw_model').value = cleanString(v.chatgpt_web_model);
        detailEl('detail_cgw_project').value = cleanString(v.chatgpt_web_project);
        detailEl('detail_cgw_custom_gpt').value = cleanString(v.chatgpt_web_custom_gpt);
        ['detail_cgw_project', 'detail_cgw_custom_gpt'].forEach(id => {
            detailEl(id).style.borderColor = '';
            const info = detailEl(id + '_info');
            if (info) info.style.color = '';
        });

        populateConnectionUI(v);

        // Reveal what the prompt carries: a collapsed panel would hide an existing
        // override. Otherwise start collapsed.
        setDisclosure('detail_api_toggle', 'detail_api_panel', hasApiOverrideValues(v));
        setDisclosure('detail_cgw_toggle', 'detail_cgw_panel',
            !!(cleanString(v.chatgpt_web_model) || cleanString(v.chatgpt_web_project) || cleanString(v.chatgpt_web_custom_gpt)));
    } finally {
        detailLoading = false;
    }
    checkPromptsConfigForPlaceholders();
}

// Apply the read-only rules and the header/button set for the prompt in the pane.
function applyDetailState(st) {
    const mode = detailMode;
    const editable = (mode === 'new') || !st.locked;
    const v = currentItem() ? currentItem().values() : null;

    // Header
    detailEl('detail_title').textContent = (mode === 'new')
        ? browser.i18n.getMessage('customPrompts_new_prompt_title')
        : resolvePromptName(v ? v.name : '');
    detailEl('detail_subid').textContent = (mode === 'new') ? '' : cleanString(v ? v.id : '');
    detailEl('detail_ro_badge').classList.toggle('hiddendata', !(mode === 'edit' && st.locked));

    // Banner: why this prompt is read-only, most specific reason first.
    const notes = [];
    let warn = false;
    if (mode === 'edit') {
        if (st.is_shadowed) { notes.push('customPrompts_shadowed_note'); warn = true; }
        if (st.is_inert) { notes.push('customPrompts_policy_inert_note'); warn = true; }
        if (st.is_org) {
            notes.push('customPrompts_org_banner');
            if (v && shadowed_org_ids.has(String(v.id).toLowerCase())) notes.push('customPrompts_org_shadowing_note');
        }
        if (st.is_default) notes.push('customPrompts_system_banner');
        if (st.is_default_inert) { notes.push('customPrompts_policy_default_inert_note'); warn = true; }
    }
    const banner = detailEl('detail_banner');
    banner.replaceChildren(...notes.map(key => {
        const p = document.createElement('div');
        p.textContent = browser.i18n.getMessage(key);
        return p;
    }));
    banner.classList.toggle('hiddendata', notes.length === 0);
    banner.classList.toggle('banner_warn', warn);

    // Fields. The textarea is readOnly rather than disabled so a locked prompt's text
    // stays selectable and copyable.
    document.querySelectorAll('#detail_body .detail_edit').forEach(el => {
        if (el.tagName === 'TEXTAREA') el.readOnly = !editable;
        else el.disabled = !editable;
    });
    detailEl('detail_text').closest('.editor-wrap').classList.toggle('is_readonly', !editable);

    // Menu position only makes sense for a prompt that exists.
    detailEl('btnDetailMenuPosition').classList.toggle('hiddendata', mode !== 'edit');

    // Connection override: editable only where the rest of the prompt is. A locked
    // prompt's override is summarized read-only instead.
    detailEl('detail_api_section').classList.toggle('hiddendata', !editable);
    const apiType = v ? cleanString(v.api_type) : '';
    const showReadonlyConn = !editable && apiType !== '';
    detailEl('detail_conn_readonly').classList.toggle('hiddendata', !showReadonlyConn);
    detailEl('detail_conn_readonly_value').textContent = showReadonlyConn ? getConnectionTypeLabel(apiType) : '';
    detailEditable = editable;
    updateChatGPTWebVisibility();

    // Flags
    promptBooleanFlags.forEach(flag => {
        const cb = detailEl('detail_' + flag);
        const row = cb.closest('.flag_row');
        const flagEditable = isFlagEditable(flag, st, mode);
        cb.disabled = !flagEditable;
        row.classList.toggle('is_fixed', !flagEditable);
    });
    detailFlagState = st;
    updateDiffViewerState();

    updateDetailButtons();
}

// Cached for the handlers that re-evaluate part of the state (action change, dirty).
let detailEditable = false;
let detailFlagState = rowState({});

function updateDetailButtons() {
    const mode = detailMode;
    const st = detailFlagState;
    const editable = detailEditable;
    const show = (id, on) => detailEl(id).classList.toggle('hiddendata', !on);

    show('btnDetailDuplicate', mode === 'edit' && !st.locked);
    show('btnDetailDuplicateEdit', mode === 'edit' && st.locked);
    show('btnDetailDelete', mode === 'edit' && !st.locked);
    show('btnDetailCancel', editable && (mode === 'new' || detailDirty));
    show('btnDetailSave', editable);

    // Copy always produces a NEW prompt, which is precisely what the management policy
    // forbids, so it is disabled on every prompt while that policy is on.
    detailEl('btnDetailDuplicate').disabled = prompt_mgmt_disabled;
    detailEl('btnDetailDuplicateEdit').disabled = prompt_mgmt_disabled;
    detailEl('btnDetailSave').disabled = !(mode === 'new' || detailDirty);
}

// The diff viewer only applies when the action is "substitute text", so otherwise it
// is off and not selectable, and the hint says why.
function updateDiffViewerState() {
    const cb = detailEl('detail_use_diff_viewer');
    const actionIsSubstitute = detailEl('detail_action').value === "2";
    const flagEditable = isFlagEditable('use_diff_viewer', detailFlagState, detailMode);
    if (!actionIsSubstitute && flagEditable) {
        cb.checked = false;
    }
    cb.disabled = !flagEditable || !actionIsSubstitute;
    detailEl('detail_diff_hint').classList.toggle('hiddendata', !(flagEditable && !actionIsSubstitute));
}

// The per-prompt ChatGPT Web overrides only ever apply when the effective connection
// is ChatGPT Web: the global connection is chatgpt_web AND this prompt sets no api_type
// override. Re-evaluated on every api_type change.
function updateChatGPTWebVisibility() {
    const apiSelect = document.getElementById(DETAIL_PREFIX + 'api_type');
    const applies = detailEditable
        && (prefs.connection_type === 'chatgpt_web')
        && !(apiSelect && apiSelect.value);
    detailEl('detail_cgw_section').classList.toggle('hiddendata', !applies);
}

// A flag toggle. On an editable prompt it is just a pending edit; on a read-only
// prompt the only toggleable flag is a built-in's need_custom_text, which is applied to
// the item straight away (there is no Save on a read-only prompt), as the old row
// checkbox did.
function handleFlagChange(e) {
    if (detailLoading) return;
    const cb = e.target;
    const flag = cb.dataset.flag;
    const item = currentItem();
    if (detailMode === 'edit' && item && rowState(item.values()).locked) {
        if (flag === 'need_custom_text') {
            item.values({ need_custom_text: cb.checked ? 1 : 0 });
            refreshRow(item);
            setSomethingChanged();
        }
    } else {
        setDetailDirty(true);
    }
    if (flag === 'need_selected' || flag === 'need_custom_text') {
        checkPromptsConfigForPlaceholders();
    }
}

function readDetailFields() {
    const values = {
        id: detailEl('detail_id').value.trim().toLowerCase(),
        name: detailEl('detail_name').value.trim(),
        text: detailEl('detail_text').value,
        type: detailEl('detail_type').value,
        action: detailEl('detail_action').value,
        chatgpt_web_model: detailEl('detail_cgw_model').value.trim(),
        chatgpt_web_project: detailEl('detail_cgw_project').value.trim(),
        chatgpt_web_custom_gpt: detailEl('detail_cgw_custom_gpt').value.trim(),
    };
    // Written as numbers, as the editor always has: normalizePromptFlags() collapses
    // them to the canonical "0"/"1" on the next read.
    promptBooleanFlags.forEach(flag => {
        values[flag] = detailEl('detail_' + flag).checked ? 1 : 0;
    });
    const apiSelect = document.getElementById(DETAIL_PREFIX + 'api_type');
    if (apiSelect) values.api_type = apiSelect.value;
    Object.assign(values, getAPIValuesFromUI(DETAIL_PREFIX));
    return values;
}

// Returns an error message key, or '' when the fields are valid. The id must be
// non-empty, contain no whitespace and be unique among the other prompts.
function validateDetail(values) {
    const self = currentItem();
    let error = '';
    const idEl = detailEl('detail_id');
    const idBad = (values.id === '') || /\s/.test(values.id)
        || promptsList.items.some(it => it !== self && String(it.values().id).toLowerCase() === values.id);
    idEl.classList.toggle('input_error', idBad);
    if (idBad) error = 'customPrompts_error_id';

    const nameBad = values.name === '';
    const textBad = values.text.trim() === '';
    detailEl('detail_name').classList.toggle('input_error', nameBad);
    detailEl('detail_text').classList.toggle('input_error', textBad);
    if (!error && (nameBad || textBad)) error = 'customPrompts_error_required';
    return error;
}

function clearDetailError() {
    detailEl('detail_error').classList.add('hiddendata');
    detailEl('detail_error').textContent = '';
    ['detail_id', 'detail_name', 'detail_text'].forEach(id => detailEl(id).classList.remove('input_error'));
}

// "Save" in the pane: apply its fields to the list item (or create it). Nothing is
// written to storage here - that is Save All's job, as with the old row OK button.
// Resolves true on success.
async function commitDetail() {
    if (detailMode === 'none') return true;
    const values = readDetailFields();
    const error = validateDetail(values);
    if (error) {
        const box = detailEl('detail_error');
        box.textContent = browser.i18n.getMessage(error);
        box.classList.remove('hiddendata');
        return false;
    }
    clearDetailError();

    if (detailMode === 'new') {
        if (prompt_mgmt_disabled) return false;
        values.text = values.text.trim();
        const newItemData = {
            ...values,
            position_compose: positionMax_compose + 1,
            position_display: positionMax_display + 1,
            is_default: 0,
            idnum: idnumMax + 1,
            // Placement is not chosen at creation: new prompts always start in the popup
            // (the primary surface: toolbar button + shortcut both open it, and it
            // respects `type`). The Menu Order page moves it afterwards.
            show_in: 'popup',
        };
        // Clear any active search first: the new row would almost never match it,
        // and would then be created out of sight.
        clearPromptsSearch();
        const item = promptsList.add(newItemData)[0];
        idnumMax++;
        positionMax_compose++;
        positionMax_display++;
        refreshRow(item);
        loadDetail(item);
        if (item.elm) item.elm.scrollIntoView({ block: 'nearest' });
    } else {
        const item = currentItem();
        if (!item) return false;
        item.values(values);
        refreshRow(item);
        // The header shows the (possibly renamed) prompt.
        applyDetailState(rowState(item.values()));
        setDetailDirty(false);
    }
    setSomethingChanged();
    updatePromptsCount();
    return true;
}

// Cancel: in 'new' mode drop the draft and go back to where the user was; in 'edit'
// mode revert the fields to the item.
function cancelDetail() {
    if (detailMode === 'new') {
        setDetailDirty(false);
        const back = itemFromIdnum(previousSelectionIdnum) || promptsList.visibleItems[0];
        if (back) loadDetail(back);
        else showDetailEmpty();
        return;
    }
    const item = currentItem();
    if (item) loadDetail(item);
}

// Put the pane in 'new' mode. `seed` pre-fills it (a copy); without it the prompt
// starts empty, with the global API defaults in the connection fields.
function startNewPrompt(seed = null) {
    if (prompt_mgmt_disabled) return;
    closeRowMenu();
    previousSelectionIdnum = (detailMode === 'edit') ? selectedIdnum : previousSelectionIdnum;
    detailMode = 'new';
    selectedIdnum = null;
    const values = seed || { id: '', name: '', text: '', type: '0', action: '0' };
    fillDetail(values, true);
    applyDetailState(rowState({}));
    // A copy is an unapplied prompt from the start; a blank one only once typed into.
    setDetailDirty(!!seed);
    updateSelectionMarks();
    if (currentView !== 'split') setView('split');
    detailEl(seed ? 'detail_id' : 'detail_name').focus();
}

async function duplicatePrompt(item) {
    // Copy is a creation path, so the policy has to stop it here as well as disable
    // the controls.
    if (prompt_mgmt_disabled) return;
    if (!(await confirmLeaveDetail())) return;
    const v = item.values();
    const copyText = browser.i18n.getMessage("copy_text");
    const seed = JSON.parse(JSON.stringify(v));
    // Flags inherited from policy state or ownership must not ride along into the copy.
    ['idnum', 'is_default', 'is_org', 'is_special', '_shadowed_by_org', '_inert_by_policy', '_default_inert_by_policy'].forEach(k => delete seed[k]);
    seed.id = cleanString(v.id) + '_' + copyText;
    seed.name = resolvePromptName(v.name) + ' (' + copyText + ')';
    startNewPrompt(seed);
}

function deletePrompt(item) {
    const v = item.values();
    // A policy-locked prompt must not even be offered for deletion.
    if (rowState(v).locked) return;
    if (!window.confirm(browser.i18n.getMessage("customPrompts_btnDelete_confirmText"))) return;

    const wasSelected = detailMode === 'edit' && String(v.idnum) === String(selectedIdnum);
    const visible = promptsList.visibleItems;
    const index = visible.indexOf(item);
    const next = visible[index + 1] || visible[index - 1] || null;

    promptsList.remove('idnum', v.idnum);
    setSomethingChanged();
    updatePromptsCount();

    if (wasSelected) {
        setDetailDirty(false);
        if (next) loadDetail(next);
        else showDetailEmpty();
    }
}

/* ---------------------------------------------------------------------------
   Connection override fields

   injectConnectionUI() marks its advanced rows with .conn_adv. The options page moves
   them into a second table behind a disclosure button; this page does the same inside
   #detail_api_panel, the single host of the connection UI.
   --------------------------------------------------------------------------- */

function relocateConnAdvRows(scopeEl) {
    if (!scopeEl) return;
    const advBody = scopeEl.querySelector('.conn_adv_table tbody');
    const btn = scopeEl.querySelector('.conn_adv_btn');
    if (!advBody || !btn) return;
    scopeEl.querySelectorAll('tr.conn_adv').forEach(tr => {
        if (!advBody.contains(tr)) advBody.appendChild(tr);
    });
    btn.hidden = (advBody.children.length === 0);
}

// Collapse the advanced panel and reset the button state.
function resetConnAdv(scopeEl) {
    if (!scopeEl) return;
    const btn = scopeEl.querySelector('.conn_adv_btn');
    const panel = scopeEl.querySelector('.conn_adv_table');
    if (!btn || !panel) return;
    btn.setAttribute('aria-expanded', 'false');
    panel.classList.add('hidden');
}

// Keep the relocated rows in sync with the selected provider: they left the main
// table, so showConnectionOptions() (which walks up from the select) no longer
// reaches them.
function showAdvConnectionOptions(scopeEl, connType) {
    if (!scopeEl) return;
    const advTable = scopeEl.querySelector('.conn_adv_table');
    if (!advTable) return;
    advTable.querySelectorAll('tr[class*="conntype_"]').forEach(tr => {
        tr.style.display = tr.classList.contains('conn_adv') && tr.classList.contains('conntype_' + connType) ? '' : 'none';
    });
    // Nothing to reveal for this provider ⇒ hide the button entirely.
    const btn = scopeEl.querySelector('.conn_adv_btn');
    if (btn) {
        const anyVisible = [...advTable.querySelectorAll('tr[class*="conntype_"]')].some(tr => tr.style.display !== 'none');
        btn.hidden = !anyVisible;
        if (!anyVisible) resetConnAdv(scopeEl);
    }
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.conn_adv_btn');
    if (!btn) return;
    e.preventDefault();
    const scopeEl = btn.parentElement;
    const panel = scopeEl && scopeEl.querySelector('.conn_adv_table');
    if (!panel) return;
    const open = panel.classList.toggle('hidden') === false;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
});

// True when the prompt carries any per-prompt API override worth showing.
function hasApiOverrideValues(itemValues) {
    if (itemValues.api_type) return true;
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const val = itemValues[`${integration}_${key}`];
            // Checkboxes round-trip as either boolean or string, and an unchecked box
            // is the default, not an override — so both falses are ignored.
            if (val === undefined || val === '' || val === false || val === 'false') continue;
            return true;
        }
    }
    return false;
}

// Reset button of the injected connection UI: clears the override in the pane. It is
// a pending edit like any other, applied by the pane's Save.
function resetApiSettings() {
    const selectEl = document.getElementById(DETAIL_PREFIX + 'api_type');
    if (selectEl) {
        selectEl.value = '';
        selectEl.dispatchEvent(new Event('change'));
    }
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const inputEl = document.getElementById(`${DETAIL_PREFIX}${integration}_${key}`);
            if (!inputEl) continue;
            if (inputEl.type === 'checkbox') {
                inputEl.checked = false;
            } else if (inputEl.tomselect) {
                inputEl.tomselect.setValue('', true);
                setTomSelectBorder(inputEl.tomselect);
            } else {
                inputEl.value = '';
            }
        }
    }
    // Clearing the fields fires no input, so a red border left from a malformed value
    // would survive the reset on a now-empty (valid) field.
    checkJsonFieldsByPrefix(DETAIL_PREFIX);
    setDetailDirty(true);
}

// Fill the injected connection fields from a prompt. An unset value falls back to the
// global preference, so an empty field shows what the prompt would actually use.
function populateConnectionUI(itemValues) {
    if (!connectionUiReady) return;
    const selectEl = document.getElementById(DETAIL_PREFIX + 'api_type');
    if (selectEl) {
        selectEl.value = itemValues.api_type || '';
        showConnectionOptions(selectEl, DETAIL_PREFIX);
    }

    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputEl = document.getElementById(`${DETAIL_PREFIX}${propName}`);
            if (!inputEl) continue;
            let val = itemValues[propName];
            if (val === undefined || (inputEl.type !== 'checkbox' && val === '')) {
                if (prefs[propName] !== undefined) val = prefs[propName];
            }
            if (inputEl.type === 'checkbox') {
                inputEl.checked = (val === true || val === 'true');
            } else if (inputEl.tomselect) {
                const restoreValue = val || '';
                const optionExists = Array.from(inputEl.options).some(opt => opt.value === restoreValue);
                if (!optionExists && restoreValue !== '') {
                    inputEl.add(new Option(restoreValue, restoreValue));
                }
                inputEl.value = restoreValue;
                inputEl.tomselect.sync();
                inputEl.tomselect.setValue(restoreValue, true);
                setTomSelectBorder(inputEl.tomselect);
            } else {
                inputEl.value = val || '';
            }
        }
    }
    const scopeEl = detailEl('detail_api_panel');
    resetConnAdv(scopeEl);
    showAdvConnectionOptions(scopeEl, selectEl ? selectEl.value : '');
    updateWarnings(DETAIL_PREFIX);
    // Values are assigned with .value / .checked, which fire no input event, so the
    // live .check-json validation never runs on restore: validate what we just wrote.
    checkJsonFieldsByPrefix(DETAIL_PREFIX);
}

// `prefix` is mandatory: every injected connection field on this page is prefixed. An
// empty prefix matches nothing, so the loop would silently return {}.
function getAPIValuesFromUI(prefix) {
    if (!prefix) {
        console.error('[ThunderAI | getAPIValuesFromUI] called without a prefix; no API values would be read.');
        return {};
    }
    let values = {};
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            const inputEl = document.getElementById(`${prefix}${propName}`);
            if (inputEl) {
                values[propName] = (inputEl.type === 'checkbox') ? inputEl.checked : inputEl.value;
            }
        }
    }
    return values;
}

/*
 *  Writes a value into a textarea programmatically and repaints its highlight mirror.
 *  A direct `.value =` fires no 'input' event, and the mirror only repaints on
 *  'input': the previous text and its chips would stay painted behind the new
 *  content. Every programmatic write to the editor textarea goes through here.
 */
function setEditorValue(textarea, value) {
    if (!textarea) return;
    textarea.value = value;
    const handle = getEditorHighlight(textarea);
    if (handle) handle.refresh();
}

// When the prompt text uses {%additional_text%} or {%selected_text%}/{%selected_html%}
// but the matching flag is off, ring the flag's switch.
async function checkPromptsConfigForPlaceholders() {
    const textarea = detailEl('detail_text');
    let curr_text = textarea.value;
    // First substitute the custom data placeholders
    curr_text = String(await placeholdersUtils.replaceCustomPlaceholders(curr_text));
    const need_custom_text_element = detailEl('detail_need_custom_text');
    const need_custom_text_missing = /{%\s*additional_text(?::.*?)?\s*%}/.test(curr_text) && !need_custom_text_element.checked;
    need_custom_text_element.classList.toggle('invalid_flag', need_custom_text_missing);

    const selected_text_element = detailEl('detail_need_selected');
    const selected_text_used = (curr_text.indexOf('{%selected_text%}') != -1) || (curr_text.indexOf('{%selected_html%}') != -1);
    selected_text_element.classList.toggle('invalid_flag', selected_text_used && !selected_text_element.checked);
}

/* ===========================================================================
   Dialogs, import / export
   =========================================================================== */

// Modal with one button per choice. Resolves the chosen value, or null when the dialog
// is dismissed with Escape. Colors come from the `dialog.export` rule.
function showChoiceDialog(message, buttons) {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'export';

        const text = document.createElement('p');
        text.className = 'dialog_text';
        text.textContent = message;
        dialog.appendChild(text);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'dialog_buttons';

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            dialog.close();
            dialog.remove();
            resolve(value);
        };

        buttons.forEach(b => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = b.label;
            if (b.primary) btn.className = 'btn_primary';
            btn.addEventListener('click', () => finish(b.value));
            btnContainer.appendChild(btn);
        });
        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            finish(null);
        });

        dialog.appendChild(btnContainer);
        document.body.appendChild(dialog);
        dialog.showModal();
    });
}

// Export the given prompts to a file. Export All passes the whole managed set, the row
// menu a single prompt; both go through preparePromptsForExport() and produce the same
// file format, so a single-prompt export re-imports like a full one.
async function exportPrompts(prompts, filenameBase) {
    // The buttons are hidden under the policy, but the action is guarded too: the
    // control being out of sight is not the same as the action being unavailable.
    if (prompt_mgmt_disabled) return;
    const include_api_settings = await showChoiceDialog(browser.i18n.getMessage("customPrompts_export_include_api_settings"), [
        { value: null, label: browser.i18n.getMessage("customPrompts_btnCancel") },
        { value: false, label: browser.i18n.getMessage("no_string") },
        { value: true, label: browser.i18n.getMessage("yes_string"), primary: true },
    ]);
    if (include_api_settings === null) return;
    const manifest = browser.runtime.getManifest();
    const outputPrompts = preparePromptsForExport(prompts, include_api_settings);
    const outputObj = { id: 'thunderai-prompts', addon_version: manifest.version, prompts: outputPrompts };
    const blob = new Blob([JSON.stringify(outputObj, null, 2)], { type: "application/json" });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const time_stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safeBase = String(filenameBase).replace(/[^a-z0-9_.-]+/gi, '_');
    messenger.downloads.download({
        url: URL.createObjectURL(blob),
        filename: `${safeBase}-${time_stamp}.json`,
        saveAs: true,
    });
}

function importPrompts() {
    // Guarded as well as hidden - see exportPrompts() above.
    if (prompt_mgmt_disabled) return;
    if (!confirm(browser.i18n.getMessage("importPrompts_confirmText") + '\n' + browser.i18n.getMessage("customPrompts_managePrompts_info_default_2") + '\n' + browser.i18n.getMessage("customPrompts_managePrompts_info_default_3"))) {
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.click();
    input.onchange = async () => {
        setMessage(browser.i18n.getMessage('customPrompts_start_import'));
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const obj = JSON.parse(reader.result);
                if (obj.id !== 'thunderai-prompts') {
                    alert(browser.i18n.getMessage("importPrompts_invalidFile"));
                    setMessage(browser.i18n.getMessage('importPrompts_invalidFile'), 'red');
                    return;
                }
                if (!Array.isArray(obj.prompts)) {
                    alert(browser.i18n.getMessage("importPrompts_invalidPrompts"));
                    setMessage(browser.i18n.getMessage('importPrompts_invalidPrompts'), 'red');
                    return;
                }
                closeRowMenu();
                promptsList.clear();
                loadPromptsList(await preparePromptsForImport(obj.prompts));
                const first = promptsList.visibleItems[0];
                if (first) loadDetail(first);
                else showDetailEmpty();
                setSomethingChanged();
                setMessage(browser.i18n.getMessage('customPrompts_import_completed'), 'orange');
            } catch (err) {
                alert(browser.i18n.getMessage("importPrompts_invalidFile") + ' ' + err);
                setMessage(browser.i18n.getMessage('importPrompts_invalidFile'), 'red');
            }
        };
        reader.readAsText(file);
    };
}

/* ===========================================================================
   Save All and status messages
   =========================================================================== */

function setSomethingChanged() {
    clearTimeout(msgTimeout);
    somethingChanged = true;
    document.getElementById('btnSaveAll').disabled = false;
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = browser.i18n.getMessage('customPrompts_unsaved_changes');
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = 'red';
}

function setNothingChanged() {
    somethingChanged = false;
    document.getElementById('btnSaveAll').disabled = true;
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = '';
    msgDisplay.style.display = 'none';
    msgDisplay.style.color = '';
}

async function saveAll() {
    setMessage(browser.i18n.getMessage('customPrompts_start_saving'));
    setNothingChanged();
    if (promptsList != null) {
        let newPrompts = promptsList.items.map(item => item.values());
        taLog.log('newPrompts: ' + JSON.stringify(newPrompts));
        setMessage(browser.i18n.getMessage('customPrompts_filtering_prompts'));
        // Organization prompts come from the enterprise policy and must never be written
        // to storage: setCustomPrompts() replaces the whole _custom_prompt array with what
        // it is given, so one left in newCustomPrompts would be copied into the user's own
        // prompts and stop being declarative. Their menu position and visibility are the
        // user's though, and are persisted through _default_prompts_properties like a
        // built-in's - hence is_org goes with the default prompts, not the custom ones.
        let newDefaultPrompts = newPrompts.filter(item => item.is_default == 1 || item.is_org == 1);
        // A custom prompt shadowed by an org prompt is still listed on this page, and must
        // still be saved: dropping it here would delete the user's prompt for real.
        let newCustomPrompts = newPrompts.filter(item => item.is_default == 0 && item.is_org != 1);
        setMessage(browser.i18n.getMessage('customPrompts_saving_default_prompts'));
        await setDefaultPromptsProperties(newDefaultPrompts);
        setMessage(browser.i18n.getMessage('customPrompts_saving_custom_prompts'));
        await setCustomPrompts(newCustomPrompts);
        setMessage(browser.i18n.getMessage('customPrompts_reloading_menus'));
        await browser.runtime.sendMessage({command: "reload_menus"});
        setMessage(browser.i18n.getMessage('customPrompts_saved'), 'green');
        msgTimeout = setTimeout(() => {
            clearMessage();
        }, 10000);
    }
    setStorageSpace();
}

function setMessage(msg, color = '') {
    clearTimeout(msgTimeout);
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = msg;
    msgDisplay.style.display = 'inline';
    msgDisplay.style.color = color;
}

function clearMessage() {
    let msgDisplay = document.getElementById('msgDisplay');
    msgDisplay.textContent = '';
    msgDisplay.style.display = 'none';
    msgDisplay.style.color = '';
}

async function setStorageSpace() {
    let storage_space = await getLocalStorageUsedSpace();
    document.getElementById('storage_space').textContent = storage_space;
}

// Unapplied edits in the pane count as unsaved too: they would be lost with the tab.
window.addEventListener('beforeunload', function (event) {
    if (somethingChanged || detailDirty) {
        event.preventDefault();
    }
});
