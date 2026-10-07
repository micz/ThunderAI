# The compose area

What the add-on reads from a mail and writes into it, and the panels it draws into the message
display. It closes the extraction side of the newline contracts that the `prompts` area leaves
uncovered (level 1 there sees only that an extracted value reaches the prompt unchanged).

All of it runs on `js/mzta-compose-script.js`, the classic content script `mzta-background.js`
registers both as a compose script and as a message display script, always after
`js/lib/mzta-html-lines.js`, whose globals it uses; and on the DOM helpers of `js/mzta-utils.js`,
which run in the background page. Every test names the spec section it was written from; the
expected values come from the spec, never from running the code.

```sh
node --test "tests/dom/compose/*.dom.mjs"          # the area (needs npm ci)
node --test tests/compose/99-harness-known-issues.test.mjs   # level 1: the known-issue file
```

## Files

| File | Document | What |
|---|---|---|
| `compose-01-html-reply-captured` | the captured HTML reply, reopened in a compose window | **A**: typed / quoted / body text and HTML of a real draft (serializer indentation included); a panel drawn in the compose body is never read back |
| `compose-02-html-reply-paragraph` | an HTML reply in Paragraph mode | **A**: exact typed / quoted / body text, the raw join rule, selection twins, mid-tag selection, autoselect ranges |
| `compose-03-html-bodytext-new` | a new message in Body Text mode, with signature | **A**: `<br>` lines, the bogus trailing `<br>`, the signature; the generating panels where the own message is unknown |
| `compose-04-plaintext-read` | the captured plain text compose window | **A**: lines as `\n`, the structure-less html twin rebuilt from the text, selections across a line |
| `compose-05-html-write` | as 02 | **B**: `replaceSelectedText` into HTML: nodes through a fragment, no nested `<body>`, none skipped, the rest untouched, `compose_reloadBody` |
| `compose-06-plaintext-write` | as 04 | **B**: `replaceSelectedText` into plain text: one `Text` node, markup kept literal, `compose_reloadBody` flagged plain |
| `compose-07-display-captured` | the captured HTML mail in the message display | **A**: body text and HTML; then every panel, the badge and a dialog are drawn and none of it is read back, by any reading command |
| `compose-08-display-extraction` | a hand-written newsletter in the message display | **A**: hidden elements in every spelling, `<style>`/`<script>`, Outlook markup, tables, lists; text stripped, HTML kept, selections untouched |
| `compose-09-background-extraction` | the background page | **C**: `htmlBodyToPlainText()`, `getMailInlineTextParts()`, `{%mail_text_body%}` / `{%mail_plain_text_part%}` through `preparePrompt()`, `stripHtmlKeepLines()` |
| `compose-10-panels` | the captured mail in the message display | **D**: summary, translation and spam panels shown / replaced / removed, their menus, own-message check, late spinners, max display length, generic error and info, order |
| `compose-11-sanitizer` | the captured mail in the message display | **D**: every payload of `sanitizer-payloads.json` through the summary and the translation panel |
| `compose-12-dialogs` | the captured mail in the message display | **D**: the `getTags` confirmation dialog (exclusions, exact match, hiding, lock) and `sendAlert` |
| `compose-13-reinjected` | a message display holding a previous instance's panels | **D**: the stale generating panels removed when the script is injected again |

`99-harness-known-issues.test.mjs` (level 1) checks the known-issue file itself.

Run time: one document per file, many tests on it (13 jsdom processes, 236 tests). Run alone, the
area takes about 58 s one file at a time and about 23 s with `--test-concurrency=4`.

## The core entry point: `openDocument()`

