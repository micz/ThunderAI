// Spec 08 "Resolution": add_tags_enabled_accounts_match ["@nomatch.example"]
// (accounts-match.json) matches no account here: "no account", with every box unchecked and
// AccountSelector_managed_none. See helpers/dom-accounts.mjs.

import { accountSelectorScenario } from '../../helpers/dom-accounts.mjs';

await accountSelectorScenario('addtags', 'add_tags', 'accounts-match.json', []);
