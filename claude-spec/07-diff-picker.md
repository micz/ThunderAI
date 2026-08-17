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

`buildHunks(originalHtml, newHtml, granularity)` turns **two HTML strings** into a list of
**blocks**, each holding its own hunks:

```js
Block = { tag, listType, text, html }           // segmentBlocks() output; html is INNER html

ComposedBlock = {
  kind: 'context' | 'replace' | 'insert' | 'delete',
  tag, listType,
  hunks: Hunk[],
}

Hunk = {
  id: number,                                   // stable, sequential, across all blocks
  type: 'context' | 'replace' | 'insert' | 'delete',
  oldText: string,                              // '' for insert
  newText: string,                              // '' for delete
  oldHtml: string,                              // the same span, with its markup
  newHtml: string,
  state: 'accepted' | 'rejected',               // ignored for context
}
```

`flatHunks(blocks)` returns every hunk in document order. The component keeps **both**: `_blocks`
is the composition source, `_hunks` is `flatHunks(_blocks)` — **the same objects by reference**, so
mutating `hunk.state` through the flat array mutates it in the block tree, and every indexed UI path
(`_renderHunk`, `_chooseSide`, `_moveCurrent`, the keyboard handler) works unchanged on a flat index.

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

This is the correctness contract of the whole feature, because the composed HTML is written into the
user's outgoing email:

```
composeResultHTML(all accepted) === renderBlocks(segmentBlocks(newHtml))
composeResultHTML(all rejected) === renderBlocks(segmentBlocks(originalHtml))
```

It rests on three properties, each checkable on its own:

- **P1 — block partition.** `segmentBlocks()` is a **normalization**, not a round-trip: segment →
  render → segment → render is stable. The invariant is therefore stated against the
  *segmented-and-rendered* sides, not the byte-exact input HTML — the same concession the plain-text
  version made when it stated itself against `normalizeForDiff` rather than byte-exact whitespace.
- **P2 — block-diff partition.** `Diff.diffArrays` with a `comparator` emits parts that partition
  both block lists exactly. `ArrayDiff` (`js/lib/diff.js`) declares only `tokenize`/`join`/
  `removeEmpty` and overrides **neither `postProcess` nor `equals`** — structurally the same reason
  `diffWordsWithSpace` is safe below.
- **P3 — inner partition.** Inside a paired block the existing text-level argument applies verbatim.

**Context means the words match, not the markup.** Two places would otherwise leak the answer's
formatting into a rejected result, and both are load-bearing:

- **`buildBlockPairs`'s comparator matches on `text` *and* `tag` *and* `html`.** For a context part
  jsdiff keeps only one side's objects and discards which block on the other side it matched, so
  matching on text alone would give a "context" block carrying the answer's markup — and reject-all
  would emit it. Requiring `html` to match makes a context block genuinely identical on both sides;
  a markup-only difference falls through to a `replace` pair, where both sides are kept and the user
  can choose.
- **`contextSide(block)` decides which side a context *hunk* contributes.** Inside a `replace` block
  the two sides can mark the same words up differently, so a context hunk that always emitted
  `newHtml` would hand back the answer's bold for text the user just rejected. It follows the block:
  if every changed hunk in the block is rejected, the block is showing the original, so its context
  must be the original's too.

**The single source of truth for offsets.** `block.html` is normalized (`normalizeBlockHtml`) and
`block.text` is then **read back out of it** (`blockTextOfHtml`). Deriving the text from the html
rather than computing it separately is load-bearing: `sliceHtmlByText` maps offsets in `block.text`
onto `block.html`, so two independent projections that merely *looked* equivalent would drift on the
first odd input and every offset after the drift would be silently wrong.

> **Not yet re-verified after the HTML rewrite.** The plain-text model was verified over hand-picked
> samples plus 8000 fuzz checks with zero failures. The block model's harness exists but has to run
> in the webchat window's devtools console — it needs `DOMParser` and the `Diff` global, neither of
> which exists in Node, and this project has no npm — so the numbers above have **not** been
> reproduced for the HTML path. Run the harness before trusting the invariant.

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

### Normalization, and what the invariant is really against

`diffWordsWithSpace` is whitespace-exact — which the invariant needs — but that also means every
cosmetic whitespace difference would become a hunk the user has to look at. Normalization keeps that
noise out, and the invariant is stated against the **normalized** sides, not the byte-exact ones.

`normalizeForDiff()`, which used to do this over the whole plain-text answer, is **gone**. Its work
now happens per block, in `normalizeBlockHtml()`: CRLF→LF, runs of spaces/tabs collapsed, spaces
around newlines dropped, ends trimmed — applied to the block's *text nodes*, leaving its tags alone.
`"one two"` vs `"one    two"` still yields **zero** changes.

