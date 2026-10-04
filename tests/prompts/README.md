# Tests: prompts and placeholders

Level-1 tests of the prompt system and the placeholder system: how the prompts are stored, merged,
normalised and migrated, and what text actually reaches the model. The contract is the spec, as
everywhere in the suite:

- **prompts**: [`claude-spec/02-prompts.md`](../../claude-spec/02-prompts.md);
- **placeholders**: [`claude-spec/03-placeholders.md`](../../claude-spec/03-placeholders.md).

The modules under test are `js/mzta-prompts.js`, `js/mzta-placeholders.js` and
`js/mzta-utils-prompt.js` (`taPromptUtils`), plus the few pure helpers of `js/mzta-utils.js` and
`js/mzta-editor-highlight.js` the spec ties to them. Each test file names the spec sections it
covers in its opening comment. How to run the suite, the two levels, the mock and the known-issue
mechanism are in the general [`tests/README.md`](../README.md). Paths below are relative to `tests/`.

Everything here runs with **no managed policy**. Organization prompts, enforced special-prompt
texts, restrictions, provider overrides and per-feature connections are spec 08a/08b, covered by
the managed area ([`managed/README.md`](../managed/README.md)). Where a function has a managed
branch, only its unmanaged branch is tested here.

## Running

```sh
node --test "tests/prompts/*.test.mjs"     # this area only, from the repository root
```

Level 1 only: nothing to install, no jsdom. The area imports only `helpers/core/` and its own
`helpers/known-issues/prompts.mjs`, and has **no plugin**.

## Layout

```
tests/
├── helpers/known-issues/prompts.mjs   the known issues, their shape (validateKnown()), and
│                                      caseTests(), the one way a test of the area is declared
├── fixtures/prompts/prepare-prompt/   the golden cases of preparePrompt(), one JSON per case
└── prompts/
    ├── 01-find-placeholder.test.mjs       spec 03 "Invalid placeholder feedback", "Dynamic Placeholders"
    ├── 02-replace-placeholders.test.mjs   spec 03 "Placeholder Resolution Order" (4-5), "Adding a New
    │                                      Built-in Placeholder", "mail_text_body vs mail_plain_text_part"
    ├── 03-custom-placeholders.test.mjs    spec 03 "Custom Placeholders", "Built-in Placeholders",
    │                                      "Placeholder Resolution Order" (2); spec 05 the id prefix
    ├── 04-placeholder-values.test.mjs     spec 03 "Placeholder Resolution Order" (3), the two newline
    │                                      contracts, "Selection twins", "mail_text_body vs
    │                                      mail_plain_text_part", "The address placeholders..."
    ├── 05-attachments-headers.test.mjs    spec 03 "Built-in Placeholders", "Dynamic Placeholders"
    ├── 10-prompt-flags.test.mjs           spec 02 "The five boolean flags are normalized on read",
    │                                      normalizePromptFields(), normalizeEnabledToShowIn()
    ├── 11-prompt-views.test.mjs           spec 02 the three getters, "Reachability", "User Properties",
    │                                      "Special Prompts", "Special Prompt Visibility Dependencies"
    ├── 12-prompt-storage.test.mjs         spec 02 the storage writers, saveSpecialPromptTexts()
    ├── 13a-migration-menu-order.test.mjs  spec 02 "Alphabetic-to-Position Migration" (it runs)
    ├── 13b-migration-menu-order-done.test.mjs   ... (it has run: nothing written)
    ├── 14-migration-enabled.test.mjs      spec 02 "Enabled-to-show_in Migration"
    ├── 15-export-import.test.mjs          spec 02 "Per-Prompt API Override Properties", export / import
    ├── 20-prepare-prompt-golden.test.mjs  spec 02 + 03: preparePrompt(), from the golden fixtures
    ├── 21-finalize-prompts.test.mjs       spec 02 "Add tags: extra prompt statements", "Calendar event /
    │                                      task: reminder (#887)"; spec 03 the calendar address strip
    ├── 22-response-tags.test.mjs          spec 02 "The text carries the response format": getTagsFromResponse()
    ├── 23-translation-summary.test.mjs    spec 02 "Translate", "Summarize" (getSummaryLang()),
    │                                      "Missing special prompts"; spec 03 "Who supplies the values"
    └── 99-harness-known-issues.test.mjs   the known-issue shape
```

