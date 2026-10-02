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
 *  What the six feature settings pages (Add Tags, Spam Filter, Summarize, Translate, Calendar
 *  Event, Task) share: the per-feature connection kept in step with the {prefix}_* preferences,
 *  the connection panel's tint, and the special prompt text editors with their Save/Reset
 *  buttons. Each used to be copied into every page, policy guards included, and the copies had
 *  started to drift. A page now calls these with its prefix and prompt ids.
 */

import { integration_options_config, valid_connection_types } from '../../options/mzta-options-default.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';
import { isApiUsableConnection } from '../../js/mzta-utils.js';
import { saveSpecialPromptTexts } from '../../js/mzta-prompts.js';
import { getConnectionTypeLabel } from './connection-ui.js';
import {
    seedFromGlobal,
    isPolicyConnection,
    isEnforcedPref,
    isEnforcedPromptText,
    lockEnforcedPromptText,
    setDisabledRespectingManaged,
} from './managed-ui.js';

/**
 * On page open: copy the special prompt's provider override into the {prefix}_* preferences,
 * so the call sites that read only the preference pair (prompt = null: the menu gating in
 * mzta-background.js, the feature row in mzta-options.js) see the per-feature connection.
 *
 * Not for a connection supplied by the policy (_special_prompts_connection): that one is the
 * administrator's, and copying it into the preferences would store it (spec 08).
 */
export async function persistPromptConnectionToPrefs(prefix, prompt) {
    if (!prompt || !prompt.api_type || prompt.api_type === '' || isPolicyConnection(prompt)) return;
    const update_prefs = {};
    update_prefs[`${prefix}_connection_type`] = prompt.api_type;
    // getConnectionType() reads the prefixed connection type only when this flag is on, so
    // writing the pair one half at a time leaves the value inert. Only for a usable api_type:
    // chatgpt_web has no <option> in the per-prompt select and isApiUsableConnection() rejects
    // it, so the pair would read as "on" while the feature stayed hidden from the menus.
    if (isApiUsableConnection(prompt.api_type)) {
        update_prefs[`${prefix}_use_specific_integration`] = true;
    }
    const integration = prompt.api_type.replace('_api', '');
    if (integration_options_config[integration]) {
        for (const key of Object.keys(integration_options_config[integration])) {
            const propName = `${integration}_${key}`;
            if (prompt[propName] !== undefined) {
                update_prefs[`${prefix}_${propName}`] = prompt[propName];
            }
        }
    }
    // The write guard of setPrefs() refuses, key by key, anything the policy locks.
    await mztaPrefs.setPrefs(update_prefs);
}

/**
 * In restoreOptions(): put into `getting` (the getAllPrefs() result the page restores its
 * inputs from) what the connection panel must show for this feature. The special prompt is the
 * source of truth for the panel; where it has no value, the global connection is the seed.
 */
export function resolveFeatureConnectionPrefs(getting, prompt, prefix) {
    if (!prompt) return;
    const typeKey = `${prefix}_connection_type`;
    if (isEnforcedPref(typeKey)) {
        // Enforced by the policy: getting already holds the enforced value, and that is what
        // runs (getConnectionType() reads it before the prompt's api_type). Show it as it is.
    } else if (prompt.api_type && prompt.api_type !== '') {
        getting[typeKey] = prompt.api_type;
    } else {
        // Inherit the global connection only when this select can actually offer it:
        // chatgpt_web has no <option> here (it has no API), so inheriting it would show a value
        // the control cannot represent. Leave it blank instead.
        // seedFromGlobal(): never seed from a policy-supplied global value - these fields are
        // written into the special prompt, where it would outlive the policy.
        const global = seedFromGlobal(getting, 'connection_type');
        getting[typeKey] = isApiUsableConnection(global) ? global : '';
    }
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            if (prompt[propName] !== undefined && prompt[propName] !== '') {
                getting[`${prefix}_${propName}`] = prompt[propName];
            } else {
                getting[`${prefix}_${propName}`] = seedFromGlobal(getting, propName);
            }
        }
    }
}

/**
 * Tint the connection panel to match the selected connection type, set the provider pill
 * name, and hide the whole panel when "use specific integration" is off (no empty bordered
 * box). Runs now, and again on every change of the switch or the type select.
 */
