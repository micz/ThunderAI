// Spec 08 "Resolution order" and "The lock convention" - the allowlist sweep, UNLOCKED, on the
// SmartBar page. Generated from the allowlist (helpers/dom-sweep.mjs).

import { unlockedSweep } from '../../helpers/dom-sweep.mjs';
import { KNOWN } from '../../helpers/dom-known-issues.mjs';

await unlockedSweep('smartbar', { todo: KNOWN['smartbar']?.unlocked });
