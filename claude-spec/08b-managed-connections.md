# Enterprise Managed Configuration: Connections and Accounts

Policy values on the connection panels, the per-feature connections enforced by policy, and the
account lists of the automatic features. Part of the enterprise managed configuration
specification: the mechanism these build on - resolution order, write guard, hydration,
validation - is in [08-managed-configuration.md](08-managed-configuration.md).

## Locked model selects

A locked `{provider}_model` (`chatgpt_model`, `google_gemini_model`, `ollama_model`,
`openai_comp_model`, `anthropic_model`) also takes its "Fetch models" button away: fetching a
list the user cannot pick from is pointless. In `pages/_lib/connection-ui.js`,
`isManagedModel()` reads the `data-mzta-managed` mark `applyManagedUI()` sets, and:

- the connection checks (`warn_*Empty()`) never enable the fetch button while it is set;
- `toggleTomSelectDisabled()` never re-enables the select (or its Tom Select) while it is set,
  whatever the caller asks, and disables it without `clear()`, so the enforced model stays
  shown - `clear()` would also fire a `change` that tries to save `''`. The empty-credential
  branches of the `warn_*Empty()` checks leave its `selectedIndex` alone for the same reason,
  so emptying a key or host and typing it back never loses the enforced model;
- the model select's `mzta-managed` event re-runs its provider's checks, because
  `applyManagedUI()` runs after the connection panel has been built and checked.

## No seeding from policy values

The six feature pages pre-fill their per-feature connection fields
(`{prefix}_{integration}_{key}`, and `{prefix}_connection_type`) from the global value when
the special prompt has none (`resolveFeatureConnectionPrefs()` in `pages/_lib/feature-page.js`,
which their `restoreOptions()` calls), and `initializeSpecificIntegrationUI()` writes those fields into
the prompt with `_updatePrompt()` — **on page open** when the specific integration is on. The
custom prompts editor does the same into `_custom_prompt`. These are prompt properties, not
preferences, so no write guard stands in the way: a seeded policy value would outlive the
policy, and a seeded marker would be sent to the provider as the key.

So a seed never comes from a policy-supplied value: `seedFromGlobal(prefs, key)` in
`pages/_lib/managed-ui.js` returns `prefs_default[key]` when `mztaManaged.hasManagedValue(key)`
and `prefs[key]` otherwise — exactly the previous behaviour with no policy. Any new code that
copies a global preference into a prompt must go through it.

## A locked per-feature connection type

A feature page's `restoreOptions()` normally shows the special prompt's `api_type` in its
`{prefix}_connection_type` select, or a seed from the global connection when the prompt has
none: the prompt is the source of truth for that select. A **locked** `{prefix}_connection_type`
is the exception, on all six pages (the shared `resolveFeatureConnectionPrefs()`): the select
keeps the enforced value `getAllPrefs()` resolved, because that is what runs — `getConnectionType()` reads the per-feature preference
before the prompt's `api_type`. The test is `isEnforcedPref(key)` in `pages/_lib/managed-ui.js`,
the synchronous `mztaManaged.isManagedLocked()`, usable before `applyManagedUI()` because the
preference read has already hydrated the policy. An initial (`":locked": false`) value changes
nothing: the page shows exactly what it shows without a policy.

