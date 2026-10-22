// The Task settings page with its own Claude connection stored in the special prompt, stale
// get_task_* preferences and ChatGPT Web as the global connection, no policy: spec 05 "Mandatory
// Specific Integration (feature settings pages)", "The Prompt Is Authoritative For API
// Parameters". See tests/ui/feature-page.mjs, ownIntegrationScenario().

import { ownIntegrationScenario } from '../../ui/feature-page.mjs';

await ownIntegrationScenario({
    page: 'get-task', nn: '02', prefix: 'get_task', promptId: 'prompt_get_task',
    defaultMsgKey: 'prompt_get_task_full_text', global: 'chatgpt_web',
});
