// {prefix}_use_specific_integration locked on by the policy without a policy connection, on the
// spamfilter page: see helpers/dom-locked-on-switch.mjs.

import { lockedOnSwitchScenario } from '../../helpers/dom-locked-on-switch.mjs';

await lockedOnSwitchScenario('spamfilter');
