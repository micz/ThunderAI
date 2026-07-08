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
  ├── <messages-area>   (messagesArea.js)  — renders the conversation transcript
  ├── <message-input>   (messageInput.js)  — input field, send/stop buttons, status logger
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
  newThinkingToken → messagesArea.handleNewThinkingToken(token)  (feeds StreamingMessage)
  tokensDone       → messagesArea.handleTokensDone(promptData)   (flush → action buttons → divider)
  error            → messagesArea.appendBotMessage(payload,'error')

background → controller.js (browser.runtime commands)
  api_send             → set promptData; send prompt (or show custom-text field)
  api_send_custom_text → merge custom text into the prompt, then send
  api_error            → render an error bot message
```

Per bot response a fresh `StreamingMessage` accumulates raw + thinking tokens and, on flush,
returns an **immutable HTML snapshot**; `<messages-area>` renders it and hands the thinking
text to `renderThinkingBlock`. The answer-text snapshot is what the "use this answer" /
"save as summary" / diff buttons close over — one instance per turn keeps each turn's
buttons tied to their own response.

### Files

| File | Role |
|------|------|
| `api_webchat/controller.js` | Wires components ↔ worker (DI); owns `promptData`, font-zoom, runtime-command handling |
| `api_webchat/messagesArea.js` | `<messages-area>` custom element: conversation transcript, action buttons, orchestrates the render helpers below |
| `api_webchat/messageInput.js` | `<message-input>` custom element: input field, send/stop buttons, status logger, custom-text flow |
| `api_webchat/splitButton.js` | `<split-button>` custom element: the "use this answer" button + optional reply-type dropdown; owns the outside-click listener lifecycle (`connectedCallback`/`disconnectedCallback`) |
| `api_webchat/streamingMessage.js` | `StreamingMessage` class: per-turn token/thinking accumulation, `<think>` handling, markdown-it render; `flush()` returns an immutable HTML snapshot |
| `api_webchat/diffViewer.js` | `renderDiff(container, original, new)` — one-shot word-diff renderer (uses global `Diff`) |
| `api_webchat/thinkingBlock.js` | `renderThinkingBlock(container, text, collapsed)` — one-shot `<details class="thinking-block">` renderer |
| `api_webchat/svgIcons.js` | Trusted static inline-SVG icon strings + `svgFromString()` helper (CSP-safe, dependency-free) |

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
| `js/mzta-placeholders-autocomplete.js` | Autocomplete for placeholders in prompt editor |

## API Modules (`js/api/`)

Each file handles HTTP communication for one provider:

| File | Provider |
|------|----------|
| `anthropic.js` | Claude (Anthropic) API |
| `google_gemini.js` | Google Gemini API |
| `ollama.js` | Ollama (self-hosted) |
| `openai_comp.js` | OpenAI-compatible APIs |
| `openai_comp_configs.js` | Pre-configured providers (DeepSeek, Grok, Mistral, OpenRouter, Perplexity) |
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
| `_lib/` | Shared libraries used by pages |

## Storage

All preferences are stored via `browser.storage.local`. The keys and default values are defined in `options/mzta-options-default.js` (`prefs_default` export). Custom prompts and custom placeholders are stored separately in storage under their own keys.

### Per-Message Data Storage

Per-message data (summaries, spam reports, translations) is stored via `js/mzta-storage.js` (`taStorage` class). Each record is keyed by `msg:<headerMessageId>` in `messenger.storage.local` and follows schema version 1. Records contain optional fields: `summary`, `spam`, `translation`, plus metadata (`v`, `ts`). The `taStorage` class provides typed read/write/delete methods per field, automatic record cleanup when all fields are removed, and age-based cleanup.

`js/mzta-summarystore.js` (`taSummaryStore` class) wraps `taStorage` for summary-specific operations: load/save/remove summaries, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states.

`js/mzta-translationstore.js` (`taTranslationStore` class) wraps `taStorage` for translation-specific operations: load/save/remove translations, track in-flight generation state via `browser.storage.session`, enforce a 100-entry cache limit with oldest-first truncation, and store error states. Each translation record stores `translated_text`, `lang`, and optional error information.
