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
| `mail_plain_text_part` | The original `text/plain` MIME part, verbatim (no HTML conversion) | 1 | |

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

### Newline contract of the body placeholders

`mail_text_body` and `mail_text_body_or_selected` carry the opposite contract to the compose ones:
**one `\n` per HTML block boundary, and never a blank line.**

**Two different extractions produce them**, and confusing the two is the classic mistake here:

| Path | Extraction |
|---|---|
| Interactive (menu / popup) — what a user prompt actually hits | `getTextOnly` → `mztaHtmlNodeToLines(getCleanBodyHtml())` (`js/mzta-compose-script.js`), then `normalizePlain()` in `js/mzta-menus.js` |
| Automatic (background) — auto add-tags, spam filter, on-receive | `htmlBodyToPlainText()` = `normalizePlain(htmlToLines(html))` (`js/mzta-utils.js`) |

Both share **one** projection, `js/lib/mzta-html-lines.js`: `<br>`/`<hr>` → `\n`, a paragraph (`<p>`)
→ `\n\n`, every other block element → a trailing `\n`, `<td>`/`<th>` → a space, injected into the DOM
**before** the text is read, because `textContent` alone drops every block boundary and `innerText`
is useless on the detached clone `getCleanBodyHtml()` returns. They had the same bug twice precisely
because each used to carry its own copy — do not re-fork it.

Both then rely on `normalizePlain()` (default — the old `cleanupNewlines`), whose `\n{2,}` → `\n`
collapse keeps the output blank-line free and lets the projection be blunt without doubling anything:
the `\n\n` a `<p>` produced, nested blocks, and empty Outlook spacer paragraphs
(`<p class=MsoNormal><o:p>&nbsp;</o:p></p>`) all fold away rather than becoming blank lines. The
paragraph tier (`\n\n`) exists for the *insertion* side, which uses `normalizePlain(..., {
keepParagraphs })` to keep the blank line; on the body-extraction side the default collapse removes
it, so the contract is unchanged. Widening the collapse rule would change these placeholders, the diff
picker's original side and every existing comparison at once.

**The collapse invariant:** every projection consumer that feeds `{%mail_text_body%}` MUST route
through `normalizePlain()` default. The `<p>` → `\n\n` tier means a consumer that skips it would emit
doubled lines.

Full rationale in [01-architecture.md](01-architecture.md) → *Which path actually feeds
`{%mail_text_body%}`*.

### Selection twins (`selected_text` / `selected_html`)

`selected_text` and `selected_html` are derived from **one** normalization in `js/mzta-menus.js`
(`selectionTwin()`), not two independent calls, so the pair AGREES — the diff picker's original side
depends on it (see [07-diff-picker.md](07-diff-picker.md)). The shared `hasLineStructure()` decides:
a fragment carrying its own tags is trusted (its markup kept, the text twin read back out of the same
fragment with `htmlToLines()`); a structure-less plain-text selection has its text taken from the
`\n` and its html rebuilt with `linesToHtml(..., { mode: 'br' })`. A range cutting mid-`<b>` yields an
unbalanced fragment that `DOMParser` auto-closes, so no half-open tag leaks into either twin. The
autoselect fallback is preserved: with no selection and a prompt that uses `{%mail_typed_text%}`,
`selection_text` falls back to `only_typed_text` (paragraph-preserving) and its `only_typed_html`
twin.

**This contract does not extend to `{%mail_plain_text_part%}`**, which is a third case with the
opposite whitespace rule — see the next section before assuming the three behave alike.

### `mail_text_body` vs `mail_plain_text_part`

Two placeholders, two different *sources*, and the difference is the point:

| | `mail_text_body` | `mail_plain_text_part` |
|---|---|---|
| Source | the `text/html` part, converted to text | the `text/plain` part, verbatim |
| Nature | a **reconstruction** | the sender's own bytes |
| Always available? | yes (synthesized if need be) | **no** — empty when the mail ships no `text/plain` part |
| Whitespace | one `\n` per block, never a blank line, space runs collapsed | blank lines, spaces and tabs **preserved** |
| Type | 0 (always) | 1 (reading only) |

