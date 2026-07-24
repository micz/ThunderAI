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
connection_type   (default: 'chatgpt_web')
use_specific_integration   (default: false)
```

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
| `calendar_timezone` | `''` | Timezone to enforce |
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
- **Prompt Text** cell: `{%placeholder%}` tokens in the read-only `.text_show` spans are wrapped in `<span class="ph_chip">` by `decoratePromptText()` (runs after render and on every List.js `updated` event; idempotent via `data-phDecorated`). The chip wrapper is stripped by `sanitizeHtml()` on the cancel-restore path, so saved text stays clean.
- **Properties** checkboxes (`.need_selected`, `.need_signature`, `.need_custom_text`, `.define_response_lang`, `.use_diff_viewer`) are styled as toggle switches via `appearance:none` + `::after` knob — **CSS only**; the checkbox classes, disabled logic, and `handleCheckboxChange` are unchanged.

### Manage Data Placeholders Page (`pages/customdataplaceholders/`)

The custom data placeholder CRUD screen — structurally the sibling of the Manage Custom Prompts page (List.js table, hidden `#formNew` add-form, Import/Export/Save All, placeholder autocomplete). Data model and storage (`browser.storage.local`, key `_custom_placeholder`) are documented in `claude-spec/03-placeholders.md`.

**It shares the same design "1b"** as the custom prompts page, with its own copy of the tokens in `mzta-custom-dataplaceholders.css` (the two pages deliberately keep private token blocks; neither uses `pages/_lib/mzta-design.css`):

- Same `:root` token block + `@media (prefers-color-scheme: dark)` override, `.page_wrap` centered column, eyebrow + `.page_title` header, and `#import_export` flex-column stack.
- Same card pattern on **`#all_custom_dataplaceholders`**: sticky `#command_palette` toolbar as the first child (rounded top corners), `thead` sticking at `top: 54px`, and a `#list_footer` with `#ph_count` (i18n key `customDataPH_placeholdersCount`, `$COUNT$` placeholder) rounding the bottom corners. No `overflow:hidden` on the card — it would break the sticky toolbar/header.
- Same button system: accent `#btnNew`/`#btnAddNew`, quiet-until-dirty `#btnSaveAll`, and full-width icon+label row buttons in a `td.actions_cell` (`.btnEditItem`/`.btnConfirmItem` tinted, `.btnCancelItem` neutral outline, `.btnDeleteItem` danger outline). Because those buttons are flex containers, the JS shows Confirm/Cancel with `display = 'flex'` and restores Edit/Delete with `display = ''` (**not** `'inline'`), and `pointer-events:none` on button children keeps the `e.target.parentNode.parentNode` row lookup working.
- `{%placeholder%}` tokens in the read-only `.text_show` spans are chipped by `decoratePlaceholderText()` (idempotent via `data-phDecorated`, re-run on the List.js `updated` event). Unlike the prompts page, `handleConfirmClick` here updates the row in place instead of going through `List.values()`, so it clears `dataset.phDecorated` and re-runs the decoration; `sanitizeHtml()` strips the chip markup on the cancel-restore path, so stored text stays clean.
- The `thunderai_custom_` ID prefix (`<i>` before the ID, in both the row and the add-form) is styled like `.id_show` (monospace, muted, non-italic).
- The **`enabled` checkbox** renders as the same **toggle switch** as the prompt properties (`appearance:none` track + `::after` knob, `--accent` when on) — **CSS only**, the `.enabled input_mod` classes and `handleInputChange` are unchanged. Unlike the prompts page there is **no read-only status-icon variant**: this checkbox is never disabled by the row editor, so it stays clickable straight from the row (no Edit/OK round-trip) and only the interactive switch look exists. Default rows (`is_default == 1`) keep the switch look but are dimmed and inert via `:disabled`.

**What it deliberately does not share:** no Copy or "Menu position" row button, no ChatGPT Web / API provider panels, and no `<dialog>` — export/import confirmations still use `confirm()`/`alert()`.
**Visual design.** The page uses the shared design system (see "Shared Design System CSS" below): it is wrapped in `#mzta_card` / `#mzta_body`, settings are `.mzta_field` / `.feature_row` blocks, the two checkboxes render as `.mzta_switch` toggles, and Save/Reset buttons use `.btn_primary` / `.btn_secondary`. Because the page opens in its own full-width browser tab, its `<body>` carries the opt-in **`mzta_feature_page`** class (see "Feature-Page Shell" below), which centers all content in a capped ~760px column on the light `--desk` background and renders each `.mzta_section` as a white rounded card with per-row dividers, a 3px blue section-header accent bar, larger label/help typography, blue focus rings on inputs/selects/textareas, and the two number inputs (`summarize_max_display_length`, `summarize_max_messages`) laid out as compact right-aligned controls (label/description left) via the `.mzta_field_num` wrapper. No form field id/name/value, listener, or persistence logic changes — the page still saves options on `change` and each prompt editor keeps its own Save/Reset buttons (there is no page-level save bar). The two number fields wrap their control in `.mzta_field_num_ctrl` (the max-messages one reuses `.mzta_inline_row` for the reset button + input group). The specific-integration connection UI is injected (via `initializeSpecificIntegrationUI()`) into a `<table id="connection_ui_table">` inside `#mzta_conn_panel`. A small `updateConnPanelTint()` helper in `mzta-summarize.js` (mirroring the options-page one, but scoped to the `summarize_` prefix) colours the panel to the selected provider (`tint_*` class + `#mzta_conn_pill_name`) and hides the whole panel (`display:none`) when `summarize_use_specific_integration` is off, so no empty bordered box shows; it runs on load and on `change` of `summarize_connection_type` / the checkbox. The connection-type select stays a native `<select>` (only the model selects become TomSelect), so the `change` listeners fire normally. Because `_updateVisibility()` sets an inline `display:table-row` on visible connection rows, `mzta-summarize.css` re-asserts `#connection_ui_table tr[style*="table-row"] { display:block !important; }` so those rows still render as stacked fields — no change to the shared `connection-ui.js` is needed.

