# Smart bar (issue #914, phases 1 and 2)

A text bar in the message display where the user types what they want done with the mail
("tag it urgent and reply confirming"). A first AI call, the **router**, reads the instruction
and answers which **operations** it asks for; each operation then runs through the existing
pipeline of its feature. Nothing is ever sent automatically: every operation acts on the message
itself (tags, the summary panel, the translation panel) or opens a compose window the user reviews
and sends.

Phase 1 shipped the bar, the router, the operation registry with three operations (`tag`,
`summarize`, `translate`), the per-instruction records and the settings page. Phase 2 adds the
`compose` operation (a reply, a reply to all, a forward or a new email, see "Compose") and the
`runLast` rule. The later phases are listed at the end; the data they need is already reserved
where noted.

Files:

| File | Role |
|------|------|
| `js/mzta-smartbar-script.js` | The bar: a classic content script of the message display (shadow DOM) |
| `js/mzta-smartbar-registry.js` | The operation registry, parameter checks, plan and run of an instruction |
| `js/mzta-smartbar-router.js` | The router prompt and the checks of its answer; `askJsonObject()`, the correction attempt shared with execute |
| `js/mzta-smartbar-execute.js` | The prompt of the compose operation and the checks of its answer |
| `js/mzta-smartbar-store.js` | The per-instruction record and its states; thin calls over the `smartbar` store |
| `js/mzta-storage.js` | The `smartbar` object store (not mirrored), its cleanup rules |
| `mzta-background.js` | "The Smart bar" section: the flow, the jobs, the commands of the bar |
| `pages/smartbar/` | The settings page (one Options tab today) |

Tests: the `smartbar` area (`tests/smartbar/`, the modules), `tests/background/44-smartbar` (the
flow), `tests/dom/compose/compose-21-smartbar` (the bar), `tests/dom/compose/compose-22-quoted-split`
(the quoted part of a received mail), `tests/dom/smartbar/` (the page). The reference instructions
of the router are in [10-smartbar-router-tests.md](10-smartbar-router-tests.md).

## Feature toggle and settings

`smartbar_enabled` (default `false`) is the row "Smart bar" of the options page, with a "Manage
settings" button opening `pages/smartbar/mzta-smartbar.html`. It is an ordinary feature flag: it
needs no permission and is **not** reconciled by `_reconcileFeatureFlags()` (the operations check
their own feature, connection and permissions each time, see "Operation registry").

| Preference | Default | Meaning |
|------------|---------|---------|
| `smartbar_enabled` | `false` | The bar is injected into the message display |
| `smartbar_mode` | `'compact'` | `'disabled'` (no bar), `'compact'` (an icon that opens it), `'expanded'` (always open) |
| `smartbar_default_destination` | `'execute'` | What Enter does: `'execute'` (run the operations) or `'chat'` (open the API chat with the text) |
| `smartbar_history_size` | `20` | Past instructions offered as suggestions; `0` = none |
| `smartbar_parallel_limit` | `3` | Operations of one instruction running at once; at least `1` |
| `smartbar_retention_days` | `30` | Records older than this are removed by the cleanup; `0` = no limit |
| `smartbar_retention_max_records` | `500` | The oldest records beyond this count are removed; `0` = no limit |
| `smartbar_retention_error_days` | `7` | Records holding an error older than this are removed first; `0` = no limit |
| `smartbar_max_body_length` | `0` | Compose: characters of the email sent, the quoted part cut first; `0` = no limit |
| `smartbar_additional_instructions` | `''` | Compose: free text added to every writing request |
| `smartbar_signature` | `''` | Compose: the signature added when the instruction asks to sign without saying how (`''`: `default_sign_name`) |

`smartbar_mode` and `smartbar_default_destination` are in `PREF_ENUMS`, `smartbar_parallel_limit`
in `PREF_NUMBER_RANGES` (`min: 1`); every one is policy-settable (spec 08). The three retention
rules are also on the storage management page (spec 05).

