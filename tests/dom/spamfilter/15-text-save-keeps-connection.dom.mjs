// A text Save must not revert a connection change saved by the panel since page open (no policy),
// on the spamfilter page: see helpers/dom-text-save.mjs.

import { textSaveScenario } from '../../helpers/dom-text-save.mjs';

await textSaveScenario('spamfilter');