### Shared Design System CSS (`pages/_lib/mzta-design.css`)

The design-system tokens and reusable components ("variant 2a") live in `pages/_lib/mzta-design.css`, linked by both `options/mzta-options.html` and `pages/summarize/mzta-summarize.html` (**before** each page's own stylesheet, so the page CSS can still override). It defines: the `:root` token block + dark-mode overrides (`--panel`, `--text`, `--dim`, `--line`, `--field`, `--fieldLine`, `--accent`, stats/warn tints), the card shell (`#mzta_card`, `#mzta_body`), header block, `.mzta_section` / `.mzta_eyebrow` / `.mzta_field` / `.mzta_help`, `#mzta_card`-scoped input/select/textarea/button styles (`.btn_primary`, `.btn_secondary`, `.btn_small`), the connection panel + injected-table restyle (`#mzta_conn_panel`, `#connection_ui_table`/`#connection_ui_adv_table`, `#mzta_conn_adv_btn`, `.conn_test_*`), the `.mzta_switch` toggle and `.feature_row`, the advanced-options disclosure (`#mzta_adv_toggle`/`#mzta_adv_panel`), the options-page bottom block (`#miczDescription` + `#mzta_info_guide`, `#mzta_info_row` with `#mzta_disclaimer` + `#mzta_shortcut_strip`, `#mzta_footer` — see "Options Page Bottom Block" below), `.warning`, and the per-provider `tint_*` custom-property blocks (plus the legacy `tr.conntype_*` row-shading colours that `getConnectionTypeColor()` reads). `options/mzta-options.css` now holds only options-specific rules (`#btn_custom_prompts`, `#btnMenuOrder`, footer link ids, `#owl_warning`/`#hyprland_warning`, `#no_sparks`). Adding the design system to another feature page means: link this file first, wrap the page in `#mzta_card`/`#mzta_body`, and use the component classes.

#### Feature-Page Shell (opt-in `body.mzta_feature_page`)

Feature settings pages open in their own full-width browser tab, where stretching controls edge-to-edge hurts readability. Adding `class="mzta_feature_page"` to a page's `<body>` opts into a **shell** whose rules all live at the end of `pages/_lib/mzta-design.css`, every one scoped under `body.mzta_feature_page`. The **main options page does not carry this class**, so it is intentionally excluded and keeps its full-width layout — the shell is reusable across feature pages without touching the options page.

All six special-prompt feature pages now adopt the shell: `pages/summarize/`, `pages/addtags/`, `pages/spamfilter/`, `pages/translate/`, `pages/get-calendar-event/`, and `pages/get-task/`. Each links `../_lib/mzta-design.css` **first**, wraps its content in `#mzta_card` / `#mzta_top_links` (icon + `.mzta_page_title` + `.mzta_page_subtitle`) / `#mzta_body`, renders every settings group as a `.mzta_section` card headed by `.mzta_eyebrow`, uses `.feature_row` + `.mzta_switch` toggles for checkboxes, `.mzta_field` (or `.mzta_field_num` for number inputs) for other controls, and `.btn_secondary`/`.btn_primary` for the per-editor Reset/Save buttons. The specific-integration connection UI is wrapped in `#mzta_conn_panel` / `<table id="connection_ui_table">` (preserving the `connection_ui_anchor` / `connection_ui_end` IDs required by `connection-ui.js`), and each page's JS gained a prefix-scoped `updateConnPanelTint()` (mirroring the summarize one) that tints the panel to the selected provider, sets `#mzta_conn_pill_name`, and hides the whole panel when the page's `<prefix>_use_specific_integration` checkbox is off. Each page's own CSS was slimmed to page-specific rules only (autocomplete dropdown, button row, one `#connection_ui_table tr[style*="table-row"]` override, plus genuinely unique bits such as spamfilter's `#report_data` grid / `#spamfilter_threshold_too_low`, addtags's account-selector and use-list styling). No element `id`/`name`/`.option-input` class changed, so all save-on-`change` and prompt persistence logic is intact.

**addtags auto-toggle change.** In the old table layout, `mzta-add-tags.js` revealed the auto-tagging sub-rows (`add_tags_auto_only_inbox_tr`, `add_tags_auto_uselist_tr`) with `style.display = 'table-row'`. Those rows are now `.feature_row` flex blocks inside a card, so the JS was changed to set `style.display = ''` (revert to the CSS default) instead of `'table-row'`; the rows are hidden by default via the page CSS and toggled on when `add_tags_auto` is checked. The `account_selector_container` (now a `.mzta_section` card) is likewise toggled with `''`/`'none'`.

The shell provides: a light `--desk` page background; a centered, `max-width: 760px` column (`#mzta_card` with `margin: 0 auto` + 24px side padding — below the cap it is naturally full-width-minus-padding, no media query needed); each `.mzta_section` rendered as a white rounded **card** (`--panel`, 12px radius, 24px padding, subtle shadow, 24px vertical gap); section headers (`.mzta_section > .mzta_eyebrow`) get a **3px vertical `--accent` bar**; stacked settings inside a card are separated by thin `--line` **row dividers** (the first row after the header/intro has none); up-sized **typography** (`.opt_title` 15px/600, help/`.feature_desc` 13.5px with `text-wrap: pretty`); a header block with a 25px page title, one-line subtitle, and a small app-icon tile (`.mzta_page_icon` / `.mzta_page_title` / `.mzta_page_subtitle`); **compact number fields** via `.mzta_field_num` (label/description left, ~96px centered input — or reset+input group — right); and **focus rings** (`--accent` border + a 3px `color-mix` accent glow, white background) on inputs/selects/textareas — the only focus styling in the design system, deliberately scoped so the options page is unaffected. All rules reuse existing tokens, so dark mode is inherited. It adds no save bar: pages persist on `change` and keep their per-editor Save/Reset buttons. A new feature page adopts the look by adding the class, giving the header the `.mzta_page_*` markup, and putting its settings in `.mzta_section` cards (number fields in `.mzta_field_num`).

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

### Options Page Bottom Block (`#mzta_bottom`)

Everything below the app-level "Advanced options" row is one wrapper `div#mzta_bottom`
holding three parts in a vertical stack. It replaced five loose blocks (an "Important
Information" `<h1>` eyebrow, the provider setup note with a bracketed `[More info]` link,
a `CTRL+ALT+A` reminder sentence, the boxed LLM disclaimer, and a stacked footer). The
wrapper takes the `#mzta_body > * { margin-bottom: 24px }` rhythm; the parts inside space
themselves with their own `margin-top`.

1. **Provider setup note** (`#miczDescription`) — headed by a plain
   `div.mzta_eyebrow` (`prefs_info_pill`), matching every other section header on the
   page. The box itself is **untinted**: only the body text carries the provider colour,
   as a 3px `--tint-accent` left bar on the `.conntype_<provider> .info_specific` spans
   (`prefsInfoDesc_1/2/3/4/7/8`). The single `#mzta_info_guide` link (`prefs_full_guide`)
   is **moved inside the active provider's span** by `updateDescription()`, so it reads
   inline at the end of that sentence instead of breaking onto its own line below the
   accent bar. The element id is deliberately unchanged so `updateDescription()` keeps
   working.
2. **Disclaimer + shortcut row** (`#mzta_info_row`) — a `space-between` flex row, wrapping
   on narrow windows:
   - **LLM disclaimer** (`#mzta_disclaimer`) on the left, taking the free space
     (`flex: 1 1 260px`). Now **borderless** (no `--warnBorder`/`--warnBg`; those tokens
     are consequently unused, though still defined) — just the amber `--warnColor`
     triangle glyph + `prefs_disclaimer_short` + the privacy link.
   - **Keyboard-shortcut strip** (`#mzta_shortcut_strip`) at the right edge, keeping its
     natural width (`flex: 0 0 auto`): a `--field` box with the `prefs_shortcut_label`
     label and the `#mzta_shortcut_keys` `<kbd>` chips.
3. **Footer** (`#mzta_footer`) — three **plain `<a>` links** on one centered `flex-wrap`
   row (was a stacked column of `<div>`s, each with an introductory sentence before the
   link). The lead-in sentences are gone: `TranslateText` + `TranslateLink` and
   `prefsDonation_1` + `prefsDonation_2` are replaced by the single-label keys
   `prefs_footer_translate` ("Translate the addon") and `prefs_footer_donate`
   ("Make a donation"); release notes keeps `prefs_OptionText_release_notes`. The ids
   `#miczTranslate` / `#miczDonation` / `#miczRelNotes` are preserved (now on the anchors),
   and the donation URL was corrected from `http://` to `https://`.

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
(`pages/_lib/mzta-design.css`).

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
per the localization rule): `prefs_info_pill`, `prefs_full_guide`, `prefs_shortcut_label`,
`prefs_disclaimer_short`, `prefs_footer_translate`, `prefs_footer_donate`.

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
