# Tests: the pages with no policy (ui)

DOM tests of what each settings page does **with no policy installed**, as the specs describe it: what
it shows at load given the stored preferences, how it reacts to the user, and what it writes to
storage. The contract is the page sections of [`claude-spec/05-options.md`](../../claude-spec/05-options.md)
and the page behaviour described in specs 01, 02 and 03; each DOM file names the sections it covers in
its opening comment, and **every test names its section in its title**
(`[NN-case] spec 05 "<section>": ...`).

Everything a policy changes on these pages (locks, banners, enforced connections, restrictions) is
spec 08c, covered by the managed area ([`managed/README.md`](../managed/README.md)), and is not
repeated here. Before writing the tests of a page, read its managed files in `tests/dom/<page>/`
(`NN-*.dom.mjs`): what they assert is not re-tested here.

How to run the suite, the two levels, the DOM harness, `settle()` and the known-issue mechanism are in
the general [`tests/README.md`](../README.md). Paths below are relative to `tests/`.

## Running

The DOM files are spread across `tests/dom/<page>/`, so the area alone is:

```sh
node --test --test-timeout=120000 "tests/ui/*.test.mjs" "tests/dom/*/ui-*.dom.mjs"
```

from the repository root, after `npm ci` (jsdom). The area's `tests/ui/*.test.mjs` files are level 1
and need nothing installed; `node --test "tests/**/*.test.mjs"` runs them with the rest of level 1.

The area adds about **5-10 s per DOM file** to the DOM run (each file opens its page once, in its own
process; `node --test` runs files in parallel, so the wall-clock cost on the whole suite is lower).

## Layout

```
tests/
├── helpers/known-issues/ui.mjs   the known issues, their shape (validateKnown()), and uiTests()
├── fixtures/ui/                  the area's fixtures, read with loadFixture(name, 'ui')
├── ui/
│   ├── README.md                 this file
│   ├── dom-helpers.mjs           scriptFetch(), json(), until(), shown(), userSets(), writtenSince()
│   ├── feature-page.mjs          the six feature pages' shared scenarios (connection panel, editor, guard)
│   ├── calendar-task.mjs         the Calendar Event / Task pages' timezone and reminder tests
│   ├── 01-window-position.test.mjs        level 1: a page rule that lives in a shared module
│   └── 99-harness-known-issues.test.mjs   level 1: the known-issue shape
└── dom/<page>/ui-NN-<scenario>.dom.mjs     the tests, one file per initial state of a page
```

The area **imports only the core** (`helpers/core/`): `openPage()` and `assertHarnessClean()` from
`helpers/core/dom-harness.mjs`, `loadFixture()` from `helpers/core/load.mjs`, `knownTest()` through
`helpers/known-issues/ui.mjs`. It never imports the managed layer (`helpers/*.mjs`), so it keeps working
on a branch without the managed area. It has **no plugin**: a plugin is loaded into every context,
the managed pages included, and modelling an API there would change what the strict Proxy reports on
them. Everything the area needs beyond the core is done inside its own files (below).

One file is **one initial state** (stored preferences, query string): the tests that share it run in
order on one opened page, and a later test may build on what an earlier one did (each file says so).
A new file only for a genuinely different initial state.

## Coverage