`mail_text_body` loses alignment-dependent structure (invoice tables, order confirmations, ERP
notifications), carries HTML-only noise (preheaders, tracking pixels, "view in browser",
unsubscribe footers), and costs noticeably more tokens. When the sender ships a
`multipart/alternative` message the `text/plain` part is already clean, so
`mail_plain_text_part` exposes it directly.

**Whitespace is preserved on purpose.** The value goes through `normalizePlainTextPart()`
(`js/mzta-utils.js`), **not** `cleanupNewlines()`: only CRLF/CR → LF, a leading BOM, and trailing
whitespace (per line and at the end) are touched. The `\n{2,}` → `\n` and `[ \t]+` → `' '`
collapses that the other body placeholders rely on would destroy exactly the column alignment
this placeholder exists to deliver. The non-breaking space is also left alone here, unlike in
`cleanupNewlines()`: this text never met an HTML parser, so a U+00A0 is a character the sender
really put in the plain part, and in a padded column it is load-bearing.

**Two sources, because there are two `getMailBody`s.** This is the trap:

| Path | `getMailBody` | `.text` is |
|---|---|---|
| Automatic (spam filter, auto add-tags, summarize, translate) | `js/mzta-utils.js` | already the concatenated `text/plain` parts |
| Interactive (reader, message list, popup, calendar event, task) | the **local** one in `js/mzta-menus.js` | the content-script DOM scrape, i.e. HTML→text |

So the automatic paths need nothing but the resolver arm, while `js/mzta-menus.js` has to fetch
the parts itself. It does one `browser.messages.getFull()` **guarded on the token being present**
(`hasPlaceholder(curr_prompt.text, 'mail_plain_text_part')`, the same idiom that path already uses
for `mail_typed_text`) and puts the result in a distinct `msg_text.plain_part` field. Note
`type: 1` does *not* by itself keep this placeholder off the scraper paths — "reading" includes
the reader and the message list; it only excludes the compose window, where a received MIME part
has no meaning.

The resolver reads `msg_text?.plain_part ?? msg_text?.text` — `??`, not `||`, and the order
matters. `plain_part` is set to `''` explicitly whenever the interactive path finds no message or
the fetch throws, and nullish coalescing selects on *presence*, so that empty string wins over
`msg_text.text`. With `||` an empty plain part would fall through to the DOM scrape, which is the
one outcome this feature must never produce.

**No fallback to the HTML conversion, by design.** A user who picks this placeholder is asking
for the original part specifically; silently substituting the reconstruction would hide the
reason the output looks different. When the part is missing the value is the empty string.

**What an absent part actually looks like in the prompt.** `replacePlaceholders()` resolves with
a `||` chain, so an empty string is indistinguishable from "unresolved": with
`placeholders_use_default_value` on the token becomes `default_value` (`""`), and with it off the
literal text `{%mail_plain_text_part%}` survives into the prompt. Not fixed deliberately — that
chain is shared by all 30 built-ins and widening it would change `{%empty%}` and a `junk_score`
of `0` at the same time.

**Known limitation — documented, not fixed.** The `text/plain` alternative is *not* reliable in
general: newsletters often ship a stub ("view this message in your browser"), a URL-only body, an
empty part, or a version out of sync with the HTML. That is precisely why this is an opt-in
placeholder rather than a change to `{%mail_text_body%}`. Reach for it on Outlook-style business
mail, ERP/automated notifications and token-sensitive setups — **not** on marketing mail. Also
note `getMailBody()` **concatenates** every `text/plain` part it finds, so a multipart message can
yield several bodies run together.

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
`--ed-chip-bg/-fg`, `--ed-warn-bg/-fg/-border`, `--ed-err-bg/-fg/-border`. The design-system pages get them from
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

