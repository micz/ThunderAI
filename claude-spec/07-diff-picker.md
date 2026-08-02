# Interactive Change Picker

## Overview

Prompts with `use_diff_viewer == "1"` (proofread, rewrite formal, rewrite polite) show a **Show
differences** button under their answer in the webchat window. Clicking it opens
`<diff-picker>` — an interactive view where the user accepts or rejects **each change
individually**, and the composed result is what gets written back into the email.

This replaced a read-only diff viewer (`api_webchat/diffViewer.js`, deleted) that could only paint
`.added` / `.removed` spans. That viewer had a deeper problem than being read-only: the text it showed
and the text the "Use this answer" button actually inserted were computed on two completely separate
paths, so the diff was purely decorative. The picker makes them converge on one canonical text.

Implemented in `api_webchat/diffPicker.js`. Introduced by
[#829](https://github.com/micz/ThunderAI/issues/829).

## Scope

- **api_webchat only.** The ChatGPT Web path has its own independent read-only diff in
  `js/mzta-chatgpt.js` (fed by `mztaUseDiffViewer` / `mztaOriginalText`, baked into the injected
  pre-script in `mzta-background.js`). It is untouched and still uses `Diff.diffWords()`.
- Works in the compose-window case too (`promptData.mailMessageId == -1`, where `action` is forced
  to `"2"`).

## The hunk model

`buildHunks(originalText, newText, granularity)` turns two plain-text strings into a flat list:

```js
Hunk = {
  id: number,                                   // stable, sequential
  type: 'context' | 'replace' | 'insert' | 'delete',
  oldText: string,                              // '' for insert
  newText: string,                              // '' for delete
  state: 'accepted' | 'rejected',               // ignored for context
}
```

`Diff` emits consecutive parts; `buildHunks` post-processes them so a **maximal run of consecutive
insert/delete parts collapses into one hunk** — every `added` value summed into `newText`, every
`removed` value into `oldText`. jsdiff in fact always emits removed-then-added and never two
same-type parts adjacent (`addToPath()` merges same-type components), but accumulating the whole run
makes the loop order-independent and costs nothing.

Unchanged parts become immutable `context` entries, carrying the value in **both** `oldText` and
`newText` so `composeResult` needs no special case.

**Every non-context hunk defaults to `'accepted'`**, so a user who touches nothing gets exactly what
they got before the picker existed.

`buildHunks` returns `null` if the underlying diff aborts (the base `diff()` returns `undefined` when
a `maxEditLength`/`timeout` option cuts the search short). No options are passed today; the picker
handles `null` by showing the answer unchanged with an explanatory note.

## The `composeResult` invariant

This is the correctness contract of the whole feature, because the composed text is written into the
user's outgoing email:

```
composeResult(all accepted) === normalizeForDiff(newText)
composeResult(all rejected) === normalizeForDiff(originalText)
```

It follows from two properties: the diff parts **partition both inputs exactly**, and `buildHunks` is
a lossless regroup of those parts (every part lands in exactly one hunk, in order).

Verified against the real `js/lib/diff.js` over hand-picked samples plus 8000 fuzz checks
(both granularities): zero failures.

### Why `Diff.diffWords()` cannot be used

**`diffWords` breaks the invariant.** It is the obvious choice and it is wrong. `WordDiff` overrides
all three diff hooks:

- `equals()` compares **trimmed** tokens, so two tokens differing only in surrounding whitespace
  compare equal and the resulting context part takes its value from only one side;
- `join()` strips leading whitespace from every token but the first, so it is not the inverse of
  `tokenize()`;
- `postProcess()` → `dedupeWhitespaceInChangeObjects()` **mutates the `.value`** of surrounding
  keep/insert/delete objects to tidy whitespace. Its own doc comment concedes: *"we have no way to
  avoid losing information about the texts' original whitespace."*

Measured consequences:

```
old = "Dear Sir,\n\nI hope you are fine.\nBest"
new = "Dear Sir,\n\nI hope you are well.\n\nBest regards"

diffWords          reject-all -> "…fine.\n\nBest "   WRONG: invented a blank line and a trailing space
diffWordsWithSpace reject-all -> "…fine.\nBest"      correct
```

Whitespace-only rewrites fail worse: `diffWords("one two", "one    two")` returns a **single context
part** — zero hunks. The picker would report "0 of 0 changes accepted" over visibly changed text, and
reject-all would silently hand back the AI's spacing.

**So: `diffWordsWithSpace` for `'words'`, `diffSentences` for `'sentences'`. Never `diffWords`.**
Both declare only `tokenize()` and inherit the base-class identity `join()` and no-op
`postProcess()`, which is exactly what makes the partition property hold.

### `normalizeForDiff` and what the invariant is really against

`diffWordsWithSpace` is whitespace-exact — which the invariant needs — but that also means every
cosmetic whitespace difference becomes a hunk the user has to look at. So **both sides pass through
`normalizeForDiff()` before diffing**: CRLF→LF, runs of spaces/tabs collapsed, spaces around newlines
dropped, 3+ newlines capped at 2, trimmed.

The invariant is therefore stated against the **normalized** original, not the byte-exact one. That
is not a compromise in practice: the result is written into a rich-text compose body via
`chatgpt_replaceSelectedText`, so byte-exact original whitespace was never preserved end to end
anyway. The upside is that cosmetic noise never becomes a hunk — `"one two"` vs `"one    two"`
correctly yields **zero** changes.

> An earlier draft of this feature planned `body_text_raw` / `selection_text_raw` fields on
> `prompt_info` carrying un-normalized text, so the invariant could hold against the byte-exact
> original. They were **dropped**: once both sides are normalized the fields buy nothing, and they
> would have added payload to a message that already carries the mail body and required edits at
> five `api_send` sites.

## Plain text only

The picker operates on plain text with `\n` line breaks. It does **not** preserve the HTML formatting
of the AI answer (bold, lists): both sides are normalized to plain text, diffed, recomposed as plain
text, and only converted back to `<br>` markup when the result is handed to the insertion path.

Rationale: the hunk model needs a single linear text to be correct — a hunk boundary can fall in the
middle of a `<strong>` — and the original side arrives as plain text regardless (`getMailBody()` in
`js/mzta-menus.js` sends `selection`/`text` through `cleanupNewlines()`; only `selection_html`/`html`
get `convertNewlinesToBr()`), so a rejected change would have no formatting to restore anyway.

**Important nuance: this is not a regression for users who don't open the picker.** The formatted
HTML path is untouched — `handleUseThisAnswerButtonClick()` still inserts
`fullTextHTMLAtAssignment` when no picker exists on the turn. The plain-text downgrade happens only
once the user opens the picker, i.e. only when they have explicitly asked to review changes.

### Line breaks are `\n`, never `<br>`

The plain-text side never contains literal `<br>` (see `getMailBody()` above), so the picker splits on
`\n` only. `_buildDiffButton` still applies one defensive `<br>` → `\n` replacement on the resolved
original, in case a future `prompt_info` ever carries markup in a plain-text field.

## The result indirection

The picker renders in a **turn of its own** (via `_beginBotTurn`), below the answer whose action bar
owns the "Use this answer" button. Two mechanisms connect them:

1. **`ownerTurn._mztaPicker = picker`.** Set by `appendDiffPicker()`. Read **at click time** by
   `handleUseThisAnswerButtonClick()` and by the copy button, so both always reflect the user's
   latest toggles rather than the state when the bar was built. `ownerTurn` is the turn that owns the
   action bar, captured **lexically in `addActionButtons()`** — deliberately not `_currentTurnEl`,
   which by click time can point at a newer turn.
2. **The picker's own "Use this answer" button.** The picker sits in a different turn from the action
   bar, so without this the user would have to scroll back up to apply choices they just made.
   `appendDiffPicker` receives a thunk that builds the handler from the diff button's own closure —
   not from `turn._mztaToolsArgs`, which `_degradeFullActionBar()` deletes once a newer answer
   arrives.

`_degradeFullActionBar()` **must not delete `_mztaPicker`** (unlike `_mztaToolsArgs`): an older
answer's compact toolbar has to keep handing back that picker's current state.

### Two things the picker deliberately bypasses

- **`removeAloneBRs()`.** It strips every `<br>` with no `<p>` ancestor. `composeResultHTML()` emits
  `<br>`-separated text with no `<p>` wrapper, so running it through `removeAloneBRs` would delete
  **every** line break and collapse the message into one run-together line. The picker branch skips
  it entirely. `removeAloneBRs` still guards the non-picker path, where it cleans the `<p>`-wrapped
  markdown answer — a different job.
- **The mouse-selection override.** `getCurrentSelectionHTML()` is not consulted for a turn with a
  picker, and that turn's `.sel_info` hint is hidden: two mechanisms competing over the same output
  would be confusing, and the picker is the explicit one. Turns without a picker keep the override
  untouched.

`_buildSaveSummaryButton` is **not** wired to the picker, because a summary session and a picker
session are mutually exclusive: every prompt carrying `headerMessageId`/`summaryTabId` has
`use_diff_viewer: "0"`.

## `composeResultHTML()` escaping order

Escape **first**, then substitute `<br>`, or the tags just inserted get escaped too. Within
`escapeHtml`, `&` must be replaced before `<`/`>` or the entities double-escape into `&amp;lt;`.

## UI

Single **inline** view, not two columns — the webchat window is often narrow.

**Both versions of every change are on screen at once, and you click the one you want to keep.**
That is the core interaction:

- Context entries render as plain text, with real `<br>` elements for line breaks.
- Each change renders as a wrapper `.hunk` span holding **two** `.hunk-side` spans: the original
  (red, `--err-*`) and the answer's replacement (green, `--ok-*`), in that order.
- The side currently in force is `.is-active` (full colour, semibold); the other is `.is-inactive`
  (dimmed and struck through). Both stay legible, so the comparison is always visible and switching
  back is one click.
- Clicking a side **keeps that side**. It is idempotent: clicking the side already in force does
  nothing, rather than toggling away from what the user just asked for.
- A pure insertion has no original and a pure deletion has no replacement. That empty side still
  renders, as a dimmed three-dot placeholder (`.is-empty`), so "keep nothing here" is the same
  gesture as every other choice instead of a special case.
- The wrapper is `white-space: nowrap` so a change never breaks across lines with its two halves on
  either side of the break, which would read as two unrelated edits. The text *inside* each side
  wraps normally.
- Accessibility: each side is `tabindex="0"` `role="radio"` with `aria-checked` reflecting which is in
  force — the pair is genuinely a two-option choice, which `role="button"` + `aria-pressed` would not
  convey. Each side carries a descriptive `aria-label`. The counter is `aria-live="polite"`.
- Keyboard: `j`/`k` move between changes, landing focus on the **active** side so the next keystroke
  acts relative to what is actually there. `Space`/`Enter` on the inactive side selects it; on the
  active side it flips to the other one (otherwise the key would appear dead) and focus follows the
  new active side. Modified keys (ctrl/meta/alt) are ignored so browser shortcuts survive, and keys
  inside a textarea are left alone.

> An earlier iteration showed only one side at a time and toggled on click. It was changed because
> seeing the original and the suggestion together is the whole point of reviewing a proofread: with
> one side hidden the user cannot tell what they are choosing between.

Sticky toolbar: the counter ("7 of 12 changes accepted"), the **Words / Sentences** granularity
toggle, Accept all / Reject all, previous / next, and "Use this answer". Buttons reuse
`mzta-btn-secondary` / `mzta-btn-tertiary` from `sharedStyles.js`; the toggle adds a `.picker-gran`
segmented-control skin over two of them.

**Zero-changes state:** when the answer normalizes identically to the original there is nothing to
pick, so the counter, navigation and accept/reject-all are hidden and a muted note is shown instead of
a bare "0 of 0 changes accepted". "Use this answer" stays available and still returns the text. The
granularity toggle stays visible — switching to sentences on a word diff that found nothing is a
reasonable thing to try.

### Surgical re-render

Choosing a side repaints **one** change via `_renderHunk(index)`, which does nothing but reassign
`.is-active` / `.is-inactive`, `aria-checked` and the labels on its two existing side elements. **No
DOM is created or destroyed on a choice**, so focus, tab order and hover survive untouched — there is
no need to detect and restore focus the way a rebuild would require.

Two parallel arrays are kept aligned 1:1 with `_hunks` (context entries included, so indices never
need recomputing): `_hunkEls[i]` holds the wrapper span, `_sideEls[i]` holds `{old, new}` (or `null`
for context). Text content and listeners are built once in `_renderAll`.

`_chooseSide(index, which)` is the single mutation path. `_toggleHunk(index)` just delegates to it
with the opposite side, for the keyboard case where there is no clicked side to go on.

Bulk accept/reject sets every state first, then repaints, then updates the counter **once**, rather
than routing through the per-change path N times.

## Why a custom element

The same reason documented at the top of `splitButton.js`: the keyboard handler is registered in
`connectedCallback()` and removed in `disconnectedCallback()`, so handlers cannot accumulate across
chat turns. Registered by `import './diffPicker.js'` in `messagesArea.js` (the `splitButton.js`
precedent) — no extra `<script>` tag in `index.html`.

Styling follows the shadow-DOM conventions: `SHARED_BASE_CSS + BUTTON_CSS` concatenated into the
component's own `<style>.textContent`, with colours read from the custom properties that inherit from
`:root` in `styles.css`. Only the properties cross the shadow boundary — the *rules* must be
re-declared inside the picker's own root, which is why the `.added`/`.removed` pair that used to live
in `<messages-area>`'s shadow style was removed along with `diffViewer.js`.

## Granularity

Word-level or sentence-level comparison, chosen by a **toggle in the picker's own toolbar** (a
`role="radiogroup"` of two `role="radio"` buttons — mutually exclusive positions, which `aria-pressed`
would announce as independent).

