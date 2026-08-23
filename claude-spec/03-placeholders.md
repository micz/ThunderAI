# Placeholders System

## Overview

Placeholders are dynamic tokens embedded in prompt text that get replaced with real data at runtime (email content, headers, user input, etc.).

**Format:** `{%placeholder_id%}`

Example in a prompt: `"Summarize this email: {%mail_text_body_or_selected%}"`

## Placeholder Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier used in `{%id%}` tokens |
| `name` | string | Display name (i18n `__MSG_key__` or plain text) |
| `default_value` | string | Value used if placeholder cannot be resolved |
| `type` | number | `0` = always, `1` = reading only, `2` = composing only |
| `is_default` | string | `"1"` = built-in (not editable/deletable), `"0"` = custom |
| `is_dynamic` | string | `"0"` = fixed value, `"1"` = dynamic (takes a parameter after `:`) |
| `enabled` | number | `0` = disabled, `1` = enabled |
| `text` | string | Content for custom placeholders only |

## Built-in Placeholders

Defined in `js/mzta-placeholders.js` as the `defaultPlaceholders` array — that
array is the source of truth for IDs. Listed here in source order. `Dyn` marks
placeholders with `is_dynamic: "1"` (take a parameter after `:`).

| ID | Description | Type | Dyn |
|----|-------------|------|-----|
| `mail_text_body` | Full plain text of the email | 0 | |
| `mail_html_body` | Full HTML of the email | 0 | |
| `mail_typed_text` | Text typed so far in compose window (line structure preserved, see below) | 2 | |
| `mail_quoted_text` | Quoted text in the compose window (line structure preserved, see below) | 2 | |
| `mail_subject` | Email subject line | 0 | |
| `mail_folder_name` | Name of the folder containing the email | 1 | |
| `mail_folder_path` | Full path of the folder containing the email | 1 | |
| `mail_headers` | A specific email header by name (dynamic) | 1 | ✓ |
| `mail_full_headers` | All mail headers (key: value format, newline-separated) | 1 | |
| `selected_text` | Only the selected text | 0 | |
| `selected_html` | Only the selected HTML | 0 | |
| `additional_text` | User input field (dynamic, shows input in popup) | 0 | ✓ |
| `junk_score` | Junk score of the email | 1 | |
| `recipients` | Email recipients (To); while composing, the compose window's To field | 0 | |
| `cc_list` | Email CC recipients; while composing, the compose window's Cc field | 0 | |
| `author` | Email sender (reading only — empty while composing, see below) | 0 | |
| `mail_datetime` | Email date and time | 1 | |
| `current_datetime` | Current date and time | 0 | |
| `account_email_address` | Email address of the current account/identity | 0 | |
| `tags_current_email` | Tags currently on the email | 0 | |
| `tags_full_list` | All available tags in Thunderbird | 0 | |
| `thunderai_def_sign` | Default signature name (`default_sign_name` pref) | 0 | |
| `thunderai_def_lang` | Default response language (`default_chatgpt_lang` pref) | 0 | |
| `thunderai_translate_lang` | Target translation language (`translate_lang` pref) | 0 | |
| `thunderai_translate_exclude_lang` | Language to exclude from translation | 0 | |
| `empty` | Empty string (placeholder that resolves to nothing) | 0 | |
| `mail_attachments_info` | Information about the email's attachments | 1 | |
| `mail_text_body_or_selected` | Plain text body, or selected text if any | 0 | |
| `mail_html_body_or_selected` | HTML body, or selected HTML if any | 0 | |

### Newline contract of the compose placeholders

`mail_typed_text` and `mail_quoted_text` are the only placeholders whose value is extracted by
walking the compose window's DOM (`getOnlyTypedText` / `getOnlyQuotedText` in
`js/mzta-compose-script.js`, consumed at `js/mzta-menus.js` → `getMailBody()`). Both carry the
mail's real line structure: **one `\n` between lines, one blank line (`\n\n`) between paragraphs**,
identically in a plain text compose window, in HTML "Body Text" mode and in HTML "Paragraph" mode.