**Blank lines are no longer a normalization problem at all.** The old `\n{2,}` → `\n` collapse existed
because the two sides arrived unequally faithful — `cleanupNewlines()` had already flattened the
original's blank lines while the answer kept its `\n\n` — so on multi-paragraph mail every paragraph
break became a hunk. That asymmetry cannot arise now: **a paragraph break is a block boundary and
never reaches the text diff**. The related cost is likewise gone, since the block list, not a run of
`\n`, is what carries paragraph structure.

> The plain-text model was verified with 8058 invariant checks over both granularities, zero
> failures. **Those numbers do not carry over to the block model** — see the caveat under the
> invariant above.

> An earlier draft of this feature planned `body_text_raw` / `selection_text_raw` fields on
> `prompt_info` carrying un-normalized text, so the invariant could hold against the byte-exact
> original. They were **dropped**: once both sides are normalized the fields buy nothing, and they
> would have added payload to a message that already carries the mail body and required edits at
> five `api_send` sites.

### Where the answer's HTML comes from

`fullTextHTMLAtAssignment` — the snapshot the picker diffs — is produced by
`StreamingMessage.flush()`, and **which pipeline produced it depends on the prompt**:

- **Prompts that send HTML** (`prompt_rewrite_formal`, `prompt_rewrite_polite`) get an HTML answer
  back. It skips markdown-it and is sanitized with `sanitizeBlockHtml()` instead — see
  [01-architecture.md](01-architecture.md) → *When the answer is HTML*. This is the case the block
  model exists for: real markup on both sides.
- **`prompt_proofread_this` still sends plain text**, so its answer is ordinary markdown rendered by
  markdown-it, and the ORIGINAL side has no `_html` twin to resolve to.

**The `textToBlockHtml()` fallback is therefore not hypothetical — it is proofread's live path.**
`_buildDiffButton` resolves the original on the text fields, finds no matching HTML field, and wraps
each line in a `<p>` so the segmenter has blocks to work with. Both shapes are in use at the same
time and both must keep working; see [02-prompts.md](02-prompts.md) for why the third prompt was left
on text.

### Where the original's HTML comes from

`_buildDiffButton` resolves the original on the **text** fields exactly as before — `selection_text`,
falling back to `body_text` — and then takes the **HTML twin of whichever side won**
(`selection_html` / `body_html`). Choosing on the html fields directly would risk diffing a selection
against a whole body whenever one of the two happened to be empty.

#### The html twin is only trusted when it carries line structure

The twin is used **only if `hasBlockStructure(originalHtml)`** — i.e. it holds a block-level element
or a `<br>`. Otherwise the original is rebuilt with `textToBlockHtml(originalText)` from the text
field, which kept its `\n`.

This guard is wider than "is the twin empty?", and the difference is the fix for the picker showing a
run-together original:

- **A plain text compose window has no markup.** Its line breaks *are* the `\n` characters (the same
  property the insertion path relies on — see `js/mzta-compose-script.js` and #855), and
  `normalizeHtmlSourceNewlines()` collapses every source `\n` to a space on the way into the prompt
  payload. That is correct for real HTML, where tags carry the breaks, but it leaves a plain text body
  as **one flattened line**. A twin in that state is non-empty, so an empty-check never rescued it.
- The old empty-twin case (an older `prompt_info`, or a producer that only fills the text field) is
  **subsumed**: empty → no block structure → rebuilt. The guard replaces that check rather than adding
  to it.

**It is keyed off the SHAPE of the html, not off a plain-text flag.** `isPlainTextCompose()`
(`js/mzta-utils.js`) is background-side, and nothing on `prompt_info` reports the compose format at
the point the diff button handler runs — its runtime fields are `selection_text`, `selection_html`,
`body_text`, `body_html`, `custom_text_array`, `headerMessageId`, `summaryTabId`. Plumbing the format
through the background → webchat message boundary would be a much larger change for the same result.

`hasBlockStructure()` **parses** rather than regex-matching, for the same reason `htmlToPlainText()`
does: escaped text is common on this path, and a plain text body containing a literal `<div>` arrives
as `&lt;div&gt;` — markup to a regex, text to a parser.

`selection_html` already existed on `curr_prompt`; **`body_html` is new** — one line in
`js/mzta-menus.js`, assigning the `msg_text.html` that `getMailBody()` already produced and
`normalizeHtmlSourceNewlines()` already collapsed. Because `prompt_info` *is* `curr_prompt`,
forwarded verbatim, that single line is the whole plumbing change and no `api_send` site was touched.

**The payload cost is real and is the one the `*_raw` fields were rejected for**: the full HTML body
now rides along with the plain-text body. It is bounded (`getCleanBodyHtml()` runs first, source
newlines are collapsed) but on a heavily-quoted thread it is not nothing. It is paid here because,
unlike `*_raw`, the feature genuinely needs it — without it, rejecting a change could not restore the
original's formatting.

#### The same flattening reached the MODEL, not just the picker

`{%selected_html%}` — used by `prompt_rewrite_full_text` and `prompt_rewrite_formal_full_text` —
resolves to `selection_html` (`js/mzta-placeholders.js`), the *same* collapsed value. So in a plain
text compose window the **prompt itself** carried the run-together line, and no fix confined to the
picker could correct what the model was asked to rewrite.

`getMailBody()` in `js/mzta-menus.js` therefore applies one rule to both `selection_html` and `html`:
**a source with no line structure of its own gets its line breaks from its `\n`.** When
`htmlHasLineStructure()` is false, the field is built with the existing `convertNewlinesToBr()` from
the text twin instead of `normalizeHtmlSourceNewlines()`. This is the same treatment `getMailBody()`
in `js/mzta-utils.js` already applies to a text/plain-only mail.

**`normalizeHtmlSourceNewlines()` itself is unchanged, deliberately.** Widening it would alter every
HTML consumer; the decision is made at the call site, where the source's shape is known. It still runs
on any twin that does carry structure, so the HTML compose path is byte-for-byte unaffected.

This also means the picker's guard is normally satisfied *before* it is reached: the payload now
arrives with `<br>`-separated lines, and `hasBlockStructure()` accepts it. The picker-side rebuild
remains as the backstop for producers that fill only a text field (e.g. `prompt_proofread_this`).

No locale file changed — the prompt **wording** is untouched, only the substituted value.

## Block-structured HTML

The picker **preserves formatting**. Both sides arrive as HTML, are segmented into blocks, diffed
within each block, and recomposed as HTML — so the answer's bold/italic/lists survive, and rejecting
a change restores the **original's** own markup rather than just its words.

This replaced a plain-text-only model, whose stated reason was real: a hunk boundary can fall in the
middle of a `<strong>`. The block model answers that structurally instead of by giving up.

### Why block segmentation, and not the obvious alternatives

Four approaches were considered:

| | Approach | Verdict |
|---|---|---|
| (a) | Plain-text diff + a parallel `{start, end, tags[]}` format map, re-applied at compose time | **Rejected.** Offsets shift the moment a hunk is rejected, so the map must be re-derived per choice; needs a second map for the original side and a rule for a rejected span landing inside a `<strong>` only the new side had. Failure mode is silently mangled markup in outgoing mail. |
| (b) | Inline tags as diff tokens | **Rejected, worst option.** `diffWordsWithSpace` tokenizes on whitespace, so `<strong>Dear` is one token and the diff happily emits a hunk whose `newText` is `</strong> world <em>`. Reject-all then yields markup that is not even well-formed, which `DOMParser` re-balances unpredictably. |
| (c) | **Block segmentation** | **Adopted.** See below. |
| (d) | Map accepted hunks onto the answer's HTML by offset | **Rejected.** Same offset drift as (a), and asymmetric by construction — only the answer's formatting survives, so rejecting cannot restore the original's. Cannot express "this whole `<li>` was rejected". |

**Why (c) is the one that works: no tag can ever cross a hunk boundary.** Hunk boundaries exist only
*within* a block, and a block's wrapper element is emitted whole by the composer
(`composeResultBlocksHTML` → `renderBlocks`) and is **never carried inside a hunk**. There is
therefore no sequence of accept/reject choices that can emit an opening tag without its closing tag.
It is also the only option whose invariant is *provable* (P1/P2/P3 above) rather than hoped for, and
it degrades gracefully: a block with no inline markup on either side behaves exactly as before.

### The limitation, stated rather than discovered

**Inline formatting inside a changed hunk follows the side that is chosen, and is not itself
pickable.** If the answer bolded a word in a sentence it also reworded, accepting takes the bolding
and rejecting takes the original's markup for that span. There is no third state combining the
original's words with the answer's bold. That is the price of the only option with a provable
invariant.

**Nested lists are flattened one level:** an inner `<li>` becomes a block of the inner list's type.
Deliberately lossy — the alternative is a recursive tree diff, and nested lists in a proofread answer
are rare.

### The sanitizer is a security boundary

`sanitizeInlineHtml()` is not a tidiness pass. The answer is **model output on its way into the
user's outgoing mail**, and the plain-text path this replaces escaped absolutely everything, so the
allowlist is now what stands between the two:

- Kept: `b, strong, i, em, u, s, strike, code, a, br, span, sub, sup`. Everything else is
  **unwrapped** — its children survive, the element does not.
- Every attribute is dropped except `href` on `<a>`, and only when it matches `^(https?:|mailto:)`.
  `javascript:` and `data:` do not survive.
- Re-serialization goes out through `innerHTML`, which encodes entities correctly for free.
  Hand-rolled escaping on HTML input would escape the very tags being preserved.

`htmlToFragment()` is the **single choke point** for rendering: nothing that skipped the sanitizer
may reach the DOM.

### `sliceHtmlByText` and its escape hatch

Each hunk's `oldHtml`/`newHtml` come from `sliceHtmlByText(blockHtml, start, end, fallbackText)`,
which returns the markup for a text range with every enclosing inline tag reopened and reclosed. The
range is always *within one block*, so the ancestor chain is short and always closes.

Two details are load-bearing:

- **Ancestor shells are reused, not re-cloned per text node.** Otherwise two text nodes under one
  `<strong>` come back as `<strong>a</strong><strong> b</strong>` — visually identical, but not
  string-equal to what `renderBlocks` emits, which breaks the invariant on comparison alone.
- **If the range cannot be mapped, it falls back to `escapeHtml(fallbackText)` for that hunk alone**
  and warns to the console. That one hunk loses its formatting; malformed markup is never emitted.
  Built in from the start rather than added after, because this is the piece most likely to meet
  input nobody predicted.

### Line breaks: `<br>` is a block separator

**A `<br>` that is a direct child of a block ENDS that block** (`splitOnBr()`, applied at every
`makeBlock` call site in `segmentBlocks`). In a mail body the line structure is frequently carried by
`<br>` alone, and without this the whole body segments to **one** block while the markdown-it answer
segments to one `<p>` per paragraph — so `buildBlockPairs` pairs nothing and every hunk reads as
changed. Two live producers hit exactly that shape:

- Thunderbird's HTML compose **"Body Text"** mode separates lines with `<br>` inside one `<div>`.
- `getMailBody()` in `js/mzta-utils.js` builds the html of a **text/plain-only mail** as
  `text.replace(/\n/g, "<br>")`.

**`<br>` is deliberately NOT a member of `BLOCK_TAGS`.** That set doubles as "tags `renderBlocks`
emits as a wrapper" and is spread into `BLOCK_ALLOWED`; `<br>` is void, so it would come back out as
`<br>…</br>`. It is handled as a *separator* instead.

**Only direct children split.** A `<br>` nested inside an inline element (`<em>a<br>b</em>`) stays
within its run, so:

- `blockTextOfHtml`'s `<br>` → exactly one `\n` projection is **still reachable and must be kept**;
- `sliceHtmlByText`'s matching `seen += 1` accounting for a `<br>` is **still load-bearing**.

Removing either because "`<br>` is now a boundary" would silently break the offset space for any block
holding a nested `<br>`.

P1 (segment → render idempotence) is preserved: the empty run left by a trailing `<br>` or the blank
line in `<br><br>` has no text and is dropped by the same guard that drops empty blocks, so
re-segmenting the rendered `<p>`-per-line output reproduces the same block list.

`_buildDiffButton`'s old defensive `<br>` → `\n` replacement on the original is still **gone** — the
segmenter is what handles the original's markup.

### Into a plain text compose window

`composeResultHTML()` now emits **`<p>`/`<li>`-wrapped blocks**, structurally the same shape as the
non-picker markdown path. The conversion back to text is still **not** the picker's job — it happens
downstream, where the target window's format is known: `mzta-background.js` detects it with
`isPlainTextCompose()` and runs `stripHtmlKeepLines()`, and the content script inserts a `Text` node
instead of parsing HTML. See [01-architecture.md](01-architecture.md) → *Writing into a plain text
compose window* for the full path and why all of its parts are load-bearing.

**This is what changed for #855.** The picker's old `<br>`-only, `<p>`-less output is what made that
bug visible: `stripHtmlKeepLines` was tuned for `<p>`-wrapped markdown, and the picker's converted
`\n` were then re-parsed as collapsible HTML whitespace, collapsing the whole message onto one line.
The picker's output is now in that function's designed happy path, so **no change was needed in
`js/mzta-utils.js`**. The rest of the #855 machinery (the `Text`-node branch, the `plainTextBody`-aware
helpers) is still load-bearing for every other producer and is untouched.

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