The enforced value never reaches the prompt either: `_updatePrompt()` in
`initializeSpecificIntegrationUI()` leaves `prompt.api_type` as it is while the key is locked,
for the reason in [No seeding from policy values](#no-seeding-from-policy-values). The
page-open copy of the prompt's `api_type` into the preference (`persistPromptConnectionToPrefs()`)
is stopped by the per-key write guard of `setPrefs()`, as before.

## Enforced per-feature connections (`_special_prompts_connection`)

This key lets the administrator set the connection of a feature that supports a specific
integration: every prefix of `special_prompts_with_integration` (`add_tags`, `spamfilter`,
`summarize`, `get_calendar_event`, `get_task`, `translate`). The prefix is the same one
`{prefix}_use_specific_integration` uses.

Neither the allowlist nor `_special_prompts_text` can do this. The per-feature override is not
a preference: it lives in the special prompt (`api_type` plus the `{integration}_{key}` fields,
see [04-api-integrations.md](04-api-integrations.md#per-feature-provider-override-specific-integration)).
Only `{prefix}_use_specific_integration` is in `prefs_default`.

```json
"_special_prompts_connection": {
  "spamfilter": {
    "api_type": "openai_comp_api",
    "openai_comp_host": "https://ai-gateway.example.org",
    "openai_comp_api_key": "…",
    "openai_comp_model": "gpt-4o-mini",
    "openai_comp_model:locked": false
  }
}
```

The field names are **exactly** the override properties stored on the special prompt:
`${integration}_${key}` for a key of `integration_options_config[integration]`, where
`integration` is the `api_type` without `_api`. There is no translation layer, so a field added
to `integration_options_config` can be set here the moment it is declared (see
[Adding a policy-settable preference](08-managed-configuration.md#adding-a-policy-settable-preference) for what still needs a hand).

### Lock semantics

The convention is the rest of this file's: every field present is **enforced**, and a sibling
`"<field>:locked": false` makes it an initial value.

| Field | Resolution on the prompt |
|---|---|
| `api_type` | **always enforced**. `"api_type:locked": false` is warned about and ignored: an unlocked provider under enforced provider-specific fields makes no sense |
| enforced field | the policy value, always, over any stored value |
| unlocked field | the policy value only while the prompt has none of its own (absent or `''`); never written to storage |
| field the policy does not name | the user's, as without a policy; if the prompt has none either, `initWorker()` falls back to the global preference, as before |

A top-level `"_special_prompts_connection:locked"` is warned about and ignored.

### Implied preferences and conflicts

`getConnectionType()` reads `{prefix}_use_specific_integration` / `{prefix}_connection_type`
**before** `prompt.api_type`. The menu gating and the options feature row read only that
pair (`prompt = null`). So an entry accepted by validation **implies** both, injected into
`_values` / `_locked` right after validation:
`{prefix}_use_specific_integration = true` and `{prefix}_connection_type = api_type`, both
locked. They are ordinary allowlisted preferences from then on. Hydration, the write guard,
`applyManagedUI()` (the switch and the type select locked and marked) and
[A locked per-feature connection type](#a-locked-per-feature-connection-type) apply to them unchanged.

When the policy also sets those preferences explicitly:

| Explicit value in the same policy | Result |
|---|---|
| `{prefix}_use_specific_integration: false`, locked **or** initial | the connection entry is **skipped**, with a `taLogger.warn()`. The explicit switch wins; the feature falls back to the global connection, which the administrator controls too |
| `{prefix}_use_specific_integration: true`, initial | upgraded to enforced, with a warning |
| `{prefix}_connection_type`, different or initial | replaced by `api_type`, locked, with a warning |

The first rule is what keeps the two per-feature overlays apart. A prefix locked off gets the
locked-off overlay ([Interaction points](08-managed-configuration.md#interaction-points)) and never a connection entry.
`applyPolicyConnections()` also skips any locked-off prefix itself, so the order of the two
overlays cannot matter.

### Validation

`validateSpecialPromptsConnection()` in [`js/mzta-managed.js`](../js/mzta-managed.js) runs in
pass 3. It follows the same style as `validateSpecialPromptsText()`: the value must be a plain
object (otherwise the whole key is ignored), and each entry is checked on its own. **An entry
without a usable `api_type` is skipped as a whole**; every other problem skips only the field.
Every skip is a `taLogger.warn()` naming the feature and the field, and the rest of the policy
still applies.

- The key must be a prefix of `special_prompts_with_integration`, and the entry a plain object.
- `api_type` is required and must be one of `featureConnectionTypes()`. That list is derived,
  not written out: the entries of `valid_connection_types` that have an
  `integration_options_config` block, which is the same mapping `initWorker()` uses. Those are
  exactly the types the feature panels offer, since they inject with `no_chatgpt_web: true`. So
  `chatgpt_web` is rejected for every feature.
- Each other field must belong to that `api_type`. A field of another provider gets its own
  message ("belongs to the X connection, not to Y").
- Its type must be the type of its `integration_options_config` default, never coerced. Then
  come the content rules (`connectionFieldProblem()`):

  | Field | Rule |
  |---|---|
  | `*_host` | parses as an `http:` or `https:` URL |
  | `*_model` | not empty |
  | numeric default (`ollama_num_ctx`, `anthropic_max_tokens`, `anthropic_extended_thinking_budget`) | a non-negative integer; `anthropic_max_tokens` ≥ 1 |
  | `*_temperature` | `''` or a finite number ≥ 0 |
  | `google_gemini_thinking_budget` | `''` or an integer (`-1` is Gemini's "dynamic") |
  | `*_extra_body` | `''` or JSON that parses to a plain object, the `parseExtraBody()` contract |

  The settings UI enforces none of these; it saves what is typed and the request builders
  cope. A user's typo breaks that user's feature. A policy typo breaks it for the whole fleet,
  and the user can do nothing about it.
- `"<field>:locked"` must be a boolean. Anything else is warned about, and the field stays
  enforced. A `":locked"` whose field was rejected or is absent is warned about.

The validated form is `{prefix: {api_type, fields: {name: {value, locked}}}}`. The accessors are:

- `getSpecialPromptsConnection()` and `getSpecialPromptConnection(prefix)`, which return copies;
- `getEnforcedConnectionControlIds()` and `isEnforcedConnectionControl(id)`, the
  `${prefix}_${field}` ids of the locked fields.

The key counts towards `_active`.

### Secrets

API key fields follow [Policy-supplied API keys](08-managed-configuration.md#policy-supplied-api-keys) exactly:

- **In the background:** `getSpecialPrompts()` overlays the real key, which is what
  `initWorker()` and `menus.allPrompts` get.
- **In `get_managed_values`:** every `*_api_key` field of `specialPromptsConnection` is
  `MANAGED_SECRET_MARKER` except for `api_webchat/`, which runs a feature's connection itself.
  A content script gets `{}`.
- **On a feature page:** the key field shows the marker, which the eye toggle, "Update", the
  empty-key checks and the storage gates already refuse. So does the connection test strip
  (`#mzta_conn_test`, also on the feature pages and in the custom prompts detail editor since
  5.1.0): `runConnectionTest(connType, idPrefix)` reads the key as `idPrefix + keyId`, finds the
  marker and reports `connTest_managed_api_key` without a request.
- **Never persisted, never exported:** `stripTransientFlags()` drops a marker key before the
  storage gate below. `preparePromptsForExport()` removes `api_type` and every override field
  from a prompt marked `_connection_by_policy`, whatever `include_api_settings` says. No
  shipped caller exports special prompts today; this is a guard for any future one.

### Application: a read-time overlay, never persisted

`applyPolicyConnections()` in [`js/mzta-prompts.js`](../js/mzta-prompts.js) runs in both
branches of `getSpecialPrompts()`. The order is `applyCalendarNoSelection()` →
`applyLockedOffIntegrations()` → **`applyPolicyConnections()`** → `applyEnforcedTexts()`. It
awaits `managedReady()`, applies the table above to every prompt of `specialPromptIdsForPrefix(prefix)`,
and sets the transient `_connection_by_policy: true`, which is in `TRANSIENT_PROMPT_FLAGS`.

The prompts per feature are the ones the locked-off overlay uses:

- **summarize:** `prompt_summarize` alone. The email template and separator are text
  fragments, never a command's `config`, never edited by the panel.
- **get_calendar_event:** both calendar prompts. The clipboard variant runs with the same
  prefix, and with the overlay it now runs the feature's connection too; without a policy it
  never carries override fields at all.

**Why read-time only.** Every write rewrites the whole `_special_prompts` array from a read that
carries the overlay: `savePrompt()`, `clearPromptAPI()` and the feature pages' text Save
(`saveSpecialPromptTexts()`) do a load-modify-save through `getSpecialPrompts()`, and the menu
order page's `saveAll()` writes back the list it loaded at page open. A stored policy value would
replace the user's own override and outlive the policy. So `setSpecialPrompts()` runs `keepStoredConnections()` after `keepStoredOverrides()`.
For each policy-connected prompt:

- `api_type` and every enforced field get back what storage holds (deleted if it holds none);
- an unlocked field the writer names in the prompt's transient `_user_fields` is saved as
  written, **even when it equals the policy default**: the user chose it. Only the connection
  panel sets it: `_updatePrompt(field)` in `initializeSpecificIntegrationUI()` marks the one
  field whose control fired the `change`. `setSpecialPrompts()` reads it before
  `stripTransientFlags()` drops it (it is in `TRANSIENT_PROMPT_FLAGS`, so it is never stored or
  exported). It never lets an enforced field or `api_type` through. A value chosen this way is
  the user's from then on, and stays after the policy is removed;
- any other unlocked field that holds the policy value, or that is absent (a marker dropped by
  `stripTransientFlags()`, or a writer that never had the field), gets back what storage holds.
  So a policy default the page merely *showed* is never stored as the user's value, **not even
  over a stored value of theirs**: that is exactly what a stale array copy writes (the menu
  order page's `saveAll()`, or any caller holding a read from before the user's change), and
  `getSpecialPrompts()` never sets `_user_fields` on it. The other fields
  `_updatePrompt()` copies from the panel with the edited one are not marked either;
- any other value is the user's, and saved.

The lock state is read synchronously from `mztaManaged`, as for `keepStoredOverrides()`: before
`loadManaged()` (the migration block) nothing is supplied and the gate is a no-op. **Removing
the policy restores the user's override exactly, field by field**, and the preference pair
falls back to what the user stored.

### The connection panel

The feature pages need no page-specific logic beyond one guard:

- **The switch and the type select** are the implied locked preferences, so `applyManagedUI()`
  disables and marks them. `restoreOptions()` shows the enforced type through `isEnforcedPref()`.
- **The fields.** `applyManagedUI()` matches `state.lockedKeys` **plus**
  `getEnforcedConnectionControlIds()`: the panel names its inputs `${prefix}_${field}`. Every
  enforced field is therefore disabled and marked like a locked preference, with the marker in
  its `td`. That brings every existing mechanism with it:
  - `syncSecretToggle()` shows the padlock (it reads `data-mzta-managed`);
  - `isManagedModel()` keeps the enforced model in a disabled select and disables "Update"
    ([Locked model selects](#locked-model-selects));
  - `setDisabledRespectingManaged()` keeps page logic from re-enabling anything.
- **Unlocked fields** stay editable and show the overlay: the user's value, or the policy
  default. An unlocked policy key shows the marker, with the padlock, until the user types
  their own.
- **`initializeSpecificIntegrationUI()`** gets mode `policy` (see [The connection mode](#the-connection-mode)):
  - no "mandatory" forcing: the managed marker is the explanation;
  - no page-open `_updatePrompt()`, `_persistSelectedConnection()` or
    `_persistMandatoryIntegration()`: what the panel shows is the policy's, not something to seed;
  - `_updatePrompt()` never copies an enforced field from the DOM, and marks the field the user
    changed in `_user_fields` (see the storage gate above);
  - the per-field listener ignores an enforced field, and the type-select listener ignores a
    locked select, so a control re-enabled by hand writes nothing at all;
  - the switch handler forces a re-enabled switch back on without `clearPromptAPI()`.
- **The one page guard.** On page open every feature page calls
  `persistPromptConnectionToPrefs(prefix, prompt)` (`pages/_lib/feature-page.js`), which copies
  `prompt.api_type` and the fields into `{prefix}_*` preferences. It skips a prompt for which
  `isPolicyConnection(prompt)` (`pages/_lib/managed-ui.js`) is true.
- **The write guard** refuses the enforced ids that the pages' `saveOptions()` would write (see
  [The write guard](08-managed-configuration.md#the-write-guard)).

### The connection mode

The policy can hold a feature's specific integration in three ways - the switch locked off, a
policy connection, the switch locked on alone - and the panel has two modes of its own. Which
one applies is decided **once**, by `resolveSpecificIntegrationMode(prefix, globalConnType)` in
`pages/_lib/managed-ui.js`, and `initializeSpecificIntegrationUI()` acts only on the object it
returns, never re-testing the policy itself. It is pure apart from reading the hydrated policy,
so it is tested at level 1.

| `kind` | When | Switch held at (`switchValue`) | Writes the prompt | Seeds on open | Mandatory forcing |
|---|---|---|---|---|---|
| `locked_off` | `{prefix}_use_specific_integration` locked `false` | off | no | no | no |
| `policy` | a `_special_prompts_connection` entry for the prefix | on | unlocked fields only | no | no |
| `locked_on` | `{prefix}_use_specific_integration` locked `true`, no entry | on | yes, the connection is the user's | yes | no |
| `mandatory` | no lock on the switch, global connection ChatGPT Web or none | - | yes | yes | yes |
| `free` | otherwise | - | yes | yes | no |

`typeLocked` (a locked `{prefix}_connection_type`, implied by a `policy` entry or set on its own)
keeps `prompt.api_type` out of `_updatePrompt()` and makes the type-select listener write nothing.
An initial (`":locked": false`) switch holds nothing: the mode is `mandatory` or `free`.

**A switch the policy holds writes nothing when it changes.** The switch handler tests one thing:
`switchValue !== null` puts a switch re-enabled from the developer tools back to that value and
returns. Before the resolver, `locked_on` was not one of the handled cases, so turning such a
switch off reached `clearPromptAPI()` - a prompt write no write guard covers - and wiped the
user's stored override, and over an unusable global connection the panel showed the "mandatory"
badge next to the managed marker. Never `mandatory` under a held switch: the managed marker is the
explanation, and persisting the switch is the write guard's to refuse anyway.

### Startup warning

In the background, `getReplacedProviderOverrides()` reads the raw store. The background then
`taLogger.warn()`s once for each value the policy replaces that the user stored for the
feature: the policy `api_type`, or an **enforced** field holding a different, non-empty value.
The warning names the feature and the field, never the value. An unlocked field replaces
nothing. The skips (invalid `api_type`, conflict with an explicit `false`) are warned about by
validation, which runs once, at startup.

## Account lists by policy (`*_enabled_accounts_match`)

Lets an administrator decide which accounts the **automatic** spam filter and the
**automatic** Add Tags run on. `spamfilter_enabled_accounts` / `add_tags_enabled_accounts`
cannot be set by policy (see [The allowlist](08-managed-configuration.md#the-allowlist)), so each has a policy-settable
counterpart, `spamfilter_enabled_accounts_match` / `add_tags_enabled_accounts_match`,
declared in `prefs_default` as `[]` and therefore covered by the allowlist, the type check
and the write guard like any other preference.

```json
"spamfilter_enabled_accounts_match": ["micthdev@gmail.com", "@acme.example", "local"]
```

### Entries

`isAccountMatcherEntry()` in [`js/mzta-managed.js`](../js/mzta-managed.js); case-insensitive,
surrounding whitespace ignored, stored lowercased:

| Entry | Matches |
|---|---|
| `user@acme.example` | an account with an identity of that address |
| `@acme.example`, `*@acme.example` | an account with an identity in that domain |
| `local` | Local Folders (account type `none`), which has no identity |

Addresses and domains are matched by **`matchAddressList()`** in `js/mzta-utils.js`, the
helper `summarize_auto_senders_list` uses, against each identity's `email`; an account
matches when any of its identities does. An entry is accepted only in the shape
`extractEmail()` (which `matchAddressList()` runs) recognises — `[\w.-]+@[\w.-]+\.\w+` — so
an entry that could never match is rejected loudly instead: this includes an address with a
`+` tag, which that helper cannot see. The domain form still covers such an identity.

**Other identity-less accounts — RSS feeds (`rss`) — are never matched.** They have no
stable name a fleet-wide policy could use, and the spam filter has no business on feed
items. A managed list therefore always leaves feeds out; add a literal next to `local` if an
organization ever needs auto-tagging on feeds.

### Resolution

`resolveEnabledAccounts(feature, storedList)` in [`js/mzta-utils.js`](../js/mzta-utils.js)
returns `{restricted, accountIds, managed}`:

- **not managed** (the policy supplies no `_match` value): exactly the stored list, with the
  existing semantics — `restricted` is `stored.length > 0`, so an empty list is all accounts;
- **managed**: `accountIds` resolved from `browser.accounts.list(false)` and the matchers,
  and `restricted` is **always true**. An empty result means **no account**, never "all
  accounts" — the `[]`-means-all convention belongs to the stored list only, and applying it
  here would turn a policy that matches nothing into a policy that enables everything. It is
  `taLogger.warn()`ed once per context — at startup in the background, which resolves both
  lists for that purpose — and again only after the list has matched something in between.

The resolved ids **replace** the stored list in `processEmails()` (`mzta-background.js`),
the only place either feature decides whether an account is in scope (auto mode only, as
before). They are **never written** to `{feature}_enabled_accounts`: the stored value stays
the user's, untouched, and removing the policy restores it.

The matchers are read from `mztaManaged`, **not** through `mztaPrefs`: the key is
policy-only, and a stray stored value must not limit anything without a policy. An empty
array in the policy means "not managed" and is not recorded at all.

**Resolved at each check, not on account events.** `processEmails()` resolves once per
batch (one `accounts.list(false)` call, no folders), so an account created, removed or given
a new identity after startup is picked up at the next batch without listening to
`accounts.onCreated` / `onUpdated` / `onDeleted`. A cached list would need all three
listeners plus identity events to stay right, and a missed one would silently leave a new
account unfiltered — or filtered against the policy; the per-batch cost is negligible next
to the AI call it gates. If the account list cannot be read, the result is "no account":
fail closed, since the policy asked to limit.

### The account checkboxes

`lockAccountSelector(feature, container, companions)` in
[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), called by `pages/spamfilter/` and
`pages/addtags/` after they have built and checked the account checkboxes. When
`{feature}_enabled_accounts_match` is locked it re-checks every box from the **resolved**
list, disables and marks each one (`data-mzta-managed`), makes "Select All" / "Deselect All"
inert through `lockCompanions()`, puts the marker right of the section title, and replaces
the "Each change is saved immediately" line with `AccountSelector_managed_note` — or
`AccountSelector_managed_none` when the list matches nothing here. The page's checkbox
`change` handler and both button handlers **return early** on its result; the write guard
does not cover `{feature}_enabled_accounts` (it is not locked), so this early return is what
keeps the page from writing the user's list while it is overridden.
