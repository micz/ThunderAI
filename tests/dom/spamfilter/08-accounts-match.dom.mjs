// Spec 08 "The account checkboxes": spamfilter_enabled_accounts_match (accounts-match.json;
// its ":locked": false is ignored, the matchers are always enforced) resolves against
// accounts.json to Work (user@acme.example), Mixed (the partner.example identity) and Local
// Folders ("local"). See helpers/dom-accounts.mjs.

import { accountSelectorScenario } from '../../helpers/dom-accounts.mjs';

await accountSelectorScenario('spamfilter', 'spamfilter', 'accounts-match.json', ['account1', 'account3', 'account4']);
