# Architecture

## Extension Structure (Manifest V2)

ThunderAI runs as a standard Thunderbird WebExtension with three main execution contexts:

```
Background Page  →  mzta-background.html / mzta-background.js
Popup            →  popup/mzta-popup.html / popup/mzta-popup.js
Options Page     →  options/mzta-options.html / options/mzta-options.js
Feature Pages    →  pages/*/
Content Script   →  js/lib/diff.js (injected into chatgpt.com)
Web Workers      →  js/workers/model-worker-*.js (one per API provider)
```

## Data Flow: User Action → AI Response

```
User clicks popup or presses Ctrl+Alt+A
       ↓
popup/mzta-popup.js   (renders prompt list, handles selection)
       ↓  (sendMessage to background)
mzta-background.js    (orchestrates everything)
       ↓
js/mzta-placeholders.js  (resolves {%placeholder%} values from email data)
       ↓
js/mzta-prompts.js       (builds final prompt string)
       ↓
 ┌─────────────────────────────────────────┐
 │  Based on connection_type:              │
 │  chatgpt_web   → js/mzta-chatgpt.js    │ (opens ChatGPT window)
 │  chatgpt_api   → Web Worker (openai)   │
 │  ollama_api    → Web Worker (ollama)   │
 │  google_gemini → Web Worker (gemini)   │
 │  anthropic     → Web Worker (anthropic)│
 │  openai_comp   → Web Worker (comp)     │
 └─────────────────────────────────────────┘
       ↓
 Result returned to background
       ↓
js/mzta-compose-script.js  (inserts text into Thunderbird compose window and display window)
```

### Data Flow: Inline Summary on Message Display

The `summarize_display_mode` preference (`'inline'` or `'webchat'`) controls where
the summary is displayed. The `summarize_auto` preference controls when it is triggered.

- `summarize_auto = 2` (automatic) always generates inline, regardless of `summarize_display_mode`.
- `summarize_auto = 3` (on receive) pre-caches the summary silently when the email arrives via `onNewMailReceived`. When the user later opens the message, the cache hit triggers an instant display.
- `summarize_auto = 1` (manual button) respects `summarize_display_mode`:
  - `'inline'` → button click triggers inline generation
  - `'webchat'` → button click opens the AI chat window via `_openSummaryWebchat()`
- Context menu summarize also respects `summarize_display_mode`:
  - `'inline'` with a single message → generates inline via `_generateSummaryForMessage()`
  - `'webchat'` or multiple messages → opens the AI chat window via `openChatGPT()`

```
User opens/selects a message in Thunderbird
       ↓
mzta-compose-script.js  (sends "initSummary" to background)
       ↓
mzta-background.js      (checks summarize_auto + summarize_display_mode prefs)
       ↓
  ┌──────────────────────────────────────────────────────────┐
  │ summarize_auto = 0 → do nothing                          │
  │ summarize_auto = 1 → show "click to generate" button     │
  │   display_mode = inline  → click triggers inline gen     │
  │   display_mode = webchat → click opens chat window       │
  │ summarize_auto = 2 → generate immediately (always inline)│
  │ summarize_auto = 3 → cache hit (pre-cached on receive)   │
  └──────────────────────────────────────────────────────────┘
       ↓  (if generating inline)
  taSummaryStore         (check cache / set processing)
       ↓  (cache miss)
  mzta-special-commands  (via Web Worker, NOT chatgpt_web)
       ↓
  taSummaryStore         (save result via taStorage)
       ↓
  mzta-compose-script.js (render summary banner in message body)
```

### Data Flow: Inline Translation on Message Display

The `translate_auto` preference controls when translation is triggered.
Translation always renders inline (webchat mode has been removed).

The target language is determined by `translate_lang` (fallback on `default_chatgpt_lang`).

```
User opens/selects a message in Thunderbird
       ↓
mzta-compose-script.js  (sends "initTranslation" to background)
       ↓
mzta-background.js      (checks translate + translate_auto prefs)
       ↓
  ┌──────────────────────────────────────────────────────────┐
  │ translate_auto = 0 → do nothing                          │
  │ translate_auto = 1 → show "click to translate" button    │
  │ translate_auto = 2 → generate immediately                │
  └──────────────────────────────────────────────────────────┘
       ↓
  taTranslationStore     (check cache / set processing)
       ↓  (cache miss)
  mzta-special-commands  (via Web Worker, NOT chatgpt_web)
       ↓
  taTranslationStore     (save result via taStorage)
       ↓
  mzta-compose-script.js (render translation banner in message body)
```
### Data Flow: Background Summary on Email Receive (summarize_auto = 3)

When `summarize_auto = 3`, a summary is generated silently when a new email arrives. The flow mirrors `add_tags_auto`:

```
New email arrives
       ↓
browser.messages.onNewMailReceived
       ↓
newEmailListener  (checks _process_incoming, which includes summarize_auto === 3)
       ↓
processEmails({ summarizeOnReceive: true })
       ↓  (single loop — shared with addTagsAuto / spamFilter / translateOnReceive)
_generateSummaryForMessage(headerMessageId, null, { messageData })
  ← tabId is null → no UI messages sent, silent pre-cache
       ↓
taSummaryStore.saveSummary()
       ↓
[later] user opens the message → initSummary → cache hit → showSummary instantly
```

### Data Flow: Auto-Summarize by Sender Address List

`summarize_auto_senders` + `summarize_auto_senders_list` summarize emails from specific senders
automatically, with no click. This is **independent of `summarize_auto`** and works even when
`summarize_auto = 0`. Matching goes through `matchAddressList(author, list)`
(`js/mzta-utils.js`), which extracts the address from the raw author header with the same regex
used by the spamfilter skip list and supports exact addresses, `@domain.com`, and `*@domain.com`.

There are **two triggers**, because `onNewMailReceived` does not fire for every delivery path —
subscribed IMAP folders that are not checked for new mail, and messages moved by a server-side
(Sieve) filter after delivery, emit no event:

```
1. On reception, in whatever folder the message is delivered to
   browser.messages.onNewMailReceived
        ↓
   newEmailListener  (_process_incoming also covers a non-empty sender list)
        ↓
   processEmails({ summarizeSenders: [...] })
        ↓  (per message, inside the shared loop)
   summarizeOnReceive || matchAddressList(message.author, summarizeSenders)
        ↓
   _generateSummaryForMessage(headerMessageId, null, { messageData })   ← silent pre-cache

2. On message open, if reception did not catch it
   initSummary handler
        ↓  (after the cache check and the isProcessing() check,
        ↓   before the `summarize_auto === 0` return)
   matchAddressList(message.author, prefs.summarize_auto_senders_list)
        ↓
   _generateSummaryForMessage(headerMessageId, tabId, { resolvedMessage })  ← inline, message pane
```

There is deliberately **no periodic scan**: no `setInterval`, no `browser.alarms`, no
`browser.messages.query()` sweep, no recursive folder walk.

**Idempotency** comes from `taSummaryStore` (cache + `isProcessing()`), which
`_generateSummaryForMessage()` already consults, so a message caught by *both* triggers costs
exactly one API call. In the `initSummary` handler the sender check is deliberately placed
**after** the cached-summary and `isProcessing()` early returns for the same reason, and
**before** the `summarize_auto === 0` return because the list must work with auto-summarize
otherwise disabled.

**Shared guards** in both triggers (`mzta-background.js`):
- `isMessageInAutoSkippedFolder(message, allowSent = false)` (`js/mzta-utils.js`) — the single
  folder gate for **all** the automatic paths. A message whose folder `specialUse` intersects
  `AUTO_SKIP_SPECIAL_USE` (`junk`, `trash`, `drafts`, `templates`, `outbox`, `sent`) is never
  processed automatically. Two distinct reasons are folded into one list: junk/trash messages
  have already been thrown away by the user or by the server, and drafts/templates/outbox/sent
  messages were **written by the user, not received** — automatically summarizing or translating
  a draft the user is still composing burns tokens on non-final text, which is exactly what
  happened before this guard existed. `archives` is deliberately **absent**: an archived message
  is still a received one.

  `allowSent` drops `sent` from the list and backs the `add_tags_auto_include_sent` option — only
  auto add-tags can opt back into the sent folder. Inside `processEmails()` two values are
  computed once per message: `message_in_skipped_folder` (spam filter, summarize, translate) and
  `message_in_skipped_folder_tags` (add-tags, honouring the option). Every guard is additionally
  gated on `isAutoMode`, so the **manual** paths (context menu, buttons) are never filtered.

  Built on the generic `messageFolderHasSpecialUse(message, [...])`, which also serves the
  `spamfilter_only_inbox` check (`['inbox']`) — a different question this wrapper cannot answer.
  Both are null-safe: a message with no folder yields `false`.

  The same helper guards the two message-open auto paths that previously had **no** folder check
  at all — `summarize_auto === 2` in `initSummary` and `translate_auto === 2` in
  `initTranslation` — while their manual-button branches (`=== 1`) and the display of an already
  cached result stay unfiltered.
- `_summarizeConnectionMissing()` — resolves the **effective** connection with
  `getConnectionType(prefs, await getSummarizePrompt(), 'summarize')` and tests it with
  `isApiUsableConnection()`, so a summarize-specific integration still works when the global
  `connection_type` is empty (v5.0.0 ships it empty and steers the user to the Setup Wizard).
  The predicate is the same one used by the menus, by `_generateSummaryForMessage()` and by
  every other feature: `chatgpt_web` has no API and cannot produce a summary, so it counts as
  unusable here exactly as an empty connection does. It used to test `hasNoConnectionSelected()`
  instead, which let `chatgpt_web` through — the run then reached
  `_generateSummaryForMessage()`, which rejects it only **after** `setProcessing()` and
  persists the error into `summaryStore`. That is why the pre-check exists at all and why it
  must use the strict predicate: an automatic trigger would otherwise write an error record
  for a message the user never asked to summarize. On an unusable connection the trigger logs
  via `taLog` and skips **silently** — no alert, no error panel. It returns `true` on its own
  exception, so a failure never starts a generation.