- **`removeAloneBRs()`.** It strips every `<br>` with no `<p>` ancestor. **The reason for skipping it
  has changed, even though the behaviour has not.** It used to be mandatory: `composeResultHTML()`
  emitted `<br>`-separated text with no `<p>` wrapper, so running it would have deleted *every* line
  break. Now that the picker emits `<p>`/`<li>`-wrapped blocks, every `<br>` it produces has a block
  ancestor and the call would be **safe** — it is skipped because it is *pointless*: the picker's
  output is canonical by construction, and routing it through a cleaner written for the markdown
  producer only adds a way to go wrong. `removeAloneBRs` still guards the non-picker path.
- **The mouse-selection override.** `getCurrentSelectionHTML()` is not consulted for a turn with a
  picker, and that turn's `.sel_info` hint is hidden: two mechanisms competing over the same output
  would be confusing, and the picker is the explicit one. Turns without a picker keep the override
  untouched.

`_buildSaveSummaryButton` is **not** wired to the picker, because a summary session and a picker
session are mutually exclusive: every prompt carrying `headerMessageId`/`summaryTabId` has
`use_diff_viewer: "0"`.

## `composeResultHTML()` and escaping

**In REVIEW, nothing is escaped.** The result is built from the hunks' `oldHtml`/`newHtml`, which
already went through `sanitizeInlineHtml` at segmentation time; escaping them here would escape the
very tags the feature exists to preserve. Entity correctness comes from DOM serialization
(`innerHTML`), not from string replacement.