Which one is right is not knowable in advance, which is why the choice is the user's and is made while
they can see the result: word granularity suits an in-place grammar fix, but a prompt that rewrites
whole sentences yields dozens of interleaved micro-hunks at word level and a handful of readable ones
at sentence level. Measured on a 3-sentence rewrite: **8 changes at word level, 3 at sentence level.**

`setGranularity('words' | 'sentences')` sets the initial value (it does **not** re-diff, so after
`setContent()` the toolbar toggle is the way in). `_changeGranularity(g)` is the interactive path.

Two properties of the interactive switch matter:

- **It re-diffs from `_newText`, never from the composed text.** Comparing the original against the
  current composition would make the answer's rejected parts unreachable, turning a view setting into
  a destructive edit.
- **It discards every accept/reject decision** — all changes go back to `accepted`. There is no correct
  alternative: one sentence-level hunk spans several word-level ones, so the decisions carry no meaning
  across the boundary and mapping them over would silently invent choices the user never made. Losing
  them visibly beats corrupting them invisibly. (Same reasoning as phase 2's EDIT→REVIEW round-trip.)
- Clicking the position already selected is a no-op, so it cannot wipe choices by accident.

Caveat worth knowing about `'sentences'`: `SentenceDiff.tokenize` only splits on `[.!?]` followed by
whitespace, so on **single-sentence** text it degenerates to one delete + one insert covering
everything — a single "replace it all" hunk. It works well on genuinely multi-sentence text.

`aria-checked` is painted both from `setGranularity()` and at build time in `_buildGranularityToggle()`;
without the latter a picker left at the default would show neither position as selected.

> Phase 3 of the original plan adds a global `diff_granularity` preference plus a per-prompt override
> feeding `setGranularity()` as the *initial* value. This toolbar toggle is independent of that and
> stays useful either way: the preference sets the starting point, the toggle changes it in the moment.

## Files

| File | Role |
|------|------|
| `api_webchat/diffPicker.js` | Hunk model, compose functions, `<diff-picker>` element |
| `api_webchat/messagesArea.js` | `_buildDiffButton`, `appendDiffPicker`, the `_mztaPicker` indirection |
| `api_webchat/svgIcons.js` | `buildHunkMarkerIcon` (the empty-side placeholder) |
| `js/lib/diff.js` | jsdiff; provides the `Diff` global (classic script, loaded before the modules) |
