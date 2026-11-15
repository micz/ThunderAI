# SmartBar in the compose window

> **Status: design, not implemented.** This file is the agreed design of the SmartBar for the email
> being written. Nothing of it exists in the code yet: until it is implemented, [10-smartbar.md](10-smartbar.md)
> describes the SmartBar as it is, and its "Deferred" section keeps "Compose window" with a pointer
> here. Once implemented, this file describes the behavior (the status line goes) and the tests
> follow it.

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

- **Popup**: in a compose window only, the `compose_action` popup shows one entry, "SmartBar chat",
  at the top of the prompts. It is not shown in the message display popup (the bar and its chat
  destination are there).
- **Keyboard shortcut**: the same command `_thunderai__smartbar` (default `Ctrl+Alt+B`). In a message
  display tab it opens the bar as today; in a compose tab (`tab.type === 'messageCompose'`) it opens
  the compose chat. The settings page's text of the shortcut says both.
- **Connection**: the chat runs on the `smartbar_chat` connection, which must be an API connection.
  Otherwise the compose window gets the `smartbar_error_no_connection` alert (`sendAlert` through
  the compose script) and no window opens.

**One chat per compose window**: the background keeps `composeTabId → { chatId, windowId, tabId,
ready, sessionId, closed, queue }` (`_smartbarComposeChats`), apart from the chats of the messages.
An open chat is brought to front; a closed chat window is forgotten. The window is the API chat in
SmartBar mode, with `compose=<composeTabId>` instead of `hid=<headerMessageId>`
(`index.html?…&smartbar=1&compose=<tabId>`). Its header names the email being written (its subject,
or "New email" while it has none).

## When the compose window closes

When the compose window closes (sent, saved and closed, or discarded: `tabs.onRemoved` of the
compose tab), the chat **stays open**:

- every instruction still running is stopped (`abortGroup()` of each of its groups), its lines
  `cancelled`;
- the input is disabled, with a notice above it: "The email window was closed: the conversation
  stays readable, nothing more can be sent to it.";
- Apply, Retry and Select are disabled; Copy and the change picker's view stay, so the user can still
  copy a text by hand before closing the chat;
- `closed` is set on its entry; the shortcut and the popup can no longer reach it (no compose tab
  has its id), and closing the chat window forgets it.

## Records: in memory only

A message of the compose chat is a record like the chat's of a message ([10-smartbar.md](10-smartbar.md)
"Storage"), with `source: 'compose'`, `composeTabId` instead of `messageId`, and no
`subject` / `from` / `message_date`. It is **never written to the `smartbar` store**: it lives in
memory, with its chat, and is gone when the chat window closes. So:

- it is not listed in the Activity tab, and does not count in the badge: the chat window is the only
  place where it is shown;
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

The rules of each context live in the `description` of its operations, which the router already
reads: no second prompt to customize, no second text for a policy to enforce. The default text of
`prompt_smartbar_router` gains the compose rules that are not about one operation (a combination of
changes to the text is one `rewrite`, see "Operations"; a question about the email or the quote is
no operation and nothing unrecognized: the free answer).

[10-smartbar-router-tests.md](10-smartbar-router-tests.md) gains a `context` field per case
(`"message"` by default, `"compose"`), and compose cases with `hasSelection`; its test checks them
against the operations of that context.

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
   target (the selection, when it is the target) between its own delimiters; the conversation so
   far, as data; the instruction; the operation and its params; `smartbar_additional_instructions`
   when set; the language rule (`rewrite`, `proofread`: the language of the target, unless the
   instruction asks for another; `translate_text`: `language`).

`smartbar_max_body_length` cuts the quoted part first, then the typed text, never the target.

**The answer**: `{"text": ""}` for `rewrite`, `proofread`, `translate_text` (plain text, paragraphs
separated by blank lines, required and non-empty); `{"subject": ""}` for `subject` (one line,
required).

### Proposals and Apply

A generative operation ends `drafted`; its result keeps `{ scope, original, text }` (`original`: the
target's text the proposal was made from) or `{ subject }`, in memory with its record. The turn
shows it:

- body: the proposed text, with **Show differences** (the change picker, its baseline the
  `original` and its HTML twin as for a proofreading prompt in a compose window, spec 07 "Where the
  original's HTML comes from"), **Apply** and Copy. Apply writes the picker's composed result when
  the picker was opened, else the whole proposal;
- subject: "Subject: …" with Apply and Copy.

**Apply** (`smartbar_compose_apply { recordId, index }`) of a body proposal reads the email again
and finds the target **by its text**, never by a range kept since the proposal:

- `all`: the typed text must still equal `original` (after the normalization of spec 07);
- `selection`: `original` must occur **exactly once** in the typed text.

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

The add-on looks for it in the typed text (whitespace normalized, through the line projection of
`js/lib/mzta-html-lines.js`): found **exactly once**, the compose script selects it in the editor
(the editor focused first, as for an insertion) and the line is `done`, "Selected: “first
words…”"; not found (`errorType` `select_not_found`, "The passage was not found in the email.") or
found more than once (`select_ambiguous`, "The passage appears more than once in the email.") the
line is an `error` and the selection is not changed. Never in the quoted part. Not offered in a
plain text compose window (the router does not see it).

An operation of the same instruction that waits for `select` (`dependsOn`) reads the selection when
it starts: "select the last paragraph and translate it into English" passes nothing from one line
to the other, the selection in the editor does.

## The free answer

A message no operation covers gets the free answer, as in the chat of a message: the
`smartbar_chat` connection, `prompt_smartbar_chat`, no JSON section. Its message
(`buildChatPrompt()` with the compose context) carries the typed text, the quoted part and the
selection as data (instead of the received email), the conversation so far, the user's message, the
language rule. It answers questions about the email being written or the message quoted ("what did
they ask me?", "is the tone too harsh?"). Its text stays in the chat; it never reaches the email
(Copy only).

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

## Tests (to write with the implementation)

- `smartbar` area: the `context` and `exclusive` rules of the registry and the plan, the compose
  operations' params, `buildComposePrompt()` and the answer checks, the router metadata and the
  operation list of each context, the reference cases with `context: "compose"`.
- `background` area: opening (popup entry, shortcut by tab type), one chat per compose window, the
  window closing (instructions stopped, chat kept), records never stored and outside the badge,
  Apply found / changed / ambiguous, the subject, `select` and the line waiting for it.
- `compose` area: the compose script's new commands (select a passage, replace the typed text or a
  passage in one editor command, in HTML and plain text), the typed text / quoted part / selection
  read at every turn.
- `webchat` area: the chat window with `compose=`: the proposals with Show differences and Apply,
  the input disabled after the compose window closed, Copy still available.
- `ui` area: the fourth sub-tab of Actions.
