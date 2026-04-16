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
| `enabled` | number | `0` = hidden, `1` = shown in menus |
| `position_display` | number | Sort order for the popup menu in reading view |
| `position_compose` | number | Sort order for the popup menu in compose view |
| `position_context` | number | Sort order for the context menu |
| `show_in` | string | `"popup"` = popup only, `"context"` = context menu only, `"both"` = both, `"none"` = hidden from all menus. Default: `"popup"` for default/custom prompts, `"both"` for special prompts |
| `custom_icon` | string | Filename (with extension) of an icon in `images/custom_menu/` used as the context-menu icon. Empty string = no icon. Only used for non-special prompts (special prompts use their hard-coded icons in `specialPromptToContextMenuID`). Selectable from a dropdown on the Menu Order page, context-menu tab. |

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
| `translate` | Translate email content into a target language |

These special prompts can have their own dedicated API integration settings (configured in the Options page). The list of these special prompts is in `options/mzta-options-default.js` as `special_prompts_with_integration`.

## Menu System

### Popup Menu
- Displays prompts filtered by `show_in` (`"popup"` or `"both"`) and by tab context (`type` property: reading view shows types `0`+`1`, compose view shows types `0`+`2`)
- Ordering: always position-based using `position_display` (reading view) or `position_compose` (compose view). Alphabetical ordering has been removed
- Special prompts retain their colored background (CSS class `special_prompt`) in the popup based on `is_special == "1"`

### Context Menu
- Dynamically built from all prompts with `show_in` set to `"context"` or `"both"`, filtered to reading types only (`type` 0 or 1)
- Appears as a "ThunderAI" submenu in the `message_list` context
- Ordering: position-based using `position_context` (fallback to alphabetical only when positions are equal)
- Special prompts (add_tags, spamfilter, summarize, translate) route through `processEmails()` for batch processing; regular prompts execute via `menus.executeMenuAction()`
- Icons: special prompts use dedicated icons (defined in `contextMenuIconsPath`); all other prompts use the addon icon (`images/icon-32.png`)
- Add Tags in context menu assigns tags automatically (`addTagsAuto: true`), while in the popup it shows the interactive tag selection form

### Menu Order Page (`pages/menu_order/`)

Dedicated page for reordering, enabling, and disabling menu items across both the popup and the context menu. Opened from the options page via the "Menu Order" button.

**UI layout** — two side-by-side panels:
- **Popup Menu panel**: sub-tabs for "Reading" / "Composing" switch the list between `position_display` / `position_compose` ordering and between the allowed types (`0`+`1` vs `0`+`2`)
- **Context Menu panel**: single list ordered by `position_context`. Items with `type: "2"` (composing-only) are never shown here

Each list has two sections:
- **Visible items**: active for the menu (`show_in` includes the menu), draggable to reorder
- **Hidden items**: inactive for the menu (`show_in` excludes the menu), sorted alphabetically, not draggable

**Toggle coordination** — flipping the checkbox updates the prompt's `show_in` with four-state logic:
- Popup ON: `"none"` → `"popup"`, `"context"` → `"both"`
- Popup OFF: `"popup"` → `"none"`, `"both"` → `"context"`
- Context ON: `"none"` → `"context"`, `"popup"` → `"both"`
- Context OFF: `"context"` → `"none"`, `"both"` → `"popup"`

**Drag and drop** — native HTML5 DnD assigns sequential position numbers (1, 2, 3, ...) to `position_display`, `position_compose`, or `position_context` depending on which list is being sorted.

**Exclusions from the UI** (preserved on save so data is not lost):
- Prompts with `enabled === 0` (disabled)
- Special prompts whose base definition has `show_in: "none"` (internal prompts like `prompt_summarize_email_template` and `prompt_summarize_email_separator`) — retrieved via `getHiddenSpecialPromptIds()`
- Special prompts whose feature is not active — retrieved from background via `get_active_special_ids` message, which calls `getActiveSpecialPromptsIDs()` with current prefs and `_sparks_presence`

**Cross-tab reload** — the page listens on `browser.storage.onChanged` for changes to `_default_prompts_properties`, `_custom_prompt`, or `_special_prompts`. When one of those keys changes (e.g. user saves from the Custom Prompts page in another tab), the page reloads its data with a 200ms debounce. Any unsaved local changes are discarded to avoid overwriting the other page's work.

**Save flow**:
1. Re-concat preserved prompts (disabled + hidden-specials + inactive-feature specials) with the UI-visible prompts
2. Split by `is_default` / `is_special` and call `setDefaultPromptsProperties()`, `setCustomPrompts()`, `setSpecialPrompts()`
3. Send `reload_menus` to the background to rebuild both menus

### Alphabetic-to-Position Migration

