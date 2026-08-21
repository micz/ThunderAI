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

**Dynamic `onNewMailReceived` registration.** `monitorAllFolders` can only be set when the
listener is added, so `registerNewMailListener()` owns the registration and re-registers
(`removeListener` + `addListener`) whenever the computed value changes:

```js
monitorAllFolders = (!prefs_init.add_tags_auto_only_inbox
                     || prefs_init.add_tags_auto_include_sent
                     || (prefs_init.summarize && prefs_init.summarize_auto_senders))
```

Auto add-tags monitors the Inbox only by default, but the sender list must catch messages
delivered anywhere, so enabling it forces monitoring of all folders. `add_tags_auto_include_sent`
does the same: with only-inbox monitoring Thunderbird would never report a sent message, so the
option could never fire. It is called at startup
and from `setupStorageChangeListener()` — chained on `reload_pref_init()` (which is `async`) so
it observes the refreshed `prefs_init`, and a no-op when the value is unchanged so the
unconditional pref reload does not churn the listener. This is what lets the option take effect
without restarting Thunderbird. It is declared as a hoisted `function` because
`setupStorageChangeListener()` is defined and invoked earlier in the file than the registration
site.

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
once per `
` of every response — which was most of what made streaming feel slow. The options are
invariant and `render()` keeps no state between calls, so one shared instance is equivalent.

`flush()` runs markdown-it with **`html: false`** (the default) — raw HTML in the model output is
escaped, never rendered, so the model can't inject markup into the extension UI — and with
**`breaks: true`**, which is deliberate: this is a mail composer, so a newline the model wrote is a
newline the user expects, and a single `\n` inside a paragraph must render as a real `<br>`.

> This describes the **markdown path**, which is the default and covers every prompt that sends plain
> text. A response that is itself HTML skips markdown-it entirely and is sanitized instead — see
> *When the answer is HTML* below. The protection is not dropped there, it changes hands: from
> escaping to an allowlist.

`html: false` means a literal `<br>` echoed by the model would otherwise surface as visible
`&lt;br&gt;` text. `normalizeEchoedBrTags()` (`api_webchat/streamingMessage.js`) rewrites them to
newlines before the render, per **run** rather than per tag:

| echoed | becomes | renders as |
|---|---|---|
| one `<br>` | `\n` | a line break (`<br>`, via `breaks: true`) |
| two or more `<br>` | `\n\n` | exactly one blank line, whether the model wrote 2 or 8 |

Deciding the run→break mapping explicitly is what makes the vertical space deterministic; it used to
fall out of markdown-it collapsing consecutive blank lines. Fenced code blocks and inline code spans
are masked out before the rewrite and restored after, so a `<br>` the user is asking *about* stays in
the code block as escaped text.

### When the answer is HTML, markdown-it is bypassed

Some prompts deliberately send **HTML** to the model (`{%selected_html%}`,
`{%mail_html_body_or_selected%}` — see [02-prompts.md](02-prompts.md)). The model then answers in
HTML, and `html: false` would escape the whole reply into visible `&lt;p&gt;` text. That is exactly
what happened before this path existed.

`flush()` therefore decides, **once per response**, which shape it is handling:

- `looksLikeHtmlResponse()` tests for a **lead-in followed by a block tag** (`p`, `div`, `ul`, `ol`,
  `li`, `h1`–`h6`, `blockquote`, `pre`, `table`, `tr`, `td`, `th`, `tbody`, `thead`), or for an
  orphan *closing* block tag (a reply that opens `Distinti saluti.</p>`).
- The **lead-in is what makes the test robust**, and it exists because of a real failure: the same
  prompt run twice produced `<li>…` once (rendered) and `<br><li>…` the next time (every tag
  escaped). The earlier version anchored the block tag at the very start of the response, so one
  echoed `<br>` — a token that says nothing about the reply's shape — flipped the whole answer to
  the markdown path. Tolerated in the lead-in: whitespace, `<br>` runs, comments, a doctype/XML
  prolog, and a *short* prose prefix ("Ecco il testo: `<p>`…").