They are cleaned with `cleanupNewlinesKeepParagraphs()` rather than `cleanupNewlines()` — the
latter collapses `\n{2,}` to `\n` and would destroy the blank line. Do not switch them back, and
do not relax `cleanupNewlines()` itself: its other callers feed `{%selected_text%}`,
`{%mail_text_body%}` and the diff picker's original side, which depend on the stricter rule.

Full rationale in [01-architecture.md](01-architecture.md) → *The compose-extraction newline
contract*. [#829]

Both functions also normalize the **non-breaking space** — the `&nbsp;` entity *and* the literal
U+00A0 that `DOMParser` produces from it — to a plain space, before the whitespace rules run so the
result collapses like any other space. Never drop it instead: that welds words together. Full
rationale in [01-architecture.md](01-architecture.md) → *Non-breaking spaces, and the order of the
cleanup rules*.

### The address placeholders in the compose window

`recipients` and `cc_list` are `type: 0`, so they are offered while composing too. `curr_message` is
**not** the same object in the two contexts, and it is never a hybrid: `js/mzta-menus.js` assigns the
raw `browser.compose.getComposeDetails()` result in a compose tab, and a MessageHeader in the mail-tab
and message-display branches.

**Field names differ.** MessageHeader exposes `recipients` / `ccList`, ComposeDetails exposes `to` /
`cc`, so `getPlaceholdersValues()` reads `curr_message.recipients ?? curr_message.to` and
`curr_message.ccList ?? curr_message.cc`. Use `??`, not `||`: it selects on field *presence*, so the
common `ccList: []` (a read message with no Cc) does not make the reading path fall through to a
ComposeDetails field that does not exist on a MessageHeader.

**Entry types differ.** A MessageHeader's arrays hold plain address strings, but ComposeDetails
`to`/`cc` entries are either plain strings (`"Name <a@b.com>"`) **or** address book references shaped
`{id, type}` (contacts and mailing lists). `joinAddressList()` (`js/mzta-utils.js`) therefore keeps
only string entries before joining — a bare `.join(", ")` would put `[object Object]` into the prompt.
Address book references are **dropped, not resolved**: resolving them needs the optional
`addressBooks` permission, which the add-on does not request. A field holding nothing but references
resolves to an empty string.

`joinAddressList()` returns a non-array value untouched, so an absent field reaches
`sanitizeMailHeaders()` / `failSafePlaceholders()` unchanged.

**Known gap — `author`.** It is `type: 0` as well, but resolves only `curr_message.author`, so it is
empty in a compose tab (the ComposeDetails equivalent is `from`). Fixing it is not the same shape as
the two above: `from` is a *scalar* that can also be an `{id, type}` reference, so it needs a scalar
`typeof` guard rather than an array filter. It is also semantically debatable — while composing the
"author" is the user's own identity, which `account_email_address` already exposes via
`getCurrentIdentity()`.

**Not visible in the calendar-event flow.** `finalizePrompt_get_calendar_event()`
(`js/mzta-utils-prompt.js`) strips `{%cc_list%}` and `{%recipients%}` out of the prompt entirely for
that flow, so it is unaffected by any of the above by design.

## Dynamic Placeholders

Dynamic placeholders use a colon separator to pass a parameter:

```
{%additional_text:my_field_id%}   →  shows an input field labelled "my_field_id" in the popup
{%mail_headers:x-spam-score%}     →  fetches the X-Spam-Score header value
```

The `is_dynamic: "1"` property signals this behavior in the placeholder definition.

## Placeholder Autocomplete

`textareaAutocomplete()` in `js/mzta-placeholders-autocomplete.js` provides the `{%…` autocomplete
dropdown, and is shared by **8 pages**: customprompts, customdataplaceholders, translate, summarize,
addtags, spamfilter, get-task, get-calendar-event. Suggestions are built from
`getPlaceholders(true)` mapped through `mapPlaceholderToSuggestion()`.

**Type filtering.** A placeholder is offered only if its `type` equals the prompt's selected type, or
its type is `0` ("always"). The type is read **lazily on every keystroke**, so changing the selector
mid-edit takes effect immediately with no re-registration.

- The 6 single-textarea pages pass an explicit `type_value` (all currently `1`, "reading").
- The two table-based CRUD pages (customprompts, customdataplaceholders) pass no type and instead
  resolve it from the row: `textarea.closest('tr')` → `.type_output`. This **must** use `closest()`,
  not a fixed `parentNode` chain — the editor markup nests the textarea inside a backdrop wrapper
  (see `claude-spec/05-options.md`), and a fixed chain silently breaks type filtering, throwing on
  every keystroke inside an `input` handler.

**Insertion.** Accepting a suggestion inserts through `document.execCommand('insertText')`, falling back
to `setRangeText()` plus a synthetic `input` event. A direct `textarea.value = …` assignment must not be
used: it discards the native undo stack and fires no `input` event, which leaves the edit-mode highlight
mirror painting stale text while the caret advances over glyphs that never get repainted. For the same
reason the list items handle **`mousedown` with `preventDefault()`**, not `click` — a click lets the
textarea lose focus and collapse its selection before the insertion runs. Completing a dynamic
placeholder leaves the caret before the trailing `:%}` so the value can be typed immediately.

**Positioning.** The dropdown is `position: fixed` and placed at the caret by JS. Fixed, not absolute:
on the two table pages an absolutely positioned list is clipped by the surrounding `<td>`. The caret
rect comes from the highlight mirror (`getCaretRect()` on the handle returned by
`attachEditorHighlight()`), which plants a zero-width anchor at `selectionStart` and measures it — no
caret-position library. The list flips above the caret when there is not enough room below and clamps
horizontally into the viewport. It **closes** on `scroll`/`resize` rather than repositioning, since a
fixed element's coordinates go stale as soon as any ancestor scrolls.

**All 9 textareas have a mirror.** Every page that offers the autocomplete also attaches
`attachEditorHighlight()`, so tokens are highlighted and the list is caret-anchored everywhere — the two
table pages (add-form + row editor) plus the eight single textareas on the six settings pages (summarize
has three). `caretRect()` still falls back to the bottom-left of the textarea when no mirror is present,
so a new page that forgets the attach degrades gracefully rather than breaking.

**Lifecycle.** `textareaAutocomplete()` is idempotent, guarded by `textarea._mztaAutocomplete`, and
returns a handle with `close()` and `destroy()`. There is **one** module-level outside-click controller
for the whole page, tracking open instances in a `Set`; the previous version registered a `document`
click listener *inside* the per-textarea function, so a page with N rows accumulated N listeners each
closing over a possibly-removed textarea. Dismissal tests the event against the instance's own textarea
and list — the old check was `e.target.closest('.editor')`, a class only the two table pages use, so on
the other six clicking inside the textarea dismissed the list.

**Item presentation.** Each `<li>` shows the token in monospace with the already-typed prefix in `<b>`,
plus a muted second line with the placeholder description. `mapPlaceholderToSuggestion()` was extended
**additively** with `id` and `label`; `label` resolves `__MSG_key__` names via `browser.i18n.getMessage()`
(built-in placeholders store raw tokens, and `mzta-i18n.js` only localizes the DOM). An item with no
`label` renders the command alone, so any consumer building suggestion objects by hand still works.

**Accessibility.** `role="listbox"` on the `<ul>`, `role="option"` + `aria-selected` on items,
`aria-autocomplete`/`aria-expanded`/`aria-controls`/`aria-activedescendant` on the textarea. `Tab`
accepts the active item like `Enter` (rather than moving focus away mid-token), `Escape` closes, and
arrow keys wrap around with `scrollIntoView({ block: 'nearest' })`.

**Shared CSS — highlighting.** The mirror's *structure* lives in **one** file,
`pages/_lib/editor-highlight.css`, linked by all 8 pages. The three metrics that legitimately differ
between pages plus the colours are custom properties a page must define on `.editor-wrap`:
`--ed-padding`, `--ed-font`, `--ed-line-height`, `--ed-surface`, `--ed-surface-focus`, `--ed-border`,
`--ed-chip-bg/-fg`, `--ed-warn-bg/-fg/-border`. The design-system pages get them from
`#mzta_card .editor-wrap` in `mzta-design.css` (9px 11px / inherit / 1.6, matching that file's own
textarea rules); the two table pages set them locally (7px 10px / mono / 1.55).

**Specificity trap on the `#mzta_card` pages.** `mzta-design.css` styles fields with `#mzta_card textarea`
— **(1 id, 0 classes, 1 element)**, which beats `editor-wrap .editor` **(0, 2, 1)** no matter how late
the shared file loads, because a single id outranks any number of classes. The textarea therefore stayed
opaque with black text and hid the mirror completely: the visible text was the textarea's, not the
mirror's. The `background: transparent; color: transparent` pair is consequently **repeated** in
`mzta-design.css` under `#mzta_card .editor-wrap .editor`, and again for `:focus` (which has to come
*after* the design system's own `…textarea:focus` rule, being of equal specificity). Keep the two copies
in sync. The remaining metrics (`padding`, `font-size`, `line-height`, `box-sizing`, `border-width`) are
also won by the design system, which is harmless *only because* the `--ed-*` values were chosen to match
them exactly — change one side and the mirror drifts.

The chip colours there come from dedicated `--code` / `--codeBg` tokens, added to both theme blocks of
`mzta-design.css` with the same values as the two table pages' `--code` / `--code-bg`. Do **not** reach
for `--accentLight`: it is a 6%-alpha wash (`#0a68ff0f`) intended for large hover surfaces, and a
token-sized chip painted with it is invisible (1.09 contrast against `--field`) — which is exactly how
the first attempt shipped no visible highlight on those six pages. The same caution applies to
`--warnBg`/`--warnBorder`, which are also low-alpha washes. Fallbacks in the shared
file are deliberately inert (`transparent`/`inherit`/`0`) so a page that forgets one renders *no*
highlight rather than a misaligned mirror. Only the two table pages add rules of their own, for the
`.editor-active` visibility gating.

**Shared CSS — dropdown.** All 8 pages link `pages/_lib/autocomplete.css`, which replaced 8 near-duplicate blocks.
Because the pages use two disjoint token systems, every token there uses a fallback chain
(`var(--field, var(--panel))`, `var(--fieldLine, var(--border2))`, `var(--muted, var(--dim))`,
`var(--accentLight, var(--rowhover))`); `--text` and `--accent` exist in both and need none.
`--font-mono` was added to `pages/_lib/mzta-design.css` so one name works everywhere. Do **not** link
`mzta-design.css` from the two table pages — its `:root` would fight their local one. The shared file
must be linked **after** the page's own stylesheet.

## Invalid placeholder feedback

The highlight mirror flags tokens that will not resolve. `makeTokenStateResolver()` in
`js/mzta-editor-highlight.js` builds the per-token callback; a page installs it with
`handle.setTokenStateResolver(...)`.

| State | Rendering |
|---|---|
| Valid placeholder (including dynamic `{%id:value%}`) | normal chip |
| Unknown id, or valid id not available for the prompt's type | warning chip + `title` |
| Unterminated `{%` with no closing `%}` | warning chip + `title` |

The first two states are also rendered in **read mode** on the Manage Custom Prompts page, where
`decoratePromptText()` marks an unresolvable token with `.ph_chip_invalid_read` + the same
`editor_placeholder_unknown` title. The third cannot occur there: that function matches only complete
`PLACEHOLDER_RE` tokens, so an unterminated `{%` is simply left as plain text.

**One predicate, three callers.** `placeholdersUtils.findPlaceholder(inner, activePHs, type = null)` is the
resolution rule, factored out of `extractPlaceholders()` and called by both, so the editor cannot disagree
with what the prompt will actually resolve at runtime. `decoratePromptText()` on the Manage Custom Prompts
page is the third caller, so the read-only list, the live editor and the runtime all share one definition
of a resolvable placeholder. It is **sync** and takes an already-fetched list,
because the backdrop runs on every keystroke and cannot `await`. The `type` argument is **optional**:
`extractPlaceholders()` omits it, preserving its previous behaviour exactly (it ignores type entirely),
while the editor supplies the prompt's selected type so a reading-only placeholder in a composing prompt
is flagged. Verified equivalent to the old inline `find` across the token forms the regex produces.

A prompt of type `0` accepts placeholders of **any** type here, deliberately diverging from the
autocomplete's stricter filter (quirk 2 below, left as is): a type-0 prompt runs in both contexts, so a
type-1 placeholder in it does resolve at runtime, and replicating the dropdown's strictness would paint a
warning over valid text. Validity matrix: type 0 accepts all; type 1 rejects composing-only; type 2
rejects reading-only; an unknown id is always flagged.

`makeTokenStateResolver(find, placeholders, getType)` takes the predicate **injected**, not imported:
`mzta-editor-highlight.js` is loaded by every editor page, and importing `mzta-placeholders.js` there
would pull its whole dependency chain along.

**The token under the caret is never flagged.** Typing `{%mail_su` would otherwise flash a warning on
every keystroke. `chip()` reads `textarea.selectionStart/End` live rather than taking an offset argument,
because the ordinary repaint path (`refresh()`, on every `input`) passes none.

**Re-validation on type change.** Validity depends on the prompt type, and the mirror caches its render,
so `attachHighlightWithValidation()` on the two table pages adds a `change` listener to the row's
`.type_output` (or `#selectTypeNew` in the add-form) that calls `refresh()`. There was no listener on
those selectors before — the autocomplete reads the type lazily per keystroke and never needed one.
The six settings pages pass a constant type `1`, matching the `type_value` they give the autocomplete.

**Validation list vs suggestion list.** The six settings pages filter `additional_text` out of their
*suggestions* but validate against the **unfiltered** list: it is a real placeholder they simply do not
offer, and flagging it would be wrong. The Data Placeholders page is the opposite — its built-ins-only
restriction is semantic, so the same filtered list drives both.

**Colours.** `--ed-warn-bg/-fg/-border`, from `--warn-*` on the two table pages and `--warnChip*` in
`mzta-design.css`. Those chip tokens are opaque on purpose: `--warnBg`/`--warnBorder` are 7%/28% alpha
washes for large disclaimer panels and are invisible at chip size — the same trap as `--accentLight`.
Tooltips use `editor_placeholder_unknown` / `editor_placeholder_unterminated` (English only).

Known quirks (documented, not currently fixed): a prompt of type `0` sees *only* type-0 placeholders,
hiding type-1 and type-2 ones; `getPlaceholders(true)` returns the list unsorted, so the dropdown is
in declaration order rather than alphabetical; and `setCustomPlaceholders()` never assigns `type`,
so custom placeholders may not match the filter at all.

## Custom Placeholders

Users can define their own placeholders via `pages/customdataplaceholders/`. Custom placeholders:
- Have `is_default: "0"`
- Have a `text` property containing the replacement value
- Are stored in `browser.storage.local`
- Are merged with default placeholders at runtime before prompt processing

## Placeholder Resolution Order

1. Built-in placeholders are defined in `js/mzta-placeholders.js`
2. Custom placeholders are loaded from storage
3. At runtime, `mzta-background.js` gathers email data (via Thunderbird APIs)
4. Each `{%id%}` token in the prompt string is replaced with the resolved value
5. If a value cannot be resolved, `default_value` is used as fallback

## Adding a New Built-in Placeholder

1. Add the object to the `defaultPlaceholders` array in `js/mzta-placeholders.js`
2. Add the `name` i18n key to `_locales/en/messages.json` as `placeholder_<id>` (or choose a descriptive key)
3. Implement the resolution logic in the relevant section of `mzta-background.js`
