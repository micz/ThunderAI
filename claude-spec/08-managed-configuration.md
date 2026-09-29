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
  `{command: 'get_managed_values'}` and fills `_values` / `_locked` / `_specialPromptsText`
  from `{values, lockedKeys, specialPromptsText}` (a locked key without a value is dropped;
  a non-string text is dropped).

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
right after `loadManaged()`** in `mzta-background.js`, not by the main listener: that one only
exists after every startup `await`, and a page opened during startup would otherwise hydrate
empty. The main listener's `default` branch returns `false`, so the two never compete. Only
extension pages are answered (`sender.url` under `runtime.getURL('')`); a content script gets
an empty payload — none of them imports `js/mzta-prefs.js`.

### Policy-supplied API keys

The previous design kept every policy value off the message channel, which also kept a
policy-supplied key out of the one context that needs it: the API chat window calls the
provider itself. The rule is now **split by page**:

| Context | Receives |
|---|---|
| `api_webchat/` (decided by the background from `sender.url`) | the real key |
| every other extension page | `MANAGED_SECRET_MARKER`, exported by `js/mzta-managed.js` |

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

### Locked model selects

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

### No seeding from policy values

The six feature pages pre-fill their per-feature connection fields
(`{prefix}_{integration}_{key}`, and `{prefix}_connection_type`) from the global value when
the special prompt has none, and `initializeSpecificIntegrationUI()` writes those fields into
the prompt with `_updatePrompt()` — **on page open** when the specific integration is on. The
custom prompts editor does the same into `_custom_prompt`. These are prompt properties, not
preferences, so no write guard stands in the way: a seeded policy value would outlive the
policy, and a seeded marker would be sent to the provider as the key.

So a seed never comes from a policy-supplied value: `seedFromGlobal(prefs, key)` in
`pages/_lib/managed-ui.js` returns `prefs_default[key]` when `mztaManaged.hasManagedValue(key)`
and `prefs[key]` otherwise — exactly the previous behaviour with no policy. Any new code that
copies a global preference into a prompt must go through it.

### A locked per-feature connection type

A feature page's `restoreOptions()` normally shows the special prompt's `api_type` in its
`{prefix}_connection_type` select, or a seed from the global connection when the prompt has
none: the prompt is the source of truth for that select. A **locked** `{prefix}_connection_type`
is the exception, on all six pages: the select keeps the enforced value `getAllPrefs()`
resolved, because that is what runs — `getConnectionType()` reads the per-feature preference
before the prompt's `api_type`. The test is `isEnforcedPref(key)` in `pages/_lib/managed-ui.js`,
the synchronous `mztaManaged.isManagedLocked()`, usable before `applyManagedUI()` because the
preference read has already hydrated the policy. An initial (`":locked": false`) value changes
nothing: the page shows exactly what it shows without a policy.

