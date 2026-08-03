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
text to `renderThinkingBlock`. The answer-text snapshot is what the "use this answer" /
"copy" / "save as summary" / diff buttons close over — one instance per turn keeps each
turn's buttons tied to their own response.

Every one of those buttons honours a text selection and acts on just that part of the
answer, falling back to the whole snapshot when nothing is selected. "Copy" writes **plain
text**, so it reads the selection through `getCurrentSelectionText()` and converts the
snapshot with `htmlToPlainText()` — which parses the markup, decoding entities (`&amp;` → `&`)
and turning `<br>` and block boundaries into real newlines. The older `stripHtmlTags()` regex
is still used where the consumer wants tags gone but escapes left alone (the diff viewer).

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
| `js/mzta-utils.js` | General utilities (email parsing, storage helpers, etc.) |
| `js/mzta-utils-prompt.js` | Prompt-specific utilities (text truncation, lang injection, `buildSummaryPrompt()` for unified summary prompt assembly, `buildTranslationPrompt()` for translation prompt assembly) |
| `js/mzta-compose-script.js` | Content script for compose and message display: injects AI response into compose window, renders unified toolbar (spam badge, summary/translation trigger buttons) and content panels (generic error, spam explanation, summary, translation) in message display via `#mzta-container` |
| `js/mzta-chatgpt.js` | ChatGPT Web integration (opens browser window, reads DOM) |
| `js/mzta-special-commands.js` | Handles special prompt actions (add_tags, calendar, task) |
| `js/mzta-spamreport.js` | Spam filter logic |
| `js/mzta-i18n.js` | i18n helper (wraps `browser.i18n.getMessage`) |
| `js/mzta-logger.js` | Debug logging (gated by `do_debug` pref) |
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
| `_lib/` | Shared libraries used by pages: `connection-ui.js` (API connection UI), `mzta-timezones.js` (runtime-generated IANA timezone list for the calendar event / task selects, see [05-options.md](05-options.md)), `mzta-design.css` (shared design system), `autocomplete.css` (placeholder autocomplete dropdown, linked by all 8 pages that use it — written against both token systems via fallback chains), plus the vendored `tom-select.*` and `list.js` |

## Storage

Regular preferences (feature flags, connection settings, `ollama_*`/`chatgpt_*`/etc., `reply_type`, `connection_type`, ...) are read/written via `browser.storage.sync`, keyed by `prefs_default` in `options/mzta-options-default.js`. A small set of large-payload keys — `_custom_prompt`, `_default_prompts_properties`, `_special_prompts`, `_custom_placeholder`, `add_tags_exclusions` — live in `browser.storage.local` instead, because `storage.sync` has a narrow storage quota (see the one-time sync→local migration in `js/mzta-utils.js`, `migrateCustomPromptsStorage()` / `migrateDefaultPromptsPropStorage()`, added for [#129](https://github.com/micz/ThunderAI/issues/129)).

### Per-Message Data Storage

Per-message data (summaries, spam reports, translations) is stored via `js/mzta-storage.js` (`taStorage` class). Each record is keyed by `msg:<headerMessageId>` in `messenger.storage.local` and follows schema version 1. Records contain optional fields: `summary`, `spam`, `translation`, plus metadata (`v`, `ts`). The `taStorage` class provides typed read/write/delete methods per field, automatic record cleanup when all fields are removed, and age-based cleanup.

`js/mzta-summarystore.js` (`taSummaryStore` class) wraps `taStorage` for summary-specific operations: load/save/remove summaries, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states.

`js/mzta-translationstore.js` (`taTranslationStore` class) wraps `taStorage` for translation-specific operations: load/save/remove translations, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states. Each translation record stores `translated_text`, `lang`, and optional error information.
