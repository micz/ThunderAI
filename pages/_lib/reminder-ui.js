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
//   same text finalizePrompt_*() checks for "reminderMinutes". The checkbox is the
//   single switch: with it off, a reminderMinutes returned by the AI is discarded,
//   so the warning tells the user that the main prompt's reminder instructions are
//   ignored until the option is checked.
// - A failure loading the saved rules is logged and does not stop the setup: the
//   listeners and the first refresh() always run, so the block never stays hidden.

import {
    REMINDER_FEATURES,
    taPromptUtils
} from '../../js/mzta-utils-prompt.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';
import { taLogger } from '../../js/mzta-logger.js';

const taLog = new taLogger("mzta-reminder-ui", true);

export async function initReminderUI({ feature, promptTextarea, statementsEl }) {
    const config = REMINDER_FEATURES[feature];
    const checkbox = config ? document.getElementById(config.enabledPref) : null;
    const rules_block = document.getElementById('reminder_rules_block');
    const rules_textarea = document.getElementById('reminder_rules');
    const save_btn = document.getElementById('btn_save_reminder_rules');
    const unsaved = document.getElementById('reminder_rules_unsaved');
    const warning = document.getElementById('reminder_prompt_warning');

    if (!checkbox || !rules_block || !rules_textarea || !save_btn || !unsaved || !warning || !promptTextarea) {
        taLog.error("initReminderUI(" + feature + "): missing config or page element, reminder UI not initialized.");
        return;
    }

    let saved_rules = '';
    try {
        saved_rules = (await mztaPrefs.getPref(config.rulesPref)) ?? '';
    } catch (e) {
        taLog.error("initReminderUI(" + feature + "): cannot load " + config.rulesPref + ": " + e);
    }
    rules_textarea.value = saved_rules;

    function refresh() {
        rules_block.style.display = checkbox.checked ? 'block' : 'none';
        warning.classList.toggle('shown', promptTextarea.value.includes('reminderMinutes') && !checkbox.checked);
        // Preview of exactly what finalizePrompt_*() will append, from the live values:
        // a label, then a box with the fixed format instruction and, set apart, the
        // user's rules. Built through the DOM: the rules are user text.
        if (statementsEl) {
            const parts = taPromptUtils.getReminderPromptParts(feature, promptTextarea.value, checkbox.checked, rules_textarea.value);
            statementsEl.replaceChildren();
            if (parts.format === '' && parts.rules === '') {
                statementsEl.style.display = 'none';
                return;
            }
            statementsEl.appendChild(document.createTextNode(browser.i18n.getMessage("addtags_info_additional_statements")));
            const box = document.createElement('div');
            box.className = 'reminder_statements_box';
            if (parts.format !== '') {
                const format = document.createElement('div');
                format.className = 'reminder_statements_format';
                format.textContent = parts.format;
                box.appendChild(format);
            }
            if (parts.rules !== '') {
                const rules = document.createElement('div');
                rules.className = 'reminder_statements_rules';
                const intro = document.createElement('b');
                intro.textContent = parts.rulesIntro;
                rules.appendChild(intro);
                rules.appendChild(document.createTextNode("\n" + parts.rules));
                box.appendChild(rules);
            }
            statementsEl.appendChild(box);
            statementsEl.style.display = 'block';
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
        const new_rules = rules_textarea.value.trim();
        try {
            await mztaPrefs.setPref(config.rulesPref, new_rules);
        } catch (e) {
            taLog.error("initReminderUI(" + feature + "): cannot save " + config.rulesPref + ": " + e);
            return;
        }
        saved_rules = new_rules;
        rules_textarea.value = saved_rules;
        save_btn.disabled = true;
        unsaved.classList.add('hidden');
        refresh();
    });

    refresh();
}
