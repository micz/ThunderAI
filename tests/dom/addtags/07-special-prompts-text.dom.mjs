// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the addtags page:
// see helpers/dom-prompt-text.mjs.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('addtags', 'dom-special-prompts-text.json', [
    { id: 'addtags_prompt_text', promptIds: ['prompt_add_tags'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
