// The Translate settings page with its own Claude connection stored in the special prompt, stale
// translate_* preferences and no global connection, no policy: spec 05 "Mandatory Specific
// Integration (feature settings pages)", "The Prompt Is Authoritative For API Parameters". See
// tests/ui/feature-page.mjs, ownIntegrationScenario().

import { ownIntegrationScenario } from '../../ui/feature-page.mjs';

await ownIntegrationScenario({
    page: 'translate', nn: '02', prefix: 'translate', promptId: 'prompt_translate_this',
    defaultMsgKey: 'prompt_translate_this_full_text', global: '',
});