## Contexts and the mock

One test file is one extension context, as everywhere in the suite. Most files start a
**background** context with `startBackground({policy: null, local})`; the managed plugin, when the
branch has it, runs `loadManaged()` there, which with no policy only proves the unmanaged path. A
test that changes a preference or a store mid-file does what a user does (a setting changed, a page
saved): it never resets a module to fake a second context.

Three placeholder sources need APIs the core mock does not model: `messages.listAttachments`
(`{%mail_attachments_info%}`), `messages.getFull` (`{%mail_headers:…%}`, `{%mail_full_headers%}`)
and `messages.listInlineTextParts` (the translation body). They are **not** added by a plugin. A
plugin is loaded into every context the suite starts, the managed area's strict DOM pages included,
where an API the proxy did not know about would quietly change what those tests detect. Instead the
three files that need them (`05`, `20`, `23`) start a **page** context with
`startPage({decorate})`, the core entry point that takes a caller's decoration, and add the API for
that file alone. A page is also where the popup and the menus run these placeholders.

`js/lib/mzta-html-lines.js` is a classic script that the background page loads before its module
entry point (`mzta-background.html`). `normalizePlainTextPart()` and `getMailInlineTextParts()` read
its globals. The files that need it (`04`, `20`, `23`) run it with `vm.runInThisContext()`, as the
DOM harness does for a page's classic scripts. Nothing else of it is used: its HTML projection needs
a DOM.

## The golden fixtures

`20-prepare-prompt-golden` runs `taPromptUtils.preparePrompt()` on every file of
`fixtures/prompts/prepare-prompt/` and compares the result with the fixture's expected output.

```jsonc
{
  "description": "what the case shows",
  "spec": ["spec 03 \"…\": the sentence the expected value follows from"],
  "storage": { "placeholders_use_default_value": true },   // optional, on top of the BASE the runner sets
  "prompt_from": "prompt_rewrite_formal",                  // optional: a built-in prompt, its shipped text
  "args": { "curr_prompt": {…}, "body_text": "…", "selection_text": "…", "msg_text": {…}, … },
  "expected": "the exact output",                          // or:
  "expect": { "startsWith": "…", "endsWith": "…", "includes": […], "excludes": […],
              "occurrences": { "text": 1 }, "promptTextIncludes": "{%…%}" },
  "underSpecified": "what the spec leaves open, so is not asserted"
}
```

**Every expected value is written by hand, from the spec sections the fixture names.** None was
produced by running the code and saving the output. A saved output pins today's behaviour, bugs
included, and the test then proves nothing. Where the spec determines the whole output (a
placeholder replaced by its value, the language joined "with a single space", a custom placeholder
expanded before the built-ins) the fixture has `expected`. Where it determines only part of it
(the signature: it is there, once, but in which words?) the fixture has
`expect` with just that part, and says in `underSpecified` what it leaves out. The same rule holds
for every other file. Expected strings that contain a shipped message (the add-tags statements, the
reminder format) are assembled from that message in the en locale, as the spec describes, never read
back from the function.

Each case starts from the same `BASE` storage (default values off, no signature, no language, no
custom placeholder), so a case never depends on the one before it. To add a case, add a file. The
runner picks it up, and the first test checks its shape.

## Known issues: TODO tests

