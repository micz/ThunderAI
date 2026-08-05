# Options & Settings System

## Overview

Extension preferences are stored in `browser.storage.sync` (not `.local`) — defaults and the full list of valid keys are defined in `options/mzta-options-default.js`. A handful of large-payload keys (`_custom_prompt`, `_default_prompts_properties`, `_special_prompts`, `_custom_placeholder`, `add_tags_exclusions`) live in `browser.storage.local` instead, since `storage.sync` has a narrow quota — see [01-architecture.md](01-architecture.md#storage) for the sync→local migration.

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
ollama_host, ollama_model, ollama_num_ctx, ollama_temperature, ollama_think, ollama_format_json
openai_comp_host, openai_comp_model, openai_comp_api_key, openai_comp_use_v1, openai_comp_chat_name, openai_comp_temperature
google_gemini_api_key, google_gemini_model, google_gemini_system_instruction, google_gemini_thinking_budget, google_gemini_temperature
anthropic_api_key, anthropic_model, anthropic_version, anthropic_max_tokens, anthropic_system_prompt, anthropic_temperature, anthropic_extended_thinking_budget
```

Plus the global connection selector:
```
connection_type   (default: '' — no connection selected yet)
use_specific_integration   (default: false)
```

**No connection selected (default).** `connection_type` intentionally defaults to the **empty
string**: a new user is not given a provider they never chose. Instead the three entry points
(popup, welcome page, options page) show a **blue** banner inviting them to run the
[Setup Wizard](#setup-wizard-pagessetup-wizard). The shared predicate is
`hasNoConnectionSelected(connection_type)` (`js/mzta-utils.js`) — use it instead of comparing to
`''` inline. Consequences of the empty state:

- **No special prompt is advertised.** `getActiveSpecialPromptsIDs()` takes a `no_connection` flag
  and returns an empty list when set; every call site in `mzta-background.js` passes it next to the
  existing `is_chatgpt_web`. Without this, an empty type would read as "some API is configured"
  (every check compares only against `chatgpt_web`) and would surface features that cannot run.
- **The connection select shows a placeholder.** `populateConnectionTypeOptions()`
  (`pages/_lib/connection-ui.js`) prepends a **disabled** `<option value="">`
  (`prefs_Connection_type_none`) for the *global* select only — the per-prompt selects
  (`no_chatgpt_web: true`) already use an empty value to mean "inherit the global connection".
  The placeholder is required because the select otherwise has no empty option, so an empty pref
  would display the first provider (ChatGPT Web) and saving would silently persist it.
  Accordingly `restoreOptions()` in `options/mzta-options.js` no longer falls back to
  `'chatgpt_web'`, and its `selectedIndex = -1` branch excludes `connection_type`.
- **Custom prompts require a specific integration**, exactly as with `chatgpt_web`
  (`connection-ui.js`, the `use_specific_integration` force-check).
- **The API-driven features are shown as unavailable**, but for a *different reason* than with
  `chatgpt_web` — see "Feature Rows — Disabled vs. API-Needed" below. `disable_GetCalendarEvent()`
  (which also covers `get_task`) and `disable_MaxPromptLength()` apply the same "ChatGPT Web or
  nothing selected" rule to the raw select value; the two Sparks rows already hide themselves
  entirely when disabled, and their `no_sparks` message is about Sparks, not about ChatGPT Web.
- **Running a prompt alerts the user.** The `default:` case of `openChatGPT()`
  (`mzta-background.js`) distinguishes "no connection" from "unknown type" and sends
  `msg_no_connection_selected` via `sendAlert` instead of only logging.
- **The red permission banners are unaffected**: they are keyed on an explicitly chosen
  `chatgpt_web` / `anthropic_api` / `chatgpt_api`, so none of them can fire in the empty state.

Existing installs are unaffected — the empty default only applies to users who never saved the pref.

### Special Prompt Integration Overrides

The 6 special prompts (`add_tags`, `spamfilter`, `summarize`, `get_calendar_event`, `get_task`, `translate`) each get their own `use_specific_integration` and `connection_type` keys:

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
| `dynamic_menu_order_alphabet` | `true` | Internal migration flag only; no UI. **Not declared in `prefs_default`** — unlike every other preference, its default (`true`) is hardcoded in the `browser.storage.sync.get()` call in `js/mzta-prompts.js`, not in `options/mzta-options-default.js`. Set to `false` by `migrateMenuOrderAlphabetic()` on first boot after upgrade to bootstrap position-based ordering. See `claude-spec/02-prompts.md` for details. |
| `placeholders_use_default_value` | `false` | Use placeholder defaults when empty |
| `hide_thinking` | `true` | Controls the initial state of the thinking `<details>` block prepended above the answer: `true` = collapsed by default, `false` = open by default. The user can always toggle with a click; thinking content is never discarded. |
| `diff_granularity` | `'words'` | Comparison unit the proofreading change picker **opens with**: `'words'` or `'sentences'`. The picker's own toolbar toggle changes it for the current review; there is no per-prompt override — see [07-diff-picker.md](07-diff-picker.md). Rendered as a `<select>` in the advanced section; needs an explicit entry in `restoreOptions()`'s `select-one` branch, since a select restoring to `''` would render blank. |
| `max_prompt_length` | `30000` | Max prompt string length |
| `special_command_timeout` | `120000` | Timeout (ms) before a hung special-command API worker is aborted (`js/mzta-special-commands.js`). Exposed in the main options page as a number input; **always shown** (not hidden for ChatGPT Web), because a single special prompt may use a specific API even when the global `connection_type` is `chatgpt_web`. Has no effect on ChatGPT Web connections, which use no API worker. |

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
| `calendar_timezone` | `''` | IANA timezone id to enforce (see note below) |
| `calendar_no_selection` | `false` | Skip selection prompt |
| `spamfilter` | `false` | Enable spam filter |
| `spamfilter_threshold` | `70` | Spam confidence threshold (%) |
| `spamfilter_enabled_accounts` | `[]` | Accounts where spam filter is active |
| `spamfilter_show_msg_panel` | `true` | Show info panel on spam detection |
| `spamfilter_only_inbox` | `false` | Auto spam filter runs only on inbox messages |
| `summarize` | `false` | Enable email summarization |
| `summarize_auto` | `1` | Auto-summarize mode: `0` = disabled, `1` = manual (show "click to generate" button), `2` = automatic (generate on message open), `3` = generate on email receive (background pre-cache via `onNewMailReceived`, no UI during generation) |
| `summarize_display_mode` | `'inline'` | Where to display summaries: `'inline'` = message pane banner, `'webchat'` = AI chat window. Note: `summarize_auto = 2` and `summarize_auto = 3` always use inline regardless of this setting. |
| `summarize_max_display_length` | `0` | Maximum characters shown in inline summary before truncation. `0` = no limit (show full text). When set, text is truncated at a word boundary and a "See more"/"See less" toggle link is shown. |
| `summarize_max_messages` | `20` | Maximum number of messages summarized at once in webchat mode. Above this limit `processEmails()` (`mzta-background.js`) blocks the operation and shows the `summarize_too_many_messages` warning. `0` = no limit. Only applies to the webchat/multi-message flow; inline single-message summaries are unaffected. Exposed in the summarize settings page. |
| `summarize_strip_formatting` | `false` | Strip HTML and Markdown formatting from AI-generated summaries, showing plain text only. |
| `translate` | `true` | Enable email translation |
| `translate_auto` | `0` | Auto-translate mode: `0` = disabled, `1` = manual (show button), `2` = automatic (translate on message open), `3` = generate on email receive (background pre-cache via `onNewMailReceived`, no UI during generation) |
| `translate_max_display_length` | `0` | Maximum characters shown in inline translation before truncation. `0` = no limit (show full text). When set, text is truncated at a word boundary and a "See more"/"See less" toggle link is shown. |
| `translate_lang` | `''` | Target language for translation. Falls back to `default_chatgpt_lang` if empty. |

### Timezone Select (`pages/_lib/mzta-timezones.js`)

The timezone `<select>` shown on the Calendar Event (`pages/get-calendar-event/`) and Task
(`pages/get-task/`) pages is **not** hardcoded in the HTML. Both pages ship an empty
`<select id="calendar_timezone" class="option-input">` containing only the empty option, and call
`initTimezoneSelect(document.getElementById('calendar_timezone'))` to fill it.

- The list is generated at runtime from `Intl.supportedValuesOf('timeZone')` (~418 zones), so it always
  matches the tzdata of the running Thunderbird and needs no manual maintenance.
- Each option's label is `(UTC±HH:MM) Area/City`, e.g. `(UTC+05:30) Asia/Calcutta`. The offset is computed
  with `Intl.DateTimeFormat(..., {timeZoneName: 'longOffset'})` against the **current date**, because offsets
  are DST-dependent. The label always ends with the option value, so the fallback option that
  `restoreOptions()` injects for an unknown stored value looks consistent with the generated ones.
- Options are sorted by UTC offset, then by id.
- `Intl.supportedValuesOf()` returns ICU's **legacy canonical** ids: `Asia/Calcutta` (not `Asia/Kolkata`),
  `Asia/Rangoon` (not `Asia/Yangon`), `Asia/Katmandu`, `Europe/Kiev`. This is intentional — no alias layer.
- The select is wrapped in Tom Select for search. Two config values are load-bearing: `maxOptions: null`
  (the default caps the dropdown at 50) and `sortField: null` (sorting by label would move every negative
  offset after the positive ones, since `-` sorts after `+`).
- Tom Select theming lives in `pages/_lib/mzta-design.css`, scoped to `#mzta_card` so it covers every select on
  the design-system pages (it used to be scoped to `#connection_ui_table`/`#connection_ui_adv_table`, which left
  other Tom Selects unstyled). The vendored `tom-select.default.min.css` hardcodes light colors, so the control,
  the inner `<input>` that renders the selected item, and the dropdown each have to be pointed at the theme
  tokens — otherwise the text stays dark on a dark field in the dark theme. The legacy Custom Prompts page is
  not part of this design system (no `#mzta_card`, does not link `mzta-design.css`) and is unaffected.
- `initTimezoneSelect()` must be called **before** `initializeSpecificIntegrationUI()`, which invokes
  `restoreOptions()` via its `restoreOptionsCallback`. Populating later would make restore inject a bare
  unlabelled option that the populate step would then duplicate. Population is idempotent
  (`select.dataset.tzPopulated`).
- The stored pref value stays a plain IANA id, so the JSON payload sent to the external Sparks add-on
  (`js/mzta-menus.js`) is unchanged. Values stored by older versions still work through the existing
  `restoreOptions()` fallback.

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
5. **Max messages** (`summarize_max_messages`) — number input, caps how many messages can be summarized at once in webchat mode. Above the limit the operation is blocked with the `summarize_too_many_messages` warning. `0` = no limit.
6. **Strip formatting** (`summarize_strip_formatting`) — checkbox, removes HTML/Markdown formatting from AI summary responses, displaying plain text only. Default: off.
7. **Three editable prompts** (used by context menu summarize and webchat mode):
   - Summarize instruction prompt (`prompt_summarize`)
   - Email template prompt (`prompt_summarize_email_template`)
   - Email separator prompt (`prompt_summarize_email_separator`)
   - Each has Save/Reset buttons and placeholder autocomplete
   - Default text comes from i18n strings (`prompt_summarize_full_text`, etc.)

### Manage Custom Prompts Page (`pages/customprompts/`)

The prompt CRUD screen: a single wide `<table class="prompts_list">` driven by List.js (columns ID, Name, Prompt Text, Menu, Properties, Actions), a hidden `#formNew` add-form, and Import/Export/Save All controls. Data model, storage routing, and the "Menu position" deep-link to the Menu Order page are documented in `claude-spec/02-prompts.md`.

**Visual layout (design "1b")** is purely presentational and driven by CSS design tokens in `mzta-custom-prompts.css`:

- **Theme** follows the OS/Thunderbird theme (no manual toggle). Colors are CSS custom properties defined on `:root` (light default) with a `@media (prefers-color-scheme: dark)` override — a single source of truth replacing the old scattered hardcoded colors. The `showYesNoDialog` export dialog no longer sets colors inline; `dialog.export` reads the tokens.
- **Shell**: a `.page_wrap` centered column (`max-width:1440px`) wraps the header (eyebrow "ThunderAI" + `.page_title` + description), the `#import_export` stack, `#formNew`, and the card.
- **Card** (`#all_prompts`): rounded panel containing the sticky toolbar (`#command_palette` — Save All / status / Add New), the table, and a footer `#list_footer` showing `#prompts_count` (`customPrompts_promptsCount` i18n key, `$COUNT$` placeholder). The `thead` sticks below the toolbar (`top: 54px`).
- **Prompt Text** cell: `{%placeholder%}` tokens are highlighted in **both** read and edit mode.
  - **Read mode**: tokens in the read-only `.text_show` spans are wrapped in `<span class="ph_chip">` by `decoratePromptText()`, which runs after the initial render, on every List.js `updated` event, **and at the end of `handleConfirmClick()`**. The chip wrapper is stripped by `sanitizeHtml()` on the cancel-restore path, so saved text stays clean.
  - **Newlines reach `.text_show` in two forms.** Stored prompts use `<br>` (the row template converts them back to `\n` for the textarea, and the cancel path converts them forward again), but `handleConfirmClick()` writes the textarea value with raw `\n`. `.text_show` is therefore `white-space: pre-wrap`, which renders the raw `\n` and leaves `<br>` alone — the two cannot double up, since the stored format substitutes one for the other rather than emitting both. Without this, line breaks disappeared from the list after save or cancel and only reappeared on the next page load.
  - Idempotence uses `data-phDecorated` holding the **decorated HTML itself**, not a boolean. Saving a row calls `promptsList.get(…)[0].values(…)`, which makes List.js rewrite that one `.text_show` from the stored value — stripping the chips **without** firing `updated`. A boolean flag would stay stale and the row would render unhighlighted until the next full re-render; comparing against the content makes the guard self-invalidating.
  - **Edit mode**: the `<textarea>` remains the source of truth (native undo/redo, IME, spellcheck and the `textarea.value` save/read logic are untouched). Highlighting is painted on a **backdrop mirror** behind a transparent textarea by `attachEditorHighlight()` in `js/mzta-editor-highlight.js`. Markup is `.autocomplete-container.editor-wrap > .editor-backdrop > .editor-highlights` + the textarea + `.autocomplete-list`, present in both the `#formNew` add-form and the List.js row template. Edit-mode chips use `.ph_chip_live` (and `.ph_chip_invalid` for unknown/malformed tokens).
  - **Alignment is load-bearing**: the textarea and `.editor-highlights` must agree on every metric affecting glyph position (`font-family`, `font-size`, `line-height`, `letter-spacing`, `padding`, `border-width`, `white-space: pre-wrap`, `overflow-wrap`). These are declared once in a shared selector list in `pages/_lib/editor-highlight.css` — the single copy of the mirror's structure, shared with the Data Placeholders page and the six settings pages. This page contributes only the `--ed-*` values (7px 10px, `var(--font-mono)`, 1.55) and the `.editor-active` gating; never set a metric on one of the two elements alone. `.ph_chip_live` is deliberately **metric-neutral** (background/color/radius only, with `padding: 0 .2em` offset by `margin: 0 -.2em`) — unlike the read-mode `.ph_chip`, which can afford real padding. Prompt text is `var(--font-mono)` at 13px/1.55 in **both** modes so the two look identical.
  - **Three painting layers, in order.** The field surface is painted by `.editor-wrap.editor-active` (bottom, `var(--panel)` — white in the light theme), the glyphs and chips by `.editor-highlights` inside the backdrop (middle), and the border, caret and selection by the textarea itself (top, `z-index:1`). The textarea must stay `background: transparent` — an opaque background there would hide the mirror — and the backdrop must stay transparent too, because it is inset inside the textarea's *border box* and so cannot paint the 1px border ring or the rounded corners.
  - **`editor-active` gates the mirror _and_ `display:block`.** `attachEditorHighlight()` adds the class to the wrapper, `destroy()` removes it, and both `.editor-backdrop` and the textarea's block display hang off it. `display:block` must **not** be declared on `.editor-wrap .editor`: that selector has two classes, so it would beat the row template's `.hiddendata { display:none }` and leave every row's textarea visible beneath its read-mode text at page load. Gating the backdrop matters for the mirror side of the same bug — leaving edit mode sets `display:none` on the *textarea* only, so an always-on backdrop would keep painting a second copy of the prompt text under `.text_show`.
  - The load-time loop over `document.querySelectorAll('.editor')` attaches the mirror **only** to the add-form textarea, identified by its `.input_new` class; row textareas start in read mode and get theirs from `showItemRowEditor()`. `closest('tr')` cannot be used to tell them apart — the add-form is itself laid out as a table.
  - `showItemRowEditor()` sets the textarea to `display:block` (not `inline`) so it aligns with the absolutely-positioned backdrop, and calls `attachEditorHighlight()`; `hideItemRowEditor()` calls the handle's `destroy()`. Both attach paths are idempotent (guarded by `textarea._mztaHighlight`), so re-entering edit mode cannot stack mirrors or listeners.
  - The token pattern lives in **one** place: `PLACEHOLDER_RE` exported from `js/mzta-editor-highlight.js`, imported by `decoratePromptText()`. Read and edit mode therefore cannot drift on what counts as a token. It carries `/g`, so `lastIndex` must be reset before each use. It also matches values containing `%` (e.g. `{%additional_text:50%%}`), which the previous `/\{%[^%]+%\}/g` did not.
  - Warning colors for invalid tokens are the `--warn-text` / `--warn-bg` / `--warn-border` tokens, defined in both the light and dark `:root` blocks (distinct from `--del-*`, which means "delete").
- **Properties** checkboxes (`.need_selected`, `.need_signature`, `.need_custom_text`, `.define_response_lang`, `.use_diff_viewer`) are styled as toggle switches via `appearance:none` + `::after` knob — **CSS only**; the checkbox classes, disabled logic, and `handleCheckboxChange` are unchanged. The same switch styling applies to the five property checkboxes in the `#formNew` add-form, which carry these same classes (the two placeholder-linked ones also keep their `_new` class, so the `.need_custom_text || .need_custom_text_new` lookups in `checkPromptsConfigForPlaceholders()` still resolve).
  - In **read-only list rows** a `disabled` flag is repainted as a static check/dash status icon. Those rules stay scoped to `table.prompts_list td`: in `#formNew`, `disabled` means "not applicable" (`use_diff_viewer` while the action isn't "substitute text"), so the flag stays a dimmed switch.
  - **Placeholder validation** (`checkPromptsConfigForPlaceholders()`): when the prompt text uses `{%additional_text%}` or `{%selected_text%}`/`{%selected_html%}` but the matching flag is off, the function toggles an `.invalid_flag` class on the checkbox, which draws a `var(--del-text)` outline around the switch. It no longer writes an inline border on the `.need_custom_text_span` / `.need_selected_span` wrappers; those spans remain only as the checkbox+text grouping.

### Manage Data Placeholders Page (`pages/customdataplaceholders/`)

The custom data placeholder CRUD screen — structurally the sibling of the Manage Custom Prompts page (List.js table, hidden `#formNew` add-form, Import/Export/Save All, placeholder autocomplete). Data model and storage (`browser.storage.local`, key `_custom_placeholder`) are documented in `claude-spec/03-placeholders.md`.

**It shares the same design "1b"** as the custom prompts page, with its own copy of the tokens in `mzta-custom-dataplaceholders.css` (the two pages deliberately keep private token blocks; neither uses `pages/_lib/mzta-design.css`):

- Same `:root` token block + `@media (prefers-color-scheme: dark)` override, `.page_wrap` centered column, eyebrow + `.page_title` header, and `#import_export` flex-column stack.
- Same card pattern on **`#all_custom_dataplaceholders`**: sticky `#command_palette` toolbar as the first child (rounded top corners), `thead` sticking at `top: 54px`, and a `#list_footer` with `#ph_count` (i18n key `customDataPH_placeholdersCount`, `$COUNT$` placeholder) rounding the bottom corners. No `overflow:hidden` on the card — it would break the sticky toolbar/header.
- Same button system: accent `#btnNew`/`#btnAddNew`, quiet-until-dirty `#btnSaveAll`, and full-width icon+label row buttons in a `td.actions_cell` (`.btnEditItem`/`.btnConfirmItem` tinted, `.btnCancelItem` neutral outline, `.btnDeleteItem` danger outline). Because those buttons are flex containers, the JS shows Confirm/Cancel with `display = 'flex'` and restores Edit/Delete with `display = ''` (**not** `'inline'`), and `pointer-events:none` on button children keeps the `e.target.parentNode.parentNode` row lookup working.
- `{%placeholder%}` tokens are highlighted in **both** modes, exactly as on the prompts page. Read mode: `decoratePlaceholderText()` chips the `.text_show` spans, using the shared `PLACEHOLDER_RE` and a `data-phDecorated` guard that holds the decorated HTML (so it self-invalidates when the span is rewritten), re-run on the List.js `updated` event. Unlike the prompts page, `handleConfirmClick` here already updated the row in place instead of going through `List.values()`, and re-ran the decoration explicitly. `sanitizeHtml()` strips the chip markup on the cancel-restore path, so stored text stays clean. Edit mode: the backdrop mirror from `pages/_lib/editor-highlight.css`, with this page's `--ed-*` values (7px 10px, `var(--font-mono)`, 1.55) and the same `.editor-active` gating; `showItemRowEditor()` sets the textarea to `display:block` and attaches, `hideItemRowEditor()` destroys both the mirror and the autocomplete instance. `--warn-*` tokens were added to both theme blocks for invalid tokens.
- The `thunderai_custom_` ID prefix (`<i>` before the ID, in both the row and the add-form) is styled like `.id_show` (monospace, muted, non-italic).
- The **`enabled` checkbox** renders as the same **toggle switch** as the prompt properties (`appearance:none` track + `::after` knob, `--accent` when on) — **CSS only**, the `.enabled input_mod` classes and `handleInputChange` are unchanged. Unlike the prompts page there is **no read-only status-icon variant**: this checkbox is never disabled by the row editor, so it stays clickable straight from the row (no Edit/OK round-trip) and only the interactive switch look exists. Default rows (`is_default == 1`) keep the switch look but are dimmed and inert via `:disabled`.

**What it deliberately does not share:** no Copy or "Menu position" row button, no ChatGPT Web / API provider panels, and no `<dialog>` — export/import confirmations still use `confirm()`/`alert()`.
**Visual design.** The page uses the shared design system (see "Shared Design System CSS" below): it is wrapped in `#mzta_card` / `#mzta_body`, settings are `.mzta_field` / `.feature_row` blocks, the two checkboxes render as `.mzta_switch` toggles, and Save/Reset buttons use `.btn_primary` / `.btn_secondary`. Because the page opens in its own full-width browser tab, its `<body>` carries the opt-in **`mzta_feature_page`** class (see "Feature-Page Shell" below), which centers all content in a capped ~760px column on the light `--desk` background and renders each `.mzta_section` as a white rounded card with per-row dividers, a 3px blue section-header accent bar, larger label/help typography, blue focus rings on inputs/selects/textareas, and the two number inputs (`summarize_max_display_length`, `summarize_max_messages`) laid out as compact right-aligned controls (label/description left) via the `.mzta_field_num` wrapper. No form field id/name/value, listener, or persistence logic changes — the page still saves options on `change` and each prompt editor keeps its own Save/Reset buttons (there is no page-level save bar). The two number fields wrap their control in `.mzta_field_num_ctrl` (the max-messages one reuses `.mzta_inline_row` for the reset button + input group). The specific-integration connection UI is injected (via `initializeSpecificIntegrationUI()`) into a `<table id="connection_ui_table">` inside `#mzta_conn_panel`. A small `updateConnPanelTint()` helper in `mzta-summarize.js` (mirroring the options-page one, but scoped to the `summarize_` prefix) colours the panel to the selected provider (`tint_*` class + `#mzta_conn_pill_name`) and hides the whole panel (`display:none`) when `summarize_use_specific_integration` is off, so no empty bordered box shows; it runs on load and on `change` of `summarize_connection_type` / the checkbox. The connection-type select stays a native `<select>` (only the model selects become TomSelect), so the `change` listeners fire normally. Because `_updateVisibility()` sets an inline `display:table-row` on visible connection rows, `mzta-summarize.css` re-asserts `#connection_ui_table tr[style*="table-row"] { display:block !important; }` so those rows still render as stacked fields — no change to the shared `connection-ui.js` is needed.

### Shared Design System CSS (`pages/_lib/mzta-design.css`)

The design-system tokens and reusable components ("variant 2a") live in `pages/_lib/mzta-design.css`, linked by both `options/mzta-options.html` and `pages/summarize/mzta-summarize.html` (**before** each page's own stylesheet, so the page CSS can still override). It defines: the `:root` token block + dark-mode overrides (`--panel`, `--text`, `--dim`, `--line`, `--field`, `--fieldLine`, `--accent`, stats/warn tints), the card shell (`#mzta_card`, `#mzta_body`), header block, `.mzta_section` / `.mzta_eyebrow` / `.mzta_field` / `.mzta_help`, `#mzta_card`-scoped input/select/textarea/button styles (`.btn_primary`, `.btn_secondary`, `.btn_small`), the connection panel + injected-table restyle (`#mzta_conn_panel`, `#connection_ui_table`/`#connection_ui_adv_table`, `#mzta_conn_adv_btn`, `.conn_test_*`, and the provider setup note `#miczDescription` + `#mzta_info_guide` that closes the panel), the `.mzta_switch` toggle and `.feature_row`, the advanced-options disclosure (`#mzta_adv_toggle`/`#mzta_adv_panel`), the options-page bottom block (`#mzta_info_row` stacking `#mzta_disclaimer` above `#mzta_shortcut_strip`, `#mzta_footer` — see "Options Page Bottom Block" below), `.warning`, and the per-provider `tint_*` custom-property blocks (plus the legacy `tr.conntype_*` row-shading colours that `getConnectionTypeColor()` reads). `options/mzta-options.css` now holds only options-specific rules (`#btn_custom_prompts`, `#btnMenuOrder`, footer link ids, `#owl_warning`/`#hyprland_warning`, `#no_sparks`). Adding the design system to another feature page means: link this file first, wrap the page in `#mzta_card`/`#mzta_body`, and use the component classes.

#### Feature-Page Shell (opt-in `body.mzta_feature_page`)

Feature settings pages open in their own full-width browser tab, where stretching controls edge-to-edge hurts readability. Adding `class="mzta_feature_page"` to a page's `<body>` opts into a **shell** whose rules all live at the end of `pages/_lib/mzta-design.css`, every one scoped under `body.mzta_feature_page`. The **main options page does not carry this class**, so it is intentionally excluded and keeps its full-width layout — the shell is reusable across feature pages without touching the options page.

All six special-prompt feature pages now adopt the shell: `pages/summarize/`, `pages/addtags/`, `pages/spamfilter/`, `pages/translate/`, `pages/get-calendar-event/`, and `pages/get-task/`. Each links `../_lib/mzta-design.css` **first**, wraps its content in `#mzta_card` / `#mzta_top_links` (icon + `.mzta_page_title` + `.mzta_page_subtitle`) / `#mzta_body`, renders every settings group as a `.mzta_section` card headed by **`.mzta_prompt_title`** (see the typography note below) — every card title on these pages uses that one class, so "Current prompt text", "Exclusions list", "Accounts", "Skip addresses" and "Spam report" are all the same size. The only remaining `.mzta_eyebrow` on a feature page is the `<span>` inside `#mzta_conn_panel_header` (the "Connection settings" label next to the provider pill), which is a sub-header *inside* the connection panel rather than a section-card title and deliberately keeps the smaller 12px look. The **first (settings) card has no heading at all**. That first card's former `*_prompt_prefs_title` eyebrow ("Summarization Options", "Add Tags Options", …) was removed from all six pages: the page title already names the feature, so the heading was redundant, and at 12px it sat visually below the 15px `.mzta_prompt_title` further down the page. The six now-unused keys (`Summarize_prompt_prefs_title`, `AddTags_prompt_prefs_title`, `SpamFilter_prompt_prefs_title`, `Translate_prompt_prefs_title`, `get_calendar_event_prompt_prefs_title`, `get_task_prompt_prefs_title`) were deleted from `_locales/en/messages.json`; the other locale files are Weblate-managed and drop them on the next sync. Each page uses `.feature_row` + `.mzta_switch` toggles for checkboxes, `.mzta_field` (or `.mzta_field_num` for number inputs) for other controls, and `.btn_secondary`/`.btn_primary` for the per-editor Reset/Save buttons. The specific-integration connection UI is wrapped in `#mzta_conn_panel` / `<table id="connection_ui_table">` (preserving the `connection_ui_anchor` / `connection_ui_end` IDs required by `connection-ui.js`), and each page's JS gained a prefix-scoped `updateConnPanelTint()` (mirroring the summarize one) that tints the panel to the selected provider, sets `#mzta_conn_pill_name`, and hides the whole panel when the page's `<prefix>_use_specific_integration` checkbox is off. Each page's own CSS was slimmed to page-specific rules only (autocomplete dropdown, button row, one `#connection_ui_table tr[style*="table-row"]` override, plus genuinely unique bits such as spamfilter's `#report_data` grid / `#spamfilter_threshold_too_low`, addtags's account-selector and use-list styling). No element `id`/`name`/`.option-input` class changed, so all save-on-`change` and prompt persistence logic is intact.

**addtags auto-toggle change.** In the old table layout, `mzta-add-tags.js` revealed the auto-tagging sub-rows (`add_tags_auto_only_inbox_tr`, `add_tags_auto_uselist_tr`) with `style.display = 'table-row'`. Those rows are now `.feature_row` flex blocks inside a card, so the JS was changed to set `style.display = ''` (revert to the CSS default) instead of `'table-row'`; the rows are hidden by default via the page CSS and toggled on when `add_tags_auto` is checked. The `account_selector_container` (now a `.mzta_section` card) is likewise toggled with `''`/`'none'`.

The shell provides: a light `--desk` page background; a centered, `max-width: 760px` column (`#mzta_card` with `margin: 0 auto` + 24px side padding — below the cap it is naturally full-width-minus-padding, no media query needed); each `.mzta_section` rendered as a white rounded **card** (`--panel`, 12px radius, 24px padding, subtle shadow, 24px vertical gap); section headers (`.mzta_section > .mzta_eyebrow`) get a **3px vertical `--accent` bar**; stacked settings inside a card are separated by thin `--line` **row dividers** (the first row after the header/intro has none — and, since the settings card is headerless, a `.mzta_field:first-child` / `.feature_row:first-child` pair covers the case where the row itself opens the card, so no stray divider appears above it); up-sized **typography** (`.opt_title` 15px/600, `.opt_title_small` 13.5px/normal, help/`.feature_desc` 13.5px with `text-wrap: pretty`); a **`.mzta_prompt_title`** class used for **every section-card heading** on the feature pages — same accent-bar treatment as `.mzta_eyebrow` but sized like `.opt_title` (15px/600 instead of 12px/700), since a heading smaller than the labels beneath it read as less important; it is a standalone class (not combined with `.mzta_eyebrow`) and is included in the `+ .mzta_help` / `+ .mzta_field` / `+ .feature_row` sibling selectors so the intro pull-up and first-row no-divider rules still apply. `.mzta_eyebrow` itself is now used on these pages only for the connection-panel sub-header; a header block with a 25px page title, one-line subtitle, and a small app-icon tile (`.mzta_page_icon` / `.mzta_page_title` / `.mzta_page_subtitle`); **compact number fields** via `.mzta_field_num` (label/description left, ~96px centered input — or reset+input group — right); and **focus rings** (`--accent` border + a 3px `color-mix` accent glow, white background) on inputs/selects/textareas — the only focus styling in the design system, deliberately scoped so the options page is unaffected. All rules reuse existing tokens, so dark mode is inherited. It adds no save bar: pages persist on `change` and keep their per-editor Save/Reset buttons. A new feature page adopts the look by adding the class, giving the header the `.mzta_page_*` markup, and putting its settings in `.mzta_section` cards (number fields in `.mzta_field_num`).

### Menu Order Page (`pages/menu_order/`)

Entry point from the options page via the "Menu Order" button (next to "Manage your prompts"). Provides drag-and-drop reordering and toggle-based visibility control for both the popup and the context menu. See `claude-spec/02-prompts.md` ("Menu Order Page") for the full behaviour, data flow, and exclusion rules.

### Translate Settings Page (`pages/translate/`)

The translate settings page provides:

1. **Specific integration checkbox** — enables per-feature API override (like other special prompts)
2. **Auto-translate dropdown** (`translate_auto`) — three modes:
   - `0` (Disabled) — no inline translations
   - `1` (Manual) — shows a "Get AI Translation" button in message display
   - `2` (Automatic) — generates translation immediately when message is opened
3. **Max display length** (`translate_max_display_length`) — number input, limits inline translation text to N characters. `0` = no limit. When truncated, a "See more"/"See less" toggle link is appended.
4. **Target language** (`translate_lang`) — text input for the destination language. If empty, falls back to `default_chatgpt_lang`.
5. **One editable prompt** — the translation instruction prompt (`prompt_translate_this`) with Save/Reset buttons and placeholder autocomplete. Default text comes from i18n string `prompt_translate_this_full_text`.

Like the other feature pages, this page uses the shared design system + feature-page shell (see "Feature-Page Shell" above): two `.mzta_section` cards (settings + prompt), `.mzta_switch` toggle, `#mzta_conn_panel` connection UI with a `updateConnPanelTint()` helper, and `.mzta_field_num` for the max-display-length number input.

### Connection Settings Panel — Advanced Options Disclosure

The main options page (`options/mzta-options.html`) wraps the injected connection
fields in `#mzta_conn_panel`. Each provider's fields are tiered into **core** and
**advanced**:

- **Core** fields (always visible) — the minimum for a working connection: API key /
  host, model, and API version. Rendered normally.
- **Advanced** fields (hidden by default) — fine-tuning such as temperature, system
  prompt, max tokens, context window, thinking budget, JSON format, store-on-server,
  `/v1` suffix, ChatGPT Web model/project/etc.

**Field tiering.** In the shared template inside `injectConnectionUI()`
(`pages/_lib/connection-ui.js`), every advanced field row carries the marker class
`conn_adv` in addition to its `conntype_<provider>` class. Core rows carry no marker.
The `conn_adv` class is inert on the 6 feature pages (they render no toggle button).

**The toggle.** A full-width button `#mzta_conn_adv_btn` sits directly below the core
`#connection_ui_table`, inside the tinted panel. It mirrors the app-level
`#mzta_adv_toggle`: gear icon + a static **"Advanced options"** label
(`prefs_advanced_options`) on the left, chevron on the right (`justify-content:
space-between`). Its style is defined in `pages/_lib/mzta-design.css` (keeps the
per-provider `--tint-border` / `--tint-accent`, falling back to `--fieldLine` /
`--accent`); its chevron rotates 180° when expanded via the `[aria-expanded="true"]`
attribute.

**Show/hide mechanism.** The advanced rows are **moved at runtime** (options page only,
right after `injectConnectionUI()` in `options/mzta-options.js`) out of
`#connection_ui_table` and into a second table `#connection_ui_adv_table` that sits
**below** the button. Because that table follows the button in the DOM, expanding it
opens the advanced fields *below* the button (the button stays fixed) — exactly like the
app-level disclosure. Collapsing is CSS-driven: `#connection_ui_adv_table.hidden {
display: none; }`. Both tables share the same field-restyle CSS (the selectors list
`#connection_ui_table` and `#connection_ui_adv_table` together).

Per-provider visibility of the advanced rows is handled by an **options-page-only**
helper `showAdvConnectionOptions()` (`options/mzta-options.js`). This is required because
`showConnectionOptions()` (`connection-ui.js`) scopes its `conntype_*` toggling to the
core table's tbody only (`select → label → td → tr → tbody`), so it does **not** reach
rows moved into `#connection_ui_adv_table`. `showAdvConnectionOptions()` hides every
`conntype_*` row in the advanced table and shows only the selected provider's; it is
called at init (after `restoreOptions()` + `showConnectionOptions()`) and on every
`connection_type` `change`. The shared `connection-ui.js` is intentionally left unchanged
— widening its scope would break the Custom Prompts page, which hosts multiple connection
blocks on one page.

**JS wiring** (`options/mzta-options.js`): `resetConnAdv()` sets `aria-expanded="false"`
and adds `.hidden` to `#connection_ui_adv_table`. It is called once after injection
(start collapsed) and on every `connection_type` `change` event (reset to collapsed on
provider switch). The button's `click` handler flips `aria-expanded` and toggles
`.hidden` on the advanced table; the label is static (no swap). State is **purely local
UI** — no preference is persisted, so reopening the options page always starts collapsed.
The connection-test "back to idle" `input`/`change` listeners are bound to **both** tables
so editing an advanced field also invalidates a prior test result.

### Connection Settings Panel — Connection Test Status Strip

Below the advanced-options button, inside `#mzta_conn_panel`, a status strip
(`#mzta_conn_test`, class `conn_test_strip`) offers a lightweight, **non-persistent**
connectivity check for the selected provider. **Options page only** — the strip is
static markup in `options/mzta-options.html`, not part of the shared connection UI, so
it does not appear on the feature pages.

**Visibility.** Shown only for connection types with a testable endpoint — every type
except `chatgpt_web` (which has no API endpoint). `refreshConnTestVisibility()` toggles
`display` on load and on every `connection_type` change.

**States** (driven by `data-state` on `#mzta_conn_test`, styled in
`pages/_lib/mzta-design.css`): `idle` (grey dot, "Connection not tested yet", link "Test
now"), `loading` (dot becomes a spinner via the `mztaspin` keyframe, "Testing
connection…", link hidden), `ok` (green dot, "Connected — <API> reachable", link
"Re-test"), `error` (red dot + red text with the error detail, link "Retry").
`setConnTestState(state, message)` updates dot/text/link; i18n keys are `connTest_*` in
`_locales/en/messages.json`.

**Reset to idle** happens on `connection_type` change and on any `input`/`change` inside
`#connection_ui_table` (editing key/host/model/version invalidates a prior result).

**Test logic** lives in `js/mzta-connection-test.js` (shared helper). It **reuses each
provider class' existing `fetchModels()`** (the same call the "Fetch models" buttons use)
— no URL/header/auth logic is duplicated. `getTestableConnection(connType)` returns a
registry entry (`makeClient` reading current form fields, `nameKey`, `requestPermission`);
`runConnectionTest(connType)` requests the needed host permission (mirroring the
fetch-models / CORS buttons), calls `fetchModels()` with a ~10s `Abort` -style timeout
(`Promise.race`), and maps the `{ok, error, is_exception}` result to auth / network /
timeout messages. It reads current (possibly unsaved) form values and **saves nothing**.

### Setup Wizard (`pages/setup-wizard/`)

A guided **first-run flow** that walks a new user through the minimum needed to get
working: **Choose your AI → Connect → Pick your tools → Done**. It does not replace the
informational welcome page (`pages/onboarding/`); it complements it. The defining idea is
that **each AI integration carries its own colour, applied from the very first choice** —
picking a provider on step 0 tints the connection panel, the provider pill, and the finish
badge through the rest of setup.

**Files:** `pages/setup-wizard/mzta-setup-wizard.{html,js,css}`. It is a standalone
WebExtension page (its own browser tab), not registered in `manifest.json`
(`options_ui`/`default_popup` are unchanged); it is opened via `browser.tabs.create` from
the entry points below.

**Reuse over rebuild.** The wizard is an orchestration layer over existing pieces:
- **Connection UI** — the Connect step injects the shared `injectConnectionUI()`
  (`pages/_lib/connection-ui.js`) into `<table id="connection_ui_table">` inside
  `#mzta_conn_panel`, exactly as the options page does (including moving the `.conn_adv`
  rows into `#connection_ui_adv_table` and the `#mzta_conn_adv_btn` disclosure). The
  injected `<select id="connection_type">` is **hidden** (`#connection_type_tr{display:none}`)
  — the provider is chosen through the step-0 cards — but stays in the DOM because
  `showConnectionOptions()` walks up from it.
  **Text scale caveat:** `connection-ui.js` emits most field description text as a **bare
  text node** inside `<label>` (after a `<br>`), not wrapped in `.small_info`/`<i>`, so the
  sizing rule in `mzta-design.css` never reaches it and it falls back to the browser default
  (~16px). In the wide options column this is barely noticeable; in the wizard's 432px card
  it broke the layout. The wizard therefore sets `font-size`/`color` on
  `#wiz_step_connect #connection_ui_table td` / `#connection_ui_adv_table td`, letting those
  un-wrapped nodes inherit the small-text scale. Form controls are unaffected — the shared
  sheet sizes inputs/selects/textarea directly, and TomSelect sizes `.ts-control` directly,
  so neither inherits from the cell. Scoped to `#wiz_step_connect` so the options page and
  feature pages are untouched. If `connection-ui.js` is ever changed to wrap that text
  properly, this override can be dropped.
- **Connection test strip** — the same `#mzta_conn_test` markup + `refreshConnTestVisibility()`
  / `setConnTestState()` logic as the options page, calling `isTestableConnection()` /
  `runConnectionTest()` from `js/mzta-connection-test.js`.
- **Tint system + toggles** — the per-provider `tint_*` classes / `--tint-*` tokens, the
  provider pill, and the `.mzta_switch` feature toggles all come from
  `pages/_lib/mzta-design.css` + `connection-ui.css`. The wizard CSS adds its own
  scaffold (432px card, step indicator, nav bar, provider cards, done badge),
  `.wiz_provider_card.tint_<id>` rules mirroring the existing token values, and the
  connection-row typography override described in the Connection UI bullet above. Its type
  scale is deliberately one step down from the feature pages to suit the narrow card:
  16px step title / 12px subtitle / 13px provider name / 11.5px descriptions.

**Step 0 — Choose your AI:** six provider cards built in JS from a local `PROVIDERS` array
(ids/order match `CONN_TYPES`); names reuse `prefs_Connection_type_*`, tags use new
`wizard_provider_tag_*` keys. Selecting a card sets the hidden select's value and dispatches
`change` (so the shared UI reacts and `connection_type` persists via the same
save-on-`change` path), then re-tints panel/badge/pill and recomputes the step sequence.

**Nothing is preselected.** Because `connection_type` now defaults to empty, `state.provider`
starts empty too and **no card is marked selected**. Critically, the boot handler must **not** call
`selectProvider()` when there is no saved provider: that function dispatches a `change` on the
hidden select, which would persist a `connection_type` the user never picked — merely *opening* the
wizard would choose a provider for them. Step 0 shows only the provider cards, so no connection-UI
setup is needed until the first card click, which calls `selectProvider()` itself. While
`state.provider` is empty, `renderStep()` disables **"Continue"** and `goNext()` refuses to advance,
so a provider-less wizard can never reach the Connect step. `restoreOptions()` leaves the hidden
select unset (`selectedIndex = -1`) in this state, again persisting nothing.

**Provider-dependent sequence:** `chatgpt_web` skips the "Pick your tools" step
(`[provider, connect, done]`); every other provider is `[provider, connect, tools, done]`.
Nav walks sequence *positions*, never raw indices, so skipped steps are never landed on.
"Finish setup" is the label on the second-to-last position, "Continue" otherwise.

**Step 2 — Pick your tools:** only the four API-driven features (`add_tags`, `spamfilter`,
`summarize`, `translate`) — the two Sparks features are omitted. Same toggle markup / ids as
the options page, so they persist via the shared save-on-`change`.

**Persistence:** the wizard writes the **same** storage keys as the options page
(`connection_type`, the per-provider `*` fields, and the four feature flags) via
`saveOptions`/`restoreOptions` copied from `options/mzta-options.js`. **No new preference.**

**Entry points:**
- **Onboarding banner** — a `#wizard_banner` at the top of `pages/onboarding/onboarding.html`
  with a link (`#btn_launch_wizard`) that opens the wizard. It shares its `.content` parent
  with `#onboarding_doc_panel`, which is `position: absolute` (top-right, `z-index: 100`),
  opaque, and therefore reserves no layout space. The banner is styled with a 4px `#0a84ff`
  accent edge on **both** inline sides (1px border top/bottom), so its whole box — borders
  included — must stay clear of the panel: it uses `margin-inline-end: 230px` plus
  `width: auto` + `align-self: stretch` (needed because `.content` is a centering flex column,
  where dropping `width: 100%` alone would shrink-wrap the banner) and start-aligned content.
  A mere `padding-inline-end` would clear the text but leave the right accent edge hidden
  behind the panel. An `@media (max-width: 700px)` block drops the margin and re-centers. Keep
  that margin in sync if the doc panel's width or offsets change.
  The banner is **always visible**; when no connection is selected at all, `onboarding.js` adds
  `.wizard_banner_urgent` to give it more prominence (bold + a soft blue glow — still blue, since
  nothing is broken). No permission banner can apply in that state.
- **Options banner** — `#no_connection_banner`, with `#btn_options_setup_wizard`. It is the **first
  child of `#mzta_card`, above `#mzta_top_links`** (the documentation block), so it is the first thing
  a new user sees. Because `#mzta_card` has no padding of its own, the banner carries explicit
  `margin: 20px 22px 0` matching the header block's horizontal padding, plus a `min-height: 64px` for
  presence. Styled blue in `mzta-design.css` from the `--accent` / `--accentLight` tokens (so dark
  mode is inherited) and deliberately **not** using `.warning`, which is red.
  `display: none` by default; `updateNoConnectionBanner()` in `options/mzta-options.js` toggles the
  `.shown` class on load and on every `connection_type` change. Both this link and the doc-card share
  the local `openSetupWizard()` helper. The same function also **hides the per-connection "Advanced
  options" disclosure** (`#mzta_conn_adv_btn`) while nothing is selected — every row it would reveal
  belongs to a specific provider, so there is nothing to disclose — and calls `resetConnAdv()` so the
  panel is collapsed (and `#connection_ui_adv_table` hidden) when a provider is eventually picked. It
  is registered *after* the existing `resetConnAdv` / `refreshConnTestVisibility` change listeners, so
  its re-hide always runs last.
- **Options doc-card** — a fourth `.mzta_doc_card` (`#btn_setup_wizard`) in `.mzta_doc_cards`,
  right of "Open Welcome Page". The grid is an explicit `repeat(4, minmax(0,1fr))` in
  `mzta-design.css` so all four cards stay on one row, with an `@media (max-width: 500px)`
  block dropping to `repeat(2, minmax(0,1fr))` (2×2) on narrow panes. It deliberately does
  **not** use `auto-fit`, which produced unpredictable 3+1 splits and one-per-row stacking;
  the `minmax(0, …)` floor keeps the longest label (`prefs_doc_setup_wizard_launch`) wrapping
  inside its card instead of widening the track past the container. If a fifth card is ever
  added, update both column counts.
- **Popup menu** — when the popup opens and the selected connection has no credentials,
  `mzta-popup.js`'s `isConnectionConfigured(prefs)` returns false and the popup shows
  `#setup_wizard_prompt` (a button opening the wizard) instead of the prompt list.
  "Configured" = the required credential is set: `*_api_key` for the cloud APIs, `*_host`
  for Ollama / OpenAI-compatible; `chatgpt_web` is always considered configured (its host
  permission is handled by the existing permission banner). The function **first** returns
  false when no connection is selected at all — otherwise the empty value would fall through
  to the permissive `default:` case and the blue banner would never show.

**Blue wizard banner vs. red permission banner.** They are mutually exclusive by construction:
the blue banners mean *"you haven't chosen an AI yet"*, the red ones mean *"you chose this
provider but haven't granted its host permission"*. The red banners
(`#ask_chatgpt_web_perm` / `#ask_anthropic_api_perm` / `#ask_openai_api_perm` in the popup,
`#chatgpt_web_permission` / `#anthropic_api_permission` / `#openai_api_permission` in onboarding)
are keyed on an explicitly selected provider, so an empty `connection_type` never triggers them,
and their behaviour is unchanged by the empty default.

i18n keys for the wizard are `wizard_*` in `_locales/en/messages.json`; entry-point copy is
`onboarding_wizard_banner_*`, `prefs_doc_setup_wizard_launch`, `popup_setup_wizard_*`,
`options_no_connection_*`, plus `prefs_Connection_type_none` (select placeholder) and
`msg_no_connection_selected` (runtime alert).

### Feature Rows — Disabled vs. API-Needed

The four API-driven feature rows on the main options page (Add Tags, Spam Filter, Summarize,
Translate) are unusable in **two distinct** situations, which must be presented differently:

| Effective connection | Toggle | `warn_API_needed` hint |
|---|---|---|
| `chatgpt_web` | unchecked, still clickable | **shown** |
| *nothing selected* (`''`) | unchecked **and `disabled`** (greyed) | **hidden** |
| any API | untouched | hidden |

The `warn_API_needed` string explicitly says *"you need an API integration rather than the ChatGPT
Web Integration"* — advice that only makes sense once ChatGPT Web has actually been chosen. With no
connection selected it would be misleading (the blue setup-wizard banner already explains the real
situation), so it stays hidden and the toggle is greyed out instead: there is nothing to enable the
feature against yet.

Because a greyed-out toggle alone doesn't say *why*, a note (`#features_no_connection_note`,
`prefs_FeaturesNoConnection` — "Select an AI connection above to enable these features.") sits
directly under the `prefs_FeaturesSubtitle` line and is shown by `updateNoConnectionBanner()` — the
same function that drives the top banner and the advanced-options toggle — via a `.shown` class, so
all three stay in sync on load and on every `connection_type` change. It is styled in `--accent`
blue (informational, matching `#no_connection_banner`), not with the amber `.warn_API_needed`
treatment.

`getFeatureConnState(prefs_opt, prefix)` in `options/mzta-options.js` returns
`{no_connection, disabled, show_api_warning}` from the *effective* connection (i.e. after
`getConnectionType()` applies any per-feature `use_specific_integration` override — so a feature
pointing at its own API stays enabled even when the global connection is empty).
`disable_ApiFeature(prefs_opt, prefix, manageBtnId)` consumes it and does all the row work; the four
`disable_AddTags` / `disable_SpamFilter` / `disable_Summarize` / `disable_Translate` functions are now
one-line wrappers over it (they previously held four copies of the same body). The greyed-out look
needs no new CSS — `.mzta_switch input[type="checkbox"]:disabled + .track` already sets
`opacity: .5`. The per-feature `click` handlers (which request Thunderbird permissions) need no guard
either: a disabled checkbox fires no `click`.
### Connection Settings Panel — Provider Setup Note (`#miczDescription`)

The per-provider setup note is the **last element inside `#mzta_conn_panel`**, directly
below the connection-test strip. It used to sit at the very bottom of the page (inside
`#mzta_bottom`) under an "Important information" heading; it was moved next to the
connection fields it describes, and **the heading was dropped** — the panel header already
titles the whole block, so a second title was redundant. The element id is deliberately
unchanged so `updateDescription()` keeps working.

The note itself is **untinted**: only the body text carries the provider colour, as a 3px
`--tint-accent` left bar on the `.conntype_<provider> .info_specific` spans
(`prefsInfoDesc_1/2/3/4/7/8`). The single `#mzta_info_guide` link (`prefs_full_guide`) is
**moved inside the active provider's span** by `updateDescription()`, so it reads inline at
the end of that sentence instead of breaking onto its own line below the accent bar.

**Provider reactivity.** `updateDescription()` (`options/mzta-options.js`) does three
things per provider, all driven by the existing `change` listener on `#connection_type`
(plus one call at init): toggles the `.conntype_*` span visibility via inline `display`,
toggles the `tint_*` class on `#miczDescription`, and moves `#mzta_info_guide` into the
active span (idempotent — it only re-appends when the parent differs) while pointing it at
`getMiczItUrl(CONN_GUIDE_PATH[conntype])`. `CONN_GUIDE_PATH` is **sparse on purpose** —
only `chatgpt_web` (status page) and `ollama_api` (CORS page) have a dedicated
documentation page, and the link is hidden (`display:none`) for the other four rather
than falling back to a generic page.

Note `.info_specific` must keep `display: block` in CSS, because `updateDescription()`
reveals the active provider's text with `style.display = ""`, which falls back to the
stylesheet value.

**Tint tokens.** `#mzta_conn_panel` declares all four per-provider tint custom properties
(`--tint-bg`/`--tint-border`/`--tint-pill`/`--tint-accent`); `#miczDescription` declares
only `--tint-accent`, since the note is untinted apart from its left accent bar
(`pages/_lib/mzta-design.css`). Now that the note is nested inside the panel it would also
*inherit* the panel's `--tint-accent`, but its own `tint_*` class still wins and both
resolve to the same provider colour, so the accent bar is unaffected either way.

### Options Page Bottom Block (`#mzta_bottom`)

Everything below the app-level "Advanced options" row is one wrapper `div#mzta_bottom`
holding two parts in a vertical stack. It replaced five loose blocks (an "Important
Information" `<h1>` eyebrow, the provider setup note with a bracketed `[More info]` link,
a `CTRL+ALT+A` reminder sentence, the boxed LLM disclaimer, and a stacked footer) — the
provider setup note has since moved into `#mzta_conn_panel` (see "Provider Setup Note"
above). The wrapper takes the `#mzta_body > * { margin-bottom: 24px }` rhythm; the parts
inside space themselves with their own `margin-top`.

1. **Disclaimer + shortcut stack** (`#mzta_info_row`) — a centered flex **column**
   (`flex-direction: column; align-items: center`), so neither child is stretched to the
   full card width:
   - **LLM disclaimer** (`#mzta_disclaimer`) on the first line, sized to its own content
     (`width: fit-content; max-width: 100%`) with `align-items: center` so the glyph
     centres against the single line of text. It reads as one line whenever the card is
     wide enough and still **wraps** rather than overflowing on narrow windows (no hard
     `white-space: nowrap`, since the sentence is ~145 characters). Borderless (no
     `--warnBorder`/`--warnBg`; those tokens are consequently unused, though still
     defined) — just the amber `--warnColor` triangle glyph + `prefs_disclaimer_short` +
     the privacy link.
   - **Keyboard-shortcut strip** (`#mzta_shortcut_strip`) **below** the disclaimer, kept
     at its natural shrink-to-fit width (`flex: 0 0 auto; align-self: center`) so it never
     spans the full width: a `--field` box with the `prefs_shortcut_label` label and the
     `#mzta_shortcut_keys` `<kbd>` chips.
2. **Footer** (`#mzta_footer`) — three **plain `<a>` links** on one centered `flex-wrap`
   row (was a stacked column of `<div>`s, each with an introductory sentence before the
   link). The lead-in sentences are gone: `TranslateText` + `TranslateLink` and
   `prefsDonation_1` + `prefsDonation_2` are replaced by the single-label keys
   `prefs_footer_translate` ("Translate the addon") and `prefs_footer_donate`
   ("Make a donation"); release notes keeps `prefs_OptionText_release_notes`. The ids
   `#miczTranslate` / `#miczDonation` / `#miczRelNotes` are preserved (now on the anchors),
   and the donation URL was corrected from `http://` to `https://`.

**Live keyboard shortcut.** `updateShortcutChips()` calls `browser.commands.getAll()`,
finds `_thunderai__do_action`, and splits its `.shortcut` on `+` into one `<kbd>` per key,
so the chips follow a user rebinding instead of showing a hard-coded string. This is the
only `browser.commands` use in the codebase; the permission is implicit in the manifest
`commands` key, so no manifest change was needed. The static `Ctrl`/`Alt`/`A` chips in the
HTML are the fallback kept when the API throws, the command is missing, or the user has
cleared the binding (empty `.shortcut`). It runs once at init — rebinding happens outside
this page.

**Retired i18n keys.** `prefsInfoTitle`, `prefs_status_page`, `prefsInfoDesc_5`,
`prefsInfoDesc_6`, `prefs_disclaimer`, `TranslateText`, `TranslateLink`, `prefsDonation_1`,
and `prefsDonation_2` are no longer referenced by this page but are **left in the locale
files** — deleting them would churn all 16 Weblate-managed locales. New keys (English only,
per the localization rule): `prefs_full_guide`, `prefs_shortcut_label`,
`prefs_disclaimer_short`, `prefs_footer_translate`, `prefs_footer_donate`.

`prefs_info_pill` ("Important information") was also introduced here, but it was
**deleted from `_locales/en/messages.json`** when the provider setup note moved into the
connection panel and lost its heading. Only the English file was edited (the other 15
locales are Weblate-managed and drop the key on the next sync) — note this differs from
the "leave retired keys in place" handling of the older keys above.

### Feature "Manage settings" Links — Hidden vs. Disabled

Each feature block on the main options page (Add Tags, Spam Filter, Summarize,
Translate, Calendar Event, Task) has a "Manage settings" link/button (e.g.
`btnManageTagsInfo`, `btnManageSpamFilterInfo`, ...) that opens the feature's dedicated
settings page. When the feature's checkbox is unchecked, the button is fully **hidden**
(`display: none`) rather than merely greyed out/disabled, via the shared helper
`setFeatureManageVisibility(btn, visible)` in `options/mzta-options.js`. The helper sets
both `style.display` and the `disabled` attribute together, and replaces all prior
inline `btn.disabled = ...` toggling for these six buttons (on checkbox `click`, on
`disable_*()` re-evaluation, and on permission-request denial).

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
