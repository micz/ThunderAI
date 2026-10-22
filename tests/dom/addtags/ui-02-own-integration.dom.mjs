// The Add Tags settings page with its own Claude connection stored in the special prompt, stale
// add_tags_* preferences and ChatGPT Web as the global connection, no policy: spec 05 "Mandatory
// Specific Integration (feature settings pages)", "The Prompt Is Authoritative For API
// Parameters". See tests/ui/feature-page.mjs, ownIntegrationScenario().

import { ownIntegrationScenario } from '../../ui/feature-page.mjs';

await ownIntegrationScenario({
    page: 'addtags', nn: '02', prefix: 'add_tags', promptId: 'prompt_add_tags',
    defaultMsgKey: 'prompt_add_tags_full_text', global: 'chatgpt_web',
});