The `dynamic_menu_order_alphabet` preference (previously a user-facing option) has been retired and removed from the UI, but the key still exists in storage as a one-shot migration flag. At every background startup, `migrateMenuOrderAlphabetic()` in `js/mzta-prompts.js` runs:

1. Reads `dynamic_menu_order_alphabet` (defaults to `true` if unset)
2. If `true`: sorts all visible prompts with special prompts first (alphabetically), then the rest (alphabetically), and assigns sequential `position_display` = `position_compose` = `position_context` numbers. Hidden special prompts are preserved untouched.
3. Persists the new positions via `setDefaultPromptsProperties` / `setCustomPrompts` / `setSpecialPrompts`
4. Sets `dynamic_menu_order_alphabet = false` in sync storage so the migration does not run again

This ensures existing users upgrading from the previous alphabetical-default behaviour get the same visible ordering on first run, while subsequent launches keep whatever custom ordering the user has set.

### Special Prompt Visibility Dependencies

`getActiveSpecialPromptsIDs()` in `js/mzta-utils.js` maps feature prefs to active special prompt IDs. Notable dependency:

- `prompt_get_calendar_event_from_clipboard` is emitted only if **both** `get_calendar_event` and `get_calendar_event_from_clipboard` are active. If `get_calendar_event` is off, neither calendar prompt is shown regardless of the clipboard pref.

### Summarize: Dual-Mode Prompt System

The summarize feature uses two distinct prompt pathways:

**Context Menu Summarize** (right-click on messages in message list):
- Activated via the `summarize` context menu item, controlled by the `summarize` feature flag
- Uses 3 special prompts stored in `specialPrompts`:
  - `prompt_summarize` — the main instruction prompt for the LLM
  - `prompt_summarize_email_template` — template for formatting each email's content
  - `prompt_summarize_email_separator` — separator text between multiple emails
- Supports multi-email summarization: each selected message is formatted with the email template, joined by the separator, then prepended with the instruction prompt
- All 3 prompts support placeholder autocomplete (`{%placeholder%}` syntax)
- Result is displayed via `openChatGPT()` in the standard chat output window (not inline)
- Default prompt texts are stored as i18n keys: `prompt_summarize_full_text`, `prompt_summarize_email_template_full_text`, `prompt_summarize_email_separator_full_text`

**Inline Summary on Message Display** (automatic or manual per `summarize_auto` pref):
- Uses the same 3 special prompts as webchat mode, via `taPromptUtils.buildSummaryPrompt()` in `js/mzta-utils-prompt.js`
- Does **not** support `chatgpt_web` connection type (shows error if configured)
- Result is rendered as a styled banner at the top of the message body via `mzta-compose-script.js`
- Banner includes a refresh button (↻) to regenerate the summary
- Cached per-message via `taSummaryStore` / `taStorage` (max 100 entries)

**Unified Prompt Building** — `taPromptUtils.buildSummaryPrompt(messageDataArray)`:
- All summary paths (inline, webchat single, webchat multi) use this single method
- Accepts an array of `{ message, fullMessage }` entries
- Returns `{ promptText, promptInfo }` where `promptInfo` is the `prompt_summarize` prompt object

### Translate: Inline-Only Prompt System

The translate feature uses a single special prompt (`prompt_translate_this`) for translating emails. Translation always renders inline (no webchat mode).

**Inline Translation on Message Display** (controlled by `translate_auto` pref):
- Uses a single special prompt: `prompt_translate_this`
- The prompt uses placeholders (`{%mail_subject%}`, `{%mail_html_body%}`, `{%thunderai_translate_lang%}`, `{%thunderai_translate_exclude_lang%}`) resolved via the standard placeholder system
- The AI response is a JSON object: `{ "subject": "...", "body": "...", "status": "1"|"-1" }`
  - `status = "1"`: translation completed, subject and body are displayed
  - `status = "-1"`: translation skipped (excluded/target language), a "skipped" message is shown
- Target language is determined by `translate_lang` pref, falling back to `default_chatgpt_lang`
- Does **not** support `chatgpt_web` connection type (shows error if configured)
- Result is rendered as a styled banner (green/teal theme) in the message body via `mzta-compose-script.js`
- Banner includes refresh (↻) and delete (×) buttons
- Cached per-message via `taTranslationStore` / `taStorage` (max 100 entries)
- The prompt was originally a regular prompt (`defaultPrompts`) and was moved to `specialPrompts` with `is_special: "1"` and `type: "1"` (reading email only)

**Prompt Building** — `taPromptUtils.buildTranslationPrompt(fullMessage)`:
- Retrieves the `prompt_translate_this` special prompt text
- Resolves placeholders via `placeholdersUtils.getPlaceholdersValues()` + `replacePlaceholders()`
- Returns `{ promptText, promptInfo }`

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
