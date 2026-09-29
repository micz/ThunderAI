// Spec 08 "Resolution order" and "The lock convention" - the allowlist sweep, UNLOCKED, on the
// get-calendar-event page.
//
// Every allowlisted key with a control here is an initial policy value (":locked": false)
// while the user has a different value stored: the user's value wins, so the page must look
// and behave exactly as it does without a policy for that stored value - same value, same
// disabled state, no mark, no marker. Cases generated from the allowlist
// (helpers/dom-sweep.mjs).

import { unlockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await unlockedSweep('get-calendar-event', { todo: KNOWN['get-calendar-event']?.unlocked });
