// Spec 08 "Strict mode", on the options page: see helpers/dom-lock-unlisted.mjs.

import { lockUnlistedScenario } from '../../helpers/dom-lock-unlisted.mjs';

await lockUnlistedScenario('options', 'default_sign_name');
