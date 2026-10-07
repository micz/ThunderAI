# Enterprise Managed Configuration

How an administrator pre-configures or enforces ThunderAI settings across a fleet, and how
that resolves inside the add-on.

The administrator-facing documentation — where `policies.json` goes, a worked example, the
full key reference — is published on micz.it, not kept in this repository. **This** file is
the implementation contract; anything user-facing that changes here has to be carried over
to the site by hand.

## Overview

| | |
|---|---|
| **Mechanism** | Thunderbird enterprise policy, `3rdparty` → `Extensions` → `thunderai@micz.it`, read through `browser.storage.managed` |
| **Module** | [`js/mzta-managed.js`](../js/mzta-managed.js) — reads and validates only |
| **Resolution** | [`js/mzta-prefs.js`](../js/mzta-prefs.js) — the preference choke point |
| **Permissions** | none added; `storage` was already granted |
| **When read** | once, at background startup; every other extension context **hydrates** the values from the background on its first preference read |

Explicitly **out of scope**, and not to be added: fetching configuration from a URL
(rejected by the Thunderbird review team) and ADMX templates.

**With no policy installed the behaviour is byte-for-byte what it was before this
existed.** `browser.storage.managed.get()` *rejects* when no policy is present — that is
the normal case for nearly every user, so it is caught and swallowed **silently**, without
even a debug line.

## The spec files

This specification is split by topic. This file holds the mechanism itself; the others hold
what is built on it. Test files and code comments cite sections as `spec 08 "<section>"`,
whichever of the four files the section is in.

| File | Holds |
|---|---|
| `08-managed-configuration.md` (this file) | overview, resolution order, write guard, load ordering, hydration, policy-supplied API keys, the allowlist, validation, lock convention, structural keys, interaction points, adding a preference or a restriction, testing |
| [`08a-managed-prompts.md`](08a-managed-prompts.md) | restrictions, organization prompts, enforced special prompt texts |
| [`08b-managed-connections.md`](08b-managed-connections.md) | locked model selects, no seeding from policy values, locked per-feature connection type, enforced per-feature connections and the connection mode, account lists |
| [`08c-managed-ui.md`](08c-managed-ui.md) | `pages/_lib/managed-ui.js`: control matching, `data-mzta-pref`, the setup wizard, marker placement and inertness |

## Why this is small

