// A mandatory specific integration opens with a blank connection type and stores nothing until
// the user chooses (no policy), on the SmartBar page, the panel of smartbar_execute: see
// helpers/dom-mandatory-blank.mjs.

import { mandatoryBlankScenario } from '../../helpers/dom-mandatory-blank.mjs';

await mandatoryBlankScenario('smartbar', 'smartbar_execute');
