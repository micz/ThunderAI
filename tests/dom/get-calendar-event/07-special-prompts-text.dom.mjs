// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the get-calendar-event page:
// see helpers/dom-prompt-text.mjs.
// One textarea edits both calendar prompts, and both are enforced here.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('get-calendar-event', 'dom-special-prompts-text.json', [
    { id: 'get_calendar_event_prompt_text', promptIds: ['prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
