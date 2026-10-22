// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the spamfilter page:
// see helpers/dom-prompt-text.mjs.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('spamfilter', 'dom-special-prompts-text.json', [
    { id: 'spamfilter_prompt_text', promptIds: ['prompt_spamfilter'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
