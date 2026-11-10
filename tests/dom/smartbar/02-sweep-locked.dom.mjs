// Spec 08 "UI", "Controls with their own load/save logic: data-mzta-pref", "Marker placement
// and inertness", "The write guard" - the allowlist sweep, LOCKED, on the SmartBar page (its
// own preferences and the three connection panels). Generated from the allowlist
// (helpers/dom-sweep.mjs).

import { lockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await lockedSweep('smartbar', { todo: KNOWN['smartbar']?.locked });
