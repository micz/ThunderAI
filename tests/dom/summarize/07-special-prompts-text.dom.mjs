// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the summarize page:
// see helpers/dom-prompt-text.mjs.
// Three textareas, one lockEnforcedPromptText() call each.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('summarize', 'dom-special-prompts-text.json', [
    { id: 'summarize_prompt_text', promptIds: ['prompt_summarize'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
    { id: 'summarize_email_template_text', promptIds: ['prompt_summarize_email_template'], save: 'btn_save_email_template', reset: 'btn_reset_email_template' },
    { id: 'summarize_email_separator_text', promptIds: ['prompt_summarize_email_separator'], save: 'btn_save_email_separator', reset: 'btn_reset_email_separator' },
]);