| File | Page | Spec section(s) |
|---|---|---|
| `dom/options/ui-01-no-connection` | options | spec 05 "Global Integration Settings" (no connection selected: placeholder, banner, nothing persisted, picking a provider), "Special Prompt Integration Overrides" (the panel pill, the "Using \<provider\>" pill), "UI & Feature Preferences" (defaults shown; text / select / number / switch written with their type; the usage-data row), "Feature Flags", "Feature Rows — Disabled vs. API-Needed" (nothing selected: unchecked, greyed, cleared; own integration; ChatGPT Web hint; Sparks missing), "Feature 'Manage settings' Links — Hidden vs. Disabled" (including a denied permission), "Connection Settings Panel — Advanced Options Disclosure", "… — Connection Test Status Strip" (visibility per provider), "… — Provider Setup Note (`#miczDescription`)" (per-provider text, tint, the sparse guide link), "Options Page Bottom Block (`#mzta_bottom`)", "Options Page Advanced Section (`#mzta_adv_panel`)" (collapsed, nothing persisted; `max_prompt_length` row per connection; the Reset buttons; the cache size and its clearing, confirmed and cancelled), "Owl for Exchange Warning (`#owl_warning`)" (no Owl account) |
| `dom/options/ui-02-api-configured` | options | spec 05 "Global Integration Settings", "UI & Feature Preferences" (stored values shown; a window position of 0 shown as 0, one that is not a number shown empty), "Special Prompt Integration Overrides" (pill at load and from `storage.onChanged`), "Feature 'Manage settings' Links", "… — Advanced Options Disclosure" (JSON validation on restore, advisory only), "… — Connection Test Status Strip" (ok / auth / network / permission denied, unsaved values, idle reset from both tables, Ollama's `/api/version` and the capability re-read), "… — 'Update list' Model Fetch Buttons" (success merge, HTTP error, no retry, denied permission, network error, Ollama with no models; a missing credential disables, never clears: nothing written at load with a stored model and an empty host, a key emptied and typed back keeps the model) |
| `dom/options/ui-03-chatgpt-web` | options | spec 05 "Feature Rows — Disabled vs. API-Needed" (ChatGPT Web keeps the flags; Calendar / Task rows with Sparks missing, present, too old; rows recomputed from `storage.onChanged`), "Feature 'Manage settings' Links", "Global Integration Settings" (`max_prompt_length`), "UI & Feature Preferences" (usage-data row for a web-only setup, the OpenAI Comp note), "Special Prompt Integration Overrides", "Owl for Exchange Warning (`#owl_warning`)" (an Owl account) |
| `dom/options/ui-04-provider-fields` | options | spec 05 "Global Integration Settings": every `{provider}_{key}` of `integration_options_config` (fixture `ui/provider-fields.json`) shown at load, not changed by opening the page, and stored under its key with its default's type on change |
| `dom/<feature>/ui-01-settings` (`translate`, `summarize`, `spamfilter`, `addtags`, `get-calendar-event`, `get-task`) | the six feature pages | an API global connection, no override, the page's own settings stored. Through `ui/feature-page.mjs`, on every page: spec 05 "Special Prompt Integration Overrides" (switch off at load, nothing stored; on: the global API inherited and the pair + `api_type` persisted; the pill and tint; only the provider's rows; a provider change; off: `api_type`, its options and the connection preference cleared together), "Mandatory Specific Integration" (no ChatGPT Web, no placeholder in the per-feature select), "The Prompt Is Authoritative For API Parameters" (a field goes into the prompt), "… — Advanced Options Disclosure" / "… — Connection Test Status Strip" (built at runtime, collapsed, reset on a provider change; the test reads the prefixed fields and saves nothing), "Unsaved-Changes Guard" (each editor's Save / Reset, `beforeunload` while a Save is enabled). Plus each page's own sections, below |
| `dom/<feature>/ui-02-own-integration` (same six) | the six feature pages | the prompt carries its own Claude connection, the `{prefix}_*` preferences are stale, the global connection is unusable (`''` on translate / spamfilter / calendar, `chatgpt_web` on summarize / addtags / task): spec 05 "Mandatory Specific Integration" (forced on, enabled, badge, the reason for each of the two cases, a click ignored, picking a provider persists), "The Prompt Is Authoritative For API Parameters" (the panel shows the prompt, and the prompt is mirrored into the preferences, type and flag together) |
| `dom/translate/ui-01-settings` | translate | spec 05 "Translate Settings Page" (stored settings shown, written with their type), "Mandatory Specific Integration" (`translate_auto` never stored as `null`) |
| `dom/summarize/ui-01-settings` | summarize | spec 05 "Summarize Settings Page" (settings; an automatic mode forces inline; the forced language field and its preview, with the fallback to the default language and the refresh from `storage.onChanged`; the sender card: its own Save, the toggle, mode 3, the notice; the three editors), "Mandatory Specific Integration" (`summarize_auto` never `null`), "Feature Flags" (the sender list normalized) |
| `dom/spamfilter/ui-01-settings` | spamfilter | spec 05 "Feature Flags" (threshold, 0 included; the allow and block lists with their own Save; address book; accounts, `[]` = all), "Address-list preferences and the empty-string trap" (an emptied list is `[]`), spec 01 "Data Flow: Spam filter sender rules" (the lists the page edits), spec 02 "Missing special prompts" (the log: arrays joined, legacy records with empty cells) |
| `dom/spamfilter/ui-02-own-integration` | spamfilter | also spec 02 "Missing special prompts": no report, one placeholder row of 8 columns under the header |
| `dom/addtags/ui-01-settings` | addtags | spec 05 "Feature Flags" (numbers, 0 included; the exclusion list lowercase with its own Save; accounts), "Address-list preferences and the empty-string trap" (the allow list as a string, no blank line), "Feature-Page Shell" (the auto-tagging sub-rows with their explicit display), spec 02 "Add tags: extra prompt statements" (the preview: limit, language, allow list, existing tags with and without the allow list, not with `{%tags_full_list%}`) |
| `dom/get-calendar-event/ui-01-settings` | get-calendar-event | spec 05 "Feature Flags" (`calendar_no_selection` reloads the menus), "Timezone Select" (generated labels, offset order, Tom Select settings, a known stored zone, a pick stored as the id), "Reminder Section" + spec 02 "Calendar event / task: reminder (#887)" (placement, the rules with their own Save, the preview of format and rules, the warning), spec 02 "Calendar event / task: link to the original email" (the switch, unprefixed); the editor saves both calendar prompts |
| `dom/get-calendar-event/ui-02-own-integration` | get-calendar-event | also "Timezone Select": no zone stored, no red border |
| `dom/get-task/ui-01-settings` | get-task | as the calendar page, for the task: an unknown stored zone gets its fallback option, `task_append_email_link` |
| `ui/01-window-position` | — (level 1) | spec 05 "UI & Feature Preferences", rows `chatgpt_win_top` / `chatgpt_win_left`: `toWindowCoordinate()` / `getSavedWindowPosition()` (0 and negatives are positions, `''` / `null` / `NaN` are not, both coordinates needed), and the background's `applyWindowPositionAndSize()` reading through them (checked in the source: `mzta-background.js` cannot be imported) |
| `ui/99-harness-known-issues` | — | the known-issue shape (level 1) |

The other groups of the area (the prompt management pages; the setup wizard, onboarding and the
popup) are not written yet: see [What is not covered](#what-is-not-covered).

## Doing in a file what the harness does not offer

Two things the core does not provide are done **inside the file that needs them**, after `openPage()`,
without touching the core or adding a plugin:

- **Scripting the network** (`scriptFetch(ctx)`, `ui/dom-helpers.mjs`). The harness's `fetch` stub
  records every call and rejects. The provider clients look `fetch` up on the global object **at call
  time** (`fetchWithRetry()` in `js/api/api-retry.js`, the direct probes such as Ollama's
  `fetchVersion()`), and each DOM file is its own process, so a file may replace `globalThis.fetch` once
  the page is open. `scriptFetch()` keeps the stub's contract - every call is still recorded in
  `ctx.fetchCalls`, an unscripted call still rejects with a `TypeError` - and adds answers, each
  consumed by the first call it matches (a url, a RegExp or a predicate):

  ```js
  const net = scriptFetch(ctx);
  net.answer('https://api.openai.com/v1/models', () => json({ data: [{ id: 'gpt-5' }] }));
  net.answer(url => url.endsWith('/api/version'), () => json({ version: '0.6.0' }));
  net.fail('https://api.openai.com/v1/models');      // a network error
  await ctx.click(ctx.$('#mzta_conn_test_link'));
  await until(ctx, () => strip.dataset.state !== 'loading');
  net.pending();                                      // answers no call consumed
  ```

  `until(ctx, pred)` settles until a condition holds: `settle()` alone may return while a scripted
  `Response` body is still being read, which is not a browser-mock promise it tracks. Responses are
  Node's own (`json()`).
- **Granting or denying a permission** mid-file: pass `openPage(page, { permissions })` an object and
  set or delete its `request` later; the harness reads it on every call.
- **A cancelled `confirm()`**: the harness's `confirm` answers what `openPage({ confirm })` said, for
  the whole file. Page modules call the bare `confirm`, a global, so a test replaces
  `globalThis.confirm` for one click (recording in `ctx.dialogs` like the stub) and puts it back.
- **The message tags** (`addtags/ui-01`): the harness's `messages.tags.list()` answers none and
  `openPage()` takes no tags; the Add Tags page reads them on every preview refresh, so the file
  replaces `ctx.ctl.browser.messages.tags.list` after the page has opened.
- **Another add-on's answer** (Sparks, `ui-03`): the harness answers the two-argument
  `runtime.sendMessage('thunderai-sparks@micz.it', …)` with `null`. The options page asks again
  whenever its feature rows are recomputed, so the file wraps the mock's `ctx.ctl.browser.runtime.sendMessage`
  for that id after the page has opened, then triggers a recompute with a relevant `storage.onChanged`.

## Known issues

`helpers/known-issues/ui.mjs` holds the known issues of the area, by **page × spec section × case id**:

```js
KNOWN = { '<page>': { 'spec NN "<section>"': { 'NN-<case>': '<what the page does instead>' } } }
```

The case id's `NN` is the number of the `ui-NN-` file that declares it, so an entry names one test of
one file. A test is declared with `uiTests(page, NN).test(slug, section, title, fn)`; a case listed
under its page and section runs as a TODO while it fails and fails the run once it passes ("stale").
Each file ends with `coverage()`, which fails on an entry naming a case the file does not declare under
that section. `validateKnown()` refuses a page with no `ui-` file, a section not of the form
`spec NN "<section>"`, a case id that is a pattern or names no existing file, a case listed under two
sections, and an empty reason; `ui/99-harness-known-issues` runs it.

**Today there is none**: every assertion of the options page and feature page files passes.

## What is not covered

- **Groups C and D of the area are not written yet**: the prompt management pages (custom prompts,
  data placeholders, menu order), and the setup wizard, onboarding and popup.
- **The guard's native dialog**: the tests check that `beforeunload` is cancelled; the "leave page?"
  confirmation itself is Thunderbird's.
- **The connection test's failure paths and "Update list" on the feature pages**: the same shared code
  runs with the `<feature>_` prefix; the area covers them on the options page (`options/ui-02`) and checks
  on every feature page only that the test reads the prefixed fields.
- **What the background does with the page's settings** (the reminder sent to Sparks, the email link,
  the spam sender rules at run time, the add-tags statements in the real prompt): level 1 of the
  prompts and api areas, or manual. The area checks the page side only.
- **Timezone ids**: which ids the runtime lists (e.g. the legacy `Asia/Calcutta` the spec mentions)
  depends on Node's ICU, not Thunderbird's; the tests check the labels and the order, not the ids.
- **The spam report's full-screen button and row resizer**: layout.
- **Layout and the CSS cascade**: "Shared Design System CSS", the provider tints' colours, the chevron
  rotation, the status box's icon and alignment, the loading label copying the button's width and font
  (jsdom computes no layout: `offsetWidth` is 0), "stays on one line / wraps". Visibility is checked only
  as the DOM expresses it (inline `display`, `hidden`, classes, `disabled`).
- **The fade of the green "done" status** after `MODELS_FETCH_OK_VISIBLE_MS` (30 s) and the cancelling
  of a pending fade by a new click: timers longer than 1 s are not waited for by `settle()`, and the
  area does not mock time on a live page.
- **The time-outs** of the connection test (~10 s) and of "Update list" (20 s): same reason.
- **A rebound or cleared keyboard shortcut**: the harness's `browser.commands.getAll()` answers a fixed
  `Ctrl+Alt+A`, which is also the static fallback; the page reads it once at init, before a file could
  change the answer. The file checks that the chips are rebuilt from the API, not the fallback cases.
- **The Hyprland warning** (Linux only): the harness's platform is fixed to Windows. Not a group A
  section.
- **The plain links of the options page**, deliberately left out of the spec: the documentation
  cards and the welcome card (`#link_doc_guides`, `#link_doc_tutorial`, `#btn_welcome`), the survey
  link and the ThunderStats card. They only open a page and carry no state.

## Under-specified

What the pages do that no spec states, listed instead of tested: the area does not invent rules from
what a page happens to do.

### options

None today: every behaviour of the options page the area found is now in spec 05.

### translate

- **`translate_exclude_lang`** ("languages not to translate"): a text field on the page, read by the
  `{%thunderai_translate_exclude_lang%}` placeholder (spec 03), but not in spec 05's "Translate Settings
  Page" list nor in its Feature Flags table.

### summarize

- **The Reset button of `summarize_max_messages`** (`#reset_summarize_max_messages`): not in the page's
  spec list. The field also carries `min="1"` while the spec says `0` = no limit (a typed 0 is still
  stored).

### spamfilter

- **The threshold warning** (`#spamfilter_threshold_too_low`): shown below 50, with a different message
  at 0.
- **The address-book permission**: switching `spamfilter_skip_addressbook` on asks for `addressBooks`;
  refused, the switch goes back off with an `alert()`. The spec gives only the preference.
- **The account selector's rules**: the last checked account cannot be unchecked; "Select all" /
  "Deselect all" only tick the boxes and **store nothing** until a box itself changes. The spec says only
  "`[]` = all accounts".

### addtags

- **The account selector**: as on the spam filter page (same code).
- **`add_tags_maxnum`**: a number input with no `min`; the spec gives the default and "`> 0`" for the
  statement only.

### get-calendar-event

- **`calendar_no_selection` and the body placeholder**: switching it on with a prompt that does not read
  the message body shows an `alert()` and rolls the preference back; Save refuses such a text while it is
  on. Spec 05 gives only "the single source of truth" and the menu reload.
- **The clipboard switch** (`get_calendar_event_from_clipboard`): asks for `clipboardRead`; refused, it
  goes back off with an `alert()`. The spec states only when the clipboard prompt is shown (spec 02).

### get-task

Nothing beyond what the calendar page shares with it.
