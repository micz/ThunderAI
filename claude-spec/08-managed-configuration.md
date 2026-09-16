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
| **When read** | once, at background startup |

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
call is known to fail in Thunderbird. Hence `managedReady()` is a *function* that awaits
whatever load is in flight without starting one, and `hasLoaded()` distinguishes "the
policy was read and there is none" from "the policy was never read here".

## The allowlist

Derived from `Object.keys(prefs_default)`, minus three exclusion rules. Nothing else is
hardcoded — a new preference becomes policy-settable the moment it is declared.

```
Object.keys(prefs_default)
  minus  /^chatgpt_win_/        window geometry, per machine
  minus  /_enabled_accounts$/   account ids, per profile
  minus  api_webchat_font_scale local UI zoom
```

**100 of 108 keys** are policy-settable. The derivation already covers the generated keys:
the six `{prefix}_use_specific_integration` / `{prefix}_connection_type` pairs (from
`special_prompts_with_integration`) and the per-provider `{integration}_{key}` connection
keys (from `integration_options_config`) are all spread into `prefs_default` in
[`options/mzta-options-default.js`](../options/mzta-options-default.js).

The eight excluded keys are per-machine or per-profile state, not configuration: enforcing
them across a fleet would push window coordinates from another screen, a font zoom from
another display, or account ids that do not exist in this profile.

## Validation

Every key is checked against the allowlist **and** against the type of its `prefs_default`
counterpart. A type mismatch is never coerced. Unknown keys, excluded keys and mismatches
are skipped with a `taLogger.warn()` and never applied.

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
| `hasNoConnectionSelected()`, `getConnectionType()` ([js/mzta-utils.js](../js/mzta-utils.js)) | **unchanged.** Both take values their callers already fetched through `mztaPrefs`, so a policy-supplied `connection_type` flows through on its own, and the blue setup-wizard banners in the popup, welcome page and options page stay hidden by themselves. |
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

[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), shared by the options page and
the six feature settings pages. One `sendMessage` round trip per page:

```javascript
browser.runtime.sendMessage({ command: 'get_managed_state' })
// -> { active, orgName, lockedKeys }
```

**No page ever calls `browser.storage.managed` itself**, and `runtime.getBackgroundPage()`
is not used.

Note what the payload does **not** carry: the managed *values*. A page only needs to know
which controls to disable, so a policy-supplied API key never travels over the message
channel at all. The value reaches the input through the normal preference read, and an API
key field is masked anyway.

Control matching relies on the invariant `saveOptions()`/`restoreOptions()` already depend
on: **an `.option-input` element's `id` IS its preference key.** So no mapping table is
needed. The implementation walks the controls once testing against a `Set`, rather than
running a selector per locked key — an id-suffix selector would also catch unrelated
controls whose id merely ends with the key (`translate` would match `auto_translate`).

`applyManagedUI()` must run **after** the connection panel has injected its provider rows,
and after `restoreOptions()` has populated the inputs.

## Adding a policy-settable preference

Nothing to do. Declare it in `prefs_default` as usual
([05-options.md](05-options.md#adding-a-new-preference)) and it is policy-settable, with
type validation, a working write guard and automatic UI disabling.

The only decision is whether it is genuinely *configuration*. If it is per-machine or
per-profile state, add it to the exclusions in `js/mzta-managed.js` with a comment saying
why.

Either way the administrator key reference on micz.it is now out of date — it is generated
from `prefs_default` by hand, so a new or newly excluded preference has to be reflected
there too.
