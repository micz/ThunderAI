// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "UI", unlocked fields,
// on the Smart bar page, the panel of smartbar_execute: see helpers/dom-connection.mjs.

import { connectionScenario } from '../../helpers/dom-connection.mjs';

await connectionScenario('smartbar', 'unlocked', 'smartbar_execute');
