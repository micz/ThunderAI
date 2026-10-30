# Tests: ChatGPT Web (chatgptweb)

The ChatGPT Web integration where it can be tested without ChatGPT: the page loader
(`js/mzta-chatgpt-loader.js`), the pre-script the background injects in front of the content script
(built in `handleChatGptWeb()`, `mzta-background.js`), the model verification of the content script
(`checkGPTModel()` in `js/mzta-chatgpt.js`), and the `chatgpt_web_model_extended_check` option on the
settings pages. The contract is spec 04 "ChatGPT Web" (the loader declaration, "Readiness does not
wait for the document") and its subsection "Model verification (`checkGPTModel()`)", and spec 05
"UI & Feature Preferences" and "Connection Settings Panel — Advanced Options Disclosure" for the
option. Every test names its section in its title (`[NN-case] spec NN "<section>": ...` for the DOM
files).

How to run the suite, the two levels, the DOM harness and the known-issue mechanism are in the general
[`tests/README.md`](../README.md). Paths below are relative to `tests/`.

## Running

```sh
node --test "tests/chatgptweb/*.test.mjs"                                  # level 1: nothing to install
node --test "tests/dom/chatgpt/*.dom.mjs" "tests/dom/*/chatgptweb-*.dom.mjs"   # DOM (npm ci)
```

from the repository root. Level 1 takes under a second. Each DOM file is one jsdom process: the five
ChatGPT page files take about 4-6 s each (one page per scenario, on a controlled clock: no test waits
for real time, the 15 s deadlines included), the three option files 1-2 s each.

## Layout

```
tests/
├── helpers/plugins/chatgptweb.mjs        the plugin: js/mzta-chatgpt.js's mzta_script as ctx.chatgptWebScript
├── helpers/known-issues/chatgptweb.mjs   the known issues, their shape (validateKnown()), chatgptwebTests()
├── fixtures/chatgptweb/                  model-picker.html, old-ui-model-picker.html (see below)
├── chatgptweb/
│   ├── README.md                         this file
│   ├── fake-clock.mjs                    createClock(), flush(): the scripts' timers, Date and performance
│   ├── pre-script.mjs                    preScriptSource(), buildPreScript(): the real pre-script, cut out
│   ├── chatgpt-page.mjs                  openChatGPTHost(), startScenario(), scenario(): the ChatGPT page (DOM)
│   ├── 01-loader.test.mjs                level 1: the loader
│   ├── 02-pre-script.test.mjs            level 1: the preference and what the pre-script injects
│   ├── 99-harness-clock.test.mjs         level 1: the clock and the cut
│   └── 99-harness-known-issues.test.mjs  level 1: the known-issue shape
└── dom/
    ├── chatgpt/chatgptweb-0N-*.dom.mjs   the ChatGPT page: the model verification
    ├── options/chatgptweb-2N-*.dom.mjs   the option on the options page
    └── setup-wizard/chatgptweb-22-*.dom.mjs   the option in the setup wizard
```

The DOM files live in several page folders, so a file's number `NN` is unique across the whole area
(`99-harness-known-issues` checks it): `0N` for the ChatGPT page, `2N` for the settings pages.

The area imports only the core (`helpers/core/`) and its own files, never another area's helpers.
Its level-1 files import nothing that reaches jsdom (`chatgpt-page.mjs` is the only file that does,
through the core `dom-harness.mjs`).

## Coverage

| File | Spec section(s) |
|---|---|
| `chatgptweb/01-loader` | spec 04 "ChatGPT Web": "Loader declaration" (one manifest content script, `document_start`, top frame of `https://*.chatgpt.com/*`, no longer registered by the background; `diff.js` keeps all frames) and "Readiness does not wait for the document" (`chatgpt_web_ready_<call_id>` once, on the first of a visible composer, `load` or a complete document at start, the timeout 15 s after navigation start; a hidden composer does not count; the 250 ms poll; the `call_id` read at start; the message's fields; nothing left running) |
| `chatgptweb/02-pre-script` | spec 05 "UI & Feature Preferences" (the preference, false, next to `chatgpt_web_tempchat`); spec 04 "Model verification" (`mztaGPTExtendedCheck` "1" / "0" next to `mztaGPTModel`, with an empty model too; a legacy ID as its display name; a Custom GPT injects no model) |
| `dom/chatgpt/chatgptweb-01-option-off` | spec 04 "Model verification", option off: the newer UI proceeds at once, unverified, no menu (gpt-6, gpt-6-thinking, a wrong effort and model, an unknown model), the effort logged; the option set to false; the older UI: a match at once, another model's warning and button at 2 s and not before, no send after it, the button resuming once; a free account; the trigger rendering late within 2 s, and after them; an empty model, a Custom GPT |
| `dom/chatgpt/chatgptweb-02-option-on` | spec 04 "Model verification", option on: both IDs verified and sent once through the page's own send function, the menu it opened closed; the name trimmed and lower-cased; a replaced trigger read afresh, a second `chatgpt_send` ignored; a match just before 15 s; the late trigger starting the extended verification, its deadline 15 s from then; an unknown model on the newer UI: the legacy check, 2 s, no menu; the older UI; a free account; the retry after a missing composer checking again with the option |
| `dom/chatgpt/chatgptweb-03-extended-rejections` | spec 04 "Model verification", option on: GPT-6.1, GPT-6 Pro, GPT-5.6 Sol; the efforts medium / high / unknown (no menu opened); gpt-6-thinking with Instant; an unselected row with "GPT-6 Instant" written in the page; a menu the trigger does not own; a hidden row; checked but not selected; an unexpected hidden track; a row aria-hidden; two selected rows - each refused at 15 s, not at 2 s; the menu it opened closed; no trigger but other Radix elements: not a free account, the legacy 2 s |
| `dom/chatgpt/chatgptweb-04-timeout-cancel` | spec 04 "Model verification", extended and legacy paths: the check's observer, poll and deadline held while it runs and gone at the deadline; no send when the page matches after the timeout; repeated clicks and a second `chatgpt_send`: one send, the warning hidden; `pagehide` during the check and after the timeout; an approval not reused by the retry's check; the retry's timeout showing the warning and the button |
| `dom/chatgpt/chatgptweb-05-menus` | spec 04 "Model verification", option on: a menu the user opened, simple or advanced, keeps its view and focus on success and on timeout (both IDs); the menu the check opened closed, the focus given back, the view never expanded; a focus the user moved kept; the manual button leaving a menu the user reopened; the model menu's stacking (1001 for the menu and its portal, 50 kept for another menu, the bar at 1000) |
| `dom/options/chatgptweb-20-extended-check-option` | spec 04 "ChatGPT Web" (the unprefixed id, the row right after the model row, advanced, ChatGPT Web only), spec 05 "Connection Settings Panel — Advanced Options Disclosure" (the `.mzta_switch` in its flex wrapper), "UI & Feature Preferences" (the en title and help, which names both models; unchecked by default; never disabled, the model empty or not; saved true then false) |
| `dom/options/chatgptweb-21-extended-check-stored` | spec 05 "UI & Feature Preferences": stored true shown checked, saved false |
| `dom/setup-wizard/chatgptweb-22-extended-check-option` | spec 04 "ChatGPT Web" (injected once in the wizard, right after the model row), spec 05 "UI & Feature Preferences" (restored, saved) |
| `chatgptweb/99-harness-*` | the clock, the pre-script cut, the known-issue shape (level 1) |

## How the ChatGPT page runs

The content script is not a page of the add-on: the background runs `pre_script + mzta_script` in
the ChatGPT tab with `tabs.executeScript()`. `chatgpt-page.mjs` does the same in jsdom:

- `openChatGPTHost()` opens one document through the core `openDocument()` (the mock behind the strict
  proxy, the console capture, `assertHarnessClean()`), at `https://chatgpt.com/`.
- `startScenario(ctx, opts)` adds an **iframe** to it and fills it with a fixture: each scenario gets
  a fresh page and a fresh instance of the script, as each ChatGPT window does. Its top-level `let`s,
  its listeners and its observers belong to that iframe; `dispose()` removes it.
- The code run is the **real pre-script** (`pre-script.mjs`: the expression assigned to `pre_script`
  in `mzta-background.js`, located with the core tokenizer and evaluated with the names it reads; one
  it reads and the helper does not give fails with a `ReferenceError`), built from `prefs_default`
  plus the scenario's preferences, followed by the **real `mzta_script`** (from the plugin). `_gpt_model`
  is computed with the real `sanitizeChatGPTModelData()` and `getGPTWebModelString()`.
- It is evaluated with the iframe's DOM as its bare names (`window`, `document`, `MutationObserver`,
  `KeyboardEvent`, `getComputedStyle`...), the scenario's clock as its timers, `Date` and
  `performance`, and the mock as `browser`, except `runtime.onMessage`, which is the scenario's own:
  `h.send()` delivers the background's `chatgpt_send` to that one page.
- Nothing of the script is replaced or stubbed. The prompt goes through `run()`, `doProceed()`, the
  model check, `chatgpt_sendMsg()` and the page's own send button; the completion wait then runs as it
  does on ChatGPT, until the scenario is disposed. The iframe's url is `about:blank`, so
  `location.pathname` never changes there.

### The clock

`fake-clock.mjs` gives each run its own `setTimeout` / `setInterval` / `clear*`, `Date` and
`performance.now()`: no real time passes, `advance(ms)` runs every callback that falls due in time
order, each followed by a flush of the promise jobs and mutation callbacks it queued. The 2 s and
15 s deadlines are asserted to the millisecond (shown at 2000, not at 1999). An exception thrown by a
callback is recorded and fails the scenario (`scenario()`). The loader runs on it too, started at 5 ms
after navigation start.

### What the harness models, because jsdom does not

- **Layout.** jsdom has none: `getBoundingClientRect()` is all zeros, and the script's
  `isElementVisible()` would find nothing visible. The helper gives every rendered element of the
  iframe a non-zero box (and `getClientRects()` one rect), and an empty one to an element that is
  disconnected, `hidden`, or `display: none` (itself or an ancestor, as computed). Shipped code is
  untouched: the prototypes of the iframe's own window are patched.
- **The Radix model picker** (`wirePicker()`, ported from the PR's browser harness): keydown Enter on
  the trigger opens a copy of the fixture's menu `<template>`, labelled by the trigger, appended to
  the body and focused; Escape in the menu closes it; the simple view's toggle enters the advanced
  view, one way, as observed on the live page; a click on a model row is counted, and
  `assertVerifierClean()` fails on any (the check must never change the selection).
- **The send.** A click on the fixture's send button counts a send (`events.sends`, with the text) and
  empties the composer, as ChatGPT does, which is what the script's send verification reads.

### Whether the check cleaned up

`h.verifierResources()` counts what the model check holds while it runs: its MutationObserver (the
only observer of the script that watches character data), its 200 ms poll (an interval named `check`)
and its deadline (`onTimeout`), told from the script's other timers by the callbacks' names. So the
probe cannot pass by finding nothing, `chatgptweb-04` first asserts it sees `{observers: 1, timers: 2}`
one millisecond before each deadline, then `{0, 0}` at it.

## The plugin

`helpers/plugins/chatgptweb.mjs` only adds the area's module: `js/mzta-chatgpt.js` exports the
content script as a string and has no side effect, so it is loaded in every context and handed to the
ctx as `chatgptWebScript`. The area needs no page, no page-side API and no background answer: the
content script sends nothing to the background in these scenarios, and the option pages are the core
ones.

## The fixtures and their sources

In `tests/fixtures/chatgptweb/`:

| Fixture | Source |
|---|---|
| `model-picker.html` | the attributes and hierarchy observed on the live ChatGPT page on 2026-10-16 (PR #965): the composer, the reasoning trigger (`data-composer-navigation-target="reasoning"`, `data-selected-reasoning-effort`), the send button, and the open menu as a `<template>` in its simple view, the selected GPT-6 row in the inactive model track. Dynamic classes and ids, account data and conversation content left out. The free-account page is this one without the trigger |
| `old-ui-model-picker.html` | hand-written, not captured: a Radix model switcher holding the display name in a `<span>` (`5 Thinking`), no trigger - only what the legacy check reads |

## Known issues

In `helpers/known-issues/chatgptweb.mjs`, run as TODOs while they fail: none today.

## What is not covered

- **The live page.** Everything runs on the fixtures: a change of ChatGPT's markup is not seen here.
  The manual checks in Thunderbird are listed in spec 04 "Model verification".
- **Real layout**: hit testing (`elementFromPoint()`), that the model menu is clickable above the bar
  and that the bar's Close button is clickable (the PR's browser harness checked both with a real
  layout); here only the computed `z-index` of the stacking rule.
- **The real Radix menu** (pointer opening, focus return on close, transitions): modelled as above.
- **The name comparison for an ID the extended check does not know** (e.g. a terminal `-thinking`
  that is not terminal, `x-thinking-preview`): only `gpt-6` and `gpt-6-thinking` reach the extended
  verification, so the comparator is tested through those two (suffix, case, spaces, longer names).
- **The rest of the content script**: the composer lookup and its diagnostics, the send button
  strategies, the completion detection, the answer's actions (reply, replace, diff, close), the
  custom text, the overlap fix. They run in these scenarios, but only the parts the model check needs
  are asserted.
- **The PR's live DevTools script** (a snippet to run the content script by hand in a signed-in
  ChatGPT session): a manual tool, not a test; dropped with the browser harness.
