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
| `text` | string | The prompt template text — usually an i18n key (e.g. `prompt_reply_full_text`); may contain `{%placeholder%}` tokens |
| `type` | string | `"0"` = always visible, `"1"` = reading email only, `"2"` = composing only |
| `action` | string | `"0"` = close, `"1"` = reply (open compose), `"2"` = substitute text in-place |
| `need_selected` | string | `"0"` = use full message body, `"1"` = requires text selection |
| `need_signature` | string | `"0"` = no signature, `"1"` = include signature |
| `need_custom_text` | string | `"0"` = no custom input, `"1"` = show custom text input field |
| `define_response_lang` | string | `"0"` = no language hint, `"1"` = append response language instruction |
| `use_diff_viewer` | string | `"0"` = normal output, `"1"` = offer a diff of the answer against the original text. On the API paths this is the interactive change picker — see [07-diff-picker.md](07-diff-picker.md); on ChatGPT Web it is a separate read-only diff. Only selectable when `action` is `"2"` |
| `diff_granularity` | string | Comparison unit of the change picker; only meaningful when `use_diff_viewer` is `"1"`. `""` = inherit the global `diff_granularity` preference, `"words"`, `"sentences"`. Same "inherit from global" convention as `api_type` — see [07-diff-picker.md](07-diff-picker.md) |

> **Note:** These numeric-looking properties are stored as **strings** (`"0"`/`"1"`/`"2"`) in the prompt objects in `js/mzta-prompts.js`, not as JS numbers. The prompt body lives in the `text` property (there is no `prompt` property).

> **Reachability:** The popup and context menus are the only ways to invoke a prompt (the keyboard shortcut just opens the popup, which re-filters by `show_in`). Reachability is therefore fully determined by `show_in`: a prompt with `show_in === "none"` is in no menu and cannot be invoked. The old `enabled` (0/1) flag was removed — it was redundant with `show_in === "none"`. `getPrompts(onlyReachable = true, ...)` filters out prompts with `show_in === "none"`. See the `migrateEnabledToShowIn()` migration below for the one-time conversion of legacy data.

### User Properties (stored per-prompt in storage)

| Property | Type | Description |
|----------|------|-------------|
| `position_display` | number | Sort order for the popup menu in reading view |
| `position_compose` | number | Sort order for the popup menu in compose view |
| `position_context` | number | Sort order for the context menu |
| `show_in` | string | `"popup"` = popup only, `"context"` = context menu only, `"both"` = both, `"none"` = in no menu (unreachable). Default: `"popup"` for default/custom prompts, `"both"` for special prompts. **`show_in` is the single source of truth for reachability** — there is no separate enabled/disabled flag. |
| `custom_icon` | string | Filename (with extension) of an icon in `images/context_menu/custom/` used as the context-menu icon. Empty string = no icon. Only used for non-special prompts (special prompts use their hard-coded icons in `specialPromptToContextMenuID`). Selectable from a dropdown on the Menu Order page, context-menu tab. |
| `diff_granularity` | string | Per-prompt override of the change-picker comparison unit (see the base-properties table above). Editable on default prompts, so it persists through the whitelist triple below. |

> **Adding a user-editable property to a DEFAULT prompt requires editing three places**, or the value
> is silently dropped on save. Default prompts do not persist their whole object — only an explicit
> whitelist of fields:
>
> 1. `setDefaultPromptsProperties()` — the write side; the field must be listed or it is never stored
> 2. `getDefaultPrompts_withProps()` — the read side; without it the saved value is never loaded back
> 3. `preparePromptsForExport()` — the `allowedKeys` allow-list for `is_default == 1` prompts, or the
>    field does not survive export/import
>
> Custom prompts are different: their whole object is stored, so they only need a default in the
> `getCustomPrompts()` migration chain (`undefined` → the inherit value).

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
- **Hidden items**: inactive for the menu (`show_in` excludes the menu), sorted alphabetically

