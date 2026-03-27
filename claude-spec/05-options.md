# Options & Settings System

## Overview

All extension preferences are stored in `browser.storage.local`. Defaults and the full list of valid keys are defined in `options/mzta-options-default.js`.

## Key Exports from `mzta-options-default.js`

| Export | Description |
|--------|-------------|
| `prefs_default` | All preference keys with their default values |
| `integration_options_config` | Per-provider API settings structure |
| `getDynamicSettingsDefaults(keysFilter)` | Returns per-special-prompt integration defaults |
| `getDynamicSettingValue(prefs, prefix, settingName)` | Reads a prefixed setting for a special prompt |

## Settings Structure

### Global Integration Settings

Stored flat in `prefs_default` with `{provider}_{key}` naming:

```
chatgpt_api_key, chatgpt_model, chatgpt_developer_messages, chatgpt_temperature, chatgpt_store
ollama_host, ollama_model, ollama_num_ctx, ollama_temperature, ollama_think
openai_comp_host, openai_comp_model, openai_comp_api_key, openai_comp_use_v1, openai_comp_chat_name, openai_comp_temperature
google_gemini_api_key, google_gemini_model, google_gemini_system_instruction, google_gemini_thinking_budget, google_gemini_temperature
anthropic_api_key, anthropic_model, anthropic_version, anthropic_max_tokens, anthropic_system_prompt, anthropic_temperature
```

Plus the global connection selector:
```
connection_type   (default: 'chatgpt_web')
use_specific_integration   (default: false)
```

### Special Prompt Integration Overrides

The 5 special prompts (`add_tags`, `spamfilter`, `summarize`, `get_calendar_event`, `get_task`) each get their own `use_specific_integration` and `connection_type` keys:

```
{prefix}_use_specific_integration   (default: false)
{prefix}_connection_type            (default: 'chatgpt_api')
```

These are generated programmatically at the bottom of `mzta-options-default.js` using `special_prompts_with_integration` array.

### UI & Feature Preferences

| Key | Default | Description |
|-----|---------|-------------|
| `do_debug` | `false` | Enable debug logging |
| `chatgpt_win_height` | `800` | ChatGPT window height |
| `chatgpt_win_width` | `700` | ChatGPT window width |
| `chatgpt_win_top` | `''` | Window top position |
| `chatgpt_win_left` | `''` | Window left position |
| `chatgpt_win_save_position` | `false` | Remember window position |
| `default_chatgpt_lang` | `''` | Force response language |
| `default_sign_name` | `''` | Default signature name |
| `reply_type` | `'reply_all'` | Default reply type |
| `composing_plain_text` | `false` | Use plain text in compose |
| `chatgpt_web_model` | `''` | ChatGPT Web model override |
| `chatgpt_web_tempchat` | `false` | Use temporary chat |
| `chatgpt_web_project` | `''` | ChatGPT Web project |
| `chatgpt_web_custom_gpt` | `''` | Custom GPT URL |
| `chatgpt_web_load_wait_time` | `1000` | Wait time (ms) for ChatGPT page |
| `dynamic_menu_force_enter` | `false` | Force Enter to submit in popup |
| `dynamic_menu_order_alphabet` | `true` | Sort prompts alphabetically |
| `placeholders_use_default_value` | `false` | Use placeholder defaults when empty |
| `max_prompt_length` | `30000` | Max prompt string length |

### Feature Flags

| Key | Default | Description |
|-----|---------|-------------|
| `add_tags` | `false` | Enable auto-tagging feature |
| `add_tags_maxnum` | `3` | Max tags to apply |
| `add_tags_hide_exclusions` | `false` | Hide excluded tags from menu |
| `add_tags_exclusions_exact_match` | `false` | Exact match for exclusions |
| `add_tags_first_uppercase` | `true` | Capitalize first letter of tags |
| `add_tags_force_lang` | `true` | Force language for tags |
| `add_tags_auto` | `false` | Auto-tag on message open |
| `add_tags_auto_force_existing` | `false` | Only use existing tags |
| `add_tags_auto_only_inbox` | `true` | Auto-tag only inbox messages |
| `add_tags_auto_uselist` | `false` | Use tag allow-list |
| `add_tags_auto_uselist_list` | `''` | Tag allow-list content |
| `add_tags_enabled_accounts` | `[]` | Accounts where auto-tag is active |
| `get_calendar_event` | `true` | Enable calendar event extraction |
| `get_calendar_event_from_clipboard` | `false` | Enable calendar from clipboard |
| `get_task` | `true` | Enable task creation |
| `calendar_enforce_timezone` | `false` | Force specific timezone |
| `calendar_timezone` | `''` | Timezone to enforce |
| `calendar_no_selection` | `false` | Skip selection prompt |
| `spamfilter` | `false` | Enable spam filter |
| `spamfilter_threshold` | `70` | Spam confidence threshold (%) |
| `spamfilter_enabled_accounts` | `[]` | Accounts where spam filter is active |
| `spamfilter_show_msg_panel` | `true` | Show info panel on spam detection |
| `summarize` | `false` | Enable email summarization |
| `summarize_auto` | `1` | Auto-summarize mode: `0` = disabled, `1` = manual (show "click to generate" button), `2` = automatic (generate on message open) |
| `summarize_display_mode` | `'inline'` | Where to display summaries: `'inline'` = message pane banner, `'webchat'` = AI chat window. Note: `summarize_auto = 2` always uses inline regardless of this setting. |
| `summarize_max_display_length` | `0` | Maximum characters shown in inline summary before truncation. `0` = no limit (show full text). When set, text is truncated at a word boundary and a "See more"/"See less" toggle link is shown. |

### Summarize Settings Page (`pages/summarize/`)

The summarize settings page provides:

1. **Specific integration checkbox** — enables per-feature API override (like other special prompts)
2. **Auto-summarize dropdown** (`summarize_auto`) — three modes:
   - `0` (Disabled) — no inline summaries
   - `1` (Manual) — shows a "Click to generate summary" button in message display
   - `2` (Automatic) — generates summary immediately when message is opened
3. **Display mode dropdown** (`summarize_display_mode`) — controls where summaries are shown:
   - `'inline'` — summary banner in the message pane (default)
   - `'webchat'` — opens the AI chat window
   - Note: `summarize_auto = 2` always generates inline regardless of this setting. Context menu summarize with multiple messages always falls back to webchat.
4. **Max display length** (`summarize_max_display_length`) — number input, limits inline summary text to N characters. `0` = no limit. When truncated, a "See more"/"See less" toggle link is appended.
5. **Three editable prompts** (used by context menu summarize and webchat mode):
   - Summarize instruction prompt (`prompt_summarize`)
   - Email template prompt (`prompt_summarize_email_template`)
   - Email separator prompt (`prompt_summarize_email_separator`)
   - Each has Save/Reset buttons and placeholder autocomplete
   - Default text comes from i18n strings (`prompt_summarize_full_text`, etc.)

## Adding a New Preference

1. Add the key and default value to `prefs_default` in `options/mzta-options-default.js`
2. Add UI control to `options/mzta-options.html`
3. Add load/save logic to `options/mzta-options.js`
4. Add i18n label to `_locales/en/messages.json`
5. Read the pref in the relevant module via `browser.storage.local.get()`

## Reading Preferences at Runtime

```javascript
const prefs = await browser.storage.local.get(prefs_default);
// prefs now contains all keys with defaults for any unset values
const myPref = prefs.my_new_pref;
```
