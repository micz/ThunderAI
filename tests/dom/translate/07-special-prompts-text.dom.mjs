// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the translate page:
// see helpers/dom-prompt-text.mjs.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('translate', 'dom-special-prompts-text.json', [
    { id: 'translate_prompt_text', promptIds: ['prompt_translate_this'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