**`onNewMailReceived` registration.** The listener is registered once, at module load, with
`monitorAllFolders` always set to `true`:

```js
browser.messages.onNewMailReceived.addListener(newEmailListener, true);
```

The scope is intentionally maximal. Several features need messages delivered anywhere and not
just in the Inbox — the spam filter, summarize on receive, the summarize sender list, translate
on receive, and add-tags on the sent folder — and subscribed IMAP folders not checked for new
mail, or messages moved by a server-side filter, only surface with the full scope.

`monitorAllFolders` was never a usable filter in the other direction either: with `false`,
Thunderbird still reports every *normal* (non-special-use) folder, so it could not keep the
automatic processing inside the Inbox. That is why `add_tags_auto_only_inbox` used to leak —
messages dropped into a user IMAP folder by a server-side filter were still tagged (issue #863).
Earlier versions derived the argument from `add_tags_auto_only_inbox`,
`add_tags_auto_include_sent` and the summarize sender list and re-registered the listener
(`removeListener` + `addListener`) whenever that value changed; that machinery is gone, since the
argument is now a constant.

The narrowing happens per message instead, inside `processEmails()`, where each feature applies
its own checks — `add_tags_auto_only_inbox` (plus `add_tags_auto_include_sent`),
`spamfilter_only_inbox`, `isMessageInAutoSkippedFolder()`, and the per-account enable lists — all
gated on `isAutoMode`, so manual and context-menu invocations are never filtered by them. Both
only-inbox guards use `messageFolderHasSpecialUse()` and are authoritative: they are the only
thing keeping the automatic processing in the Inbox. `_process_incoming` in `newEmailListener`
remains the cheap gate that avoids waking the whole pipeline when no automatic feature is enabled.

**Lazy per-message body fetch.** In the `processEmails()` loop, `browser.messages.getFull()` and
the body conversion are deferred to two per-iteration helpers, `ensureFullMessage()` and
`ensureBodyText()`, each idempotent. Every feature awaits the one it needs only after all of its
own skip checks have passed. A message discarded by the guards is therefore never fetched or
converted at all, which matters now that the listener reports every folder.

**The two helpers are INDEPENDENT.** `ensureBodyText()` used to begin with `await
ensureFullMessage()`, because the body was extracted from the MIME tree that call returned. It no
longer does: the body now comes from `getMailInlineTextParts(message.id)`, which needs only the
message id. Every feature therefore awaits *each* helper it actually uses — add-tags and the spam
filter await **both** (`ensureFullMessage()` for `headers.subject` and the report metadata,
`ensureBodyText()` for the prompt), summarize and translate await `ensureFullMessage()`. As it
happens all four still need the full message for its headers, so this saves no `getFull()` today;
what it buys is that a future body-only consumer would pay for no MIME fetch, and that neither
helper silently drags the other in. Dropping the implicit call without adding the two explicit ones
would have left `curr_fullMessage` null under `headers.subject` — the trap to watch for here.

`ensureBodyText()` prefers the HTML body converted with
`htmlBodyToPlainText()` and falls back to the whitespace-collapsed plain text part when the HTML
body is empty. The `finally` block still nulls `curr_fullMessage` / `msg_text` / `body_text` after
each message.

### Data Flow: Background Translation on Email Receive (translate_auto = 3)

When `translate_auto = 3`, a translation is generated silently when a new email arrives. Mirrors the summarize on-receive flow:

```
New email arrives
       ↓
browser.messages.onNewMailReceived
       ↓
newEmailListener  (checks _process_incoming, which includes translate_auto === 3)
       ↓
processEmails({ translateOnReceive: true })
       ↓  (single loop — shared with addTagsAuto / spamFilter / summarizeOnReceive)
_generateTranslationForMessage(headerMessageId, null, { messageData })
  ← tabId is null → no UI messages sent, silent pre-cache
       ↓
taTranslationStore.saveTranslation()
       ↓
[later] user opens the message → initTranslation → cache hit → showTranslation instantly
```

### Resolving a message from its `headerMessageId` (`_resolveMessage`)

Everything cached per message — `taSummaryStore`, `taTranslationStore`, `taSpamReport` — is
keyed on `headerMessageId`, and the content scripts only ever know that key. The generators
therefore receive a `headerMessageId` and have to turn it back into a message object.

Doing that with `browser.messages.query({ headerMessageId })` is a **full-store search across
every folder of every account**. The background page runs in Thunderbird's *parent* process,
so on a large mail store that search freezes the entire application UI — minutes, before the
AI request is even sent. The WebExtension docs warn about it explicitly ("could need a long
time to complete, if the user has a lot of messages").

`_resolveMessage(headerMessageId, messageId, tabId, resolvedMessage)` in `mzta-background.js`
concentrates the lookup and tries the cheap routes first:

| Order | Source | Used when |
|---|---|---|
| — | `options.messageData` | caller already fetched the message (checked by the generators, before this helper) |
| a | `resolvedMessage` (the message object itself) | the caller already holds the message (e.g. from `getDisplayedMessage`) |
| b | `browser.messages.get(messageId)` | the caller holds a numeric message id |
| c | `browser.messageDisplay.getDisplayedMessage(tabId)` | a message-display tab is in scope |
| d | `browser.messages.query()` | nothing else is known — the last resort |

**(a), (b) and (c) verify `headerMessageId` before accepting the result.** For (c) that is the
same staleness reasoning as `_sendIfCurrent()` — the displayed message can have changed while
the work sat queued. For (b) it guards against a numeric id that no longer denotes the same
message: ids are per-folder and can be reused after a delete + compaction. (a) re-checks for
the same reason: a caller that resolved the message earlier may now hold a stale reference.
A mismatch falls through to the next route rather than returning the wrong message.

The generators keep their own "Message not found" handling: `_resolveMessage()` returns `null`
and the caller runs its existing `saveError()` / `_sendIfCurrent()` / `taWorkingStatus.stopWorking()`
bookkeeping unchanged.

**Passing the resolution is the caller's job.** A handler that already holds a message object
(the `initSummary` / `initTranslation` auto-display paths, which fetched it via
`getDisplayedMessage`) pass `{ resolvedMessage: message }` — route (a), no further lookup. A
handler that only holds a numeric id passes `{ messageId }` (route b). `runtime.onMessage`
handlers that receive only a `headerMessageId` from a content script pass their `sender.tab.id`
instead and land on (c). After this, (d) is not reached by any normal user-facing path.

### Stale-result guard (rapid message switching)

Inline summary/translation generation is asynchronous: there can be a multi-second gap
between when the background reads the displayed message (to start generation) and when the
AI result is ready to be sent back to the message-display tab. If the user clicks through
several messages quickly, the same tab may already be displaying a different email by the
time an earlier result arrives — without a check, the result would render on the wrong
message, producing a flicker of unrelated summaries/translations before the correct one.

To prevent this, every **terminal "show result" send** (`showSummary`, `showTranslation`,
`showSpamReport`, and the manual `showSummaryButton` / `showTranslationButton`) goes through
the `_sendIfCurrent(tabId, headerMessageId, payload)` helper in `mzta-background.js`. It
re-queries `browser.messageDisplay.getDisplayedMessage(tabId)` immediately before sending and
**drops the message** if the tab no longer displays the expected `headerMessageId`. The
already-saved cache is unaffected, so revisiting the message later shows the correct result
on cache hit. This generalizes the same displayed-message check already used by
`updateSpamPanel()`.

The transient *loading* indicators (`showSummaryGenerating`, `showTranslationGenerating`,
`showSpamCheckInProgress`) are intentionally **not** guarded — they are not keyed to a
specific result, are idempotent in the content script, and are quickly replaced; guarding
them would add latency without preventing wrong-content display.

### Batch cancellation (`taBatchController`)

Batch email processing (`processEmails` — auto add-tags, spam filter, summarize, translate,
run both on-receive and from the context menu) can iterate over a large selection and run for
a long time. `js/mzta-batch-controller.js` provides a cooperative way for the user to stop it.

It is a singleton mirroring `taWorkingStatus`, exposing a **single global "cancel all" flag**
plus a **progress counter**:

- `beginBatch()` / `endBatch()` — called at the start of `processEmails` and in its `finally`.
  A `_activeBatches` counter allows overlapping batches; the cancel flag and `processed`
  counter are reset only when the **last** active batch exits, so a single cancel request is
  honored by every overlapping batch and never leaks into a future one.
- `requestCancel()` / `isCancelled()` — set/read the global flag.
- `tick()` / `processed` — increments the "N processed" counter shown in the popup.
- `isWorking()` / `getStatus()` — report `{ working, processed, cancelRequested }`.

**Scope decision:** `isWorking()` tracks its own `_activeBatches` counter, **not**
`taWorkingStatus.WorkingLevel`. Standalone operations (e.g. a single inline summary via
`_generateSummaryForMessage`) also drive `WorkingLevel` but are not cancellable batches — so
the popup's "Stop processing" button must not appear for them.

**Cooperative check points** in `processEmails`: at the top of the `for await` message loop
(before the heavy `getFull`), after the between-chunks `setTimeout(0)` yield, and inside the
separate `summarize` block (before each `getFull` and before opening the webchat). All
`break`/`return` paths fall through to the existing `finally`, so `stopWorking()` +
`endBatch()` always run.

**Abort latency (v1):** cancellation is checked *between* messages, so the message currently
in flight finishes first — bounded by `special_command_timeout` (default 120s). There is no
mid-request worker termination in v1.

The UI trigger lives in the toolbar popup (`popup/mzta-popup.html/.js/.css`); see
[04-api-integrations.md](04-api-integrations.md) for the `batch_status` / `cancel_batch`
runtime messages and the `preparePopupMenu` payload.

## API WebChat (`api_webchat/`)

The interactive chat window used by every API provider (not ChatGPT Web) lives in
`api_webchat/`. It is a standalone extension page (`index.html`) built from two native
Web Components with Shadow DOM and a controller that wires them to a per-provider Web
Worker. No framework, no build step; plain ES6 modules under the strict default MV2 CSP.

### Component structure

```
index.html
  ├── #appHeader                           — logo, product name, static model chip (light DOM)
  ├── <messages-area>   (messagesArea.js)  — renders the conversation transcript
  ├── <message-input>   (messageInput.js)  — input field, send/stop buttons, status pill
  └── controller.js                        — DI / worker wiring (see below)
```

`controller.js` is the "DI" layer: it reads the `llm` / `prompt_id` URL params, resolves
the provider prefs, spins up the correct `js/workers/model-worker-*.js`, injects the worker
into both components (`messagesArea.init()`, `messageInput.init()`,
`messageInput.setMessagesArea()`), sends the worker `init` message, and translates
worker/runtime messages into component method calls. It owns the module-level `promptData`
(set once by `api_send`) and the Ctrl+/Ctrl-/Ctrl+0 font-zoom.

### Streaming data flow

```
Worker → controller.js → components
  messageSent      → messageInput.handleMessageSent()
  newToken         → messagesArea.handleNewToken(token)          (feeds StreamingMessage + fading span)
  newThinkingToken → messagesArea.handleNewThinkingToken(token)  (feeds StreamingMessage + live "Thinking…" indicator)
  tokensDone       → messagesArea.handleTokensDone(promptData)   (flush → action buttons)
  error            → messagesArea.appendBotMessage(payload,'error') + messageInput.showErrorStatus()

background → controller.js (browser.runtime commands)
  api_send             → set promptData; send prompt (or show custom-text field)
  api_send_custom_text → merge custom text into the prompt, then send
  api_error            → render an error bot message
```

Per bot response a fresh `StreamingMessage` accumulates raw + thinking tokens and, on flush,
returns an **immutable HTML snapshot**; `<messages-area>` renders it and hands the thinking
text to `renderThinkingBlock`.

markdown-it is instantiated **once for the module** (`getMarkdownIt()`, lazily, since
`window.markdownit` is a classic-script global). It used to be constructed inside `flush()` — i.e.
once per `\n` of every response — which was most of what made streaming feel slow. The options are
invariant and `render()` keeps no state between calls, so one shared instance is equivalent.

### One render path, no router

Every answer goes through **one** path (`renderResponse()` in `streamingMessage.js`):

```
renderResponse(raw) = sanitize(markdownit({ html: true, breaks: true }).render(raw), { allowBlocks: true })
```

markdown IS a superset that admits inline and block HTML (CommonMark), so there is no
markdown-vs-HTML decision to make — the old router (`looksLikeHtmlResponse()`, the sticky
`_isHtmlResponse` verdict, the `null`/undecided state, `normalizeEchoedBrTags()`, the two render
branches, `BLOCK_TAG`/`LEAD_IN*` machinery) is **gone**.

- **`breaks: true`** keeps the model's `\n` as a real `<br>` — this is a mail composer, not a
  markdown document, so a newline the model wrote is a newline the user expects, in the chat AND in
  the inserted mail (`fullTextHTML`).
- **`html: true`** lets inline HTML (`<b>`) render instead of being escaped. This is the hybrid fix:
  `Ciao <b>Mario</b>\ngrazie` → `<p>Ciao <b>Mario</b><br>grazie</p>` — bold rendered AND the line
  break kept. The old router forced such an answer down one pure branch (escape the tags) or the
  other (drop the `\n`), each losing half of it.
- **`html: true` disables markdown-it's escaping**, so its output is now UNTRUSTED model HTML on its
  way into outgoing mail. It MUST cross `sanitize(..., { allowBlocks: true })` — the ONE allowlist
  walk in `js/mzta-richtext.js`, the same one the diff picker uses. No second copy.
- **Code fences still show markup as text**: markdown-it escapes HTML inside code blocks regardless
  of `html: true`, so "how do I center a `<div>`?" is unaffected.
- **`BLOCK_ALLOWED` is a superset of everything markdown-it emits** — it was widened with the table
  family and `hr` so a markdown table or rule does not get unwrapped. `img` stays stripped.

### Streaming: re-render the whole accumulated raw each time

A flush routinely lands mid-tag (`<p>Distinti sal`) or mid-inline-tag (`<b>Mar` | `io</b>`), so
segments cannot be rendered and appended independently — the WHOLE accumulated raw text is
re-rendered on each flush and the result REPLACES `_fullTextHTML` (`cumulative: true`). Re-parsing
the whole raw text, not concatenating per-segment output, is what keeps every element — and every
raw tag split across a segment boundary — whole. To keep that O(n) re-render from becoming O(n²)
over a response it is coalesced to roughly every `HTML_RENDER_CHUNK` (2 KB) of new text, plus always
on the final flush; between renders (`deferred: true`) the live token spans `messagesArea` appends
show the text arriving. This is the mechanism the old HTML-answer branch already used and proved
correct; it is now the only path.

The `<think>` handling is unchanged: the unterminated-`<think>` guard still defers mid-stream, and
`stripThinkTags()` still separates reasoning from the answer. Worker and inline thinking accumulate
into **running totals** (never drained), so each cumulative render hands back the whole reasoning and
`messagesArea` rebuilds the thinking block with it — a per-flush drain would blank the reasoning on
the second render of a thinking-then-long answer.

One consequence of calling `stripThinkTags()` **per segment** rather than once per response: its
leading-whitespace trim must stay off here (it is opt-in via the third argument, default off). The
space that opens a segment is interior to the answer once the segments are concatenated into
`_htmlRawText`, so trimming it fuses two words across the boundary. Whole-response callers such as
`mzta-special-commands.js` opt in; this one must not.

**Historical note — the removed router.** `flush()` used to decide, once per response, whether the
answer was HTML:

a lead-in followed by a block tag (`looksLikeHtmlResponse()`) routed the reply to
`sanitizeBlockHtml()` instead of markdown-it; a bounded prose prefix, code masking, a **sticky**
`_isHtmlResponse` verdict and a `null` "not enough evidence yet" state made the test robust across the
per-`\n` flushes. All of that machinery — and `normalizeEchoedBrTags()`, which existed only to keep
markdown-it (`html: false`) from escaping echoed `<br>` runs — is deleted. With `html: true` a `<br>`
is simply a `<br>`, and there is no path to route to. The one piece the HTML branch already had right
and that survives verbatim is the **cumulative, coalesced re-render** described above.

Two consequences of coalescing, both handled explicitly:

- **The `fullTextHTML` mirror is skipped while deferred.** `flushAccumulatingMessage()` returns on
  `deferred` *before* copying the snapshot into `this.fullTextHTML`, because on that path the
  snapshot was not re-sanitized and trails the received text by up to `HTML_RENDER_CHUNK`.
  Publishing it would expose a truncated answer to a reader that looked between renders. Nothing
  is lost: the final flush is never deferred, and `addActionButtons()` — the only reader — runs
  after it.
- **The abort path must discard the streaming state.** `appendBotMessage()` (the `'error'` path,
  the one exit that reaches no final flush) nulls `_streaming` and `accumulatingMessageEl`, the
  way `handleTokensDone()` does normally. Otherwise the interrupted `StreamingMessage` would keep
  its accumulated `_htmlRawText` and its non-zero `_htmlPendingChars`, and the next answer streaming
  into the same element would be rendered as a continuation of the failed one.

**There is no newline→`<br>` post-pass over the rendered DOM.** With `breaks: true` every break is
already a real `<br>` element in the HTML — and therefore in `fullTextHTML`, the snapshot the
"use this answer" path inserts into the mail. That symmetry is the invariant: the chat and the mail
must show the same line structure. The old `convertTextNodeNewlinesToBr()` fixed up only the chat
DOM, so the mail silently lost every single-`<br>` break; it has been removed. Re-adding it would
also double-space the answer, since markdown-it emits `<p>a<br>\nb</p>` and the `\n` right after the
`<br>` would be promoted to a second one.

The complementary half of this lives on the input side: the compose-window HTML placeholders
go through `normalizeHtmlSourceNewlines()` (`js/mzta-utils.js`), **not** `convertNewlinesToBr()`,
so the prompt no longer carries a `<br>` at every source newline for the model to copy back.

**With one exception, and it is the important one: that rule assumes the source really is HTML.**
In a plain text compose window there are no tags — the line breaks *are* the `\n` characters — so
collapsing them to spaces leaves the entire body as one run-together line, which then reaches both
the model and the diff picker. `getMailBody()` in `js/mzta-menus.js` therefore checks the shape of
what the content script returned (the shared `hasLineStructure()`): a value holding a block tag or a
`<br>` is normalized as before, and a value holding neither is rebuilt from its **text** twin with
`linesToHtml(..., { mode: 'br' })`. Same rule `getMailInlineTextParts()` in `js/mzta-utils.js`
already applies to a text/plain-only mail, whose html is synthesized with the same `linesToHtml`.

`normalizeHtmlSourceNewlines()` keeps its current behaviour deliberately — the decision belongs at
the call site, where the source's shape is known, not inside a helper every HTML consumer shares.
Consumers of a *structure-less* twin must not assume its newlines survived; consumers of a structured
one are unaffected. See [07-diff-picker.md](07-diff-picker.md) → *Where the original's HTML comes
from* for the picker's matching backstop.

#### The compose-extraction newline contract

`getOnlyTypedText` / `getOnlyQuotedText` (`js/mzta-compose-script.js`) feed `{%mail_typed_text%}`
and `{%mail_quoted_text%}`. They used to accumulate `node.textContent + " "`, which lost line
structure twice over: `textContent` drops `<br>`, so breaks *inside* a node vanished, and the
space join erased the boundaries *between* top-level nodes. The composed mail therefore reached
the model as one run-together line, and the diff picker compared a well-formatted answer against
a one-line original — every line read as changed. [#829]

The extraction now projects each top-level node with `nodeTextKeepLines()` (`<br>` → `\n`, trailing
break trimmed because Thunderbird's editor ends most lines with a bogus `<br>`) and joins nodes with
`\n`, or `\n\n` when the node is block-level (`MZTA_BLOCK_LEVEL_RE`: `P`, `BLOCKQUOTE`, `UL`, `OL`,
`TABLE`, `H1`–`H6`, `PRE`). That is `blockTextOfHtml()`'s projection from `api_webchat/diffPicker.js`
applied to a live node — **reimplemented, not imported**: the compose script is registered as a
*classic* content script (`composeScripts.register`), has no module context, and cannot import from
`js/mzta-utils.js`. A plain text compose window needs no special case: its breaks are already real
`\n` in the text nodes ([#855]), there are no `<br>` to replace, and nothing doubles up.

The resulting contract, identical across every compose-window kind: **one `\n` between lines, one
blank line (`\n\n`) between paragraphs.** Paragraph mode gives every `<p>` boundary a blank line, so
its output is `\n\n`-separated throughout.

`cleanupNewlines()` would undo this — it collapses `\n{2,}` to `\n`. The two placeholders are
therefore cleaned with **`cleanupNewlinesKeepParagraphs()`** (`js/mzta-utils.js`), identical except
that it caps at `\n\n` instead of collapsing. `cleanupNewlines()` is left alone on purpose: its
other callers feed the diff picker's original side and the full-body placeholders, where widening
the rule would change every existing comparison.

#### Non-breaking spaces, and the order of the cleanup rules

Both cleanup functions convert **two spellings** of the non-breaking space to a plain space: the
`&nbsp;` entity, and the literal **U+00A0** that `DOMParser` hands back once it has decoded
`&nbsp;` in an HTML body. The literal is the one that actually appears on the HTML path — the
entity form only survives in text that never went through a parser — and it used to reach the
prompt untouched, an invisible character that none of the whitespace rules could collapse. Neither
spelling may be *dropped* instead of spaced: that welds the surrounding words together
(`Ciao&nbsp;Mario` -> `CiaoMario`).

**The conversion runs before the whitespace rules, not after.** Only then do the spaces it produces
get collapsed by `[ \t]+` and trimmed at end of line like any other whitespace; with the conversion
last, as it once was, they survived uncollapsed.

One consequence is deliberate in `cleanupNewlinesKeepParagraphs()`: a line holding nothing but
`&nbsp;` is how HTML mail writes a blank line, so `\n \n` becomes `\n\n` and the paragraph break
survives rather than being trimmed away to nothing.

`htmlBodyToPlainText()` **delegates** to `cleanupNewlines()` rather than repeating its rules. It
used to carry a hand-copied twin of them whose `&nbsp;` rule *deleted* the entity instead of
spacing it; delegating makes the two impossible to diverge again.

#### `htmlBodyToPlainText()` injects the line structure before reading it

`textContent` emits **no** break for a block-level element, so `<p>`, `<div>`, `<br>`, `<tr>` and
`<li>` boundaries vanish from it entirely. For a long time the only thing keeping the lines apart
was the **source whitespace** between tags — which Outlook/Word mail does not have, its markup
being compact. Every paragraph therefore came out welded to the next one
(`...quotation below:DMS could be XXXXServer 2TB...`).

The function now inserts real break text nodes into the parsed DOM **before** the `textContent`
read, by calling `mztaInjectLineBreaks()` after the hidden-element / `<style>` removals. That helper
lives in **`js/lib/mzta-html-lines.js`** and applies three passes:

1. `td, th` → append a **space** (cells separate with a space, not a newline). First, so the block
   pass's `<tr>` newline still wins at row level.
2. `br, hr` → `replaceWith` a `\n` node. Both are void: they carry no text, so the break replaces
   them rather than being appended inside them.
3. `p, div, li, tr, h1`–`h6`, `blockquote, pre, table, ul, ol, section, article, header, footer` →
   append a `\n` node.

Same parse-then-inject recipe as `htmlToPlainText()` (`api_webchat/messagesArea.js`) and
`blockTextOfHtml()` (`api_webchat/diffPicker.js`) — the add-on treats this as *the* HTML→text
projection, rather than stripping tags with a regex.

It creates its nodes from `root.ownerDocument`, **not** the ambient `document`: it runs against a
`DOMParser` document in the background page and against a cloned live body in a content script, and
must not depend on the caller's own document in either.

**Over-inserting is deliberately safe**, and is why the passes can be blunt: `cleanupNewlines()`
collapses `\n{2,}` to a single `\n`, so nested blocks (a `<p>` inside a `<div>`, `<li>` inside
`<ul>`) and empty Outlook spacer paragraphs (`<p class=MsoNormal><o:p>&nbsp;</o:p></p>`) fold away
instead of becoming blank lines. That collapse is load-bearing here: the output of this function
never contains a blank line, and pretty-printed HTML (whose source newlines now sit *next to* an
injected one) does not gain any. Do not relax the rule to "fix" paragraph spacing on this path.

> Known gap: `<pre>` keeps its line breaks but **not** its internal indentation or blank lines —
> `cleanupNewlines()`'s `[ \t]+` → ` ` and `\n{2,}` → `\n` rules run over the whole string.
> Preserving it verbatim would need a sentinel/restore pass around that chain: new machinery and a
> new collision failure mode, for an element that is rare in mail.

#### Hidden elements — `mztaStripHidden()`, and why the attribute selector was wrong

Both extractions remove elements hidden by an **inline style** or the **`hidden` attribute** before
reading the text, through the one shared `mztaStripHidden(root)` in
`js/lib/mzta-html-lines.js`. It mutates `root` in place (same contract as `mztaInjectLineBreaks`) and
tests each `[style], [hidden]` element against

```js
/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|!|$)/i
```

`htmlBodyToPlainText()` used to do this with `doc.querySelectorAll('[style*="display:none"]')`, and
`[style*="…"]` is a **literal substring test** — wrong in *both* directions:

- It matched only the unspaced spelling, so **`display: none`** — the form virtually every mail
  client, newsletter builder and Word/Outlook export actually emits — sailed straight through, as did
  any mixed case. Newsletter **preheaders** (the preview blurb written for the inbox list, not the
  body) and tracking markup therefore landed in `{%mail_text_body%}`, costing tokens and misleading
  the model about what the mail says.
- Being unanchored it *also* removed elements whose style merely **ended** in that text, such as the
  vendor longhand `mso-hide:all;-x-display:none`.

Anchoring on `(?:^|;)` makes it a declaration match; `\s*(?:;|!|$)` tolerates `!important` and a
trailing `;`. `visibility:hidden` and the `hidden` attribute ride along in the same pass for one
extra alternation. It is deliberately **not** a CSS parse — inline styles are what mail uses here.

> **Limitation, by design:** an element hidden only by a `<style>` block or an external/class rule is
> **not** removed. The add-on never resolves CSS — the projection runs on a **detached** DOM with no
> layout and no computed style (the same reason `innerText` is unusable here) — and `<style>` is
> already stripped by both callers, so its rules are not even present to consult.

**It is a separate, opt-in pass, NOT part of `mztaInjectLineBreaks()`.** That projection also serves
the **insertion** side (`mztaHtmlToLines` → `stripHtmlKeepLines`, and `_replaceSelectedText()` in
`mzta-background.js`), which writes the AI answer *out* to a compose window; dropping content there
would be silent mangling.

#### The text/HTML rule: stripped from the TEXT, never from the HTML

**Hidden markup is removed from the text placeholders only. `{%mail_html_body%}` and
`{%mail_html_body_or_selected%}` keep it, on BOTH paths.** This is the deliberate boundary, and it is
what makes the strip's placement fiddly on the interactive side.

Unlike `<style>`/`<script>` in `MZTA_INJECTED_SELECTORS` — noise in both worlds, so removed from the
clone itself — a hidden element is **real markup** that an HTML consumer may legitimately want. An
HTML placeholder's job is to hand over the message's markup; silently editing it is not this fix's
business.

| | text (`{%mail_text_body%}`) | html (`{%mail_html_body%}`) |
|---|---|---|
| Interactive | `getTextBodyHtml()` → **stripped** | `getFullHtml` → `getCleanBodyHtml().innerHTML` — **kept** |
| Background | `htmlBodyToPlainText()` — **stripped** | `getMailInlineTextParts().html` — **kept** |

- **Interactive.** `getCleanBodyHtml()` is shared by three message cases, two of them text
  (`getText`, `getTextOnly`) and one HTML (`getFullHtml`). The strip therefore lives in a thin
  wrapper, **`getTextBodyHtml()` = `mztaStripHidden(getCleanBodyHtml())`**, called by the two text
  cases only. Putting it inside `getCleanBodyHtml()` — the obvious-looking spot — silently strips
  `{%mail_html_body%}` and the diff picker's original side as a side effect, because `getFullHtml`
  reads that same clone.
- **Background.** Nothing was needed: `getMailInlineTextParts()` (`js/mzta-utils.js`) builds
  `msg_text.html` itself, applying only `removeMozMainHeader()`, and `htmlBodyToPlainText()` parses
  that string into a **separate** document before stripping. The HTML the placeholder receives is
  untouched by construction. Do not "align" the two by adding a `mztaStripHidden()` call to
  `getMailInlineTextParts()`'s `else` branch — that would break this rule on the background path.

Selections are untouched on every path: `getSelectedHtml` builds its own `div` from the Range rather
than going through `getCleanBodyHtml()`, and text the user deliberately selected is not hidden to
them.

`getCleanBodyHtml()`'s orbit had **no** hidden-element handling at all before this, so the
interactive text extraction kept every preheader the background one dropped — the same
one-path-fixed-not-the-other split that already bit the line projection twice.

#### Where the body comes from — `listInlineTextParts()`, not a `getFull()` walk

The `{text, html}` pair every background consumer starts from is built by
**`getMailInlineTextParts(messageId)`** (`js/mzta-utils.js`), which asks
`browser.messages.listInlineTextParts()` for the message's inline text parts: the ones that make up
the readable content, and precisely the ones `listAttachments()` does **not** return. They arrive as
a flat array with the content already decoded, so `text/plain` parts concatenate into `text` and
`text/html` parts into `html` with no tree walk.

It replaced `getMailBody(fullMessage[, messageId])`, which walked the MIME tree from
`messages.getFull()` via a private `extractTextParts()`. That walk had **three** defects, all fixed
by the source change rather than patched:

1. **Attachments leaked into the body.** `extractTextParts()` collected *every* `text/*` part in the
   tree with no content-disposition filter, so an attached `.txt` file and the parts of a forwarded
   `message/rfc822` were concatenated into the body. The HTML conversion masked this in
   `{%mail_text_body%}`; `{%mail_plain_text_part%}`, which is verbatim, put the attachment straight
   into the prompt. **Excluding them is now a guarantee of the API, not a filter of ours** — do not
   add a content-disposition check back.
2. **The `messageId` was not passed on the automatic paths.** Only `js/mzta-menus.js` supplied it,
   so the `getAttachmentFile()` recovery for parts with an empty `body` ran in the reader and never
   in tagging, the spam filter, summarize or translate. The same message could resolve in one and
   resolve empty in the other. There is now **one** body read, taking the id everywhere, so the
   interactive and automatic paths cannot disagree.
3. **`part.body` was not guaranteed.** It is documented as present only when `getFull()` is asked
   for it via `decodeContent`; every `getFull()` call site here passes no options and relied on the
   permissive default. `listInlineTextParts()` returns decoded content by contract.

**Deleted with it:** `extractTextParts()`, `smartDecode()` (the utf-8 → windows-1252 fallback) and
the sole `browser.messages.getAttachmentFile()` call in the repo — all three existed only to work
around `getFull()`. `removeMozMainHeader()` stays: `htmlBodyToPlainText()` uses it too.

**Unchanged, deliberately:** the `{text, html}` construction itself. The `html === ""` synthesis via
`mztaLinesToHtml(text, { mode: 'br' })` and the `else` branch's `DOMParser` +
`removeMozMainHeader()` + `doc.body.innerHTML` are carried over verbatim, so every placeholder value
is byte-identical for ordinary mail. In particular `mztaStripHidden()` is still **absent** here — see
*The text/HTML rule* above.

**Encryption.** The API decrypts by default and omits the parts it cannot decrypt. No distinction is
lost: the old walk never read `part.decryptionStatus` either (the only mention was a commented-out
`console.log`), and an undecryptable part contributed nothing usable before.

**Failure mode.** The call is wrapped in try/catch, logging through the file's `console.error`
house style, and the `text`/`html` construction sits **outside** it — a failed call still yields a
well-formed `{text: '', html: ''}`, so the callers' `body_text.length == 0` fallbacks behave exactly
as they do for an empty message. TB 128+ is required and `manifest.json` pins
`strict_min_version: 140.0`, so it is called unconditionally with no feature check.

#### Which path actually feeds `{%mail_text_body%}`

`htmlBodyToPlainText()` is **not** on the interactive path, and this is the single most misleading
thing about this area. Two separate extractions exist:

| Path | Extraction | Feeds |
|---|---|---|
| Automatic (background) | `htmlBodyToPlainText()` (`js/mzta-utils.js`) | auto add-tags, spam filter, on-receive summarize/translate |
| Interactive (menu / popup) | `getTextOnly` in `js/mzta-compose-script.js` | `{%mail_text_body%}` when the user runs a prompt |

The interactive chain is `getMailBody()` (`js/mzta-menus.js`) → `getTextOnly` → `getCleanBodyHtml()`
→ `cleanupNewlines()` → `curr_prompt.body_text`. Fixing one path does nothing for the other; both
carry the same one-`\n`-per-block, never-a-blank-line contract and must be kept in step.

`js/mzta-compose-script.js` serves **both** window kinds — `composeScripts.register` *and*
`messageDisplayScripts.register` (`mzta-background.js`) — so "compose script" is a misnomer: it is
also the reading-side extractor.

#### `getCleanBodyHtml()` returns a DETACHED clone, so `innerText` does not work there

`getCleanBodyHtml()` clones `document.body`. `innerText` is defined in terms of **layout**, and a
detached node has no layout boxes, so the engine falls back to `textContent` behaviour. `getTextOnly`
read `getCleanBodyHtml().innerText` and therefore silently got `textContent` semantics: no break for
a block element, no break for `<br>`. On Outlook/Word mail — compact markup with no whitespace
between tags — the whole body arrived as one welded line. (`07-diff-picker.md` already warns against
`innerText` for the same layout-dependence reason.)

Two fixes, both in `getCleanBodyHtml()`'s orbit:

1. **`style` and `script` joined `MZTA_INJECTED_SELECTORS`.** They hold no readable text, but their
   *source* is text, and `textContent` reads stylesheet rules out as body copy. A Word mail carries a
   long `@font-face` / `.MsoNormal` block at the top of `<body>`, which is what was landing in the
   prompt. Removing them in the clone also keeps the CSS out of `getFullHtml`'s `innerHTML`, so it no
   longer rides along in `{%mail_html_body%}` or the diff picker's original side.
2. **`getTextOnly` now calls `mztaHtmlNodeToLines()`** instead of `innerText` — the shared
   projection, layout-independent by construction.

The projection emits **one** `\n` per boundary, deliberately *not* the `\n\n` that
`MZTA_BLOCK_LEVEL_RE` earns in the typed/quoted walkers: it feeds `{%mail_text_body%}`, whose
contract is one line per block and no blank lines.

#### The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)

The add-on used to hand-reimplement the same handful of HTML↔text conversions in ~9 places with
divergent block-tag lists. They now live in **one** layer, split across two files by the
classic-script constraint:

- **`js/lib/mzta-html-lines.js`** — a **classic script sharing globals**, hosting the DOM
  **projection** and the plain-text **normalizer** / **converters**:
  `mztaInjectLineBreaks(node)` / `mztaHtmlNodeToLines(node)` (the projection), `mztaHtmlToLines(str)`
  (string entry point), `mztaNormalizePlain(text, {keepParagraphs, keepColumns})`,
  `mztaLinesToHtml(text, {mode})`, `mztaStripHidden(node)` (the hidden-element rule — extraction
  only, see below) and the one heuristic `mztaHasLineStructure(html)`. The projection
  is **two-tier**: a `<p>` boundary becomes a blank line (`\n\n`), every other block boundary and
  `<br>`/`<hr>` a single `\n`, table cells a space — and `mztaNormalizePlain` picks the outcome
  (default collapses `\n{2,}` for the body contract, `{keepParagraphs}` caps at `\n\n` for insertion,
  `{keepColumns}` is verbatim for `{%mail_plain_text_part%}`).
- **`js/mzta-richtext.js`** — an **ES module** hosting the ONE **sanitizer** + **tag taxonomy** (see
  the render section above and [07-diff-picker.md](07-diff-picker.md)), plus **`globalThis`
  re-exports** of the projection above (`htmlToLines`/`linesToHtml`/`normalizePlain`/
  `hasLineStructure`) so module-world callers get a clean `import`. The re-exports resolve the global
  at CALL time, so the module loads fine even where the classic script is absent as long as they are
  not called there.

The classic file is a classic script — not an ES module — because `js/mzta-compose-script.js` is
loaded by `composeScripts.register` / `messageDisplayScripts.register` / `tabs.executeScript`, none
of which give it module context, so it cannot `import`. It is loaded on **four** surfaces:

- **content script** — listed *before* `mzta-compose-script.js` in all **three** registration sites
  (`mzta-background.js`); the array order is the load order. A new injection site must list it too.
- **background** — a plain `<script>` in `mzta-background.html`, ahead of the `type="module"` entry
  point, exactly as `markdown-it.min.js`. `js/mzta-utils.js` reaches it through `globalThis`.
- **webchat** — a plain `<script>` in `api_webchat/index.html`, ahead of the module scripts, because
  `js/mzta-utils.js` (imported there for `convertNewlinesToBr`, now a `globalThis` shim) needs it.

`js/mzta-utils.js`'s conversion helpers (`htmlBodyToPlainText`, `stripHtmlKeepLines`, `cleanupNewlines`
/ `cleanupNewlinesKeepParagraphs` / `normalizePlainTextPart`, `convertNewlinesToBr` /
`convertNewlinesToParagraphs`) are now thin shims that delegate to the classic globals — one source of
truth, reached anywhere the classic script is loaded. A settings or popup page that starts calling one
of them would need the `<script>` tag too. Same shape as `js/lib/diff.js`.

**`{%mail_typed_text%}` / `{%mail_quoted_text%}` are untouched by all of this.** Their walkers read
`window.document.body.childNodes` **directly**, not the clone (which is the known gap recorded
below), so neither the `<style>` removal nor the new projection reaches them, and their `\n\n`
paragraph contract is preserved exactly.

The plain-text fallbacks that run when `htmlBodyToPlainText()` yields nothing — in
`_generateSpamReportForMessage` and `processEmails` (`mzta-background.js`) and in
`taPromptUtils` (`js/mzta-utils-prompt.js`) — call `cleanupNewlines()` too. They previously used
`.replace(/\s+/g, ' ')`, which destroys **every** newline and flattened the mail into a single
line.

The node-walking logic is unchanged — the `moz-cite-prefix` / `moz-forward-container` breaks, the
`firstNode`/`lastNode` tracking and the `do_autoselect` range all behave exactly as before. In
particular `lastNode` is still keyed off `node.textContent`, **not** the new projection, so the
autoselect range is provably identical.

> Known gap, not fixed here: `getOnlyTypedText` walks `document.body.childNodes` directly rather
> than `getCleanBodyHtml()`, so injected ThunderAI DOM (`#mzta-container`, `.mzta_dialog`) and the
> `moz-signature` can contaminate `{%mail_typed_text%}`. Swapping in `getCleanBodyHtml()` would
> break autoselect — it returns a detached clone, and the range needs live nodes.

The answer-text snapshot is what the "use this answer" /
"copy" / "save as summary" / diff buttons close over — one instance per turn keeps each
turn's buttons tied to their own response.

Every one of those buttons honours a text selection and acts on just that part of the
answer, falling back to the whole snapshot when nothing is selected. "Copy" writes **plain
text**, so it reads the selection through `getCurrentSelectionText()` and converts the
snapshot with `htmlToPlainText()` — which parses the markup, decoding entities (`&amp;` → `&`)
and turning `<br>` and block boundaries into real newlines. The older `stripHtmlTags()` regex
is still used where the consumer wants tags gone but escapes left alone (the diff viewer).

### Writing into a plain text compose window

Whether the target composes in plain text is read from the window itself —
`isPlainTextCompose(tabId)` (`js/mzta-utils.js`) wrapping `compose.getComposeDetails()`. It is
**not** a preference: the compose format is a per-message property, so a global setting could
never be right for a user whose identities differ. (A `composing_plain_text` pref did exactly
that until it was removed in favour of this detection — see [#855](https://github.com/micz/ThunderAI/issues/855).)

When it reports plain text, `mzta-background.js` converts the answer snapshot with
`stripHtmlKeepLines()` (`js/mzta-utils.js`). The line structure there is carried by the
**tags**, not by the source newlines: the renderer emits `<br>\n` and `</p>\n<p>`, so each of
those rules consumes the pretty-printing newline that follows its tag. Counting both would
double every line and make a single `<br>` indistinguishable from a paragraph break.

**Converting is only half the job — the insertion path has to stop treating the result as
HTML.** Three places cooperate, and all three are required:

- `replaceSelectedText` (`js/mzta-compose-script.js`) inserts a **`Text` node** when
  `message.isPlainText` is set, instead of routing through `DOMParser`. This is the actual
  fix for #855: in HTML a bare `\n` is collapsible whitespace, so parsing the converted text
  rendered every line break as a single space and the whole message arrived as one line.
- The HTML branch of the same handler inserts the parsed nodes through a
  **`DocumentFragment`**, never `doc.body` itself. Inserting the `<body>` element nests a
  second `<body>` inside the compose body; the `compose_reloadBody` round-trip on the very
  next line hands that invalid markup to Thunderbird's serializer, which flattens the
  misplaced blocks and destroys the `<p>` paragraphs the diff picker emits. The fragment's
  children are collected with `Array.from(doc.body.childNodes)` because `childNodes` is a
  **live** NodeList — `appendChild` removes each node from the list being walked, so
  iterating it directly would skip every other node.
- `getOriginalBody` / `setBody` / `reloadBody` / `replaceBody` (`js/mzta-utils.js`) read and
  write **`plainTextBody`**, not `body`. Writing `body` on a plain text window makes
  Thunderbird convert the HTML down to text, undoing the line structure again — which matters
  most in `compose_reloadBody`, whose `setBody` round-trip runs right after the insertion.
- `chatgpt_replyMessage` **omits** `isPlainText` from `compose.beginReply` rather than forcing
  `false`, so the reply follows the identity's own format; `replaceBody()` then reads the
  format back off the created tab. On a plain text reply there is no DOM to splice into, so
  the answer is prepended to the existing text with a blank line rather than going through
  `insertHtml()`.

### Theming

Every colour in the window comes from a CSS custom property declared once on `:root` in
`api_webchat/styles.css`, with a `@media (prefers-color-scheme: dark)` override. The theme
follows Thunderbird/the system; **there is no manual override**, because applying one before
first paint would need an inline `<head>` script, which the default MV2 CSP forbids.

The three components each live in their own shadow root, which `styles.css` cannot select
into. Custom properties are inherited DOM properties and *do* cross shadow boundaries, so
they are the theming channel: component styles consume `var(--token)` and must never declare
literal colours or their own `prefers-color-scheme` block. Rules that are not custom
properties (focus rings, `@keyframes`, the reduced-motion opt-out, the shared button
families) live in `api_webchat/sharedStyles.js` as CSS strings that each component
concatenates into its own `<style>`.

`--accent` mirrors `pages/_lib/mzta-design.css` so the whole add-on shares one blue.

### Transcript DOM contract

Every exchange is wrapped in a `.turn` element — the wrapper is what makes the per-answer
toolbar possible, since `:hover` / `:focus-within` need a single element enclosing an answer
and its buttons. There are no `<hr>` dividers; spacing separates the turns.

```
#messages
  .turn.turn-user   → .bubble                        (accent bubble, right-aligned)
  .turn.turn-info   → .message.info                  (full-width startup notice)
  .turn.turn-bot    → .turn-head (avatar)
                      .turn-body → .turn-name
                                   .message.bot       (one per flushed block)
                                   .turn-tools        (icon toolbar, earlier answers)
                                   .action-bar        (full bar, newest answer)
                                   .sel_info          (alongside the full bar)
```

Two invariants in `MessagesArea`, both easy to break:

- **`_currentTurnEl` must survive a flush.** A single response flushes on every bare `\n`
  token, and — only once the response is known to be HTML — on every token that *contains* a
  `\n` (`handleNewToken()` tests `token === '\n' || (token.includes('\n') &&
  streaming.isHtmlResponse === true)`, not just `token === '\n'` — providers tokenize
  differently and plenty send `"foo\nbar"` as one token, which a strict equality test would
  never flush). The embedded-newline trigger is gated to the HTML path because `flush()`
  re-renders the whole accumulated raw text there, so splitting at an embedded newline costs
  nothing; on the markdown path each flush renders only its own segment, so flushing at
  `"foo\nbar"` would strand the text after the newline in a separate `<p>`. While the shape is
  still undecided only a bare `\n` flushes. Clearing `_currentTurnEl` in
  `flushAccumulatingMessage()` would therefore open a new wrapper — and render a second
  avatar — part-way through one answer. Only `appendUserMessage()`, `appendBotMessage()` and
  `handleTokensDone()` reset it. `appendDiffPicker()` can run against an older turn mid-session,
  so it saves and restores the field around `_beginBotTurn()`.
- **`_lastFullBarTurn` owns the only full action bar.** `addActionButtons()` calls
  `_degradeFullActionBar()` first, so two full bars never coexist. `.action-bar` and
  `.turn-tools` are mutually exclusive on a given turn — an answer showing the full bar needs
  no icon toolbar, because every icon would duplicate a button already spelled out beside it.
  Degrading therefore *replaces* the bar with the toolbar. The toolbar is built at that
  moment, but from the arguments stashed on the turn (`_mztaToolsArgs`) when the bar was
  created, so it stays bound to that answer's own text rather than to whatever is on screen
  later.

**Self-closing `chatgpt_close` must be fire-and-forget.** Every button that finishes an
action (reply / replace / save-summary / plain close) ends by sending
`{command: "chatgpt_close", window_id}` to close *its own* window. `runtime.sendMessage`
returns a promise awaiting the background reply, but the command destroys the very context
waiting for it, so the promise rejects with `Actor 'Conduits' destroyed before query
'RuntimeMessage' was resolved`. These calls are therefore left un-awaited **and** carry a
`.catch(() => {})` to swallow that expected rejection — the preceding action call (e.g.
`chatgpt_replyMessage`, `chatgpt_replaceSelectedText`) is still `await`ed because its reply
is needed before the window goes away. Same pattern in `js/mzta-chatgpt.js` (the legacy
fixed-div buttons).

### Scrolling (prompt-anchored following)

**Exactly one box scrolls: `#messages`** inside the `<messages-area>` shadow root. The host is
`overflow: hidden` in *both* places that style it — `:host` in `messagesArea.js` and the
light-DOM `messages-area` rule in `styles.css`, which wins on specificity, so both must agree.
A `wheel` event over `#messages` bubbles to the host, so a second scrollbox there would leave
the logic below reading a `scrollTop` that is not the one moving.

The transcript **follows new content only while the user has not read back**
(`_stickToBottom`; `MessagesArea.BOTTOM_SLACK_PX`, 24px ≈ one line of body text, absorbs
sub-pixel `scrollHeight` rounding across font-zoom levels). Scrolling up mid-stream freezes the
view; the floating `#jumpToLatest` button returns to the bottom and re-arms following, and
scrolling back to the bottom by hand re-arms it too. `_stickToBottom` is now *purely* that
follow state — it no longer gates the button (see below), so `_setStickToBottom()` is a plain
assignment with no early return.

*Where* following aims depends on the **prompt anchor**. `appendUserMessage()` pins the exchange
to the user turn it just created (`_setAnchor`; `info` notices do not pin — they are not
prompts). While an anchor is set, `_followTarget()` aims at **the prompt at the top of the
viewport** rather than at the bottom of the transcript, so the answer streams down into a still
window instead of dragging the reader along line by line. Three clamps define it:

- **Never past the content bottom.** A short exchange that already fits entirely is therefore a
  no-op — the target collapses onto the ordinary bottom and nothing special happens.
- **Never backwards** (`max(target, scrollTop)`): a growing answer can never push the prompt
  back down into view.
- **A tall prompt yields.** If putting the prompt flush at the top would leave the answer less
  than two thirds of the window, the target instead puts the *answer's* top one third down —
  prompt one third, answer two thirds (`PROMPT_MAX_VIEWPORT_SHARE = 1/3`, measured off the
  answer turn, which is the anchor's `nextElementSibling`).

**`#anchorSpacer` is what makes the anchor reachable at all.** Right after a prompt is sent the
transcript is not tall enough to scroll it to the top — `scrollHeight - clientHeight` sits just
past the prompt — so without reserved space the view would barely move (and the prompt would
creep up only as the answer happened to grow). `_updateAnchorSpacer()` inserts a
`flex: 0 0 auto` div as the **last** child of `#messages`, sized to the shortfall between the
content below the prompt and one full viewport, and shrinks it to nothing as the answer grows
into it. Consequences worth keeping straight:

- It exists **only while an exchange is pinned** — `_setAnchor(null)` removes the node, so a
  finished conversation never ends in dead space. `handleTokensDone()` is what normally retires it,
  before its final follow; the user gestures that drop the anchor do it too.
- **Turns are inserted before it**, via `_appendTurn()` (`insertBefore(turn, this._anchorSpacer)`;
  a null spacer makes that a plain append). Appending *past* the spacer would render the answer
  below a viewport-sized gap for the frame before the order is corrected.
- Its height is subtracted **arithmetically** (`offsetHeight`), never by collapsing it to 0 and
  re-measuring: shrinking content mid-frame lets the browser clamp `scrollTop` and discard the
  position being held. The write is also skipped when the value is unchanged.
- `_scrollNow()` re-sizes it *before* computing the target, since `_followTarget()` clamps to a
  `scrollHeight` that must already include the reservation.

Positions are measured with `getBoundingClientRect()` deltas against `#messages`' own rect (plus
`scrollTop`), not `offsetTop`: `#messages` is `position: static`, so the turns' `offsetParent` is
the *host*, and `offsetTop` there does not mean "distance into the scrolled content".

Once the anchor position is reached the view **holds still** for the rest of the answer. The
user regains bottom-following by scrolling to the bottom themselves or pressing `#jumpToLatest`
— both drop the anchor.

**`handleTokensDone()` drops the anchor before its final follow**, and the order matters. Once the
answer is complete the anchor has nothing left to hold — its whole job was keeping the view still
while the answer streamed into it — and while it is still set `_followTarget()` clamps to the
anchored position and *stops there*. In reply mode that falls short of the action bar: it is the
tallest bar of the lot (two-line split button + visible `.sel_info`) and all of it lives below the
anchored target, so the view never scrolls far enough to show the whole bar and `#jumpToLatest`
stays up pointing at it. Clearing the anchor first is what lets that last `_scrollIfSticky()` reach
the real bottom.

**`#jumpToLatest` visibility is decided on live geometry, never on the follow flags:**
`_updateJumpButton()` is exactly `hidden = _isNearBottom()`. Keying it off state instead
(`_stickToBottom && !_anchorTurnEl`) is the bug it replaced — a short anchored answer clamps
`_followTarget()` onto the ordinary bottom, so the view *is* at the bottom while an anchor is
still set, and the button sat there advertising a jump with nowhere to go (clicking it only
"worked" because `scrollToBottom()` cleared the anchor). Because the answer is geometric it has
to be recomputed wherever the geometry can move, and the state setters are the wrong hook — they
early-return when the value is unchanged, which during a stream is every frame:

- `_onMessagesScroll()` — unconditionally, after the two setters (which may both be no-ops).
- `_scrollNow()` — on **both** paths: after the `scrollTop` write (the `_programmaticScroll`
  latch makes the resulting `scroll` event skip its own update), *and* on the no-write early
  return, which is the only signal available when content grew but the target did not move.
- the scroller `ResizeObserver` — unconditionally, not just via `_scrollIfSticky()`: growing the
  viewport can bring the bottom into view, and while the user is scrolled up that call does nothing,
  so no frame would otherwise run.
- the content `ResizeObserver` (`_contentObs`, one entry per turn) — because the scroller-level
  observer is blind to exactly the growth that matters: `#messages` is a flex item whose height the
  column decides, with `overflow-y: auto`, so **its own border box never moves when its content
  grows** and it reports nothing. Without this, a content append with no scroll event and no frame
  of ours in flight leaves the button showing whatever it showed before.
- `_setAnchor()` — after `_updateAnchorSpacer()`, since the spacer changes `scrollHeight`.
- `addActionButtons()` — see below.

```
_setAnchor(null)    drop the anchor, no scroll         → handleTokensDone (before its follow)
scrollToBottom()    real bottom, drop anchor, re-arm → appendBotMessage (terminal/error),
                                                       appendDiffPicker, #jumpToLatest click
_resumeFollowing()  re-arm, keep the anchor          → appendUserMessage
_scrollIfSticky()   follow only if still stuck       → handleNewToken, handleTokensDone,
                                                       handleNewThinkingToken, ResizeObserver
```

Four details that are easy to reintroduce as bugs:

- **`_programmaticScroll` must only be raised when the write changes the value.** Setting
  `scrollTop` fires a `scroll` event indistinguishable from a user gesture, hence the latch —
  but when already at the bottom (the common case) the write is a no-op and fires *nothing*, so
  latching unconditionally would swallow the user's next real scroll. The latch also means
  `_onMessagesScroll()` returns early for our own writes, which is why `_scrollNow()` has to
  refresh `#jumpToLatest` itself rather than relying on the scroll event to do it.
- **Writes are coalesced into one `requestAnimationFrame`.** Besides removing a layout-flushing
  write per token, this makes the write land *after* the flush a `'\n'` token triggers —
  `flushAccumulatingMessage()` swaps token spans for rendered markdown and so changes the
  content height, which a scroll-then-flush order leaves unaccounted for.
- **Instant scrolling only, never `behavior: 'smooth'`** — smooth emits a tail of scroll events
  the latch cannot pair one-to-one with its writes, and unsticks mid-animation.
- **`_scrollNow()`'s no-write early return cannot decide the button on its own**, hence the deferred
  `_confirmJumpButton()` re-read on both of its paths. The synchronous reads are right for whatever
  the DOM held at that instant, but an append made earlier in the same task can still be pending
  style resolution, and `_setAnchor(null)` removes the spacer, after which the *browser* clamps
  `scrollTop` by itself. That clamp is what makes `scrollTop === target` and takes the early return —
  so the jump button click used to write nothing at all and merely refresh a stale flag, which reads
  as "the view moves a little, then the button vanishes".

`#messages` also sets `overflow-anchor: none`: Firefox scroll anchoring tries to hold the visual
position as content grows, but the flush tears down and rebuilds the subtree an anchor may have
picked, which surfaces as micro-jumps. A `ResizeObserver` on `#messages` re-follows after window
resizes and font-zoom changes, which move `scrollHeight` without firing a `scroll` event; it also
invalidates the cached `padding-top` (`_padTopPx`) the anchor target is computed from — reading it
with `getComputedStyle` on every frame of a stream would flush style for nothing. A **second**
observer, `_contentObs`, watches the turns instead of the scroller and is registered in
`_appendTurn()` — the single insertion path for every turn — so later growth *inside* a turn also
reaches `_updateJumpButton()`. Its callback, and `_confirmJumpButton()`, must stay **strictly
read-only**: `_updateJumpButton()` only toggles `hidden` on a button that is `position:absolute`
outside `#messages`, and that is the whole reason the observer cannot oscillate. Writing layout from
either place — e.g. reserving bottom padding for the button — would put a layout write inside the
geometry that decides that button's visibility.

`addActionButtons()` deliberately does *not* scroll — `handleTokensDone()` does, which also covers
the paths where that method returns early — though it *does* refresh `#jumpToLatest`: its append is
the largest single content growth of the exchange (in reply mode the split button gains a second text
line and `.sel_info` becomes visible), it lands after an `await browser.storage.sync.get`, and the
`_scrollIfSticky()` that follows it is a no-op while the user sits at the anchored prompt.

### Files

| File | Role |
|------|------|
| `api_webchat/controller.js` | Wires components ↔ worker (DI); owns `promptData`, font-zoom, runtime-command handling |
| `api_webchat/styles.css` | Design tokens (`:root` + dark override), page shell and header bar — the single source of truth for colour |
| `api_webchat/sharedStyles.js` | CSS strings (`SHARED_BASE_CSS`, `BUTTON_CSS`) concatenated into each shadow root's `<style>`: focus rings, keyframes, reduced motion, button families |
| `api_webchat/messagesArea.js` | `<messages-area>` custom element: turn-wrapped transcript, per-answer toolbar + newest-answer action bar, prompt-anchored scrolling + `#jumpToLatest` button, orchestrates the render helpers below |
| `api_webchat/messageInput.js` | `<message-input>` custom element: input field, send/stop buttons, floating status pill (waiting / streaming / done / error), custom-text flow |
| `api_webchat/splitButton.js` | `<split-button>` custom element: the "use this answer" button + optional reply-type dropdown; owns the outside-click and Escape listener lifecycle (`connectedCallback`/`disconnectedCallback`) |
| `api_webchat/streamingMessage.js` | `StreamingMessage` class: per-turn token/thinking accumulation, `<think>` handling, markdown-it render; `flush()` returns an immutable HTML snapshot |
| `api_webchat/diffPicker.js` | `<diff-picker>` custom element: block segmentation, hunk model and compose functions for the interactive change picker. Also exports `sanitizeBlockHtml()`, the gate the HTML answer path uses — see [07-diff-picker.md](07-diff-picker.md) |
| `api_webchat/thinkingBlock.js` | `renderThinkingBlock(container, text, collapsed)` — one-shot `<details class="thinking-block">` renderer |
| `api_webchat/svgIcons.js` | Inline-SVG icon builders (send/stop/dropdown, sparkle avatar, copy, check, diff, save, close, alert, dot (unused), scroll-to-bottom) built via `createElementNS` — CSP-safe, dependency-free, no `innerHTML`; icons stroke in `currentColor` so they follow the tokens |

## Key Modules

| File | Role |
|------|------|
| `mzta-background.js` | Main orchestrator: listens for messages, coordinates all features |
| `js/mzta-menus.js` | Context menu creation and management |
| `js/mzta-prompts.js` | Prompt definitions (built-in) and custom prompt loading |
| `js/mzta-placeholders.js` | Placeholder definitions and resolution logic |
| `js/mzta-utils.js` | General utilities (email parsing, storage helpers, etc.). Shared message-inspection helpers used by the auto-processing features: `extractEmail()` (the single copy of the address regex — **case-preserving**, since `getIdentityForMessage()` compares against the configured identities), `matchAddressList()` / `hasAddressListEntries()`, `messageFolderHasSpecialUse()` / `isMessageInAutoSkippedFolder()` (+ the `AUTO_SKIP_SPECIAL_USE` list) |
| `js/mzta-utils-prompt.js` | Prompt-specific utilities (text truncation, lang injection, `buildSummaryPrompt()` for unified summary prompt assembly, `buildTranslationPrompt()` for translation prompt assembly) |
| `js/mzta-compose-script.js` | Content script for compose and message display: injects AI response into compose window, renders unified toolbar (spam badge, summary/translation trigger buttons) and content panels (generic error, spam explanation, summary, translation) in message display via `#mzta-container` |
| `js/mzta-chatgpt.js` | ChatGPT Web integration (opens browser window, reads DOM) |
| `js/mzta-special-commands.js` | Handles special prompt actions (add_tags, calendar, task) |
| `js/mzta-spamreport.js` | Spam filter logic |
| `js/mzta-i18n.js` | i18n helper (wraps `browser.i18n.getMessage`) |
| `js/mzta-logger.js` | Debug logging (`taLogger`). `log()` gates only the `console.log`, **not its argument** — the message string is always built. On a hot path (per SSE chunk / per line in the workers) guard the call site with `if (taLog.do_debug)`, or do not log there at all. `warn()`/`error()` are never gated. |
| `js/mzta-store.js` | Storage abstraction helpers |
| `js/mzta-storage.js` | Unified per-message storage layer (`taStorage` class) for summary, spam, and translation data |
| `js/mzta-summarystore.js` | Summary-specific storage wrapper (`taSummaryStore` class) with caching, truncation, and processing-state tracking |
| `js/mzta-translationstore.js` | Translation-specific storage wrapper (`taTranslationStore` class) with caching, truncation, and processing-state tracking |
| `js/mzta-working-status.js` | Visual status indicator during AI processing (ref-counted toolbar loading icon) |
| `js/mzta-batch-controller.js` | Cooperative cancellation controller + progress counter for batch email processing (`processEmails`) |
| `js/mzta-addtags-exclusion-list.js` | Tag exclusion list management |
| `js/mzta-placeholders-autocomplete.js` | Caret-anchored autocomplete for placeholders in prompt editors (shared by 8 pages); styled by `pages/_lib/autocomplete.css` |
| `js/mzta-editor-highlight.js` | Live `{%placeholder%}` highlighting for a textarea via a backdrop mirror; exports the shared `PLACEHOLDER_RE` token pattern |

## API Modules (`js/api/`)

Each file handles HTTP communication for one provider:

| File | Provider |
|------|----------|
| `anthropic.js` | Claude (Anthropic) API |
| `google_gemini.js` | Google Gemini API |
| `ollama.js` | Ollama (self-hosted) |
| `openai_comp.js` | OpenAI-compatible APIs |
| `openai_comp_configs.js` | Pre-configured providers (`custom`, DeepSeek, Grok, Mistral, OpenRouter, Perplexity) |
| `openai_responses.js` | OpenAI Responses API |

## Web Workers (`js/workers/`)

Each API provider has a dedicated Web Worker so API calls don't block the UI:

- `model-worker-anthropic.js`
- `model-worker-google_gemini.js`
- `model-worker-ollama.js`
- `model-worker-openai_comp.js`
- `model-worker-openai_responses.js`

Workers receive a message with the prompt and settings, make the API call, and post back the result.

## Feature Pages (`pages/`)

Each subdirectory is a self-contained settings/UI page for a specific feature:

| Directory | Feature |
|-----------|---------|
| `addtags/` | Auto-tagging configuration |
| `customprompts/` | Custom prompt editor |
| `customdataplaceholders/` | Custom placeholder editor |
| `get-calendar-event/` | Calendar event extraction settings |
| `get-task/` | Task creation settings |
| `menu_order/` | Drag-and-drop reordering and visibility control for popup and context menus |
| `spamfilter/` | Spam filter settings |
| `summarize/` | Email summarization settings |
| `translate/` | Email translation settings |
| `onboarding/` | First-run welcome page |
| `_lib/` | Shared libraries used by pages: `connection-ui.js` (API connection UI), `mzta-timezones.js` (runtime-generated IANA timezone list for the calendar event / task selects, see [05-options.md](05-options.md)), `mzta-design.css` (shared design system), `autocomplete.css` (placeholder autocomplete dropdown, linked by all 8 pages that use it — written against both token systems via fallback chains), `editor-highlight.css` (backdrop-mirror structure for live `{%placeholder%}` highlighting, parameterized by `--ed-*` custom properties each page supplies), plus the vendored `tom-select.*` and `list.js` |

## Storage

Regular preferences (feature flags, connection settings, `ollama_*`/`chatgpt_*`/etc., `reply_type`, `connection_type`, ...) are read/written via `browser.storage.sync`, keyed by `prefs_default` in `options/mzta-options-default.js`. A small set of large-payload keys — `_custom_prompt`, `_default_prompts_properties`, `_special_prompts`, `_custom_placeholder`, `add_tags_exclusions` — live in `browser.storage.local` instead, because `storage.sync` has a narrow storage quota (see the one-time sync→local migration in `js/mzta-utils.js`, `migrateCustomPromptsStorage()` / `migrateDefaultPromptsPropStorage()`, added for [#129](https://github.com/micz/ThunderAI/issues/129)).

### Background Preference Snapshot and Menu Invalidation

The background script keeps a **snapshot** of the preferences it consults often, in the module-level `prefs_init` object, refreshed by `reload_pref_init()`. The exact set of keys it holds is the module-level `PREFS_INIT_KEYS` constant, which is also what `reload_pref_init()` passes to `storage.sync.get` — the storage-change gate is derived from that same constant so the two cannot drift apart. Besides the snapshot itself, `reload_pref_init()` recomputes `_process_incoming` (whether any auto-processing feature needs incoming mail) and `_sparks_presence`.

Four invariants apply here. The first three were established by [#855](https://github.com/micz/ThunderAI/issues/855); the fourth was added later, when the debounce turned out to cover only one of the three reload paths.

1. **Special-prompt menu gating must read `storage.sync` fresh, never `prefs_init`.** The single source of truth is `_computeActiveSpecialIds()` in `mzta-background.js`; `_reload_menus()`, `_getActiveSpecialIds()` and the startup `menus.loadMenus()` all go through it. Mixing a freshly changed value with values taken from the snapshot is what made the per-feature integration flags lag behind `connection_type`, hiding a command until restart. Reading everything fresh in one `get` removes the whole class of bug rather than resequencing it. That single `get` must also spread `getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])`, since the gate is computed from each feature's **effective** connection — `getConnectionType(prefs, null, prefix)` for every prefix in `special_prompts_with_integration` — and not from the global `connection_type`. A feature pointing at its own API integration must stay available under ChatGPT Web or with no global connection selected, matching what the options page shows (see `claude-spec/05-options.md`).
2. **`storage.onChanged` handling is coalesced, and refreshes the snapshot before rebuilding menus.** The listener body is synchronous (a 200 ms debounce, the same idiom as `pages/menu_order/mzta-menu-order.js`); the async work lives in the timer, because `onChanged` ignores listener return values. Coalescing here reduces redundant work — a multi-key `storage.sync.set` fires one event carrying several keys, and options pages write one key per change event — but it does **not** by itself prevent overlapping rebuilds from interleaving, since the debounce only covers the `onChanged` path (see invariant 4). The `reload_pref_init()` → `_reload_menus()` order is load-bearing: `doGetSparkFeature()` consults the `_sparks_presence` that the former sets.
3. **The two staleness flags accumulate across a burst** (`_prefsInitStale`, `_menusStale`) and are cleared only when the debounced work runs. Computing them per event and reading them after the debounce would let a later event overwrite an earlier one's flags, silently dropping a needed rebuild — e.g. a `connection_type` write immediately followed by a non-menu write.
4. **Menu rebuilds are coalesced inside `mzta_Menus`, not just at the callers.** `loadMenus()` holds a `_rebuildInFlight` promise and a `_rebuildPending` argument slot; the real work moved to `_loadMenusUnguarded()`. Three unsynchronized triggers reach `_reload_menus()` — the internal `reload_menus` message, the external one from Sparks, and the debounced `storage.onChanged` handler — and options pages routinely both write storage *and* send `reload_menus`, so a single click can start two independent reload paths that the debounce cannot serialize against each other. The damage is concrete: `loadContextMenus()` calls `browser.menus.removeAll()` before recreating each item one at a time, so an overlapping rebuild wipes items the first one already created, or fails on duplicate ids. The guard belongs on the class rather than on `_reload_menus()` because the startup `menus.loadMenus()` at module top level does not go through that funnel and is registered *after* the message listeners, so a Sparks reload arriving mid-startup would otherwise run concurrently with the initial build. Rebuilds coalesce rather than queue — rebuilding is idempotent and only the final state is observable, so N triggers collapse into the running rebuild plus one trailing rerun instead of N flickering teardown/rebuild cycles. `removeClickListener()` moved from `reload()` into `_loadMenusUnguarded()` so it runs under the guard and cannot deregister the listener of a rebuild in flight.

The two gates are deliberately separate. `reload_pref_init()` is *not* gated on the menu-relevant key set, because `add_tags_auto`, `summarize_auto` and `translate_auto` feed `_process_incoming` without being menu keys; gating both on the menu set would freeze auto-processing until restart. Gating at all is worthwhile because `reload_pref_init()` calls `checkSparksPresence()`, a `runtime.sendMessage` to an external extension. A consequence to keep in mind: `_sparks_presence` now refreshes only when a `PREFS_INIT_KEYS` key changes, not on every sync write. If it ever needs to be event-driven, `onMessageExternal` is the right hook, not `onChanged`.

Separately, `loadShortcutMenu()` builds into a local array and swaps it in at the end, and `initialize()` deliberately does *not* clear `shortcutMenu`. `preparePopupMenu()` reads `menus.shortcutMenu` **synchronously**, so it never takes the rebuild guard; clearing the array up front left it empty for the whole rebuild, and a shortcut pressed in that window rendered an empty popup. `rootMenu` and `menu_listeners` keep their in-place rebuild on purpose — they are only read by the click listener, whose registration spans the rebuild.

### Per-Message Data Storage

Per-message data (summaries, spam reports, translations) is stored via `js/mzta-storage.js` (`taStorage` class). Each record is keyed by `msg:<headerMessageId>` in `messenger.storage.local` and follows schema version 1. Records contain optional fields: `summary`, `spam`, `translation`, plus metadata (`v`, `ts`). The `taStorage` class provides typed read/write/delete methods per field, automatic record cleanup when all fields are removed, and age-based cleanup.

`js/mzta-summarystore.js` (`taSummaryStore` class) wraps `taStorage` for summary-specific operations: load/save/remove summaries, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states.

`js/mzta-translationstore.js` (`taTranslationStore` class) wraps `taStorage` for translation-specific operations: load/save/remove translations, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states. Each translation record stores `translated_text`, `lang`, and optional error information.