The DOM harness could only open a page file of the add-on. A content script runs in a document
Thunderbird builds, and `htmlBodyToPlainText()` needs the background page's DOM: so the area added
`openDocument()` to `helpers/core/dom-harness.mjs`, the one core change it made. It shares
`openPage()`'s implementation (`openContext()`): given HTML at a given url, the same mock and
strict proxy, the given classic scripts in order, the given modules imported, `settle()`, and the
same `ctx`. Documented in [`../README.md`](../README.md#a-document-that-is-not-a-page-opendocument).

`compose-doc.mjs` builds on it:

- `openMailDocument({html, url, displayedMessageId, commands})` loads `CONTENT_SCRIPTS`
  (`js/lib/mzta-html-lines.js`, then `js/mzta-compose-script.js`) and answers the four commands the
  script sends at load (`getDisplayedMessageId` with the given id, `null` in a compose window;
  `checkSpamReport`, `initSummary`, `initTranslation`). Every other command a file expects is in its
  `commands`: an undeclared one is still a harness violation.
- `openBackgroundDocument({modules, apis})`: an empty document at the background page's url, with
  `js/lib/mzta-html-lines.js` loaded as `mzta-background.html` loads it.
- `send()` delivers a background command through `runtime.onMessage` and settles; `select()`,
  `caretAfter()`, `clearSelection()` set the selection; `readCapture()` reads a captured `.eml`.
- **`<dialog>`**: jsdom implements neither `showModal()` nor `close()`. The helper models them on
  the documents it opens (not in the core): `showModal()` sets `open`, `close()` removes it and
  **queues** the `close` event as a task, as HTML does, so the listener the script adds right after
  `close()` still runs.

The content script's raw values are compared after the cleanup the spec names for the placeholder,
with the real function: `cleanupNewlinesKeepParagraphs()` for `{%mail_typed_text%}` /
`{%mail_quoted_text%}`, `cleanupNewlines()` for `{%mail_text_body%}` (spec 03), and the shared
layer's `mztaHtmlToLines()` / `mztaNormalizePlain()` / `mztaLinesToHtml()` / `mztaHasLineStructure()`
for the selection twins. `getMailBody()` and `selectionTwin()` themselves are closures inside the menu
builder of `js/mzta-menus.js`: not reachable, so not run.

## The fixtures and their sources

In `tests/fixtures/compose/`:

| Fixture | Source |
|---|---|
| `captured/mail_html_compose_signature_quote_text.txt` | **captured**: an HTML reply draft as Thunderbird saved it (Paragraph mode, quote, signature). Opened as the compose body, its serializer indentation included, as a reopened draft holds it |
| `captured/mail_text_compose_signature_quote_text.txt` | **captured**: a plain text reply draft. Its body becomes the text of the compose body (see "Under-specified" 2) |
| `captured/mail_html_reading.txt` | **captured**: an HTML mail. Its bytes are ISO-8859-1 although its header says `charset=utf-8` (re-saved after anonymizing): `readCapture()` decodes it as latin1. Its body is put in `div.moz-text-html`, the message display's wrapper, written by hand |
| `html-compose-paragraph-reply.json` | hand-written: the captured reply's structure without the indentation, plus a non-breaking space, a Shift+Enter `<br>` and a second quoted line |
| `html-compose-bodytext-new.json` | hand-written: Body Text mode as spec 07 describes it (`<br>` lines in one `<div>`, the bogus trailing `<br>`), the captured signature block |
| `html-display-newsletter.json` | hand-written: every shape the extraction rules of spec 01 / 03 name; `text_body` is the expected text, written from those rules |
| `sanitizer-payloads.json` | hand-written: the payloads below |

Each JSON fixture carries its `source`.

## The sanitizer payloads

Spec 01 "Panel HTML sanitization": the content script's `_renderSafeHtml()`, used by the summary
and the translation panel, is the defense in depth behind the background's sanitizer. The payloads
reach it **unsanitized**, so it is tested on its own. Each opens with a safe `<p>ok</p>` (so the
translation takes its HTML branch) and must leave no `script, img, style, link, iframe, frame,
frameset, object, embed, form, meta, base, svg, math, template, noscript`, no `on*` or `style`
attribute (the panel's own `margin-block-start` on `<p>` excepted) and no `javascript:` /
`vbscript:` / `data:` URL in a URL attribute, read as a browser reads a scheme (C0 controls and
spaces ignored, any case) - in the panel, and nowhere in the document (`compose/safety.mjs`):

- `<script>` inline and with `src`; `on*` handlers on plain elements, `<img onerror>`, `<details ontoggle>`;
- `javascript:` / `vbscript:` / `data:` on `<a>` and `<area>`; `<iframe>` (with `src` and `srcdoc`),
  `<object>`, `<embed>`, `<form action>`, `formaction` on `<button>` / `<input>`, `<input type=image>`;
- `<meta http-equiv=refresh>`, `<base href>`, `<link>` and `<style>` hiding the add-on's own panels;
- `<svg>` with `<script>`, `onload`, `xlink:href` and `<animate>`; the `<math><mtext><table><mglyph><style>`
  namespace-confusion vector; `<template>`; the `<noscript>` attribute-breakout vector;
  a `style` overlay with a `url(javascript:)`; `<frameset onload>` with a `<frame>`;
- split / obfuscated: upper case, `<scr<script>ipt>` and `<<script>script>`, an unclosed `<script>`,
  `/` as attribute separator, entities in the scheme (`&#106;`, `&#x6A;`, `&colon;`), whitespace
  and controls in the scheme (leading space, tab, newline, `&Tab;`, `&#x01;`), mixed-case schemes,
  comment and CDATA tricks, handlers inside allowed formatting, `<body onload>`.

Result: nothing executable reaches the message display through either panel, for any payload.
A payload that is only a `<frameset>` parses with the frameset as the body, so nothing is left once it is removed: the panel is drawn empty (it used to throw and lose the panel, fixed).

## Known issues

In `tests/helpers/known-issues/compose.mjs`, run as TODOs while they fail:

| Case | Spec section | What the code does |
|---|---|---|
| `09-gmail-div-lines` | 03 "Newline contract of the body placeholders" | the projection only appends a `\n` to a block, so text before a block is welded to it: Gmail's `Hi Bob,<div>thanks</div>` gives `Hi Bob,thanks` (both paths) |
| `09-source-newline-not-a-line`, `01-text-body-citation-one-line` | 03 "Newline contract of the body placeholders" | a newline in an HTML text node (source wrapping, serializer indentation) becomes a line of `{%mail_text_body%}` |
| `01-quoted-br-single-break` | 03 "Newline contract of the compose placeholders" | the same in a reopened draft: `<br>` + the newline after it gives a blank line in `{%mail_quoted_text%}` |
| `09-markdown-br-newline`, `09-markdown-list` | 01 "Writing into a plain text compose window", 07 | `stripHtmlKeepLines()` keeps the newline after `<br>` and `</li>`: markdown-it's `<br>\n` becomes a blank line, list items get blank lines between them |
| `01-typed-skips-injected` | 01 "The rich-text layer" | a panel drawn in the compose body is read as typed text (spec 01's own "Known gap") |
| `03-typed-without-signature` | 01 "The rich-text layer" | in a new message the signature is read as typed text (spec 01's own "Known gap") |

## What is not covered

- **Layout and the CSS cascade**: the theme colours (jsdom has no `matchMedia`, so the light ones are
  used), the spam badge's overflow measurement and its `ResizeObserver` (#929), the HTML summary /
  translation truncated by height (its toggle appears only after a layout measurement), the menus'
  positions.
- **A selection across blocks read as text**: jsdom's `Selection.toString()` is the range's text, with
  no line break between blocks; Gecko serializes one. Selected text is tested inside a line and in the
  plain text window; across blocks, the html twin is.
- **The background end of the panels**: `_sendIfCurrent()`, `_sendToTabsDisplaying()`,
  `_sanitizePanelPayload()`, the job registry, `_restoreSummaryButton()` after a Delete: code inside
  `mzta-background.js`.
- **`getMailBody()` / `selectionTwin()` / `htmlOrFromText()`** of `js/mzta-menus.js` as functions: see
  above; their normalizers are applied to the script's values.
- **The compose API round trip**: what `compose_reloadBody`, `setBody()`, `replaceBody()`,
  `insertHtml()` and `isPlainTextCompose()` do with the body (`plainTextBody` vs `body`).
- **`buildSummaryPrompt()` / `buildTranslationPrompt()`**: they go through the functions tested here
  (`getMailInlineTextParts()`, `htmlBodyToPlainText()`, `preparePrompt()`), not end to end.
- **The `<pre>` gap** spec 01 documents ("keeps its line breaks but not its internal indentation or
  blank lines"): stated as a gap, not asserted.
- **`{%mail_quoted_text%}` in a plain text compose window** (Under-specified 2).

## Under-specified

What the code does that no spec states, listed instead of tested:

1. **A line's leading whitespace.** The cleanup collapses space runs and trims line ends and the whole
   value, but keeps one space where the source indentation was (`" Regards!!!"` from a reopened
   draft, `"a\n b"` from pretty-printed HTML). The tests compare such lines trimmed.
2. **The plain text compose window's DOM.** Spec 01 says its breaks are `\n` in text nodes; how the
   editor holds the quote and the signature (elements or text) is neither stated nor captured. The
   fixture is the captured text as one text node, so `{%mail_quoted_text%}` is not tested there. A
   capture of `document.body.innerHTML` from a live plain text compose window would settle it.
3. **The signature in `{%mail_quoted_text%}`**: the walker reads from the citation to the end of the
   body, the signature included.
4. **`getText`**: no spec, and `js/mzta-menus.js` does not send it. Only what spec 01 says of "the two
   text cases" (hidden elements, `<style>`/`<script>` and the add-on's own elements removed) is tested.
5. **`replaceSelectedText` with no selection**: it asks `confirm(Replace_No_Selected_Text)` and inserts
   at the caret; with no range at all `getRangeAt(0)` throws.
6. **`sendAlert`**: an in-pane dialog for `curr_tab_type: 'mail'` (a workaround for a Thunderbird
   bug, says the code), `alert()` otherwise, and the error / warning titles. Only that the message
   reaches the user, as text, is tested.
7. **The order of the summary and the translation panels.** Spec 01 "Key Modules" lists "generic
   error, spam explanation, summary, translation"; the code draws the translation above the summary
   (`_PANEL_ORDER`), the generic info after the error, and the spam report is no longer a panel but the
   toolbar badge. Tested: the badge first in the toolbar, the error first among the panels, the
   container above the mail.
8. **`moz-main-header`**: what is removed with the table (the `DIV`s before it), and that the
   interactive path removes it too (`getCleanBodyHtml()`). Tested: the header's text is gone.
9. **The webchat summary button** (`triggerSummaryWebchat`), the skipped translation
   (`translation_status: '-1'`), the `[ThunderAI | source]` prefix of the generic panels, and the
   fallback to defaults when `addtags_get_exclusion_prefs` fails.
10. **What a re-injected script does with the rest of a previous instance's container** (a banner, the
    toolbar): spec 01 names only the two generating panels.
