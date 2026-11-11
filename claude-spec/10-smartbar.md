# SmartBar (issue #914)

A text bar in the message display where the user types what they want done with the mail
("tag it urgent and reply confirming"). A first AI call, the **router**, reads the instruction
and answers which **operations** it asks for; each operation then runs through the existing
pipeline of its feature. Nothing is ever sent automatically: every operation acts on the message
itself (tags, the summary panel, the translation panel, the spam report) or opens a window the user
reviews: a compose window to send, a calendar event or task dialog to save.

The feature has the bar, the router, the operation registry with ten operations (`tag`,
`summarize`, `translate`, `delete_summary`, `delete_translation`, `spam_check`, `calendar_event`,
`task`, `compose`: a reply, a reply to all, a forward or a new email, see "Compose";
`deliver_draft`), the per-instruction records, the chat (see "Chat": the API chat window
opened in SmartBar mode, where every message goes through the router, a message no operation
covers gets a free answer, and an email is written as a draft the user creates later), the feature
page with its Options, Prompts and Activity tabs (see "Feature page") and the badge (see "Badge").
What is left out on purpose is listed at the end ("Deferred").

Files:

| File | Role |
|------|------|
| `js/mzta-smartbar-script.js` | The bar: a classic content script of the message display (shadow DOM) |
| `js/mzta-smartbar-registry.js` | The operation registry, parameter checks, plan and run of an instruction |
| `js/mzta-smartbar-router.js` | The router prompt and the checks of its answer; `askJsonObject()`, the correction attempt shared with execute |
| `js/mzta-smartbar-execute.js` | The prompt of the compose operation and the checks of its answer; the email and data sections shared with the chat |
| `js/mzta-smartbar-chat.js` | The chat: the conversation of a session as the prompts carry it, the prompt of the free answer |
| `js/lib/mzta-smartbar-lines.js` | The texts of the result lines (a classic script, global `mztaSmartbarLines`), shared by the bar and the chat |
| `api_webchat/smartbarChat.js` | The chat window in SmartBar mode: the channel to the background, the turns it draws |
| `js/mzta-smartbar-store.js` | The per-instruction record and its states; thin calls over the `smartbar` store |
| `js/mzta-storage.js` | The `smartbar` object store (not mirrored), its cleanup rules |
| `mzta-background.js` | "The SmartBar" section: the flow, the jobs, the commands of the bar and of the chat |
| `pages/smartbar/` | The feature page: Options (`mzta-smartbar.js`), Prompts (`mzta-smartbar-prompts.js`), Activity (`mzta-smartbar-activity.js`) |
| `pages/_lib/prompt-update.js` | The comparison of a prompt text with a newer default (the change picker in a box) |