**In EDIT it is escaped**, because the editor holds genuine plain text — a `<` the user typed is a
literal character, not markup. `textToBlockHtml()` escapes each line and wraps it in `<p>`, which is
the same block shape the REVIEW path emits, so the downstream plain-text conversion stays on one code
path.

`escapeHtml` therefore survives for exactly two callers: `textToBlockHtml`, and `sliceHtmlByText`'s
fallback. Within it, `&` must still be replaced before `<`/`>` or the entities double-escape into
`&amp;lt;`.

## UI

Single **inline** view, not two columns — the webchat window is often narrow.

**Both versions of every change are on screen at once, and you click the one you want to keep.**
That is the core interaction:

- The body holds **real block elements** — one per segmented block, with `<li>` runs re-wrapped into
  a single `<ul>`/`<ol>` — so the picker shows the structure it is going to write into the mail
  instead of a flat wall of text. Context entries render their own sanitized markup.
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
- Keyboard: `j`/`k` **and `ArrowLeft`/`ArrowRight`** move between changes (the stepper reads as a
  left/right control, so the arrows are what a user tries first; the picker has no horizontally
  scrollable content to conflict with), landing focus on the **active** side so the next keystroke
  acts relative to what is actually there. `Space`/`Enter` on the inactive side selects it; on the
  active side it flips to the other one (otherwise the key would appear dead) and focus follows the
  new active side. Modified keys (ctrl/meta/alt) are ignored so browser shortcuts survive, and keys
  inside a textarea are left alone.

> An earlier iteration showed only one side at a time and toggled on click. It was changed because
> seeing the original and the suggestion together is the whole point of reviewing a proofread: with
> one side hidden the user cannot tell what they are choosing between.

### The toolbar

Sticky, and **two tiers inside one bordered container**:

- **Context strip** (`.picker-context`) — status icon, status text, progress bar, and the
  **Words / Sentences** granularity toggle. Nothing here changes the text; it is state plus one view
  setting.
- **Actions row** (`.picker-actions`) — the prev/label/next **stepper** pill, the **"…" overflow
  menu**, a flexible spacer, "Reject all", and the primary "Use this answer".

It replaced a flat single row that wrapped onto three ragged lines in a narrow window and gave the
destructive "Reject all" the same visual weight as the primary CTA.

Buttons still reuse `mzta-btn-secondary` / `mzta-btn-icon` from `sharedStyles.js`. The granularity
toggle is a `.picker-gran` segmented control whose selected position is **raised (surface + shadow),
not accent-filled** — two accent-filled controls in one bar read as two equally important actions,
and the CTA has to be the only one.

**Status copy** is `All N changes accepted` when everything is accepted (which is the default state,
so it is also what the user reads first) and `X of N changes accepted` otherwise. The progress bar is
the same number again visually, so it is `aria-hidden`: the counter already carries `aria-live`, and a
`progressbar` role would make every toggle announce twice.

**The stepper label doubles as the position readout**, which is why the old standalone counter is
gone. Before the user navigates there is no current change, so it shows the total alone (`9`, or
`9 changes` when narrow) rather than a `0 / 9` that claims a position which does not exist. Prev/Next
are **clamped, not wrapping** — landing back on the first change after the last would lose the user's
place in a long answer — and disable at the ends.

