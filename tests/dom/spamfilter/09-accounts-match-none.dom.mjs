// Spec 08 "Validation" / "Resolution": a spamfilter_enabled_accounts_match whose entries are
// all invalid (accounts-match-edge.json) is kept, empty, and means NO account - never "all
// accounts". The selector shows every box unchecked and says the list matches nothing
// (AccountSelector_managed_none). See helpers/dom-accounts.mjs.

import { accountSelectorScenario } from '../../helpers/dom-accounts.mjs';

await accountSelectorScenario('spamfilter', 'spamfilter', 'accounts-match-edge.json', []);