Everything rests on [`js/mzta-prefs.js`](../js/mzta-prefs.js) being the single choke point
for every preference read *and* write (issue #163). The whole mechanism is two private
helpers and two guards in that file; **no call site outside it changed.**

The one prerequisite that had to be built first: `setPref()` was single-key by design, so
eight writers bypassed the module with a direct `storage.local.set()`. `setPrefs(obj)` was
added and those writers migrated, so the write guard exists in exactly one place.

## Resolution order

```
locked policy value  >  user value in storage.local  >  unlocked policy value  >  prefs_default
```

Implemented as a per-read overlay — the accessor has no cache, and deliberately did not
gain one:

- **`_defaultsFor()`** passes an *unlocked* policy value to `storage.get()` as that key's
  default. That is exactly "an initial value the user may change": a stored user value
  still wins, and `storage.get()` semantics (including the `null` handling several call
  sites depend on) are untouched.
- **`_applyLocked()`** runs *after* the read and overwrites every locked key. A default
  cannot beat a stored value, and an enforced value must — including one written before
  the policy was installed.

### The write guard

**This is the point of the whole design.** `setPref()` and `setPrefs()` skip a locked key,
logging a `taLogger` warning. Silent for the caller, because no call site checks a return
value.

If an enforced value ever reached `storage.local` it would **outlive the policy**:
removing the policy would leave the user silently stuck with what it used to impose.
Skipping the write is what keeps the policy the only source of that value.

`setPrefs()` skips **per key**, not atomically: its callers seed a whole provider block at
once, and one locked key must not block the other seven or eight.

Both also skip `mztaManaged.isEnforcedConnectionControl(key)`: the `${prefix}_${field}` ids
of the feature-page connection fields a policy connection enforces. These are not preferences.
But every feature page's generic `saveOptions()` writes each `.option-input` under its id, the
injected connection panel included, so without the skip a control re-enabled by hand would
store an enforced value there. With no policy the set is empty and those writes happen as before.

The UI disabling in [`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js) is
presentation only. The guard holds even if a page forgets to call it, or a control is
re-enabled from the developer tools.

### Load ordering

`loadManaged()` is called in **exactly one place**: [`mzta-background.js`](../mzta-background.js),
after the migration block (documented as having to run first) and before
`_reconcileFeatureFlags()`, which is the first thing to read a preference.

It must **never** be triggered by importing the module. `js/mzta-prefs.js` imports
`js/mzta-managed.js`, and is itself imported by all fourteen options and settings pages —
a load-on-import would fire `browser.storage.managed.get()` on every one of them, where the
call is known to fail in Thunderbird. Hence `managedReady()` is a *function*, and
`hasLoaded()` distinguishes "the policy was read and there is none" from "the policy was
never read here".

### Hydration in every other context

`loadManaged()` fills `_values` and `_locked` in the background page only. Until 5.1 that
meant every other context resolved preferences **without** the policy: a locked field was
disabled but showed the user's old stored value, an unlocked initial value was never shown,
the API chat window (`api_webchat/controller.js`) called the provider with the stored key,
model and host instead of the policy ones, the popup offered the setup wizard to a
policy-configured profile — and the write guard was inert in pages, because
`isManagedLocked()` was always false there.

`managedReady()` therefore does one of two things:

- **background** — `_loadPromise` is set (synchronously, by the `loadManaged()` call before
  the first preference read), so it just awaits the load. It never starts anything, and so
  the background can never end up messaging itself;
- **everywhere else** — it starts `_hydrate()` once and awaits it. `_hydrate()` sends
  `{command: 'get_managed_values'}` and fills this context's copy of the whole policy from
  `{values, lockedKeys, specialPromptsText, specialPromptsConnection, orgPrompts, orgName,
  active, disablePromptManagement, disableDefaultPrompts, disableSetupWizard}`. What is
  malformed is dropped: a locked key without a value, a non-string text, a connection entry or
  field that does not have the validated shape, an org prompt that is not an object with a
  string id; a restriction is on only for a literal `true`.

This is the **only** channel a page gets the policy through. Every `mztaManaged` accessor
then answers in a page exactly as in the background: the prompt views in `js/mzta-prompts.js`
(org prompts, restrictions) and `pages/_lib/managed-ui.js` (banner, locks, restrictions) read
the hydrated module, never a second background command, so there is one answer to "is this
locked" in a page — the one the write guard acts on.

Hydration is started by the **first preference read**, never by importing the module, and
never calls `browser.storage.managed` — the reason for the import rule above does not apply
to a `sendMessage`. It lives at the choke point rather than in each page on purpose: every
page reads preferences *before* it calls `getManagedState()` (the options page restores its
inputs, the feature pages inject and restore the connection panel, the popup reads the
connection first), and the chat window and the popup never render managed controls at all.

It **fails open**: a rejection, `undefined` or a malformed reply leaves the context
unmanaged, with a `taLogger.warn()`. Nothing is retried; the background still enforces every
locked key on its own reads.

`get_managed_values` is answered by a **dedicated `runtime.onMessage` listener registered
before the first startup `await`** in `mzta-background.js` (ahead of the migration block), not
by the main listener: that one only exists after every startup `await`, and a page opened
during startup would otherwise get no answer and run unmanaged. The listener answers only once
`loadManaged()` has settled: it waits on `mztaManaged.whenLoaded()`, which resolves when the
load does **without starting it** (the load keeps its place after the migrations) and, unlike
`managedReady()`, never hydrates — so the background can never message itself. The main
listener's `default` branch returns `false`, so the two never compete. Only
extension pages are answered (`sender.url` under `runtime.getURL('')`); a content script gets
an empty payload — none of them imports `js/mzta-prefs.js`.

### Policy-supplied API keys

The previous design kept every policy value off the message channel, which also kept a
policy-supplied key out of the one context that needs it: the API chat window calls the
provider itself. The rule is now **split by page**:

| Context | Receives |
|---|---|
| the API chat window, `api_webchat/index.html` (decided by the background from a prefix match on `sender.url`) | the real key |
| every other extension page | `MANAGED_SECRET_MARKER`, exported by `js/mzta-managed.js` |

The same rule covers every `*_api_key` field of a policy connection
([`_special_prompts_connection`](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection)),
in `specialPromptsConnection`. The chat window runs a feature's connection itself (summarize in
webchat display mode: `loadPrompt()` in `api_webchat/controller.js`).

The marker is non-empty on purpose, so presence checks (`isConnectionConfigured()` in the
popup, the empty-key warnings) see a configured connection. Everything that would *use* or
*show* it refuses to:

- the password eye toggles in `pages/_lib/connection-ui.js` do nothing, and are shown as a grey
  padlock (`images/pwd-locked.svg`, class `.managed_secret`, default cursor, tooltip
  `managed_marker_tooltip`) on all four key fields while the field holds the marker or is locked
  (`syncSecretToggle()`, run from `updateWarnings()`, on `input`, and on the `mzta-managed`
  event `applyManagedUI()` dispatches on each control it locks). Typing an own key over an
  unlocked policy key brings the eye back;
- the "Fetch models" handlers return early, and the empty-key warnings keep the fetch button
  disabled. That includes the checks that do not look at the key first: the OpenAI-compatible
  host check (the key is optional there, but never the marker) and the Anthropic version
  check, which runs after `warn_Anthropic_APIKeyEmpty()` and repeats its key checks rather
  than undoing them;
- `runConnectionTest()` returns `connTest_managed_api_key` instead of sending it;
- `mztaPrefs.setPref()` / `setPrefs()` refuse to write it (per key, like the lock guard);
- the prompt storage gates (`stripTransientFlags()`, used by `setCustomPrompts()` /
  `setSpecialPrompts()`, and `preparePromptsForExport()`) drop any `*_api_key` holding it.

**The trade-off**, to be stated in the administrator documentation: on the settings pages a
user cannot reveal, test or fetch models with the organization's key. The key is still in
`policies.json`, which is readable on the machine, so this is about not *displaying* it in
the add-on, not about secrecy. An unlocked (`":locked": false`) policy key shows as the
marker until the user types their own, which is then stored and wins, per the resolution
order.

### An automatic summary is always inline

With `summarize_auto` at `2` or `3` an automatic summary is always shown inline, whatever
`summarize_display_mode` says (see `05-options.md`). A policy that sets `summarize_auto` to
`2`/`3` and also supplies `summarize_display_mode` gets `'inline'` for it, whatever it wrote,
and **the display mode takes the lock of `summarize_auto`**: enforced when `summarize_auto` is
locked, an initial value when it is `":locked": false` — whatever the display mode's own
`":locked"` said. `reconcileSummarizeDisplayMode()` in `js/mzta-managed.js` rewrites the accepted
value and lock right after validation (pass 2), with a `taLogger.warn()` naming both keys. It is
not rejected: the administrator's intent - automatic summaries - is clear, and `'webchat'` is
simply not a mode they can be shown in.

Normalised once, at load, so the resolved value is the one every reader gets, in the
background and, through hydration, in every page: the summarize page shows `'inline'` (its
`updateDisplayModeConstraint()` would force it anyway), and the context menu summarize and the
summary's refresh, which read `summarize_display_mode` directly, follow it too - just as they
follow the `'inline'` the page stores without a policy.

With an initial `summarize_auto` both keys are initial, so the user's stored values win as for
any other key, and a user who goes back to manual mode (`1`) can pick `'webchat'` again. A
display mode the policy does not supply is left alone: the user's stored value is the page's
business, as without a policy.

**The summarize page never stores a display mode derived from a policy `summarize_auto`.** Its
`updateDisplayModeConstraint()` forces the select to `'inline'` for `summarize_auto` 2/3 and, without
a policy, also stores `'inline'` - on page open too, since the context menu summarize and the
refresh read the stored value. On page open it skips that write when `summarize_auto` is
policy-supplied, locked or initial (`isPolicySuppliedPref()` in `pages/_lib/managed-ui.js`): the
`'inline'` would be derived from the policy, would replace the user's stored display mode and
outlive the policy. A change the user makes on the `summarize_auto` select is the user's own, and
stores `'inline'` as before.

## The allowlist

Derived from `Object.keys(prefs_default)`, minus four exclusion rules. Nothing else is
hardcoded — a new preference becomes policy-settable the moment it is declared.

```
Object.keys(prefs_default)
  minus  /^chatgpt_win_/        window geometry, per machine
  minus  /_enabled_accounts$/   account ids, per profile
  minus  api_webchat_font_scale local UI zoom
  minus  custom_prompts_view    custom prompts page layout, local UI
```

**137 of 146 keys** are policy-settable. The derivation already covers the generated keys:
the six `{prefix}_use_specific_integration` / `{prefix}_connection_type` pairs (from
`special_prompts_with_integration`) and the per-provider `{integration}_{key}` connection
keys (from `integration_options_config`) are all spread into `prefs_default` in
[`options/mzta-options-default.js`](../options/mzta-options-default.js).

The nine excluded keys are per-machine or per-profile state, not configuration: enforcing
them across a fleet would push window coordinates from another screen, a font zoom from
another display, a page layout the user chose for themselves, or account ids that do not
exist in this profile.

**`{feature}_enabled_accounts_match` is allowed while `{feature}_enabled_accounts` stays
excluded** (`spamfilter_…`, `add_tags_…`). The anchored `/_enabled_accounts$/` does not
catch the `_match` suffix, on purpose. The two keys hold different things: the excluded one
holds account ids (`account1`, …), which Thunderbird assigns per profile, so no fleet-wide
value can be right; the `_match` one holds names that are the same on every machine — an
identity address, a domain, `local` — and the ids are **resolved from them at read time**,
per profile, never stored. So the stored preference stays per-profile and the user's, and
the policy never has to name an id. See [Account lists by policy](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match).

## Validation

Every key is checked against the allowlist **and** against the type of its `prefs_default`
counterpart. A type mismatch is never coerced. Unknown keys, excluded keys and mismatches
are skipped with a `taLogger.warn()` and never applied.

### Content rules

A matching type is not enough: a value of the right type can still be one the add-on cannot
use, and a policy value, unlike a user's typo, breaks the feature for the whole fleet with
nothing the user can do about it. So a scalar preference whose type matched is also checked
by `prefValueProblem()` in `js/mzta-managed.js`; a value that fails is warned about (naming the
key, with an API key masked) and not applied, exactly like a type mismatch, never coerced.

| Preference | Rule |
|---|---|
| per-provider connection key `{integration}_{key}` (from `integration_options_config`) | `connectionFieldProblem(integration, key, …)`, the same rules as a field of [`_special_prompts_connection`](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection): host a URL, model not empty, temperature, thinking budget, numbers; `top_p` empty or 0–1, `top_k` empty or a non-negative integer; `extra_body`, `ollama_extra_options` and `chatgpt_text_format_schema` empty or a JSON object; `ollama_keep_alive` empty, a whole number of seconds or a Go duration (`5m`, `1h30m`); `chatgpt_max_output_tokens` 0 (not set) or ≥ 16, the input's `min`; the fixed selects of the panel (`CONNECTION_FIELD_ENUMS`: `chatgpt_verbosity`, `chatgpt_text_format`, `chatgpt_truncation`, `chatgpt_service_tier`) one of their options; `ollama_think` `''`, `'false'`, `'true'` or any lowercase word (its options depend on the model) |
| `connection_type` | one of `valid_connection_types` (`''`, "no connection yet", is not a value to enforce) |
| `{prefix}_connection_type` | one of `featureConnectionTypes()`: never `chatgpt_web`, which the feature panels do not offer |
| `reply_type`, `diff_granularity`, `summarize_display_mode`, `summarize_auto`, `translate_auto` | one of the values its settings select offers (`PREF_ENUMS`) |
| any other number | a non-negative integer; tighter ranges in `PREF_NUMBER_RANGES`, from the inputs' `min`/`max`: `spamfilter_threshold` 0–100, `max_prompt_length`, `batch_max_concurrency` ≥ 1 (`special_command_timeout`, `summarize_max_messages` and `add_tags_maxnum` have the general rule: 0 is accepted, and means "no limit" for the last two, as on their pages) |
| `calendar_timezone` | `''` (no zone enforced, the select's empty option) or a zone of `Intl.supportedValuesOf('timeZone')`, the list the calendar pages' select is built from, so the page can always show it (a lowercased id or an alias `Intl.DateTimeFormat` would accept is refused); without `supportedValuesOf()`, any id the engine accepts |

Free-text preferences (languages, sign name, prompts' extra instructions…) have no rule: any
string is usable. Provider-specific enumerations narrowed per model at runtime
(`chatgpt_reasoning_effort`, `anthropic_effort`…) are not checked either, as in
`_special_prompts_connection`: the provider's accepted values change with its models.
`ollama_think` is checked by shape only, for the same reason: a model may report levels beyond
`OLLAMA_THINK_LEVELS`, so any lowercase word is a level an administrator may enforce, and a typo
such as `"High"` is still refused. The connection panel shows such a level even when the model
does not offer it (`ensureRestorableOption()`, spec 04 Ollama).

**The one exception to "never coerced": a connection field in its former format**
(`normalizeLegacyConnectionValue()`, applied before the type check, to a preference and to a
`_special_prompts_connection` field alike). `ollama_think` was a checkbox until 5.1.0, so a
policy written for it may say `true`/`false`: they are read as `'true'`/`'false'`, the
conversion `migrateOllamaThinkLevel()` applies to the stored preference, with a warning
naming the key so the administrator can update the policy.

Array preferences (`spamfilter_skip_addresses`, `spamfilter_block_addresses`, `summarize_auto_senders_list`,
`add_tags_exclusions`; the excluded `*_enabled_accounts` too) are all **arrays of strings**,
and their consumers call string methods on the elements. An array containing a non-string
element is warned about and rejected **as a whole** — not filtered, which would be a silent
coercion.

**Exception: the `*_enabled_accounts_match` account matchers**, validated entry by entry by
`validateAccountMatchers()`. An entry that is not an account matcher — *including a
non-string one* — is skipped with a warning naming its index, and the rest still apply. The
whole-array rule exists so a list its consumers read as-is is never coerced; here every
entry is content-validated anyway, and rejecting the whole list would fail **open** (back to
the user's selection, possibly every account) for a list whose job is to limit where mail
is sent to an AI provider. For the same reason a list whose entries are all invalid is kept,
empty — "no account" — with a warning. Details in [Account lists by policy](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match).

`taLogger.warn()` is deliberate: unlike `.log()` it is **not** gated on `do_debug`, so an
administrator sees a malformed policy without having to turn on debugging first.

API key values are masked in all log output, the same rule `js/mzta-prefs.js` applies.

Validation is per key, with **one cross-key rule**: a policy `summarize_auto` of `2`/`3` turns a
policy-supplied `summarize_display_mode` into `'inline'`, with the lock of `summarize_auto` (see
[An automatic summary is always inline](#an-automatic-summary-is-always-inline)).

### The lock convention

Every key present in the policy is **enforced**. A sibling `"<key>:locked": false`
downgrades it to a mere initial value the user may change. A `":locked"` modifier whose
target carries no value is warned about and ignored. The `*_enabled_accounts_match` keys
are always enforced: they have no control of their own, so an initial value could never be
changed; `":locked": false` on them is warned about and ignored. A `summarize_display_mode`
reconciled with an automatic `summarize_auto` takes that key's lock instead of its own, see
[An automatic summary is always inline](#an-automatic-summary-is-always-inline).

### Structural keys

Keys starting with `_` are structures and metadata, never preferences. **No key in
`prefs_default` starts with an underscore**, so the two namespaces cannot collide.

| Key | Purpose |
|---|---|
| `_schema_version` | policy format version |
| `_org_name` | display name, for the banner and markers |
| `_org_id` | `[a-z0-9-]+`, the prompt-id namespace |
| `_org_prompts` | the fourth prompt set |
| `_special_prompts_text` | enforced text of special prompts, `{<special prompt id>: <text>}`; **enforced only**, see [08a](08a-managed-prompts.md#enforced-special-prompt-texts-_special_prompts_text) |
| `_special_prompts_connection` | per-feature connection, `{<feature prefix>: {api_type, <field>: value, "<field>:locked": false}}`; `api_type` always enforced, see [08b](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection) |
| `_disable_prompt_management` | restriction: no prompt creation, copy, import or export; existing custom prompts read-only and inactive |
| `_disable_default_prompts` | restriction: the built-in prompts are not available in the menus |
| `_disable_setup_wizard` | restriction: the setup wizard cannot be opened |
| `_lock_unlisted` | strict mode: every preference the policy does not set is enforced at its `prefs_default` value; on only for a literal `true`, see [Strict mode](#strict-mode-_lock_unlisted-_user_editable) |
| `_user_editable` | strict mode: array of preference keys that stay the user's; only meaningful with `_lock_unlisted: true` |

## Strict mode (`_lock_unlisted`, `_user_editable`)

Without it, a preference the policy does not name is the user's — including every preference a
later version adds, which becomes user-editable in an organization that had locked everything
it knew about. With `"_lock_unlisted": true` those preferences are enforced at their
`prefs_default` value instead, from the first start after the update.

`applyLockUnlisted()` in `js/mzta-managed.js` resolves each **allowlisted** key, in this order:

1. an excluded key (see [The allowlist](#the-allowlist)) is never touched — it is not in the
   allowlist, and strict mode only walks the allowlist;
2. a key the policy sets — locked, initial (`":locked": false`), or implied by
   `_special_prompts_connection` — keeps the policy's value and lock, unchanged. Listed in
   `_user_editable` as well, it gets a `taLogger.warn()` and the policy wins;
3. a key listed in `_user_editable` stays the user's: stored value, else `prefs_default`;
4. every other key goes into `_values` at a copy of its `prefs_default` value and into
   `_locked` — exactly the state an explicit policy value has, so the write guard, the
   read-time overlay, hydration and `applyManagedUI()` treat it identically, with no code of
   their own. The keys filled are also kept in `_lockedByDefault` (`isLockedByDefault()`).
   Storage is never touched: turning strict mode off brings every stored value back;
5. with `_lock_unlisted` absent or not `true`, nothing of the above runs: the resolution is
   exactly what it was before the key existed.

It runs **last** in `_doLoad()`, after `validateSpecialPromptsConnection()`: a
`{prefix}_use_specific_integration` filled with its default `false` before that check would make
the feature's connection entry skip itself as "explicitly switched off".

**Two exceptions**, both because the default would not mean "default" once held by the policy:

- **`*_enabled_accounts_match` are never filled.** Their `prefs_default` `[]` means "not
  managed", but a policy-held list — even an empty one — is a restriction, and `[]` means "no
  account" (`resolveEnabledAccounts()`). Enforcing the default would stop the automatic spam
  filter and Add Tags on every account. The features themselves (`spamfilter`, `add_tags`) are
  locked at their default, off.
- **An API key locked at its default reaches a page as `''`, not `MANAGED_SECRET_MARKER`.** The
  `get_managed_values` handler skips the marker for `isLockedByDefault()` keys: the value is
  `''` and secret-free, and the marker would make an empty key look configured
  (`isConnectionConfigured()` in the popup). An explicit policy key, even `""`, gets the marker
  as before.

**Validation.** `_lock_unlisted` is read by `readRestriction()`: anything but a boolean is warned
about and treated as off. `_user_editable` that is not an array is warned about and ignored,
**and strict mode falls back to off** (fails toward the existing behaviour). Each entry that is
not a string, names no preference, or names an excluded key (always user-editable, the entry
has no effect) is warned about and skipped. `_user_editable` without `_lock_unlisted: true` is
warned about as ignored.

The startup log lists the explicit preferences as before and counts the keys locked at their
default on one line, instead of listing a hundred-odd entries.

**What it cannot cover**: anything that is not a preference. The prompt stores (custom prompts,
menu order, custom placeholders, the per-feature connection override and the text of a special
prompt) are covered by `_disable_prompt_management`, `_special_prompts_text` and
`_special_prompts_connection`; a locked `{prefix}_use_specific_integration` at its default
`false` does hide a stored override (`applyLockedOffIntegrations()`). Nor does it make the
existing defaults conservative: several are on (`translate`, `get_calendar_event`, `get_task`,
`chat_show_usage_data`, `hide_thinking`), and `connection_type` defaults to `''`, so a strict
policy without a connection leaves the add-on unconfigured and the setup wizard unable to save.

## Interaction points

| Where | What |
|---|---|
| `_reconcileFeatureFlags()` ([mzta-background.js](../mzta-background.js)) | skips a locked flag. It repairs by *writing* `false`, which the guard would refuse anyway — without the skip the only effect would be a warning on every startup. A policy-enabled feature with an unusable connection stays on and does nothing: a misconfiguration for the administrator to fix, not one to override silently. |
| `storage.onChanged` ×2 ([mzta-background.js](../mzta-background.js), [options/mzta-options.js](../options/mzta-options.js)) | filter locked keys out of the changed set. A locked key cannot have meaningfully changed — the policy value shadows it on every read. |
| `hasNoConnectionSelected()`, `getConnectionType()` ([js/mzta-utils.js](../js/mzta-utils.js)) | **unchanged.** Both take values their callers already fetched through `mztaPrefs`, so a policy-supplied `connection_type` flows through on its own, and the blue setup-wizard banners in the popup, welcome page and options page stay hidden by themselves — in the pages thanks to the hydration above, which is what makes those reads see the policy at all. |
| tag dialog in [js/mzta-compose-script.js](../js/mzta-compose-script.js) | a classic content script cannot import `mztaPrefs`. It reads `add_tags_exclusions`, `add_tags_hide_exclusions`, `add_tags_exclusions_exact_match` and the lock state through the `addtags_get_exclusion_prefs` background command, and writes the list through `addtags_set_exclusions` (→ `mztaPrefs.setPref()`, so the guard applies). When `add_tags_exclusions` is locked, the per-tag "exclude" icon is not rendered at all. No content script reads preferences from storage any more. |
| `calendar_no_selection` ([js/mzta-prompts.js](../js/mzta-prompts.js)) | the behaviour used to be driven only by `need_selected` of `prompt_get_calendar_event`, written by the settings page's change listener, so a policy value showed a checked box and changed nothing. `need_selected` is now **derived** from the resolved preference on every `getSpecialPrompts()` read (never written because of the policy; see [02-prompts.md](02-prompts.md)), and the preference is in `MENU_RELEVANT_KEYS`. The page's placeholder check cannot stop a policy, so the background `taLogger.warn()`s at startup, and the page shows `prefs_OptionText_calendar_no_selection_policy_missing_placeholder` when the key is locked on, if the prompt has neither `{%mail_text_body_or_selected%}` nor `{%mail_html_body_or_selected%}`. The one-shot `migrateCalendarNoSelection()` aligned the preference once to the stored `need_selected` (the shipped one when no calendar prompt is stored), so no unmanaged user changed behaviour on upgrade. |
| per-feature provider override ([js/mzta-prompts.js](../js/mzta-prompts.js), [pages/_lib/connection-ui.js](../pages/_lib/connection-ui.js)) | the override lives in the special prompt (`api_type` + `{integration}_{key}`), not in a preference, so locking `{prefix}_use_specific_integration` to `false` did not stop an override saved before the policy: `getConnectionType()` and `initWorker()` still honoured `prompt.api_type`. `applyLockedOffIntegrations()` now hides it on every `getSpecialPrompts()` read — **locked-off case only**; unmanaged profiles and `getConnectionType()` are unchanged. It is a **read-time overlay that must never be persisted**: unlike `need_selected` above, a stored `api_type: ''` would erase the user's own override, so `setSpecialPrompts()` restores the stored override fields of those prompts (`keepStoredOverrides()`) and the override returns untouched when the policy is removed. The feature page keeps the toggle off, never forces it on as mandatory, and never calls `_updatePrompt()` / `clearPromptAPI()` while locked; the background `taLogger.warn()`s at startup for each locked-off feature with a stored override. Full treatment in [04-api-integrations.md](04-api-integrations.md#when-a-policy-locks-the-override-off). |
| per-feature connection supplied by policy ([js/mzta-prompts.js](../js/mzta-prompts.js), [pages/_lib/connection-ui.js](../pages/_lib/connection-ui.js), [js/mzta-prefs.js](../js/mzta-prefs.js), the six feature pages) | `_special_prompts_connection` is overlaid by `applyPolicyConnections()`, right after the locked-off overlay (the two can never apply to the same feature), and kept out of storage by `keepStoredConnections()` in `setSpecialPrompts()` plus the transient `_connection_by_policy` marker. Each entry implies a locked `{prefix}_use_specific_integration` / `{prefix}_connection_type` pair, so `getConnectionType()` and the `prompt = null` callers follow it unchanged. The write guard also refuses the enforced `${prefix}_${field}` panel ids. The background warns at startup about every stored user value it replaces. See [Enforced per-feature connections](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection). |
| special prompt texts ([js/mzta-prompts.js](../js/mzta-prompts.js), the six feature pages) | `_special_prompts_text` is overlaid by `applyEnforcedTexts()` at the end of `getSpecialPrompts()` — the last overlay, after the three above — and kept out of storage by `keepStoredTexts()` in `setSpecialPrompts()` plus the transient `_text_by_policy` marker. The feature pages make the textarea read-only and its Save/Reset inert (`lockEnforcedPromptText()`), and the background warns at startup about missing placeholders. See [Enforced special prompt texts](08a-managed-prompts.md#enforced-special-prompt-texts-_special_prompts_text). |
| account scope of the automatic spam filter / Add Tags ([mzta-background.js](../mzta-background.js) `processEmails()`, [js/mzta-utils.js](../js/mzta-utils.js)) | `{feature}_enabled_accounts` is read as before, but the in-scope check uses `resolveEnabledAccounts()`, which substitutes the ids resolved from a policy `{feature}_enabled_accounts_match` — once per batch, never stored, and "no account" when nothing matches. See [Account lists by policy](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match). |
| sync → local migration ([js/mzta-prefs-migration.js](../js/mzta-prefs-migration.js)) | **deliberately untouched.** See below. |

### Why the migration is not guarded

The migration copies what the **user** already chose, not something the administrator
imposed, and a locked policy value wins on every read regardless — so a migrated value is
never observable while the policy is active. The residual case (a pre-5.0 profile not yet
migrated *and* a policy installed) only means the user's own prior value reappears if the
policy is later removed, which is the correct fallback anyway.

It also keeps an ordering constraint away from a module that is a one-shot destined for
deletion: `migratePrefsToLocal()` is documented as having to run **first**, before anything
reads a preference.

### There is nothing to listen to

**Thunderbird fires no change events for the `managed` storage area.** There is no live
reload: a policy edit — including a token rotation — takes effect only at the next
Thunderbird start. This is stated twice in the administrator documentation because it is
the single most surprising property of the mechanism.

## Adding a policy-settable preference

Nothing to do. Declare it in `prefs_default` as usual
([05-options.md](05-options.md#adding-a-new-preference)) and it is policy-settable, with
type validation, a working write guard and automatic UI disabling — provided it is read and
written through `mztaPrefs` and its control is an `.option-input` whose id is the key. A number
preference is accepted as a non-negative integer. These cases need a line of code:

- a value domain its type does not express - a select's options, a number range other than
  "non-negative integer", a fractional number, a format - gets an entry in `PREF_ENUMS` /
  `PREF_NUMBER_RANGES` or a rule in `prefValueProblem()` (see [Content rules](#content-rules));
- a control with its own load/save logic gets `data-mzta-pref` and `lockCompanions()` (see
  [Controls with their own load/save logic](08c-managed-ui.md#controls-with-their-own-loadsave-logic-data-mzta-pref));
- a button that changes it from outside its control (a "Reset to default") gets
  `data-mzta-companion-of="<key>"`, and its handler an early return on `isLockedKey()`;
- a classic content script cannot use `mztaPrefs`: give it a background command that does,
  as the tag dialog does.

The only decision is whether it is genuinely *configuration*. If it is per-machine or
per-profile state, add it to the exclusions in `js/mzta-managed.js` with a comment saying
why.

**Its default must be the conservative choice: feature off, nothing new sent anywhere.** Under
[strict mode](#strict-mode-_lock_unlisted-_user_editable) a new preference is enforced at its
default in every organization that opted in, from the first start after the update. A default
that turns something on enables it for that whole fleet with no way to opt out; one that cannot
be conservative has to be justified in the review. The same rule heads `prefs_default`.

A new **per-provider connection field**, a key added to `integration_options_config`, is at
once a global preference (above) and a field of [`_special_prompts_connection`](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection),
with type validation, the overlay, the storage gate and the UI lock. By hand:

- give it a content rule in `connectionFieldProblem()` if its type alone does not make a value
  usable (a URL, a number held in a string, JSON, an enumeration). The rule then applies to the
  global preference and to the per-feature field alike;
- if it is a secret, name it `*_api_key`, or the marker rules of
  [Policy-supplied API keys](#policy-supplied-api-keys) do not apply to it;
- make sure the connection panel names its input `${modelId_prefix}${integration}_${key}`,
  like the others, or `applyManagedUI()` cannot find it.

A new **feature** with a specific integration, a prefix added to
`special_prompts_with_integration`, is accepted as a key of `_special_prompts_connection`
automatically. By hand: its prefix → prompt ids in `getActiveSpecialPromptsIDs()` (which the
overlays read), the page guard of [The connection panel](08b-managed-connections.md#the-connection-panel) on its page, and an entry in
`tests/helpers/feature-pages.mjs`, which `tests/managed/10h` requires.

Either way the administrator key reference on micz.it is now out of date — it is generated
from `prefs_default` by hand, so a new or newly excluded preference has to be reflected
there too. So do the "137 of 146" count in [The allowlist](#the-allowlist) and the counts in
`tests/managed/04-allowlist-derivation.test.mjs`, which fails until they are updated.

## Adding a restriction

Different from adding a preference, and more work — there is no allowlist to fall into.

1. A new `_`-prefixed constant and a `case` in pass 1 of `_doLoad()`, reading through
   `readRestriction()`.
2. Backing state, an accessor, and a line in the `_active` expression.
3. A field in the `get_managed_values` reply, read back in `_hydrate()` (on only for a
   literal `true`), plus a field in `getManagedState()` and a synchronous accessor in
   `managed-ui.js`.
4. An explicit guard at every site it covers — including any that can be reached by direct
   URL — plus a visible explanation at each, or the missing control reads as a bug.
5. If it hides or disables **user data** rather than a control: mark the data, never filter
   it out of a list that some page writes back to storage, and make sure the mark cannot be
   persisted. See [`_disable_prompt_management`](08a-managed-prompts.md#_disable_prompt_management) — a restriction that filters the wrong
   list does not restrict the user's prompts, it deletes them.
6. A policy fixture and a test file for it in `tests/` — see [Testing](#testing).

Prefer a locked preference whenever one would do. Reach for a restriction only when there
is genuinely no user-facing setting to lock.

## Testing

This file is the contract the automated suite in [`tests/`](../tests/) checks, at two levels:

```sh
node --test "tests/**/*.test.mjs"   # level 1: the modules; Node 22+, nothing to install
npm ci                              # once: installs jsdom (Node ^22.22.2 || ^24.15.0 || >=26)
npm test                            # both levels
```

Run from the repository root. CI runs level 1 **before** installing anything, then
`npm ci && npm test`, on demand only: by hand (`workflow_dispatch`, any branch) or when the
`run-tests` label is added to a pull request, which the run then removes
(`.github/workflows/tests.yml`). How it
works: [`tests/README.md`](../tests/README.md); how to add a managed scenario or a page:
[`tests/managed/README.md`](../tests/managed/README.md).

- **Level 1** (`tests/managed/*.test.mjs`) imports the shipped modules as they are.
- **DOM** (`tests/dom/<page>/*.dom.mjs`) loads each page's real HTML file and real module
  script in jsdom - the project's only dependency, a pinned dev dependency, never shipped and
  never imported by runtime code - with the page's background answered by the real
  background code: the `get_managed_values` listener, the one channel a page gets the policy
  through, is cut out of `mzta-background.js` and run verbatim. The browser
  mock throws on (and records) any API it does not model, so a page the harness cannot run
  fails instead of silently passing fewer tests.

**One file per policy scenario** - per page and scenario for the DOM tests. `mztaManaged` is
a singleton that reads the policy once, so each file is one extension context with one policy
(`tests/fixtures/`), and `node --test` runs each in its own process. A second context, such
as the background seen from a page, Thunderbird restarted without the policy, or the
unmanaged baseline of a page, comes from a separate module instance or a worker thread
(`tests/helpers/`), never from resetting the singleton.

| Spec section | Level 1 (`tests/managed/`) | DOM (`tests/dom/<page>/`) |
|---|---|---|
| Overview: no policy, silent rejection | `01-no-policy` | `01-no-policy`, all 13 pages |
| Resolution order, log masking | `02-resolution-order` | `03-sweep-unlocked` |
| The write guard (per key, marker, no residue) | `03-write-guard` | `02-sweep-locked` (write attempts, as rendered and re-enabled by hand) |
| The allowlist, Validation (content rules too), The lock convention | `04-validation`, `04-allowlist-derivation`, `04c-value-validation`, `04d-connection-field-content` (and the DOM `13`/`14-ollama-think-level` of options and setup wizard) | `02-sweep-locked`, `03-sweep-unlocked` (generated from the allowlist) |
| Hydration, Policy-supplied API keys, Load ordering | `05a`-`05g` | `options/05-secrets-locked`, `options/06-secrets-unlocked` |
| Locked model selects | - | `options/07-locked-model`, `setup-wizard/07-locked-model` |
| No seeding from policy values | - | `spamfilter/05-no-seeding-from-policy` |
| A locked per-feature connection type | - | `<feature>/02-sweep-locked`, `spamfilter/06-locked-connection-type` |
| An automatic summary is always inline | `09` | `summarize/02-sweep-locked` (`expected`), `summarize/18`-`20` (no display mode stored from a policy `summarize_auto` on page open) |
| Organization prompts | `06a-org-prompts`, `06b-org-prompts-*`, `12-org-prompts-never-stored` | - |
| Enforced special prompt texts (and its UI) | `06c`-`06e` | `<feature>/07-special-prompts-text`, `get-calendar-event/08-…-calendar-named` |
| Enforced per-feature connections (and its UI) | `10a`-`10i` (validation, malformed, resolution and `initWorker()`, conflicts, never persisted / export / write guard / removal, hydration, webchat, feature-page coverage, the chat window's connection and configuration checks) | `<feature>/13-connection-enforced`, `<feature>/14-connection-unlocked` (generated from `tests/helpers/feature-pages.mjs`) |
| Restrictions | `06f`-`06i` | `customprompts/10`, `customprompts/11`, `menu_order/10`, `<page>/10-disable-setup-wizard` (popup, onboarding, options, setup-wizard) |
| Account lists by policy (and the account checkboxes) | `07a`, `07b` | `spamfilter/08`, `spamfilter/09`, `addtags/08`, `addtags/09` |
| Interaction points: per-feature provider override | `08-provider-override-locked-off` | - |
| Strict mode | `13a`-`13f` (all keys at default, exceptions, restore on removal, marker-free keys; explicit / initial / implied keys win; `_user_editable`; malformed keys; `false`) | `options/15-lock-unlisted`, `summarize/21-lock-unlisted` |
| The connection mode | `12b-specific-integration-mode` | `<feature>/17-locked-on-switch` (generated from `tests/helpers/feature-pages.mjs`) |
| UI: controls (a Tom Select disabled too), `data-mzta-pref`, marker placement and inertness | - | `02-sweep-locked`, `03-sweep-unlocked`, `<page>/04-respect-managed` |
| The setup wizard | - | `setup-wizard/02`, `03`, `04-locked-provider`, `07`, `10` |
| UI: the banner | - | `options/11`, `options/12`, `setup-wizard/11`, `setup-wizard/12` (with and without `_org_name`) |

The allowlist sweep is generated, not hand-written: for every page with managed controls it
locks - or offers as an initial value - every allowlisted key that has an `.option-input` or
`[data-mzta-pref]` control there, and compares the result with the same page opened without a
policy. A new preference with a control on one of those pages is covered the moment it is
declared.

`04-allowlist-derivation` also checks the **137 of 146** count in [The allowlist](#the-allowlist).
When a preference is added, update that sentence and the test's expected count together.

**Not covered:** the parts of `mzta-background.js` that only run inside its startup - the
startup warnings and `processEmails()` - which are tested only through the functions they
call, and by hand in Thunderbird. Moving or restructuring the cut-out listener means updating
the locators in `tests/helpers/background-handler.mjs`. Nor is real layout: jsdom has none, so
the DOM tests check where a marker is inserted, not the `mzta-design.css` flex overrides that
make it look right (see [Marker placement and inertness](08c-managed-ui.md#marker-placement-and-inertness)).

**Rule:** a change to anything this file describes comes with a scenario for it. Tests are
written from this file, not from the code: a failing test is reported as a potential bug
against the section it contradicts, and never fixed by changing the source to match the
test. Until the maintainer fixes the code (or rules the behaviour correct and updates this
file), such a test keeps its assertion but runs as a node:test **TODO**, with the reason in
`tests/helpers/known-issues/managed.mjs`: it is printed on every run without failing it, and fails
the run as soon as it passes, so the entry is removed with the bug.