**Overflow menu:** *Accept all* and *Edit manually* always; *Reject all* joins them only on the
narrow layout, where it leaves the actions row. Dismissed by outside `pointerdown` (registered on
`document`, since clicks outside the picker never reach the host, and matched with `composedPath()`
because a shadow-DOM target arrives at document level as the host) and by `Escape`, which is handled
**before** every other keydown guard so it works in EDIT mode too.

### Responsive behaviour

One **container query** on `.picker-toolbar` (`container-type: inline-size`), not a media query: the
picker sits inside the transcript column (`max-width: 768px`), so window width is not what decides
whether the row fits.

- **≥420px** — the two rows above; stepper label `7 / 12`; "Reject all" inline.
- **≤419px** — both rows become columns, touch targets go to 44px, the stepper spans its line with
  the long `Change 7 of 12` label, the CTA goes full width, and "Reject all" moves into the menu.

CSS restyles at the breakpoint but cannot swap text or move a node between parents, so two decisions
are **measured** in JS against the same 419px threshold (`_isNarrow()`): which stepper label to use,
and which copy of "Reject all" is live. A `ResizeObserver` on the toolbar re-runs them, and only when
the breakpoint is actually crossed (`_wasNarrow`) — a window drag fires it continuously. Before the
picker is in the document the measured width is 0, which would read as narrow; the wide layout is the
right assumption there.

**`overflow: hidden` must not go on `.picker-toolbar`**, however much the context strip's background
wants clipping into the rounded corners: the overflow menu hangs below the actions row and would be
cut off. The strip rounds its own top corners instead, and `.picker-context[hidden] + .picker-actions`
takes over the rounding when the strip is gone.

**`.picker-status` is `display: contents` on the wide layout** so its three children join the strip's
single flex line; a plain div would swallow them into one flex item, collapsing the progress bar and
eating the strip's gap. The narrow rules turn it back into a real flex row.

### Two CSS traps in this shadow root

- **`[hidden] { display: none !important }` is required.** The UA's `[hidden]` rule loses to any class
  rule that sets `display`, and `.mzta-btn-*` / `.picker-*` all do — without it, every `.hidden`
  assignment in the component is silently a no-op.
- **No backticks in the CSS comments.** The stylesheet is a template literal, so a comment quoting
  ``display: contents`` terminates it and the module fails to parse. `node --check` does **not** catch
  this (the file is valid script either way); `import()` does.

**Zero-changes state:** when the answer normalizes identically to the original there is nothing to
pick, so the status, stepper and accept/reject-all are hidden and a muted note is shown instead of
a bare "0 of 0 changes accepted". "Use this answer" stays available and still returns the text. The
granularity toggle stays visible — switching to sentences on a word diff that found nothing is a
reasonable thing to try — so the context strip survives; only EDIT mode empties and hides it.

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

## REVIEW and EDIT modes

Two mutually exclusive modes, switched by the **Edit manually** item in the overflow menu (a
`menuitemcheckbox`, since EDIT is a state the item both reports and leaves — inside a menu that is
conveyed by the role and a tick, where the old inline button used an accent fill):

- **REVIEW** (default) — the per-change picker described above.
- **EDIT** — a `<textarea>` holding the current composition, freely editable.

EDIT exists for the case picking cannot cover: the suggestion is nearly right and the user wants to
fix one word themselves.

A **`<textarea>`, deliberately not `contenteditable`**. The original reason — contenteditable accepts
pasted rich text and breaks the plain-text-only contract — no longer applies now that the picker is
HTML-aware, but the conclusion stands for a stronger one: **contenteditable produces arbitrary
user-authored DOM that the segmenter cannot be trusted with**, and the EDIT → REVIEW round-trip has
to segment whatever comes back. The textarea keeps that output in a shape the pipeline already
handles.

**The consequence: entering EDIT discards the answer's formatting for the whole composition**, not
just the accept/reject decisions. The editor is plain text, and coming back re-segments it with
`textToBlockHtml()` — one `<p>` per line. `apiwebchat_picker_edit_hint` says so, and is shown
*before* the switch rather than after.

`_mode` (`'review'` | `'edit'`) is the state; `_setMode` mirrors it onto a `mode` attribute on the
**host**, and the CSS (`:host([mode="edit"])`) swaps the two views. One attribute write, so the two
views can never both be visible.

### `composeResultText()` is mode-aware

