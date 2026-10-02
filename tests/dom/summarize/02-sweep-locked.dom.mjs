// Spec 08 "UI", "Controls with their own load/save logic: data-mzta-pref", "Marker placement
// and inertness", "The write guard" - the allowlist sweep, LOCKED, on the summarize page.
//
// Every allowlisted key with a control here (.option-input or [data-mzta-pref]) is locked to a
// policy value while the user has a different value stored. Each must be disabled, show the
// policy value, carry its marker where the spec puts it and have its companions disabled;
// opening the page and then changing every control through the DOM - as rendered, and again
// after re-enabling it by hand, as from the developer tools - must leave storage.local alone.
// The cases are generated from the allowlist (helpers/dom-sweep.mjs), not written by hand.
//
// The one exception, spec 08 "An automatic summary is always inline": the sweep locks
// summarize_auto to its last option, "3" (every incoming message), so the policy loader
// resolves summarize_display_mode to "inline" whatever the sweep locked it to.

import { lockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await lockedSweep('summarize', {
    todo: KNOWN['summarize']?.locked,
    expected: { summarize_display_mode: { value: 'inline', why: 'resolved by the loader: summarize_auto is locked to 3' } },
});
