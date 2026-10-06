# Tests: the API chat window and the diff picker (webchat)

DOM tests of the API chat window, `api_webchat/index.html`: how it starts, how it renders what the
worker streams, how the user's actions reach the background, and the diff picker. The contract is
spec 01 "API WebChat (`api_webchat/`)", the webchat sections of spec 04 ("Thinking output in the
webchat UI", "Live "Thinking…" indicator", "Font zoom in the webchat UI", "Emitting to the chat
window", "Rendering in the chat window", "Context window") and spec 07 (the diff picker). Each DOM
file names the sections it covers in its opening comment, and **every test names its section in its
title** (`[NN-case] spec NN "<section>": ...`).

The worker-to-window messages are already tested from the worker side by the api area
([`api/README.md`](../api/README.md)); this area tests the **window side** of the same contract, with
a scripted worker.

How to run the suite, the two levels, the DOM harness, `settle()` and the known-issue mechanism are in
the general [`tests/README.md`](../README.md). Paths below are relative to `tests/`.

## Running

```sh
node --test --test-timeout=120000 "tests/webchat/*.test.mjs" "tests/dom/webchat/*.dom.mjs"
```

from the repository root, after `npm ci` (jsdom). `tests/webchat/*.test.mjs` is level 1 and needs
nothing installed; `node --test "tests/**/*.test.mjs"` runs it with the rest of level 1.

The area adds about **3-15 s per DOM file** (each file opens the window once, in its own process;
`webchat-06`, which streams 34 answers, is the longest). The whole area runs in about 35 s on its own,
less within `npm test`, where `node --test` runs the files in parallel. A file whose last answer
finished stays alive up to 4 s after its tests, until the "done" pill's own fade timer has fired.

## Status

The area is built group by group:

| Group | What | State |
|---|---|---|
| A | start-up and the background protocol | done (`webchat-01` to `04`) |
| B | rendering the stream | done (`webchat-05` to `09`) |
| C | actions on an answer | done (`webchat-10` to `12`) |
| D | the diff picker (spec 07) | to do |

## Layout

```
tests/
├── helpers/known-issues/webchat.mjs   the known issues, their shape (validateKnown()), and webchatTests()
├── fixtures/webchat/                  sanitizer-payloads.json: the answers that probe the sanitizer
├── webchat/
│   ├── README.md                      this file
│   ├── fake-worker.mjs                expectWorker(): the scripted Worker
│   ├── shadow.mjs                     sq() / sqa() / deepElements(): queries through the shadow roots
│   ├── webchat-page.mjs               openWebchat(), fromBackground(), apiSend(), the views
│   ├── safety.mjs                     allowlistProblems(), executableProblems(), htmlProblems()
│   ├── usage-view.mjs                 the usage chip and its popover rows, as shown
│   └── 99-harness-known-issues.test.mjs   level 1: the known-issue shape
└── dom/webchat/webchat-NN-<scenario>.dom.mjs   the tests, one file per initial state of the window
```

The area **imports only the core** (`helpers/core/`): `openPage()` and `assertHarnessClean()` from
`helpers/core/dom-harness.mjs`, `knownTest()` through `helpers/known-issues/webchat.mjs`, `EXT_ORIGIN`
from `helpers/core/browser-mock.mjs`. It never imports the managed layer (`helpers/*.mjs`) nor another
area's helpers, and has **no plugin**. Every file runs with no policy and ends with
`assertHarnessClean(ctx)`.

One file is **one initial state** (the query string, the stored preferences, the background's
`api_send`): its tests run in order on one opened window, and a later test builds on what an earlier
one did (each file says so).

## Coverage

| File | Spec section(s) |
|---|---|
| `dom/webchat/webchat-01-startup` | spec 01 "Component structure" (the provider prefs resolved into the init message, sent first; the URL parameters: a prompt name holding `%` and markup decoded once; the header: model and API, no usage; the ready handshake `{command: "${llm}_ready_${call_id}", window_id}` before any prompt; the startup notice, every value escaped), "Web Workers (`js/workers/`)" (the provider's worker file, as a module), "Streaming data flow" (`api_send`: the prompt shown as the user's message and sent to the worker as one `chatMessage`; the input locked, Stop offered and the waiting pill while it is out; `messageSent` empties the field), "Transcript DOM contract" (the startup notice `.turn-info > .message.info`; the `.turn-user .bubble`, nothing executable in it); spec 04 "Configuration Validation" (the prompt's own model over the global one), "Anthropic / Claude (`anthropic_api`)" (no `anthropic_err_hint_*` for another provider), "Emitting to the chat window" (the `chat_show_usage_data` flag on the init message), "Rendering in the chat window" (nothing marked `data-mzta-usage` in the header), "Font zoom in the webchat UI" (the saved level re-applied; Ctrl/Cmd + `+` / `=` / `-` / `0`, persisted; no modifier, no change; a key from inside a component; clamped to 0.5-2.5; the input sized in `rem`) |
| `dom/webchat/webchat-02-custom-text-tokens` | spec 01 "Streaming data flow" (`do_custom_text` "1": the custom-text field instead of sending); spec 03 "`additional_text`: the user's input, filled late" (one step per entry, `[ID: <info>]`, the `n/total` counter, Enter on the last step; the late fill: every token replaced, every spelling of a label, an empty answer becoming `""` with `placeholders_use_default_value` on) |
| `dom/webchat/webchat-03-custom-text-append` | the same sections: no token and no entries, one step, no counter, the text appended after a space |
| `dom/webchat/webchat-04-api-error` | spec 01 "Streaming data flow" (`api_error`: the error in a bot turn of its own, as text, nothing sent to the worker, the input left usable), "Transcript DOM contract" (the Close-only `.action-bar` of an error turn; Close sends `{command: "chatgpt_close", window_id}` and swallows its rejection); spec 04 "Live "Thinking…" indicator" (the error pill: its class alone, the inline alert icon), "Anthropic / Claude (`anthropic_api`)" (the four `anthropic_err_hint_*` strings, each holding the literal `$MODEL$`) |
| `dom/webchat/webchat-05-stream` | (group B) spec 01 "Streaming data flow", "One render path, no router" (the hybrid `Ciao <b>Mario</b>\ngrazie`, a table and a rule kept, a code fence as text), "Streaming: re-render the whole accumulated raw each time" (live token spans between renders, the render past 2 KB re-parsing the whole raw, a tag split across tokens whole, no double `<br>`, no weld at a segment boundary, many tokens rendering exactly as one), "Transcript DOM contract" (one turn and one avatar per answer, the history, the full bar on the newest answer only); spec 04 "Thinking output in the webchat UI" (the block prepended, collapsed by default, inline `<think>` extracted; a thinking-only answer still shows its block), "Live "Thinking…" indicator" (the row, a sibling of the message, kept through a deferred flush, removed at `tokensDone`; the waiting and streaming icons, not rebuilt per token), "Emitting to the chat window" (the init flag off) |
| `dom/webchat/webchat-06-sanitizer` | spec 07 "The sanitizer is a security boundary" and spec 01 "One render path, no router": every payload of `fixtures/webchat/sanitizer-payloads.json` streamed in one token and split in two after 2 KB of padding, so the first flush renders it cut in half; each time the answer region against the allowlist, the whole turn for anything executable, and the HTML "Use this answer" sends; `img` stripped, a fence's markup as text, an `https:` link kept with its `href` alone; spec 01 "Streaming: re-render the whole accumulated raw each time" (the mid-stream render of a partial tag); spec 04 "Thinking output in the webchat UI" (every payload as reasoning: text only; `hide_thinking` off, the block open) |
| `dom/webchat/webchat-07-errors-stop` | spec 04 "Automatic Retry Handling" (`newRetryAttempt` in the pill: the HTTP 503, 429 and network wordings, the waiting icon kept, Stop visible; `requestAborted`: the "Request cancelled." notice and the input usable, the pill and its countdown gone; the `api_retry_after_hint` paragraph), spec 01 "Streaming data flow" (Stop posts `{type: "stop"}` and disables itself; an error mid-stream in a turn of its own, the input usable; Stop mid-stream then `tokensDone`), "Streaming: re-render the whole accumulated raw each time" (the next answer is not a continuation of the interrupted one), "Transcript DOM contract" (the error turn's Close-only bar, removed with no toolbar by the next answer) |
| `dom/webchat/webchat-08-usage` | spec 04 "Rendering in the chat window" (nothing while streaming; the chip at `tokensDone`, last before Close, outside `.message`, marked `data-mzta-usage`; "711 tokens" / "42 output tokens" / the duration as a static label; the button's ARIA; the popover rows in order, a null omitted, a reported 0 printed, the duration and its rate; closing on a second click, Escape with the focus back, a pointerdown outside; one open at a time; the session total, and none on an earlier answer's snapshot; the chip moved, same node, into the compact toolbar), "Emitting to the chat window" (one usage per turn; one arriving with no open turn dropped and not counted), "Context window" (OpenAI: the count alone) |
| `dom/webchat/webchat-09-usage-context` | spec 04 "Context window" (Ollama's `ollama_num_ctx` first, so no request; looked up after the first completed answer and shown by the popover of that answer, built before it), "Rendering in the chat window" (`820 / 1,000 · 82%`, the warn style and the note at 80% or more, none below; the provider's `tokens_per_second`, rounded) |
| `dom/webchat/webchat-10-reply` | spec 01 "The rich-text layer" closing paragraphs (each button closes over its own answer's snapshot; Copy writes plain text, entities decoded, a `<br>` one newline, a paragraph a blank line; Copy does not close the window and says it copied), "Transcript DOM contract" (the full bar and `.sel_info` on the newest answer, the compact toolbar - Copy, Use this answer, the chip - on earlier ones, never both; the toolbar acting on its own answer; Close; the action awaited, then `chatgpt_close`), "Files" (`<split-button>`: the reply-type dropdown, opened by its toggle, closed by Escape with the focus back and by a click outside); spec 05 "UI & Feature Preferences" (`reply_type`: the main button replies with the stored type, named on its second line; the dropdown with the other); spec 04 "Rendering in the chat window" (the chip not in what Copy writes) |
| `dom/webchat/webchat-11-compose` | spec 07 "Scope" (the compose-window case, `mailMessageId` -1: the action forced to a replace, `chatgpt_replaceSelectedText`, never a reply); spec 01 "Files" (no reply type, so a standalone button with no dropdown), "Transcript DOM contract" (`.sel_info`; an earlier answer's toolbar replacing with its own answer) |
| `dom/webchat/webchat-12-summary` | spec 01 "The rich-text layer" closing paragraphs and "Transcript DOM contract" (a summary session, action "0": no "use this answer"; Save as Summary sends `chatgpt_saveSummary` with the answer snapshot and the message's `headerMessageId`, then closes the window); spec 04 "Rendering in the chat window" (Copy, Save as Summary, the chip, Close) |
| `webchat/99-harness-known-issues` | the known-issue shape (level 1) |

## The fake Worker

`expectWorker(file)` (`webchat/fake-worker.mjs`) installs a fake `Worker` constructor on `globalThis`
**before** `openPage()`. The harness never touches that global (jsdom has no `Worker`, and it is not
one of the window globals the harness copies), so `controller.js` finds it as a bare name when it runs
`new Worker(path, {type: 'module'})`. No core change was needed. `openWebchat()` installs it for the
provider of the `llm` it opens (`WORKER_FILES` in `webchat/webchat-page.mjs`).

The fake:

- accepts **exactly one** worker, whose url (resolved against the page) is `js/workers/<file>`, and
  **throws** on any other construction. An unexpected worker therefore makes `controller.js` fail at
  import: `openPage()` rejects and the file fails loudly. Refused constructions are also kept in
  `unexpected`;
- records every message the window posts (`init`, `chatMessage`, `stop`), structured-cloned, in
  `posted`; `chatMessages()` gives the `message` of each `chatMessage`;
- delivers worker messages with `deliver(ctx, ...messages)`: each goes through the window's own
  `worker.onmessage`, whose promise is **awaited**, then the page is settled. The order is the order of
  the calls; nothing sleeps.

Scripting a stream:

```js
const { ctx, worker } = await openWebchat({ llm: 'chatgpt_api', local: { chat_show_usage_data: false } });
await apiSend(ctx, { prompt: 'Q1', action: '0' });          // the background's api_send
await worker.sent(ctx);                                      // messageSent
await worker.thinking(ctx, 'Let me think.');                 // newThinkingToken
await worker.stream(ctx, ['Ciao <b>Ma', 'rio</b>\n']);       // newToken per token, then tokensDone
await worker.stream(ctx, ['more'], { done: false });         // tokens only, the turn left open
await worker.usage(ctx, 'msg_1', { total_tokens: 711 });     // usage
await worker.error(ctx, 'HTTP 500', { retryAfterMs: 90000 }); // error
```

`retry(ctx, payload)` and `aborted(ctx)` send `newRetryAttempt` and `requestAborted`. A background
command to the window is `fromBackground(ctx, message)` (through the mock's `dispatchMessage()`);
`apiSend(ctx, data)` is the `api_send` one, with defaults for the fields a test does not care about.

## Queries through the shadow roots

The window is built from custom elements with **open** shadow roots (`<messages-area>`,
`<message-input>`, `<split-button>`, `<diff-picker>`). A selector cannot cross a shadow boundary, so
`sq(root, ...path)` (`webchat/shadow.mjs`) takes a path of selectors: the first is looked up in `root`,
each next one in the previous match's `shadowRoot`.

```js
sq(ctx.document, 'messages-area', '#messages')             // the transcript
sq(ctx.document, 'message-input', '#messageInputField')    // the input field
sqa(turn, 'split-button', '.dropdown-menu button')         // every match of the last selector
```

Only the public `shadowRoot` property is read, never a component's private fields: the tests assert on
what the user sees or what is sent. `deepElements(root)` walks every element under a root, descending
into open shadow roots and `<template>` contents (the safety checks use it). The views of
`webchat/webchat-page.mjs` (`turns()`, `botTurns()`, `answerEls()`, `answerHtml()`, `actionBar()`,
`field()`, `statusPill()`, …) are built on it. They walk `children` rather than querying with
`:scope >`: jsdom's selector engine does not honour `:scope` in `querySelectorAll()` on these elements.

## The sanitizer payloads

Spec 01 "One render path, no router" and spec 07 "The sanitizer is a security boundary": the answer is
untrusted model HTML on its way into the user's outgoing mail. jsdom runs no script and fires no inline
handler, so "nothing ran" proves nothing: `webchat/safety.mjs` checks the **structure** of what
reached the DOM, and of what the window sends out.

- `allowlistProblems(container)`: every element is one the spec allows (spec 07's inline list, the
  segmentation `BLOCK_TAGS`, `ul`/`ol`, the table family and `hr`), carrying no attribute but an `href`
  on `<a>` that matches `^(https?:|mailto:)`. For the region that holds model HTML, and (through
  `htmlProblems()`) for the HTML sent to the background.
- `executableProblems(root)`: where the window's own chrome lives too (icons, buttons, the components'
  `<style>`), nothing executable: no `<script>` (SVG's included), frame, object, embed, applet, base,
  link, meta, form, SVG animation or `foreignObject`, no `on*` attribute, no `javascript:` / `data:` /
  `vbscript:` URL, no script-bearing inline style.

The payloads (`fixtures/webchat/sanitizer-payloads.json`), each to be streamed as one token and split
across two, and fed to the picker on both sides:

| Payload | Why it is there |
|---|---|
| `script` | the plain `<script>`: `html: true` lets raw HTML through markdown-it, only the allowlist removes it |
| `img-onerror` | an element outside the allowlist with an inline handler; `img` is stripped |
| `handler-on-allowed` | `on*` on **allowed** elements (`p`, `b`, `a`): the element survives, the attribute must not |
| `javascript-href` | `javascript:` in an `href`, plain and obfuscated (mixed case, leading spaces, a tab entity, a decimal entity) |
| `data-vbscript-href` | the other script-capable schemes |
| `iframe` | a javascript: `src` and a `srcdoc` holding a script |
| `object-embed` | the plugin elements |
| `style` | a `<style>` element and a `style` attribute with `url(javascript:)` |
| `svg-script` | SVG's own `<script>`, `onload`, `<a xlink:href>`, an animation setting an href |
| `math-mxss` | MathML namespace confusion: an `<img onerror>` a re-parse could resurrect |
| `noscript-mxss` | `<noscript>` parsing differently with scripting on and off |
| `form` | a javascript: `action`, a `<button formaction>`, an `<input type=image onerror>` |
| `meta-base` | a refresh to a javascript: URL, a `<base href>` rebasing every link |
| `template` | content in a separate fragment a naive walk never visits |
| `details-ontoggle` | an event that fires with no user action |
| `markdown-links` | markdown rather than HTML: a javascript: link, a data: image, a javascript: autolink |
| `code-fence` | markup in a fence must stay text |

The checks themselves are checked: every payload, parsed raw, is reported by them (a payload that opens
with an element the HTML parser moves to `<head>` is preceded by text, so it stays in the body).
Besides the answers, `executableProblems()` is applied to the user bubble (the prompt carries mail
content), the error messages, the startup notice and the thinking block.

## Doing in the area what the harness does not offer

- **The window's own tab** (`webchat-02`, `03`): the custom-text flow asks
  `tabs.query({active: true, currentWindow: true})`, which the harness answers with no tab; the file
  replaces `ctx.ctl.browser.tabs.query` with one answering the window's tab.
- **A background that rejects** (`webchat-04`): `chatgpt_close` is declared in `openWebchat({commands})`
  as a command that throws, as Thunderbird's does when it closes the window waiting for the answer.

## Known issues

`helpers/known-issues/webchat.mjs` holds the known issues of the area, by **spec section × case id**:

```js
KNOWN = { 'spec NN "<section>"': { 'NN-<case>': '<what the window does instead>' } }
```

The case id's `NN` is the number of the `webchat-NN-` file that declares it, so an entry names one test
of one file. A test is declared with `webchatTests(NN).test(slug, section, title, fn)`; a case listed
under its section runs as a TODO while it fails and fails the run once it passes ("stale"). Each file
ends with `coverage()`, which fails on an entry naming a case the file does not declare under that
section. `validateKnown()` refuses a section not of the form `spec NN "<section>"` (a title may itself
hold quotes), a case id that is a pattern or names no existing file, a case listed under two sections,
and an empty reason; `webchat/99-harness-known-issues` runs it.

**Today there is one**, found by group C:

- spec 01 "The rich-text layer" (`10-copy-plain`): Copy turns each `<br>` into a real newline, but the
  answer is markdown-it output, which writes `<br>
`, and `htmlToPlainText()`
  (`api_webchat/messagesArea.js`) keeps the source newline after the `<br>` as well: every line break
  of the answer is copied as a blank line, indistinguishable from a paragraph break.
  `stripHtmlKeepLines()` consumes that newline for the same reason (spec 01 "Writing into a plain text
  compose window").

Group B found none: the sanitizer held against every payload, whole and cut mid-tag. What group A
found was fixed in the window, and the specs state the behaviour:
the startup notice escapes every value, a thinking-only answer shows its thinking block, the prompt
name is decoded once (a `%` no longer breaks the window, and the Custom Prompts editor refuses it),
the input stays usable after an error, and the header shows the model and the API only.

## What is not covered

- **Layout and the CSS cascade**: scroll positions, the prompt anchor and `#anchorSpacer`, the
  `#jumpToLatest` button, heights, the textarea's auto-resize, the theming tokens. jsdom has no layout
  engine (every box is 0×0), so visibility is checked only as the DOM expresses it (inline `display`,
  `hidden`, classes, `disabled`).
- **The `ResizeObserver` callbacks**: the harness's stub records observers and never calls them back.
- **The fade of the "done" pill** (3.5 s, then 0.5 s): timers longer than 1 s are not waited for by
  `settle()`.
- **The real model workers**: the api area's business.
- **A text selection inside the answer** ("Every one of those buttons honours a text selection"): the
  answers live in `<messages-area>`'s shadow root, and jsdom refuses to add to the document's
  selection a range whose nodes are inside a shadow tree (Gecko accepts it, spec 07 "Selection inside
  the shadow root"). So "use this answer", Copy and Save as Summary are tested on the whole answer
  only, and the usage chip's scrubbing out of a selection (`_cloneSelectionWithoutUsage()`) is not
  reached.
- **Copy's fallback** (a hidden textarea and `document.execCommand('copy')` when the clipboard API
  rejects), and the button's label going back to "Copy" after 1.5 s (a timer `settle()` does not wait
  for).
- **The retry countdown ticking down** (a real 250 ms interval): the tests check the text it starts
  with, and that `requestAborted` stops it; the pill returning to "waiting" at zero is not waited for.
- **The context window from a provider's API** (Ollama's `/api/ps` and `/api/show`, Gemini's
  `inputTokenLimit`, Claude's `max_input_tokens`): the area uses the configured `ollama_num_ctx`, which
  needs no request; the lookups are `contextWindow.js` calling the provider clients.
- **How the document title reads**: not a spec rule.

## Under-specified

What the window does that no spec states, listed instead of tested:

- **`api_send_custom_text` with a string** instead of an array (the legacy form): the controller
  handles it, spec 03 does not describe it.
- **A token `additional_text` with no answer at all**, following the `||` default chain: the window
  always receives an array built from the prompt, so the normal flow never produces one.
- **An unknown `llm` in the URL**: no worker is created and the controller fails at start-up; the spec
  does not say what should happen.
- **The model chip's exact wording** ("prompt name | model"): the spec says only that the header shows
  the model and the API.
- **The fields of the action commands beyond the text**: the `tabId` and `mailMessageId` of
  `chatgpt_replyMessage` / `chatgpt_replaceSelectedText`, and the `tabId` of `chatgpt_saveSummary`
  (`summaryTabId`, else the prompt's tab). The spec names the commands and says they act on the
  answer snapshot; what identifies the target is not stated.
- **The quotes stripped from the snapshot**: the window removes a `"` opening or closing the answer
  (also `<p>&quot;` … `&quot;</p>`) before the buttons close over it.
- **What the compact toolbar of a summary session holds**: Copy only (no Save as Summary); the spec
  describes the toolbar as the bar's icons, without listing them per session kind.
- **Line breaks of the first prompt**: `sendPrompt()` turns every `\n` into `<br>` before posting it to
  the worker, while a typed message keeps its `\n` (and shows on one line in its bubble). Under review;
  `webchat-01` asserts only the words of the prompt.
