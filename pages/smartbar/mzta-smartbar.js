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

/*
 *  The SmartBar page (claude-spec/10-smartbar.md "Feature page"): three tabs, Options (this
 *  file), Actions (id "prompts": mzta-smartbar-prompts.js for the texts) and Activity
 *  (mzta-smartbar-activity.js). The hash of the URL names the tab shown: the background opens
 *  the page once and selects a tab by changing it (smartbar_open_page), the chat's Details link
 *  asks for #activity.
 *
 *  The Actions tab has one sub-tab per action (router, execute, chat), not in the hash: the first
 *  one is shown at load. Both tablists follow the ARIA tabs pattern: only the selected tab is in
 *  the tab order, the arrows, Home and End move between the tabs of a list (bindTabKeys()). Three connection panels, one per special prompt of the feature, each in
 *  a card of its own, first in its sub-tab, before the prompt; execute's sub-tab also holds the
 *  writing settings, between the two. initializeSpecificIntegrationUI() and bindConnPanelTint() get the section as
 *  their root, and every lookup of a panel stays inside it.
 *
 *  Every .option-input is saved on change, as on the other feature pages.
 */

import { prefs_default } from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import { getSpecialPrompts } from '../../js/mzta-prompts.js';
import {
    isAPIKeyValue,
    setTomSelectBorder,
    getMiczItUrl,
    openTab
} from '../../js/mzta-utils.js';
import {
    initializeSpecificIntegrationUI,
    isClosedCatalogueSelect
} from '../_lib/connection-ui.js';
import { initUnsavedGuard } from '../_lib/unsaved-guard.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';
import { applyManagedUI } from '../_lib/managed-ui.js';
import {
    persistPromptConnectionToPrefs,
    resolveFeatureConnectionPrefs,
    bindConnPanelTint
} from '../_lib/feature-page.js';
import { initPromptsTab } from './mzta-smartbar-prompts.js';
import {
    initActivityTab,
    activityShown
} from './mzta-smartbar-activity.js';

const taLog = new taLogger('mzta-smartbar-page', true);

/** The three panels: feature prefix, special prompt, section (its own card, first in its sub-tab of the Actions tab). */
export const SMARTBAR_PANELS = [
    { prefix: 'smartbar_router', promptId: 'prompt_smartbar_router', section: 'smartbar_conn_router_section' },
    { prefix: 'smartbar_execute', promptId: 'prompt_smartbar_execute', section: 'smartbar_conn_execute_section' },
    { prefix: 'smartbar_chat', promptId: 'prompt_smartbar_chat', section: 'smartbar_conn_chat_section' },
];

// The number preferences of the page, and the smallest value each accepts.
const NUMBER_MIN = {
    smartbar_history_size: 0,
    smartbar_parallel_limit: 1,
    smartbar_retention_days: 0,
    smartbar_retention_max_records: 0,
    smartbar_retention_error_days: 0,
    smartbar_max_body_length: 0,
};

document.addEventListener('DOMContentLoaded', async () => {
    initUnsavedGuard();
    bindTabs();
    bindSubtabs();

    const specialPrompts = await getSpecialPrompts();
    for (const panel of SMARTBAR_PANELS) {
        await persistPromptConnectionToPrefs(panel.prefix, specialPrompts.find(p => p.id === panel.promptId));
    }

    // The page's own fields first, then each panel with its own fields.
    await restoreOptions(document.getElementById('smartbar_settings'));
    await restoreOptions(document.getElementById('smartbar_execute_settings'));
    await restoreOptions(document.getElementById('smartbar_retention'));
    for (const panel of SMARTBAR_PANELS) {
        const root = document.getElementById(panel.section);
        await initializeSpecificIntegrationUI({
            prefix: panel.prefix,
            promptId: panel.promptId,
            taLog: taLog,
            root: root,
            anchorId: panel.prefix + '_connection_ui_anchor',
            restoreOptionsCallback: () => restoreOptions(root),
        });
    }

    i18n.updateDocument();

    // After every panel is built: their provider rows are covered too.
    await applyManagedUI(document, taLog.do_debug);

    // The prompt editors of the Actions tab: after applyManagedUI(), like the editors of the other feature pages
    // (bindSpecialPromptEditor() locks a text the policy enforces itself).
    await initPromptsTab(await getSpecialPrompts(), taLog.do_debug);

    document.querySelectorAll('.option-input').forEach(element => {
        element.addEventListener('change', saveOptions);
    });

    for (const panel of SMARTBAR_PANELS) {
        bindConnPanelTint(panel.prefix, document.getElementById(panel.section));
    }

    document.getElementById('smartbar_shortcut_help').href = getMiczItUrl('thunderbird-addon-keyboard-shortcut/');
    showShortcut();

    await initActivityTab({
        isShown: () => currentTab === 'activity',
        openStorage: () => openTab('/pages/storage/mzta-storage-manager.html'),
    });
});

