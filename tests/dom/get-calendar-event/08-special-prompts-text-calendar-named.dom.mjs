// Spec 08 "Enforced special prompt texts (_special_prompts_text)" -> "UI", on the get-calendar-event page:
// see helpers/dom-prompt-text.mjs.
// Only prompt_get_calendar_event is valid (the policy names the clipboard variant with an
// invalid text, so no copy is made): the one textarea is still locked, since it saves both,
// and the policy has no _org_name, so the plain marker text is used.

import { enforcedTextScenario } from '../../helpers/dom-prompt-text.mjs';

await enforcedTextScenario('get-calendar-event', 'special-prompts-text-calendar-named.json', [
    { id: 'get_calendar_event_prompt_text', promptIds: ['prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard'], save: 'btn_save_prompt', reset: 'btn_reset_prompt' },
]);
