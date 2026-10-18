// Spec 08 "The account checkboxes": add_tags_enabled_accounts_match ["@acme.example"] resolves
// against accounts.json to Work and Colleague, the two acme.example identities. See
// helpers/dom-accounts.mjs.

import { accountSelectorScenario } from '../../helpers/dom-accounts.mjs';

await accountSelectorScenario('addtags', 'add_tags', 'dom-accounts-match-add-tags.json', ['account1', 'account2']);
