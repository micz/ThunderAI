/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)
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

import { taLogger } from "../../js/mzta-logger.js";
import { getSpecialPrompts, setSpecialPrompts } from "../../js/mzta-prompts.js";
import { getPlaceholders } from "../../js/mzta-placeholders.js";
import { textareaAutocomplete } from "../../js/mzta-placeholders-autocomplete.js";

let autocompleteSuggestions = [];
let taLog = new taLogger("mzta-summarize-page", true);

document.addEventListener("DOMContentLoaded", async () => {
  
    i18n.updateDocument();

    
    const summarize_textarea = document.getElementById("summarize_prompt_text");
    const summarize_save_btn = document.getElementById("btn_save_prompt");
    const summarize_reset_btn = document.getElementById("btn_reset_prompt");
    const summarize_textarea_email_template = document.getElementById("summarize_email_template_text");
    const summarize_reset_email_template_btn = document.getElementById("btn_reset_email_template");
    const summarize_save_email_template_btn = document.getElementById("btn_save_email_template");

    let specialPrompts = await getSpecialPrompts();
    let summarize_prompt = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize');
    let summarize_email_template = specialPrompts.find((prompt) => prompt.id === 'prompt_summarize_email_template');
    
    summarize_textarea.addEventListener("input", (event) => {
        summarize_reset_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_full_text'));
        summarize_save_btn.disabled = (event.target.value === summarize_prompt.text);
    });
    
    summarize_textarea_email_template.addEventListener("input", (event) => {
        summarize_reset_email_template_btn.disabled = (event.target.value === browser.i18n.getMessage('prompt_summarize_email_template')); 
        summarize_save_email_template_btn.disabled = (event.target.value === summarize_email_template.text);
    });
    
    summarize_reset_email_template_btn.addEventListener("click", () => {
        summarize_textarea_email_template.value = browser.i18n.getMessage("prompt_summarize_email_template");
        summarize_reset_email_template_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        summarize_textarea_email_template.dispatchEvent(event);
    });
    
    summarize_reset_btn.addEventListener("click", () => {
        summarize_textarea.value = browser.i18n.getMessage("prompt_summarize_full_text");
        summarize_reset_btn.disabled = true;
        let event = new Event("input", { bubbles: true, cancelable: true });
        summarize_textarea.dispatchEvent(event);
    });
    
    summarize_save_email_template_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_summarize_email_template').text = summarize_textarea_email_template.value;
        setSpecialPrompts(specialPrompts);
        summarize_save_email_template_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });
    
    summarize_save_btn.addEventListener("click", () => {
        specialPrompts.find(prompt => prompt.id === 'prompt_summarize').text = summarize_textarea.value;
        setSpecialPrompts(specialPrompts);
        summarize_save_btn.disabled = true;
        browser.runtime.sendMessage({ command: "reload_menus" });
    });
    
    if(summarize_prompt.text === 'prompt_summarize_full_text'){
        summarize_prompt.text = browser.i18n.getMessage(summarize_prompt.text);
    }
    if(summarize_email_template === 'prompt_summarize_email_template'){
        summarize_email_template.text = browser.i18n.getMessage(summarize_email_template.text);
    }
    
    summarize_textarea_email_template.value = summarize_email_template.text;
    summarize_reset_email_template_btn.disabled = (summarize_email_template.value === browser.i18n.getMessage("prompt_summarize_email_template"));

    summarize_textarea.value = summarize_prompt.text;
    summarize_reset_btn.disabled = (summarize_textarea.value === browser.i18n.getMessage("prompt_summarize_full_text"));
    
    autocompleteSuggestions = (await getPlaceholders(true))
        .filter((p) => p.id !== "additional_text")
        .map((p) => ({ command: `{%${p.id}%}`, type: p.type }));
    textareaAutocomplete(summarize_textarea, autocompleteSuggestions, 1);
});