The keyboard shortcut `_thunderai__smartbar` (manifest `commands`, default `Ctrl+Alt+B`) opens the
bar of the displayed message and puts the cursor in it (`smartbar_focus` to the tab). The settings
page shows the current shortcut (`commands.getAll()`).

### Special prompts and their connections

Three special prompts, all hidden from the prompt lists (`show_in: "none"`), each with its own
per-feature connection (`special_prompts_with_integration`, spec 02 / 05):

| Prompt | Connection prefix | Used for |
|--------|-------------------|----------|
| `prompt_smartbar_router` | `smartbar_router` | The router call |
| `prompt_smartbar_execute` | `smartbar_execute` | The compose operation: the generative operations that have no prompt of their own (see "Compose") |
| `prompt_smartbar_chat` | `smartbar_chat` | The chat destination and "Open in chat" |

The settings page shows the three connection panels, one section each, built by
`initializeSpecificIntegrationUI({ root, anchorId })` scoped to its section (`pages/_lib/connection-ui.js`):
the same panel as the other feature pages, three times on one page. The execute section ("Writing
emails") explains what is sent and that recipients are never filled in, and holds the three compose
settings; the chat panel carries a note that it is used by the chat only.

## Bar

`js/mzta-smartbar-script.js` is registered with the message display scripts (after
`js/mzta-compose-script.js`) and injected again into the open tabs at startup, like them. It is a
classic script (an IIFE): it reads no preference itself.

- At load it sends `smartbar_get_state`; the answer gives the config (`enabled`, `mode`,
  `defaultDestination`, `historySize`), the displayed `headerMessageId`, the current `seq`, the
  state of the message (its last record, whether an instruction runs, the operations available)
  and the suggestions. With the feature off, the mode `disabled` or no displayed message, nothing
  is drawn.
- The bar lives in a host `#mzta-smartbar-host` with an open shadow root, placed right after
  ThunderAI's `#mzta-container` (else at the top of the body), so the mail's styles never reach it
  and it never reaches the mail. A host left by a previous injection is replaced. The host id is in
  `MZTA_INJECTED_SELECTORS`, so the body extraction never reads it. It follows
  `prefers-color-scheme` and is hidden in print. It is static (not sticky).
- **Compact** mode: an icon at the right, with a dot showing the state of the message (running,
  pending confirmation, error); a click opens the bar, ✕ or Escape closes it. **Expanded** mode:
  the bar is always open, with no ✕.
- The input is a multiline textarea that grows up to four lines. Two buttons: the default
  destination (➤ execute or 💬 chat) and the other one; Stop while an instruction runs.
- A `smartbar_config` message (any change of the four config preferences, sent to every message
  display tab) redraws the bar, or removes it.
- "Details" opens the settings page (`smartbar_open_page`).
- `{%…%}` placeholders: the bar loads the prompt editors' autocomplete
  (`js/mzta-placeholders-autocomplete.js`) with a dynamic `import()` when the engine allows it in a
  content script, with the list from `smartbar_placeholders`; without it the bar works the same.
  Typed placeholders are honored, see "Placeholders".

### Keyboard

- Enter sends to the default destination; Shift+Enter is a new line.
- A key during an IME composition (`isComposing`, or `keyCode` 229) does nothing.
- Every `keydown`, `keyup` and `keypress` in the textarea stops propagating: Thunderbird's
  single-key shortcuts (`j`, `k`, Delete...) never see a key typed in the bar.
- ArrowUp in an empty bar recalls the last instruction; ArrowDown opens the suggestions; typing
  filters them; ArrowUp / ArrowDown move, Enter picks, Escape closes the list.
- Escape closes the compact bar (blurs the expanded one).

### Result lines

Under the input, the last record of the message, one line per item:

- while the router works: one "Understanding the instruction…" line with Stop, and the model's
  reasoning in a collapsed `<details>` when the router connection streams it (`smartbar_thinking`,
  sent at most every 250 ms, never stored);
- one line per operation with its state (running with Stop, pending confirmation with Confirm and
  Cancel, done with its result text, cancelled, error with Retry and Remove, plus "Open in chat"
  for a json error); the result texts are i18n strings of the add-on, never the model's words. A
  compose line is named by its type ("Reply", "Reply to all", "Forward", "New email"); done, it
  reads "Reply to all: compose window opened", with "— recipient to add: Marco" when the
  instruction named a recipient;
- an instruction-level error (the router failed) with Retry and Remove, plus "Open in chat" for a
  json error;
- a rate-limited error shows the seconds left and retries **once** by itself, then only Retry;
- the reports of the plan (`unknown`, `unavailable`, `duplicate` operation);
- the unrecognized part of the instruction, with "Open in chat";
- "Nothing matched", with the operations available, when the router found no operation;
- "Interrupted" for a record cut short by the end of the previous session.

Done and cancelled lines, reports and the unrecognized line can be dismissed (×,
`smartbar_dismiss`): stored on the record, so they stay gone on the next visit.

Every update reaches the bar as `smartbar_update` with an increasing `seq` and its
`headerMessageId`: an update older than the one drawn, or for another message, is ignored. The
record sent to the bar never carries the raw answers (`hasRawResponse` instead), nor the text a
compose line generated (its result keeps `type` and `recipient` only).

## Flow

Every command of the bar names its message; the background answers it only from a tab that
displays that message (`not_displayed` otherwise).

1. `smartbar_run { headerMessageId, instruction, hasSelection, selection }`: refused when the
   feature is off (`disabled`) or the instruction is empty (`empty`). `selection` is the text
   selected in the mail, read by the bar when the instruction is sent (the focus is in the bar by
   then): only the compose operation uses it (`selected_text`), the router is only told whether
   there is one. `smartbar_retry` carries the same two fields.
2. The previous instruction of the message, if one runs, is replaced (see "Replacement").
3. A record is created (state `running`) and pushed to the bar.
4. A job `smartbar` runs the router (see "Router").
5. The router's operations are checked against the registry (`planOperations()`): the record gets
   its operations, reports, unrecognized part and context, and is pushed.
6. The operations run (`runPlanned()`), each through its executor; the record is stored at every
   meaningful point and pushed at every change.
7. The record ends `done`, `error` or `pending_confirmation` (derived from its operations).

The other commands: `smartbar_stop` (the whole instruction, or one operation by `index`),
`smartbar_retry` (the router of a failed instruction: a new instruction with the same text; or one
failed operation: that line alone, run again in a new group; a compose line whose window could not
open is opened again with its stored text, see "Compose"), `smartbar_confirm` /
`smartbar_cancel` (an operation waiting), `smartbar_dismiss`, `smartbar_open_chat`.

**Chat destination** (and "Open in chat"): the API chat window opens with the text and the mail, as
for a prompt run on the message (a regular prompt, so the user goes on in the chat), on the
`smartbar_chat` connection. Nothing is stored.

## Operation registry

`js/mzta-smartbar-registry.js` imports nothing; the executors live in the background and reach
`run()` through `ctx.executors`. An operation is one entry:

| Field | Meaning |
|-------|---------|
| `id` | Stable lowercase identifier |
| `description` | For the router (English): what it does and when to pick it |
| `params` | `{ name: { type: 'string' \| 'string[]' \| 'boolean', enum?, required?, description } }`, optional unless `required` |
| `requirements(env)` | Whether it can run now: feature on, connection usable, permissions granted |
| `multiple` | Whether it may appear more than once in one instruction (`false` for all four) |
| `risk` | `'direct'`, or `'confirm'` (waits for the user's Confirm) |
| `runLast` | Optional: runs after every other operation of the instruction has ended (compose) |
| `deliverInChat` | Optional, reserved for the deferred delivery of phase 3 (compose sets it; this version always delivers by opening the compose window) |
| `dependsOn(ops, index)` | The earlier operations it waits for: a static rule, never the model's |
| `run(ctx)` | Resolves `{ state, result, error, errorType, rawResponse, retryAt }` |

`ctx` holds the message, the params, the instruction's signal and group, the line's index, the tab,
the executors, and for the generative operations the instruction, the router's context, the
selected text and `previousResult` (the stored result of a compose line whose window could not
open).

The four operations of this version:

| id | params | Runs | Requires |
|----|--------|------|----------|
| `tag` | `tags: string[]` | With `tags`: those tags assigned through the add-tags assignment (its exclusions, its rule on creating missing tags), no model call. Without: the Add Tags special command pipeline | `add_tags` on, its permissions, its connection usable |
| `summarize` | none | The Summarize pipeline as the panel button runs it (prompt, connection, the summary store, the panel) | `summarize` on, its connection usable |
| `translate` | `language: string` | The Translate pipeline, into `language` when given (a translation into another language than the stored one is a new call, not the cache) | `translate` on, its connection usable |
| `compose` | `type: 'reply' \| 'reply_all' \| 'forward' \| 'new'`, required | Writes an email from this one and opens it in a compose window (see "Compose"); `runLast`, `deliverInChat` | the `smartbar_execute` connection usable (no feature switch of its own) |

**Availability**: only the operations whose requirements hold are offered to the router; one the
router names anyway is not run and is reported `unavailable`.

**Parameters** (`validateParams()`): an unknown parameter is refused (so is a recipient given to
compose); types are coerced only where nothing can be lost (a number to a string, one string to a
one-item list, `"true"` / `"false"`); an empty value is the same as an absent one; an enumeration
is checked; a `required` parameter must be there once the empty values are dropped. Invalid
parameters keep the line in `error` (`errorType` `params`); the other lines still run.

**Plan** (`planOperations()`): the user's order is the run order, but the `runLast` operations go
after the others (their own order kept): the router gives "reply and summarize" in that order,
the plan runs summarize then compose, and a line's `index` is its run order. An unknown id is
reported `unknown`, a second instance of a single-instance operation `duplicate`; `dependsOn` only
names earlier lines (no cycle can form). `runLast` is a property of the registry entry, never a
special case by id.

**Run** (`runPlanned()`): at most `smartbar_parallel_limit` lines at once, first come first served;
a line waits for its dependencies and is cancelled when one did not end `done`; a `runLast` line
starts only once every other line before it has ended, in whatever state (a failed summary does
not stop the reply), without holding a slot meanwhile, so the compose window opens at the end and
steals no focus mid-way; a `confirm` line waits for the answer without holding a slot; once the
instruction is stopped, the lines not started are cancelled.

Adding an operation means one entry in the registry, its executor in the background and its i18n
strings; [10-smartbar-router-tests.md](10-smartbar-router-tests.md) has to follow (its test checks
it against the registry).

## Router

The router is a special command (`mzta_specialCommand`, spec 04) on the `smartbar_router`
connection, with the text of `prompt_smartbar_router`. It must be an API connection; ChatGPT Web
is refused (`smartbar_error_no_connection`).

**It never receives the email body.** A prompt injection in the mail must not be able to choose
the operations or their parameters. The prompt is, in this order:

1. the editable text of the special prompt with its variables substituted: `{OPERATIONS}` (the
   available operations, `describeOperations()`), `{PLACEHOLDERS}` (the allow list, see
   "Placeholders"), `{LANGUAGE_RULE}` (free-text values as the user wrote them; no language
   parameter when none is named). A variable the text lacks has its content appended, so the
   router always sees the operations;
2. the JSON section, **locked**: appended by the add-on, never part of the editable text;
3. the instruction and the metadata: subject, sender **name**, participant **names** (never an
   address), the tags of the account, whether text is selected.

The answer: `{"operations": [{"id", "params"}], "context": [], "unrecognized": ""}`.

- The reasoning is stripped by the special command, as for every special command; the answer is
  read tolerantly (text around the object, a code fence).
- JSON mode is asked where it is reliable: OpenAI Responses `json_object` (unless the user set a
  text format), Gemini `responseMimeType: application/json`, Ollama `format: json`. OpenAI-compatible
  servers and Anthropic rely on the tolerant reading (their JSON support varies).
- An answer that is not a JSON object gets **one correction attempt** (the prompt again with a
  correction line, `askJsonObject()`, shared with the compose operation). A second failure ends
  the instruction in `error`, `errorType` `json`, with the second raw answer kept (`rawResponse`,
  capped) and "Open in chat" offered.
- The default text tells the router that the details the user gives about an operation (who to
  send it to, what to say, the tone) belong to that operation, not to `unrecognized`: "forward it
  to Marco" is a forward, with nothing unrecognized.
- `operations` missing counts as none; an empty `unrecognized` is none.

## Placeholders

The router may ask for information beyond the body through `context`: placeholder ids from an
**allow list**, the built-in placeholders of a reading context but `empty`, `additional_text`,
`mail_typed_text` and the composing-only ones (type 2). The add-on keeps of `context`:

- the ids of the allow list (a dynamic one with its parameter, e.g. `mail_text_body:2000`);
- `selected_text` when text is selected: a fixed rule of the add-on, never the router's;
- the `{%…%}` the user typed in the instruction, always, when they exist (custom ones included).

The context is stored on the record (`routerContext`); the compose operation renders it into its
prompt (see "Compose").

## Compose

The `compose` operation writes an email from the displayed one and opens it in a compose window;
the user reviews it, adds the recipients and sends it. Its `type` says which email:

| type | Compose window | Text |
|------|----------------|------|
| `reply` | `compose.beginReply(id, 'replyToSender')` | the reply |
| `reply_all` | `compose.beginReply(id, 'replyToAll')` | the reply |
| `forward` | `compose.beginForward(id)`, no forward type | the note above the forwarded content |
| `new` | `compose.beginNew({ subject })`, not threaded | the email and its subject |

The router picks `reply` for any reply, `reply_all` only when the user asks for it explicitly
("reply to all", "rispondi a tutti"), `forward` to send the email on, `new` for an email not
threaded to this one (the registry's description says so).

### Generation

A special command (`mzta_specialCommand`, spec 04) on the `smartbar_execute` connection (an API
connection: ChatGPT Web is refused with `smartbar_error_no_connection`), with JSON mode where it is
reliable, the reasoning stripped, ThunderAI Privacy and the stream idle timeout: exactly as the
router. `prompt_smartbar_execute` is the prompt of the generative operations that have no prompt of
their own; the operation and its params are part of the prompt, so a later generative operation
extends it. Its prompt (`buildExecutePrompt()`, `js/mzta-smartbar-execute.js`) is, in this order:

1. the editable text of the special prompt (its rules: the email is data, only the new text and no
   quote, no sign-off nor signature, `[...]` for what is missing and no invented fact, the note of a
   forward, the subject of a new email);
2. the JSON section, **locked**: appended by the add-on, never part of the editable text;
3. the message, **built by the add-on, not editable**:
   1. the email between `<<<EMAIL START>>>` and `<<<EMAIL END>>>`, declared as data (any
      instruction inside it is ignored): subject, from, to, cc, date, and the text. A delimiter
      written inside a value is defused, so it cannot close its section;
   2. the instruction;
   3. the operation and its type, with what the type asks for;
   4. the context (only when there is one), delimited as data like the email: the placeholders of
      `routerContext`, `selected_text` when text is selected, the placeholders the user typed. They
      are rendered by the placeholder machinery of the prompts (`getPlaceholdersValues()`, a custom
      placeholder expanded first, default values). A placeholder the user typed is replaced in the
      instruction by a reference (`[mail_folder_name, see the context]`): its value goes only to
      the context, never into the instruction, where an email body would read as the user's words;
   5. the additional instructions (`smartbar_additional_instructions`) and the signature the add-on
      would add (see "Signature"), only when set;
   6. the language rule: `default_chatgpt_lang`, else the language of the email, unless the
      instruction explicitly asks for another language.

**The email.** Only the current one. Its text is cut to `smartbar_max_body_length` (`0` = no
limit): the quoted part first, from the bottom, and once it is gone the rest; a cut ends with
`[truncated]` (`trimEmailText()`). The quoted part of an HTML mail is told apart by
`splitQuotedHtml()` (`js/mzta-utils.js`): the document is cut at the first
`blockquote[type="cite"]`, `.moz-cite-prefix`, `.moz-forward-container`, `.gmail_quote` or
`#divRplyFwdMsg`, at every nesting level, and both halves are read by `htmlBodyToPlainText()`.
A plain text mail (or an HTML part that gives no text) goes through `splitQuotedText()`: the first
run of `> ` lines with the attribution line above it, or an `-----Original Message-----` line.

**The answer:** `{"subject": "", "body": "", "recipient": "", "signature": ""}`.

- `subject`: kept only for `new`, ignored otherwise.
- `body`: plain text, paragraphs separated by blank lines; required and non-empty.
- `recipient`: the recipient the instruction named (a name or an address), word for word; shown
  in the result line as a reminder, **never** put in a recipient field.
- `signature`: `''` when the instruction does not ask to sign, `'default'` when it asks to sign
  without saying how, otherwise the signature it dictates.

An answer that is not a JSON object, or has no `body`, gets one correction attempt; a second
failure ends the line in `error`, `errorType` `json`, with the second raw answer kept
(`rawResponse`, capped) and "Open in chat" offered. No window opens.

### Signature

The model never writes a signature: the add-on adds it under the body, from the answer's
`signature` (`resolveSignature()`): none when the instruction did not ask to sign; the dictated
text as it is; for `'default'`, `smartbar_signature`, or `default_sign_name` when it is empty.
Thunderbird's own identity signature is Thunderbird's: the compose window holds it as for any
reply, and the text goes above it.

### Delivery

The compose window opens automatically when the generation ends, through the same code as the API
chat's reply (`chatgpt_replyMessage`): `_beginComposeWindow()` in `mzta-background.js`.

- The identity is `getCurrentIdentity()`'s. A reply keeps `chatgpt_replyMessage`'s details
  (`{ type: "reply", identityId }`, `isPlainText` not forced, so the identity's compose format is
  followed), so the two open the very same window; only the text differs.
- **Recipients**: never set. A reply gets Thunderbird's own; a forward and a new email have an
  empty To, which the user fills in. No address book, header or identity lookup.
- **Forward**: `beginForward()` with no forward type, so Thunderbird's preference decides inline
  or as attachment, and Thunderbird builds the forwarded content (an inline forward's
  `.moz-forward-container`) or attaches the message itself. No `body` is ever passed to
  `beginForward()` or `setComposeDetails()`: it would replace the forwarded content. The note goes
  in afterwards, like a reply's text.
- **The text** is written after the window has loaded (`COMPOSE_SCRIPT_LOAD_DELAY_MS`, 500 ms for
  its compose script) by `_insertComposeAnswer()`, the API chat's reply insertion: `insertReply`
  through the compose script, as an editor command (one Ctrl+Z takes it out), above the first
  quote, forwarded content or signature (on top of an empty body for an attachment forward or a
  new email); `replaceBody()` only when the script never answers. The body (with the signature) is
  turned into HTML by `plainTextToHtml()` (a `<p>` per paragraph, `<br>` per line, everything
  escaped) and passes `sanitizeBlockHtml()`; a plain text window gets it back as text.
- Previous compose windows are never closed.
- The line is `done` once the window is open; its `result` keeps `{ type, subject, body, recipient,
  signature }` (texts capped like `rawResponse`). A window that could not open ends the line in
  `error`, `errorType` `compose_window`, with that result: Retry opens it again with the stored
  text, without a new generation (`previousResult`). The record's `draft` stays reserved for
  phase 3.
- **Abort**: a generation stopped (Stop of the line or of the instruction, a replacement) ends the
  line `cancelled` and never opens a window; the worker is disposed at once, so no late answer
  arrives.

## Jobs

One instruction is one group of jobs in `taJobRegistry` (spec 01 "In-flight jobs"), with a
`groupId`: the router job (kind `smartbar`) and one job per operation in its own feature's kind
(`add_tags`, `summary`, `translation`; `smartbar_compose` for compose, which no one else starts).
Each entry has an `AbortController`;
`taJobRegistry.abortGroup(groupId)` invalidates then aborts every entry of the group. So:

- an operation that finds a job of its kind already running on the message (the automatic
  processing of incoming mail, the context menu, the panel button) **joins** it, as the other
  callers do;
- the jobs of a batch carry no group: a Smart bar Stop or replacement **never** stops them;
- Stop of one operation aborts that operation's job only if it belongs to the instruction's group;
- the working status counts the router and every operation.

## Replacement

A new instruction on a message whose previous one still runs **replaces** it: the previous group
is aborted, its waiting confirmations cancelled, its record marked `replaced` (its unfinished
operations `cancelled`). A record that already ended is never changed. When the last record of the
message still shows errors the user has not dismissed, the bar shows a notice
(`replaced_with_errors`). The new record keeps the bar's `sessionId` of that message.

## Storage

One record per instruction in the `smartbar` object store of the per-message database (spec 01
"Per-Message Data Storage"), keyed by an auto-increment `id`, indexes `messageId`, `sessionId`,
`createdAt`, `size`, `failed_createdAt`, `state` and `state_failed_createdAt`
(`[state, failed, createdAt]`).

- **Not mirrored**: nothing is written to `storage.local`, the reconcile with the mirror ignores the
  store, a database found new is not rebuilt for it. The history is lost if Thunderbird evicts the
  database (the settings page says so).
- A record holds `messageId`, `createdAt`, `subject` / `from` / `message_date`, `groupId`,
  `sessionId`, `source` (`'bar'`), `instruction`, `state`, `unrecognized`, `routerContext`,
  `reports`, `error`, `errorType`, `rawResponse`, `retryAt`, `operations`, `dismissed`, and
  `answer` / `draft` (reserved for phase 3, `null`). `failed` and `size` are computed on write.
- An operation holds `index`, `id`, `params`, `state`, `result`, `error`, `errorType`,
  `rawResponse`, `retryAt`, `dependsOn`, `finishedAt`, and `dismissed` / `autoRetried` when set.
  A compose line's `result` is the generated text (see "Compose"), kept for a retry of its window.
- `rawResponse` is capped at 8000 characters, `answer` at 20000.
- Record states: `running`, `pending_confirmation`, `error`, `done`, `interrupted`, `replaced`.
  Operation states: `running`, `pending_confirmation`, `drafted` (reserved), `done`, `error`,
  `cancelled`. A record's state is derived from its operations (`deriveState()`), but `replaced`
  and `interrupted`, which the background sets.
- A record is written only at the meaningful points: created, an operation reaching
  `pending_confirmation` or a final state, a `retryAt` set, the instruction replaced or dismissed.
  Progress and reasoning are never stored. A save on a record removed meanwhile does not put it
  back.
- At startup every record still `running` becomes `interrupted`, its unfinished operations
  `cancelled` (`taSmartbarStore.markInterrupted()`).
- **Retention**: the cleanup applies to the store the three rules of the other types:
  `smartbar_retention_error_days` (records holding an error), `smartbar_retention_days`,
  `smartbar_retention_max_records`. A `running` record is never removed by any bulk removal
  (`clear()` included); `previewCleanup()` counts the same, from the indexes only.
- The storage management page shows the store in the overview, its three rules and a "Delete all"
  button; its entry list and orphan scan stay on the three message types (they are keyed on the
  Message-ID). `removeEntries()` answers only those three.
- The suggestions are the distinct instructions of the store, most recent first
  (`recentInstructions(smartbar_history_size)`).

## Later phases

- **Phase 2** (this version): the `compose` operation and `runLast`. No operation uses
  `risk: 'confirm'` yet; the registry and the bar support it.
- **Phase 3**: the chat mode with `deliver_draft` (`drafted` state, `answer` / `draft` fields,
  `source: 'chat'`, the deferred delivery of the operations with `deliverInChat`).
- **Phase 4**: the Activity tab of the settings page (the records, their raw answers).
