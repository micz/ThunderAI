// A mandatory specific integration opens with a blank connection type and stores nothing until
// the user chooses (no policy), on the get-task page: see helpers/dom-mandatory-blank.mjs.

import { mandatoryBlankScenario } from '../../helpers/dom-mandatory-blank.mjs';

await mandatoryBlankScenario('get-task');