// ── Tabs ─────────────────────────────────────────────────────────────────────────────────────
// selectTab() shows the panel of a tab button of the strip, by its data-tab. The hash follows
// the tab shown (replaceState: no history entry), so a request for another tab (a new hash from
// the background) is always a change the page sees (hashchange).
let currentTab = 'options';

function tabNames() {
    return [...document.querySelectorAll('#smartbar_tabs [role="tab"]')].map(b => b.dataset.tab);
}

function selectTab(name) {
    currentTab = name;
    document.querySelectorAll('#smartbar_tabs [role="tab"]').forEach(btn => {
        const on = btn.dataset.tab === name;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
    });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    activityShown();
}

function tabFromHash() {
    const wanted = (location.hash || '').slice(1);
    return tabNames().includes(wanted) ? wanted : 'options';
}

function bindTabs() {
    document.querySelectorAll('#smartbar_tabs [role="tab"]').forEach(btn => {
        btn.addEventListener('click', () => selectTab(btn.dataset.tab));
    });
    bindTabKeys(document.getElementById('smartbar_tabs'), btn => selectTab(btn.dataset.tab));
    window.addEventListener('hashchange', () => selectTab(tabFromHash()));
    selectTab(tabFromHash());
}

// ── The sub-tabs of the Actions tab ──────────────────────────────────────────────────────────
// One per action; the panel of the button clicked is shown, the others hidden.
function selectSubtab(name) {
    document.querySelectorAll('#smartbar_subtabs [role="tab"]').forEach(btn => {
        const on = btn.dataset.subtab === name;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
    });
}

function bindSubtabs() {
    const buttons = [...document.querySelectorAll('#smartbar_subtabs [role="tab"]')];
    buttons.forEach(btn => btn.addEventListener('click', () => selectSubtab(btn.dataset.subtab)));
    bindTabKeys(document.getElementById('smartbar_subtabs'), btn => selectSubtab(btn.dataset.subtab));
    if (buttons.length > 0) selectSubtab(buttons[0].dataset.subtab);
}

// ── Keyboard navigation of a tablist ─────────────────────────────────────────────────────────
// The ARIA tabs pattern with automatic activation: Left/Right move to the previous/next tab
// (wrapping), Home/End to the first/last, and the tab reached is selected and focused. Enter and
// Space select the focused tab (a button already turns them into a click; kept explicit so the
// behaviour does not depend on the element).
function bindTabKeys(list, select) {
    if (!list) return;
    list.addEventListener('keydown', (e) => {
        const tabs = [...list.querySelectorAll('[role="tab"]')];
        const current = tabs.indexOf(e.target.closest('[role="tab"]'));
        if (current < 0) return;
        let next;
        switch (e.key) {
            case 'ArrowRight': next = (current + 1) % tabs.length; break;
            case 'ArrowLeft': next = (current - 1 + tabs.length) % tabs.length; break;
            case 'Home': next = 0; break;
            case 'End': next = tabs.length - 1; break;
            case 'Enter':
            case ' ':
                next = current;
                break;
            default:
                return;
        }
        e.preventDefault();
        select(tabs[next]);
        tabs[next].focus();
    });
}

