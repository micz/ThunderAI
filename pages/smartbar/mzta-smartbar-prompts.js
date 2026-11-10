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
 *  The Prompts tab of the SmartBar page (claude-spec/10-smartbar.md "Feature page",
 *  claude-spec/02-prompts.md "SmartBar prompts"): the texts of the three special prompts of the
 *  feature, each with the shared editor of the feature pages (bindSpecialPromptEditor(): Save,
 *  Restore default, the policy lock), and:
 *   - the JSON format section of the router and of execute shown read-only under the text: the
 *     add-on appends it at call time, it is never part of the text saved;
 *   - the router's variables checked on Save: a text without one of them is not saved, and the
 *     message names the missing ones;
 *   - the update notice when a release changed a default text the user had customized, with the
 *     change picker to compare and adopt (pages/_lib/prompt-update.js).
 */

import { ROUTER_VARIABLES, ROUTER_JSON_SECTION } from '../../js/mzta-smartbar-router.js';
import { EXECUTE_JSON_SECTION } from '../../js/mzta-smartbar-execute.js';
import { bindSpecialPromptEditor } from '../_lib/feature-page.js';
import { openDefaultCompare } from '../_lib/prompt-update.js';

/** The three prompts of the tab: the key of their elements, the variables their text needs. */
export const SMARTBAR_PROMPTS = Object.freeze([
    { key: 'router', promptId: 'prompt_smartbar_router', defaultMsgKey: 'prompt_smartbar_router_full_text', variables: ROUTER_VARIABLES, locked: ROUTER_JSON_SECTION },
    { key: 'execute', promptId: 'prompt_smartbar_execute', defaultMsgKey: 'prompt_smartbar_execute_full_text', variables: [], locked: EXECUTE_JSON_SECTION },
    { key: 'chat', promptId: 'prompt_smartbar_chat', defaultMsgKey: 'prompt_smartbar_chat_full_text', variables: [], locked: null },
]);

/** The variables of `variables` the text lacks (each written exactly, braces included). */
export function missingVariables(text, variables) {
    return variables.filter(v => !String(text ?? '').includes(v));
}

export async function initPromptsTab(specialPrompts, do_debug = false) {
    for (const def of SMARTBAR_PROMPTS) {
        const el = name => document.getElementById('smartbar_prompt_' + def.key + '_' + name);
        if (def.locked) el('locked').textContent = def.locked;
        const textarea = el('text');
        const errorEl = el('error');
        const showMissing = (missing) => {
            errorEl.textContent = missing.length > 0
                ? browser.i18n.getMessage('smartbar_prompt_missing_variables', [missing.join(', ')])
                : '';
            errorEl.hidden = missing.length === 0;
        };
        // Once refused, the message follows the text until it is complete again.
        textarea.addEventListener('input', () => {
            if (!errorEl.hidden) showMissing(missingVariables(textarea.value, def.variables));
        });
        await bindSpecialPromptEditor({
            textarea: textarea,
            saveBtn: document.getElementById('btn_save_smartbar_' + def.key),
            resetBtn: document.getElementById('btn_reset_smartbar_' + def.key),
            unsavedEl: el('unsaved'),
            specialPrompts: specialPrompts,
            promptIds: [def.promptId],
            defaultMsgKey: def.defaultMsgKey,
            do_debug: do_debug,
            beforeSave: (text) => {
                const missing = missingVariables(text, def.variables);
                showMissing(missing);
                return missing.length === 0;
            },
            updateNotice: { el: el('update'), onCompare: openDefaultCompare },
        });
    }
}
