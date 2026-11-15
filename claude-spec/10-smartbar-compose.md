# SmartBar in the compose window

The SmartBar of the message display acts on the email being **read**. In a compose window the user
works on the email being **written**: they correct it, change its tone or length, translate it, ask
for a subject, often in a series of requests ("correct it", "shorter", "now more formal"). That series
is a conversation, so the compose window gets **the chat only**, never a bar: the chat of the
SmartBar ([10-smartbar.md](10-smartbar.md) "Chat") opened on a compose window, where every message
still goes through the router and the operations offered are those of the compose context.

Every change to the email is a **proposal**: it is shown in the chat, with the change picker
([07-diff-picker.md](07-diff-picker.md)) for the body, and reaches the email only when the user
applies it. The only operation that touches the compose window without a proposal is `select`,
which changes the selection, never the text.

## Why no bar

- In a compose window the document is the email itself: a host injected there would be part of the
  editor (its undo, its spell check) and could end up in the email sent. Thunderbird gives an
  add-on no other place in the compose window without an experiment.
- The `compose_action` popup closes as soon as it loses the focus: a poor place for a change picker
  and for a series of requests.
- The one-shot requests ("correct it" and nothing more) are already covered by the prompts of the
  popup.

## Opening it

The compose chat exists only while `smartbar_enabled` is on. `smartbar_mode` and
`smartbar_default_destination` are about the bar of the message display and do not apply here.

- **Popup**: in a compose window only, the `compose_action` popup shows one entry, "SmartBar chat"
  (`#mzta_smartbar_compose_chat`, `popup_smartbar_compose_chat`, with its tooltip), above the
  search of the prompts, when `smartbar_enabled` is on (the popup reads it); the prompts are listed
  as usual. It is not shown in the message display popup (the bar and its chat destination are
  there). A click sends `smartbar_compose_open_chat { tabId }` (the popup's
  `lastShortcutTabId`) and closes the popup without waiting, as a prompt does.
- **Keyboard shortcut**: the same command `_thunderai__smartbar` (default `Ctrl+Alt+B`). In a message
  display tab it opens the bar as before; in a compose tab (`tab.type === 'messageCompose'`) the
  background's `commands.onCommand` listener opens the compose chat itself
  (`_smartbarComposeChatOpen(tab.id)`), with no message. Its manifest description
  (`smartbar_command_description`) and the settings page (`smartbar_shortcut_info`, under the
  keys) say both.
- **Connection**: the chat runs on the `smartbar_chat` connection, which must be an API connection.
  Otherwise the compose window gets the `smartbar_error_no_connection` alert (`sendAlert` through
  the compose script) and no window opens.

Both send the background `smartbar_compose_open_chat { tabId }` (`_smartbarComposeChatOpen()`),
accepted from the popup only (`sender.url` under `popup/`; `not_popup` otherwise), for a tab that
is a compose window (`compose.getComposeDetails()` answers), with the feature on.

**One chat per compose window**: the chats of the compose windows share the background's maps of
the chats of the messages (`_smartbarChats`, `_smartbarChatGroups`) under the key
`compose:<tabId>` (`_smartbarComposeKey()`) in place of a headerMessageId, with `{ chatId,
windowId, tabId, composeTabId, ready, closed, sessionId, records, queue }`. An open chat is brought
to front (`windows.update`); a closed chat window is forgotten, and what it still ran stops. The
window is the API chat in SmartBar mode with that key as its `hid` and the compose tab as `compose`
(`index.html?…&smartbar=1&hid=compose%3A<tabId>&compose=<tabId>`). Once ready it gets
`smartbar_chat_init` with its records (none at the first opening) and `compose: { subject, closed }`.
Its header names the email being written (its subject, or "New email" while it has none).

## When the compose window closes

When the compose window closes (sent, saved and closed, or discarded: `tabs.onRemoved` of the
compose tab), the chat **stays open**:

- every instruction still running is stopped (as a replaced one: `abortGroup()` of its group,
  its record `replaced`, its unfinished lines `cancelled`), and the chat window gets
  `smartbar_chat_compose_closed`;
- the input is disabled, with a notice above it: "The email window was closed: the conversation
  stays readable, nothing more can be sent to it.";
- Apply, Retry and Select are disabled; Copy and the change picker's view stay, so the user can still
  copy a text by hand before closing the chat;
- `closed` is set on its entry; a message (`smartbar_chat_send`), Apply and Retry are refused
  (`compose_closed`); the shortcut and the popup can no longer reach it (no compose tab has its
  id), and closing the chat window forgets it.

## Records: in memory only

A message of the compose chat is a record like the chat's of a message ([10-smartbar.md](10-smartbar.md)
"Storage"), with `source: 'compose'` (one of the store's `RECORD_SOURCES`), the id
`compose-<groupId>`, `composeTabId`, `messageId` `null` and the subject of the email being written.
It is **never written to the `smartbar` store**: `_smartbarSave()` only finishes it
(`finishRecord()`: caps, derived state), and it lives in its chat's `records`, gone when the chat
window closes. So:

- it is not listed in the Activity tab, and does not count in the badge (`_smartbarLiveStates()`
  leaves the `compose:` keys out): the chat window is the only place where it is shown;
- there is no session to resume after a restart nor after the chat window closed: a new chat on the
  same compose window starts empty;
- **New conversation** clears the turns and the conversation the prompts carry, as in the chat of a
  message.

The retention rules, the storage management page and `markInterrupted()` do not concern it.

## What the model sees, at every turn

The email is read again **at every message** of the user, and again by each operation when it starts
(an earlier `select` of the same instruction may have changed the selection), through the compose
script, so a change the user made by hand in the meantime is always seen:

- **the typed text**: what the user wrote, above the quote, the forwarded content and the signature
  (the compose extraction of `mail_typed_text`, spec 03);
- **the quoted part**: the quote of a reply, or the forwarded content of an inline forward, kept
  apart;
- **the selection**: the text selected in the editor, when there is one;
- the subject, the compose type (`new`, `reply`, `forward`, `draft`, `redirect`,
  `compose.getComposeDetails()`), the recipients' **names** (never an address), whether the window
  is plain text.

Who gets what:

| | Router | Operations, free answer |
|---|---|---|
| Typed text, quoted part | **never** | as data, between delimiters |
| Selection | whether there is one (`has_selection`) | its text, as data |
| Subject, compose type, recipient names | yes | yes |
| Whether the typed text is empty, whether there is a quoted part | yes | (they see the texts) |

The router never sees the email, here too ([10-smartbar.md](10-smartbar.md) "Router"): the quoted
part and any text pasted in come from others, and a prompt injection in them must not be able to
choose the operations nor their parameters.

## Router

**One router** for the two contexts: the same code (`js/mzta-smartbar-router.js`), the same
connection (`smartbar_router`), the same editable prompt (`prompt_smartbar_router`), the same locked
JSON section and the same answer. What the context (`'message'` or `'compose'`) changes:

1. **The operations**: each registry entry declares its context (below); `describeOperations(context)`
   lists only the operations of that context, so `{OPERATIONS}` holds the compose operations in a
   compose chat. An operation of the other context named anyway is reported `unknown` (it is not in
   the list the plan accepts for that context).
2. **The metadata**: in a compose chat, the subject, the compose type, the recipients' names,
   `has_selection`, `typed_text_empty`, `has_quoted_part`. No sender, no account tags, no
   `draft_exists` (there is no separate draft: the email is the draft).
3. **One context line**, appended by the add-on with the metadata, never part of the editable text:
   "The user is writing an email in a compose window; the operations change that email."
   (`ROUTER_COMPOSE_CONTEXT`). The metadata block names its fields as the router reads them
   (`compose_type`, `has_selection`, `typed_text_empty`, `has_quoted_part`); it holds no sender, no
   tags and nothing of the drafts.
4. **No placeholders**: `{PLACEHOLDERS}` stands for `ROUTER_COMPOSE_NO_PLACEHOLDERS` ("none in a
   compose window"), the router's `context` is ignored and `selected_text` is not added: the later
   steps get the typed text, the quoted part and the selection themselves. A `{%…%}` typed in the
   instruction stays text.

The rules of each context live in the `description` of its operations, which the router already
reads: no second prompt to customize, no second text for a policy to enforce. The default text of
`prompt_smartbar_router` gains the compose rules that are not about one operation (a combination of
changes to the text is one `rewrite`, see "Operations"; a question about the email or the quote is
no operation and nothing unrecognized: the free answer).

[10-smartbar-router-tests.md](10-smartbar-router-tests.md) has a `context` field per case
(`"message"` by default, `"compose"`) and a `plainText` one for the compose cases, and compose
cases with `hasSelection`; its test checks them against the operations of that context.

The default text of `prompt_smartbar_router` says the instruction is about the email being read
or, in a compose window, the one being written, and gives the compose rules that are not about one
operation (a combination of changes is one `rewrite`; a question about the email or the quoted
message is no operation).

## Operation registry

Every entry gains **`context`**: `'message'` (the eleven operations of
[10-smartbar.md](10-smartbar.md)) or `'compose'`. `requirements(env)` gets `env.context` too. An
operation id is unique across both contexts.

One more static rule of the registry, **`exclusive`**: a group name; of the lines of one instruction
sharing it, only the first in the user's order is planned, the others reported `conflict` (a new
report of the plan, drawn like `duplicate`). The operations that propose a new text for the body
share `exclusive: 'body'`: two proposals made from the same text could not both be applied, and one
operation does not get the output of another ([10-smartbar.md](10-smartbar.md) "Deferred"). The
router is told to give one `rewrite` for a combination ("correggi e rendila più formale"); `conflict`
covers the router that does not.

### Operations

| id | params | Runs | Requires |
|----|--------|------|----------|
| `rewrite` | `scope: 'selection' \| 'all'` | A new version of the target following the instruction: tone, length, formality, something to add or remove; on an empty typed text, the text the instruction asks for ("write that I accept"). A proposal (`drafted`). `exclusive: 'body'`; waits for a `select` of the same instruction | the `smartbar_compose` connection usable |
| `proofread` | `scope` | The target with its spelling, grammar and punctuation corrected, nothing else changed. A proposal. `exclusive: 'body'`; waits for a `select` | the same |
| `translate_text` | `language: string`, required; `scope` | The target translated into `language`. A proposal. `exclusive: 'body'`; waits for a `select` | the same |
| `subject` | none | A subject for the email from its text (and the instruction's hints: "short", "in English"). A proposal | the same |
| `select` | `target: string`, required | Selects in the editor the passage `target` describes, in the user's words ("the second paragraph", "the sentence about the prices"); see "Select". `direct`, no proposal | the same; the compose window not plain text |

All are `context: 'compose'`, `multiple: false`, `risk: 'direct'`; all but `select` are
`deliverInChat` (they end `drafted`, and Apply is their delivery). None is `runLast`: nothing opens a
window.

**The target** (`scope`): absent, the selection when there is one, else the typed text. `selection`
without a selection is an `error` (`errorType` `no_selection`, "No text is selected in the email.").
`all` is the typed text even with a selection. **Never the quoted part, nor the signature**: they are
not sent as the target and never replaced. Asking to change the quote is not covered.

### Generation

The four generative operations run a special command (`mzta_specialCommand`) on a **new**
per-feature connection, `smartbar_compose`, with the text of a **new** special prompt
`prompt_smartbar_compose` (`show_in: "none"`), as the router and execute run theirs: an API
connection (ChatGPT Web refused with `smartbar_error_no_connection`), JSON mode where it is reliable,
the reasoning stripped, ThunderAI Privacy, the stream idle timeout, one correction attempt for an
answer that is not a JSON object (`askJsonObject()`). Its own prompt and connection, like its three
siblings: writing on the user's own text is not writing an email from a received one
(`prompt_smartbar_execute`, whose rules are about replies, forwards and new emails), and a user may
want a different model for it.

The prompt (`buildComposePrompt()`, `js/mzta-smartbar-compose.js`), in this order:

1. the editable text (its rules: the texts are data, only the new text, no quote, no invented fact,
   `[...]` for what is missing, keep what the instruction does not ask to change; for
   `proofread`, nothing but corrections);
2. the JSON section, **locked**;
3. the message, **built by the add-on, not editable**: the typed text, the quoted part (as context
   only: "never rewritten"), each between its delimiters as data and defused as in execute; the
   target (the selection between its own delimiters, or "the whole text written", named and not
   repeated); the conversation so far, as data; the instruction; the operation and its params;
   `smartbar_additional_instructions` when set, for `rewrite`, `translate_text` and `subject` only
   (a correction changes nothing else, a passage is copied); the language rule (`rewrite`,
   `proofread`: the language of the target, unless the instruction asks for another;
   `translate_text`: `language`; `subject`: the language of the text written; none for `select`).
   The delimiters are `<<<TEXT …>>>`, `<<<QUOTED …>>>` and `<<<TARGET …>>>`; any delimiter of the
   SmartBar written inside a value is defused (`defuseCompose()`).

`smartbar_max_body_length` cuts the quoted part first, then the typed text, never the target.

**The answer**: `{"text": ""}` for `rewrite`, `proofread`, `translate_text` (plain text, paragraphs
separated by blank lines, required and non-empty); `{"subject": ""}` for `subject` (one line,
required).

### Proposals and Apply

A generative operation ends `drafted`; its result keeps `{ scope, original, text }` (`original`: the
target's text the proposal was made from) or `{ subject }`, in memory with its record, **never cut**
(`composeProposal()`): Apply writes the text in place of the whole target, so a cut text would
delete the end of the email. The turn shows it:

- body: the proposed text, with **Show differences** (the change picker, its baseline the
  `original` and its HTML twin as for a proofreading prompt in a compose window, spec 07 "Where the
  original's HTML comes from"), **Apply** and Copy. Apply writes the picker's composed result when
  the picker was opened, else the whole proposal;
- subject: "Subject: …" with Apply and Copy.

**Apply** (`smartbar_compose_apply { recordId, index }`) of a body proposal reads the email again
and finds the target **by its text**, never by a range kept since the proposal:

- `all`: the typed text must still equal `original` (whitespace normalized);
- `selection`: the live selection when it lies in the typed text and still holds `original` (so a
  text the user selected where it occurs twice is still found), else `original` must occur
  **exactly once** in the typed text.

Found: it is replaced in one editor command (one Ctrl+Z takes it back) through the compose script,
in the window's format (HTML: the picker's `composeResultHTML()` through `sanitizeBlockHtml()`;
plain text: the text), the quote, the forwarded content and the signature untouched. The line
becomes `done` ("Applied to the email"). Not found, or found more than once: nothing is written, the
line stays `drafted` and says "The email changed since this proposal" (Apply disabled, Retry asks
again on the current text). A proposal can be applied once; the latest one does not have to be.

Apply of a subject proposal: `compose.setComposeDetails(composeTabId, { subject })`, no check, `done`.

### Select

The router does not see the email, so it cannot say which text to select: `select` asks the model.
A special command on `smartbar_compose` with the same prompt (the operation `select` and its
`target`), whose answer is `{"text": ""}`: the passage **exactly** as it is in the typed text.

The add-on looks for it in the typed text (whitespace normalized, see "The compose script"):
found **exactly once**, the compose script selects it in the editor
(the editor focused first, as for an insertion) and the line is `done`, "Selected: “first
words…”"; not found (`errorType` `select_not_found`, "The passage was not found in the email.") or
found more than once (`select_ambiguous`, "The passage appears more than once in the email.") the
line is an `error` and the selection is not changed. Never in the quoted part. Not offered in a
plain text compose window (the router does not see it).

An operation of the same instruction that waits for `select` (`dependsOn`) reads the selection when
it starts: "select the last paragraph and translate it into English" passes nothing from one line
to the other, the selection in the editor does.

## The compose script

`js/mzta-compose-script.js` (the compose window's classic content script) answers three commands
of the background:

| Command | Answer |
|---------|--------|
| `smartbarComposeRead` | `{ typedText, quotedText, selection }`: the typed text and the quoted part with the line structure of `{%mail_typed_text%}` / `{%mail_quoted_text%}` (spec 03), the selected text, `''` unless the selection lies inside the typed text |
| `smartbarComposeSelect { passage }` | `{ status: 'found' \| 'not_found' \| 'ambiguous' }`; found, the passage is the selection (the editor focused first) |
| `smartbarComposeReplace { scope, original, text, html, isPlainText }` | `{ status: 'applied' \| 'changed' \| 'ambiguous' }`; applied, the target was replaced by `html` (`text` in a plain text window) through `insertIntoEditor()`, one editor command |

- **The typed text and the quoted part** are the regions of `getOnlyTypedText` and
  `getOnlyQuotedText`, shared by them (`typedRegion()`, `quotedRegion()`): the typed text runs from
  the top (ThunderAI's own elements skipped) to the first `.moz-cite-prefix`,
  `.moz-forward-container` or `.moz-signature`; the quoted part from the first cite prefix or
  forward container to the end.
- **A passage is found by its text** (`findInRegion()`): the live typed text is read as a string
  with its whitespace normalized (every run, a no-break space included, one space; a `<br>` and a
  block boundary one space), each character mapped to its text node and offset, so the passage
  found is a range of the document, across inline elements and paragraphs. It must occur exactly
  once; never in the quoted part.

## The background

`mzta-background.js`, "The chat of a compose window", over the flow of the chat of a message
(`_smartbarProcess()`, `_smartbarRunLines()`, the jobs, Stop):

- **A message** (`smartbar_chat_send` from the chat window, `_smartbarComposeChatRun()`): the email
  read (`_smartbarComposeRead()`: `compose.getComposeDetails()` for the subject, the kind, the `to`
  and `cc` addresses (their names only reach the router), the format; `smartbarComposeRead` for
  the texts); a compose window that cannot be read refuses it (`compose_closed`). A record in
  memory, then the router with `{ compose: read }` (the compose context, its metadata, no
  placeholder: see "Router"), the plan in the compose context, its lines, or the free answer.
  Every message appends: none stops another.
- **An operation** (`_smartbarRunComposeEdit()`, its job `smartbar_compose_edit` keyed on the
  window, the group and the line): the email read again, the target (`composeTarget()`), the
  prompt, the special command, then the line's outcome: `drafted` with the proposal, `done` for a
  passage selected, an `error` (`no_selection`, `select_not_found`, `select_ambiguous`, or the
  call's). A Stop of the line or of the message ends it `cancelled`. The five operations share
  their job kind and two of them may run at once (a change of the body and the subject): a Stop
  of one line finds its job by the line's index, which ends the job's id (`_smartbarStop()`).
- **Apply** (`smartbar_chat_apply { recordId, index, text?, html? }`, `_smartbarComposeApply()`):
  `text` / `html` are what the change picker composed, when the user opened it; else the whole
  proposal. The HTML is the picker's through `sanitizeBlockHtml()`, else the text as paragraphs
  (`plainTextToHtml()`); for a selection, a proposal of one paragraph stays inline, so it splits
  no paragraph: the picker's single `<p>` is unwrapped, the text escaped with a `<br>` per line
  (`_smartbarProposalHtml()`). A plain text window gets the text. Answers `{ ok, status }`:
  `applied` (the line `done`, `result.applied`), else `changed` / `ambiguous` (the line stays
  `drafted`, `result.stale`). Only a `drafted` line is applied. The record is updated from its
  version **after** the compose window was written: another line of the same message that ended
  meanwhile keeps its outcome.
- **Retry** (`smartbar_chat_retry`): an instruction-level error sends the message again; a failed
  line, or a proposal marked stale, runs that line alone again in a new group, on the email as it
  is now.
- **Dismiss**, **New conversation** (the records dropped, a new `sessionId`; refused while a message
  is understood or answered) and **Stop** as in the chat of a message, in memory. A line still
  running at a New conversation ends in the old session: its record is never kept again
  (`_smartbarComposeRemember()` keeps the current session's only), so it comes back neither in the
  turns nor in the conversation the prompts carry.

## The window

`api_webchat/smartbarChat.js` with `compose` (the controller passes the `compose` parameter of the
URL to the channel):

- **The header**: `#smartbarComposeTitle` after the brand, "Writing: <subject>"
  (`smartbar_chat_compose_title`), or `smartbar_chat_compose_title_new` with no subject, from
  `smartbar_chat_init`'s `compose`.
- **A proposal** (`rewrite`, `proofread`, `translate_text`, `subject`, `drafted` or `done`) is a block
  (`.sb-draft.sb-proposal`): its label (`smartbar_chat_proposal_label`: the operation and what it
  changes, `smartbar_chat_target_selection` / `_all`; `smartbar_chat_subject_label` for a subject),
  the proposed text or subject, and its toolbar:
  - **Show differences** (`btn_show_differences`, not for a subject): the change picker in a turn of
    its own (`appendDiffPicker()`, the original and the proposal as block HTML, `textToBlockHtml()`,
    the user's granularity), owned by the record's turn; its own "use this answer" applies too.
    Disabled once opened;
  - **Apply** (`smartbar_chat_apply`): `smartbar_chat_apply { recordId, index }`, plus `text` /
    `html` (`composeResultText()` / `composeResultHTML()`) once the picker is open. Refused, the
    block says why (`smartbar_chat_apply_failed`: the target changed, or the background's refusal);
    for any other reason than a changed email it can be clicked again (the compose window may not
    have answered for a moment). Applied, it reads "Applied" (`smartbar_chat_applied`), disabled; a
    stale proposal or a closed compose window disable it;
  - **Copy**: the proposal (the picker's result once open), or the subject.
- **The lines**: a proposal waiting has no line (its block speaks); applied, "<operation>: applied to
  the email" (`smartbar_result_applied`); stale, "<operation>: the email changed since this proposal,
  ask again" (`smartbar_line_proposal_stale`) with Retry; a passage selected "Selected: “…”"
  (`smartbar_result_selected`); the `conflict` report `smartbar_report_conflict`. The labels of the
  five operations are `smartbar_op_<id>` (`js/lib/mzta-smartbar-lines.js`, its `PROPOSAL_OPS`).
  A message stopped from outside reads `smartbar_chat_compose_replaced` (the feature turned off, or
  the compose window closed). No "Details": the Activity tab never lists these records.
- **The compose window closed** (`smartbar_chat_compose_closed`, or `compose.closed` at the init):
  `#smartbarComposeClosedNote` above the input (`smartbar_chat_compose_closed_note`), the input
  disabled for good (also after a message ends), every turn drawn again: Apply disabled, no Retry,
  no rate-limit countdown; Copy and the picker stay.

## The free answer

A message no operation covers gets the free answer, as in the chat of a message: the
`smartbar_chat` connection, `prompt_smartbar_chat`, no JSON section. Its message
(`buildChatPrompt()` with `emailHeader: COMPOSE_EMAIL_HEADER`, which names the email being
written) carries the typed text, the quoted part (cut first by `smartbar_max_body_length`) and the
selection as data (instead of the received email), the conversation so far, the user's message, the
language rule. It answers questions about the email being written or the message quoted ("what did
they ask me?", "is the tone too harsh?"). Its text stays in the chat; it never reaches the email
(Copy only).

**The conversation** the prompts carry (`conversationTurns()`) holds the proposals: "Proposal
(<operation>, the whole text | the selected text), applied to the email | not applied:" and the
text, and "Subject proposed[, applied]: …", so "shorter" after a proposal not applied refers to it.

## Jobs and lines

One message is one group of jobs, as in the chat: the router job keyed on its group, one job per
operation (kind `smartbar_compose_edit` for the four generative ones; `select`'s model call too). No
replacement: a message never stops another. The lines read through `js/lib/mzta-smartbar-lines.js`
with their own labels (Rewrite, Proofread, Translate, Subject, Select) and texts ("Proposal ready",
"Applied to the email", "The email changed since this proposal", the select texts above).

## Feature page

- **Actions**: a fourth sub-tab, "Compose window", with the `smartbar_compose` connection panel, the
  text of `prompt_smartbar_compose` with its editor (no variable) and its JSON section shown
  read-only, as the other three.
- **Options**: the shortcut's text says it opens the bar in a message and the chat in a compose
  window.
- **Activity**: unchanged; a note says the conversations of the compose window are not listed.

`prompt_smartbar_compose` and the `smartbar_compose_*` connection fields are policy-settable like
the other special prompts and per-feature connections (spec 08), with nothing to add by hand.

## Left out

- A bar in the compose window, and the SmartBar entry in the `compose_action` popup of a message.
- Any change to the quoted part, the forwarded content, the signature, the recipients or the
  attachments; no reading of the attachments.
- More than one proposal for the body in one instruction (`exclusive`), and the output of one
  operation as the input of another.
- Text inserted at the cursor: adding a paragraph is a `rewrite` of the typed text.
- History: nothing stored, nothing resumed.

**Known limit: a reply written below the quote.** The typed text is the region of
`{%mail_typed_text%}` (`typedRegion()`): from the top to the first quote (`.moz-cite-prefix`),
forwarded content or signature. With Thunderbird set to start the reply below the quote, the
user's own text is after that point: the SmartBar sees an empty typed text (`typed_text_empty` for
the router), a selection in that text counts as none (`no_selection`), and Apply with `all` writes
above the quote while the user's text stays as it is. The same limit holds for
`{%mail_typed_text%}` today; lifting it means defining the typed text as everything but the quote,
the forwarded content and the signature, for both at once.

## Tests

- `smartbar` area: `tests/smartbar/01-registry` (the `context` and `exclusive` rules, the compose
  operations, the plan), `02-router` (the compose metadata), `04-router-test-set` (the reference
  cases with `context: "compose"`), `06-chat` (the proposals in the conversation, the email being
  written in the free answer), `08-compose-prompt` (`buildComposePrompt()`, the target, the answer).
- `background` area: `tests/background/48-smartbar-compose` (opening from the popup and by the
  shortcut, every message, the operations, Apply, Retry, the window closing, records never stored
  and outside the badge).
- `compose` area: `tests/dom/compose/compose-23-smartbar-compose` (the compose script's commands).
- `webchat` area: `tests/dom/webchat/webchat-25-smartbar-compose` (the window).
- `ui` area: `tests/dom/smartbar/ui-01` / `ui-02` / `07` (the fourth sub-tab of Actions), the
  `13`-`17-*-smartbar_compose` connection scenarios, `tests/dom/popup/ui-08-smartbar-compose` (the
  popup's entry; its absence in `ui-03` and `ui-04`).
