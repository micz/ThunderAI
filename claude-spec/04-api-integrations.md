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

**Everything in the ChatGPT page is identified by structure, never by localized text.** ChatGPT ships in dozens of languages and rolls out UI variants gradually (issues #890, #920, #924), so `aria-label`, placeholder, title and text content are never matched. Button aria-labels may appear in diagnostics, nothing else does. Existing selectors always come first so that older UIs keep working. `mzta_script` is a template literal: no backticks or `${…}` inside it, and backslashes are doubled.

**The composer is located by `findPromptInput(timeoutMs)`, never by a single id lookup.** `chatgpt_sendMsg()` waits up to 15 s for the first *visible* element matching `PROMPT_INPUT_SELECTORS`. The selectors, in priority order:
1. `#prompt-textarea`
2. ProseMirror contenteditable with `[data-composer-markdown]`
3. `[contenteditable][role=textbox][data-virtualkeyboard]`
4. ProseMirror contenteditable
5. `form [contenteditable]`
6. `textarea[name=prompt-textarea]`
7. `form textarea`
8. `main [contenteditable]`

- **Lookup:** a MutationObserver plus a 250 ms poll. Only the poll also searches open shadow roots (bounded walk, `SHADOW_WALK_MAX_NODES`/`SHADOW_WALK_MAX_DEPTH`).
- **Skipped matches:** invisible elements, since ChatGPT keeps a hidden fallback `<textarea>` next to the visible contenteditable, and elements inside ThunderAI's own injected UI (`.mzta-header-fixed`, `[id^="mzta-"]`).
- **Filling:** a contenteditable receives the prompt HTML nodes. A real `<textarea>` receives `htmlToPlainText()` (one line per block) through the native `value` setter, so React notices the change.

When nothing is found, `logPromptInputDiagnostics()` writes one `console.log("[ThunderAI] Diagnostics: …")` JSON line, even without debug mode. All four diagnostics lines (`Diagnostics`, `Composer`, `Send button`, `Completion`) use `console.log`; only their `… failed` variants use `console.warn`. With debug on, it is also written once when the composer is found (or reused), so every run has it. It holds page structure only, never page text or the prompt, because users paste it on GitHub. Its fields:
- extension version, URL without query, title
- readyState, visibility and focus, time since load, viewport size, languages
- per-selector stats from `getSelectorStats()` (matches / visible / own UI)
- element counts: contenteditable, textarea, form, main, send button, visible dialogs and alerts, iframes and their origins
- open shadow root count, and whether the bounded walk was truncated
- up to 10 custom element tags (the only trace of a closed shadow root)
- up to 10 candidate inputs: attributes, `getHiddenReason()`, size, form/shadow membership, 3 ancestors
- login and Cloudflare flags, UA

Each section runs through `diagSection()`, so one failing section does not lose the line. With debug on, `findPromptInput` also logs its start and, every 3 s while waiting, the per-selector stats. After filling the composer, `chatgpt_sendMsg()` logs the tag and content length (never the content).

**If no selector matches, the user points at the composer.** `waitForUserComposerFocus(60000)` shows `chatgpt_composer_click_to_continue` in the panel, then waits:
- **Detection:** a capture `focusin` listener on `document` takes `composedPath()[0]` and walks up to the editable element via `findEditableHost()`. The walk crosses open shadow boundaries and accepts `isContentEditable` (climbing to the editing host), `<textarea>` or `[role=textbox]`, skipping ThunderAI's own UI. The deep `activeElement` is also checked once at start, because clicking into an element that already has focus fires no `focusin`.
- **Focus found:** the element becomes `user_selected_composer`, which later retries in the same page reuse while it stays visible.
- **Timeout:** after 60 s, `-2`.
- **Diagnostics:** both outcomes emit one `[ThunderAI] Composer diagnostics:` line in any mode (`source` `focus` or `timeout`). With debug on, it is also emitted once when `findPromptInput` succeeds (`source: found`, `selector`: the matched `PROMPT_INPUT_SELECTORS` entry) and when `user_selected_composer` is reused (`source: reused`), so every run has exactly one. For the element: source, selector (null unless `found`), tag/id/name/role, contenteditable, aria-multiline, `data-*` attribute names only, class (150 chars), shadow root mode or a possible closed-shadow host, iframe, ancestors up to the form or 8 levels, and a CSS path from `getSelectorPath()`. For the page: path, title, readyState, forms with button and editable counts, contenteditable/textarea/textbox counts, iframe origins, open shadow hosts, open dialog ids, login/Cloudflare flags and UA.

**Sending and verifying.** `send_baseline` (assistant, user and `main article` counts) is taken before the composer is filled. After the existing 1000 ms wait, `findSendButton(composerEl)` tries these strategies and returns the first visible match. Each strategy is logged only when it changes:
1. `existing`: the old testid and SVG-path selectors
2. `#composer-submit-button`
3. `form-submit`: `button[type=submit]` in the composer's form
4. `composer-size-token-submit`: `button.size-token-button-composer[type=submit]` in the composer's form (newer UI)
5. `ancestor-submit`: without a form, the first of up to 6 ancestors holding one

The send then proceeds as follows:
- **Button found:** `sendWithButton()` waits for it to be enabled, re-querying through `findSendButton()` while it is disabled, then clicks or sends Enter according to `method`. After 10 s it gives up and falls back to Enter.
- **No button:** Enter directly (keydown with key/code `Enter`, keyCode/which 13), whatever `method` is.
- **Verification:** after 1.5 s, `isSendVerified()` checks that the composer is empty or disconnected, that a new user or assistant message exists, or that the stop button is present.
- **Second attempt:** if the send is not verified and a form exists, `requestSubmitGuarded()` calls `form.requestSubmit()` and checks again. A bubbling `submit` listener on `window` cancels the submit if the page did not, since a native submit would navigate the popup and drop the script.
- **Failure:** only a failed second check returns `-1`.

`logSendButtonDiagnostics(composerEl, attempt)` writes `Send button diagnostics:` when no button is found (before sending, so `verified` is null) or the send is not verified; with debug on, also once after a verified send. At most one line per send attempt. It has `strategy` (the `findSendButton()` strategy that matched, null if none), `method` (the last one used: `click`, `enter` or `requestSubmit`), `verified` (the `isSendVerified()` outcome), `composerEmpty`, the aggregate counts, the testids and the aria-labels, plus `composerButtons`: up to 12 buttons of the composer container, described by `describeButtons()` (index, type, id, testid, disabled, aria-label, data-state, `<use>` href, the first 30 chars of `path d`, visible).

**Completion.** Each `chatgpt_isIdle()` call starts with fresh local state, because it can run more than once in the same page (custom texts). It computes `minTurnIndex` from `send_baseline.assistant`, or, without a baseline, from the assistant count at call start. The baseline is needed because the call starts at least 1.5 s after the send, and by then the new turn usually exists already. At call start it also records `actionButtonsAtStart` (`chatgpt_countActionButtons()`) and, when there are no `[data-message-author-role=assistant]` elements, a `fallbackTurn` (see **Turn selectors** below).

The newer UI (issue #920) has one composer primary button, `button.size-token-button-composer`, with three states: send (`type=submit`), stop (a `path[d^="M4.5 5.75C4.5 5.05964"]`) and voice chat, shown when idle with an empty composer (a `path[d^="M8.22266 2.45825"]`, `type=button`). Because stop and voice chat are both `type=button`, the composer classes alone never mean "generating". `chatgpt_isGenerating()` detects generation only by the Stop path, language-neutrally. `chatgpt_composerIsIdle()` is true when no Stop path exists and there is either a `size-token-button-composer[type=submit]` or a button with the voice path. `chatgpt_countActionButtons()` counts, page-wide and whatever turn they belong to, the buttons containing the new regenerate (`M14.0219 8.22363`) or copy (`M13.468 11.1216`) path. Each button counts once, and ThunderAI's own UI is excluded.

The call resolves on the first of the following, and `doLog()` records which one fired. The name in parentheses is the `condition` in the completion summary:
1. **Force completion** (`force`).
2. **Old-UI regenerate button** (`oldRegen`). `chatgpt_getRegenerateButton(minTurnIndex, fallbackTurn)` finds it through the old checks: the `<use>` sprite, the `.cursor-pointer` loop with the path prefixes and the good-response testid, and the read-aloud icon. These checks ignore `minTurnIndex`.
3. **New-UI action button** (`newRegenTurn`). The same function also looks for a button containing the new regenerate or copy path. When `minTurnIndex` is given, the button must belong to an assistant turn with an index at or above it. `getAssistantTurnIndex()` finds that turn through the closest `[data-message-author-role=assistant]`, or the assistant message inside the closest `article`. Without role elements and with a `fallbackTurn`, the button must instead be inside a fallback turn whose index (`getFallbackTurnIndex()`) is at least `fallbackTurn.minIndex`.
4. **End of generation** (`safetyNet`). The Stop button was seen during this call and has now been gone for 4 s: 1 s, plus a 3 s safety net.
5. **New action buttons** (`actionButtons`). The Stop button was seen during this call and is gone now, and `chatgpt_countActionButtons()` is above `actionButtonsAtStart`. Requiring the Stop button to have been seen keeps a copy button on the new user turn from counting as the answer.
6. **Idle composer** (`stopGoneComposerIdle`). The Stop button was seen, has been gone for at least 1 s, and `chatgpt_composerIsIdle()` is true.
7. **Stability fallback** (`stability`), when all of these hold:
   - the new assistant message has non-empty text. It must have appeared after the send: the assistant count is above `send_baseline`, or, without role attributes, the `main article` count (or the count of the fallback turn selector in use) is at least 2 above it.
   - the text length (only the length is read) has been stable for 4 s
   - `getGenerationSignals()` reports no stop button, no `aria-busy` and no `streaming` class in the last turn
   - `chatgpt_isGenerating()` is false, since the text also stays still during "thinking" pauses

**Completion summary.** Every branch resolves through a local `finish(condition)`, which always resolves the promise (in its `finally`) and, only with debug on (`mztaDoDebug == 1`), emits one `console.warn("[ThunderAI] Completion summary: …")` line. It holds timings and signal names only. All times are ms from the call start, and null when the event never happened:
- `condition`, `totalMs`, `generationObserved`;
- `firstGeneratingAtMs` and `lastGeneratingAtMs`, when `chatgpt_isGenerating()` was first and last true, and `sinceGenerationStoppedMs`;
- `generatingSignals` at the last true sample. `stopPath` is the one signal that drives `chatgpt_isGenerating()`; `stopButton`, `ariaBusy` and `streamingClass` from `getGenerationSignals()` are sampled alongside it for information;
- `composerIsIdle` at completion, and `composerIdleAfterGenerationAtMs`: the first idle sample after the last generating one;
- `actionButtons: {baseline, atCompletion, firstAboveBaselineAtMs}`.

This tracking never decides completion, and with debug off it is skipped entirely: the 100 ms loop then runs only the checks that decide completion. With debug on, the extra DOM queries run only until each value is recorded. In the not-generating branch `chatgpt_composerIsIdle()` is evaluated lazily, at most once per tick, and shared by the debug timing and the `stopGoneComposerIdle` check. With debug on, `finish()` also emits a `Completion diagnostics:` line just before the summary, with the same fields as the 60 s one.

**Force-completion hint.** After a verified send, `doProceed()` waits through `showForceCompletionHint()`, which wraps `chatgpt_isIdle()`:
- A 250 ms interval shows `#mzta-forcecomp-hint` once `delay_wait_completion` (7 s) has passed with `chatgpt_isGenerating()` false.
- While generating, the hint is hidden and the countdown restarts.
- If generation is never seen, the hint appears 7 s after the start, as before.
- The interval is cleared when `chatgpt_isIdle()` resolves.

**Turn selectors.** Turns are found with `[data-message-author-role=assistant]`, then `main article`. After those, `FALLBACK_TURN_SELECTORS` tries `[data-message-id]` and `[data-turn]`. These two are guesses for a new-UI variant that has neither roles nor articles: harmless if absent. `takeSendBaseline()` also stores their counts (`messageId`, `turn`). Since they may match user turns too, they are handled like articles:
- `getNewAssistantMessage()` requires the count to be at least baseline + 2.
- `fallbackTurn.minIndex` is baseline + 1, or, without a baseline, the count at call start.

Stopping early costs little: the panel buttons appear sooner, and the user still picks the text by hand. With debug on, after 60 s of waiting, one `Completion diagnostics:` line is logged (and another one at completion, see **Completion summary**). It holds structure only, never page text, and aria-labels are logged but never matched. It contains:
- the counts versus the baseline, the length, how long it has been stable, and the signals;
- `generationObserved`, `isGeneratingNow`, `assistantAtStart`, `assistantNow` and `minTurnIndex`;
- `describeButtons(..., extended)` for the last turn and for the composer container. Extended mode adds `ariaHaspopup` and the first 60 chars of the class;
- `messageId` and `turn` counts, `turnSelector` (the turn selector that matches now, `''` if none) and `fallbackTurn`;
- `composerIsIdle`, and `actionButtons: {baseline, now}`;
- `pathButtons`: page-wide counts of buttons containing each `NEW_UI_BUTTON_PATHS` prefix. These are regenerate, copy, rate (`M15.3702 10.3242`), share (`M16.6663 10.1681`), stop and voice;
- `copyAncestors`: the ancestor chain of the last copy button, or of the last regenerate button when there is no copy button, up to `main` or 15 levels. `describeAncestorChain()` gives, for each level, the tag, id, role, the names (not the values) of the `data-*` attributes, and the class cut to 60 chars.

`doProceed()` returns right after showing the retry button on `-2` (nothing was sent), so each retry doesn't add another `chatgpt_isIdle()` loop. On `-1` it deliberately falls through: the prompt is already in the composer, the user is asked to press send by hand, and the idle wait then finishes the operation normally. `doRetry()` shows `chatgpt_win_retrying` for 800 ms before the new attempt, so a retry that fails again is visibly different from a dead button, and it re-sends `_customTextArray` when the user entered custom text.

**Injected UI colors are explicit.** Newer ChatGPT CSS resets `textarea` to a transparent background with no border, so `#mzta-custom_textarea` sets its own background, text and caret colors, border, font and `color-scheme`. ThunderAI elements must not rely on inherited colors or ChatGPT CSS variables.

**The ChatGPT Web setting rows carry unprefixed element ids and are injected only when `no_chatgpt_web` is falsy.** In `injectConnectionUI()` (`pages/_lib/connection-ui.js`) every provider field id is prefixed with `modelId_prefix`, *except* the ChatGPT Web rows (`chatgpt_web_model`, `chatgpt_web_project`, `chatgpt_web_custom_gpt`, `chatgpt_web_tempchat`, `chatgpt_web_load_wait_time`, `btnChatGPTWeb_Tab`): on the options page and in the setup wizard the element id **is** the pref key (`saveOptions` writes `options[element.id]`), so prefixing them there would break persistence. Because bare ids can exist only once per page, those rows are emitted only for the two global consumers, which pass no `no_chatgpt_web`. Every per-prompt and per-feature panel passes `no_chatgpt_web: true` — it never offers the `chatgpt_web` option anyway, and the custom prompts page injects once per add-form plus once per edited row, which previously produced N+1 duplicates of those ids (misbound listeners, and one `btnChatGPTWeb_Tab` click opening N+1 tabs). Consequently the three lookups on those ids are guarded (`if (!no_chatgpt_web)` / optional chaining) — an unguarded lookup would throw on null and abort the rest of the injection, breaking every feature page.

Per-prompt ChatGPT Web overrides are a separate, unrelated mechanism: the custom prompts page renders its **own** in-page `chatgpt_web_*` fields (not injected), which are the ones actually persisted onto the prompt and consumed by `openChatGPT()`.

### OpenAI API (`chatgpt_api`)
- Module: `js/api/openai_responses.js`
- Worker: `js/workers/model-worker-openai_responses.js`
- Settings keys: `chatgpt_api_key`, `chatgpt_model`, `chatgpt_developer_messages`, `chatgpt_temperature`, `chatgpt_store`, `chatgpt_reasoning_summary`, `chatgpt_reasoning_effort`, `chatgpt_extra_body`
- **Extra body data**: see [Extra body data](#extra-body-data-chatgpt_extra_body--openai_comp_extra_body).
- **Reasoning**: the request body adds `reasoning: { summary, effort }` with only the sub-properties that are set; when both prefs are empty the key is omitted entirely, because models without reasoning support reject it. `chatgpt_reasoning_summary` (`''` | `auto` | `detailed`) is what makes the API emit a readable summary — without it the reasoning item carries only the opaque `encrypted_content` and no thinking block can be shown. `chatgpt_reasoning_effort` (`''` | `minimal` | `low` | `medium` | `high`) tunes how much the model reasons. Note that older reasoning models (o1-pro, o3-mini) never expose a summary even when one is requested. See [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui).

### Ollama (`ollama_api`)
- Module: `js/api/ollama.js`
- Worker: `js/workers/model-worker-ollama.js`
- Settings keys: `ollama_host`, `ollama_model`, `ollama_num_ctx`, `ollama_temperature`, `ollama_think`, `ollama_format_json`
- Requires CORS to be configured on the Ollama server

### OpenAI-Compatible (`openai_comp_api`)
- Module: `js/api/openai_comp.js`
- Worker: `js/workers/model-worker-openai_comp.js`
- Settings keys: `openai_comp_host`, `openai_comp_model`, `openai_comp_api_key`, `openai_comp_use_v1`, `openai_comp_chat_name`, `openai_comp_temperature`, `openai_comp_extra_body`
- Pre-configured providers: `js/api/openai_comp_configs.js` (`custom`, DeepSeek, Grok, Mistral, OpenRouter, Perplexity — `custom` is the default/manual entry). The presets carry only `id`, `name`, `chat_name`, `host`, `use_v1` — there is deliberately no per-preset extra body data.
- **Extra body data**: see [Extra body data](#extra-body-data-chatgpt_extra_body--openai_comp_extra_body).

### Extra body data (`chatgpt_extra_body` / `openai_comp_extra_body`)

An escape hatch for request parameters ThunderAI does not expose (disabling a server's thinking
mode, `top_p`, provider-proprietary fields). The pref holds a **raw JSON string** entered by the
user in the Advanced options of the connection panel; `parseExtraBody()` in
`js/api/api-utils.js` turns it into an object at request time.

- **Only these two providers.** Ollama, Gemini and Anthropic build differently-shaped bodies and
  have no such field.
- **Core parameters are protected.** The parsed object is spread **first** in the request body
  literal (`openai_comp.js` `fetchResponse`, `openai_responses.js` `request_body`), so everything
  ThunderAI manages — `model`, `messages`/`input`, `stream`, `temperature`, `max_tokens`,
  `reasoning`, `instructions` — always wins. A wrong entry cannot change the model or break the
  streaming. `instructions` in `openai_responses.js` is assigned after the literal, which keeps it
  protected for the same reason.
- **Invalid input is ignored, never fatal.** `parseExtraBody()` returns `{}` for a blank string,
  malformed JSON, or a non-object (array / scalar / `null`), logging a `console.warn`. This is
  required because the options UI validation is advisory only: `saveOptions` persists the value
  regardless, so the API class must tolerate garbage.
- `api-utils.js` must stay free of WebExtension and DOM dependencies — it is pulled into the Web
  Workers through the API classes. This is why the helper does not live in `js/mzta-utils.js`.
- UI: a `textarea.option-input.option-textarea.check-json` row marked `conn_adv` in
  `pages/_lib/connection-ui.js`, followed by a `div.json_error` whose id is the field's id plus
  `_error`.
- **Inline error reporting.** `checkJsonField()` writes the reason into that div via
  `textContent` (never `innerHTML` — Thunderbird review) and toggles its `hidden` attribute, plus
  the red border. A red border alone cannot tell the user *what* is wrong, so for a parse failure
  the raw `error.message` is appended to `prefs_extra_body_error_invalid`: it carries the position
  of the offending character (e.g. a trailing comma in `{"top_p": 0.9,}` reports position 14). A
  valid-JSON-but-not-an-object value gets `prefs_extra_body_error_not_object` instead. Styling:
  `.json_error` in `pages/_lib/connection-ui.css`, colored by the `--jsonError` token (defined for
  both themes in `pages/_lib/mzta-design.css`, red rather than amber `--warning` because the value
  is unusable, not merely a caveat).
- Two entry points: `warn_InvalidJson` on `input` (bound with the `.check-number` listeners), and
  the exported `checkJsonFields()` sweep, which must run **after** the fields are populated —
  called in `options/mzta-options.js` after `restoreOptions()` and inside
  `initializeSpecificIntegrationUI()` after its restore callback, so a malformed value saved by an
  earlier session is flagged on load instead of looking fine until touched.

### Google Gemini (`google_gemini_api`)
- Module: `js/api/google_gemini.js`
- Worker: `js/workers/model-worker-google_gemini.js`
- Settings keys: `google_gemini_api_key`, `google_gemini_model`, `google_gemini_system_instruction`, `google_gemini_thinking_budget`, `google_gemini_temperature`
- `thinking_budget` is coerced with `parseInt` and sent as the integer
  `thinkingConfig.thinkingBudget`; an empty or unparsable value omits the budget and
  leaves the choice to the model. See
  [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui) for the
  `includeThoughts` flag sent alongside it.

### Anthropic / Claude (`anthropic_api`)
- Module: `js/api/anthropic.js`
- Worker: `js/workers/model-worker-anthropic.js`
- Settings keys: `anthropic_api_key`, `anthropic_model`, `anthropic_version`, `anthropic_max_tokens`, `anthropic_system_prompt`, `anthropic_temperature`, `anthropic_extended_thinking_budget`, `anthropic_effort`
- **Capability table** (`js/api/anthropic_model_capabilities.js`): which request parameters a Claude
  model accepts depends on the model, and sending one it rejects is a hard 400 — not a silently
  ignored field. `getAnthropicModelCapabilities(modelId)` matches by **model ID prefix** (so dated
  variants such as `claude-sonnet-4-5-20250929` resolve to their family, longest prefix first) and
  returns `{thinkingModes, supportsBudgetTokens, supportsSamplingParams, supportsEffort,
  effortLevels, defaultThinking}`, plus `disabledThinkingMaxEffort` on the one model that needs it.
  An unknown ID — users can type any model name — falls back to `ANTHROPIC_MODERN_CAPABILITIES`,
  deliberately assuming the *modern* contract: a stale setting then degrades to a valid request,
  whereas assuming the legacy contract would send `temperature`/`budget_tokens` and earn a 400.
  **The table must be updated as new models ship.**
- **Request body construction** is entirely driven by that table, and every field is opt-in:
  - `temperature` is sent only when `supportsSamplingParams` and the user set a value. It is now
    **independent of the thinking configuration** — the old rule that extended thinking suppressed
    temperature no longer holds, because on newer models temperature is rejected outright regardless.
  - `thinking: {type:'enabled', budget_tokens: N}` only when `supportsBudgetTokens` and N > 0.
  - `thinking: {type:'disabled'}` only where it changes something — i.e. `defaultThinking === 'adaptive'`
    (newer models think unless told not to, which silently eats `max_tokens` and truncates the reply).
    On models that already default to no thinking the field stays omitted, so their request bodies are
    byte-identical to what they were before the table existed.
  - `output_config: {effort}` only when `supportsEffort` and the level is valid for that model.
    Omitted when the level equals `ANTHROPIC_DEFAULT_EFFORT` (`high`), which is the API default —
    kept behind that named constant so it is easy to change.
  - Any other combination omits the field entirely. **A configuration that is impossible for the
    selected model degrades to a valid request, never to a 400.** Stored prefs are never rewritten:
    the user may switch back to an older model, so incompatibility is resolved at request-build time
    (here) and at display time (the options page disables the field with a note).
- **400 error hints**: `describeAnthropicError(detail, model, i18nStrings)` inspects a 400 body and,
  when the message names `temperature` / `top_p` / `top_k` / `thinking.type` / `budget_tokens` /
  `effort`, prepends a localized hint naming the incompatible option; otherwise the raw detail is
  returned unchanged. It takes `i18nStrings` as a parameter because it runs inside a Web Worker,
  where `browser.i18n` is unavailable — the same threading already used for
  `anthropic_api_request_failed`.

See [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui) for how the resulting stream is surfaced.

## Thinking output in the webchat UI

**Display is never gated by a preference, but on some providers the request must ask
for the reasoning in the first place.** Every API worker forwards reasoning content as
soon as the corresponding field is present in the stream, so a model that reasons on
its own — without the connection's thinking option being enabled — still shows its
thinking block. The per-connection prefs (`ollama_think`,
`google_gemini_thinking_budget`, `anthropic_extended_thinking_budget`,
`chatgpt_reasoning_summary`) only *request* reasoning from the API; they never decide
whether it is displayed.

Two providers return no readable reasoning unless the request opts in, which makes the
request side — not the display side — the thing to check when a thinking block never
appears:

- **OpenAI Responses**: returns nothing readable unless `chatgpt_reasoning_summary` is
  set, so with that pref empty the thinking block never appears no matter which model
  is selected.
- **Google Gemini**: emits `thought: true` parts only when the request carries
  `generationConfig.thinkingConfig.includeThoughts: true`. Without it the API still
  reasons and still bills the tokens (visible as `usageMetadata.thoughtsTokenCount`)
  while the stream carries answer parts only. `js/api/google_gemini.js` therefore sends
  `includeThoughts` on every request except when `google_gemini_thinking_budget` is `0`,
  which disables thinking outright — including when the pref is empty, since a
  thinking-capable model reasoning on its model default must still show its block.
  `includeThoughts` is independent of `thinkingBudget`: the budget governs how much the
  model reasons, the flag whether that reasoning comes back.

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
| Google Gemini | any `parts[]` entry with `thought === true`. **All** parts are iterated, not just `parts[0]`, because a thought part may come first and would otherwise be mixed into the answer. These parts only exist if the request sent `includeThoughts` — see above |
| OpenAI Responses | `response.reasoning_summary_text.delta` and `response.reasoning_text.delta`; as a fallback, the concatenated `item.summary[].text` of a `response.output_item.done` whose `item.type === 'reasoning'`, for models that deliver the summary in one piece instead of streaming deltas. The fallback only fires while `thinkingAccumulator` is still empty, so a summary already received as deltas is never emitted twice. `item.encrypted_content` is always ignored — it is not readable |

**2. Inline `<think>…</think>` tags in the content stream.** Used by models that
have no dedicated field (Ollama without `ollama_think`, several OpenAI-compatible
servers). `StreamingMessage.flush()` extracts and strips these via the shared
`stripThinkTags()` helper in `js/mzta-utils.js`. If an unterminated `<think>` is
detected mid-stream, the flush is deferred until the closing tag arrives (that guard
lives in `streamingMessage.js`, not in the helper).

The helper's third argument, `trimLeading` (default `false`), drops the whitespace a
removed block leaves at the start of the text. It is only correct for callers passing
the **whole** response. The streaming flush passes a single *segment*, so it must leave
it off: the space opening a segment is interior to the answer once the segments are
concatenated into `_htmlRawText`, and trimming it welds the last word of the previous
segment to the first word of this one (`"il"` + `" body"` → `"ilbody"`). Because the
flush fires on any token containing `\n`, the segment boundary — and therefore the
damage — lands at positions that depend on the provider's chunking rather than on the
answer's content, which is what makes such a bug read as intermittent.

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
  `stripThinkTags(text, true, true)` before the promise resolves. The second flag drops
  a dangling unterminated `<think>` (a truncated reply) rather than handing raw
  reasoning to the caller's parser. The third enables the leading-whitespace trim, which
  is safe here because `full_message` is the whole response — unlike the per-segment
  streaming caller above.

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

Helpers: `getAddTagsPrompt()`, `getSpamFilterPrompt()`, `getSummarizePrompt()`, `getTranslatePrompt()` in `js/mzta-prompts.js` (or `loadPrompt(id)`). The execution paths in `mzta-background.js` (`_generateSummaryForMessage`, `_generateTranslationForMessage`, spamfilter, add_tags) follow this pattern. Special-prompt execution paths must read their prompt object from these helpers (which go through `getSpecialPrompts()`), never from `menus.allPrompts` — that array is filtered by `getActiveSpecialPromptsIDs()` and can omit a feature's prompt (e.g. when no global connection is set or the global connection is ChatGPT Web without a per-feature API override) even while the feature's auto-processing is enabled, which would yield `curr_prompt === undefined`.

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

### Error contract between `js/api/*` and workers

The provider classes in `js/api/` return **two different shapes** on failure, and workers must branch on `is_exception` before formatting the message:

- **Network-level exception** (server unreachable, DNS failure, CORS rejection): the `catch` block in `fetchResponse()` does **not** return a `Response`. It returns a plain object `{ok: false, is_exception: true, error}` with **no `status` and no `statusText`**, and `error` already includes the provider name (e.g. `"Ollama API request failed: TypeError: NetworkError…"`).
- **HTTP error** (404, 401, 500…): a real `Response` is returned, so `status`, `statusText` and the JSON body are all available.

Reading `response.status` / `response.statusText` in the exception branch yields a literal `"undefined undefined"` in the user-visible error, and re-prefixing the i18n provider string there duplicates the provider name. All five workers therefore build a single `error_text` variable:

```js
if(response.is_exception === true){
    error_message = response.error;
    error_text = error_message;              // already prefixed; no status/statusText exist
}else{
    // …extract error_message / errorDetail from the JSON body…
    error_text = i18nStrings["<provider>_api_request_failed"] + ": " + response.status + " " + response.statusText
        + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
}
postMessage({ type: 'error', payload: error_text });
throw new Error("[ThunderAI] <Provider> API request failed: " + error_text);
```

The `postMessage` payload and the `throw` reuse the same `error_text` so the UI panel and the console message cannot drift apart.

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
9. Branch on `is_exception` in the worker's error block — see [Error contract between `js/api/*` and workers](#error-contract-between-jsapi-and-workers) above