// ── The keyboard shortcut of the bar ─────────────────────────────────────────────────────────
async function showShortcut() {
    const box = document.getElementById('smartbar_shortcut_keys');
    if (!box) return;
    let shortcut = '';
    try {
        const command = (await browser.commands.getAll()).find(c => c.name === '_thunderai__smartbar');
        shortcut = command?.shortcut || '';
    } catch (e) {
        taLog.log('Could not read the keyboard shortcuts: ' + e);
    }
    box.replaceChildren();
    if (shortcut === '') {
        box.textContent = browser.i18n.getMessage('smartbar_shortcut_none');
        return;
    }
    for (const key of shortcut.split('+')) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        box.appendChild(kbd);
    }
}

// ── Saving and restoring ─────────────────────────────────────────────────────────────────────
function saveOptions(e) {
    e.preventDefault();
    const element = e.target;
    let value;
    switch (element.type) {
        case 'checkbox':
            value = element.checked;
            break;
        case 'number': {
            // An emptied field (NaN) is never stored: it would be read back as null.
            const n = element.valueAsNumber;
            const min = NUMBER_MIN[element.id] ?? 0;
            if (!Number.isFinite(n)) {
                value = prefs_default[element.id] ?? min;
                element.value = value;
            } else {
                value = Math.max(min, Math.round(n));
                if (value !== n) element.value = value;
            }
            break;
        }
        case 'text':
        case 'password':
            value = element.value.trim();
            break;
        case 'textarea':
            // Free text, kept as typed (not a list).
            value = element.value;
            break;
        case 'select-one':
            value = element.value;
            break;
        default:
            console.error('[ThunderAI] Unhandled input type:', element.type);
            return;
    }
    mztaPrefs.setPref(element.id, value);
}

/** Restore the .option-input fields of `scope` (a section of the page). */
async function restoreOptions(scope) {
    const getting = await mztaPrefs.getAllPrefs();
    const specialPrompts = await getSpecialPrompts();
    for (const panel of SMARTBAR_PANELS) {
        resolveFeatureConnectionPrefs(getting, specialPrompts.find(p => p.id === panel.promptId), panel.prefix);
    }
    scope.querySelectorAll('.option-input').forEach(element => {
        if (!element.id) return;
        taLog.log('Options restoring ' + element.id + ' = ' + (isAPIKeyValue(element.id) ? '****************' : getting[element.id]));
        switch (element.type) {
            case 'checkbox':
                element.checked = getting[element.id] || false;
                break;
            case 'number':
                element.value = getting[element.id] ?? prefs_default[element.id] ?? 0;
                break;
            case 'text':
            case 'textarea':
            case 'password':
                element.value = getting[element.id] ?? '';
                break;
            default:
                if (element.tagName === 'SELECT') {
                    const restoreValue = getting[element.id] ?? prefs_default[element.id] ?? '';
                    const optionExists = Array.from(element.options).some(opt => opt.value === String(restoreValue));
                    // Never synthesize an option for a connection select: its catalogue is closed.
                    const canSynthesize = !isClosedCatalogueSelect(element.id);
                    if (element.tomselect) {
                        if (!optionExists && restoreValue !== '' && canSynthesize) {
                            element.tomselect.addOption({ value: String(restoreValue), text: String(restoreValue) });
                        }
                        element.tomselect.setValue(String(restoreValue), true);
                        setTomSelectBorder(element.tomselect);
                    } else {
                        if (!optionExists && restoreValue !== '' && canSynthesize) {
                            element.add(new Option(restoreValue, restoreValue));
                        }
                        element.value = restoreValue;
                        if (element.value === '') element.selectedIndex = canSynthesize ? 0 : -1;
                    }
                } else {
                    console.error('[ThunderAI] Unhandled input type:', element.type);
                }
        }
    });
}
