// A locked summarize_auto of 2 and no summarize_display_mode in the policy, over a stored
// 'webchat': opening the page does not store 'inline', which would outlive the policy. See
// helpers/dom-display-mode.mjs.

import { displayModeScenario } from '../../helpers/dom-display-mode.mjs';

await displayModeScenario({
    policy: { _org_name: 'ACME', summarize_auto: 2 },
    local: { connection_type: 'chatgpt_api', summarize_display_mode: 'webchat' },
    storedOnOpen: 'webchat',
});
