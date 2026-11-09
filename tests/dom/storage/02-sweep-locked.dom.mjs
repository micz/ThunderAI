// Spec 08 "UI", "Controls with their own load/save logic: data-mzta-pref", "Marker placement
// and inertness", "The write guard" - the allowlist sweep, LOCKED, on the storage management
// page (pages/storage/): its nine retention limits and the automatic cleanup switch.
//
// Every allowlisted key with a control here ([data-mzta-pref]) is locked to a policy value while
// the user has a different value stored. Each must be disabled, show the policy value and carry its
// marker; changing every control through the DOM must leave storage.local alone. The cases are
// generated from the allowlist (helpers/dom-sweep.mjs), not written by hand.

import { lockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await lockedSweep('storage', { todo: KNOWN['storage']?.locked });