- The prose prefix is bounded to keep the test honest: no `<`, no newline (it must sit on the
  response's first line), no markdown syntax character, max 40 chars. That is what stops
  `**Nota:** <p>` or a markdown answer whose *second* paragraph opens with a tag from being swept in.
- **Code regions are masked first**, the same masking `normalizeEchoedBrTags()` uses. An answer whose
  subject *is* HTML ("how do I center a `<div>`?") must stay on the markdown path so the markup shows
  as text in a code block instead of being sanitized into a real element.
- The decision is **sticky** (`_isHtmlResponse`). Segments break on `\n`, so a later segment of an
  HTML answer can easily begin with a bare text node that looks like markdown; re-deciding per
  segment would render one answer half each way.
- The test may also return **null — "not enough evidence yet"**. A response that has so far produced
  only lead-in (a lone `<br>`) is *undecided*: the text is held back rather than committed to either
  path, and the next segment decides with both segments judged together. Without this, `<br>\n<li>…`
  would reintroduce the original bug one segment later, since a flush fires on every `\n`. The last
  flush of a response (`flush(final = true)`, from `handleTokensDone`) forces the verdict to markdown
  so a lead-in-only reply is never left unrendered.

On the HTML path the reply goes through **`sanitizeBlockHtml()`** (`api_webchat/diffPicker.js`)
instead of markdown-it. Running both would be wrong in either order. `normalizeEchoedBrTags()` is
skipped too — there is no markdown-it to protect the `<br>` from.

**The sanitizer is the security boundary that `html: false` used to be.** It is the same allowlist
walk the diff picker uses, parameterized by tag set (`sanitizeAgainst`), so there is exactly one
sanitization point: `sanitizeInlineHtml()` for inline content, `sanitizeBlockHtml()` for a whole
answer. Anything not on the list is unwrapped, every attribute is dropped except a `http(s):`/
`mailto:` `href` on `<a>`.

**Cumulative rendering.** On this path each flush re-sanitizes the *whole response so far* and
`html` is the whole answer, not the segment — flagged to the caller as `cumulative: true`. Segments
break wherever the model wrapped a line, frequently *inside* an element; sanitizing `<ul><li>a` alone
would make `DOMParser` close the tags and leave the next segment a stray closer. `MessagesArea`
answers by **reusing** the accumulating element rather than retiring it after the flush, and clears
it in `handleTokensDone()` so the next response opens its own.

**Coalesced, not per line.** Because each render redoes the whole response, doing it on every `\n`
is O(n²) over a response — and `MessagesArea` then re-parses that whole string with `DOMParser` and
rebuilds the element's children. The HTML path therefore re-sanitizes only once roughly every
`HTML_RENDER_CHUNK` (2 KB) of new text, plus always on the final flush. In between, `flush()` returns
`deferred: true`: the text is already accumulated, `thinkingText` is still handed over (it is
independent of the response's shape), but the caller must **leave the element's DOM untouched** —
clearing it for an empty `html` would blank the answer between renders. What keeps the answer
visibly streaming meanwhile is the live token spans `handleNewToken()` appends, the same mechanism
the undecided and unterminated-`<think>` branches rely on. The finished answer is unchanged: the
last flush is always `final` and always renders everything, before `addActionButtons()` snapshots it.

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
what the content script returned (`htmlHasLineStructure()`): a value holding a block tag or a `<br>`
is normalized as before, and a value holding neither is rebuilt from its **text** twin with
`convertNewlinesToBr()`. Same rule `getMailBody()` in `js/mzta-utils.js` already applies to a
text/plain-only mail, whose html is `text.replace(/\n/g, "<br>")`.

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

- **`_currentTurnEl` must survive a flush.** A single response flushes on every `'\n'`, so
  clearing it in `flushAccumulatingMessage()` would open a new wrapper — and render a second
  avatar — part-way through one answer. Only `appendUserMessage()`, `appendBotMessage()` and
  `handleTokensDone()` reset it. `appendDiffViewer()` can run against an older turn mid-session,
  so it saves and restores the field around `_beginBotTurn()`.
- **`_lastFullBarTurn` owns the only full action bar.** `addActionButtons()` calls
  `_degradeFullActionBar()` first, so two full bars never coexist. `.action-bar` and
  `.turn-tools` are mutually exclusive on a given turn — an answer showing the full bar needs
  no icon toolbar, because every icon would duplicate a button already spelled out beside it.
  Degrading therefore *replaces* the bar with the toolbar. The toolbar is built at that
  moment, but from the arguments stashed on the turn (`_mztaToolsArgs`) when the bar was
  created, so it stays bound to that answer's own text rather than to whatever is on screen
  later.

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
                                                       appendDiffViewer, #jumpToLatest click
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
| `api_webchat/diffViewer.js` | `renderDiff(container, original, new)` — one-shot word-diff renderer (uses global `Diff`) |
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
