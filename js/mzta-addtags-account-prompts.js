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

// Per-account Add Tags prompts.
// Stored in storage.local (prompt texts can be long, storage.sync has a narrow quota)
// as an object keyed by account id: { "account1": "prompt text", ... }.
// An account without an entry (or with an empty text) uses the global Add Tags prompt.

export async function addTags_getAccountPrompts() {
    let prefs = await browser.storage.local.get({ add_tags_account_prompts: {} });
    let account_prompts = prefs.add_tags_account_prompts;
    if (!account_prompts || typeof account_prompts !== 'object' || Array.isArray(account_prompts)) {
        return {};
    }
    return account_prompts;
}

export async function addTags_setAccountPrompt(accountId, text) {
    let account_prompts = await addTags_getAccountPrompts();
    if (typeof text === 'string' && text.trim() !== '') {
        account_prompts[accountId] = text;
    } else {
        delete account_prompts[accountId];
    }
    await browser.storage.local.set({ add_tags_account_prompts: account_prompts });
    return account_prompts;
}

// Returns the Add Tags prompt to use for a message of the given account: a shallow copy of
// curr_prompt with the account text when the account has its own prompt, otherwise
// curr_prompt itself. A copy, because taPromptUtils.preparePrompt() rewrites prompt.text in
// place and on the menu path curr_prompt is the long-lived menu entry object.
export async function addTags_applyAccountPrompt(curr_prompt, accountId) {
    if (!curr_prompt || !accountId) {
        return curr_prompt;
    }
    let account_prompts = await addTags_getAccountPrompts();
    let account_text = account_prompts[accountId];
    if (typeof account_text !== 'string' || account_text.trim() === '') {
        return curr_prompt;
    }
    return { ...curr_prompt, text: account_text };
}
