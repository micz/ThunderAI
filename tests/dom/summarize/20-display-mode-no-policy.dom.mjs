// No policy: a stored summarize_auto of 2 over a stored 'webchat' is aligned on page open, as it
// always was - the context menu summarize reads summarize_display_mode directly. See
// helpers/dom-display-mode.mjs.

import { displayModeScenario } from '../../helpers/dom-display-mode.mjs';

await displayModeScenario({
    policy: null,
    local: { connection_type: 'chatgpt_api', summarize_auto: 2, summarize_display_mode: 'webchat' },
    storedOnOpen: 'inline',
});
