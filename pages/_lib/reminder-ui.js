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

// "Let the AI set a reminder" section of the calendar event and task pages [#887].
// Same markup and ids on both pages; only the prefs differ (REMINDER_FEATURES).
//
// - The checkbox is a plain .option-input: the page's own saveOptions() stores it
//   on change, and restoreOptions() has already restored it when this runs.
// - The rules textarea is saved with an explicit Save button (id btn_save_*), so
//   initUnsavedGuard() covers it with no extra code. It is a plain textarea on
//   purpose: the rules are appended after placeholder resolution, so a {%...%}
//   token there would reach the AI verbatim.
// - The warning and the preview follow the LIVE prompt text (even unsaved), the
//   same text finalizePrompt_*() checks for "reminderMinutes".

import {
    REMINDER_FEATURES,
    taPromptUtils
} from '../../js/mzta-utils-prompt.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';

export async function initReminderUI({ feature, promptTextarea, statementsEl }) {
    const config = REMINDER_FEATURES[feature];
    const checkbox = document.getElementById(config.enabledPref);
    const rules_block = document.getElementById('reminder_rules_block');
    const rules_textarea = document.getElementById('reminder_rules');
    const save_btn = document.getElementById('btn_save_reminder_rules');
    const unsaved = document.getElementById('reminder_rules_unsaved');
    const warning = document.getElementById('reminder_prompt_warning');

    let saved_rules = (await mztaPrefs.getPref(config.rulesPref)) ?? '';
    rules_textarea.value = saved_rules;

    function refresh() {
        rules_block.style.display = checkbox.checked ? 'block' : 'none';
        warning.classList.toggle('shown', promptTextarea.value.includes('reminderMinutes') && !checkbox.checked);
        // Preview of exactly what finalizePrompt_*() will append, from the live values.
        const statements = taPromptUtils.getReminderPromptStatements(feature, promptTextarea.value, checkbox.checked, rules_textarea.value);
        if (statementsEl) {
            if (statements !== '') {
                statementsEl.textContent = browser.i18n.getMessage("addtags_info_additional_statements") + " \"" + statements + "\"";
                statementsEl.style.display = 'block';
            } else {
                statementsEl.textContent = '';
                statementsEl.style.display = 'none';
            }
        }
    }

    checkbox.addEventListener('change', refresh);
    promptTextarea.addEventListener('input', refresh);

    rules_textarea.addEventListener('input', () => {
        save_btn.disabled = (rules_textarea.value === saved_rules);
        unsaved.classList.toggle('hidden', save_btn.disabled);
        refresh();
    });

    save_btn.addEventListener('click', async () => {
        saved_rules = rules_textarea.value.trim();
        rules_textarea.value = saved_rules;
        await mztaPrefs.setPref(config.rulesPref, saved_rules);
        save_btn.disabled = true;
        unsaved.classList.add('hidden');
        refresh();
    });

    refresh();
}