In EDIT it returns `this._editor.value` verbatim; in REVIEW it returns `composeResult(this._hunks)`.
This is what makes **"Use this answer" and Copy work straight from the editor** with no trip back
through REVIEW. Both consumers in `messagesArea.js` (`composeResultHTML()` at the use-answer site,
`composeResultText()` at the Copy site) go through these methods, so neither needed changing.

### EDIT → REVIEW re-diffs from scratch

Coming back runs `_rebuild(textToBlockHtml(this._editor.value))` — `buildHunks(originalHtml,
editedAsBlocks)`, a full recompute against the **original**. No merge, no attempt to carry the old
hunk list over. The `textToBlockHtml` wrap is what gives the segmenter blocks to work with, and is
where the answer's formatting is lost.

**This resets every hunk to `'accepted'`, discarding accept/reject decisions made before**, and the
counter jumps back to "N of N". That is the design: the hunks are recomputed against different text,
so old decisions have no counterpart to map onto and inventing one would misrepresent what the user
chose. Same reasoning as the granularity switch. Because it *is* surprising, EDIT mode shows a note
(`apiwebchat_picker_edit_hint`) warning about it **before** it happens rather than after.

The invariant survives the round-trip: after EDIT → REVIEW, reject-all still yields
`renderBlocks(segmentBlocks(originalHtml))` — the original side never changed, so P1–P3 hold exactly
as before. (Verified for the plain-text model; see the caveat under the invariant for the HTML one.)

`setContent()` also forces `'review'` and clears the editor: a fresh picker opening into the editor
would hide the very changes the button was clicked to see.

### What is hidden in EDIT

Status and progress, the stepper, Accept all / Reject all **and** the granularity toggle. All operate
on hunks, which do not exist over free text — and re-diffing at a new granularity would throw away what
the user typed. That empties the context strip entirely, so **the strip itself is hidden** rather than
left as a bare tinted band, and the actions row inherits the container's top rounding.

"Use this answer" stays, as does the overflow button — the menu is how the user gets back out of EDIT.
`_onKeydown` returns early on `_mode === 'edit'` (after the `Escape` branch, which must keep working
to dismiss the menu): the textarea guard already covers keys typed in the box, but focus can sit on a
toolbar button while editing, and `j`/`k`/arrows must not act there either.

### Opening scroll position

`appendDiffPicker` **anchors the picker's own turn** (`_setAnchor(pickerTurnEl)` +
`_resumeFollowing()`), it does **not** `scrollToBottom()`. A long answer makes a tall picker, and
scrolling to its bottom dropped the user into the middle of the text with the sticky toolbar
off-screen above — the opposite of what "Show differences" was clicked for. Anchored, the picker's
head and toolbar land at the top of the viewport and the text runs below the fold for the user to
scroll through.

This reuses the same anchor machinery that pins a prompt turn while its answer streams, and reusing
it (rather than writing `scrollTop` once) is what makes the position *hold*: the picker is the last
turn, so without the shortfall `_updateAnchorSpacer()` reserves there is not enough content below it
for `scrollTop` to reach the target at all. A **short** picker is then clamped to the bottom by
`_followTarget()`, which is right — it already fits entirely.

`_followTarget()`'s "prompt taller than a third of the viewport" branch keys off
`nextElementSibling`, which for the picker is nothing (or the anchor spacer, explicitly excluded), so
it never applies. The anchor cannot go stale either: the next user prompt re-anchors in
`appendUserMessage`, and `appendBotMessage` clears it via `scrollToBottom()`.

### Height and scroll

The textarea opens at the height the review view had. `offsetHeight` is measured **before** hiding it —
on a `display: none` element it is 0. Because both views then start the same size, there is no scroll
position left to restore; the problem largely dissolves rather than being solved.

The picker has **no reference to `MessagesArea`** and must not get one: `messagesArea.js` imports
`diffPicker.js`, so a reference the other way would invert the dependency. Instead it dispatches a
`CustomEvent('mzta-picker-resize')` with `bubbles: true` **and `composed: true`** — without `composed`
the event never crosses the shadow boundary. Fired on a mode switch, and by a `ResizeObserver` on the
textarea when the user drags its resize handle (silent in REVIEW).

`MessagesArea` listens **once**, delegated on `this.messages` in `connectedCallback` (the event bubbles,
so one listener serves every picker and there is nothing to tear down per turn) and handles it with
`_onPickerResize` → **`this._updateJumpButton()` and nothing else**. Read-only, exactly like
`_contentObs`. Deliberately **not** `scrollToBottom()`, which does `_setAnchor(null)` and sticks to the
bottom — that yanks the user away from what they are editing, the opposite of leaving their position
alone. Not `_scrollIfSticky()` either: this is not new content arriving, it is the same content changing
size under the user's own hands.