**Two tiers, not one.** Red means *nothing can make this token resolve*; amber means *the
placeholder is real, the context is wrong*. The two have different fixes — correct the typo
vs. change the prompt type or pick another placeholder — so they must not share a colour.

| State | Severity | Rendering |
|---|---|---|
| Valid placeholder (including dynamic `{%id:value%}`) | — | `.ph_chip_live` |
| Id does not exist at all | `error` (**red**) | `.ph_chip_invalid.ph_chip_error` + `title` |
| Unterminated `{%` with no closing `%}` | `error` (**red**) | `.ph_chip_invalid.ph_chip_error` + `title` |
| Id exists, but not available for the prompt's type at all | `warn` (**amber**) | `.ph_chip_invalid.ph_chip_warn` + `title` |
| Id exists, but resolves in only one of a type-`0` prompt's two contexts | `warn` (**amber**) | `.ph_chip_invalid.ph_chip_warn` + `title` |

`getTokenState` returns `{ invalid: true, severity, title }`. `.ph_chip_invalid` carries the
shared geometry **and the amber colours**, so a state with `invalid` but no `severity` renders
exactly as the single-tier version did; only `.ph_chip_error` overrides the three colour values.
`.ph_chip_warn` consequently has no CSS rule of its own — `chip()` adds it purely to make the
tier readable in the DOM.

**Telling the two apart costs a second call to the one predicate.** `findPlaceholder()` returns
`null` for both "unknown id" and "wrong type" and **is deliberately left that way**: widening its
return type would touch `extractPlaceholders()` (runtime) and `decoratePromptText()`, whose
contract is documented in three places. So the resolver asks two questions instead —
`find(inner, list, null)` ("does this id exist at all", type-less, asked **first**) and, only if
that matched, `find(inner, list, type)` ("is it usable here"). The second `Array.find` is
therefore paid on valid tokens only, which is negligible beside the `replaceChildren()` the same
repaint already performs unconditionally. Asking the type-less question first is the whole
mechanism: reversing the order collapses the tiers back into one.

The first, second and fourth states are also rendered in **read mode** on the Manage Custom
Prompts page, in the same two tiers: `decoratePromptText()` tests the id with `findPlaceholder(..., null)`
and marks a missing one `.ph_chip_invalid_read.ph_chip_error_read` (+ `editor_placeholder_missing`), then
hands the type question to the **same** `classifyPlaceholderType()` the live resolver uses and applies
`.ph_chip_invalid_read` with whatever title it returns. Sharing that helper is what keeps the type-`0`
`partial_type` warning identical in both modes. Read mode's `type`
may legitimately be `null` (no `.type_output`, no `.type` span), and then the second call equals
the first, so nothing is flagged amber. The unterminated state cannot occur there: that function
matches only complete `PLACEHOLDER_RE` tokens, so an unterminated `{%` is simply left as plain text.

**One predicate, three call sites — four calls.** `placeholdersUtils.findPlaceholder(inner, activePHs, type = null)` is the
resolution rule, factored out of `extractPlaceholders()` and called by both, so the editor cannot disagree
with what the prompt will actually resolve at runtime. `decoratePromptText()` on the Manage Custom Prompts
page is the third caller, so the read-only list, the live editor and the runtime all share one definition
of a resolvable placeholder. It is **sync** and takes an already-fetched list,
because the backdrop runs on every keystroke and cannot `await`. The `type` argument is **optional**:
`extractPlaceholders()` omits it, preserving its previous behaviour exactly (it ignores type entirely),
while the editor and read mode supply the prompt's selected type so a reading-only placeholder in a
composing prompt is flagged — and each of those two calls it **twice**, type-less then type-filtered,
to separate the red tier from the amber one (see above). Verified equivalent to the old inline `find`
across the token forms the regex produces.