**Row badges** — each row shows two colored badges (rendered in `renderListItems()`): a **type** badge (`.badge_type`) with the value Always / Reading / Composing (from `type` `0`/`1`/`2`), and a **source** badge with the value Default / Special / Custom (`.badge_default` / `.badge_special` / `.badge_custom`, from `is_default` / `is_special`). A static **legend** near the top of the page (`#badge_legend` in the HTML) explains both badge groups; it reuses the same badge CSS classes and i18n labels so its swatches match the rows automatically.

**Show/hide** — a prompt's `show_in` is changed by **dragging a row between the Visible and Hidden sections** of the same menu panel, routed through the `computeShowIn(current, menuType, isOn)` transition table:
- Popup ON: `"none"` → `"popup"`, `"context"` → `"both"`
- Popup OFF: `"popup"` → `"none"`, `"both"` → `"context"`
- Context ON: `"none"` → `"context"`, `"popup"` → `"both"`
- Context OFF: `"context"` → `"none"`, `"both"` → `"popup"`

Both sections are draggable and act as drop targets; the section the row lands in determines whether that menu is turned on (dropped into Visible) or off (dropped into Hidden). Dropping back into Visible also captures the drop position.

**Hidden everywhere** — the `show_in` change is applied via `setPromptShowIn(prompt, newShowIn)`, which only sets `prompt.show_in`. A prompt with `show_in === "none"` is in no menu (unreachable), while its full configuration is preserved. A non-special prompt with `show_in === "none"` appears in the **Hidden section of both panels** (popup and context), dimmed, so it can be dragged back into any menu — this is the recovery path. There is no separate "disabled" state or badge.

**Drag and drop (reorder)** — native HTML5 DnD assigns sequential position numbers (1, 2, 3, ...) to `position_display`, `position_compose`, or `position_context`. Positions are only meaningful for the Visible section; reordering within Hidden has no effect. During the drag the other rows are **not** reordered live: the dragged node stays in place (dimmed) and only an insertion indicator line is shown (top edge of the target row, or bottom edge of the last row when dropping at the end); the actual DOM move happens once on `drop`. This avoids the sluggishness of moving the node on every `dragover` tick.

**Exclusions from the UI** (preserved on save so data is not lost):
- Special prompts whose base definition has `show_in: "none"` (internal prompts like `prompt_summarize_email_template` and `prompt_summarize_email_separator`) — retrieved via `getHiddenSpecialPromptIds()`
- Special prompts whose feature is not active — retrieved from background via `get_active_special_ids` message, which calls `getActiveSpecialPromptsIDs()` with current prefs and `_sparks_presence`

**Cross-tab reload** — the page listens on `browser.storage.onChanged` for changes to `_default_prompts_properties`, `_custom_prompt`, or `_special_prompts`. When one of those keys changes (e.g. user saves from the Custom Prompts page in another tab), the page reloads its data with a 200ms debounce. Any unsaved local changes are discarded to avoid overwriting the other page's work.

**Save flow**:
1. Re-concat preserved prompts (hidden-specials + inactive-feature specials) with the UI-visible prompts
2. Split by `is_default` / `is_special` and call `setDefaultPromptsProperties()`, `setCustomPrompts()`, `setSpecialPrompts()`
3. Send `reload_menus` to the background to rebuild both menus

**"Menu position" deep-link** — the Custom Prompts editor (see [05-options.md](05-options.md)) has a per-row **Menu position** button (`revealPromptInMenuOrder(promptId)` in `js/mzta-utils.js`), located in the row's "Add to menu" cell (pinned to the bottom of the cell, below the Type/Action selectors, via a `.menu_cell_inner` flex column), that opens/focuses the Menu Order page and highlights every instance of that prompt. If the tab is already open, a `menu_order_highlight` runtime message tells the page to reload then highlight (sequencing the reload before the highlight, and cancelling the pending `storage.onChanged` debounce so it does not wipe the highlight). If the tab is not open, the target id is stashed in `browser.storage.session` under `menu_order_highlight_target` and picked up (read-and-deleted) after the page's initial load. The highlight (blue outline) is applied via `highlightPrompt()` / module-state `highlightTargetId` and re-applied on every render so it survives sub-tab switches and re-renders. It **persists** until another `highlightPrompt()` targets a different prompt or a drag starts (`clearHighlight()` on `dragstart`) — it does not time out. A background pulse plays briefly on entry as a visual cue.

