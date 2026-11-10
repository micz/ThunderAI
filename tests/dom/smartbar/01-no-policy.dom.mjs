// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the SmartBar page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock.

import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';
import { loadFixture } from '../../helpers/load.mjs';

await noPolicyScenario('smartbar', { accounts: loadFixture('accounts.json') });
