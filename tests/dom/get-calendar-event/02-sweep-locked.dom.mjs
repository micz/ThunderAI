// Spec 08 "UI", "Controls with their own load/save logic: data-mzta-pref", "Marker placement
// and inertness", "The write guard" - the allowlist sweep, LOCKED, on the get-calendar-event page.
//
// Every allowlisted key with a control here (.option-input or [data-mzta-pref]) is locked to a
// policy value while the user has a different value stored. Each must be disabled, show the
// policy value, carry its marker where the spec puts it and have its companions disabled;
// opening the page and then changing every control through the DOM - as rendered, and again
// after re-enabling it by hand, as from the developer tools - must leave storage.local alone.
// The cases are generated from the allowlist (helpers/dom-sweep.mjs), not written by hand.

import { lockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await lockedSweep('get-calendar-event', { todo: KNOWN['get-calendar-event']?.locked });
