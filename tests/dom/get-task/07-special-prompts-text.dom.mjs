// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the get-task page:
// see helpers/dom-prompt-text.mjs.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('get-task', 'dom-special-prompts-text.json', [
    { id: 'get_task_prompt_text', promptIds: ['prompt_get_task'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