`_editorObs` is disconnected in `disconnectedCallback()`, alongside the keydown listener.

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

The toggle now applies **within a block**: the block segmentation absorbs the paragraph-level
structure that used to generate noise hunks, so the choice is purely about the unit inside a
paragraph — which is what it was always trying to express.

`setGranularity('words' | 'sentences')` sets the initial value (it does **not** re-diff, so after
`setContent()` the toolbar toggle is the way in). `_changeGranularity(g)` is the interactive path.

Two properties of the interactive switch matter:

- **It re-diffs from `_newHtml`, never from the composed text.** Comparing the original against the
  current composition would make the answer's rejected parts unreachable, turning a view setting into
  a destructive edit.
- **It discards every accept/reject decision** — all changes go back to `accepted`. There is no correct
  alternative: one sentence-level hunk spans several word-level ones, so the decisions carry no meaning
  across the boundary and mapping them over would silently invent choices the user never made. Losing
  them visibly beats corrupting them invisibly. (Same reasoning as the EDIT→REVIEW round-trip.)
- Clicking the position already selected is a no-op, so it cannot wipe choices by accident.

Caveat worth knowing about `'sentences'`: `SentenceDiff.tokenize` only splits on `[.!?]` followed by
whitespace, so on **single-sentence** text it degenerates to one delete + one insert covering
everything — a single "replace it all" hunk. Under the block model this now applies **per block**
rather than to the whole answer, which is an improvement: a single-sentence paragraph collapsing to
one replace hunk is a reasonable rendering, where the same thing across an entire answer was not.

`aria-checked` is painted both from `setGranularity()` and at build time in `_buildGranularityToggle()`;
without the latter a picker left at the default would show neither position as selected.

### Where the initial value comes from

The toolbar toggle changes the granularity in the moment; the **starting** value is the global
`diff_granularity` preference (`prefs_default`: `'words'`), read by `_resolveDiffGranularity()` in
`messagesArea.js`. Anything unrecognised falls back to `'words'` rather than reaching `buildHunks`,
where an unknown key would silently pick the default function.

**There is deliberately no per-prompt override.** One global default plus the in-place toolbar toggle
covers the need: the choice depends on what the answer turned out to look like, which is knowable only
while reading it, not when configuring a prompt. A per-prompt setting was implemented and then removed
as unnecessary configuration surface — if it is ever reconsidered, note that the three prompts using
the picker (`prompt_proofread_this`, `prompt_rewrite_formal`, `prompt_rewrite_polite`) are all
**default** prompts, whose user-editable properties only persist if the field is added to all three of
`setDefaultPromptsProperties`, `getDefaultPrompts_withProps` and `preparePromptsForExport`'s
`allowedKeys`.

## Files

| File | Role |
|------|------|
| `api_webchat/diffPicker.js` | Block segmentation + sanitizer, hunk model, compose functions, `<diff-picker>` element. Also exports `sanitizeBlockHtml()`, the gate the answer path uses |
| `api_webchat/streamingMessage.js` | Decides per response whether the answer is HTML; sanitizes it instead of running markdown-it |
| `api_webchat/messagesArea.js` | `_buildDiffButton` (resolves both sides' HTML), `hasBlockStructure` (the original-side canonicalization guard), `appendDiffPicker`, the `_mztaPicker` indirection, `_onPickerResize` |
| `api_webchat/svgIcons.js` | `buildHunkMarkerIcon` (the empty-side placeholder); the toolbar's chevron / circle-check / check / cross / pencil / overflow icons |
| `js/lib/diff.js` | jsdiff; provides the `Diff` global (classic script, loaded before the modules). `diffArrays` pairs blocks, `diffWordsWithSpace`/`diffSentences` diff within one |
| `js/mzta-menus.js` | sets `curr_prompt.body_html` (the picker's original side) alongside `body_text` / `selection_html`; `htmlHasLineStructure` / `htmlOrFromText` rebuild a structure-less html twin from its text |
| `_locales/en/messages.json` | `apiwebchat_picker_*`, including the EDIT hint's formatting-loss warning |
| `js/mzta-utils.js` | `isPlainTextCompose`, `stripHtmlKeepLines`, and the `plainTextBody`-aware body helpers |
| `js/mzta-compose-script.js` | `replaceSelectedText` — the `Text`-node branch that preserves `\n` |
| `mzta-background.js` | detects the compose format and converts before insertion |
| `options/mzta-options-default.js` | the global `diff_granularity` preference |
| `options/mzta-options.html/.js` | the global preference's control in the advanced section |