**Sub-tab awareness of the deep-link** — only one popup sub-tab is in the DOM at a time, so the highlight target may live in the inactive one. `promptInPopupView(prompt, view)` is the single source of truth for "does this prompt appear in this view" (reading → types `0`+`1`, composing → types `0`+`2`) and is used both by `renderPopupList()` and by the deep-link logic:

- **Auto-switch** — if the target is not present in `currentPopupView` but is present in the other view, `highlightPrompt()` calls `setPopupView()` to switch before rendering. This covers a composing-only prompt (`type: "2"`) deep-linked while Reading is active — previously it produced no visible feedback at all, since such prompts are also excluded from the context panel — and the mirror case of a reading-only prompt with the page already open on Composing. Because `renderListItems()` rebuilds the `<li>`, the pulse animation restarts on the newly shown row. The switch happens only on the deep-link path, never on a normal render or on the `storage.onChanged` reload.
- **Inactive-tab dot** — `applyTabDots()` (called from `applyHighlight()`, so it shares the highlight's exact lifetime) puts a dot on any sub-tab that is *not* the current one and that contains the highlighted prompt, with the `menu_order_tab_dot_tooltip` title. In practice this fires for `type: "0"` (Always) prompts, which are present in both views. The dot is the `.sub_tab.mzta_has_target::after` pseudo-element; the `::after` slot is always rendered (transparent when unused) so toggling it does not shift the tab width.

### Alphabetic-to-Position Migration

The `dynamic_menu_order_alphabet` preference (previously a user-facing option) has been retired and removed from the UI, but the key still exists in storage as a one-shot migration flag. At every background startup, `migrateMenuOrderAlphabetic()` in `js/mzta-prompts.js` runs:

1. Reads `dynamic_menu_order_alphabet` (defaults to `true` if unset)
2. If `true`: sorts all visible prompts with special prompts first (alphabetically), then the rest (alphabetically), and assigns sequential `position_display` = `position_compose` = `position_context` numbers. Hidden special prompts are preserved untouched.
3. Persists the new positions via `setDefaultPromptsProperties` / `setCustomPrompts` / `setSpecialPrompts`
4. Sets `dynamic_menu_order_alphabet = false` in sync storage so the migration does not run again

This ensures existing users upgrading from the previous alphabetical-default behaviour get the same visible ordering on first run, while subsequent launches keep whatever custom ordering the user has set.

### Enabled-to-show_in Migration

The `enabled` prompt flag was removed (`show_in` is now the single source of truth). `migrateEnabledToShowIn()` in `js/mzta-prompts.js` runs once at background startup (after the sync→local storage-relocation migrations), guarded by the one-shot sync flag `_migrated_enabled_to_showin`. Across all three stores (`_default_prompts_properties`, `_custom_prompt`, `_special_prompts`) it applies `normalizeEnabledToShowIn()` to every prompt:

- if `enabled` is `0`/`"0"` → set `show_in = "none"` (the previous `show_in`, if any, is intentionally discarded — "off" collapses to "none"), then delete `enabled`
- otherwise (`1`/`"1"`/absent) → just delete `enabled`

It is idempotent: the flag short-circuits reruns, and after it runs no `enabled` keys remain. The same `normalizeEnabledToShowIn()` is also applied by `preparePromptsForImport()` so legacy backups carrying `enabled === 0` import as `show_in === "none"`; `enabled` is never emitted on export.

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
