// {prefix}_use_specific_integration locked on by the policy without a policy connection, on the
// SmartBar page, the panel of smartbar_chat: see helpers/dom-locked-on-switch.mjs.

import { lockedOnSwitchScenario } from '../../helpers/dom-locked-on-switch.mjs';

await lockedOnSwitchScenario('smartbar', 'smartbar_chat');
