// Spec 08 "Enforced per-feature connections (_special_prompts_connection)" -> "UI", enforced fields,
// on the get-calendar-event page: see helpers/dom-connection.mjs.

import { connectionScenario } from '../../helpers/dom-connection.mjs';

await connectionScenario('get-calendar-event', 'enforced');
