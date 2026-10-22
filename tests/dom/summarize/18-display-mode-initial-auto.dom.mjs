// An initial (":locked": false) summarize_auto of 2, with no own value of the user's, over a stored
// summarize_display_mode 'webchat': opening the page does not store 'inline' (it would be derived
// from the policy), a user change of summarize_auto does. See helpers/dom-display-mode.mjs.

import { displayModeScenario } from '../../helpers/dom-display-mode.mjs';

await displayModeScenario({
    policy: { _org_name: 'ACME', summarize_auto: 2, 'summarize_auto:locked': false },
    local: { connection_type: 'chatgpt_api', summarize_display_mode: 'webchat' },
    storedOnOpen: 'webchat',
    userChange: 3,
});
