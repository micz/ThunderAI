// A text Save must not revert a connection change saved by the panel since page open (no policy),
// on the get-calendar-event page: see helpers/dom-text-save.mjs.

import { textSaveScenario } from '../../helpers/dom-text-save.mjs';

await textSaveScenario('get-calendar-event');
