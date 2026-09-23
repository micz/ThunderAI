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

**The ChatGPT Web setting rows carry unprefixed element ids and are injected only when `no_chatgpt_web` is falsy.** In `injectConnectionUI()` (`pages/_lib/connection-ui.js`) every provider field id is prefixed with `modelId_prefix`, *except* the ChatGPT Web rows (`chatgpt_web_model`, `chatgpt_web_project`, `chatgpt_web_custom_gpt`, `chatgpt_web_tempchat`, `chatgpt_web_load_wait_time`, `btnChatGPTWeb_Tab`): on the options page and in the setup wizard the element id **is** the pref key (`saveOptions` writes `options[element.id]`), so prefixing them there would break persistence. Because bare ids can exist only once per page, those rows are emitted only for the two global consumers, which pass no `no_chatgpt_web`. Every per-prompt and per-feature panel passes `no_chatgpt_web: true` — it never offers the `chatgpt_web` option anyway, and the custom prompts page injects once per add-form plus once per edited row, which previously produced N+1 duplicates of those ids (misbound listeners, and one `btnChatGPTWeb_Tab` click opening N+1 tabs). Consequently the three lookups on those ids are guarded (`if (!no_chatgpt_web)` / optional chaining) — an unguarded lookup would throw on null and abort the rest of the injection, breaking every feature page.

Per-prompt ChatGPT Web overrides are a separate, unrelated mechanism: the custom prompts page renders its **own** in-page `chatgpt_web_*` fields (not injected), which are the ones actually persisted onto the prompt and consumed by `openChatGPT()`.

