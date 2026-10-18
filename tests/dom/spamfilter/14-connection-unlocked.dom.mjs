// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "UI", unlocked fields,
// on the spamfilter page: see helpers/dom-connection.mjs.

import { connectionScenario } from '../../helpers/dom-connection.mjs';

await connectionScenario('spamfilter', 'unlocked');
