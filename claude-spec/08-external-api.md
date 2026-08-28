# External API

> **Status: specification only.** Nothing described here is implemented yet. This file is Phase 0
> of the roadmap in [§13](#13-implementation-roadmap); it is the contract the implementation phases
> are written against. Where a design point interacts with existing code, the concrete function and
> file are cited — a mismatch recorded here becomes a bug in Phase 2–4.
>
> Issue [#306](https://github.com/micz/ThunderAI/issues/306). Target release **5.1.0**.
>
> A public draft (v1.0, 2026-02-20) circulated before this document. Where the two disagree, **this
> file wins**; the sections below record what changed and why, so the reasoning is not lost.

## 1. Overview, goals, non-goals

The External API lets another Thunderbird add-on use ThunderAI as a proxy for LLM operations,
without shipping its own provider integrations, API keys, or settings UI.

The shape of the collaboration is deliberately three-cornered:

1. The third-party add-on **registers named prompts** inside ThunderAI, supplying a default prompt
   text and metadata.
2. The **user** configures each one — prompt text, AI provider, model, provider-specific
   parameters — and enables it. Registration alone does nothing.
3. The add-on **executes it by ID** and receives the AI answer.

That the middle step exists is the whole design. The calling add-on never chooses a provider, never
sees a key, and never runs anything the user has not switched on.

### Goals

- Let an add-on ship AI features without ship**ping** an AI integration.
- Keep the user in control of cost and provider: every execution runs against a connection the user
  configured, on a prompt the user enabled.
- Make the API debuggable from the *caller's* side — a third-party developer must be able to work
  out why a call is not getting through without access to the user's machine (see
  [§8](#8-execution-log)).

### Non-goals

The API deliberately does **not**:

- expose ThunderAI's UI, popup, or context menus — external prompts never appear in either
  ([§7.3](#73-isolation-from-the-prompt-system));
- let a caller read or modify ThunderAI's settings, or read any API key;
- expose model listing or model selection — the model is the user's choice, made in the options
  page, and is not reported back to the caller ([§5.5](#55-get_registered_prompts));
- route through the ChatGPT Web integration, in any circumstance
  ([§6.1](#61-provider-resolution));
- open a window, tab, or panel as a side effect of an execution.

All executions are **programmatic and silent**: no window is opened, nothing is inserted into a
compose window, and the returned `text` is the **raw model output**. ThunderAI does not parse it.
Whether it is JSON, CSV, or prose is entirely a function of how the registered prompt was written —
which is the caller's business, not ThunderAI's.

There is exactly one path by which an external add-on can put something on the user's screen: the
consent dialog of [§3.3](#33-the-consent-dialog). Nothing else in this API is user-visible at call
time. This is stated plainly because it is the first thing an ATN reviewer will look for.

---

## 2. Transport, envelope, versioning, Sparks coexistence

### 2.1 Transport

The caller sends:

```js
const response = await browser.runtime.sendMessage("thunderai@micz.it", message);
```

ThunderAI receives it in `browser.runtime.onMessageExternal`, in the background page.

**No manifest change is needed.** `externally_connectable` — the key that would gate this in
Chrome — is **Chrome-only and has no effect in MV2 Thunderbird**; `manifest.json` does not declare
it today and must not gain it. Any extension that knows the ID `thunderai@micz.it` can send a
message, and the runtime will deliver it. This is worth stating explicitly because it is a natural
thing to get wrong in both directions: adding the key would be cargo-culting, and assuming the key
is what restricts callers would misplace the entire security model. **Authorization is enforced in
the listener** ([§3](#3-authorization-model)), never by the transport.

`sender.id` is supplied by the Thunderbird runtime, not by the message, and cannot be spoofed by
the caller. It is therefore the only trustworthy identifier in the whole protocol
([§3.3](#33-the-consent-dialog)).

### 2.2 Envelope

**Request:**

```js
{ action: string, version: number, data: object }
```

**Response:**

```js
{ success: boolean, data: object|null, error: {code: string, message: string}|null }
```

Exactly one of `data` / `error` is non-null. `success: false` always carries an `error` with a code
from [§10](#10-error-codes) and a human-readable `message` — the message is for the developer's
console and is **not localized**, since its audience is the calling add-on's author, not the user.

The listener must be a **non-async** function returning a Promise (see
[99-thunderbird-team-spec.md](99-thunderbird-team-spec.md) §5 — async `onMessage*` listeners are a
documented antipattern in this codebase). The existing Sparks listener already follows that shape.

A rejected promise or a thrown exception must never escape the listener: an internal failure is
caught and returned as `INTERNAL_ERROR`, so the caller always gets an envelope rather than an
opaque runtime error.

### 2.3 Versioning

`version` is the **protocol** version, currently `1`. It is not the ThunderAI version and does not
track it — `thunderai_version` is reported separately by `ping` ([§5.1](#51-ping)).

Policy: **support the current version and at least one previous one.** Anything else returns
`INVALID_VERSION`. Committing to a one-version overlap is what lets the protocol change without
breaking every installed caller on the day of a ThunderAI update: a caller written against version
N keeps working across the release that introduces N+1, giving its author a release cycle to catch
up. Since the current version is `1`, there is no previous version to accept yet.

### 2.4 Sparks coexistence — a hard compatibility constraint

`browser.runtime.onMessageExternal` already has a listener, the ThunderAI-Sparks integration
([`mzta-background.js:1387-1393`](../mzta-background.js#L1387-L1393)):

```js
browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'reload_menus':
            return _reload_menus();
            break;
    }
});
```

Sparks sends `{action: 'reload_menus'}` — **no `version`, no `data`**. Naive envelope validation
("reject anything without a numeric `version`") would break the Sparks integration outright. This
is a compatibility constraint, not a nicety.

**Discrimination rule.** The listener checks the action against a fixed set of legacy actions
*first*:

```
if (message.action is in LEGACY_ACTIONS)   → handle as before, return the legacy reply verbatim
else                                        → validate as an External API envelope
```

`LEGACY_ACTIONS` is currently the single entry `reload_menus`. Discriminating on the **action name**
rather than on the presence of `version` is the right way round: it is a closed, enumerable set that
cannot grow by accident, whereas "has a `version` field" is a property a future Sparks message might
acquire on its own. The two protocols therefore share a listener without sharing a namespace, and
no External API action may ever be named `reload_menus`.

The legacy reply shape is preserved exactly — `_reload_menus()` resolves to `true`, a bare boolean,
not an envelope. Sparks must not be made to understand the new envelope.

> **Note on the existing listener's own weakness.** It performs **no `sender.id` validation**: any
> add-on can trigger `_reload_menus()`, which reaches `_reconcileFeatureFlags()` and therefore
> writes to `browser.storage.sync`. This is pre-existing and out of scope for #306, but the new
> code must not extend the pattern — every External API action except `ping` is gated on the
> per-add-on authorization of [§3](#3-authorization-model), keyed on `sender.id`.

---

## 3. Authorization model

### 3.1 Two independent permissions

Authorization is an **explicit protocol action**, never an implicit side effect of the first
`register_prompts` call. Each calling add-on carries two independent permissions:

| Permission | Required for |
|---|---|
| **add-on authorization** | `register_prompts`, `get_registered_prompts`, `execute_prompt`, `unregister_prompts` |
| **message content access** | only the `message_id` branch of `execute_prompt` |

`ping` requires neither, so an add-on can detect ThunderAI's presence and version without any
prior relationship. `get_authorization_status` likewise requires neither — an add-on must be able
to discover it has been denied without that discovery itself requiring permission.

Making authorization explicit rather than implicit is a departure worth justifying: if the first
`register_prompts` silently triggered a consent dialog, an add-on could not distinguish "the user
has not decided yet" from "the user said no" without attempting a registration and thereby
*causing* the dialog. Separating the two gives the caller a way to ask about its state
(`get_authorization_status`) and a separate way to change it (`request_authorization`), with only
the latter ever showing UI.

**There is deliberately no global master switch for the API.** Per-add-on authorization is the
control. A global toggle would be a strictly worse instrument: off, it silently breaks every
integration the user consented to individually; on, it says nothing about *which* add-ons are
using ThunderAI. The External Prompts page ([§9](#9-external-prompts-options-page)) shows the
per-add-on list, which is the honest answer to "what has access?".

### 3.2 States and outcomes

Each permission resolves to one of three outcomes:

| Outcome | Meaning | Persisted? |
|---|---|---|
| `authorized` | the user granted it | yes |
| `denied` | the user explicitly refused | yes |
| `dismissed` | the window was closed without choosing (the X) | **no** |

**`denied` is explicit and persisted, but not final.** The add-on shows up as denied on the
External Prompts page, and every gated action returns `NOT_AUTHORIZED`. A later
`request_authorization` **may** reopen the dialog.

This puts a requirement on the *caller*, which ThunderAI does not enforce in v1: an add-on must
only re-request on a **deliberate user action** — a button in its own settings, say — and never in
a loop, never at every startup, never on a timer. A caller that re-prompts unbidden is a caller the
user will uninstall, but v1 has no rate limit on the dialog and no backoff. This is recorded as an
unenforced contract rather than an oversight; if it is abused in practice, the enforcement point
is `request_authorization`, not the dialog.

**`dismissed` persists nothing at all** — no record of the add-on, no denial, nothing on the
options page. The next request behaves as a first contact.

This is the distinction between *"no"* and *"not now"*, and it exists so that an accidentally
closed window — a misclick, a window manager, a user who wanted to go and read what the add-on
actually is before deciding — does not brand the add-on as rejected. Collapsing `dismissed` into
`denied` would make the safest reflex (close the thing you do not understand) the most punitive
outcome.

### 3.3 The consent dialog

A dedicated popup window created by ThunderAI, following the pattern already used by
`openChatGPT()` ([`mzta-background.js:1395`](../mzta-background.js#L1395)):

```js
let win_options = {
    url: browser.runtime.getURL('pages/externalauth/mzta-external-auth.html?...'),
    type: "popup",
};
applyWindowPositionAndSize(win_options, prefs);
await browser.windows.create(win_options);
```

`applyWindowPositionAndSize(win_options, prefs)`
([`mzta-background.js:1791`](../mzta-background.js#L1791)) **mutates its argument in place** and
its return value is ignored at every existing call site; `checkScreenDimensions(prefs)`
([`:1781`](../mzta-background.js#L1781)) must be applied to `prefs` first, as `openChatGPT()` does.

The dialog shows:

- **The self-declared add-on name** (`data.addon_name`), *clearly marked as self-declared*,
  alongside the **real extension ID** from `sender.id`.
- **The number and names of the prompts about to be registered.**
- **When requested, the message-access permission as a separate, explicitly worded item** — never
  folded into the general "allow this add-on" sentence ([§4](#4-message-content-access)).

#### Why the name is self-declared, and why that is stated in the UI

`sender.id` is the only identifier the runtime guarantees. The add-on's **real, installed name** is
not available to ThunderAI: reading it requires the `management` permission, which ThunderAI
deliberately does not request — it grants the ability to enumerate and inspect every installed
add-on, which is wildly disproportionate to putting a label on a dialog, and would be a legitimate
ATN review question.

The consequence is that `addon_name` is **attacker-controlled**. An add-on may declare itself
"ThunderAI Official Helper". The mitigation is not to try to validate the string — it cannot be
validated — but to render it as what it is: a claim, shown next to the one identifier that is not
a claim. The extension ID is the thing the user can check against their add-ons list.

#### The caller's promise stays pending

`request_authorization` does not resolve until the user decides. There is **no ThunderAI-side
timeout**, consistent with the existing decision that timeouts are the caller's responsibility (the
same reasoning as `special_command_timeout`, which the caller cannot set either). A caller that
needs a deadline imposes its own with `Promise.race`; ThunderAI resolving the promise early would
be strictly worse, because the dialog would still be on screen and the user's eventual answer
would then have nowhere to go.

#### One dialog at a time

Only one consent window may be open at once. A `request_authorization` arriving while one is open
receives `AUTHORIZATION_IN_PROGRESS` immediately, without queueing.

Immediate rejection rather than queueing is deliberate: a queue is a mechanism for stacking
windows in front of the user, which is exactly the abuse this limit exists to prevent. A caller
that gets `AUTHORIZATION_IN_PROGRESS` should surface it as "ThunderAI is busy asking about another
add-on" and let the user retry — not retry on its own.

#### Requesting an additional permission later

An already-authorized add-on that later needs message access calls `request_authorization` again
with `request_message_access: true`. The dialog then asks **only for the missing permission** and
never reopens the question of the one already granted. Re-asking about a settled permission trains
the user to click through the dialog, which is the failure mode that makes every subsequent consent
prompt meaningless.

The response still reports **both** permissions, so the caller always learns its complete state
from a single call.

### 3.4 No connection configured

When the dialog opens and the user has no usable AI connection, it says so and offers to open the
Setup Wizard.

"No usable connection" is `hasNoConnectionSelected(prefs.connection_type)`
([`js/mzta-utils.js:964`](../js/mzta-utils.js#L964)) — **plus the `chatgpt_web` caveat**: an
external prompt can never run on ChatGPT Web ([§6.1](#61-provider-resolution)), so a global
connection set to `chatgpt_web` is, for this API, no connection at all. The predicate to use is
therefore `isApiUsableConnection()` ([`:977`](../js/mzta-utils.js#L977)), which is exactly
`!hasNoConnectionSelected(t) && t !== 'chatgpt_web'`. Using the looser predicate here would let a
`chatgpt_web` user through the dialog with no warning and no working execution, which is the
failure the strict predicate exists to prevent elsewhere in the codebase (see
[01-architecture.md](01-architecture.md) → `_summarizeConnectionMissing()`).

Accepting the offer opens the wizard **in a tab**:

```js
browser.tabs.create({ url: "/pages/setup-wizard/mzta-setup-wizard.html" });
```

The Setup Wizard is always a tab, never a popup window — every existing call site does this
(`options/mzta-options.js:405`, `pages/onboarding/onboarding.js:38`, `popup/mzta-popup.js:47`).
`openTab()` ([`js/mzta-utils.js:567`](../js/mzta-utils.js#L567)) deduplicates by URL and should be
preferred over a bare `tabs.create`, so a second consent dialog does not open a second wizard.

**The authorization does not wait for the wizard.** The consent choice is made normally, the dialog
closes returning its outcome, and prompts are registered immediately. `execute_prompt` then returns
`PROVIDER_NOT_AVAILABLE` until a connection exists.

Blocking the authorization on wizard completion was considered and rejected: it couples two
independent decisions ("do I trust this add-on" and "which AI provider do I use"), it leaves the
caller's promise pending across an arbitrarily long interactive flow, and it has an obvious dead
end — a user who abandons the wizard has also, silently, abandoned the authorization.

---

## 4. Message content access

The rule is in [§3.1](#31-two-independent-permissions). This section is the *reason*, because a
rule whose rationale is not recorded is a rule that gets "simplified" away later.

**The threat is a confused deputy.** ThunderAI holds `messagesRead` — it is in `permissions` in
`manifest.json`, not `optional_permissions`, because reading mail is the add-on's entire purpose.
The calling add-on may hold no such permission.

Without a separate gate, `execute_prompt` with a `message_id` would let an add-on obtain email
content through ThunderAI **while never having declared `messagesRead` to the user**. The user
installed that add-on believing it could not read their mail; Thunderbird's own permission prompt
told them so. ThunderAI would be quietly falsifying that statement. This is a bypass of
Thunderbird's permission model, not merely of ThunderAI's.

**It is made materially worse by the identifier being a numeric, enumerable ID.**
`data.message_id` is the numeric `MessageHeader.id` ([§5.6](#56-execute_prompt)). These are
small sequential integers. A caller with authorization but a single benign-looking prompt could
iterate `1, 2, 3, …` and drain the entire mailbox, one AI answer at a time. This is not a
hypothetical shape of attack; it is a `for` loop.

**Neither of the other two controls bounds it.** The per-add-on authorization is a yes/no on the
add-on, not a budget on messages. The user-visible prompt text bounds what is *asked* about each
message, not *how many* messages are read — a prompt as innocent as "summarize this in one line"
exfiltrates the whole mailbox if run against every ID.

Hence: the permission is **separate**, and **off by default**. An add-on that only ever uses
`variables` never triggers the question at all, which is the common case and the one that should
be frictionless.

> **Recommendation for callers** (repeated in the developer-facing documentation of
> [§13](#13-implementation-roadmap), Phase 5): **an add-on that already holds `messagesRead` should
> pass the content itself via `variables`, not via `message_id`.** It gains nothing from the
> `message_id` branch — it can already read the message — and it avoids asking the user for a
> second permission covering something they already granted. `message_id` exists for callers that
> genuinely cannot read mail themselves and have deliberately asked the user for that reach.

---

## 5. Actions

Field names follow the v1.0 draft. Every example omits the envelope's constant parts for brevity
where they are obvious.

### 5.1 `ping`

No authorization required. The presence-and-version probe.

**Request**

```js
{ action: "ping", version: 1, data: {} }
```

**Response**

```js
{ success: true,
  data: { api_version: 1, thunderai_version: "5.1.0" },
  error: null }
```

`thunderai_version` is read from `browser.runtime.getManifest().version` — **never hardcoded**. A
hardcoded copy is a string that will be wrong at the first release that forgets to update it, and
the failure is silent.

`ping` requiring no authorization is what makes graceful degradation possible: an add-on can detect
that ThunderAI is absent or too old before it ever asks the user for anything.

### 5.2 `request_authorization`

**Request**

```js
{ action: "request_authorization", version: 1,
  data: {
    addon_name: "My Add-on",        // self-declared; see §3.3
    request_message_access: false   // optional, default false
  } }
```

**Response** — resolves only after the user decides ([§3.3](#33-the-consent-dialog)):

```js
{ success: true,
  data: { authorization: "authorized",       // authorized | denied | dismissed
          message_access: "denied" },        // authorized | denied | dismissed
  error: null }
```

Both permissions are always reported, whatever was requested. When `request_message_access` is
`false` and message access was never granted, `message_access` reports its stored state
(`denied` if previously refused, otherwise `denied` as the default-off value) — the caller learns
its full state from one call.

Concurrent request → `AUTHORIZATION_IN_PROGRESS`.

### 5.3 `get_authorization_status`

No authorization required, and **opens no UI** — this is the whole point. An add-on calls it at
startup to decide whether to show its AI features, without disturbing a user who has not asked for
anything.

**Request**

```js
{ action: "get_authorization_status", version: 1, data: {} }
```

**Response**

```js
{ success: true,
  data: { authorization: "authorized",
          message_access: "denied" },
  error: null }
```

An add-on ThunderAI has never seen (or one that was `dismissed`, which persists nothing) reports
both as `denied` — the correct default-deny reading. It does **not** report a distinct "unknown"
state: from the caller's side "never asked" and "asked and refused" both mean *you may not proceed*,
and the actionable difference (whether re-prompting is reasonable) is a judgement about the user's
history that the caller should not be making on ThunderAI's say-so.

### 5.4 `register_prompts`

Requires add-on authorization.

**Request**

```js
{ action: "register_prompts", version: 1,
  data: {
    prompts: [{
      id: "summarize_thread",              // required, unique within the calling add-on
      name: "Summarize thread",            // required, shown in the options page
      description: "One-line summary",     // optional
      default_prompt_text: "Summarize: {%mail_body%}",   // required
      placeholders: ["mail_body"],         // optional, declarative; see below
      default_system_prompt: "You are terse.",           // optional
      default_temperature: 0.3                           // optional
    }]
  } }
```

**Response**

```js
{ success: true,
  data: { registered: ["summarize_thread"], updated: [] },
  error: null }
```

**Namespacing.** Prompts are keyed internally as `{sender.id}::{prompt_id}`. Two add-ons may both
register `summarize` without collision, and the key is derived from `sender.id` — not from anything
the caller sends — so one add-on cannot address, overwrite, or execute another's prompts.

**Newly registered prompts are disabled by default.** The user must configure and enable each one
on the External Prompts page. Registration is a *request to appear in the options UI*, nothing
more. Auto-enabling would mean a single authorization grant silently licenses every prompt the
add-on ever registers afterwards, including ones added in a later update the user never reviewed.

**Re-registration updates metadata but preserves user configuration** — see
[§7.2](#72-prompt-text-update-policy) for the prompt-text rule, which is the subtle part.

`placeholders[]` is **declarative and advisory**: it tells the options page which placeholders the
add-on expects, so the editor can hint at them. It does not restrict what the user may write, and
it is not enforced at execution time — the resolver simply resolves whatever tokens are present in
the final text ([§6.2](#62-placeholder-resolution)).

### 5.5 `get_registered_prompts`

Requires add-on authorization. Returns only the calling add-on's own prompts.

**Request**

```js
{ action: "get_registered_prompts", version: 1, data: {} }
```

**Response**

```js
{ success: true,
  data: { prompts: [{
            id: "summarize_thread",
            name: "Summarize thread",
            description: "One-line summary",
            enabled: true,
            configured: true,
            provider: "anthropic_api"
          }] },
  error: null }
```

**Per prompt: `enabled`, `configured`, `provider`, and nothing more.** No API keys — obviously —
but also **no model names**. The model is the user's choice and is none of the caller's business;
reporting it would also leak which paid tier the user is on. The `provider` is reported because a
caller may legitimately need to know that its prompt will run against, say, a local Ollama instance
rather than a hosted API — that changes what is reasonable to send.

#### What `configured` means

**`configured` reports whether the user picked a provider *for that prompt*.** It is `true` when
the stored prompt has a non-empty `api_type`, and `false` when it is empty and execution would fall
back to ThunderAI's global connection.

This needs stating precisely, because **the naive reading of the v1.0 draft no longer holds**. In
the draft, an unconfigured prompt could not run, so `configured: false` meant "this will fail".
With the global-connection fallback of [§6.1](#61-provider-resolution), `configured: false` means
"this will run on whatever the user's global connection is" — which is usually fine.

So `configured` is now **informational, not a precondition**. A caller must not gate execution on
it. The question it answers is "has the user given this prompt its own provider?", which is a
different question from "will this prompt run?" — and the honest answer to the second is: try it,
and handle `PROVIDER_NOT_AVAILABLE`.

`provider` reports the **resolved** connection type, i.e. the prompt's own `api_type` when set and
the global `connection_type` otherwise, so it stays meaningful in both cases. It is the empty
string when neither is set.

### 5.6 `execute_prompt`

Requires add-on authorization; the `message_id` branch additionally requires message content
access.

**Request**

```js
{ action: "execute_prompt", version: 1,
  data: {
    prompt_id: "summarize_thread",       // required, un-namespaced — the caller's own id
    variables: {                          // optional; keys WITHOUT the {% %} delimiters
      mail_body: "Hello, ...",
      custom_note: "be brief"
    },
    message_id: 4217                      // optional; numeric MessageHeader.id
  } }
```

**Response**

```js
{ success: true,
  data: { text: "The thread concerns ...",
          provider: "anthropic_api",
          model: "claude-sonnet-4-5",
          duration_ms: 3120 },
  error: null }
```

`text` is the **raw model output**, de-thought but otherwise untouched
([§6.3](#63-execution-through-mzta_specialcommand)).

`model` is reported here — unlike in `get_registered_prompts` — because it describes *the call the
caller just paid for*, which is legitimately theirs to log, rather than a standing fact about the
user's configuration.

#### `message_id` is the numeric `MessageHeader.id`

Thunderbird exposes two identifiers, and the choice matters:

- the **numeric per-folder `MessageHeader.id`** — what this API accepts;
- the RFC `headerMessageId` string — what every ThunderAI cache is keyed on.

Resolution is therefore a single `browser.messages.get(id)`, the cheap route (b) of
`_resolveMessage()` ([`mzta-background.js:868`](../mzta-background.js#L868)). The external path
**never** reaches `browser.messages.query()`, so the full-store search that
[01-architecture.md](01-architecture.md#resolving-a-message-from-its-headermessageid) warns freezes
the entire Thunderbird UI is off the table by construction. That is the reason for choosing the
cheap identifier.

Two consequences must be recorded rather than left implicit:

1. **The enumeration threat of [§4](#4-message-content-access) is literal.** Numeric IDs are
   enumerable; the confused-deputy argument is a description of a `for` loop, not a rhetorical
   flourish.
2. **The ID is per-folder and reusable after a delete + compaction**, and it is *not* the key any
   ThunderAI cache uses. So an external execution shares no cache with the summarize / translate /
   spam paths — it always does its own read — and a stale ID from a caller resolves to a
   **different message** rather than to nothing. `MESSAGE_NOT_FOUND` covers only the missing case;
   ThunderAI cannot detect a reused ID, and **the caller owns the freshness of the ID it passes**.
   A caller holding an ID across a user's delete-and-compact cycle is a caller with a bug ThunderAI
   cannot diagnose for it.

#### Precedence when both are supplied

**`variables` win, per key.** The resolution order for any single placeholder is:

1. an explicit entry in `variables` with that key;
2. otherwise, the value resolved from `message_id` through the standard placeholder system;
3. otherwise, whatever the placeholder system does with an unresolvable token
   ([§6.2](#62-placeholder-resolution)).

Per-key rather than whole-branch precedence is what makes the useful case work: a caller supplies
`message_id` for the mail content and overrides `{%mail_subject%}` with a normalized version it
computed itself. Whole-branch precedence would force it to supply everything or nothing.

Supplying `message_id` without message-access permission is `MESSAGE_ACCESS_NOT_AUTHORIZED` — and
it is rejected **even if every placeholder in the prompt is already covered by `variables`**. The
check is on the *request*, not on whether the message turned out to be needed: an add-on probing
which IDs exist learns something from the difference between `MESSAGE_NOT_FOUND` and success, so
the permission gate must sit in front of the lookup, not behind it.

### 5.7 `unregister_prompts`

Requires add-on authorization.

**Request**

```js
{ action: "unregister_prompts", version: 1,
  data: { prompt_ids: ["summarize_thread"] } }
```

**Response**

```js
{ success: true,
  data: { unregistered: ["summarize_thread"], not_found: [] },
  error: null }
```

Unregistering **deletes** the prompt and its user configuration. An ID the add-on does not own is
reported in `not_found` rather than erroring — the caller cannot address another add-on's prompts
at all ([§5.4](#54-register_prompts)), so from its perspective the ID simply does not exist.

A partial success is still `success: true` with a populated `not_found`: the requested work that
could be done was done, and the caller can see exactly what was not.

---

## 6. Execution pipeline

### 6.1 Provider resolution

**The prompt's own `api_type` wins; when it is empty, execution falls back to ThunderAI's global
connection.**

This is exactly the behaviour of `getConnectionType(prefs, prompt, prefix)`
([`js/mzta-utils.js:1014`](../js/mzta-utils.js#L1014)) called with **no prefix**:

```
feature-specific (not applicable here) → prompt.api_type → prefs.connection_type → ''
```

The external path passes `prefix = null`, so it reduces to "the prompt's own type, else the
global". Reusing the existing helper rather than reimplementing the precedence is deliberate; the
precedence has three sources and has been got wrong before.

**`chatgpt_web` is rejected with `PROVIDER_NOT_AVAILABLE` in every case** — including, and
especially, when it is the *global* connection that is set to it. ChatGPT Web has no API: it drives
a browser window by DOM automation ([04-api-integrations.md](04-api-integrations.md)), which is
incompatible with a silent programmatic call in every respect. The predicate is
`isApiUsableConnection()` ([`js/mzta-utils.js:977`](../js/mzta-utils.js#L977)), which folds "no
connection" and "`chatgpt_web`" into the single question this API needs answered.

#### `PROMPT_NOT_CONFIGURED` is retired

The v1.0 draft emitted `PROMPT_NOT_CONFIGURED` when a prompt had no provider of its own. **With
the global-connection fallback, `execute_prompt` no longer emits it**: an unconfigured prompt is
not an error state, it is the common case.

**The code is retained but unused.** It stays in the error-code table
([§10](#10-error-codes)) marked as such, and no code path returns it. Retaining rather than
deleting it is the conservative choice for a published protocol: a caller written against the v1.0
draft may already switch on the string, and a `switch` with an unreachable branch is harmless,
whereas recycling the identifier for a different meaning later would be actively dangerous.

Note that `configured` in `get_registered_prompts` remains meaningful and is **not** the same
question — see [§5.5](#what-configured-means).

### 6.2 Placeholder resolution

Two sources feed the prompt text, with the per-key precedence of [§5.6](#precedence-when-both-are-supplied).

**`variables`** supply values directly. Keys are given **without** the `{% %}` delimiters —
`mail_body`, not `{%mail_body%}` — which keeps the caller out of ThunderAI's token syntax.

**`message_id`** resolves the standard email placeholders through the existing system:
`placeholdersUtils.getPlaceholdersValues(args)`
([`js/mzta-placeholders.js:620`](../js/mzta-placeholders.js#L620)), which takes a single
destructured options object and resolves **only the placeholders actually present** in
`prompt_text`.

What has to be filled in:

| Argument | Value on the external path |
|---|---|
| `prompt_text` | the stored (user-edited) prompt text |
| `curr_message` | the `MessageHeader` from `browser.messages.get(message_id)` |
| `msg_text` | `{html, text, plain_part}` from `getMailBody(fullMessage, message_id)` ([`js/mzta-utils.js:250`](../js/mzta-utils.js#L250)) |
| `body_text` | the plain-text body, feeding `{%mail_text_body%}` |
| `mail_subject` | `curr_message.subject` |
| `only_typed_text`, `only_quoted_text`, `selection_text`, `selection_html` | **always empty** — see below |
| `tags_full_list` | the standard `[displayString, tagObjects]` pair |

`curr_message` is polymorphic in the existing code (a `MessageHeader` when reading, a
`ComposeDetails` when composing); the external path is always the reading shape.

Substitution is `replacePlaceholders()`
([`js/mzta-placeholders.js:526`](../js/mzta-placeholders.js#L526)).

#### Placeholders that cannot be resolved on this path

There is no compose window and no text selection, so four placeholders are structurally
unresolvable:

| Placeholder | Why |
|---|---|
| `{%mail_typed_text%}` | compose-only (`type: 2`); sourced from a `getOnlyTypedText` content-script round-trip |
| `{%mail_quoted_text%}` | compose-only (`type: 2`); same mechanism |
| `{%selected_text%}` | requires a live selection in a content script |
| `{%selected_html%}` | same |

The two "or selected" variants degrade rather than fail: `{%mail_text_body_or_selected%}` and
`{%mail_html_body_or_selected%}` are `selection || body`, so with no selection they resolve to the
body — which is the sensible outcome and needs no special handling.

**What happens to an unresolvable one** is governed by existing behaviour, and it has a trap in it.
`replacePlaceholders()` resolves through a `||` chain:

```js
replacements[p1] || replacements[currPlaceholder.id] || (use_default_value ? currPlaceholder.default_value : match)
```

Because the chain is `||` and not `??`, **a placeholder that legitimately resolves to an empty
string falls through** to `default_value`, or — when `placeholders_use_default_value` is off, which
is the default — to `match`, leaving the literal `{%selected_text%}` **in the prompt text sent to
the model**.

This is pre-existing behaviour shared with every other execution path, and the External API does
**not** special-case it: diverging would mean the same prompt behaves differently depending on who
ran it. It is documented here because it is a genuine surprise for a third-party developer, and
because it is the mechanism behind the editor warning of [§9](#9-external-prompts-options-page) —
the user who pastes `{%selected_text%}` into an external prompt gets a literal token in their API
request, not an error. It also applies to `variables`: passing `mail_body: ""` is **not** the same
as passing a body of zero length; it falls through exactly as an unresolved token would.

### 6.3 Execution through `mzta_specialCommand`

Execution runs through `mzta_specialCommand`
([`js/mzta-special-commands.js`](../js/mzta-special-commands.js)), **one fresh instance per call** —
instances are never reused, matching every existing caller
([04-api-integrations.md](04-api-integrations.md#worker-lifecycle--timeout-mzta_specialcommand)).

```js
const cmd = new mzta_specialCommand({
    prompt: resolvedPromptText,
    llm: resolvedConnectionType,
    do_debug: prefs.do_debug,
    config: externalPromptObject,      // ← the prompt-shaped object, see below
});
await cmd.initWorker();
const text = await cmd.sendPrompt();
```

The constructor **throws synchronously** on an unknown or empty `llm`, so the
`isApiUsableConnection()` check of [§6.1](#61-provider-resolution) must happen *before* it.

#### The required shape of `config`, and why the external store mirrors the prompt object

`config` is not a bespoke struct: `initWorker()`
([`js/mzta-special-commands.js:100`](../js/mzta-special-commands.js#L100)) reads exactly two kinds
of key from it —

- **`config.api_type`** — the per-prompt provider override;
- **`config['<integration>_<key>']`** — prefixed provider keys, where `<integration>` is `api_type`
  minus the `_api` suffix and `<key>` iterates `Object.keys(integration_options_config[integration])`
  ([`options/mzta-options-default.js:21`](../options/mzta-options-default.js#L21)) — e.g.
  `anthropic_model`, `anthropic_system_prompt`, `chatgpt_temperature`, `ollama_num_ctx`.

**This is why `_external_prompts` stores its per-prompt configuration under the same prefixed keys
as a prompt object** ([§7.1](#71-storage-keys)). Doing otherwise would mean translating between two
shapes on every execution, and the translation would have to be kept in step with
`integration_options_config` by hand.

Two behaviours of `initWorker()` must be understood by the implementation:

1. **`use_specific_api` is set purely by `config.api_type` being non-empty**
   ([`:106-111`](../js/mzta-special-commands.js#L106-L111)) — it is *not* compared against `llm`.
   When set, the prefixed keys are read from `config`; when not, they are read from the **global**
   prefs. So the global-connection fallback of [§6.1](#61-provider-resolution) is achieved simply
   by leaving `api_type` empty, and the correct global keys are picked up automatically. **Passing
   `config: {}` with a matching connection type would silently ignore a configured override** — the
   trap already documented in
   [04-api-integrations.md](04-api-integrations.md#per-feature-provider-override-specific-integration).
2. **`use_specific_api` also skips `validateAPIConfig()`**
   ([`:135-142`](../js/mzta-special-commands.js#L135-L142)). A prompt with its own `api_type` but a
   missing key or model therefore **does not** raise `isConfigError` — it reaches the worker and
   fails there as a provider error. The External API must not rely on `isConfigError` for
   per-prompt configurations; the practical consequence is that a missing API key surfaces as
   `PROVIDER_ERROR` with the provider's own 401 text rather than as a clean configuration
   complaint. Phase 3 may add its own pre-flight check if a better message is wanted, but it cannot
   get one from `initWorker()`.

The `special_command_timeout` pref applies, read inside `initWorker()`
([`:129-133`](../js/mzta-special-commands.js#L129-L133), default `120000` ms). Note it is a
**total deadline, not an idle one** — streaming tokens do not reset it — so a legitimately long
answer can time out mid-stream. The caller cannot set it; it is the user's setting.

`sendPrompt()` resolves the de-thought answer: `newThinkingToken` messages are discarded and inline
`<think>` blocks are stripped with `stripThinkTags(full_message, true, true)`, so **reasoning never
reaches the caller's `text`**
([04-api-integrations.md](04-api-integrations.md#thinking-in-special-commands)). It always calls
`dispose()` via `Promise.finally`, terminating the worker on success, error, and timeout alike.

#### Error mapping

Worker errors map to **`PROVIDER_ERROR`**, carrying the provider's message.

The `is_exception` contract from
[04-api-integrations.md](04-api-integrations.md#error-contract-between-jsapi-and-workers) surfaces
here already flattened: the workers build a single `error_text` string — for a network-level
exception it is the pre-prefixed `response.error` (there is **no** `status`/`statusText` to read),
for an HTTP error it is the assembled status + detail line — and `sendPrompt()` rejects with
`Error("[ThunderAI] Error from API worker: " + payload)`. The External API therefore does **not**
re-inspect `is_exception`; that branch was already taken inside the worker. It puts the message
into `error.message` as-is and does not attempt to classify it further. Distinguishing "the
provider is down" from "your key is wrong" is the provider's own wording to give, and inventing a
taxonomy on top of five providers' error text would be a maintenance burden that drifts.

A timeout is likewise `PROVIDER_ERROR`, with the timeout message.

### 6.4 No concurrency cap and no rate limit in v1

**Deliberate, with a known risk.** There is no limit on concurrent `execute_prompt` calls and no
per-add-on rate limit. A misbehaving or buggy caller can issue calls in a loop and **burn the
user's tokens** — a real cost, on the user's account, caused by a third party.

This is recorded as a trade-off rather than left as an oversight. The reasoning for not shipping a
limit in v1:

- Any cap is a guess. Too low, it breaks a legitimate batch caller; too high, it does not actually
  bound the cost. There is no basis yet for choosing a number.
- The failure is **visible and attributable**, which is the mitigation that does exist: the
  execution log ([§8](#8-execution-log)) records every call with its add-on, prompt, provider and
  duration, so a runaway caller is identifiable on the External Prompts page and can be disabled or
  de-authorized there.
- Revocation is already per-add-on and immediate.

If v1 shows this to be insufficient, the enforcement point is `execute_prompt`, and the log is the
data that would justify the chosen number.

---

## 7. Storage

### 7.1 Storage keys

Three keys in `browser.storage.local`, all isolated from the prompt system. Local rather than sync
for the same reason as `_custom_prompt` and friends: the payloads are unbounded in a way
`storage.sync`'s quota cannot accommodate ([05-options.md](05-options.md)).

#### `_external_prompts`

Keyed `{addon_id}::{prompt_id}`. Each record holds three groups:

```js
{
  "other@addon.id::summarize_thread": {
    // --- as declared by the add-on (overwritten on re-registration) ---
    addon_id: "other@addon.id",
    prompt_id: "summarize_thread",
    name: "Summarize thread",
    description: "One-line summary",
    declared_prompt_text: "Summarize: {%mail_body%}",   // ← see §7.2
    declared_placeholders: ["mail_body"],
    declared_system_prompt: "You are terse.",
    declared_temperature: 0.3,

    // --- the user's configuration (preserved across re-registration) ---
    text: "Summarize: {%mail_body%}",     // the effective prompt text, user-editable
    api_type: "anthropic_api",            // '' = fall back to the global connection
    anthropic_model: "claude-sonnet-4-5", // prefixed provider keys, per §6.3
    anthropic_system_prompt: "You are terse.",
    anthropic_temperature: "0.3",
    // ... any key from integration_options_config[<integration>]

    // --- state ---
    enabled: false,                        // false on registration, per §5.4
    first_seen: 1770000000000,
    last_seen: 1770000000000
  }
}
```

The prefixed provider keys mirror the prompt-object convention so the record can be handed to
`mzta_specialCommand` as `config` with no translation ([§6.3](#63-execution-through-mzta_specialcommand)).

#### `_external_addons`

One record per calling add-on:

```js
{
  "other@addon.id": {
    addon_id: "other@addon.id",       // === sender.id; the trustworthy identifier
    addon_name: "My Add-on",          // self-declared; never trusted, always labelled as such
    authorization: "authorized",      // authorized | denied
    message_access: "denied",         // authorized | denied
    first_seen: 1770000000000,
    last_seen: 1770000000000
  }
}
```

Only `authorized` and `denied` are ever stored — `dismissed` writes nothing at all, which is what
makes it behave as a first contact next time ([§3.2](#32-states-and-outcomes)). An add-on with no
record here has never been authorized.

#### `_external_api_log`

See [§8](#8-execution-log).

### 7.2 Prompt text update policy

Carried over from §12.1 of the v1.0 draft, unchanged:

> On re-registration, if the stored text still equals the previously registered default, it is
> updated to the new default. If the user has edited it, the user's version wins.

**`declared_prompt_text` is the field that makes this comparison possible.** It holds the default
*as last registered*, alongside `text`, which holds the effective (possibly user-edited) value. The
rule is then a single comparison:

```
if (stored.text === stored.declared_prompt_text)  stored.text = incoming.default_prompt_text
stored.declared_prompt_text = incoming.default_prompt_text     // always
```

Without the separate field the two cases are indistinguishable — a stored text differing from the
incoming default could equally be a user edit or an add-on that changed its default, and guessing
wrong either silently discards the user's work or permanently freezes the prompt at its first
version.

`declared_system_prompt` and `declared_temperature` are stored for the same reason plus one more:
they are the values the "reset to the add-on's defaults" control restores
([§9](#9-external-prompts-options-page)).

### 7.3 Isolation from the prompt system

**External prompts must never leak into the prompt system.** They are not prompts in ThunderAI's
sense: they belong to another add-on, they are invoked programmatically, and surfacing them in a
menu would offer the user a command whose behaviour is defined by a third party.

The concrete sites that would otherwise pick them up:

| Site | Call | Consequence if leaked |
|---|---|---|
| [`js/mzta-menus.js:103`](../js/mzta-menus.js#L103) | `getPrompts(true, also_special)` | appear in the context menu |
| [`pages/customprompts/mzta-custom-prompts.js:85`](../pages/customprompts/mzta-custom-prompts.js#L85) | `getPrompts()` | editable in the Custom Prompts page |
| [`pages/customprompts/mzta-custom-prompts.js:422`](../pages/customprompts/mzta-custom-prompts.js#L422) | `preparePromptsForExport(await getPrompts(), …)` | exported into the user's backup file |
| [`pages/menu_order/mzta-menu-order.js:103`](../pages/menu_order/mzta-menu-order.js#L103) | `getPrompts(false, [], true)` | orderable/hideable in the Menu Order page |
| [`js/mzta-prompts.js:509`](../js/mzta-prompts.js#L509) | `getPrompts()` in `preparePromptsForImport()` | merged on import |
| [`js/mzta-prompts.js:771`](../js/mzta-prompts.js#L771) | `getPrompts(false, [], true)` in `migrateMenuOrderAlphabetic()` | assigned menu positions |
| [`js/mzta-prompts.js:865`](../js/mzta-prompts.js#L865) | `getPrompts(false, [], true)` in `loadPrompt()` | addressable by ID from anywhere |

The **popup** is not on this list: it does not call `getPrompts()` at all, but reads
`menus.shortcutMenu` via the `popup_menu_ready` snapshot
([`mzta-background.js:202`](../mzta-background.js#L202) →
[`popup/mzta-popup.js:63`](../popup/mzta-popup.js#L63)). It is therefore covered transitively by
keeping them out of the menus.

**The isolation requires no new filtering.** Every one of those sites reaches storage through
`getPrompts()`, which assembles from exactly three keys — `_special_prompts`,
`_default_prompts_properties`, `_custom_prompt`. `_external_prompts` is a fourth key that
`getPrompts()` does not read. Keeping the external store out of those three is *sufficient*, and it
is sufficient by construction rather than by a filter someone must remember to maintain.

Accordingly:

- **`loadPrompt()` / `savePrompt()` must NOT be extended** to understand external prompts. Adding a
  fourth store to `loadPrompt()` ([`js/mzta-prompts.js:864`](../js/mzta-prompts.js#L864)) would
  make every one of the seven call sites above a potential leak, and `savePrompt()`'s routing is by
  `is_special` / `is_default` flags with no room for a fourth case that does not also change the
  meaning of the existing three.
- Phase 1 provides its own `js/mzta-external-prompts.js` with `loadExternalPrompt()` /
  `saveExternalPrompt()` / `getExternalPrompts()` over `_external_prompts`.
- **This is what makes `initializeSpecificIntegrationUI()` unusable as-is** — it imports
  `loadPrompt`/`savePrompt`/`clearPromptAPI` at module level. See
  [§9.2](#92-the-connection-ui-cannot-be-reused-as-is).

External prompts also carry **no** `show_in`, `position_*`, `type`, `action`, or `custom_icon`
fields. Those properties only mean something for a prompt that can appear in a menu, and giving
them values would invite exactly the leak this section prevents.

### 7.4 Orphans

**ThunderAI cannot detect the uninstallation of a calling add-on.** There is no event for it
without the `management` permission, which is not requested ([§3.3](#33-the-consent-dialog)).

Prompts from an uninstalled add-on therefore **stay visible** on the External Prompts page and are
removed manually by the user. There is no automatic cleanup — not on a timer, not on a failed
`ping`, not on a heuristic over `last_seen`.

This is a deliberate choice for **no risk of data loss**. Every available signal is unreliable in
the same direction: an add-on that is merely disabled, or not yet loaded at startup, or updating,
is indistinguishable from one that is gone. Automatic cleanup would occasionally delete a working
integration's user-configured prompt text, and the user would have no way to get it back. A stale
row on a settings page costs nothing by comparison, and `last_seen` gives the user the information
they need to decide.

---

## 8. Execution log

A **FIFO, capped at 100 records, metadata only**, in `_external_api_log`.

Per record:

| Field | Notes |
|---|---|
| `ts` | timestamp |
| `addon_id` | from `sender.id` |
| `prompt_id` | the caller's un-namespaced ID |
| `provider` | the **resolved** connection type |
| `model` | the resolved model |
| `outcome` | `success`, or the error code |
| `duration_ms` | |
| `error_message` | only when the outcome is a failure |

**The resolved prompt text and the model's answer are never stored.** They are email content. A
log that captured them would be a plaintext copy of every message any external add-on ever
processed, sitting in `storage.local` indefinitely, surviving long after the message itself was
deleted — and it would exist purely as a debugging convenience. Metadata answers the questions the
log needs to answer without holding anything that is not already a fact about the *call*.

**Rejected calls are logged too**, not just calls that reached a provider: `NOT_AUTHORIZED`,
`MESSAGE_ACCESS_NOT_AUTHORIZED`, `PROMPT_NOT_ENABLED`, `PROMPT_NOT_FOUND`,
`PROVIDER_NOT_AVAILABLE`, and the rest.

This is the log's primary purpose, and it inverts the usual priority. A third-party developer
debugging "my call returns nothing" cannot see the user's machine; the user, who can, has no idea
what the add-on expected. The log is the shared artefact between them — and the calls that never
reach a provider are precisely the ones that are hardest to diagnose remotely. A log of only
successful executions would be a log of the cases nobody needs help with.

### Storage pattern

Follow the class shape of `taSpamReport` ([`js/mzta-spamreport.js`](../js/mzta-spamreport.js)) /
`taSummaryStore` / `taTranslationStore`: a class with `_max_records = 100`, a `taLogger`, an
`append` method, `getAll`, `clear`, and a `trunc` that sorts newest-first and deletes from index
`_max_records` onward.

**It cannot reuse `taStorage`.** `taStorage` ([`js/mzta-storage.js`](../js/mzta-storage.js)) is
keyed `msg:<headerMessageId>` — one record per message — and every one of `getAllSpamRecords()`,
`cleanup()` and `clearAllRecords()` filters on that `msg:` prefix. The execution log is **not
per-message**: most entries have no message at all, and several may share one. It therefore needs
its own single-key store (`_external_api_log` holding an array), which is simpler than the
per-message stores rather than more complex — the trim is an array slice, not a sort-and-delete
sweep over a filtered key space.

Note the existing stores' `trunc*()` methods are **explicit calls, not automatic** inside their
save method. The log should trim on append, since it has a single writer and no per-message
lifecycle to hang a separate call off.

---

## 9. External Prompts options page

A new page under `pages/externalprompts/`, opened from a button in the options page alongside the
other feature pages.

### 9.1 Layout

Follow the conventions of `pages/spamfilter/` and `pages/addtags/`
([05-options.md](05-options.md#feature-page-shell-opt-in-bodymzta_feature_page)):

- `<head>`: the five stylesheets in the fixed order (`../_lib/mzta-design.css` **first**, then the
  page's own, then `autocomplete.css`, `editor-highlight.css`, `connection-ui.css`), then the
  favicon.
- `<body class="mzta_feature_page">` → `#mzta_card` → `#mzta_top_links` (icon +
  `.mzta_page_title` + `.mzta_page_subtitle`) → `#mzta_body`.
- Each group is a `.mzta_section` card headed by `.mzta_prompt_title`.
- Raw `__MSG_key__` tokens in the markup — **no `data-i18n` attributes**.
- Scripts last: the page module `type="module"`, **then** the classic `js/mzta-i18n.js`.
  `i18n.updateDocument()` must be called **after** any connection UI is injected, so the injected
  rows' tokens are localized too.

**Options-page button**, matching the existing feature rows
([`options/mzta-options.html:153-177`](../options/mzta-options.html#L153-L177)): a
`btn_no_border btn_small feature_manage` button inside `feature_info`, label ending in `&rsaquo;`,
wired in the flat navigation block at
[`options/mzta-options.js:639-661`](../options/mzta-options.js#L639-L661) via
`openTab('/pages/externalprompts/mzta-external-prompts.html')`.

Unlike the other feature rows, this one is **not** gated behind a feature flag or a connection
check — there is no `external_api` on/off pref ([§3.1](#31-two-independent-permissions)), and the
page must remain reachable when no connection is configured so the user can review and revoke
authorizations.

### 9.2 The connection UI cannot be reused as-is

**`initializeSpecificIntegrationUI()`**
([`pages/_lib/connection-ui.js:1270`](../pages/_lib/connection-ui.js#L1270)) **cannot be used by
this page.** Three reasons, all structural:

1. **It is not parameterized over persistence.** `loadPrompt`, `savePrompt` and `clearPromptAPI`
   are **module-level imports**, and `promptId` is the only handle the caller gets. Its
   `_updatePrompt()` ([`:1315-1339`](../pages/_lib/connection-ui.js#L1315-L1339)) does
   `loadPrompt(promptId)` → assign `api_type` + every prefixed key → `savePrompt(prompt)`. Pointed
   at an external prompt it would write into the prompt system, which is exactly what
   [§7.3](#73-isolation-from-the-prompt-system) forbids.
2. **It hardcodes a single anchor**, `afterTrId: 'connection_ui_anchor'`
   ([`:1282-1289`](../pages/_lib/connection-ui.js#L1282-L1289)), and `connection_ui_end`
   ([`:1310`](../pages/_lib/connection-ui.js#L1310)). Bare element IDs can exist only once per
   page.
3. **It assumes one panel per page.** `_updateVisibility()` queries
   `document.querySelectorAll(".specific_integration_sub")` — document-wide — so with several
   panels every panel would react to every other panel's provider change.

**The required change**, which Phase 4 must make and which is the contract this document fixes:

- Add optional `loadStore` / `saveStore` / `clearStore` callbacks, defaulting to
  `loadPrompt` / `savePrompt` / `clearPromptAPI` so every existing caller is unaffected.
- Add an `anchorId` / `endId` option in place of the hardcoded pair.
- Scope `_updateVisibility()` to the injected rows of *this* invocation rather than to the
  document. `injectConnectionUI()` already builds an `injectedRows` array and a `queryInjected()`
  helper for exactly this reason ([`:713-734`](../pages/_lib/connection-ui.js#L713-L734)) — the
  scoping mechanism exists and simply is not used by `initializeSpecificIntegrationUI()`.

The alternative — a sibling function duplicating `:1270-1430` — is **rejected**: the mandatory-
integration logic, the `_updatePromptQueue` serialization, and the ordering constraint
(inject → restore → `checkJsonFields()` → `updateAnthropicModelCapabilityUI()`) are subtle enough
that two copies will diverge.

**`injectConnectionUI()` itself is reusable**, with `no_chatgpt_web: true` and a per-prompt
`modelId_prefix`. Two notes:

- `no_chatgpt_web: true` is **mandatory**, not a preference. The ChatGPT Web rows carry
  **unprefixed** IDs by design, so emitting them more than once per page produces duplicate element
  IDs ([04-api-integrations.md](04-api-integrations.md#chatgpt-web)) — and this page injects once
  per prompt. It also must never offer a provider that
  [§6.1](#61-provider-resolution) rejects.
- It **seeds the model selects from global unprefixed sync keys**
  ([`:878-896`](../pages/_lib/connection-ui.js#L878-L896)) regardless of `modelId_prefix`. That is
  store-agnostic and needs no change, but it means the *stored per-prompt model* must be restored
  by the page's own restore pass, not by the injection.

### 9.3 Grouping and per-add-on controls

Prompts are **grouped by calling add-on**. Each group header shows the self-declared name plus the
real extension ID (same labelling discipline as the consent dialog, [§3.3](#33-the-consent-dialog)),
and carries **two independent controls**:

| Control | Effect |
|---|---|
| **Revoke authorization** | disables all the add-on's prompts, **preserving** them |
| **Revoke message access** | clears message access only; **prompts keep working** with `variables` |

Revoking message access **does not disable the prompts**. It is the narrower remedy, and it must be
available on its own — the user's objection is often "stop reading my mail", not "stop working".
An add-on that only ever passed `variables` is entirely unaffected by it.

Revoking authorization **preserves** the prompts and their configuration, so the user can
re-authorize later **without the add-on re-registering**. This matters because re-registration is
the add-on's decision, not the user's: if revocation deleted the prompts, a user who revoked by
mistake would be stuck until the add-on happened to call `register_prompts` again — which a
well-behaved caller does only at its own startup.

A separate **remove** action deletes everything (prompts, configuration, and the add-on record).
That is the destructive one, and the only path to the state a user needs for an uninstalled add-on
([§7.4](#74-orphans)).

### 9.4 Per-prompt configuration

Each prompt row shows: **name, description, provider, enabled toggle**, and a **Configure** panel.

The Configure panel reuses `injectConnectionUI()` with `no_chatgpt_web: true`
([§9.2](#92-the-connection-ui-cannot-be-reused-as-is)) and offers:

- **prompt text**, with the placeholder-highlighting editor (`attachEditorHighlight()`,
  `pages/_lib/editor-highlight.css`, exactly as the six feature pages use it);
- **provider**, **model**, **system prompt**, **temperature**, **max tokens**, **thinking budget**
  — whichever the selected provider exposes, which `injectConnectionUI()` already handles;
- **reset to the add-on's defaults**, restoring from the `declared_*` fields
  ([§7.2](#72-prompt-text-update-policy)).

An empty provider selection is meaningful and must be offered: it is the global-connection fallback
of [§6.1](#61-provider-resolution), not an unconfigured error state.

### 9.5 Provider-neutral defaults map to provider-prefixed keys

`default_system_prompt` and `default_temperature` arrive **provider-neutral** — the add-on does not
know, and must not know, which provider the user will pick. ThunderAI stores them under
**provider-prefixed keys**: `anthropic_system_prompt`, `google_gemini_system_instruction`,
`chatgpt_temperature`, `ollama_temperature`, and so on.

**The mapping: they are *suggested* values, pre-filled into the selected provider's fields when the
user first configures the prompt, and never re-applied afterwards.**

| Declared field | Pre-fills, per provider |
|---|---|
| `default_system_prompt` | `chatgpt_developer_messages`, `anthropic_system_prompt`, `google_gemini_system_instruction` — and nothing for `ollama` / `openai_comp`, which expose no such field |
| `default_temperature` | `<integration>_temperature` for every provider that has one |

"Never re-applied" is the load-bearing half. Once the user has configured the prompt, the stored
prefixed keys are authoritative: switching provider does **not** re-seed from the declared values,
and neither does re-registration. Re-seeding on a provider switch would silently discard a system
prompt the user wrote; re-seeding on re-registration would let an add-on overwrite the user's
settings on every update, which is precisely what
[§7.2](#72-prompt-text-update-policy) exists to prevent for the prompt text.

Note the type mismatch to handle: `default_temperature` arrives as a **number**, while
`integration_options_config` declares temperatures as **strings** (`temperature: ''`) and
`initWorker()` uses the declared type as its coercion oracle. Pre-filling must stringify.

### 9.6 Editor warning: email placeholders without message access

**If the user edits a prompt to include an email placeholder while the owning add-on lacks message
access, warn in the editor.**

The alternative outcome is the one to avoid: the user writes `{%mail_body%}`, saves, and later the
add-on's call fails — or worse, per [§6.2](#62-placeholder-resolution), *succeeds* with the literal
token `{%mail_body%}` sent to the model, producing a nonsense answer. Either way, the failure
surfaces far from the edit that caused it, in an add-on's UI, phrased in terms the user cannot
connect to anything they did.

The warning is **advisory, not blocking**: the user may legitimately be preparing a prompt ahead of
granting access. It names the specific placeholders and states that the add-on has not been granted
message access.

The check reuses the same predicate the read-mode chips use —
`placeholdersUtils.findPlaceholder()` over the built-in placeholder list — so the editor cannot
disagree with itself about what counts as an email placeholder.

### 9.7 Execution log section

The log ([§8](#8-execution-log)) renders as a section on this same page, with a **clear-log**
button.

The markup model is the spam report table
([`pages/spamfilter/mzta-spamfilter.html:149-170`](../pages/spamfilter/mzta-spamfilter.html#L149-L170)):
a `.mzta_section` with a `.mzta_prompt_title`, a `.report_scroll` wrapper, and a `<table>` whose
`<tbody>` has its own ID for dynamic rows. Note the lesson recorded in
[02-prompts.md](02-prompts.md#missing-special-prompts): the empty-state row must be appended to the
**tbody**, not to the table, or it removes the header row.

Putting the log on this page rather than in a separate viewer is deliberate: the log's audience is
someone who is already asking "what is this add-on doing?", which is the question the rest of the
page answers.

---

## 10. Error codes

| Code | Meaning |
|---|---|
| `UNKNOWN_ACTION` | `action` is not a recognized External API action |
| `INVALID_VERSION` | `version` is outside the supported window ([§2.3](#23-versioning)) |
| `INVALID_REQUEST` | malformed envelope, or missing/invalid required `data` fields |
| `NOT_AUTHORIZED` | the calling add-on lacks add-on authorization |
| `MESSAGE_ACCESS_NOT_AUTHORIZED` | `message_id` supplied without message content access |
| `AUTHORIZATION_IN_PROGRESS` | a consent window is already open ([§3.3](#33-the-consent-dialog)) |
| `PROMPT_NOT_FOUND` | no prompt with that ID is registered **by this add-on** |
| `PROMPT_NOT_ENABLED` | the prompt exists but the user has not enabled it |
| `PROVIDER_NOT_AVAILABLE` | no usable connection, or the resolved connection is `chatgpt_web` |
| `PROVIDER_ERROR` | the provider or worker failed; `message` carries the provider's text |
| `MESSAGE_NOT_FOUND` | `browser.messages.get(message_id)` found nothing |
| `INTERNAL_ERROR` | an unexpected ThunderAI-side failure |
| ~~`PROMPT_NOT_CONFIGURED`~~ | **retained but never emitted** — see [§6.1](#prompt_not_configured-is-retired) |

`PROMPT_NOT_FOUND` deliberately does not distinguish "does not exist" from "belongs to another
add-on": prompts are namespaced by `sender.id` ([§5.4](#54-register_prompts)), so another add-on's
prompt genuinely does not exist in the caller's namespace, and reporting otherwise would leak the
existence of other integrations.

---

## 11. Lifecycle and edge cases

**ThunderAI is not installed.** `browser.runtime.sendMessage` to an absent ID rejects. Callers must
catch it and treat it as "ThunderAI unavailable" — this is the same shape as
`checkSparksPresence()` ([`js/mzta-utils.js:1035`](../js/mzta-utils.js#L1035)), which wraps the
whole call in a `try`/`catch` and returns `-1` on throw. The client library
([§12](#12-client-library)) does this for the caller.

**ThunderAI is installed but too old.** `ping` returns `thunderai_version` and `api_version`; a
caller needing a feature checks before using it. Everything before 5.1.0 has no External API at all
and rejects the same way as "not installed", since `onMessageExternal` there only knows
`reload_menus` and returns `undefined` for anything else — note that this is a **resolved
`undefined`**, not a rejection, so a caller must treat a non-envelope reply as "unsupported"
rather than assuming a throw.

**ThunderAI is updated.** Storage is preserved; authorizations and configured prompts survive.
A protocol version bump keeps accepting the previous version ([§2.3](#23-versioning)).

**The calling add-on is uninstalled.** Undetectable; see [§7.4](#74-orphans). Prompts remain until
the user removes them.

**The calling add-on is reinstalled** with the same ID: it is the same add-on as far as ThunderAI is
concerned, and it recovers its authorization and its configured prompts without the user doing
anything. Since `sender.id` is the identity, and reinstallation preserves it, this is correct — an
add-on's update or reinstall should not cost the user their configuration.

**Multiple add-ons.** Each has its own authorization pair, its own namespace, its own group on the
options page, and its own log entries. They cannot see or address each other's prompts. Only one
consent dialog may be open at a time across all of them.

**Re-registration** ([§5.4](#54-register_prompts), [§7.2](#72-prompt-text-update-policy)): metadata
overwritten, user configuration preserved, prompt text per the comparison rule, `enabled` untouched
— a re-registration must never re-enable a prompt the user disabled, and must never enable one they
never enabled.

**A prompt disappears from a re-registration.** Registering `[A, B]` after `[A, B, C]` does **not**
delete `C`. Deletion is `unregister_prompts`, explicitly. Treating an absent ID as a deletion would
make a caller that registers different subsets in different code paths silently destroy the user's
configuration.

**A registration arrives while the consent dialog is open** for the same add-on: it is
`NOT_AUTHORIZED`, since authorization is not yet granted. The caller should await its
`request_authorization` before registering.

**The user revokes authorization mid-execution.** The in-flight `mzta_specialCommand` completes and
its result is returned — the authorization check happens at the head of `execute_prompt`, and there
is no mid-request abort ([04-api-integrations.md](04-api-integrations.md), the same v1 limitation
as batch cancellation). Subsequent calls are `NOT_AUTHORIZED`.

---

## 12. Design decisions and rejected alternatives

Collected here so the reasoning survives; each is argued at its own section.

| Decision | Rejected alternative | Why |
|---|---|---|
| Explicit `request_authorization` | consent as a side effect of the first `register_prompts` | the caller could not distinguish "not asked" from "denied" without causing the dialog ([§3.1](#31-two-independent-permissions)) |
| Two independent permissions | one blanket permission | a confused-deputy bypass of Thunderbird's own permission model, unbounded by anything else ([§4](#4-message-content-access)) |
| `dismissed` persists nothing | treat closing the window as `denied` | makes the safest reflex the most punitive outcome ([§3.2](#32-states-and-outcomes)) |
| No global master switch | an `external_api` on/off pref | off it silently breaks consented integrations; on it says nothing about *which* add-ons ([§3.1](#31-two-independent-permissions)) |
| Discriminate Sparks on the **action name** | discriminate on the presence of `version` | a closed enumerable set cannot grow by accident; "has a version field" can ([§2.4](#24-sparks-coexistence--a-hard-compatibility-constraint)) |
| Reject concurrent dialogs | queue them | a queue is a mechanism for stacking windows at the user ([§3.3](#33-the-consent-dialog)) |
| Authorization does not wait for the wizard | block until a connection exists | couples two independent decisions, leaves the promise pending across an interactive flow with an obvious dead end ([§3.4](#34-no-connection-configured)) |
| Global-connection fallback | `PROMPT_NOT_CONFIGURED` | an unconfigured prompt is the common case, not an error ([§6.1](#prompt_not_configured-is-retired)) |
| `PROMPT_NOT_CONFIGURED` retained-but-unused | delete the code | a published protocol; callers may switch on it, and recycling the identifier later would be dangerous ([§6.1](#prompt_not_configured-is-retired)) |
| Numeric `MessageHeader.id` | RFC `headerMessageId` | the cheap `messages.get()` route; avoids the `messages.query()` full-store search that freezes the UI ([§5.6](#message_id-is-the-numeric-messageheaderid)) |
| `variables` win per key | whole-branch precedence | lets a caller supply `message_id` and override one placeholder ([§5.6](#precedence-when-both-are-supplied)) |
| No concurrency cap or rate limit in v1 | pick a number | any cap is a guess; the log makes abuse visible and attributable ([§6.4](#64-no-concurrency-cap-and-no-rate-limit-in-v1)) |
| Metadata-only log | log prompt text and answers | a plaintext archive of email content, surviving the messages themselves ([§8](#8-execution-log)) |
| Log rejected calls too | log only executions | the rejected calls are the ones a remote developer cannot diagnose ([§8](#8-execution-log)) |
| No automatic orphan cleanup | delete after N failed pings / stale `last_seen` | every signal is unreliable in the direction that loses user data ([§7.4](#74-orphans)) |
| Parameterize `initializeSpecificIntegrationUI()` | a sibling function duplicating it | the mandatory-integration logic and ordering constraints are subtle enough that two copies will diverge ([§9.2](#92-the-connection-ui-cannot-be-reused-as-is)) |
| Declared defaults are suggestions, applied once | re-apply on provider switch / re-registration | would silently discard the user's own system prompt ([§9.5](#95-provider-neutral-defaults-map-to-provider-prefixed-keys)) |
| Absent IDs on re-registration are not deletions | treat a shrinking list as deletion | a caller registering different subsets would destroy configuration ([§11](#11-lifecycle-and-edge-cases)) |
| No `management` permission | read the add-on's real name | wildly disproportionate to a dialog label, and an ATN review question ([§3.3](#33-the-consent-dialog)) |

---

## 13. Client library

A helper for third-party developers, shipped in the repo so the published documentation can point
at a canonical copy.

**Location:** `external-api/thunderai-client.js`, at the repo root — deliberately **outside** `js/`,
because it is not part of the add-on. It is not loaded by `manifest.json`, not imported by any
ThunderAI module, and not part of the packaged XPI; it is source for *other* developers to copy
into their own add-on.

**Shape:** a small ES6 module wrapping `browser.runtime.sendMessage("thunderai@micz.it", …)` —
envelope construction, the `version` constant, the not-installed rejection of
[§11](#11-lifecycle-and-edge-cases) turned into a clean result, and one method per action.

It must be extended with the **two authorization actions**, `request_authorization` and
`get_authorization_status`, which the v1.0 draft's version predates
([§3](#3-authorization-model)).

The library is **written in Phase 5**; this section fixes only its shape and location.

---

## 14. Implementation roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | This internal specification | **done** |
| **1** | Registry and storage: `js/mzta-external-prompts.js`, the three storage shapes ([§7](#7-storage)), the prompt update policy ([§7.2](#72-prompt-text-update-policy)), new prefs | pending |
| **2** | Protocol: `js/mzta-external-api.js`, envelope validation and Sparks discrimination ([§2](#2-transport-envelope-versioning-sparks-coexistence)), routing, error codes ([§10](#10-error-codes)), the authorization actions and the consent dialog ([§3](#3-authorization-model)). `execute_prompt` present but limited to its authorization checks | pending |
| **3** | Execution: placeholder resolution ([§6.2](#62-placeholder-resolution)), `mzta_specialCommand` integration ([§6.3](#63-execution-through-mzta_specialcommand)), the execution log ([§8](#8-execution-log)) | pending |
| **4** | External Prompts options page ([§9](#9-external-prompts-options-page)), including the `connection-ui.js` parameterization of [§9.2](#92-the-connection-ui-cannot-be-reused-as-is); i18n strings; options button | pending |
| **5** | Client library ([§13](#13-client-library)), developer documentation, CHANGELOG, public specification refresh | pending |

Phase 4 is the only phase that changes existing shared code (`pages/_lib/connection-ui.js`);
Phases 1–3 are additive. Phase 2 depends on Phase 1's store; Phase 3 depends on Phase 2's routing;
Phase 4 depends on Phase 1's store and Phase 3's log.

### Open questions

Two points these decisions leave genuinely open. They are recorded rather than guessed, because
each has a real cost either way and the answer belongs to the phase that hits it.

1. **Who supplies the full MIME message, and when.** `getPlaceholdersValues()` needs `msg_text` and
   `body_text`, which on the automatic paths come from `getMailBody(fullMessage, messageId)` after
   a `browser.messages.getFull()`. Whether the external path always pays that cost on any
   `message_id` call, or inspects which placeholders are actually present in the resolved text and
   fetches lazily, is a real latency/complexity trade-off — most external prompts will use one or
   two placeholders, and `getFull()` on a large message with attachments is not free. Phase 3
   decides. Note that `01-architecture.md` already documents the lazy pattern
   (`ensureFullMessage()` / `ensureBodyText()` in `processEmails()`) as the shape to copy if lazy
   wins.

2. **Ordering between `request_authorization` and `register_prompts` on a first contact.** The
   consent dialog is specified to show "the number and names of the prompts about to be registered"
   ([§3.3](#33-the-consent-dialog)), but `request_authorization` carries no prompts and
   `register_prompts` requires authorization it does not yet have. Three shapes are possible —
   `request_authorization` gains an optional `prompts` preview payload; the dialog shows a prompt
   count of zero on a bare first contact and the add-on registers immediately after; or
   `register_prompts` is allowed to trigger the dialog for an unknown add-on as a special case
   (which reintroduces the implicit-consent shape [§3.1](#31-two-independent-permissions) rejects).
   Phase 2 must pick one; the choice changes the `request_authorization` payload and therefore the
   client library.