**`findPlaceholder()` is not the whole rule — the type half lives in `classifyPlaceholderType()`.**
`findPlaceholder()` accepts placeholders of **any** type in a type-`0` prompt, which is right for the
**runtime**: such a prompt runs in both contexts, so a type-1 placeholder in it really does resolve when
the prompt is launched while reading. But for an **editor** that still deserves a warning — the token
works in only one of the two contexts the prompt runs in and stays empty in the other. So the editor and
read mode both delegate the type decision to `classifyPlaceholderType(find, placeholders, inner, type)`
in `js/mzta-editor-highlight.js`, which handles the type-`0` case itself (comparing the *placeholder's*
own type) and delegates every other case to `findPlaceholder()`. It is a **highlighting** rule and
deliberately does not change `findPlaceholder()`, which the runtime shares — so no existing prompt
changes behaviour.

Highlight matrix (the id is assumed to exist; an unknown id is always red):

| Prompt type ↓ / placeholder → | type 0 (always) | type 1 (reading) | type 2 (composing) | no type |
|---|---|---|---|---|
| `0` always | normal | **amber** `partial_type` | **amber** `partial_type` | normal |
| `1` reading | normal | normal | **amber** `wrong_type` | normal |
| `2` composing | normal | **amber** `wrong_type` | normal | normal |

The two amber tooltips differ because the situations do: `wrong_type` means *never resolves here*,
`partial_type` means *resolves in one of this prompt's two contexts, empty in the other*.

`makeTokenStateResolver(find, placeholders, getType)` takes the predicate **injected**, not imported:
`mzta-editor-highlight.js` is loaded by every editor page, and importing `mzta-placeholders.js` there
would pull its whole dependency chain along.

**Tooltips in edit mode go on the textarea, not on the chip.** The chips carry a `title`, but they live
in the mirror, which is `pointer-events: none` — and must stay that way, since it sits under the textarea
and would otherwise swallow clicks, selection and the caret. The browser therefore never hovers a chip
and the native tooltip never fires. `attachEditorHighlight()` closes that gap with a `mousemove` handler
that finds the chip under the pointer and copies its `title` onto the **textarea**, removing it again on
`mouseleave`. The lookup is **geometric**, testing the chips' own client rects: `elementsFromPoint()`
does *not* work here, because it skips `pointer-events: none` subtrees entirely rather than seeing
through them, so it never returns a chip at all. Use `getClientRects()` (plural), not
`getBoundingClientRect()` — a chip wrapped across two lines has one rect per line fragment, and its
single bounding box would spuriously cover the whole gap between them. Both the rects and `clientX/Y`
are viewport coordinates, so the mirror's scroll offset needs no correction.
`render()` also drops it, because a repaint replaces the chips and the stored title may describe a token
that no longer exists; the next `mousemove` re-reads it. Read mode needs none of this — there the chips
are the hovered elements, which is why `.ph_chip_invalid_read` can simply set `cursor: help`.

**The token under the caret is never flagged.** Typing `{%mail_su` would otherwise flash a warning on
every keystroke. `chip()` reads `textarea.selectionStart/End` live rather than taking an offset argument,
because the ordinary repaint path (`refresh()`, on every `input`) passes none.

**Re-validation on type change.** Validity depends on the prompt type, and the mirror caches its render,
so `attachHighlightWithValidation()` on the two table pages adds a `change` listener to the row's
`.type_output` (or `#selectTypeNew` in the add-form) that calls `refresh()`. There was no listener on
those selectors before — the autocomplete reads the type lazily per keystroke and never needed one.
The six settings pages pass a constant type `1`, matching the `type_value` they give the autocomplete.

Two details of that function are load-bearing, and getting either wrong makes the **amber tier silently
unreachable** — every wrong-type token renders as a valid chip:

1. **The resolver is re-installed on every call**, not only when the handle is new. `attachEditorHighlight()`
   is idempotent and returns the handle from the previous entry into edit mode, and the resolver that handle
   carries closed over the `typeSelect` found *at that time*. If the select was not reachable then, the
   captured `getType` is `null` — and `makeTokenStateResolver` skips type filtering entirely when
   `getType()` yields `null`/`undefined`, permanently. Re-installing also repaints (`setTokenStateResolver()`
   calls `render()`), which is what picks up a type edited since the row was last open.
