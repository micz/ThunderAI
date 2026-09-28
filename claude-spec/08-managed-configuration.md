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
  `{command: 'get_managed_values'}` and fills `_values` / `_locked` from
  `{values, lockedKeys}` (a locked key without a value is dropped).

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

- the password eye toggles in `pages/_lib/connection-ui.js` do nothing;
- the "Fetch models" handlers return early, and the empty-key warnings keep the fetch button
  disabled;
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

**101 of 110 keys** are policy-settable. The derivation already covers the generated keys:
the six `{prefix}_use_specific_integration` / `{prefix}_connection_type` pairs (from
`special_prompts_with_integration`) and the per-provider `{integration}_{key}` connection
keys (from `integration_options_config`) are all spread into `prefs_default` in
[`options/mzta-options-default.js`](../options/mzta-options-default.js).

The nine excluded keys are per-machine or per-profile state, not configuration: enforcing
them across a fleet would push window coordinates from another screen, a font zoom from
another display, a page layout the user chose for themselves, or account ids that do not
exist in this profile.

## Validation

Every key is checked against the allowlist **and** against the type of its `prefs_default`
counterpart. A type mismatch is never coerced. Unknown keys, excluded keys and mismatches
are skipped with a `taLogger.warn()` and never applied.

Array preferences (`spamfilter_skip_addresses`, `summarize_auto_senders_list`,
`add_tags_exclusions`; the excluded `*_enabled_accounts` too) are all **arrays of strings**,
and their consumers call string methods on the elements. An array containing a non-string
element is warned about and rejected **as a whole** — not filtered, which would be a silent
coercion.

`taLogger.warn()` is deliberate: unlike `.log()` it is **not** gated on `do_debug`, so an
administrator sees a malformed policy without having to turn on debugging first.

API key values are masked in all log output, the same rule `js/mzta-prefs.js` applies.

### The lock convention

Every key present in the policy is **enforced**. A sibling `"<key>:locked": false`
downgrades it to a mere initial value the user may change. A `":locked"` modifier whose
target carries no value is warned about and ignored.

### Structural keys

Keys starting with `_` are structures and metadata, never preferences. **No key in
`prefs_default` starts with an underscore**, so the two namespaces cannot collide.

| Key | Purpose |
|---|---|
| `_schema_version` | policy format version |
| `_org_name` | display name, for the banner and markers |
| `_org_id` | `[a-z0-9-]+`, the prompt-id namespace |
| `_org_prompts` | the fourth prompt set |
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

## Interaction points

| Where | What |
|---|---|
| `_reconcileFeatureFlags()` ([mzta-background.js](../mzta-background.js)) | skips a locked flag. It repairs by *writing* `false`, which the guard would refuse anyway — without the skip the only effect would be a warning on every startup. A policy-enabled feature with an unusable connection stays on and does nothing: a misconfiguration for the administrator to fix, not one to override silently. |
| `storage.onChanged` ×2 ([mzta-background.js](../mzta-background.js), [options/mzta-options.js](../options/mzta-options.js)) | filter locked keys out of the changed set. A locked key cannot have meaningfully changed — the policy value shadows it on every read. |
| `hasNoConnectionSelected()`, `getConnectionType()` ([js/mzta-utils.js](../js/mzta-utils.js)) | **unchanged.** Both take values their callers already fetched through `mztaPrefs`, so a policy-supplied `connection_type` flows through on its own, and the blue setup-wizard banners in the popup, welcome page and options page stay hidden by themselves — in the pages thanks to the hydration above, which is what makes those reads see the policy at all. |
| tag dialog in [js/mzta-compose-script.js](../js/mzta-compose-script.js) | a classic content script cannot import `mztaPrefs`. It reads `add_tags_exclusions`, `add_tags_hide_exclusions`, `add_tags_exclusions_exact_match` and the lock state through the `addtags_get_exclusion_prefs` background command, and writes the list through `addtags_set_exclusions` (→ `mztaPrefs.setPref()`, so the guard applies). When `add_tags_exclusions` is locked, the per-tag "exclude" icon is not rendered at all. No content script reads preferences from storage any more. |
| `calendar_no_selection` ([js/mzta-prompts.js](../js/mzta-prompts.js)) | the behaviour used to be driven only by `need_selected` of `prompt_get_calendar_event`, written by the settings page's change listener, so a policy value showed a checked box and changed nothing. `need_selected` is now **derived** from the resolved preference on every `getSpecialPrompts()` read (never written because of the policy; see [02-prompts.md](02-prompts.md)), and the preference is in `MENU_RELEVANT_KEYS`. The page's placeholder check cannot stop a policy, so the background `taLogger.warn()`s at startup, and the page shows `prefs_OptionText_calendar_no_selection_policy_missing_placeholder` when the key is locked on, if the prompt has neither `{%mail_text_body_or_selected%}` nor `{%mail_html_body_or_selected%}`. The one-shot `migrateCalendarNoSelection()` aligned the preference once to the stored `need_selected`, so no unmanaged user changed behaviour on upgrade. |
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

The marker lands in the two existing contexts described below: the textareas' `.mzta_field`
flex column (appended as the last child, after the Save button row), and the checkbox's
`.feature_row` (before the `.mzta_switch`). No new CSS was needed.

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
  the row reads `… [Managed by Org] (toggle)`.
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
    out, never hide it.
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
there too.

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

Prefer a locked preference whenever one would do. Reach for a restriction only when there
is genuinely no user-facing setting to lock.
