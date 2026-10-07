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
| `compose-04-plaintext-read` | a live plain text compose window, captured (a reply, nothing typed) | **A**: the window's shape (pre-wrap body, top-level `<br>`), the quoted text with its `> ` lines and the signature, the body text, the html twin, a selection |
| `compose-05-html-write` | as 02 | **B**: `replaceSelectedText` into HTML: nodes through a fragment, no nested `<body>`, none skipped, the rest untouched, `compose_reloadBody` |
| `compose-06-plaintext-write` | as 04 | **B**: `replaceSelectedText` into plain text: one `Text` node, markup kept literal, `compose_reloadBody` flagged plain |
| `compose-07-display-captured` | the captured HTML mail in the message display | **A**: body text and HTML; then every panel, the badge and a dialog are drawn and none of it is read back, by any reading command |
| `compose-08-display-extraction` | a hand-written newsletter in the message display | **A**: hidden elements in every spelling, `<style>`/`<script>`, Outlook markup, tables, lists; text stripped, HTML kept, selections untouched |
| `compose-09-background-extraction` | the background page | **C**: `htmlBodyToPlainText()`, `getMailInlineTextParts()`, `{%mail_text_body%}` / `{%mail_plain_text_part%}` through `preparePrompt()`, `stripHtmlKeepLines()` |
| `compose-10-panels` | the captured mail in the message display | **D**: summary, translation and spam panels shown / replaced / removed, their menus, own-message check, late spinners, max display length, generic error and info, order |
| `compose-11-sanitizer` | the captured mail in the message display | **D**: every payload of `sanitizer-payloads.json` through the summary and the translation panel |
| `compose-12-dialogs` | the captured mail in the message display | **D**: the `getTags` confirmation dialog (exclusions, exact match, hiding, lock) and `sendAlert` |
| `compose-13-reinjected` | a message display holding a previous instance's panels | **D**: the stale generating panels removed when the script is injected again |
| `compose-14-plaintext-typed` | as 04, with three typed lines and a blank line | **A**: the typed lines' contract, the body text, the autoselect range |

`99-harness-known-issues.test.mjs` (level 1) checks the known-issue file itself.

Run time: one document per file, many tests on it (14 jsdom processes). Run alone, the
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
| `captured/plaintext_compose_body_live.html` | **captured**: the `<body>` of a live plain text compose window, a reply with quote and signature and nothing typed, read with `tabs.executeScript(tab.id, {code: 'document.body.outerHTML'})` from the add-on's background console. Anonymized |
| `captured/mail_text_compose_signature_quote_text.txt` | **captured**, kept for reference and not used: a plain text reply draft as Thunderbird SAVED it - the serializer's output (`format=flowed`, the `> ` it writes), not what the editor holds |
| `plaintext-compose-typed.json` | derived from the live capture: three typed lines and a blank line, in the capture's own shape (top-level text and `<br>`) |
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

In `tests/helpers/known-issues/compose.mjs`, run as TODOs while they fail. None today.

What the area found was fixed, and the spec updated where it described the old behaviour:

- the sanitizer threw on a payload that is only a `<frameset>` (the panel was lost) - spec 01
  "Panel HTML sanitization" already required the removal;
- `htmlBodyToPlainText()` read a `<script>`'s source as body text, unlike the interactive path
  (spec 01 "`getCleanBodyHtml()` returns a DETACHED clone", "`htmlBodyToPlainText()` injects the
  line structure");
- the projection welded text to the block after it (Gmail's `Hi,<div>next</div>`), and read the
  HTML source's whitespace as lines: wrapped paragraphs, a reopened draft's indentation, markdown-it's
  `<br>\n` and pretty-printed lists doubled on plain text insertion (spec 01 "`htmlBodyToPlainText()`
  injects the line structure", spec 03 "Newline contract of the body placeholders");
- the typed / quoted walkers had the same whitespace defect, read the add-on's own panels and
  dialogs, and read the signature of a new message as typed text (spec 01 "The compose-extraction
  newline contract" and "The rich-text layer", where these were recorded as known gaps);
- the typed / quoted walkers made every top-level node a line, so a plain text window - whose lines
  are top-level `<br>`, as the live capture showed - had each line break counted twice in
  `{%mail_typed_text%}` (spec 03 "Newline contract of the compose placeholders"; spec 01, which said
  the lines were `\n` in the text nodes, was corrected).

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

## Under-specified

What the code does that no spec states, listed instead of tested. None today: every item below was settled in the spec, then tested.

1. *(resolved: spec 01 now states that HTML source whitespace is not line structure, in the shared
   projection and in the compose walkers; a line no longer starts with the indentation's space, and
   the tests compare exact lines.)*
2. *(resolved: a live plain text compose window was captured, and spec 01 "The compose-extraction
   newline contract" now describes what it holds - top-level `<br>` under a pre-wrap body, the
   citation and signature divs, the quote span. It used to say the lines were `\n` in the text nodes.)*
3. *(resolved: spec 01 "The rich-text layer" now states that `getOnlyQuotedText` reads to the end of the
   body, the signature included, while `getOnlyTypedText` stops at it.)*
4. *(resolved: `getText`, which nothing sent, was removed from the compose script and from spec 01.)*
5. *(resolved: spec 01 "Writing into a plain text compose window" now states the no-selection case: after
   the confirmation the answer goes at the start of the email, wherever the cursor is, and also with no
   range at all, which used to throw.)*
6. *(resolved: spec 01 "The message-display panels and dialogs" now describes `sendAlert`: the in-pane
   dialog of a mail tab and its titles, `alert()` elsewhere.)*
7. *(resolved: spec 01 "Key Modules" and "The message-display panels and dialogs" now give the code's
   order - toolbar spam, summary, translation; panels generic error, generic info, translation,
   summary - and the tests check it exactly.)*
8. *(resolved: spec 01 "Where the body comes from" now says what is removed with the
   `moz-main-header` table, on both paths, from the text and the HTML.)*
9. *(resolved: spec 01 "The message-display panels and dialogs" now covers the webchat summary button,
   the skipped translation, the generic panels' prefix and the tag dialog's fallback.)*
10. *(resolved: same section: a re-injected script removes only the generating panels and draws into
    the same container.)*
