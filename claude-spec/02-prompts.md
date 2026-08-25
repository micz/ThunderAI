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

> **Note:** These numeric-looking properties are stored as **strings** (`"0"`/`"1"`/`"2"`) in the prompt objects in `js/mzta-prompts.js`, not as JS numbers. The prompt body lives in the `text` property (there is no `prompt` property).

#### The five boolean flags are normalized on read

`need_selected`, `need_signature`, `need_custom_text`, `define_response_lang` and
`use_diff_viewer` are collectively `promptBooleanFlags` in `js/mzta-prompts.js`. Their
**canonical representation is the string `"0"`/`"1"`**, and that is guaranteed at read time —
consumers may compare against `"1"` without caring which store the prompt came from.

Three representations used to coexist for the same field: the built-in arrays declare strings,
the Custom Prompts editor writes **numbers** (`1`/`0`), and `setDefaultPromptsProperties()`
used to write **`""`** for a missing value. That empty string was the worst of the three,
because it is out of domain in both directions: the editor's `checkSelectedBoxes()` asked *"is
it `"0"`?"* and so rendered anything else — `""` included — as **on**, while every consumer
asks *"is it `"1"`?"* and read the very same value as **off**. A default prompt could therefore
show "Ask for additional text" enabled and not ask for it.

`normalizePromptFlags(prompt, fallbacks)` collapses all of this: `1`/`"1"`/`true` → `"1"`,
everything else → `"0"`, with every key guaranteed present. It is mutating, idempotent and
single-prompt, mirroring `normalizeEnabledToShowIn()`. The `fallbacks` argument supplies the
value for an out-of-domain input — default and special prompts pass their **built-in
definition**, so a corrupted override reverts to what the prompt ships with instead of being
forced off (which would silently disable `prompt_reply_custom_command`, whose built-in is
`"1"`).

It is applied in the **three producers**, not in `getPrompts()`. That placement is deliberate:
`getSpecialPrompts()` is exported and called *directly* — by `buildSummaryPrompt()` /
`buildTranslationPrompt()` in `js/mzta-utils-prompt.js` and by the six feature pages — so it
bypasses `getPrompts()` entirely. Normalizing only in `getPrompts()` would leave the whole
summarize/translate path uncovered.

| Site | Fallback |
|---|---|
| `getDefaultPrompts_withProps()` | the built-in prompt, captured before the stored properties overwrite it |
| `getCustomPrompts()` | none — custom prompts have no built-in, so out of domain means off |
| `getSpecialPrompts()` (both branches) | the matching entry in `specialPrompts` |
| `preparePromptsForImport()` | none — a backup file carries whatever the writing version used |

`setDefaultPromptsProperties()` also stops emitting `""`, closing the original source.

Because there is no separate storage migration, repair is **lazy but automatic**: a corrupted
value is normalized on the next read and consolidated on the next save. This flips the
wholesale re-writers — `pages/menu_order/` and `migrateMenuOrderAlphabetic()`, which rewrite
all three stores from `getPrompts()` — from perpetuating the corruption to repairing it.

The Custom Prompts editor writing numbers is left alone on purpose: the read-side
normalization absorbs it. The deliberately loose comparisons in consumers
(`api_webchat/controller.js`, `api_webchat/messagesArea.js`) are likewise untouched — with the
domain guaranteed upstream they are harmless, though note they are only *accidentally* safe
against numbers today (`==` coercion, `String()`, or template interpolation), so tightening one
to `===` without the normalization in place would have silently broken it.

> **`need_custom_text` is the only one of the five persisted for default prompts** — it is in
> the `allowedKeys` list in `preparePromptsForExport()` and the only flag written by
> `setDefaultPromptsProperties()`. The other four always come from the built-in array, which is
> why the corruption above could only ever affect `need_custom_text`.

### The picker prompts send HTML — except one

The three prompts with `use_diff_viewer: "1"` are **not uniform**, and the difference is deliberate:

| prompt | placeholder | sends |
|---|---|---|
| `prompt_rewrite_formal` | `{%selected_html%}` | HTML |
| `prompt_rewrite_polite` (`prompt_rewrite_full_text`) | `{%mail_html_body_or_selected%}` | HTML |
| `prompt_proofread_this` | `{%mail_typed_text%}` | **plain text** |

Sending HTML is what lets the picker preserve formatting: the model answers in HTML, the answer
skips markdown-it and is sanitized instead (see [01-architecture.md](01-architecture.md) → *When the
answer is HTML*), and the picker diffs markup against markup.

**`prompt_proofread_this` stays on plain text** because there is no `mail_typed_html`
*placeholder*: `getOnlyTypedText` (`js/mzta-compose-script.js`) returns text, not markup, so what
reaches the **model** is text. That text is no longer *flat* — since [#829] the walk preserves
line structure (`<br>` → `\n`, block boundaries → `\n\n`; see
[01-architecture.md](01-architecture.md) → *The compose-extraction newline contract*), so the
picker's original side is genuine multi-line text rather than one run-together line. What the
*prompt* still lacks is inline markup. Adding it would mean a `getOnlyTypedHtml` handler — same
walk, same `moz-cite-prefix`/`moz-forward-container` breaks — plus a `mail_typed_html`
placeholder. Not done; the cost is recorded here so the asymmetry does not read as an oversight.

> **The picker's original side is no longer part of that gap.** `getMailBody()` now returns an
> `only_typed_html` field, read back off the range `do_autoselect` already creates, so a prompt
> substituting `mail_typed_text` into `selection_text` gets a matching `selection_html`. See
> [07-diff-picker.md](07-diff-picker.md) → *The `mail_typed_text` substitution must carry its
> twin*. That closes the diff-picker half of the asymmetry; the placeholder half above is still
> open.

The consequence is that **both shapes are live at once**, and the picker handles both: with
proofread the original side arrives as text and `_buildDiffButton` falls back to `textToBlockHtml()`.

> Changing a prompt from no-placeholder to a placeholder also changes which branch of
> `preparePrompt()` (`js/mzta-utils-prompt.js`) builds it: without one, the content is appended in
> quotes; with one, the placeholder supplies it. That is why `prompt_rewrite_polite` needed a
> placeholder added rather than just a reworded sentence.

> **Reachability:** The popup and context menus are the only ways to invoke a prompt (the keyboard shortcut just opens the popup, which re-filters by `show_in`). Reachability is therefore fully determined by `show_in`: a prompt with `show_in === "none"` is in no menu and cannot be invoked. The old `enabled` (0/1) flag was removed — it was redundant with `show_in === "none"`. `getPrompts(onlyReachable = true, ...)` filters out prompts with `show_in === "none"`. See the `migrateEnabledToShowIn()` migration below for the one-time conversion of legacy data.

### User Properties (stored per-prompt in storage)

| Property | Type | Description |
|----------|------|-------------|
| `position_display` | number | Sort order for the popup menu in reading view |
| `position_compose` | number | Sort order for the popup menu in compose view |
| `position_context` | number | Sort order for the context menu |
| `show_in` | string | `"popup"` = popup only, `"context"` = context menu only, `"both"` = both, `"none"` = in no menu (unreachable). Default: `"popup"` for default/custom prompts, `"both"` for special prompts. **`show_in` is the single source of truth for reachability** — there is no separate enabled/disabled flag. |
| `custom_icon` | string | Filename (with extension) of an icon in `images/context_menu/custom/`. A single shared value: the same icon is used in **both** the context menu and the popup menu. Empty string = fall back to the prompt's built-in icon (see Icon Resolution), which for most prompts is not "no icon". Used for **all** prompts, special ones included: a chosen `custom_icon` overrides even a special prompt's hard-coded icon. Selectable from the icon picker on the Menu Order page — in every list of both panels; that page is the only place icons are chosen. |

### Per-Prompt API Override Properties

Each prompt can override the global API connection. These mirror the keys in `integration_options_config` and `prefs_default`:

| Property | Description |
|----------|-------------|
| `api_type` | Override API type for this prompt. **Note the name:** on the *prompt object* the property is `api_type`; `connection_type` is the *pref* name (global `connection_type` and the per-feature `{prefix}_connection_type`). `getConnectionType()` reads `prompt.api_type`. |
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

### Missing special prompts

The lookup helpers in `js/mzta-prompts.js` (`getSpamFilterPrompt()`, `getAddTagsPrompt()`, `getSummarizePrompt()`, …) are `Array.find()` over `_special_prompts` and return `undefined` when the user has removed or corrupted the entry. Every caller must guard before using the result, and `taPromptUtils.getDefaultLang()` uses optional chaining so a missing prompt yields `''` (no forced language) instead of throwing (issue #855).

Guarded callers, each reporting through the mechanism its feature already has:
- Auto add-tags (`mzta-background.js`): logs an error and sets `skipAddTags = true`, leaving the rest of the message pipeline running.
- Spam filter (`mzta-background.js`): logs an error, then `spamReport.saveError()` + `updateSpamPanel(…, "showSpamReport", …)` and returns `{ success: false }`. `saveError()` goes through `saveReportData()`, which clears the session `processing` flag — without this the message would stay stuck showing "check in progress". The text passed to `saveError()` becomes the report's `explanation` and is rendered in the spam panel, so it must be localized (`spamfilter_prompt_missing_explanation`), like the other skip-reason explanations; only the `taLog.error()` line stays English.

`spamReport.saveError(data_id, error_message, metadata = {})` takes an optional third argument that is spread over the stored record. `_generateSpamReportForMessage()` captures a `message_metadata` snapshot via `_buildReportMetadata()` (subject / from / message_date) and passes it to every `saveError()` call except the "Message not found" one, so error rows in the spam log keep their subject, sender and date columns instead of rendering `undefined`. The snapshot prefers the `getFull()` MIME headers and falls back to the `MessageHeader` fields (`message.subject` / `message.author` / `message.date`), which stay readable when a user filter deletes or moves the message mid-analysis. `subject` and `from` are therefore arrays (MIME header shape) — the log table in `pages/spamfilter/mzta-spamfilter.js` joins them with `Array.isArray(...) ? .join(", ") : ...`, so any fallback value must be array-wrapped too. The renderer tolerates records written before this change: a missing `message_date`, `from` or `subject` renders as an empty cell rather than "Invalid Date" / "undefined". `getAllReportData()` resolves to `{}` (never `undefined`) when nothing has been screened, so the `spamfilter_no_reports` placeholder is appended as a `colSpan=8` row inside `#report_data_body` — `#report_data` is the `<table>` itself, so writing to it would remove the header row and the tbody.

## Menu System

### Icon Resolution

Two functions in `js/mzta-utils.js`, used by both menus and by the Menu Order picker. **Special and non-special prompts follow the same rules** — the only difference is where their built-in icon comes from.

`getBuiltInPromptIcon(promptId)` returns the icon a prompt *ships* with, ignoring any user choice (`''` when none):

1. **Special prompts** — hard-coded icon via `specialPromptToContextMenuID` → `contextMenuIconsPath`
2. **Other default prompts** — `defaultPromptIconsPath`, keyed by prompt id (e.g. `prompt_proofread_this` → `images/context_menu/proofread.png`)

`getContextMenuIcon(prompt)` resolves what is actually displayed, returning a `moz-extension:`-prefixed path or `''`:

1. **`custom_icon`** — a user-chosen icon in `images/context_menu/custom/`. Wins for **every** prompt, special ones included
2. **`getBuiltInPromptIcon()`** — the shipped icon, i.e. what clearing `custom_icon` reverts to
3. `defaultContextMenuIcon` (`''`)

All 8 prompts in `defaultPrompts` have a built-in icon, as do the 7 special prompts that appear in menus — so every shipped prompt has an icon, and only user-created custom prompts start with an empty slot. (`specialPrompts` holds 9 entries; `prompt_summarize_email_template` and `prompt_summarize_email_separator` are not menu items and have no icon.)

To give a new default prompt a shipped icon, drop the PNG in `images/context_menu/` (not in `custom/` — that folder is the user-selectable picker grid) and add one entry to `defaultPromptIconsPath` — no other code changes are needed, since both menus and the Menu Order preview go through these two functions.

`custom_icon` on special prompts persists in `_special_prompts` (whole prompt objects), so no storage-shape change was needed; `getSpecialPrompts()` normalizes a missing `custom_icon` to `""` for prompts saved before icons became selectable.

### Popup Menu
- Displays prompts filtered by `show_in` (`"popup"` or `"both"`) and by tab context (`type` property: reading view shows types `0`+`1`, compose view shows types `0`+`2`)
- Ordering: always position-based using `position_display` (reading view) or `position_compose` (compose view). Alphabetical ordering has been removed
- Special prompts retain their colored background (CSS class `special_prompt`) in the popup based on `is_special == "1"`
- Icons: each row shows the prompt's icon, resolved by `getContextMenuIcon()` and passed through in `addShortcutMenu()` as `custom_icon`. Each prompt shows its `custom_icon` if set, otherwise its built-in icon (see Icon Resolution). Icons here are **display-only** — they are chosen on the Menu Order page. The 16px slot is always rendered (blank via `.mzta_item_icon_empty` when there is no icon) so labels stay aligned

### Context Menu
- Dynamically built from all prompts with `show_in` set to `"context"` or `"both"`, filtered to reading types only (`type` 0 or 1)
- Appears as a "ThunderAI" submenu in the `message_list` context
- Ordering: position-based using `position_context` (fallback to alphabetical only when positions are equal)
- Special prompts (add_tags, spamfilter, summarize, translate) route through `processEmails()` for batch processing; regular prompts execute via `menus.executeMenuAction()`
- Icons: resolved by `getContextMenuIcon()` (see Icon Resolution) — a user-chosen `custom_icon` first, otherwise the prompt's built-in icon (`contextMenuIconsPath` for special prompts, `defaultPromptIconsPath` for the other defaults). Prompts with no icon get none: `defaultContextMenuIcon` is `''`, so `menuOpts.icons` is left unset
- Add Tags in context menu assigns tags automatically (`addTagsAuto: true`), while in the popup it shows the interactive tag selection form

### Menu Order Page (`pages/menu_order/`)

Dedicated page for reordering, enabling, and disabling menu items across both the popup and the context menu. Opened from the options page via the "Menu Order" button.

**UI layout** — two side-by-side panels:
- **Popup Menu panel**: sub-tabs for "Reading" / "Composing" switch the list between `position_display` / `position_compose` ordering and between the allowed types (`0`+`1` vs `0`+`2`)
- **Context Menu panel**: single list ordered by `position_context`. Items with `type: "2"` (composing-only) are never shown here

Each list has two sections:
- **Visible items**: active for the menu (`show_in` includes the menu), draggable to reorder
- **Hidden items**: inactive for the menu (`show_in` excludes the menu), sorted alphabetically

**Row icons** — every row in every list of both panels shows an icon slot (rendered in `renderListItems()`, between the drag handle and the name). **Every** prompt gets the same clickable picker (`buildIconPicker()` → `openIconPopover()`, a grid of `customMenuIcons` plus a first "restore default" cell) — special prompts included, so their hard-coded icon can be overridden. Selecting writes `custom_icon` on the in-memory prompt and calls `markUnsaved()`; it is persisted by the normal save flow (`_special_prompts` for special prompts, `_default_prompts_properties` for the rest). The preview is drawn by `applyIconToPreview(preview, filename, promptId)`, which falls back to `getBuiltInPromptIcon(promptId)` when no `custom_icon` is set. The first popover cell clears `custom_icon`, and previews the built-in icon (tooltip `menu_order_icon_default`, "Default icon") rather than an empty slot; it shows the greyscale `empty_icon.png` with tooltip `menu_order_icon_none` only for prompts that have no built-in icon, i.e. user-created custom ones. That placeholder carries an `icon_picker_none_empty` class so the dark-mode `filter: invert(1)` applies to it alone and never to a real color icon. Because `custom_icon` is a single shared value and the panels render the same prompt objects, an icon chosen in one panel shows in the other. Rendering the slot in all lists is what makes composing-only (`type: "2"`) prompts reachable, since they never appear in the context panel.

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

**Cross-tab reload** — the page listens on `browser.storage.onChanged` for changes to `_default_prompts_properties`, `_custom_prompt`, or `_special_prompts`. When one of those keys changes (e.g. user saves from the Custom Prompts page in another tab), the page reloads its data with a 200ms debounce. Any unsaved local changes are discarded to avoid overwriting the other page's work; the reloader calls `markSaved()` so the page also drops its dirty state and does not warn about changes it just threw away.

**Unsaved-changes tracking** — every mutating interaction (drag, icon pick, Reset all) funnels through `markUnsaved()`, which sets the module-level `somethingChanged` flag, enables `#btnSaveAll` and shows the red `customPrompts_unsaved_changes` banner in `#msgDisplay`. `markSaved()` is the inverse (flag cleared, button disabled, banner hidden). A `beforeunload` listener calls `event.preventDefault()` while `somethingChanged` is set, so closing the tab or navigating away with a pending Save All raises Thunderbird's native confirmation dialog — the same mechanism as the Custom Prompts and Custom Data Placeholders pages (Thunderbird 128+ only; the extension supplies no text for that dialog). Note `saveAll()` clears the flag **after** its `await`s complete, so a failed write leaves the warning armed.

**Reset all** — a `#btnResetAll` button in the command palette (next to Save All, always enabled) restores the factory state of everything this page customizes, via `resetAll()`:
- **Order**: prompts are re-sorted with special prompts first (alphabetically by resolved display name), then all the others alphabetically, and get sequential positions assigned to `position_display` = `position_compose` = `position_context`. This is the same factory ordering `migrateMenuOrderAlphabetic()` produces for a fresh install.
- **Visibility**: `show_in` is restored from `getFactoryShowIn(promptId)` (exported by `js/mzta-prompts.js`), which reads the value declared in the built-in `defaultPrompts` / `specialPrompts` arrays and falls back to `"popup"` for user-created custom prompts. So context-only special prompts (`prompt_spamfilter`, `prompt_summarize`, `prompt_translate_this`) land back in the popup panel's Hidden section, not the Visible one.
- **Icons**: `custom_icon` is cleared to `""` on every prompt, which is all that is needed — the resolution chain falls back to `getBuiltInPromptIcon()` (see Icon Resolution), so shipped icons return and prompts with no built-in icon go back to no icon.

The reset is **in-memory only**: it closes any open icon popover, clears the deep-link highlight, re-renders both panels and calls `markUnsaved()` — exactly like a drag or an icon pick. Nothing is persisted until Save All, so reloading the page discards it; that is why there is no confirmation dialog. `allExcludedSpecialPrompts` is deliberately untouched, since those rows are not shown and are re-appended verbatim by the save flow.

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

`getActiveSpecialPromptsIDs()` in `js/mzta-utils.js` maps feature prefs to active special prompt IDs.

Each prompt requires **two** conditions: its feature flag is on, **and** its feature's connection can drive an API. The second is judged per feature, never globally: the function takes an `effective_conn` map — one already-resolved connection type per prefix in `special_prompts_with_integration` — and tests it with `isApiUsableConnection()`. `_computeActiveSpecialIds()` in `mzta-background.js` is the only caller; it builds the map with `getConnectionType(prefs, null, prefix)`, so a feature with `use_specific_integration` stays available even when the global connection is ChatGPT Web or unset. Getting this wrong hides working features from the menus while the options page still shows them enabled.

The `storage.sync.get` feeding it **must** include `getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])`. Without those keys `getConnectionType()` reads `use_specific_integration` as `undefined` and silently falls back to the global connection — the failure is invisible at the call site, which still looks correct.

Notable dependency:

- `prompt_get_calendar_event_from_clipboard` is emitted only if **both** `get_calendar_event` and `get_calendar_event_from_clipboard` are active. If `get_calendar_event` is off, neither calendar prompt is shown regardless of the clipboard pref. Both share the `get_calendar_event` prefix for the connection check.

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
