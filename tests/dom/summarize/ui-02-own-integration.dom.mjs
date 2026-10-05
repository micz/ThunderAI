// The Summarize settings page with its own Claude connection stored in the special prompt, stale
// summarize_* preferences and ChatGPT Web as the global connection, no policy: spec 05 "Mandatory
// Specific Integration (feature settings pages)", "The Prompt Is Authoritative For API
// Parameters". See tests/ui/feature-page.mjs, ownIntegrationScenario().

import { ownIntegrationScenario } from '../../ui/feature-page.mjs';

await ownIntegrationScenario({
    page: 'summarize', nn: '02', prefix: 'summarize', promptId: 'prompt_summarize',
    defaultMsgKey: 'prompt_summarize_full_text', global: 'chatgpt_web',
});
