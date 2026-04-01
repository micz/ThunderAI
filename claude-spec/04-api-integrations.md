# API Integrations

## Connection Types

The active AI provider is controlled by the `connection_type` preference. Possible values:

| `connection_type` value | Provider |
|------------------------|----------|
| `chatgpt_web` | ChatGPT Web (no API key, opens browser window) |
| `chatgpt_api` | OpenAI API (ChatGPT via API key) |
| `ollama_api` | Ollama (self-hosted LLM) |
| `openai_comp_api` | OpenAI-compatible API |
| `google_gemini_api` | Google Gemini API |
| `anthropic_api` | Claude (Anthropic) API |

The global default is `chatgpt_web`. Each special prompt (`add_tags`, `spamfilter`, etc.) can independently override this via its own `{prefix}_connection_type` pref.

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
- Pre-configured providers: `js/api/openai_comp_configs.js` (DeepSeek, Grok, Mistral, OpenRouter, Perplexity)

### Google Gemini (`google_gemini_api`)
- Module: `js/api/google_gemini.js`
- Worker: `js/workers/model-worker-google_gemini.js`
- Settings keys: `google_gemini_api_key`, `google_gemini_model`, `google_gemini_system_instruction`, `google_gemini_thinking_budget`, `google_gemini_temperature`

### Anthropic / Claude (`anthropic_api`)
- Module: `js/api/anthropic.js`
- Worker: `js/workers/model-worker-anthropic.js`
- Settings keys: `anthropic_api_key`, `anthropic_model`, `anthropic_version`, `anthropic_max_tokens`, `anthropic_system_prompt`, `anthropic_temperature`

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