export function bindConnPanelTint(prefix) {
    const update = () => {
        const conntype_select = document.getElementById(`${prefix}_connection_type`);
        const panel = document.getElementById('mzta_conn_panel');
        const use_specific = document.getElementById(`${prefix}_use_specific_integration`);
        if (!panel) return;
        panel.style.display = (use_specific && use_specific.checked) ? '' : 'none';
        if (!conntype_select) return;
        const conntype = conntype_select.value;
        for (const t of valid_connection_types) {
            panel.classList.toggle('tint_' + t, conntype === t);
        }
        const pillName = document.getElementById('mzta_conn_pill_name');
        if (pillName) {
            // Resolved from the shared catalogue, not by scraping the select:
            // populateConnectionTypeOptions() rebuilds the <option> list with replaceChildren(),
            // so a DOM lookup can transiently miss.
            pillName.textContent = getConnectionTypeLabel(conntype);
        }
    };
    for (const id of [`${prefix}_connection_type`, `${prefix}_use_specific_integration`]) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', update);
    }
    update();
}

/**
 * Wire a special prompt text editor: the textarea with its Save and Reset buttons and its
 * optional "unsaved changes" note.
 *
 *  - `specialPrompts` is the page's getSpecialPrompts() array; the prompt of promptIds[0] is the
 *    one shown, and its .text the saved baseline, updated on Save (with every other id's);
 *  - `promptIds` lists every prompt the textarea saves: the calendar page saves two;
 *  - `defaultMsgKey` is the i18n key of the shipped text, which Reset restores;
 *  - `beforeSave(text)` may return false to cancel a Save (the calendar placeholder check);
 *    `afterSave()` runs after a successful one.
 *
 * A text the policy enforces (_special_prompts_text) is shown read-only, with Save and Reset
 * disabled (lockEnforcedPromptText()), and both handlers return early on it: a control
 * re-enabled from the developer tools is not the same as the action being available. The
 * buttons' state goes through setDisabledRespectingManaged(), so no input can re-enable them.
 */
export async function bindSpecialPromptEditor({
    textarea, saveBtn, resetBtn, unsavedEl = null, specialPrompts, promptIds, defaultMsgKey,
    beforeSave = null, afterSave = null, do_debug = false,
}) {
    const prompt = specialPrompts.find(p => p.id === promptIds[0]);
    const defaultText = () => browser.i18n.getMessage(defaultMsgKey);
    const enforced = () => promptIds.some(id => isEnforcedPromptText(id));
    const showUnsaved = unsaved => { if (unsavedEl) unsavedEl.classList.toggle('hidden', !unsaved); };

    textarea.addEventListener('input', (event) => {
        setDisabledRespectingManaged(resetBtn, event.target.value === defaultText());
        const unchanged = event.target.value === prompt.text;
        setDisabledRespectingManaged(saveBtn, unchanged);
        showUnsaved(!unchanged);
    });

    resetBtn.addEventListener('click', () => {
        if (enforced()) return;
        textarea.value = defaultText();
        setDisabledRespectingManaged(resetBtn, true);
        textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    });

    saveBtn.addEventListener('click', async () => {
        if (enforced()) return;
        const text = textarea.value;
        if (beforeSave && (await beforeSave(text)) === false) return;
        const texts = {};
        for (const id of promptIds) {
            texts[id] = text;
            const p = specialPrompts.find(sp => sp.id === id);
            if (p) p.text = text;
        }
        await saveSpecialPromptTexts(texts);
        if (afterSave) afterSave();
        setDisabledRespectingManaged(saveBtn, true);
        showUnsaved(false);
        browser.runtime.sendMessage({ command: 'reload_menus' });
    });

    // A prompt never saved may still hold the raw i18n key.
    if (prompt.text === defaultMsgKey) prompt.text = defaultText();
    textarea.value = prompt.text;
    setDisabledRespectingManaged(resetBtn, textarea.value === defaultText());
    // A text enforced by the policy is shown (getSpecialPrompts() overlaid it) but not editable.
    await lockEnforcedPromptText(textarea, promptIds, [saveBtn, resetBtn], do_debug);
}