2. **The `change` listener must not close over the textarea.** `#selectTypeNew` is a single shared element
   and a row's `.type_output` outlives any one entry into edit mode, so a captured `textarea` can be the
   wrong one — or detached — by the time the event fires. The listener instead resolves the editors from
   the select itself: `sel.closest('tr')` as the scope (the add-form lives inside a `<tr>` of `#formNew`,
   so this isolates it from the list rows just as well) and `refresh()` on every attached mirror in it.

**A placeholder with no `type` counts as type `0`.** `findPlaceholder()` normalises a missing, null or
blank `type` on the *placeholder* to `'0'` ("always") rather than treating it as a mismatch: a value
that states no context requirement is usable in every context, so rejecting it in every prompt except
a type-0 one would be arbitrary.

This is **not** a workaround for the Data Placeholders page. Contrary to what this file claimed before,
custom data placeholders **do** carry a type: the page has an "add to menu" selector (`#selectTypeNew`
in the add-form, `.type_output` per row), `type` is in the List.js `valueNames`, and `saveAll()` passes
it straight through — `setCustomPlaceholders()` does not assign it precisely because it arrives from the
form already set, and has since the feature's first commit (`1b5dea92`). The normalisation guards the
paths that bypass that form instead: `prepareCustomDataPHsForImport()` copies whatever keys the imported
JSON happens to carry and never fills in `type`, and storage can be hand-edited.

**Validation list vs suggestion list.** The six settings pages filter `additional_text` out of their
*suggestions* but validate against the **unfiltered** list: it is a real placeholder they simply do not
offer, and flagging it would be wrong. The Data Placeholders page is the opposite — its built-ins-only
restriction is semantic, so the same filtered list drives both.

**Colours.** Two triples, one per tier: amber `--ed-warn-bg/-fg/-border` and red
`--ed-err-bg/-fg/-border`, fed from `--warn-*` / `--err-*` on the two table pages and `--warnChip*` /
`--errChip*` in `mzta-design.css`. All six chip tokens are opaque on purpose: `--warnBg`/`--warnBorder`
are 7%/28% alpha washes for large disclaimer panels and are invisible at chip size — the same trap as
`--accentLight`. Red gets its own triple rather than reusing `--del-*` (which means the *delete* action)
or `--jsonError` (a bare text colour with no background/border pair). The shared file's fallbacks stay
inert (`transparent`/`inherit`), so a page that defines `--ed-warn-*` but forgets `--ed-err-*` renders a
red chip **unstyled** rather than misaligned — add both or neither. Tooltips use
`editor_placeholder_missing` / `editor_placeholder_wrong_type` / `editor_placeholder_partial_type` /
`editor_placeholder_unterminated` (English only). The old conflated `editor_placeholder_unknown` key was **retired**, not narrowed: its 7
Weblate translations carried the "or not available for this prompt type" clause, which would have been
actively wrong on a chip that now means only "does not exist", and Weblate would never have flagged it
because the source string was unchanged.

Known quirks (documented, not currently fixed): a prompt of type `0` sees *only* type-0 placeholders
in the *autocomplete*, hiding type-1 and type-2 ones (the highlighter now warns rather than hides — see
the matrix above); and `getPlaceholders(true)` returns the list
unsorted, so the dropdown is in declaration order rather than alphabetical.

## Custom Placeholders

Users can define their own placeholders via `pages/customdataplaceholders/`. Custom placeholders:
- Have `is_default: "0"`
- Have a `text` property containing the replacement value
- Are stored in `browser.storage.local`
- Are merged with default placeholders at runtime before prompt processing

## Placeholder Resolution Order

1. Built-in placeholders are defined in `js/mzta-placeholders.js`
2. Custom placeholders are loaded from storage (expanded first, by `replaceCustomPlaceholders()`)
3. At runtime the calling path gathers the email data and hands it to
   `getPlaceholdersValues()`, which is **demand-driven**: only tokens actually present in the
   prompt get resolved