### OpenAI API (`chatgpt_api`)
- Module: `js/api/openai_responses.js`
- Worker: `js/workers/model-worker-openai_responses.js`
- Settings keys: `chatgpt_api_key`, `chatgpt_model`, `chatgpt_developer_messages`, `chatgpt_temperature`, `chatgpt_store`, `chatgpt_reasoning_summary`, `chatgpt_reasoning_effort`, `chatgpt_extra_body`, `chatgpt_max_output_tokens`, `chatgpt_verbosity`, `chatgpt_text_format`, `chatgpt_text_format_schema_name`, `chatgpt_text_format_schema`, `chatgpt_top_p`, `chatgpt_truncation`, `chatgpt_prompt_cache_key`, `chatgpt_service_tier`, `chatgpt_safety_identifier`, `chatgpt_include_encrypted_reasoning`
- **Extra body data**: see [Extra body data](#extra-body-data).
- **Capability table** (`js/api/openai_model_capabilities.js`): which parameters a model accepts
  depends on the model, and sending one it rejects is a hard 400.
  `getOpenAIModelCapabilities(modelId)` matches by **model ID prefix** (so dated and sized
  variants such as `o3-2025-04-16` and `gpt-5-mini` resolve to their family, longest prefix
  first) and returns `{supportsSamplingParams, supportsReasoning, supportsVerbosity}`.
  The reasoning models (`gpt-5`, `o1`, `o3`, `o4`) reject `temperature` and `top_p`; the chat
  models (`gpt-4`, `chatgpt-4o`, `gpt-3.5`) have no reasoning stage and reject `reasoning` and
  `text.verbosity`; `text.verbosity` is understood only by the `gpt-5` family. An unknown ID —
  users can type any model name — falls back to `OPENAI_PERMISSIVE_CAPABILITIES`, which allows
  **everything**: a field left enabled at worst produces an API error naming the parameter,
  while a field wrongly disabled hides a setting the user needs and gives no clue why.
  **The table must be updated as new models ship.**
  Unlike Ollama there is no way to probe this at runtime: `GET /v1/models` returns only
  `{id, object, created, owned_by}` and there is no per-model metadata endpoint, which is why a
  local table is the only option.
- **Reasoning**: the request body adds `reasoning: { summary, effort }` with only the sub-properties that are set; when both prefs are empty, or the model has no reasoning support, the key is omitted entirely. `chatgpt_reasoning_summary` (`''` | `auto` | `detailed`) is what makes the API emit a readable summary — without it the reasoning item carries only the opaque `encrypted_content` and no thinking block can be shown. `chatgpt_reasoning_effort` (`''` | `none` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`) tunes how much the model reasons. Note that older reasoning models (o1-pro, o3-mini) never expose a summary even when one is requested. See [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui).
- **The `text` object** is built the same defensive way as `reasoning`: `verbosity` and
  `format` are collected into one object and the key is emitted **only when that object is
  non-empty**, so a model that rejects `text` keeps exactly the request body it had before
  these options existed.
  - `chatgpt_verbosity` (`''` | `low` | `medium` | `high`) is gated on `supportsVerbosity`.
  - `chatgpt_text_format` (`''` | `json_object` | `json_schema`) selects `text.format.type`.
    `json_schema` additionally **requires both** `chatgpt_text_format_schema_name` and a
    `chatgpt_text_format_schema` that parses to a non-null, non-array object. When either is
    missing the format is dropped **entirely** rather than sent half-built, which would be a
    400. `parseExtraBody()` is deliberately **not** reused to parse the schema: it falls back
    to `{}`, and `{}` is itself a valid JSON Schema, so a malformed textarea would silently
    send an empty schema instead of dropping the format.
- **Sampling**: `chatgpt_temperature` and `chatgpt_top_p` are both gated on
  `supportsSamplingParams` and use the `!= '' && !Number.isNaN(parseFloat(…))` double guard.
  `chatgpt_top_p` is stored as a **string**, so an empty value stays distinguishable from a
  legitimate `0`.
- **`chatgpt_max_output_tokens`** is sent only when it parses to `>= OPENAI_MIN_MAX_OUTPUT_TOKENS`
  (16, exported from `js/api/openai_responses.js`), the API minimum; `0`, empty or a smaller
  number means "not configured" and the field is omitted. It is a **class property**, like every
  other option — before 5.1.0 it was a `fetchResponse()` argument that the worker always passed
  as `0`, so it was never actually sent. The argument is gone; the signature is now
  `fetchResponse(messages, previous_response_id)`.
- **`chatgpt_truncation`, `chatgpt_prompt_cache_key`, `chatgpt_service_tier` and
  `chatgpt_safety_identifier`** are plain pass-through values, sent whenever non-empty and not
  capability-gated. `safety_identifier` replaces the deprecated `user` parameter.
- **`chatgpt_include_encrypted_reasoning`** adds `include: ['reasoning.encrypted_content']`
  **only when the checkbox is on** — an empty `include` array is not a valid request. It is
  only meaningful when `chatgpt_store` is off.
- **Capability-gated keys are stripped from the extra body too.** The parsed `extra_body` object
  has `temperature`/`top_p` removed when the model rejects sampling, `reasoning` removed when it
  has no reasoning stage, and `text` removed when it carries a `verbosity` the model does not
  support. Without this a stale `extra_body` entry would re-introduce exactly the parameter the
  table exists to keep out of the request, turning a disabled field back into a 400. Keys the
  model *does* accept are still honoured — that is the point of the escape hatch — and the
  managed fields still win, because the object is spread first in the body literal.
- **Options page gating**: `updateOpenAIModelCapabilityUI()` (`pages/_lib/connection-ui.js`)
  mirrors the table in the UI, disabling `chatgpt_temperature` / `chatgpt_top_p` /
  `chatgpt_reasoning_summary` / `chatgpt_reasoning_effort` / `chatgpt_verbosity` with an
  `_unsupported` note next to each. Stored values are **never rewritten** — the user may switch
  back to another model — so incompatibility is resolved at request-build time and at display
  time, exactly like the Claude panel. Unlike `anthropic_effort`, the reasoning effort `<select>`
  ships its options **statically**: the levels do not vary per model, only whether reasoning is
  supported at all, so there is no runtime rebuild and no blank-select hazard.
  It also calls `updateOpenAITextFormatUI()`, which disables the schema name and schema fields
  unless the format is `json_schema` — a coupling between two fields, not a model capability, so
  those two carry no `_unsupported` note.
  Host pages must call it **after their restore**, like the Claude one: `options/mzta-options.js`,
  `pages/setup-wizard/mzta-setup-wizard.js`, `initializeSpecificIntegrationUI()` (the six
  per-feature panels) and `pages/customprompts/mzta-custom-prompts.js` (add form + each edited row).

### Ollama (`ollama_api`)
- Module: `js/api/ollama.js`
- Worker: `js/workers/model-worker-ollama.js`
- Settings keys: `ollama_host`, `ollama_api_key`, `ollama_model`, `ollama_num_ctx`, `ollama_temperature`,
  `ollama_think`, `ollama_format_json`, `ollama_keep_alive`, `ollama_system_prompt`, `ollama_extra_options`
- Requires CORS to be configured on the Ollama server
- **`ollama_think` is a level, not a flag**, with **three distinct states** — and the difference
  between the first two is behavioural, not cosmetic:

  | Stored value | Sent | Meaning |
  |---|---|---|
  | `''` | *field omitted* | whatever the model does by default |
  | `'false'` | `think: false` | explicitly off |
  | `'true'` | `think: true` | explicitly on, no level |
  | `low`/`medium`/`high`/`max` | `think: "<level>"` | a reasoning level |

  **Omitting the field is not the same as turning thinking off.** A model whose `/api/show`
  reports `"thinking": {"default": true}` reasons when `think` is absent, so "off" has to be an
  explicit `false`. Verified against a live server: with the field omitted the reply carries a
  771-character `message.thinking`; with `think: false` it carries none.
  `parseThinkValue()` in `js/api/ollama.js` maps the two string keywords back to real JSON
  booleans and passes a level through unchanged.

  It was a boolean checkbox before, so `normalizeThink()` coerces a legacy `true`/`false` at
  construction time — to `'true'` and **`'false'`**, never to `''`: unticking the box meant "do
  not think", which only an explicit `false` still delivers. That coercion is **required, not
  belt-and-braces**: the config default in `integration_options_config` is a string now, so the
  `typeof options_config[key] === 'boolean'` branch in `js/mzta-special-commands.js` no longer
  coerces this key, and a per-prompt override can still hold a real boolean.
  `migrateOllamaThinkLevel()` (`js/mzta-prefs-migration.js`, one-shot flag
  `_migrated_ollama_think_level`, called from `mzta-background.js`) applies the same mapping to
  the **global** pref only, because that is the one loaded into a `<select>`, where a stored
  boolean would select no option and render the control blank. Prompt objects are deliberately
  not walked.
- **The think select is built at runtime**, not in the injected template, by
  `buildOllamaThinkOptions()` (`pages/_lib/connection-ui.js`), from the **top-level `thinking`
  object** of `/api/show`:

  ```
  {"values": [false, true], "default": true}             -> on/off only, no levels
  {"values": [false, "low", "high"], "default": "low"}   -> these levels
  null / absent                                          -> not reported
  ```

  Only the **string** entries of `values` are levels; `false`/`true` describe the on/off pair the
  fixed entries already cover. A missing or unusable `thinking` object means *"this server does
  not report it"*, **not** *"no levels"* — several models carry `thinking` in `capabilities` while
  leaving this `null` — so the full catalogue (`OLLAMA_THINK_LEVELS`) is offered instead of
  assuming a restriction. Sending a level to a model that only knows on/off is not an error
  anyway: Ollama treats it as "on", verified against a live server.
  As with the Claude effort select, a stored value this model does not offer is kept as a trailing
  option, so it survives a round trip through another model.
- **`ollama_keep_alive`** is sent as a top-level `keep_alive` string (`"5m"`, `"30m"`, `-1` to keep
  the model loaded indefinitely, `0` to unload immediately), omitted when empty. It matters because
  auto-tagging, the spam filter and auto-summarize run on incoming mail, and the server's 5-minute
  default unloads the model between messages.
- **`ollama_system_prompt`** is prepended by the **worker**, not by the API class: in the `init`
  branch of `js/workers/model-worker-ollama.js`, **once**, not per `chatMessage`. `conversationHistory`
  is module-level state that survives every turn, so prepending per message would stack one system
  message per turn. The history is still empty at `init`, so `push()` *is* the prepend. The `Ollama`
  class still declares the field so the generic `ollama_` config sweep does not drop it.
- **`ollama_api_key`** is optional and sent as `Authorization: Bearer <key>` on every endpoint via
  `_headers()`, covering the hosted API at `ollama.com` and self-hosted servers behind an
  authenticating reverse proxy. The id ends in `_api_key`, so `isAPIKeyValue()` redacts it in the
  options-page restore log for free. **The worker must never log `config` or any header map built
  from it.**
- **Extra options**: see [Extra body data](#extra-body-data).
- **Model capability detection.** `fetchModelInfo(model)` (POST `/api/show`) returns the server's
  description of one model: `capabilities` (e.g. `["completion","vision","thinking","tools"]`) and
  a context length under an **architecture-prefixed** key in `model_info`
  (`llama.context_length`, `qwen3.context_length`, ...) - so it is read by matching the
  `.context_length` suffix, never by hardcoding an architecture.
  `updateOllamaModelCapabilityUI(modelInfo, prefix)` (`pages/_lib/connection-ui.js`) applies it:
  it disables the think control with a note when the model does not report `thinking`, and shows
  the real maximum next to `num_ctx`.
  - **An absent `capabilities` array means "this server does not report them", not "the model
    cannot think"** - older Ollama builds omit the field. Only an explicit list *lacking*
    `thinking` disables the control.
  - **It degrades to "enable everything".** Called with `null` (unreachable server, `/api/show`
    unsupported, model not pulled) it clears the notes and leaves every control enabled. A failed
    probe must never block the user.
  - **Stored values are never rewritten**, exactly like the Claude panel: the user may switch model.
  - **The request side is not gated.** `think` is still sent as stored: Ollama ignores it on a
    non-thinking model, and gating it would mean threading capability data into the Web Worker,
    which knows nothing about `/api/show`.
  - **Trigger: every model `change`**, exactly like `updateAnthropicModelCapabilityUI()` - plus the
    `ollama_host` and `ollama_api_key` `change` events, since those decide *which server* answers.
    It also runs after a successful "Fetch models", after each page's restore, and after a
    successful connection test (which may be the moment the host permission was granted).
    Unlike the Claude one it **fetches its own data**: it reads host/key/model off the form and
    calls `fetchModelInfo()` itself, so callers pass only the `modelId_prefix` and every panel that
    injects the connection UI is covered - options, setup wizard, the six per-feature panels and
    the custom-prompts add form and per-row editors.
  - **Two guards keep a per-`change` network call cheap**, because unlike the Claude table this one
    is a round trip:
    - `_ollamaCapsCache` memoises per `host|api_key|model`, so re-selecting a model already seen
      costs nothing. A `null` result is cached too - a server that cannot describe a model must not
      be re-asked on every re-selection.
    - `_ollamaCapsSeq`, a generation counter, discards the reply of a probe whose selection has
      since been superseded, so a slow answer can never repaint the panel for a model the user has
      already moved away from.
  - **No permission request.** It runs on a plain selection change, where prompting for host
    permissions would be hostile. Without the permission the fetch simply fails and the panel
    degrades to "everything enabled"; the user grants it via the CORS button or the connection
    test, and the next change picks the capabilities up - which is why a successful test re-probes.

### OpenAI-Compatible (`openai_comp_api`)
- Module: `js/api/openai_comp.js`
- Worker: `js/workers/model-worker-openai_comp.js`
- Settings keys: `openai_comp_host`, `openai_comp_model`, `openai_comp_api_key`, `openai_comp_use_v1`, `openai_comp_chat_name`, `openai_comp_temperature`, `openai_comp_extra_body`
- Pre-configured providers: `js/api/openai_comp_configs.js` (`custom`, DeepSeek, Grok, Mistral, OpenRouter, Perplexity — `custom` is the default/manual entry). The presets carry only `id`, `name`, `chat_name`, `host`, `use_v1` — there is deliberately no per-preset extra body data.
- **Extra body data**: see [Extra body data](#extra-body-data).

### Extra body data

An escape hatch for request parameters ThunderAI does not expose (disabling a server's thinking
mode, `top_p`, provider-proprietary fields). The pref holds a **raw JSON string** entered by the
user in the Advanced options of the connection panel; `parseExtraBody()` in
`js/api/api-utils.js` turns it into an object at request time.

- **Four providers, and they differ in *where* the data goes.** Anthropic builds a
  differently-shaped body and has no such field.

  | Pref | Spread into |
  |------|-------------|
  | `chatgpt_extra_body` | top level of the request body |
  | `openai_comp_extra_body` | top level of the request body |
  | `ollama_extra_options` | **the `options` object**, not the top level |
  | `google_gemini_extra_body` | **both levels**: the top level *and*, separately, the nested `generationConfig` |

  Gemini is a two-level merge because the parameters ThunderAI manages
  (`thinkingConfig`, `temperature`, `maxOutputTokens`, `topP`, `topK`) live inside
  `generationConfig`. A single top-level spread would let a user's `generationConfig`
  silently replace the whole managed object, so `parsedExtraBody.generationConfig` is
  spread into `generationConfig` first (only when it is a plain object) and the managed
  keys are applied on top. Root keys such as `safetySettings` or `tools` are therefore
  accepted, while `contents` and `system_instruction` can never be overridden.

  Ollama is the exception on purpose: `top_p`, `top_k`, `min_p`, `seed`, `num_predict`,
  `repeat_penalty`, `stop` and `num_keep` all live under `options` in the Ollama API, so spreading
  them at the top level would put them where the server does not read them.
- **Core parameters are protected.** The parsed object is spread **first** in the body literal
  (`openai_comp.js` `fetchResponse`, `openai_responses.js` `request_body`) — or, for Ollama, first
  inside the `options_obj` literal in `ollama.js` `fetchResponse` — so everything ThunderAI manages
  always wins: `model`, `messages`/`input`, `stream`, `temperature`, `max_tokens`, `reasoning`,
  `instructions`, and `num_ctx` on Ollama. A wrong entry cannot change the model or break the
  streaming. `instructions` in `openai_responses.js` is assigned after the literal, which keeps it
  protected for the same reason.
  Note that "protected" means *overridden when ThunderAI sends its own value*. A parameter the
  user leaves empty is not sent by ThunderAI at all, so an `extra_body` entry for it does reach
  the API — which is exactly what the escape hatch is for. The one exception is
  `openai_responses.js`, which additionally **deletes** the capability-gated keys from the parsed
  object (see the OpenAI API section): there the model would reject the parameter outright, so
  letting it through would defeat the gating.
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
- Settings keys: `google_gemini_api_key`, `google_gemini_model`, `google_gemini_system_instruction`, `google_gemini_thinking_budget`, `google_gemini_temperature`, `google_gemini_max_output_tokens`, `google_gemini_top_p`, `google_gemini_top_k`, `google_gemini_extra_body`
- `thinking_budget` is coerced with `parseInt` and sent as the integer
  `thinkingConfig.thinkingBudget`; an empty or unparsable value omits the whole
  `thinkingConfig` and leaves the choice to the model. See
  [Thinking output in the webchat UI](#thinking-output-in-the-webchat-ui) for the
  `includeThoughts` flag sent alongside it.
- `max_output_tokens` maps to `generationConfig.maxOutputTokens` and defaults to `0`,
  the same "unset" convention as `ollama_num_ctx`: the key is sent only when the parsed
  integer is `> 0`.
- `top_p` / `top_k` map to `generationConfig.topP` / `topK` and default to `''`, like
  `temperature`. They are parsed with `parseFloat` / `parseInt` and sent only when the
  pref is non-empty and the result is not `NaN`. Ranges are deliberately not validated
  client-side — an out-of-range value is reported by the API, as with `temperature`.

### Anthropic / Claude (`anthropic_api`)
- Module: `js/api/anthropic.js`
- Worker: `js/workers/model-worker-anthropic.js`
- Settings keys: `anthropic_api_key`, `anthropic_model`, `anthropic_version`, `anthropic_max_tokens`, `anthropic_system_prompt`, `anthropic_temperature`, `anthropic_top_p`, `anthropic_top_k`, `anthropic_stop_sequences`, `anthropic_extended_thinking_budget`, `anthropic_effort`
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
  - `top_p` and `top_k` follow exactly the same rule as `temperature`: gated on
    `supportsSamplingParams`, parsed with `parseFloat` / `parseInt`, skipped when the pref is `''`
    or unparsable. They are **sent independently of each other and of `temperature`** — there is
    deliberately no mutual-exclusion logic. The API accepts the combination and only advises
    against it, so silently dropping one of two values the user explicitly set would be the more
    surprising behaviour. Both prefs are stored as **strings**, so an empty value stays
    distinguishable from a legitimate `0` (which is valid for both and *is* sent).
  - `stop_sequences` is **not capability-gated** — every Claude model accepts it. The pref holds one
    sequence per line; the builder splits on newlines (CRLF-safe), trims each entry and drops the
    empty ones, and adds the field only when the resulting array is non-empty. Blank lines are
    dropped at request-build time, never at save time, so the user's formatting of the textarea is
    left alone.
  - `system` is **omitted entirely when the system prompt is blank**, rather than sent as an empty
    string: an empty system block carries no instruction and is rejected outright by some model
    versions.
  - `thinking: {type:'enabled', budget_tokens: N}` only when `supportsBudgetTokens` **and**
    `ANTHROPIC_MIN_THINKING_BUDGET <= N < max_tokens`. The API constrains the budget on both sides
    and violating either is a hard 400 — easy to hit by hand, since the default `max_tokens` is
    4096. A budget that fails a constraint is treated as "no extended thinking" and **falls through
    to the disabled/omitted logic below** (it does not short-circuit it, which is what keeps an
    adaptive-thinking model from silently spending `max_tokens` on reasoning), and a `console.warn`
    names the constraint that failed. The stored pref is **never** rewritten — the user may raise
    `max_tokens` later and expect their budget back. `ANTHROPIC_MIN_THINKING_BUDGET` (1024) is
    exported from `js/api/anthropic.js` and read by the options page too, so the request-side rule
    and the inline warning cannot drift apart.
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
- **`anthropic_effort` ships as an EMPTY `<select>`.** The template emits no `<option>`s:
  `updateAnthropicModelCapabilityUI()` is what fills it, from the model's `effortLevels`. A page
  that injects the connection UI and never calls it therefore shows a **blank** effort control
  until the user touches the model select (which fires the `change` listener registered in
  `injectConnectionUI()`). Every host page must call it **after its restore**, when the saved
  model is finally in the select — the injection deliberately does not, because at that point the
  select is still empty and the capabilities would be computed from an empty model ID.
  Call sites: `options/mzta-options.js`, `pages/setup-wizard/mzta-setup-wizard.js`,
  `initializeSpecificIntegrationUI()` (the six per-feature panels) and
  `pages/customprompts/mzta-custom-prompts.js` (add form + each edited row).
  The same rule applies to `updateOllamaModelCapabilityUI()`, whose think select is likewise
  built at runtime.
- **Inline budget validation in the options page.** `checkAnthropicThinkingBudget()`
  (`pages/_lib/connection-ui.js`) mirrors the request-side rule on
  `anthropic_extended_thinking_budget`, writing the reason into a
  `div.json_error` whose id is the field's id plus `_error` (`textContent`, never `innerHTML`) and
  setting the red border — the same mechanism as `checkJsonField()`. A bare border is not enough
  here because there are two distinct constraints and the ceiling lives in *another* field, so the
  listener is bound on `anthropic_max_tokens` as well: lowering it can invalidate a budget that was
  fine a moment ago. The reason box is a **separate element** from the `_unsupported` capability
  note — both conditions can hold at once, so sharing one node would have this function and
  `updateAnthropicModelCapabilityUI()` overwrite each other. It is called from
  `updateAnthropicModelCapabilityUI()` rather than exported separately, since every host page
  already calls that after its restore, which is exactly when a value saved by an earlier session
  must be re-checked. **Advisory only**: `saveOptions` persists the value regardless, which is why
  the request builder has to tolerate an unusable one.
- **`top_p` / `top_k` in the options page** reuse the existing
  `anthropic_note_temperature_unsupported` string for their capability notes — the explanation
  ("this model uses Effort instead") is identical — via
  `applyState('anthropic_top_p', caps.supportsSamplingParams)` and the same for `top_k`.
  `anthropic_stop_sequences` is a plain textarea with no capability note, because it is never gated.
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
thinking block. The per-connection prefs (`ollama_think`, `google_gemini_thinking_budget`,
`anthropic_extended_thinking_budget`, `chatgpt_reasoning_summary`) only *request*
reasoning from the API; they never decide whether it is displayed. Note `ollama_think`
is a reasoning **level**, not a flag — see the Ollama section above.

Two providers return no readable reasoning unless the request opts in, which makes the
request side — not the display side — the thing to check when a thinking block never
appears:

- **OpenAI Responses**: returns nothing readable unless `chatgpt_reasoning_summary` is
  set, so with that pref empty the thinking block never appears no matter which model
  is selected.
- **Google Gemini**: emits `thought: true` parts only when the request carries
  `generationConfig.thinkingConfig.includeThoughts: true`. Without it the API still
  reasons and still bills the tokens (visible as `usageMetadata.thoughtsTokenCount`)
  while the stream carries answer parts only. `js/api/google_gemini.js` sends
  `includeThoughts` whenever a budget is set and is not `0` (which disables thinking
  outright). When `google_gemini_thinking_budget` is **empty the entire `thinkingConfig`
  is omitted**, because models without thinking support (the Gemini 2.0 family) reject
  the key with an HTTP 400. The trade-off: a thinking-capable model reasoning on its own
  default is not asked for `includeThoughts`, so its thinking block is not shown unless
  the user sets a budget.
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
have no dedicated field (Ollama with `ollama_think` off, several OpenAI-compatible
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
- The level is clamped to **0.5–2.5** (step 0.1) and persisted in `browser.storage.local` under the global `api_webchat_font_scale` pref (default `1.0`, in `options/mzta-options-default.js`). On window open the saved value is read and re-applied, so the zoom survives closing the window and is shared across all webchat windows and providers.
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

## Token usage data

Every provider reports token counts under a different name and a different shape. `js/api/mzta-api-usage.js`
normalizes them into one object, so nothing downstream has to know a provider's field names. Like
`api-utils.js` it is **worker-safe**: no DOM, no `browser.*`/`messenger.*`.

```js
{
  provider, model,
  input_tokens, output_tokens, total_tokens,
  cached_input_tokens, cache_creation_tokens,
  reasoning_tokens, tokens_per_second,
}
```

**`null` and `0` are not interchangeable, and this distinction carries all the way to the UI:**

- `null` — the provider does **not** expose this metric
- `0` — the provider reported zero

A missing value is therefore never coerced to `0`. `createUsageData(fields)` defaults every absent key to
`null` and computes `total_tokens` from the input/output pair **only** when both are numbers and no total was
reported. `isUsageDataEmpty(usage)` is true when there is no object or every numeric field is `null`.
`mergeUsageData(a, b)` merges two partial objects with `b`'s non-null values winning, recomputing the total —
Anthropic needs it, because its input and output counts arrive on two different stream events. A side's total
counts as *reported* only when it differs from that side's own `input + output`: one equal to the sum is
indistinguishable from the one `createUsageData()` computed, and keeping it would freeze the total at
`message_start`'s placeholder `output_tokens: 1`.

**Subset invariant.** Every extractor normalizes so that `cached_input_tokens` and `cache_creation_tokens` are
**part of** `input_tokens`, and `reasoning_tokens` is **part of** `output_tokens`. OpenAI (both APIs) and Ollama
report it that way natively; Anthropic and Gemini do not and are adjusted in their extractor (below). The chat
popover's "of which" rows depend on it.

Display and formatting helpers deliberately live **outside** this module.

### Per-provider support

Each API module exports `supportsUsageData` (boolean) and, when true, `extractUsage(raw)`, which returns a
normalized object or `null`. **`extractUsage()` must never throw**: it is called per streamed chunk, so a
partial or unexpected payload must not break the stream it is reading. Every access is guarded and the body is
wrapped in `try/catch`.

`supportsUsageData(connection_type)` in `js/mzta-utils.js` answers the same question **by connection type**, so
the UI can query it without importing every provider module. The two must stay in agreement. ChatGPT Web — and
any other non-API web integration — is `false`: there is no API to report anything.

| Provider | Populated | Always `null` |
|---|---|---|
| `chatgpt_api` (`openai_responses`) | input, output, total, cached_input, reasoning | cache_creation, tokens_per_second |
| `anthropic_api` | input *(incl. cache)*, output, total *(computed)*, cached_input, cache_creation | reasoning, tokens_per_second |
| `google_gemini_api` | input, output *(incl. thoughts)*, total, cached_input, reasoning | cache_creation, tokens_per_second |
| `ollama_api` | input, output, total *(computed)*, tokens_per_second | cached_input, cache_creation, reasoning |
| `openai_comp_api` | input, output, total, cached_input, reasoning *(all best effort)* | cache_creation, tokens_per_second |
| `chatgpt_web` | — *(no extractor)* | everything |

Where the data comes from, per provider:

- **openai_responses** — `response.usage`. While streaming it exists **only** on the final `response.completed`
  event, under `event.response.usage`; `extractUsage()` accepts both that event and a plain response body.
- **anthropic** — split across two events: `message_start` carries the input tokens and both cache counters
  (under `message.usage`), `message_delta` carries the output tokens (cumulative, so the last one wins). The
  extractor returns a **partial** object and the worker combines the halves with `mergeUsageData()`.
  Claude's `input_tokens` **excludes** the cache (documented total input = `input_tokens +
  cache_read_input_tokens + cache_creation_input_tokens`), so the extractor sums them into `input_tokens` to
  honour the subset invariant.
- **google_gemini** — `usageMetadata`, at the top level of a response or a chunk. In a stream it can appear on
  several chunks and is **cumulative, not per-chunk**, so the last non-empty one replaces the previous. It can
  ride on a chunk with no `candidates`, so the worker reads it **before** its candidates guard.
  `thoughtsTokenCount` is reported **separately** from `candidatesTokenCount` (the total is prompt + candidates +
  thoughts + tool use), so the extractor sets `output_tokens = candidates + thoughts`. `promptTokenCount` is
  documented as already including `cachedContentTokenCount`.
- **ollama** — the final chunk of `/api/chat` (`done === true`). `tokens_per_second` is derived from
  `eval_count / (eval_duration / 1e9)`, rounded to one decimal; a missing or zero duration yields `null`, never
  `Infinity` or `NaN`.
- **openai_comp** — `usage` on the response or the final streamed chunk, best effort. **A streamed response
  emits it only when the request includes `stream_options: { include_usage: true }`**, which `fetchResponse()`
  adds while streaming. Many compatible backends (llama.cpp, LM Studio, some OpenRouter models) ignore the
  parameter or never send `usage` — the request must still succeed and `extractUsage()` simply returns `null`.
  The usage frame is a frame with an **empty `choices` array**, so the worker reads it before its `choices`
  guard.

### Wiring in the workers

Each worker keeps the accumulated usage in a module-level `usageData`, reset at the start of every
`chatMessage`, and exposes it through `getUsageData()`.

The value is **never appended to the response text and never pushed into `conversationHistory`** — the text
callers receive is byte-identical to what it was before this layer existed, and no usage data is ever sent back
to the API on the next turn. That invariant is the whole contract; everything below only adds a display path.

Capture is logged through `taLog` (debug-gated), carrying the **provider, model and token counts only**. Never
log request URLs or headers: Gemini and some OpenAI-compatible endpoints carry the API key in the query string.

### Emitting to the chat window

`js/workers/usage-emitter.js` is the single place a worker hands its usage to the chat window. Each worker ends
a response in two or three different places (end of stream, user stop, a provider-specific terminal event) and
each of them posts `tokensDone`; routing the usage through one helper is what keeps those ten call sites from
drifting apart.

- `initUsageEmitter(event.data)` — called from the worker's `init` branch; reads the `chat_show_usage_data`
  flag the controller puts on the init message.
- `nextUsageMessageId()` — called once per response, next to the `usageData = null` reset, so the emitted id
  and the answer it belongs to agree.
- `postUsageData(usageData, usageMessageId)` — called immediately **before** every `postMessage({type:
  'tokensDone'})`.

The message is `{ type: 'usage', messageId, payload }`, **separate from `tokensDone` and carrying no text**.
Nothing is emitted when the option is off, when the provider reported nothing, or when `isUsageDataEmpty()` is
true — extraction and the debug log still run in all three cases.

Ordering matters: the usage is posted **before** `tokensDone` because the window stores the usage on the
turn that `tokensDone` then closes. Worker messages are delivered in order, so posting first is sufficient.

### Rendering in the chat window

`api_webchat/usageBadge.js` holds the whole display layer (`js/api/mzta-api-usage.js` must stay DOM-free). Two
levels, never duplicated: a **chip per answer** in its action bar, and a **session meter** above the input field.
The window header shows only the model and the API, never token counts. The guiding rule is **show only what
exists**: a null field is omitted entirely, never rendered as `0`, `—` or `n/a`; a reported `0` is printed.

**Duration.** `MessagesArea` measures it itself, from `appendUserMessage()` (every real prompt is appended just
before it is posted to the worker) to `handleTokensDone()`, with `performance.now()`. It is therefore available
for every provider, including an endpoint that reports no usage at all.

**Flow.** `handleUsageData()` only stores the usage on the open turn (`turn._mztaUsage`, once per turn) and folds
it into the session; it draws nothing. `handleTokensDone()` builds the chip from that usage plus the duration
(`_buildUsageChipForTurn()`, stored as `turn._mztaUsageChip`) **before** `addActionButtons()`, which places it
right after Copy. When the answer stops being the newest, `_buildTurnTools()` **moves** the same node into the
compact toolbar, so earlier answers keep their figures. If `addActionButtons()` bails out early, the chip gets
an `.action-bar` row of its own. Nothing is shown while streaming.

**Chip text**, first applicable: total → `711 tokens`; output only → `611 output tokens`; no tokens → the
duration, `3.4 s`. Numbers use `toLocaleString()` with the browser locale.

**Popover.** The chip is a button (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`) only when there is
detail beyond the duration; otherwise it is a static label and there is no popover. The popover sits above the
chip, left-aligned; it closes on a second click, on Esc (focus returns to the chip) and on a `pointerdown`
anywhere outside it (document-level listeners, `composedPath()` sees through the open shadow roots). At most one
is open window-wide. Rows, in order, each only if the value exists:

| Row | Field | Condition |
|---|---|---|
| Input | `input_tokens` | |
| &nbsp;&nbsp;of which cached | `cached_input_tokens` | input known |
| &nbsp;&nbsp;of which written to cache | `cache_creation_tokens` | input known |
| Output | `output_tokens` | |
| &nbsp;&nbsp;of which reasoning | `reasoning_tokens` | output known |
| **Total** | `total_tokens` | input or output known (the total alone would repeat the chip) |
| Duration | measured | some row above exists; `· N tok/s` appended when a rate exists |

The rate is `tokens_per_second` when the provider reports it (Ollama, generation phase only), otherwise
`output_tokens / (durationMs / 1000)` — a wall-clock figure that includes network and prompt processing.

The "of which" rows rely on the **subset invariant** of the normalized object (see
[Per-provider support](#per-provider-support)).

The chip lives in the action bar, a **sibling of the `.message` element — never inside it**. That placement is
the structural half of the guarantee that it cannot be picked up by anything that reads an answer back out of
the DOM; the `data-mzta-usage` attribute (`USAGE_MARKER_ATTR`), set on the chip and on the popover, is the other
half.

The extraction paths and why each is safe:

| Path | Source | Why the chip cannot reach it |
|---|---|---|
| Copy button | `fullTextHTMLAtAssignment` | An immutable string snapshotted at flush time, never read from the DOM |
| "Use this answer" / reply | same snapshot, or `picker.composeResultHTML()` | Same; the picker owns content handed to it, in its own shadow root |
| Save as summary | same snapshot | Same |
| Diff picker | same snapshot + `prompt_info` | Same |
| An explicit text selection | `getCurrentSelectionText()` | `user-select: none`, plus the chip's text is subtracted from `selection.toString()` if one was caught anyway |
| An explicit HTML selection | `getCurrentSelectionHTML()` | `_cloneSelectionWithoutUsage()` removes every `[data-mzta-usage]` node from the cloned range |

`getCurrentSelectionText()` deliberately still returns `selection.toString()` on the normal path rather than
`textContent` over the scrubbed clone: `toString()` inserts the line breaks between blocks that a bare
`textContent` would drop, and changing it would alter what the copy button produces for multi-paragraph
selections.

### Session meter

`#usageMeter` is the first child of the `<message-input>` shadow root, a full-width row above the textarea (the
host is `flex-wrap: wrap`). `MessagesArea` keeps the session state (`createSessionUsage()` /
`addUsageToSession()`):

- `total` — sum of every answer's `total_tokens`; null until one reports it.
- `context` — `input + output` of the **latest** answer (falling back to its total), i.e. what the next request
  resends: the workers resend the whole conversation history.

After every `tokensDone`, `controller.js` calls `messageInput.setUsageMeter(messagesArea.getUsageMeterState())`
(`buildUsageMeterState()`), never mid-stream. Three states:

- **bar** — context window known and `context` known: `Context 711 / 8,192 · 9%`. At **≥ 80%** the fill uses
  `--warn` and the text adds `— consider starting a new chat`. The track is `role="meter"` with its values.
- **text** — window unknown, session total known: `Session: 2,340 tokens`.
- **hidden** — no tokens in the session (also when the usage option is off).

The context window is **only what the provider or the configuration states — never a guess from a per-model
table**. `api_webchat/contextWindow.js` (`resolveContextWindow(integration, prefs)`, never throws, resolves to a
positive number or `null`) looks it up; `controller.js` runs it **once, after the first completed answer**, not
awaited, then calls `messagesArea.setContextWindow()` and repaints the meter (text until then, bar after):

| Provider | Source, most authoritative first |
|---|---|
| Ollama | `ollama_num_ctx` setting (> 0) → `/api/ps` `context_length` of the loaded model (`fetchRunningModels()`; the model is loaded once an answer came back, which is why the lookup waits for one) → `num_ctx` in the Modelfile `parameters` of `/api/show` → `model_info["<arch>.context_length"]` of `/api/show` (the model maximum; right for `:cloud` models, which `/api/ps` does not list). Tags match with Ollama's implicit `:latest`. |
| Gemini | `models.get` → `inputTokenLimit` (`GoogleGemini.fetchModelInfo()`) |
| Claude | `GET /v1/models/{id}` → `max_input_tokens` (`Anthropic.fetchModelInfo()`) |
| OpenAI, OpenAI-compatible | none exposed → always `null`, text state |

The floating status pill of `<message-input>` keeps its place on the textarea's top border whether or not the
meter is shown: the host's row gap (14px) equals the pill's upper half, so the meter row sits just above it.

One chat window is one chat, so a fresh window starts from a fresh accumulator and there is nothing to reset.

The **automatic features** (spam filter, tagging, …) have no chat UI and are unaffected: their usage stays in
the `taLog` debug output.

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
10. Export `supportsUsageData` and, when true, `extractUsage()` from the API module, add the connection type to `USAGE_DATA_SUPPORT` in `js/mzta-utils.js`, and accumulate the result in the worker — see [Token usage data](#token-usage-data) above
11. Wire the worker to `js/workers/usage-emitter.js`: `initUsageEmitter()` in the `init` branch, `nextUsageMessageId()` beside the `usageData` reset, and `postUsageData()` before **every** `tokensDone` — see [Emitting to the chat window](#emitting-to-the-chat-window) above