The enforced value never reaches the prompt either: `_updatePrompt()` in
`initializeSpecificIntegrationUI()` leaves `prompt.api_type` as it is while the key is locked,
for the reason in [No seeding from policy values](#no-seeding-from-policy-values). The
page-open block that copies the prompt's `api_type` into the preference is stopped by the
per-key write guard of `setPrefs()`, as before.

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

**103 of 112 keys** are policy-settable. The derivation already covers the generated keys:
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
the policy never has to name an id. See [Account lists by policy](#account-lists-by-policy-_enabled_accounts_match).

## Validation

Every key is checked against the allowlist **and** against the type of its `prefs_default`
counterpart. A type mismatch is never coerced. Unknown keys, excluded keys and mismatches
are skipped with a `taLogger.warn()` and never applied.

Array preferences (`spamfilter_skip_addresses`, `summarize_auto_senders_list`,
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
empty — "no account" — with a warning. Details in [Account lists by policy](#account-lists-by-policy-_enabled_accounts_match).

`taLogger.warn()` is deliberate: unlike `.log()` it is **not** gated on `do_debug`, so an
administrator sees a malformed policy without having to turn on debugging first.

API key values are masked in all log output, the same rule `js/mzta-prefs.js` applies.

### The lock convention

Every key present in the policy is **enforced**. A sibling `"<key>:locked": false`
downgrades it to a mere initial value the user may change. A `":locked"` modifier whose
target carries no value is warned about and ignored. The `*_enabled_accounts_match` keys
are always enforced: they have no control of their own, so an initial value could never be
changed; `":locked": false` on them is warned about and ignored.

### Structural keys

Keys starting with `_` are structures and metadata, never preferences. **No key in
`prefs_default` starts with an underscore**, so the two namespaces cannot collide.

| Key | Purpose |
|---|---|
| `_schema_version` | policy format version |
| `_org_name` | display name, for the banner and markers |
| `_org_id` | `[a-z0-9-]+`, the prompt-id namespace |
| `_org_prompts` | the fourth prompt set |
| `_special_prompts_text` | enforced text of special prompts, `{<special prompt id>: <text>}`; **enforced only**, see [below](#enforced-special-prompt-texts-_special_prompts_text) |
| `_disable_prompt_management` | restriction: no prompt creation, copy, import or export; existing custom prompts read-only and inactive |
| `_disable_default_prompts` | restriction: the built-in prompts are not available in the menus |
| `_disable_setup_wizard` | restriction: the setup wizard cannot be opened |

### Restrictions

The last three are **restrictions**: policy-only switches that take something away rather
than set a value. They are structural keys, not entries in `prefs_default`, because there
is no user-facing setting behind them — nothing to show in the options page, nothing to
store in `storage.local`, and therefore nothing for the lock convention to act on. A
restriction is simply on (`true`) or absent.

`readRestriction()` accepts only a boolean. `false` is allowed, and means the same as
absent, so an administrator can write the key out explicitly. Anything else is warned about
and treated as off — never coerced, because a restriction silently misread as *on* would
lock a fleet out of its own prompts.

A policy that only restricts — no preference, no prompt — still counts as **active**: the
banner and the disabled controls have to be explained.

They travel to pages in the `get_managed_state` payload as `disablePromptManagement`,
`disableDefaultPrompts` and `disableSetupWizard`. They cannot ride in `lockedKeys`, which holds preference keys.

#### `_disable_prompt_management`

The organization takes prompt management away entirely: nothing can be created, copied,
imported or exported, and the user's **existing** prompts become read-only and stop being
available anywhere they could be invoked. Built-in and organization prompts are untouched —
they remain fully usable, which is the point: the user keeps working, with the prompt set
the organization decided on.

Export is included on purpose — an exported file carries the prompt bodies, and with
*include API settings* it can carry provider credentials too, so an organization that locks
prompt management does not want that file produced either.

**The user's prompts are never deleted.** They stay in `_custom_prompt`, are still listed
(read-only, with an explanation) on both prompt pages, are still saved, and come back
exactly as they were the moment the policy is lifted.

##### Where it is enforced

| Site | Treatment |
|---|---|
| `pages/customprompts/` `btnNew` ("New prompt") | disabled in place |
| `pages/customprompts/` `#import_export` | **hidden** rather than greyed — a greyed Export/Import pair invites clicking. `#managed_restriction_note` is revealed in its place, so the missing buttons read as policy, not as a bug |
| `pages/customprompts/` detail editor and row menu | the user's own prompts are `rowState().locked`: every field is read-only, Save/Delete are not offered and the banner shows `customPrompts_policy_inert_note`; **Duplicate / Duplicate and edit / Export are disabled on every prompt**, built-in and org included, because a copy always produces a new prompt |
| `pages/menu_order/` rows | dimmed, undraggable, badged `menu_order_badge_policy_inactive` |
| menus, popup, `loadPrompt()` | filtered out by `getPrompts()` |
| `exportPrompts()`, `importPrompts()`, `duplicatePrompt()`, `startNewPrompt()`, `commitDetail()` (new mode), `deletePrompt()` | early-return guards — the control being disabled or out of sight is not the same as the action being unavailable |

This is also why that page uses `pages/_lib/managed-ui.js` instead of its own raw
`sendMessage`: it needs the restriction accessors, and the state belongs in one cache. The
page captures it once into `prompt_mgmt_disabled` before the first row renders, because the
List.js row template is synchronous and cannot await.

##### The three prompt views, and why the filter is not global

`js/mzta-prompts.js` builds the merged prompt set once in `buildPromptSet()`, which
**marks** the three reasons a prompt can be inactive instead of dropping them:
`_shadowed_by_org`, `_inert_by_policy` and `_default_inert_by_policy`. Three views sit on
top of it:

| View | Drops inactive? | Special prompts | Used by |
|---|---|---|---|
| `getPrompts()` | yes | per arguments | menus, popup, `loadPrompt()` |
| `getPromptsForManagement()` | no | no | `pages/customprompts/`, import, export |
| `getPromptsForMenuOrder()` | no | yes | `pages/menu_order/`, `migrateMenuOrderAlphabetic()` |

The split is a **data-safety rule, not a style choice**. Both prompt pages rewrite the
whole `_custom_prompt` store from the list they were handed, so a prompt missing from that
list is a prompt *deleted* on the next Save. Filtering inside `getPrompts()` alone would
therefore have made the menu order page erase every custom prompt the moment a user
reordered anything under the policy. Any future caller that writes back to storage must
use a non-dropping view for the same reason.

All three flags describe the *current* policy state, never the
prompt, so they must not be persisted: a stored `_inert_by_policy` would outlive the policy
that set it. They are stripped in `setCustomPrompts()` and `setSpecialPrompts()` — the two
gates into storage — and in `preparePromptsForExport()`, so a backup restored elsewhere
carries no stale policy state.

The restriction fails **open**: `isPromptManagementDisabled()` in `js/mzta-prompts.js`
returns `false` on any error, matching `managed-ui.js`. A restriction misread as *on* would
make the user's own prompts vanish from every menu, which is far worse than one briefly not
applied — the policy is re-read at the next start anyway.

Custom *data placeholders* are deliberately **not** covered. They are text fragments, not
prompts, and carry no provider credentials — a separate restriction can be added if an
organization ever asks for one.

#### `_disable_default_prompts`

The organization takes the **built-in** prompts out of the menus. They stop being available
anywhere they could be invoked — popup, reading, composing and context menus, `loadPrompt()`
by id — while staying listed, read-only and explained, on both prompt pages.

It is meant for an organization that ships its own prompt set through `_org_prompts` and
wants only that set to be reachable. It is fully independent of `_disable_prompt_management`:
the two cover **disjoint** sets of prompts — the built-in ones here, the user's own ones
there — and can be on together, each with its own explanation.

What it does **not** touch:

- **special prompts** (Add Tags, Summarize, Translate, Spam Filter, Calendar Event, Task).
  They back features of their own, which stay switched on. They carry `is_default: "1"` as
  well, because their display properties are stored the same way, so `isBuiltInDefaultPrompt()`
  tests `is_default === '1' && is_special !== '1'` — a plain `is_default` check would
  silently disable those features too.
- the user's own prompts, and the organization's.

##### Where it is enforced

| Site | Treatment |
|---|---|
| menus, popup, `loadPrompt()` | filtered out by `getPrompts()` |
| `pages/customprompts/` rows | already read-only as built-ins; dimmed in the list (`.is_dimmed`), with `customPrompts_policy_default_inert_note` in the detail editor's banner and `#managed_restriction_defaults_note` once for the page — without them a prompt that has silently vanished from every menu reads as a bug |
| `pages/menu_order/` rows | dimmed, undraggable, badged `menu_order_badge_policy_inactive` (shared with the restriction above: "Disabled by policy" is exactly right for both) |

The built-in prompts are **kept in the merged set**, never filtered out of it, for the same
data-safety reason as above: `pages/menu_order/` rewrites `_default_prompts_properties` from
the list it was handed, so dropping them would erase the user's menu positions and custom
icons on the next Save. `_default_inert_by_policy` rides in `TRANSIENT_PROMPT_FLAGS`, so it
cannot be persisted. (`setDefaultPromptsProperties()` needs no change — it writes an
explicit whitelist of fields, so no transient flag can leak through it.)

Fails **open**, like the restriction above: `areDefaultPromptsDisabled()` in
`js/mzta-prompts.js` returns `false` on any error, because a restriction misread as *on*
would empty the menus of an unmanaged installation.

#### `_disable_setup_wizard`

The wizard writes connection preferences as the user steps through it, and the write guard
only covers the keys the policy actually locks. So this is enforced at **four** entry
points plus the page itself:

| Site | Treatment |
|---|---|
| `options/` `btn_setup_wizard`, `btn_options_setup_wizard` | disabled in place |
| `pages/onboarding/` `wizard_banner` | hidden — it exists only to lead there |
| `popup/` `setup_wizard_prompt` | link replaced by the explanation text |
| `pages/setup-wizard/` itself | renders `#wiz_blocked` instead of the wizard |

The page check is not redundant. Every link to it is disabled, so reaching the wizard means
it was opened by its direct URL; the check runs before anything is built or injected.

The popup case is the odd one: that panel replaces the prompt list when no connection is
configured, so it cannot simply be hidden. The link text becomes the explanation, so the
user learns the connection is configured centrally rather than clicking a dead end.

`openSetupWizard()` in the options page also returns early — a restriction must not depend
on a control staying disabled.

## Organization prompts

Full treatment in [02-prompts.md](02-prompts.md#organization-prompts-the-fourth-set). The
parts that belong here:

**Ids are composed, not taken verbatim**: `org_<_org_id>_<id>`. `_org_id` may not contain
an underscore, or `org_acme_foo_bar` would be ambiguous between org `acme`/prompt `foo_bar`
and org `acme_foo`/prompt `bar` — and two organizations could collide through that
ambiguity. Without a valid `_org_id` the whole prompt set is refused rather than given
ambiguous ids.

Because every composed id starts with `org_` and every shipped id starts with `prompt_`,
collision with a built-in is **structurally impossible** and is not checked for.

**A colliding custom prompt is shadowed, not rejected.** If the user owns a prompt with an
org prompt's id, the org prompt wins wherever a prompt can be invoked. The reverse would
let a user disable an organization prompt just by creating one with its id, with nothing
visible to explain the disappearance. The user's prompt is **not** deleted — it stays in
`_custom_prompt`, is still saved, and returns when the policy stops supplying that id.

This is deliberately **not** paired with UI validation forbidding an `org_` prefix: that
would be bypassable by writing to storage directly, adds nothing to a runtime rule that is
not, and would forbid a prefix a user may already be using legitimately.

## Enforced special prompt texts (`_special_prompts_text`)

Replaces and enforces the **text** of special prompts (Spam Filter, Add Tags, Summarize,
Translate, Calendar Event, Task). Neither of the other two mechanisms can do it: the text
lives in `_special_prompts`, not in `prefs_default`, so the allowlist cannot reach it, and
`_org_prompts` only creates new `org_<org_id>_*` prompts.

```json
"_special_prompts_text": {
  "prompt_spamfilter": "… {%mail_html_body%} … {\"explanation\": …, \"spamValue\": …}"
}
```

**Enforced only — there is no `:locked` variant.** There is no preference behind a prompt
text, so nothing for the lock convention to downgrade to an initial value. A
`"_special_prompts_text:locked"` key is warned about and ignored; the texts stay enforced.
Only the text is covered: every other property of the special prompt (icon, menu visibility,
provider override) stays the user's.

### Validation

`validateSpecialPromptsText()` in [`js/mzta-managed.js`](../js/mzta-managed.js), same style
as `validateOrgPrompts()`: the value must be a plain object, and each entry is checked on its
own — an invalid one is skipped with a `taLogger.warn()` naming it, the rest still apply.

- the key must be the id of an entry in `specialPrompts` ([js/mzta-prompts.js](../js/mzta-prompts.js),
  `getSpecialPromptIds()`), **including the non-menu ones**: `prompt_summarize_email_template`,
  `prompt_summarize_email_separator` and `prompt_get_calendar_event_from_clipboard`;
- the value must be a non-empty string, and not whitespace only — except
  `prompt_summarize_email_separator`, for which whitespace is a legitimate text;
- the text must satisfy the **response contract** below.

`js/mzta-prompts.js` owns the ids and the contract; `mzta-managed.js` imports it
**dynamically** inside `_doLoad()`, because `mzta-prompts.js` statically imports
`mzta-managed.js`.

The calendar page edits `prompt_get_calendar_event` and `…_from_clipboard` through **one**
textarea and always saves both. So an enforced `prompt_get_calendar_event` also applies to
the clipboard variant, unless the policy names that id too (even with an invalid value — an
administrator who named it did not ask for the copy).

### Output-format safety: the response contract

Every special prompt whose answer is parsed carries its output format **inside the text**
(`prompt_spamfilter_full_text` itself asks for `{"explanation", "spamValue"}`); the code
only appends extras (`finalizePrompt_add_tags()`: tag count, language, allowed list). An
administrator's text without that format would silently break the parser for the whole
fleet, and the user could do nothing about it — which is the difference from the same
mistake made by a user on their own feature page.

The chosen approach is **validate and reject**, not "move the format into code":

- moving the format out of the text would change the text every user edits today, need a
  migration of every stored user text (which already contains the format) and new
  translatable strings — a behaviour change for unmanaged users, which this mechanism must
  never cause;
- rejecting keeps the feature working: the user's own text stays in effect, and the
  warning tells the administrator exactly which field is missing. Enforcing and warning
  would have left a fleet with a feature that fails on every message.

`SPECIAL_PROMPT_TEXT_CONTRACT` in `js/mzta-prompts.js`, checked by `checkSpecialPromptText()`:

| Id | `responseKeys` (reject if missing) | Message placeholder (warn if missing) |
|---|---|---|
| `prompt_spamfilter` | `spamValue`, `explanation` | any body placeholder¹, or none at all² |
| `prompt_add_tags` | `tags` | any body placeholder¹, or none at all² |
| `prompt_get_calendar_event`, `…_from_clipboard` | `startDate`, `endDate`, `summary` | `selected_text`, `selected_html` or a body placeholder¹, or none at all² |
| `prompt_get_task` | `summary` | as calendar |
| `prompt_translate_this` | `subject`, `body`, `status` | `mail_html_body` or `mail_text_body`, **and** `thunderai_translate_lang` |
| `prompt_summarize_email_template` | — | any body placeholder¹, or none at all² |
| `prompt_summarize`, `prompt_summarize_email_separator` | — | — (free text) |

¹ `mail_text_body`, `mail_html_body`, `mail_text_body_or_selected`, `mail_html_body_or_selected`.
² `preparePrompt()` appends the message itself to a text with no placeholder at all.
`buildTranslationPrompt()` never appends, hence the stricter translate row.

A response key is matched as a whole, case-sensitive word — the parser's property access. It
is a heuristic: it catches the likely mistake (an instruction rewritten without its output
format), not a subtly malformed one. Only the keys without which the result is unusable are
listed; the ones the shipped text itself calls optional (location, description,
attendees…) are not. Every shipped text passes the contract.

### Application: a read-time overlay, never persisted

`applyEnforcedTexts()` runs at the end of `getSpecialPrompts()`, after
`applyCalendarNoSelection()` and `applyLockedOffIntegrations()`: it replaces `text` and sets
`_text_by_policy: true`. In pages the texts arrive with the hydration
(`specialPromptsText` in the `get_managed_values` reply), and the overlay awaits
`managedReady()`, so every context sees the same text.

It must **never** reach storage: the feature pages rewrite the whole `_special_prompts`
array, and a stored enforced text would replace the user's own and outlive the policy. Two
gates, as for the provider override:

- `_text_by_policy` is in `TRANSIENT_PROMPT_FLAGS`, so `setSpecialPrompts()` and
  `preparePromptsForExport()` strip it;
- `setSpecialPrompts()` runs `keepStoredTexts()`: for every enforced id it puts back the
  **stored** text, or the shipped (i18n) text for a prompt never stored — what
  `getSpecialPrompts()` would have handed out without the policy. The decision is by id,
  from `mztaManaged`, synchronously, not by the marker, so it holds even for a caller that
  dropped the marker. Before `loadManaged()` (the migration block) nothing is enforced and
  it is a no-op.

Removing the policy therefore restores the user's text **exactly**, including a legacy
stored value that is still the raw i18n key.

### UI

`lockEnforcedPromptText(textarea, promptIds, companions)` in
[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), called by each of the six feature
pages after it has filled the textarea and set its buttons' initial state (summarize: three
times, one per textarea; calendar: with both calendar ids). It follows [Controls with their
own load/save logic](#controls-with-their-own-loadsave-logic-data-mzta-pref), without a
preference key:

- the textarea already shows the enforced text (the overlay), and becomes **`readOnly`**,
  not disabled, so the text can still be scrolled, selected and copied — a user may want to
  start a custom prompt from it; it gets `data-mzta-managed="1"` and the
  `managed_prompt_text_tooltip` title. `#mzta_card .editor-wrap .editor[data-mzta-managed="1"]`
  in `mzta-design.css` hides the caret, since no `:disabled` styling applies;
- the Save and Reset buttons are disabled and marked like `lockCompanions()` does;
- the marker, padlock included, goes right of the group title heading the textarea's
  `.mzta_field` (see "Group titles win over the column" below) — the same placement the list
  textareas get. `markManaged()` takes the `.mzta_field` anchor explicitly: the textarea's
  own parent is the editor-highlight wrapper.

Every Save and Reset handler also **returns early** on `isEnforcedPromptText(id)` (the
calendar Save on either calendar id). Both helpers read `mztaManaged` after hydration, not
the `get_managed_state` payload, which carries no prompt data.

### Startup warning

The feature pages' placeholder checks never see an enforced text, so the background
`taLogger.warn()`s at startup for each enforced text that fails the placeholder column of
the contract (`getEnforcedTextPlaceholderProblems()`). The text is still enforced — the
administrator asked for it, and it runs. The existing `calendar_no_selection` startup check
reads `getSpecialPrompts()`, so it covers an enforced calendar text on its own.

## Account lists by policy (`*_enabled_accounts_match`)

Lets an administrator decide which accounts the **automatic** spam filter and the
**automatic** Add Tags run on. `spamfilter_enabled_accounts` / `add_tags_enabled_accounts`
cannot be set by policy (see [The allowlist](#the-allowlist)), so each has a policy-settable
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

## Interaction points

| Where | What |
|---|---|
| `_reconcileFeatureFlags()` ([mzta-background.js](../mzta-background.js)) | skips a locked flag. It repairs by *writing* `false`, which the guard would refuse anyway — without the skip the only effect would be a warning on every startup. A policy-enabled feature with an unusable connection stays on and does nothing: a misconfiguration for the administrator to fix, not one to override silently. |
| `storage.onChanged` ×2 ([mzta-background.js](../mzta-background.js), [options/mzta-options.js](../options/mzta-options.js)) | filter locked keys out of the changed set. A locked key cannot have meaningfully changed — the policy value shadows it on every read. |
| `hasNoConnectionSelected()`, `getConnectionType()` ([js/mzta-utils.js](../js/mzta-utils.js)) | **unchanged.** Both take values their callers already fetched through `mztaPrefs`, so a policy-supplied `connection_type` flows through on its own, and the blue setup-wizard banners in the popup, welcome page and options page stay hidden by themselves — in the pages thanks to the hydration above, which is what makes those reads see the policy at all. |
| tag dialog in [js/mzta-compose-script.js](../js/mzta-compose-script.js) | a classic content script cannot import `mztaPrefs`. It reads `add_tags_exclusions`, `add_tags_hide_exclusions`, `add_tags_exclusions_exact_match` and the lock state through the `addtags_get_exclusion_prefs` background command, and writes the list through `addtags_set_exclusions` (→ `mztaPrefs.setPref()`, so the guard applies). When `add_tags_exclusions` is locked, the per-tag "exclude" icon is not rendered at all. No content script reads preferences from storage any more. |
| `calendar_no_selection` ([js/mzta-prompts.js](../js/mzta-prompts.js)) | the behaviour used to be driven only by `need_selected` of `prompt_get_calendar_event`, written by the settings page's change listener, so a policy value showed a checked box and changed nothing. `need_selected` is now **derived** from the resolved preference on every `getSpecialPrompts()` read (never written because of the policy; see [02-prompts.md](02-prompts.md)), and the preference is in `MENU_RELEVANT_KEYS`. The page's placeholder check cannot stop a policy, so the background `taLogger.warn()`s at startup, and the page shows `prefs_OptionText_calendar_no_selection_policy_missing_placeholder` when the key is locked on, if the prompt has neither `{%mail_text_body_or_selected%}` nor `{%mail_html_body_or_selected%}`. The one-shot `migrateCalendarNoSelection()` aligned the preference once to the stored `need_selected`, so no unmanaged user changed behaviour on upgrade. |
| per-feature provider override ([js/mzta-prompts.js](../js/mzta-prompts.js), [pages/_lib/connection-ui.js](../pages/_lib/connection-ui.js)) | the override lives in the special prompt (`api_type` + `{integration}_{key}`), not in a preference, so locking `{prefix}_use_specific_integration` to `false` did not stop an override saved before the policy: `getConnectionType()` and `initWorker()` still honoured `prompt.api_type`. `applyLockedOffIntegrations()` now hides it on every `getSpecialPrompts()` read — **locked-off case only**; unmanaged profiles and `getConnectionType()` are unchanged. It is a **read-time overlay that must never be persisted**: unlike `need_selected` above, a stored `api_type: ''` would erase the user's own override, so `setSpecialPrompts()` restores the stored override fields of those prompts (`keepStoredOverrides()`) and the override returns untouched when the policy is removed. The feature page keeps the toggle off, never forces it on as mandatory, and never calls `_updatePrompt()` / `clearPromptAPI()` while locked; the background `taLogger.warn()`s at startup for each locked-off feature with a stored override. Full treatment in [04-api-integrations.md](04-api-integrations.md#when-a-policy-locks-the-override-off). |
| special prompt texts ([js/mzta-prompts.js](../js/mzta-prompts.js), the six feature pages) | `_special_prompts_text` is overlaid by `applyEnforcedTexts()` at the end of `getSpecialPrompts()` — third overlay, after the two above — and kept out of storage by `keepStoredTexts()` in `setSpecialPrompts()` plus the transient `_text_by_policy` marker. The feature pages make the textarea read-only and its Save/Reset inert (`lockEnforcedPromptText()`), and the background warns at startup about missing placeholders. See [Enforced special prompt texts](#enforced-special-prompt-texts-_special_prompts_text). |
| account scope of the automatic spam filter / Add Tags ([mzta-background.js](../mzta-background.js) `processEmails()`, [js/mzta-utils.js](../js/mzta-utils.js)) | `{feature}_enabled_accounts` is read as before, but the in-scope check uses `resolveEnabledAccounts()`, which substitutes the ids resolved from a policy `{feature}_enabled_accounts_match` — once per batch, never stored, and "no account" when nothing matches. See [Account lists by policy](#account-lists-by-policy-_enabled_accounts_match). |
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

## UI

[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), shared by the options page, the
six feature settings pages and the setup wizard. One `sendMessage` round trip per page for
the page state (the values travel separately, in the hydration round trip):

```javascript
browser.runtime.sendMessage({ command: 'get_managed_state' })
// -> { active, orgName, lockedKeys, disablePromptManagement, disableDefaultPrompts, disableSetupWizard }
```

**No page ever calls `browser.storage.managed` itself**, and `runtime.getBackgroundPage()`
is not used.

Note what the payload does **not** carry: the managed *values*. Those reach the page through
the normal preference read, because `js/mzta-prefs.js` hydrates them on the first read (see
[Hydration in every other context](#hydration-in-every-other-context)); a policy-supplied API
key arrives only as `MANAGED_SECRET_MARKER`. So an input restored from `mztaPrefs` already
holds the enforced or initial value by the time `applyManagedUI()` disables it.

Control matching relies on the invariant `saveOptions()`/`restoreOptions()` already depend
on: **an `.option-input` element's `id` IS its preference key.** So no mapping table is
needed. The implementation walks the controls once testing against a `Set`, rather than
running a selector per locked key — an id-suffix selector would also catch unrelated
controls whose id merely ends with the key (`translate` would match `auto_translate`).

`applyManagedUI()` must run **after** the connection panel has injected its provider rows,
and after `restoreOptions()` has populated the inputs.

### Controls with their own load/save logic: `data-mzta-pref`

Some preferences are edited by a control that must **not** be an `.option-input`, because
`saveOptions()` / `restoreOptions()` would then handle it generically and break its own
serialisation: `spamfilter_skip_addresses`, `summarize_auto_senders_list` and
`add_tags_exclusions` (textareas saved as normalised lists by their Save buttons), and
`spamfilter_skip_addressbook` (a checkbox whose change handler requests the `addressBooks`
permission). They opt in explicitly with `data-mzta-pref="<preference key>"`.
`applyManagedUI()` walks `.option-input, [data-mzta-pref]` in the same single pass against the
same `Set`, taking the key from `data-mzta-pref` when present and from the `id` otherwise, and
gives the match exactly the `.option-input` treatment. `addtags_excl_list` is the one whose id
is not the key.

Their companion controls are the page's: `lockCompanions(key, elements)` marks each one
`data-mzta-managed="1"`, disables it and titles it `managed_marker_tooltip` when the key is
locked, so `setDisabledRespectingManaged()` — which the pages' "unsaved changes" input
handlers now use — keeps it disabled. Every save function, the Save click handlers and the
`spamfilter_skip_addressbook` change handler also **return early** when the key is locked, so
neither a write nor the permission prompt can be triggered from a control re-enabled in the
developer tools. `updateAutoSendersState()` on the summarize page, which reassigns `disabled`
on every `summarize_auto` change, uses the respecting setter too: it could previously
re-enable a locked `summarize_auto_senders` toggle.

The marker lands right of the textarea's group title (see "Group titles win over the
column" below; the `.mzta_field` column is only the fallback), and in the checkbox's
`.feature_row` (before the `.mzta_switch`). No new CSS was needed.

The account checkboxes of the spam filter and Add Tags pages are the same pattern with a
twist — the locked key (`*_enabled_accounts_match`) is not the one the checkboxes save — and
have their own helper, `lockAccountSelector()`; see [Account lists by policy](#account-lists-by-policy-_enabled_accounts_match).

`applyManagedUI()` covers locked *preferences* only. A restriction has no preference behind
it, and its controls are plain buttons and links rather than `.option-input` fields, so
there is an explicit counterpart: `disableForManagedRestriction()`, called at the few sites
a restriction covers. It marks the element with the same `data-mzta-managed` attribute, so
`setDisabledRespectingManaged()` keeps it disabled if page logic later reassigns
`disabled`, and applies the same `lockControl()` inertness. For an `<a>` — which has no
`disabled` property the browser honours — it also strips the `href` and adds
`.managed_disabled`.

`isPromptManagementDisabled()` and `isSetupWizardDisabled()` are synchronous, like
`isLockedKey()`: `getManagedState()` must have been awaited first. A caller that has not
gets `false`, which is the safe default for a page that could not reach the background at
all — the same fallback the rest of this module takes.

### The setup wizard

[`pages/setup-wizard/`](../pages/setup-wizard/) writes the same connection preferences as
the options page, through the same `mztaPrefs.setPref()` path, so the write guard has
always covered it. What it lacked was the presentation layer: every field was fully
editable, and a user could walk the whole wizard entering an API key the guard then
silently refused to persist — the policy held, but the UI said otherwise.

It now calls `showManagedBanner()` and `applyManagedUI()` in the same position as the
options page: after `injectConnectionUI()` and `restoreOptions()`, before the `change`
listeners are attached. The connection rows are covered for free by the
id-IS-the-preference-key invariant, and `showConnectionOptions()` only toggles `display`
on rows that already exist, so nothing is injected after the marking pass.

**The provider cards are the one wizard-specific case.** They are `<button>` elements, not
`.option-input` controls, so `applyManagedUI()` cannot reach them and a locked
`connection_type` would otherwise still be switchable by clicking a card — which dispatches
a `change` on the hidden select and drives the entire wizard onto a provider the policy
does not allow. Two guards, mirroring the toggle treatment above:

- `selectProvider()` returns early when `connection_type` is locked and the requested id
  differs from the current one. The `id !== state.provider` condition is what still lets
  the boot call through, so the enforced provider is selected and tinted normally.
- `buildProviderCards()` disables every card and adds `.wiz_provider_card_managed`. All
  cards are greyed out, including the enforced one — the policy chose it and it cannot be
  changed here either — but the selected card keeps full opacity so the administrator's
  choice stays readable.

Cards are built *after* `applyManagedUI()`, which is what populates the state
`isLockedKey()` reads synchronously.

### Marker placement and inertness

A feature toggle is an `<input type="checkbox">` visually hidden **inside**
`<label class="mzta_switch">`. Two consequences the implementation has to handle:

- **Placement.** `markManaged()` anchors on `closest('td') || closest('label') ||
  parentElement`. On the options page the feature rows are flex `div`s, not tables, so the
  label branch wins and appending would drop the badge *inside* the switch — left of the
  track and inside its click target. When the control is inside a `.mzta_switch`, the
  marker is therefore inserted **before that label**, as a sibling in `.feature_row`, so
  the row reads `… [Managed by Org] (toggle)`. One marker per host: `markManaged()` skips a
  host that already has a `.managed_marker` as a **direct child** - a marker further down
  belongs to another control (a `.mzta_field` can hold a nested switch row with its own), and
  does not say this one is locked.
- **Two layout contexts.** Wherever it lands, the marker ends up a *flex item*, and the base
  `.managed_marker` rule — an `inline-flex` chip sized by its content — is not enough on its
  own, because a flex parent's `align-items: stretch` overrides that sizing. Each context
  needs its own override in `pages/_lib/mzta-design.css`:
  - a flex **row** (`.feature_row`, marker inserted before `.mzta_switch`) — the chip must
    not stretch to the row height and needs the switch's top offset to line up with it;
  - a flex **column** (`.mzta_field`, marker appended as the last child, under the control's
    `.mzta_help` text) — without an override the chip stretches to the *full field width*,
    and `margin-inline-start`, being horizontal, gives it no separation from the help text
    above.

  Both overrides are `flex: none; align-self: flex-start` plus context-appropriate margins.
  A new field layout that hosts the marker needs the same treatment.
- **Group titles win over the column.** When the resolved anchor is a `.mzta_field`,
  `groupTitleFor()` looks for the title heading it: the field's own direct
  `.opt_title_small` (a section with several fields, e.g. the three summarize prompts), or
  else the section's `.mzta_prompt_title` when the field is the section's only direct
  `.mzta_field`. If one is found the marker is appended inside that title, i.e. right of it
  (the base inline chip, no override needed). Only when no unambiguous title exists — a
  section title over several untitled fields would not say which one is locked — does the
  marker fall back to the `.mzta_field` column above.
- **Padlock.** The badge carries a padlock glyph via `.managed_marker::before` in
  `pages/_lib/mzta-design.css`, the same one `#managed_config_banner` and
  `.managed_restriction_note` use, so every managed surface reads alike. It is CSS, not
  text, so it stays out of the localised string and out of the accessible name. The badge
  is an `inline-flex` row with `flex-wrap: nowrap`: the glyph is the icon *for* the
  label, not a word in it, and must never come apart from it.
- **Inertness.** `disabled` on the input is not sufficient on its own. `disable_ApiFeature()`
  and friends reassign `.disabled` unconditionally, and they run again from the
  `storage.onChanged` listener — i.e. *after* `applyManagedUI()`. Two defences:
  - `setDisabledRespectingManaged(element, disabled)` — the exported setter those call
    sites use instead of assigning `.disabled` directly. It ORs in
    `dataset.mztaManaged === '1'`, so a policy-locked control can never be re-enabled by
    page logic. Call sites that previously read back `.disabled` to decide **row
    visibility** were changed to test their own condition instead: a lock must grey a row
    out, never hide it. Every page-logic assignment that can run after `applyManagedUI()`
    goes through it, including `updateAnthropicModelCapabilityUI()` (the fields the selected
    model does not support), `updateDisplayModeConstraint()` on the summarize page and the
    `add_tags_auto_uselist` toggle on the Add Tags page. `disable_ApiFeature()` also leaves a
    locked flag's `checked` alone: a policy-enabled feature with an unusable connection stays
    on (see [Interaction points](#interaction-points)), so the toggle keeps showing it.
  - `lockControl()` — a capturing `click`/`keydown` swallower on the `.mzta_switch` label,
    so even a re-enabled input cannot be flipped by clicking the track or the row label.

Both are presentation only; the authoritative block remains the write guard in
`js/mzta-prefs.js`.

## Adding a policy-settable preference

Nothing to do. Declare it in `prefs_default` as usual
([05-options.md](05-options.md#adding-a-new-preference)) and it is policy-settable, with
type validation, a working write guard and automatic UI disabling — provided it is read and
written through `mztaPrefs` and its control is an `.option-input` whose id is the key. Two
cases need a line of code:

- a control with its own load/save logic gets `data-mzta-pref` and `lockCompanions()` (see
  above);
- a classic content script cannot use `mztaPrefs`: give it a background command that does,
  as the tag dialog does.

The only decision is whether it is genuinely *configuration*. If it is per-machine or
per-profile state, add it to the exclusions in `js/mzta-managed.js` with a comment saying
why.

Either way the administrator key reference on micz.it is now out of date — it is generated
from `prefs_default` by hand, so a new or newly excluded preference has to be reflected
there too. So do the "103 of 112" count in [The allowlist](#the-allowlist) and the counts in
`tests/managed/04-allowlist-derivation.test.mjs`, which fails until they are updated.

## Adding a restriction

Different from adding a preference, and more work — there is no allowlist to fall into.

1. A new `_`-prefixed constant and a `case` in pass 1 of `_doLoad()`, reading through
   `readRestriction()`.
2. Backing state, an accessor, and a line in the `_active` expression.
3. A field in the `get_managed_state` payload, and its normalisation plus a synchronous
   accessor in `managed-ui.js`.
4. An explicit guard at every site it covers — including any that can be reached by direct
   URL — plus a visible explanation at each, or the missing control reads as a bug.
5. If it hides or disables **user data** rather than a control: mark the data, never filter
   it out of a list that some page writes back to storage, and make sure the mark cannot be
   persisted. See `_disable_prompt_management` above — a restriction that filters the wrong
   list does not restrict the user's prompts, it deletes them.
6. A policy fixture and a test file for it in `tests/` — see [Testing](#testing).

Prefer a locked preference whenever one would do. Reach for a restriction only when there
is genuinely no user-facing setting to lock.

## Testing

This file is the contract the automated suite in [`tests/`](../tests/) checks, at two levels:

```sh
node --test "tests/**/*.test.mjs"   # level 1: the modules; Node 21+, nothing to install
npm ci                              # once: installs jsdom (Node 22.22+ / 24.15+)
npm test                            # both levels
```

Run from the repository root. CI runs level 1 **before** installing anything, then
`npm ci && npm test`, on every push and pull request (`.github/workflows/tests.yml`). How it
works, how to add a scenario or a page: [`tests/README.md`](../tests/README.md).

- **Level 1** (`tests/managed/*.test.mjs`) imports the shipped modules as they are.
- **DOM** (`tests/dom/<page>/*.dom.mjs`) loads each page's real HTML file and real module
  script in jsdom - the project's only dependency, a pinned dev dependency, never shipped and
  never imported by runtime code - with the page's background answered by the real
  background code: the `get_managed_values` listener and the `get_managed_state` /
  `get_org_prompts` cases are cut out of `mzta-background.js` and run verbatim. The browser
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
| The allowlist, Validation, The lock convention | `04-validation`, `04-allowlist-derivation` | `02-sweep-locked`, `03-sweep-unlocked` (generated from the allowlist) |
| Hydration, Policy-supplied API keys, Load ordering | `05a`-`05e` | `options/05-secrets-locked`, `options/06-secrets-unlocked` |
| Locked model selects | - | `options/07-locked-model`, `setup-wizard/07-locked-model` |
| No seeding from policy values | - | `spamfilter/05-no-seeding-from-policy` |
| A locked per-feature connection type | - | `<feature>/02-sweep-locked`, `spamfilter/06-locked-connection-type` |
| Organization prompts | `06a-org-prompts`, `06b-org-prompts-*` | - |
| Enforced special prompt texts (and its UI) | `06c`-`06e` | `<feature>/07-special-prompts-text`, `get-calendar-event/08-…-calendar-named` |
| Restrictions | `06f`-`06i` | `customprompts/10`, `customprompts/11`, `menu_order/10`, `<page>/10-disable-setup-wizard` (popup, onboarding, options, setup-wizard) |
| Account lists by policy (and the account checkboxes) | `07a`, `07b` | `spamfilter/08`, `spamfilter/09`, `addtags/08`, `addtags/09` |
| Interaction points: per-feature provider override | `08-provider-override-locked-off` | - |
| UI: controls, `data-mzta-pref`, marker placement and inertness | - | `02-sweep-locked`, `03-sweep-unlocked`, `<page>/04-respect-managed` |
| The setup wizard | - | `setup-wizard/02`, `03`, `04-locked-provider`, `07`, `10` |
| UI: the banner | - | `options/11`, `options/12`, `setup-wizard/11`, `setup-wizard/12` (with and without `_org_name`) |

The allowlist sweep is generated, not hand-written: for every page with managed controls it
locks - or offers as an initial value - every allowlisted key that has an `.option-input` or
`[data-mzta-pref]` control there, and compares the result with the same page opened without a
policy. A new preference with a control on one of those pages is covered the moment it is
declared.

`04-allowlist-derivation` also checks the **103 of 112** count in [The allowlist](#the-allowlist).
When a preference is added, update that sentence and the test's expected count together.

**Not covered:** the parts of `mzta-background.js` that only run inside its startup - the
startup warnings and `processEmails()` - which are tested only through the functions they
call, and by hand in Thunderbird. Moving or restructuring the cut-out handlers means updating
the locators in `tests/helpers/background-handler.mjs`. Nor is real layout: jsdom has none, so
the DOM tests check where a marker is inserted, not the `mzta-design.css` flex overrides that
make it look right (see [Marker placement and inertness](#marker-placement-and-inertness)).

**Rule:** a change to anything this file describes comes with a scenario for it. Tests are
written from this file, not from the code: a failing test is reported as a potential bug
against the section it contradicts, and never fixed by changing the source to match the
test. Until the maintainer fixes the code (or rules the behaviour correct and updates this
file), such a test keeps its assertion but runs as a node:test **TODO**, with the reason in
`tests/helpers/dom-known-issues.mjs`: it is printed on every run without failing it.