The general rule is in [`tests/README.md`](../README.md#known-issues-todo-tests). Every test of the
area is declared with `caseTests(file).test(caseId, name, fn)`, so it has a **case id**, unique in
its file. A known issue names exactly one test, as "a file × a case id":

```js
KNOWN = { '<file stem>': { '<case id>': REASONS.<name> } }
```

`validateKnown()` (run by `99-harness-known-issues`) refuses a file that is not in `tests/prompts/`,
a case id that is not a plain slug (`*` or a pattern would hide a whole file), a reason that names no
spec section (`spec 02 "<section>"` / `spec 03 "<section>"`), and a reason that is not one of
`REASONS`. An unused reason fails too. Each file ends with `k.coverage()`: an entry naming a case id
the file does not declare fails it, so an entry cannot outlive a renamed or removed test.

Today: none. The eight known issues of the first run were all resolved: the code fixed, or the spec
aligned with a behaviour the maintainer ruled correct.

## What is not covered

- **The managed branches** (constraint of the area): organization prompts and shadowing, the
  `_disable_*` restrictions, enforced texts, the locked-off and policy-supplied provider overrides,
  the transient policy flags at the storage gates and on export, the policy-supplied API key
  marker. Spec 08a/08b, in `tests/managed/`. So is `checkSpecialPromptText()`: its contract table is
  spec 08a's, tested row by row in `managed/06c`, as is `idnum` at the storage gates (`managed/11`).
- **The Menu System** (spec 02 "Menu System"): menu construction in `js/mzta-menus.js` and the
  `menus` API, and the icon resolution (`getBuiltInPromptIcon()` / `getContextMenuIcon()`).
- **The Menu Order page** and the **Placeholder Autocomplete** and **highlight mirror** UI: DOM. The
  level-1 half of "Invalid placeholder feedback" (the two tiers, the highlight matrix) is in `01`.
- **The extraction side of the newline contracts**: `getMailBody()`, `selectionTwin()`, the compose
  DOM walk (`js/mzta-compose-script.js`), `htmlBodyToPlainText()` and `mztaHtmlToLines()` all need a
  DOM. Level 1 sees only that the value the caller extracted reaches the prompt unchanged (`04`, `20`).
- **`buildSummaryPrompt()`**: it always converts the HTML body to text, which needs `DOMParser`.
  `getSummaryLang()`, the part that decides the language statements, is in `23`.
- **The response side** of the special features (`normalizeReminderMinutes()`,
  `appendMessageLinkToDescription()`, the spam report), and `savePrompt()` / `clearPromptAPI()`
  beyond their use in `12`.

## Under-specified

Spec sections too vague to test, or that disagree with each other. They were not asserted, and
they are input for improving spec 02/03:

1. *(resolved: spec 02 "How the final prompt is built" now fixes the no-placeholder shape - text,
   "content", signature, language, one space - and that the selection wins over the body.)*
2. *(resolved: spec 02 "How the final prompt is built" now gives the exact signature and language statements, the trimming, and the same-language rule of the rewrite and proofread prompts.)*
3. *(resolved: `false` is "off" in `normalizePromptFlags()` and `normalizeEnabledToShowIn()`, never out of domain, so a built-in "1" fallback cannot turn it on.)*
4. *(resolved: spec 02 "Missing special prompts" now documents that `getSpecialPrompts()` restores a removed entry and writes the store back once; `11` tests it.)*
5. *(resolved: spec 02 now places both migration flags in `browser.storage.local`, the `PREFS_AREA`, as spec 05 does.)*
6. *(resolved: spec 02 "Alphabetic-to-Position Migration" now says every prompt but the two hidden special prompts gets a position, user-hidden prompts and inactive features included; `13a` tests it.)*
7. *(resolved: spec 02 now lists the ten keys of `_default_prompts_properties`.)*
8. *(resolved: spec 03 "Custom Placeholders" now says a disabled custom placeholder is treated as nonexistent and is not expanded; `03` and fixture 29 test it.)*
9. *(resolved: spec 03 "Custom Placeholders" now documents the `thunderai_custom_` prefix: stored on the id, shown without it, added once by `setCustomPlaceholders()`.)*
10. *(resolved: spec 03 "Value formats" now gives the attachments, headers, tags and date formats and the `<` / `>` escaping; `04` and `05` test them exactly.)*
11. *(resolved: spec 03 "Dynamic Placeholders" now gives the token syntax, spaces around the colon included (`normalizeTokenKey()` everywhere), and the whole `additional_text` flow, an empty answer becoming empty.)*
12. *(resolved: `{%empty%}` always resolves to nothing, and `buildTranslationPrompt()` always uses the default values, so an empty exclusion list or subject is sent empty.)*
13. *(resolved: spec 02 documents that `preparePrompt()` rewrites `curr_prompt.text`; organization prompts are copied per read (`managed/06a`); the menus expand the custom placeholders first and are rebuilt on any write of `_custom_placeholder`; the translation prompt expands them too (`23`).)*
14. *(resolved: spec 02 "Reading the answer" now specifies `getTagsFromResponse()`: JSON and plain-list forms, a malformed object giving no tag, the cleaning, the allow-list ignoring case and returning its own spelling; `22` tests it.)*
15. *(resolved: spec 02 documents `getSpecialPromptPrefix()` of the summarize fragments (`null`) and the positions of a built-in prompt with nothing stored; `10`, `11` and `12` test them.)*