Tests: the `smartbar` area (`tests/smartbar/`, the modules), `tests/background/44-smartbar` (the
flow), `tests/background/47-smartbar-more-ops` (the deletions, the spam check, the calendar event
and the task), `tests/dom/compose/compose-10-panels` (the panels taken out by a deletion), `tests/dom/compose/compose-21-smartbar` (the bar), `tests/dom/compose/compose-22-quoted-split`
(the quoted part of a received mail), `tests/dom/smartbar/` (the page), `tests/background/45-smartbar-chat`
(the chat flow), `tests/dom/webchat/webchat-24-smartbar` (the chat window in SmartBar mode),
`tests/smartbar/07-activity` (the store's queries, the badge counts, the default filter),
`tests/background/46-smartbar-activity` (the page's commands, the badge, the page opened once),
`tests/dom/smartbar/ui-02` to `ui-06` (the Prompts and Activity tabs, the tab of the hash). The reference instructions
of the router are in [10-smartbar-router-tests.md](10-smartbar-router-tests.md).

## Feature toggle and settings

`smartbar_enabled` (default `false`) is the row "SmartBar" of the options page, with a "Manage
settings" button opening the feature page (`smartbar_open_page`, see "Feature page"). It is an ordinary feature flag: it
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
| `prompt_smartbar_chat` | `smartbar_chat` | The chat: the window it opens on, and the free answer of a message no operation covers (see "Chat") |

The Actions tab of the feature page shows the three connection panels, each in a card of its own,
the first of the sub-tab of its action, before the prompt, built by
`initializeSpecificIntegrationUI({ root, anchorId })` scoped to that section
(`pages/_lib/connection-ui.js`): the same panel as the other feature pages, three times on one
page. The router's switch recommends a small, fast model. Execute's sub-tab also holds, before its
prompt, the execute settings section ("Writing settings": what is sent, recipients never filled
in, the three compose settings).

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
  `prefers-color-scheme` and is hidden in print. It is static (not sticky). The open bar is a card
  set apart from the mail: an 8px margin, rounded corners (10px), a soft shadow (stronger in the
  dark scheme), a 3px accent stripe on its left border and a background lightly tinted with the
  accent (`#eef3fa` light, `#1f2733` dark); the compact icon keeps the same side
  margin, so it lines up with the card.
- **Compact** mode: an icon at the right, with a dot showing the state of the message (running,
  pending confirmation, error); a click opens the bar, ✕ or Escape closes it. **Expanded** mode:
  the bar is always open, with no ✕.
- The input is a multiline textarea that grows up to four lines. Two buttons: the default
  destination (➤ execute or 💬 chat) and the other one; Stop while an instruction runs.
- A `smartbar_config` message (any change of the four config preferences, sent to every message
  display tab) redraws the bar, or removes it.
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

The texts of the lines (`opLabel()`, `opText()`, the state icons) are in `js/lib/mzta-smartbar-lines.js`, a
classic script the message display loads before the bar and the chat window imports, so a line reads
the same in both.

A record of the chat (the newest record of the message) is drawn the same way, with two lines of
its own: a draft (`drafted`) reads "Reply: draft ready in the chat", with "Open in chat"; a free
answer is the line "Answered in the chat." (`hasAnswer`, the text stays in the chat), with "Open
in chat". Stop (the routing line's and an operation's), Confirm and Cancel name the record
(`recordId`), so they reach a message of the chat too.

Done and cancelled lines, reports, the unrecognized line (with "Answered in the chat." and
"Nothing matched") and the "replaced with errors" notice can be dismissed: the line has no button
of its own for it, its state symbol (✓, ℹ, ?, 💬...) is the button, with the tooltip "Dismiss"
(`smartbar_dismiss_line`). It sends `smartbar_dismiss`, stored on the record, so the line stays
gone on the next visit; the notice is hidden by the bar only. The bar has no link to the feature
page (the chat window keeps its "Details").

Stop works the same way on a running line (the routing line and a running operation): no Stop
on the right of the line, its state symbol is replaced by a red square button, with the tooltip
"Stop" (`smartbar_stop`). An error line (an operation's or the instruction's) has Retry (↻) and
Remove (✕) as symbol buttons right after its ⚠, before the text, with the tooltips "Retry" and
"Remove"; the rate-limit countdown and "Open in chat" stay after the text. The chat window keeps
its own buttons (Stop, ×, Retry, Remove) on the right.

Every update reaches the bar as `smartbar_update` with an increasing `seq` and its
`headerMessageId`: an update older than the one drawn, or for another message, is ignored. The
record sent to the bar never carries the raw answers (`hasRawResponse` instead), nor the text a
compose line generated (its result keeps `type` and `recipient` only), nor the chat's `answer`
(`hasAnswer` instead) and `draft`.

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

**Chat destination** (and "Open in chat"): the chat of the message opens in SmartBar mode, or comes
to front, and the text becomes its next message (see "Chat"). "Open in chat" on a `json` error
prefills the instruction instead, and attaches the unreadable answer to the next message.

## Operation registry

`js/mzta-smartbar-registry.js` imports nothing; the executors live in the background and reach
`run()` through `ctx.executors`. An operation is one entry:

| Field | Meaning |
|-------|---------|
| `id` | Stable lowercase identifier |
| `description` | For the router (English): what it does and when to pick it |
| `params` | `{ name: { type: 'string' \| 'string[]' \| 'boolean', enum?, required?, description } }`, optional unless `required` |
| `requirements(env)` | Whether it can run now: feature on, connection usable, permissions granted; `env.source` (`'bar'` / `'chat'`) and `env.draft` (the chat session's current draft, or `null`) too |
| `multiple` | Whether it may appear more than once in one instruction (`false` for all ten) |
| `risk` | `'direct'`, or `'confirm'` (waits for the user's Confirm) |
| `runLast` | Optional: runs after every other operation of the instruction has ended (compose, calendar_event, task: the window they open steals the focus) |
| `deliverInChat` | Optional: in the chat the operation does not deliver when it ends, it ends `drafted` and the user delivers it later (compose) |
| `dependsOn(ops, index)` | The other operations of the instruction it waits for: a static rule, never the model's; the plan moves it after them |
| `run(ctx)` | Resolves `{ state, result, error, errorType, rawResponse, retryAt }`; `state` is `done`, `drafted`, `error` or `cancelled` |

`ctx` holds the message, the params, the instruction's signal and group, the line's index, the tab,
the executors, and for the generative operations the instruction, the router's context, the
selected text and `previousResult` (the stored result of a compose line whose window could not
open); in the chat also `source: 'chat'`, `deliverInChat`, the conversation so far, the attached
unreadable answer (`rawContext`) and `currentDraft()`.

The ten operations of this version:

| id | params | Runs | Requires |
|----|--------|------|----------|
| `tag` | `tags: string[]` | With `tags`: those tags assigned through the add-tags assignment (its exclusions, its rule on creating missing tags), no model call. Without: the Add Tags special command pipeline | `add_tags` on, its permissions, its connection usable |
| `summarize` | none | The Summarize pipeline as the panel button runs it (prompt, connection, the summary store, the panel). Waits for a `delete_summary` of the same instruction (`dependsOn`) | `summarize` on, its connection usable |
| `translate` | `language: string` | The Translate pipeline, into `language` when given (a translation into another language than the stored one is a new call, not the cache). Waits for a `delete_translation` of the same instruction | `translate` on, its connection usable |
| `delete_summary` | none | What the summary banner's Delete does, for every tab displaying the message: a summary job still running invalidated, the stored summary removed, the panel taken out (`removeSummaryPanel` to the content script), the button back where the feature shows one (`_restoreSummaryButton()`). No model call. Always `done`, `result: { removed }` (`false`: "No summary to delete") | `summarize` on (no connection: nothing is generated) |
| `delete_translation` | none | The same for the translation (`removeTranslationPanel`, `_restoreTranslationButton()`) | `translate` on |
| `spam_check` | none | The spam filter's analysis as the panel's Refresh runs it (`_generateSpamReportForMessage()`: the allow, block and address book rules, the prompt, the report stored and shown in the panel when `spamfilter_show_msg_panel`), **never** moving the message (no `autoMove`); an analysis running on the message is joined. `result: { spamValue, threshold, spam }`, the line reads "Spam check: probably spam (score 85/100)" or "not spam" | `spamfilter` on, its permissions, its connection usable |
| `calendar_event` | none | ThunderAI Sparks checked first (see "Sparks"); then the special prompt `prompt_get_calendar_event` on its connection, built as the context menu builds it (`preparePrompt()` with the body, the selected text, the custom placeholders; `finalizePrompt_get_calendar_event()` with the reminder rules), its answer read into the object Sparks receives (`buildSparksCalendarEventData()`, `js/mzta-utils.js`, shared with the menu: dates normalized, reminder, timezone, the link to the email with `calendar_append_email_link`), and Sparks' event dialog opened (`sendToSparks()`), where the user reviews and saves it. `done` once Sparks opened it. `runLast` | `get_calendar_event` on, its connection usable |
| `task` | none | The same with `prompt_get_task`, `finalizePrompt_get_task()`, `buildSparksTaskData()` (`task_append_email_link`) and Sparks' task dialog. `runLast` | `get_task` on, its connection usable |
| `compose` | `type: 'reply' \| 'reply_all' \| 'forward' \| 'new'`, required | Writes an email from this one and opens it in a compose window (see "Compose"); in the chat, a draft (see "Chat"); `runLast`, `deliverInChat` | the `smartbar_execute` connection usable (no feature switch of its own) |
| `deliver_draft` | none | Creates the email of the chat's current draft now: the delivery of Create email (see "Chat"). Waits for a `compose` of the same instruction (`dependsOn`) | the chat (`source: 'chat'`) and a current draft in its session |

No operation uses `risk: 'confirm'` yet; the registry, the bar and the chat support it. The two
deletions are `direct` like the banner's Delete: a deleted summary or translation is generated
again on request.

**Availability**: only the operations whose requirements hold are offered to the router; one the
router names anyway is not run and is reported `unavailable`.

**Sparks**: `calendar_event` and `task` open Thunderbird's dialogs through the ThunderAI Sparks
add-on. Sparks is **not** a requirement: the operations are offered with their feature and
connection, so "add it to the calendar" is always understood, and a missing Sparks is **said** in
the line instead of ending in "Nothing matched". When the line runs, before any model call,
`checkSparksPresence()` is asked again: not installed, the line ends in `error`, `errorType`
`sparks`, "This action needs the ThunderAI Sparks add-on, which is not installed."; older than
`sparks_min`, "This action needs an updated version of the ThunderAI Sparks add-on." A dialog Sparks
could not open is an `error` (`sparks`) with Sparks' message after the menu's
`calendar_opening_dialog_error` / `task_opening_dialog_error`; an answer with no JSON object an
`error` (`api`) after `calendar_getting_data_error` / `task_getting_data_error`, and nothing reaches
Sparks. Retry runs the line again (after installing Sparks, for instance). A line stopped during the
model call opens no dialog.

**Parameters** (`validateParams()`): an unknown parameter is refused (so is a recipient given to
compose); types are coerced only where nothing can be lost (a number to a string, one string to a
one-item list, `"true"` / `"false"`); an empty value is the same as an absent one; an enumeration
is checked; a `required` parameter must be there once the empty values are dropped. Invalid
parameters keep the line in `error` (`errorType` `params`); the other lines still run.

**Plan** (`planOperations()`): the user's order is the run order, with two static rules of the
registry, never the model's and never a special case by id:

- the `runLast` operations go after the others (their own order kept): the router gives "reply and
  summarize" in that order, the plan runs summarize then compose; "create an event and summarize",
  summarize then calendar_event;
- a line goes after the lines it depends on (`dependsOn`, which may name any other line of the
  instruction), even when the user named it first or when they are `runLast`: "make it shorter
  and create it" runs `compose`, then `deliver_draft`, an exception to "compose runs last"; "summarize
  again after deleting the summary" runs `delete_summary`, then `summarize`. It is a
  stable topological sort: among the lines whose dependencies are placed, the first non-`runLast`
  one in the user's order, else the first `runLast` one. A cycle keeps the user's order and drops
  the dependencies that would point forward.

A line's `index` is its run order and its `dependsOn` names earlier lines only. An unknown id is
reported `unknown`, a second instance of a single-instance operation `duplicate`.

**Run** (`runPlanned()`): at most `smartbar_parallel_limit` lines at once, first come first served;
a line waits for its dependencies and is cancelled when one did not end successfully (`done`, or
`drafted` in the chat: `SUCCESS_STATES`); a `runLast` line
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
   address), the tags of the account, whether text is selected; in the chat also `draft_exists`
   and, when it does, `draft_type` (a change asked for the draft is a `compose` of that type).

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
- The default text also covers the chat: a question about the email ("who is the sender") is no
  operation and nothing unrecognized (the chat answers it); with a draft, a change of it is a
  `compose` of its type, approving it `deliver_draft`, "make it shorter and create it" both.
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
   2. the chat only: the conversation so far (`renderConversation()`: its previous drafts and
      refinement requests, "write the new version of the latest draft"), then the unreadable model
      answer the user brought in with "Open in chat", each delimited as data
      (`<<<CONVERSATION START>>>` / `<<<CONVERSATION END>>>`);
   3. the instruction;
   4. the operation and its type, with what the type asks for;
   5. the context (only when there is one), delimited as data like the email: the placeholders of
      `routerContext`, `selected_text` when text is selected, the placeholders the user typed. They
      are rendered by the placeholder machinery of the prompts (`getPlaceholdersValues()`, a custom
      placeholder expanded first, default values). A placeholder the user typed is replaced in the
      instruction by a reference (`[mail_folder_name, see the context]`): its value goes only to
      the context, never into the instruction, where an email body would read as the user's words;
   6. the additional instructions (`smartbar_additional_instructions`) and the signature the add-on
      would add (see "Signature"), only when set;
   7. the language rule: `default_chatgpt_lang`, else the language of the email, unless the
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
  text, without a new generation (`previousResult`). In the chat no window opens: see "Chat".
- **Abort**: a generation stopped (Stop of the line or of the instruction, a replacement) ends the
  line `cancelled` and never opens a window; the worker is disposed at once, so no late answer
  arrives.

## Chat

The chat of a message is the API chat window (`api_webchat/`, spec 01 "API WebChat") opened in
**SmartBar mode**: `index.html?…&smartbar=1&hid=<headerMessageId>`, on the `smartbar_chat`
connection (`llm`, `prompt_id=prompt_smartbar_chat`, so the header shows its provider and model as
for any prompt), which must be an API connection (otherwise the bar's tab gets the
`smartbar_error_no_connection` alert and no window opens). Without the flag nothing of this section
is active in the window.

### Opening it

- The bar's chat destination (the default destination or the second button) and "Open in chat" on a
  line (the unrecognized part, "Nothing matched", a draft, a free answer) send `smartbar_open_chat`;
  the text, when there is one, becomes the chat's next message. "Open in chat" on a `json` error
  (`fromError: { recordId, index }`) prefills the input with the instruction, **not sent**, and
  attaches the unreadable answer (the record's or the line's `rawResponse`, capped at 8000) to the
  next message as context: a note above the input says so, and its × drops it. The attachment
  lives in memory only, with the open window; it goes to that one message's free answer or compose
  call, never to the router.
- **One chat per message**: the background keeps `headerMessageId → { chatId, windowId, tabId,
  mailTabId, ready, sessionId, rawContext, prefill, queue }` (`_smartbarChats`). An open chat is
  brought to front (`windows.update(focused)`) and the new message appended; a closed window is
  forgotten (`windows.onRemoved`). Requests made before the window is ready wait in its queue.
- The ready handshake is the window's usual one (`<llm>_ready_<call_id>`); the background answers
  `smartbar_chat_init` with the session (below), then the prefill and the queued messages.

### The window

`controller.js` reads the flag and imports `api_webchat/smartbarChat.js`, whose channel stands where
the provider worker would: `<message-input>` and `<messages-area>` post `chatMessage` and `stop`
to it unchanged, and it forwards them to the background (`smartbar_chat_send` with a `clientId`,
`smartbar_chat_stop`). The page makes no call and creates no worker; the startup notice, the
endpoint check and the zoom are as for any chat; no usage chip. The background's messages to it
(`smartbar_chat_init`, `smartbar_chat_update` with a `seq`, `smartbar_chat_stream`,
`smartbar_chat_prefill`) carry its `chatId` and message; one sent by a content script is ignored.

One turn per record: the user's message (drawn by the input for a message typed there, by the page
for the others), then a model turn holding, in order, the reasoning (a live "Thinking…" row, then
the window's thinking block, `hide_thinking` deciding whether it opens; never stored, so a resumed
session shows none), the free answer (through `<messages-area>`'s one render path: `streamInto()`
the turn, the tokens, `handleTokensDone()`), the drafts and the result lines. The lines read as in
the bar (`js/lib/mzta-smartbar-lines.js`) with its buttons, through `smartbar_chat_*` commands that
name the record: Stop, Confirm / Cancel, Retry, Remove, ×, and "Details" (the Activity tab of the feature page); "Open
in chat" is never shown inside the chat. A rate-limited error counts down and retries **once** by
itself, as in the bar (`auto: true`; an operation keeps `autoRetried`), except on a resumed record
(history: Retry only) and, for the message itself, unless it is the newest turn (its retry is a new
message). While the router or the answer works, the line
"Understanding the instruction…" and the input's Stop. The input comes back once the message is
planned (its operations then run while the user types on), answered, failed or stopped from
outside: a record replaced (the feature turned off stops every message of the chat; for a turn of
the bar, its next instruction) reaches the chat too and reads "Stopped". A message the background
refuses is an error turn with a localized text (`refusalText()`: the feature off, the email deleted
or moved, the chat no longer known), never the bare code; Create email says the same. A new turn arriving
while an answer streams waits for its end.

### Every message goes through the router

For each message (`_smartbarChatRun()`): a record with `source: 'chat'` in the current session, a
group of jobs as for the bar (the router job keyed on its group, so several run at once), the router
with the chat metadata (`draft_exists`, `draft_type`) and `deliver_draft` available when the
session holds a draft. Then:

1. operations recognized: they run through the same plan, limit, jobs and record as from the bar.
   **No replacement**: a message never stops another; Stop is explicit (the input's Stop for the
   message being understood or answered, a line's Stop for an operation). The bar still replaces
   only its own previous instruction. An `unrecognized` part beside them is shown as a note, with
   no free answer;
2. nothing recognized (no planned line): the **free answer**, a special command on the
   `smartbar_chat` connection with the text of `prompt_smartbar_chat` and **no JSON section**,
   ThunderAI Privacy and the reasoning stripping as for every special command
   (`buildChatPrompt()`, `js/mzta-smartbar-chat.js`): the editable text, then the email between its
   delimiters as data (as the compose operation carries it: `smartbar_max_body_length`, the quoted
   part cut first), the conversation so far as data, the attached unreadable answer as data, the
   user's new message, the language rule (the language of the message). The answer is free text,
   stored in `answer` (capped at 20000); an empty one is an error. Its tokens are streamed to the
   window (at most every 100 ms) **only while ThunderAI Privacy is off**: with it on, the tokens
   would show the protected values, restored only in the final answer, so the answer appears whole
   at the end (`mzta_specialCommand`'s `onToken` is never called with a `ProcessingWorker`). The
   reasoning of the router and of the answer reaches the window at most every 250 ms.

A failure (router or answer) ends the record in `error` like a router failure of the bar, with
Retry (the same message sent again in the chat) and Remove.

**The conversation** (`conversationTurns()`, `renderConversation()`): for each record of the
session before this one, the user's message, then the free answer, the drafts its compose wrote
(type, subject, body, "email created" once delivered) and the state of its other operations. Cut to
12000 characters, the oldest turns first (`[earlier messages left out]`).

### Drafts

In the chat, an operation with `deliverInChat` (`compose`) opens no window when it ends: the line
ends `drafted` with its result, the record's `draft` is `{ type, subject, body, groupId }`, and the
turn shows the draft (the subject of a new email, the body) with **Create email** and Copy in its
actions toolbar. The session's **current draft** is the latest `drafted` operation of its records
(`currentDraft()`, `js/mzta-smartbar-store.js`).

- **Refinements** ("shorter", "more formal", "add that…") are `compose` operations the router
  recognizes thanks to `draft_exists`; their prompt carries the conversation with the previous
  drafts and requests, and writes the new version, which becomes the current draft. The previous
  draft turn stays in the conversation.
- **Create email** on any draft turn (`smartbar_chat_create`, `_smartbarDeliverDraft()`) runs the
  delivery of "Compose" for that draft (the window of its type, the same quote, signature and
  empty-To rules) and sets that operation `done`, its line reading as the bar's; the draft stays
  shown. A draft already delivered can be created again: a second window opens, as expected.
- **`deliver_draft`** (registry above) runs the same delivery for the current draft: the one a
  `compose` of the same instruction just wrote (it waits for it: "make it shorter and create it"),
  else the one the session held when the message was sent. Its line reads "Reply: compose window
  opened". Without a draft it is not offered to the router, so "create the email" ends in
  `unrecognized` or in the free answer.

Operations without `deliverInChat` (every one but compose) deliver at once, as from the bar.

### Sessions

The chat shows the latest session of the message: the session of a New conversation started since
Thunderbird started (`_smartbarSessionOverride`, in memory), else the latest record's. Its last 50
records are loaded (`sessionRecords()`, the in-progress ones as they are in memory), with a notice
when the session holds more. The bar uses the same rule, so the bar and the chat of a message share
the session: a new instruction from the bar after the chat was used continues it, and shows in the
open chat as a turn of its own. **New conversation** (a header button, disabled while a message is
understood or answered) starts a new `sessionId` (`smartbar_chat_new_session`): the turns shown go
(the startup notice stays), the attached context is dropped, the old records stay until they expire.
After a restart a New conversation with no message yet is forgotten, and the previous session is
resumed.

## Jobs

One instruction is one group of jobs in `taJobRegistry` (spec 01 "In-flight jobs"), with a
`groupId`: the router job (kind `smartbar`) and one job per operation in its own feature's kind
(`add_tags`, `summary`, `translation`; `smartbar_compose` for compose, `smartbar_calendar_event` and
`smartbar_task` for the Sparks operations, which no one else starts). `delete_summary`,
`delete_translation` and `deliver_draft` run no job. `spam_check` runs (or joins) the spam filter's
own `spam` job, which carries no group, as a batch's: a Stop of the line or of the instruction never
ends that analysis, and the line ends with it.
The router job of the bar is keyed on the message, the one of a
message of the chat on its group (several run at once). Each entry has an `AbortController`;
`taJobRegistry.abortGroup(groupId)` invalidates then aborts every entry of the group. So:

- an operation that finds a job of its kind already running on the message (the automatic
  processing of incoming mail, the context menu, the panel button) **joins** it, as the other
  callers do;
- the jobs of a batch carry no group: a SmartBar Stop or replacement **never** stops them;
- Stop of one operation aborts that operation's job only if it belongs to the instruction's group;
- the working status counts the router and every operation.

## Replacement

A new instruction of the bar on a message whose previous instruction of the bar still runs
**replaces** it (the messages of the chat are never replaced): the previous group
is aborted, its waiting confirmations cancelled, its record marked `replaced` (its unfinished
operations `cancelled`). A record that already ended is never changed. When the last record of the
message still shows errors the user has not dismissed, the bar shows a notice
(`replaced_with_errors`). The new record keeps the bar's `sessionId` of that message.

## Feature page

`pages/smartbar/mzta-smartbar.html`: three tabs, **Options**, **Actions**, **Activity**
(`#smartbar_tabs`). The hash of the URL names the tab shown (`#options`, `#prompts` for Actions,
`#activity`;
none or an unknown one: Options); a tab clicked puts its name in the hash (`replaceState`), and a
`hashchange` selects the tab it names. It is not reachable from the popup.

**Opened once** (`smartbar_open_page { tab }`, `_smartbarOpenPage()`): the background looks for a
tab whose URL is the page's (any hash). Found: it is activated, its window focused, and when a tab
is asked for, its URL set to the page with that hash (a same-document navigation: the page follows
it through `hashchange`, nothing reloads). Not found: a new tab on the page with that hash. The
bar's and the chat's "Details" ask for `activity`; the options page's "Manage settings" sends the
message with no tab (the page as it is), so the page opened from one place is focused from the
other (`openTab()`'s exact URL match would miss a page whose hash changed).

- **Options**: the settings of "Feature toggle and settings", the keyboard shortcut, the
  retention rules (spec 05 "SmartBar Settings Page").
- **Actions**: one sub-tab per action (router, execute, chat; the first shown at load, not in the
  hash), each a card with a colour of its own (border only when unselected; the selected card is
  filled with its tint and joins its panel, framed in the same colour). Execute's sub-tab starts with the three compose settings ("Writing settings"). Each
  sub-tab holds the text of its special prompt (`prompt_smartbar_router`,
  `prompt_smartbar_execute`, `prompt_smartbar_chat`), preceded by its connection panel ("Use specific Model and API" and
  the provider rows), each with the feature pages' editor (`bindSpecialPromptEditor()`: Save,
  Restore default, the unsaved-changes guard, the policy lock of an enforced text). Under the
  router's and execute's text, their JSON section (`ROUTER_JSON_SECTION`, `EXECUTE_JSON_SECTION`)
  shown read-only: the add-on appends it at call time, it is never in the textarea nor saved. On
  Save the router's text must hold `{OPERATIONS}`, `{PLACEHOLDERS}` and `{LANGUAGE_RULE}`
  (`ROUTER_VARIABLES`): a text without one is not saved, and the message under the editor names
  the missing ones (it follows the text until it is complete). Execute and chat have no
  variable. A policy text is not checked against them (at call time a missing variable has its
  content appended, see "Router"). A release that changes a default text a user customized shows
  the update notice with the change picker (spec 02 "Default text updates").
- **Activity**: see "Activity".

The special prompts of the other features keep their own pages.

## Activity

The Activity tab is a live view of the `smartbar` store and of the instructions in progress. The
page holds no state: it asks the background (`smartbar_activity_list`), acts through commands
(below), and reads its list again whenever the background says so (`smartbar_activity_changed`,
sent on every change of a record, see "Badge"). The background is the one source of truth: the
page's actions go through the same functions as the bar's, so the page, the bar of the message,
the chat and the badge always agree. Every Activity command is accepted from the feature page only
(`sender.url`); any other sender gets `not_page`.

**List** (`_smartbarActivityList(filter, beforeId)`): newest first (highest id), a page of 200
records (`more` when there are others; "Show more" asks for the next page, `beforeId` the last id
shown). An instruction in progress is given as it is in memory, with `live: true` and state
`running` (a record retried is stored in error and runs in memory). Records go to the page as the
bar gets them (no raw answer, no generated text) plus `finishedAt` (the latest of its operations).
The answer carries the counts `{ running, errors }`: the instructions in memory and the records
stored in error.

**Filters**: Running (the instructions in progress: those in memory only), Errors (the records
in state `error`), All. At load: Running when something runs, else Errors when there is one,
else All (`defaultFilter()`); the counts are shown next to the first two.

**Rows**: subject, sender and the source (bar / chat); the instruction, truncated at 80 characters
with the whole text as its tooltip; each operation with its state icon and its line text (the bar's,
`js/lib/mzta-smartbar-lines.js`), the router's line while it works, an instruction-level error as a
line; the elapsed time of a running row (every second while the tab is shown), the finish time of
the others.

- running: Open, Stop (`smartbar_activity_stop`, the whole instruction), and Stop on each running
  operation (`index`); **Stop all** (`smartbar_activity_stop_all`) stops every instruction in
  progress, of every message;
- error: Retry (`smartbar_activity_retry`: the router of an instruction-level error, a new
  instruction with the same text; else the first failed operation, `index`; no tab: the message is
  resolved from the store, and its results reach the tabs that display it), Remove, Open, and
  Open in chat for a `json` error only (`smartbar_activity_open_chat`: the message opened, then its
  chat as the bar's "Open in chat" on that error opens it); a rate-limited row counts down the
  seconds before its retry (display only: the page never retries by itself); **Remove all errors**
  (`smartbar_activity_remove_errors`) removes every record in error but those being retried;
- the others: Open, Remove.

Open (`smartbar_activity_open`) resolves the message (`_resolveMessage()`) and opens it with
`messageDisplay.open({ messageId, location: 'default' })`. Remove (`smartbar_activity_remove`)
deletes the record from the store (it is not a dismiss): a record in progress is refused
(`running`). After a removal the bar of each message concerned is pushed its state again (the
newest record left).

Under the list, a note that the store has no backup and can be lost if Thunderbird evicts the
database, with a link to the storage management page.

## Badge

The badge of `message_display_action` and `compose_action` (ThunderAI has no `browser_action`),
the same everywhere (no tab id): the number of running operations plus the number of operations in
error (`badgeCounts()`, `js/mzta-smartbar-store.js`, over the instructions in memory and the records
stored in error but those in memory):

- running: each operation running; the router (or the chat's free answer) at work, before any
  operation, counts as one;
- errors: each operation in error and the instruction-level error, unless dismissed (×) or
  stopped by the user (`errorType` `aborted`: a Stop is no failure to act on);
- a pending confirmation is not counted, nor is a record done, replaced or interrupted.

Empty at 0; red background (`#d70022`) with at least one error, else blue (`#0060df`). It is
counted again on every change of a record (`_smartbarActivityChanged()`, called by
`_smartbarPushState()` and `_smartbarChatPush()`; calls made during a count are coalesced into
one more), at startup once the interrupted records are marked, and when `smartbar_enabled`
changes: with the feature off the badge is empty. It is set only when it changes. No system
notification is ever shown by this feature.

## Storage

One record per instruction in the `smartbar` object store of the per-message database (spec 01
"Per-Message Data Storage"), keyed by an auto-increment `id`, indexes `messageId`, `sessionId`,
`createdAt`, `size`, `failed_createdAt`, `state` and `state_failed_createdAt`
(`[state, failed, createdAt]`).

- **Not mirrored**: nothing is written to `storage.local`, the reconcile with the mirror ignores the
  store, a database found new is not rebuilt for it. The history is lost if Thunderbird evicts the
  database (the Options and Activity tabs say so).
- A record holds `messageId`, `createdAt`, `subject` / `from` / `message_date`, `groupId`,
  `sessionId`, `source` (`'bar'` or `'chat'`), `instruction`, `state`, `unrecognized`, `routerContext`,
  `reports`, `error`, `errorType`, `rawResponse`, `retryAt`, `operations`, `dismissed`, and
  `answer` (the chat's free answer) / `draft` (`{ type, subject, body, groupId }`, the latest draft its
  compose wrote in the chat), `null` otherwise. `failed` and `size` are computed on write.
- An operation holds `index`, `id`, `params`, `state`, `result`, `error`, `errorType`,
  `rawResponse`, `retryAt`, `dependsOn`, `finishedAt`, and `dismissed` / `autoRetried` when set.
  A compose line's `result` is the generated text (see "Compose"), kept for a retry of its window.
- `rawResponse` is capped at 8000 characters, `answer` at 20000.
- Record states: `running`, `pending_confirmation`, `error`, `done`, `interrupted`, `replaced`.
  Operation states: `running`, `pending_confirmation`, `drafted` (the chat: a draft not created yet), `done`, `error`,
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
- A session's records (`sessionRecords(sessionId)`, the `sessionId` index): oldest first by
  `createdAt`, the last `CHAT_SESSION_LIMIT` (50) of them, with the session's count. The chat loads
  no more than that and says how many earlier messages it does not show.

## Deferred

Left out of this version on purpose:

- **Recipients**: no address book nor header lookup to resolve a recipient the instruction names
  (it stays a reminder in the result line), no mailing lists, no CC, no `replyToList` reply type.
- **Operations**: no operation more than once in one instruction (`multiple` is `false` for all);
  the output of one operation is never the input of another (`dependsOn` orders, it passes
  nothing); custom prompts are not exposed as operations. No deletion of the spam report, and no
  calendar event from the clipboard (`prompt_get_calendar_event_from_clipboard` is a menu entry for
  a compose window). The spam check never moves the message to the junk folder, whatever the score.
- **Router**: no clarification question back to the user: an unclear instruction ends in
  `unrecognized` or "Nothing matched".
- **Compose results**: no "Change type" menu to turn a reply into a forward (or the other way)
  after the text was written.
- **Activity**: the raw answers of the model are not shown (they stay in the record for "Open in
  chat"). A Retry of an instruction-level error starts a new record and leaves the failed one in
  error until it is removed, dismissed or expires.
- **`pending_confirmation`**: no operation uses `risk: 'confirm'` yet; a record left in that state
  at the end of a session is not marked interrupted at startup (only `running` ones are).