4. `replacePlaceholders()` substitutes each `{%id%}` token, looking the id up in
   `defaultPlaceholders`
5. If a value cannot be resolved, `default_value` is used when the
   `placeholders_use_default_value` pref is on; otherwise the raw token is left in place

**Who supplies the values.** Coverage is uneven, and a placeholder is only as available as its
source field on the path in question:

| Path | Site | Supplies |
|---|---|---|
| Interactive menu (reader, message list, popup, calendar event, task, translate-this) | `js/mzta-menus.js` → `preparePrompt` | everything — the only site passing selection/typed/quoted/tags |
| Spam filter | `mzta-background.js` → `preparePrompt` | `body_text`, `subject_text`, `msg_text` |
| Auto add-tags (batch loop) | `mzta-background.js` → `preparePrompt` | the same plus `tags_full_list` |
| Summarize, per-mail template | `js/mzta-utils-prompt.js` → `preparePrompt` | `body_text`, `subject_text`, `msg_text` |
| Summarize, header + separator prompts | `js/mzta-utils-prompt.js` → `preparePrompt` | only `curr_prompt`/`chatgpt_lang` — every mail placeholder resolves empty |
| Translation | `js/mzta-utils-prompt.js` → `getPlaceholdersValues` directly | `msg_text`, `mail_subject` — **no `body_text`**, so `{%mail_text_body%}` is empty there |
| `additional_text` late fill | `api_webchat/controller.js` → `replacePlaceholders` | the deferred half of `skip_additional_text: true` |

## Adding a New Built-in Placeholder

1. Add the object to the `defaultPlaceholders` array in `js/mzta-placeholders.js`
2. Add the `name` i18n key to `_locales/en/messages.json` as `placeholder_<id>` (or choose a descriptive key)
3. Add a `case` arm to `getPlaceholdersValues()` in `js/mzta-placeholders.js`

Three things bite when adding one:

- **The array entry is mandatory.** `replacePlaceholders()` looks the id up in
  `defaultPlaceholders` and returns the raw token when it is absent — so a value produced by
  `getPlaceholdersValues()` with no matching entry is silently dropped.
- **A value that is only in `getPlaceholdersValues()`' argument list is not enough.** That
  function is fed by 6 call sites with *uneven* coverage (see the table under *Placeholder
  Resolution Order*): only `js/mzta-menus.js` passes selection/typed/quoted/tags, and
  `buildTranslationPrompt()` passes no `body_text` at all. Check the paths your placeholder needs.
- **`type: 1` means "reading", not "background".** The reader and the message list are reading
  contexts served by the content-script scraper in `js/mzta-menus.js`, which has no access to the
  MIME parts. A placeholder that needs `messages.getFull()` data must fetch it there itself —
  guarded on `hasPlaceholder()` so prompts that do not use it pay nothing. See
  *`mail_text_body` vs `mail_plain_text_part`*.

- **An empty string cannot be expressed.** `replacePlaceholders()`' `||` chain treats `''` as
  unresolved and falls through to `default_value` or the literal token.
- **Escape `\s` as `\\s` in the two template-string regexes.** `hasPlaceholder()` and
  `hasCustomPlaceholder()` build their pattern with `` new RegExp(`{%\\s*${placeholder}…`) ``. The
  doubled backslash is required: in a template string a single `\s` is eaten, leaving the pattern
  `{%s*<id>`, which matches `{%id%}` only by accident (`s*` = zero `s`) and misses the spaced form
  `{% id %}` entirely — while `extractPlaceholders()`/`replacePlaceholders()` use a correct
  `/{%\s*(.*?)\s*%}/` literal and *do* accept spaces. That mismatch let a guard substitute a token
  whose value was never gathered (fixed for all four call sites: the `mail_plain_text_part` fetch
  in `js/mzta-menus.js`, `mail_typed_text` ×2, and `additional_text`).
