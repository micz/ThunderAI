# Prompts System

## Overview

Prompts are the core user-facing feature of ThunderAI. Each prompt defines an AI instruction and how it behaves. There are two kinds:

- **Built-in prompts** — defined in `js/mzta-prompts.js`
- **Custom prompts** — created by the user and stored in `browser.storage.local`

## Prompt Properties

### Base Properties (built-in only)

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | `__MSG_key__` i18n reference or plain text |
| `prompt` | string | The prompt template text (may contain `{%placeholder%}` tokens) |
| `type` | number | `0` = always visible, `1` = reading email only, `2` = composing only |
| `action` | number | `0` = close, `1` = reply (open compose), `2` = substitute text in-place |
| `need_selected` | number | `0` = use full message body, `1` = requires text selection |
| `need_signature` | number | `0` = no signature, `1` = include signature |
| `need_custom_text` | number | `0` = no custom input, `1` = show custom text input field |
| `define_response_lang` | number | `0` = no language hint, `1` = append response language instruction |
| `use_diff_viewer` | number | `0` = normal output, `1` = show diff viewer (ChatGPT Web only) |

### User Properties (stored per-prompt in storage)

| Property | Type | Description |
|----------|------|-------------|
| `enabled` | number | `0` = hidden, `1` = shown in popup |
| `position_display` | number | Sort order in reading view |
| `position_compose` | number | Sort order in compose view |

### Per-Prompt API Override Properties

Each prompt can override the global API connection. These mirror the keys in `integration_options_config` and `prefs_default`:

| Property | Description |
|----------|-------------|
| `connection_type` | Override API type for this prompt |
| `chatgpt_web_model` | Override ChatGPT Web model |
| `chatgpt_web_project` | Override ChatGPT Web project |
| `chatgpt_web_custom_gpt` | Override custom GPT |
| All `chatgpt_*`, `ollama_*`, `openai_comp_*`, `google_gemini_*`, `anthropic_*` keys | Override specific API settings |

## Special Prompts

Some prompts trigger additional Thunderbird actions beyond just sending text to the AI. They are identified by their `id`:

| ID | Feature |
|----|---------|
| `add_tags` | Auto-tag the email after AI response |
| `spamfilter` | Classify as spam and optionally move email |
| `summarize` | Summarize email content |
| `get_calendar_event` | Extract and create a calendar event |
| `get_task` | Extract and create a task |

These special prompts can have their own dedicated API integration settings (configured in the Options page). The list of these special prompts is in `options/mzta-options-default.js` as `special_prompts_with_integration`.

## Prompt Types Reference

```
type 0  → shown when reading AND composing
type 1  → shown only when reading an email (message display)
type 2  → shown only when composing an email
```

## Action Types Reference

```
action 0  → no output, just close (e.g. for tag/spam actions handled in background)
action 1  → open a reply compose window with AI response
action 2  → replace selected text (or insert) in compose window
```

## Adding a New Built-in Prompt

1. Add the prompt object to the `defaultPrompts` array in `js/mzta-prompts.js`
2. Add the `name` string key to `_locales/en/messages.json`
3. If the prompt text needs a localized string, add it to `_locales/en/messages.json` as well
4. Reference any needed placeholders using `{%placeholder_id%}` syntax in the `prompt` field

## Custom Prompts

Custom prompts are stored in `browser.storage.local` and managed via `pages/customprompts/`. They follow the same property structure as built-in prompts but are created/edited/deleted by the user through the UI. Custom placeholders can also be referenced in custom prompt text.
