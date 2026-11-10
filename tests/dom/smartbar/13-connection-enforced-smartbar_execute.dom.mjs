// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "UI", enforced fields,
// on the SmartBar page, the panel of smartbar_execute: see helpers/dom-connection.mjs.

import { connectionScenario } from '../../helpers/dom-connection.mjs';

await connectionScenario('smartbar', 'enforced', 'smartbar_execute');
