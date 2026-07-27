# API Integrations

## Connection Types

The active AI provider is controlled by the `connection_type` preference. Possible values:

| `connection_type` value | Provider |
|------------------------|----------|
| `''` (empty) | **No connection selected yet** — the default on a fresh install |
| `chatgpt_web` | ChatGPT Web (no API key, opens browser window) |
| `chatgpt_api` | OpenAI API (ChatGPT via API key) |
| `ollama_api` | Ollama (self-hosted LLM) |
| `openai_comp_api` | OpenAI-compatible API |
| `google_gemini_api` | Google Gemini API |
| `anthropic_api` | Claude (Anthropic) API |

The global default is the **empty string**: no provider is chosen for a new user, who is instead
guided to the Setup Wizard. Test it with `hasNoConnectionSelected()` (`js/mzta-utils.js`) rather than
comparing to `''` inline — and never assume "not `chatgpt_web`" implies "an API is configured". See
[05-options.md](05-options.md#global-integration-settings) for the full behaviour of the empty state.

Each special prompt (`add_tags`, `spamfilter`, etc.) can independently override this via its own
`{prefix}_connection_type` pref (whose own default is `chatgpt_api`, applied only when that prompt's
`use_specific_integration` is on).

## Provider Configuration

Each provider has its own settings block in `integration_options_config` (`options/mzta-options-default.js`):

### ChatGPT Web
Controlled via `js/mzta-chatgpt.js`. Opens a browser window to `chatgpt.com`, injects the prompt via DOM automation, and reads back the response. Settings: `chatgpt_web_model`, `chatgpt_web_tempchat`, `chatgpt_web_project`, `chatgpt_web_custom_gpt`, `chatgpt_web_load_wait_time`.

Content script `js/lib/diff.js` is injected into ChatGPT pages for diff-view support.

### OpenAI API (`chatgpt_api`)
- Module: `js/api/openai_responses.js`
- Worker: `js/workers/model-worker-openai_responses.js`
- Settings keys: `chatgpt_api_key`, `chatgpt_model`, `chatgpt_developer_messages`, `chatgpt_temperature`, `chatgpt_store`

### Ollama (`ollama_api`)
- Module: `js/api/ollama.js`
- Worker: `js/workers/model-worker-ollama.js`
- Settings keys: `ollama_host`, `ollama_model`, `ollama_num_ctx`, `ollama_temperature`, `ollama_think`, `ollama_format_json`
- Requires CORS to be configured on the Ollama server

### OpenAI-Compatible (`openai_comp_api`)
- Module: `js/api/openai_comp.js`
- Worker: `js/workers/model-worker-openai_comp.js`
- Settings keys: `openai_comp_host`, `openai_comp_model`, `openai_comp_api_key`, `openai_comp_use_v1`, `openai_comp_chat_name`, `openai_comp_temperature`
- Pre-configured providers: `js/api/openai_comp_configs.js` (`custom`, DeepSeek, Grok, Mistral, OpenRouter, Perplexity — `custom` is the default/manual entry)

### Google Gemini (`google_gemini_api`)
- Module: `js/api/google_gemini.js`
- Worker: `js/workers/model-worker-google_gemini.js`
- Settings keys: `google_gemini_api_key`, `google_gemini_model`, `google_gemini_system_instruction`, `google_gemini_thinking_budget`, `google_gemini_temperature`

### Anthropic / Claude (`anthropic_api`)
- Module: `js/api/anthropic.js`
- Worker: `js/workers/model-worker-anthropic.js`
- Settings keys: `anthropic_api_key`, `anthropic_model`, `anthropic_version`, `anthropic_max_tokens`, `anthropic_system_prompt`, `anthropic_temperature`, `anthropic_extended_thinking_budget`
- **Extended thinking**: when `anthropic_extended_thinking_budget > 0`, the request body adds `thinking: { type: 'enabled', budget_tokens: N }` and **omits** `temperature` (the Claude API forbids setting temperature with extended thinking). See [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui) for how the resulting stream is surfaced.

## Thinking output in the webchat UI

**Detection is automatic and never gated by a preference.** Every API worker forwards
reasoning content as soon as the corresponding field is present in the stream, so a
model that reasons on its own — without the connection's thinking option being
enabled — still shows its thinking block. The per-connection prefs
(`ollama_think`, `google_gemini_thinking_budget`,
`anthropic_extended_thinking_budget`) only *request* reasoning from the API; they
never decide whether it is displayed.

Reasoning reaches the UI over two transport paths, which can coexist for the same
provider and are merged into one block:

**1. Dedicated stream field → `newThinkingToken`.** The worker accumulates the
content in a `thinkingAccumulator` (also sent on `tokensDone`) and posts each token
to the controller. `StreamingMessage` accumulates them independently of content
tokens, so thinking that arrives before the first content token is not lost.

| Provider | Stream field / event |
|----------|----------------------|
| Anthropic | `content_block_delta` with `delta.type === 'thinking_delta'` → `delta.thinking` |
| Ollama | `message.thinking` |
| OpenAI Compatible | first present of `delta.reasoning_content` (DeepSeek, vLLM, SGLang), `delta.reasoning` (OpenRouter — string *or* object with `.text`), `delta.thinking` (some llama.cpp / LM Studio builds) |
| Google Gemini | any `parts[]` entry with `thought === true`. **All** parts are iterated, not just `parts[0]`, because a thought part may come first and would otherwise be mixed into the answer |
| OpenAI Responses | `response.reasoning_summary_text.delta` and `response.reasoning_text.delta` |

**2. Inline `<think>…</think>` tags in the content stream.** Used by models that
have no dedicated field (Ollama without `ollama_think`, several OpenAI-compatible
servers). `StreamingMessage.flush()` extracts and strips these via the shared
`stripThinkTags()` helper in `js/mzta-utils.js`. If an unterminated `<think>` is
detected mid-stream, the flush is deferred until the closing tag arrives (that guard
lives in `streamingMessage.js`, not in the helper).

Both paths are combined into `combinedThinking` and rendered by
`renderThinkingBlock()` (`api_webchat/thinkingBlock.js`) as a
`<details class="thinking-block">` prepended to the answer. Nothing is rendered when
there is no thinking content.

### Live "Thinking…" indicator

The `<details>` block only materializes at flush time, so a long reasoning phase
would otherwise leave an empty turn on screen. On every `newThinkingToken`,
`handleNewThinkingToken()` calls `_showThinkingIndicator()`, which appends a
`<div class="thinking-live">` to the current bot turn body: the animated
`images/mzta-thinking.svg` as an `<img>` in the slot the `<summary>` disclosure
triangle will occupy, followed by `prefs_OptionText_thinking_summary` + a literal
`...`. All the motion is inside the SVG, so the row itself carries no CSS
animation (and needs no reduced-motion override). It is a **sibling** of the
accumulating message, not a child, so the per-`\n` flush cycle cannot orphan or
duplicate it; re-appending also moves it back to the end when thinking resumes
after a rendered segment.

The status pill's two in-flight states follow the same pattern, each with its own
self-animating SVG loaded as an `<img>`: `showWaitingStatus()` uses
`images/mzta-waiting-server.svg` (a dot emitting expanding rings) and
`showStreamingStatus()` uses `images/mzta-loading.svg` (three bouncing dots).
Because the motion lives in the SVG, the pill carries no CSS animation and the
icon centres itself inside the fixed-size `#statusLoggerIcon` box. Both icons are
rebuilt only on the transition *into* their state — the show methods can be called
repeatedly (`showStreamingStatus()` runs on every token), and replacing the node
each time would restart the SVG's animation and freeze it at frame 0. The static
states (`done` → check, `error` → alert) use the inline builders in `svgIcons.js`,
which stroke in `currentColor`. `_setStatusClass()` clears **all** state classes,
including `status-waiting`, so no in-flight styling can leak onto the done or
error pill.

`_removeThinkingIndicator()` swaps it out in `flushAccumulatingMessage()`, right
after the deferred-flush early return (which must keep the indicator alive) and
before `renderThinkingBlock()`, so the placeholder and the real block are never on
screen together. It is also called from `handleTokensDone()` (a response made only
of thinking tokens never creates an accumulating message, so the flush is a no-op),
`appendUserMessage()`, and `appendBotMessage()` (error path). `hide_thinking` does
not affect the indicator — it only governs the final block's initial state.
Inline-`<think>` models never post `newThinkingToken` and so get no indicator.

See the [API WebChat](01-architecture.md#api-webchat-api_webchat) section for the module structure behind this.

The global `hide_thinking` pref (default `true`) controls **only the initial
open/collapsed state** of the block: `true` → collapsed, `false` → open. The user can
always toggle by clicking, and thinking content is never discarded. ChatGPT Web uses
no API worker and is unaffected.

### Thinking in special commands

Special commands (`mzta_specialCommand`) *parse* the response instead of displaying
it, so reasoning must never reach the resolved value:

- `newThinkingToken` messages are explicitly discarded and never appended to `full_message`.
- Inline `<think>` blocks are stripped from `full_message` with
  `stripThinkTags(text, true)` before the promise resolves. The `true` flag also drops
  a dangling unterminated `<think>` (a truncated reply) rather than handing raw
  reasoning to the caller's parser.

## Font zoom in the webchat UI

The API webchat window supports keyboard font zoom, handled in `api_webchat/controller.js`:

- **Ctrl/Cmd + `+`** (or `=`) increases, **Ctrl/Cmd + `-`** decreases, **Ctrl/Cmd + `0`** resets to 100%.
- Zoom is applied by setting `document.documentElement.style.fontSize` as a percentage. Because text in the Shadow DOM components (`<messages-area>`, `<message-input>`) is sized in `rem`/`em`, it scales against the root `<html>` font-size across the Shadow DOM boundary. A few chrome elements that previously used absolute `px` font-sizes were converted to `rem` so they scale too.
- The level is clamped to **0.5–2.5** (step 0.1) and persisted in `browser.storage.sync` under the global `api_webchat_font_scale` pref (default `1.0`, in `options/mzta-options-default.js`). On window open the saved value is read and re-applied, so the zoom survives closing the window and is shared across all webchat windows and providers.
- The `keydown` listener is registered on `document`; key events from inside the components bubble up (composed), so no per-component handler is needed.

## Configuration Validation

For special prompts (`mzta_specialCommand`), required fields are validated in `initWorker()` (`js/mzta-special-commands.js`) **before** the worker is created. If a required field is empty, an `Error` with `isConfigError = true` is thrown. Validation covers:

| Provider | Required fields |
|----------|----------------|
| `chatgpt_api` | `chatgpt_api_key`, `chatgpt_model` |
| `google_gemini_api` | `google_gemini_api_key`, `google_gemini_model` |
| `ollama_api` | `ollama_host`, `ollama_model` |
| `openai_comp_api` | `openai_comp_host`, `openai_comp_model` |
| `anthropic_api` | `anthropic_api_key`, `anthropic_model`, `anthropic_version` |

Validation is skipped when `use_specific_api = true` (i.e., the prompt's own `api_type` overrides the global setting — credentials come from the prompt config, not global prefs).

The `isConfigError` flag on the thrown error tells callers in `mzta-background.js` to display the error in the panel **without saving it to storage** — so the user can fix settings and retry cleanly.

Feature-specific routing of `isConfigError`:

- `summarize` / `translate` / `spamfilter`: the error is shown in their dedicated panel (summary / translation / spam panel) and **not** persisted to storage.
- `add_tags`: it has **no dedicated panel**, so the error is routed to the **generic error panel** via `showGenericError(errMsg, source)` in `mzta-background.js`, which broadcasts a `showGenericError` message to all tabs. The content script `js/mzta-compose-script.js` renders it as `#mzta-generic-error` inside `#mzta-container`. The panel is dismissible and reusable by any future feature without its own UI.

For regular prompts (`openChatGPT()`), validation still happens inside the listener callback after the API webchat window is created (unchanged behavior).

## Per-feature provider override (specific integration)

Features in `special_prompts_with_integration` (`add_tags`, `spamfilter`, `summarize`, `get_calendar_event`, `get_task`, `translate`) can use a different provider than the global default. The override is **stored inside the feature's special prompt object** (not in standalone `{feature}_*` prefs): the settings UI (`_updatePrompt()` in `pages/_lib/connection-ui.js`) writes `prompt.api_type` plus prefixed config keys (e.g. `prompt.openai_comp_host`, `prompt.openai_comp_model`) and calls `savePrompt()`.

For the override to take effect at runtime, the caller **must load that prompt object and pass it as `config`** to `mzta_specialCommand` — and pass the same prompt to `getConnectionType(prefs, prompt, '<feature>')`. `initWorker()` only sets `use_specific_api = true` (and therefore reads the prefixed host/model/etc. from `config`) when `config.api_type` is non-empty; otherwise it falls back to the **global** provider prefs. Passing `config: {}` silently ignores the override even when the connection *type* matches.

Helpers: `getSpamFilterPrompt()`, `getSummarizePrompt()`, `getTranslatePrompt()` in `js/mzta-prompts.js` (or `loadPrompt(id)`). The execution paths in `mzta-background.js` (`_generateSummaryForMessage`, `_generateTranslationForMessage`, spamfilter, add_tags) follow this pattern.

## Web Worker Pattern

For all API-based providers (everything except ChatGPT Web), the call goes through a Web Worker:

```
mzta-background.js
  → creates new Worker('js/workers/model-worker-<provider>.js')
  → postMessage({ prompt, settings })
  → worker makes HTTP fetch to provider API
  → worker postMessage({ result }) back
  → background handles result
```

This keeps API calls off the main thread and avoids blocking the Thunderbird UI.

### Worker Lifecycle & Timeout (`mzta_specialCommand`)

`mzta_specialCommand` (`js/mzta-special-commands.js`) creates one Worker per instance in its constructor. Callers (`_generateSummaryForMessage`, `_generateTranslationForMessage`, spamfilter, auto add-tags in `mzta-background.js`) create a **fresh instance per prompt** — instances are never reused.

- **Termination:** `sendPrompt()` always calls `dispose()` (via `Promise.finally`) once the prompt settles — on success, error, or timeout. `dispose()` calls `worker.terminate()` and nulls the reference. This prevents Worker leaks during batch processing, where one Worker would otherwise be created per message and never freed (a cause of out-of-memory hangs on large selections).
- **Timeout:** `sendPrompt()` aborts the request if the worker never replies (no `tokensDone`/`error`). The duration comes from the `special_command_timeout` pref (default `120000` ms), with a hardcoded `SPECIAL_COMMAND_TIMEOUT_DEFAULT` fallback. The pref is configurable in the main options page (always shown — see `claude-spec/05-options.md`). On timeout the promise rejects with a clear error and the worker is terminated by the same `finally`.

`processEmails()` wraps its whole body in `try/finally` so `taWorkingStatus.stopWorking()` always runs, and wraps each message in `try/catch`+`continue` so one failing message does not abort the batch.

### Batch cancellation (user-triggered stop)

`processEmails()` can run for a long time on large selections. `js/mzta-batch-controller.js` (`taBatchController`) lets the user interrupt it cooperatively. See [01-architecture.md](01-architecture.md#batch-cancellation-tabatchcontroller) for the controller's design and check points.

**Runtime messages** (handled in the `messenger.runtime.onMessage` switch in `mzta-background.js`):

- `{ command: "batch_status" }` → returns `taBatchController.getStatus()` = `{ working, processed, cancelRequested }`.
- `{ command: "cancel_batch" }` → calls `taBatchController.requestCancel()`, returns `{ ok: true }`. The running `processEmails` loop sees `isCancelled()` at its next checkpoint and `break`s out; the outer `finally` still runs `stopWorking()` + `endBatch()`.

**Stopped notice:** `endBatch()` returns a snapshot `{ lastExit, cancelled, processed }` taken *before* the counters are reset (`processed` is zeroed on the last-batch reset). When `lastExit && cancelled`, the outer `finally` in `processEmails` shows a `showGenericInfo()` notice (`batch_stopped_notice`, "Email processing stopped. N messages were processed.") reporting how many messages completed before stopping. It renders in the message-display / compose content-script panel.

**Generic panels (`showGenericError` / `showGenericInfo`):** `mzta-background.js` exposes two helpers that broadcast a panel to all tabs (the content script renders it only where injected — message-display / compose):
- `showGenericError(msg, source)` → `{command: "showGenericError"}` → red panel (⚠), panel id `mzta-generic-error`.
- `showGenericInfo(msg, source)` → `{command: "showGenericInfo"}` → blue informational panel (ℹ), panel id `mzta-generic-info`.
Both use the same layout and a dismiss control; colors come from `_getThemeColors()` (`summaryErr` for errors, `info` for info). Cleared via `clearGenericError` / `clearGenericInfo`.

**Popup payload:** `preparePopupMenu(tab)` adds `output.batchStatus = taBatchController.getStatus()` to the response of the existing `popup_menu_ready` message, so the popup gets the initial batch state without an extra round-trip. When `batchStatus.working` is true the popup shows a "Stop processing — N processed" banner and polls `batch_status` every ~1s while open.

**Interaction with `mzta_specialCommand`:** v1 cancellation is checked *between* messages, so the in-flight worker prompt is allowed to finish first (bounded by `special_command_timeout`). There is no mid-request `dispose()` in v1; a future enhancement could register the active `mzta_specialCommand` with the controller and terminate its worker on cancel for an immediate abort.

## Optional Permissions

API calls require host permissions. These are declared as `optional_permissions` in `manifest.json` and requested at runtime:

- `https://*.chatgpt.com/*` and `https://*.openai.com/*` for ChatGPT
- `https://*.anthropic.com/*` for Claude
- `https://*/*` and `http://*/*` for Ollama and OpenAI-compatible endpoints

## Adding a New Provider

1. Create `js/api/<provider>.js` with the API call logic
2. Create `js/workers/model-worker-<provider>.js` that imports and calls the API module
3. Add a new `connection_type` value constant
4. Add settings keys to `integration_options_config` in `options/mzta-options-default.js`
5. Add UI controls to `options/mzta-options.html` and `options/mzta-options.js`
6. Add the new `connection_type` case to the dispatch logic in `mzta-background.js`
7. Add required host permissions to `manifest.json` optional_permissions
8. Add i18n strings to `_locales/en/messages.json`
