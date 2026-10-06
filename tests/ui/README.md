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
│   ├── page-stubs.mjs            what jsdom lacks on the prompt management pages: <dialog>, innerText,
│   │                             execCommand, the import file picker, the exported file, a one-off confirm()
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
| `dom/translate/ui-01-settings` | translate | spec 05 "Translate Settings Page" (stored settings shown, written with their type, the excluded languages included), "Mandatory Specific Integration" (`translate_auto` never stored as `null`) |
| `dom/summarize/ui-01-settings` | summarize | spec 05 "Summarize Settings Page" (settings; max messages: 0 accepted, the Reset button; an automatic mode forces inline; the forced language field and its preview, with the fallback to the default language and the refresh from `storage.onChanged`; the sender card: its own Save, the toggle, mode 3, the notice; the three editors), "Mandatory Specific Integration" (`summarize_auto` never `null`), "Feature Flags" (the sender list normalized) |
| `dom/spamfilter/ui-01-settings` | spamfilter | spec 05 "Feature Flags" (threshold, 0 included, and its warning; the allow and block lists with their own Save; the address book and its permission, granted and refused), "Account selector (Spam Filter and Add Tags pages)" (as stored, `[]` = all, one box, the last one kept, "Select all", "Deselect all"), "Address-list preferences and the empty-string trap" (an emptied list is `[]`), spec 01 "Data Flow: Spam filter sender rules" (the lists the page edits), spec 02 "Missing special prompts" (the log: arrays joined, legacy records with empty cells) |
| `dom/spamfilter/ui-02-own-integration` | spamfilter | also spec 02 "Missing special prompts": no report, one placeholder row of 8 columns under the header |
| `dom/addtags/ui-01-settings` | addtags | spec 05 "Feature Flags" (numbers, 0 included, the tag limit 0 = no limit; the exclusion list lowercase with its own Save), "Account selector (Spam Filter and Add Tags pages)", "Address-list preferences and the empty-string trap" (the allow list as a string, no blank line), "Feature-Page Shell" (the auto-tagging sub-rows with their explicit display), spec 02 "Add tags: extra prompt statements" (the preview: limit, language, allow list, existing tags with and without the allow list, not with `{%tags_full_list%}`) |
| `dom/get-calendar-event/ui-01-settings` | get-calendar-event | spec 05 "Feature Flags" (`calendar_no_selection` reloads the menus; switching it on refused, and Save refused, without the body placeholder; the clipboard switch and its permission, granted and refused), "Timezone Select" (generated labels, offset order, Tom Select settings, a known stored zone, a pick stored as the id), "Reminder Section" + spec 02 "Calendar event / task: reminder (#887)" (placement, the rules with their own Save, the preview of format and rules, the warning), spec 02 "Calendar event / task: link to the original email" (the switch, unprefixed); the editor saves both calendar prompts |
| `dom/get-calendar-event/ui-02-own-integration` | get-calendar-event | also "Timezone Select": no zone stored, no red border |
| `dom/get-task/ui-01-settings` | get-task | as the calendar page, for the task: an unknown stored zone gets its fallback option, `task_append_email_link` |
| `dom/customprompts/ui-01-prompts` | customprompts | spec 05 "Manage Custom Prompts Page (`pages/customprompts/`)": the list (its id order, the first row shown on arrival, System / Personal badges, padlock, Open / Edit, resolved names, the one-line preview, menu and action labels, the option chips, the count), keyboard selection, the search (name, resolved built-in name, id, text; marks, "shown of total", the badge, no match, clear; not List.js' `search` class), the view switch and `custom_prompts_view`, the row menu (items per prompt kind, closing on overlay / Esc / search / view switch / scroll / resize, upward for the last rows), Edit from the table, a built-in read-only (banner, fields, flags: only `need_custom_text`, saved at once), a personal prompt (buttons, the diff viewer only with "substitute text", the flag rings, dirty / Cancel, validation, Save and its status), the mirror repainted on fill, the [API] disclosure and its Reset, New (ID from the name, Cancel, Save after the last position, the search cleared), Duplicate / Duplicate and edit (a second copy's id made unique), Delete (confirmed, cancelled, from the row menu), the dirty guard (Cancel / Discard / Apply, Escape, invalid Apply, New, Import, the table's Edit), the newline stored as `
`, the Custom Data PH button, Export (one / all, with and without API settings), Import (refused, merged and saved at once, invalid files), a failed write; spec 02 "Custom Prompts" (no idnum, no built-in in `_custom_prompt`; an imported legacy `enabled: 0`), "The five boolean flags are normalized on read" (numbers from the editor), "Per-Prompt API Override Properties" (the export without API settings), "Menu Order Page (`pages/menu_order/`)" (the "Menu position" button: stash + new tab, or focus + message); spec 03 "Invalid placeholder feedback" (read mode and the edit-mode mirror, the repaint on a type change), "Placeholder Autocomplete" (the type read through the getter, substring and prefix-first matching with the bold run, the ARIA attributes, the arrows wrapping, Escape, Enter / Tab / mousedown replacing the whole token through `insertText`, the caret after a dynamic one), the unterminated `{%` and the token under the caret (open: exempt; closed: judged) |
| `dom/customprompts/ui-02-table-chatgpt-web` | customprompts | spec 05 "Manage Custom Prompts Page": the stored table view, the [ChatGPT Web] disclosure (open with a model / project, gone while an api_type is set, offered closed on a new prompt, saved trimmed); spec 02 "Per-Prompt API Override Properties" (a built-in's override summarized with its localized label), "The five boolean flags are normalized on read" (a stored `need_custom_text: ""` shows the built-in's own "1") |
| `dom/customdataplaceholders/ui-01-placeholders` | customdataplaceholders | spec 05 "Manage Data Placeholders Page (`pages/customdataplaceholders/`)": the rows (id without the prefix, chips in read mode, a legacy `<br>`, the enabled switch, the count), quiet at load, the add-form (New, its mirror, its validation, Add, closed by Save All), Delete (confirmed, cancelled, after a Save All), the row editor (Edit with Confirm / Cancel as `flex`, Edit / Delete restored with `''`, Cancel restoring the id as it was, Confirm, the mirror and the autocomplete destroyed on exit), the enabled switch (a loaded row, a new row), Save All and its state, a failed Save All, the stored text, Export (what is stored, not a pending edit), Import (refused, invalid files); "Unsaved-Changes Guard" (this page's own beforeunload); spec 03 "Custom Placeholders" (the prefix, `is_default` / `is_dynamic` "0", `enabled`, the import merged on the prefixed id, an entry with no id skipped), "Placeholder Autocomplete" (the add-form's select, the row's own `.type_output`, built-ins only), "Invalid placeholder feedback" (a custom token is red here, the repaint on a type change, in the add-form and in a row) |
| `dom/customdataplaceholders/ui-02-special-chars` | customdataplaceholders | spec 05 "Manage Data Placeholders Page" ("The values in the row markup"): a name with quotes, `<` `>` and `&`, a text with `</textarea>`, a tag, an entity and a token, shown and edited literally, stored back unchanged by Edit / OK / Save All (twice) and Cancel; the same for a placeholder added in the form and one imported; Delete and the "already used" check on an id with `&`; rows added after an import of a placeholder with no row number, each with a unique number and working buttons |
| `dom/menu_order/ui-01-menu-order` | menu_order | spec 02 "Menu Order Page (`pages/menu_order/`)": the panels (Reading / Composing and their types, the context panel without type 2), Visible by position (a prompt with none last, a missing `position_context` ranked alphabetically at load), Hidden alphabetically, "hidden everywhere", the exclusions, the badges and the legend, the icon picker (the first cell per prompt kind, Esc and outside mousedown, a pick marks unsaved and writes nothing, the other panel), the drag (rows not moved before the drop, the insertion line, a release outside any list and a reorder inside Hidden marking the page unsaved), the eight `show_in` transitions, the drop position, reordering, Save All (positions 1, 2, 3…, the three stores, the excluded specials written back, reload_menus, its state), a Save All failing halfway (the error, the button back, no reload over the pending changes), Reset all (in memory, factory order / visibility / icons, then saved), the cross-tab reload (an unrelated key, a prompt store), the drag listeners wired once (no new ones on a re-render), a reorder in Composing renumbering `position_compose`, the `menu_order_highlight` deep-link (its reload dropping the pending changes and the dirty state, every instance, the tab dot, persistence, the sub-tab switch, cleared by a drag); spec 02 "Icon Resolution"; spec 05 "Unsaved-Changes Guard" (this page's own beforeunload) |
| `dom/menu_order/ui-02-deeplink-stash` | menu_order | spec 02 "Menu Order Page (`pages/menu_order/`)": the `menu_order_highlight_target` stashed in `storage.session` by "Menu position" (read after the initial load and deleted, the prompt highlighted, Composing selected for a composing-only one, nothing pending) |
| `dom/setup-wizard/ui-01-fresh` | setup-wizard | spec 05 "Setup Wizard (`pages/setup-wizard/`)": step 0 (six cards, their names and tags; nothing preselected, the hidden select unset, no `connection_type` persisted by opening the page; "Continue" disabled and refusing to advance, enabled by the first card click with no re-render), the tint of the panel and the done badge, the sequence by position (an API provider through "Pick your tools", whose button reads "Finish setup"; Back walking it; ChatGPT Web skipping it, Connect then second-to-last), the Connect step (only the chosen provider's rows), "Pick your tools" (the four API features only, persisted as booleans), "Persistence" (a field under the options page's key; picking a provider writes no flag); "Connection Settings Panel — Advanced Options Disclosure" (rows moved, collapsed, toggled with nothing persisted, collapsed on a provider change), "… — Connection Test Status Strip" (per provider; ok with the form's key and nothing saved, idle on edit, network error; Gemini scripted); spec 04 "ChatGPT Web" (its rows once, unprefixed) |
| `dom/setup-wizard/ui-02-configured` | setup-wizard | spec 05 "Setup Wizard": the saved provider applied at load (card marked, "Continue" enabled), "Persistence" (every `{provider}_{key}` of the fixture `ui/provider-fields.json` and the ChatGPT Web rows shown at load, none rewritten by opening the page, each change stored under its key with its default's type; the stored flags on "Pick your tools"), "Connection Settings Panel — Advanced Options Disclosure" (JSON validation on restore); spec 04 "Anthropic / Claude (`anthropic_api`)" (`anthropic_effort` filled after the restore, holding the stored level, gated by the model) |
| `dom/onboarding/ui-01-no-connection` | onboarding | spec 05 "Setup Wizard", entry point "Onboarding banner" (`.wizard_banner_urgent` with no connection) and "Blue wizard banner vs. red permission banner" (no red banner with an empty `connection_type`, every permission missing, none even checked); nothing written |
| `dom/onboarding/ui-02-web-no-permission` | onboarding | the same sections: ChatGPT Web chosen without its permission; the banner visible but not urgent, only that provider's red banner |
| `dom/popup/ui-01-no-connection` | popup | spec 05 "Setup Wizard", entry point "Popup menu" (the invitation *instead of* the prompt list: list hidden, `popup_menu_ready` never sent) and "Blue wizard banner vs. red permission banner" (no red banner with an empty `connection_type`) |
| `dom/popup/ui-02-key-missing` | popup | spec 05 "Setup Wizard", entry point "Popup menu": a cloud provider without its `*_api_key` is not configured (a host stored for another provider counts for nothing) |
| `dom/popup/ui-03-reading-web` | popup | spec 02 "Popup Menu" (reading types 0 + 1, `show_in` `popup` / `both`, `position_display` order, a special prompt built like the others, the resolved icon or the blank slot); spec 05 "Setup Wizard" ("Popup menu": `chatgpt_web` always configured; the chosen provider's red banner); spec 04 "Batch cancellation (user-triggered stop)" (the banner and its count, `batch_status` polled, the banner gone with the batch) |
| `dom/popup/ui-04-compose-ollama` | popup | spec 02 "Popup Menu" (compose types 0 + 2, `position_compose` order); spec 05 "Setup Wizard" ("Popup menu": Ollama configured by its host); spec 04 "Batch cancellation (user-triggered stop)" ("Stop processing" sends `cancel_batch`); spec 01 "Data Flow: User Action → AI Response" (a chosen prompt sent as `shortcut_do_prompt` with the popup's tab) |
| `ui/01-window-position` | — (level 1) | spec 05 "UI & Feature Preferences", rows `chatgpt_win_top` / `chatgpt_win_left`: `toWindowCoordinate()` / `getSavedWindowPosition()` (0 and negatives are positions, `''` / `null` / `NaN` are not, both coordinates needed), and the background's `applyWindowPositionAndSize()` reading through them (checked in the source: `mzta-background.js` cannot be imported) |
| `ui/99-harness-known-issues` | — | the known-issue shape (level 1) |

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
- **The background's answers to the popup** (`popup/ui-03`, `ui-04`): `popup_menu_ready` (the payload
  `preparePopupMenu()` builds: tab, filtering, prompts, batch status), `batch_status`, `cancel_batch` and
  `shortcut_do_prompt` are given with `openPage({ commands })`. The popup polls `batch_status` with a
  bare `setInterval`, which is Node's and keeps the process alive: each file ends the polling the way
  the page does (the batch reported over, or "Stop processing" clicked).
- **Another add-on's answer** (Sparks, `ui-03`): the harness answers the two-argument
  `runtime.sendMessage('thunderai-sparks@micz.it', …)` with `null`. The options page asks again
  whenever its feature rows are recomputed, so the file wraps the mock's `ctx.ctl.browser.runtime.sendMessage`
  for that id after the page has opened, then triggers a recompute with a relevant `storage.onChanged`.

On the prompt management pages (`ui/page-stubs.mjs`, each installed by the one file that needs it):

- **`<dialog>.showModal()` / `close()`** (`stubDialogs(ctx)`): jsdom has the element, not the two methods.
  The Custom Prompts page builds its choice dialogs (the export question, the dirty guard) with them;
  the stub opens and closes the element, and `choose(label)` clicks one of its buttons.
- **`innerText`** (`stubInnerText(ctx)`): jsdom does not implement it, and the Data Placeholders rows
  read and write their cells with it. For the plain inline spans involved Firefox returns their text,
  so the stub maps it to `textContent`.
- **`document.execCommand()`** (`stubExecCommand(ctx)`): jsdom does not implement it. The autocomplete
  inserts with `execCommand('insertText')` and falls back to `setRangeText()` plus an `input` event when it
  returns `false`; the stub records the call and returns `false`, so the fallback runs.
- **The import file picker** (`pickFile(ctx, trigger, content, done)`): the pages create an
  `<input type="file">`, `click()` it and wait for `change`. The stub answers the next such click with a
  jsdom `File`, then settles until `done()` holds (the page reads it with a `FileReader`, which
  `settle()` does not track). It returns `false` when the page asked for no file.
- **The exported file** (`lastDownload(ctx)`): `downloads.download()` receives a `blob:` URL made by
  Node's `URL.createObjectURL()`; `resolveObjectURL()` reads it back.
- **A failed write** (`customprompts/ui-01`): the file swaps `ctx.ctl.browser.storage.local.set` for one
  that rejects, for one click.
- **An open Menu Order tab** (`customprompts/ui-01`): the file swaps `ctx.ctl.browser.tabs.query` for one
  answering a tab, and declares `menu_order_highlight` in `openPage({ commands })`: the message reaches
  the other extension pages, the background ignores it.
- **A page opened with something in `storage.session`** (`menu_order/ui-02`): `openPage({ session })`,
  the core option seeding that area as `local` seeds its own.
- **The background's list of active features** (`menu_order/ui-01`): `openPage({ commands:
  { get_active_special_ids } })`.
- **A message to the page** (`menu_order/ui-01`): `ctx.ctl.dispatchMessage()` delivers it to the page's
  `runtime.onMessage` listeners; a write by "another tab" is `ctx.ctl.browser.storage.local.set()`.
- **Drag and drop** (`menu_order/ui-01`): the page listens to `dragstart` / `dragover` / `drop` /
  `dragend`, which the file dispatches itself with a stand-in `dataTransfer`. jsdom computes no layout,
  so every row measures 0×0: a pointer above the rows (`clientY` -1) drops before the first row, below
  them (`clientY` 1) after the last; no other drop position is reachable.

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

**Today there is none.** Two found on customprompts were the spec's wording, now corrected in spec 03:
the caret after a completed dynamic placeholder (after the colon, before `%}`) and the exemption of the
token under the caret (only an open token being typed).

The six that group C found first (the Data Placeholders page storing the chip markup and a stale
`enabled`, ignoring the switch of a new row, losing Delete after a Save All; the Menu Order icon shown in
one panel only) were fixed in the pages, and spec 02 / 05 state the behaviour. The one group D found
(the setup wizard not validating the stored JSON fields after its restore) was fixed in the wizard.

## What is not covered

- **The wizard's hidden connection select** (`#connection_type_tr{display:none}`), its 432px card, its
  type scale and the connection-row typography override: CSS, which jsdom does not load.
- **The popup's search keyboard** (typing, arrows, digits, Enter) and the clicks on the onboarding / popup
  permission banners: not specified (see [Under-specified](#under-specified)).
- **"Update list" in the wizard**: the same shared code as on the options page (`options/ui-02`); the
  wizard files check the connection test only.
- **Drag and drop beyond its two ends** (Menu Order): with no layout, a drop lands before the first row
  or after the last; dropping between two rows by pointer position, the drag image and the entry pulse of
  a deep-link highlight are not tested.
- **The native dialogs**: the file chooser of Import, the "Save as" of Export, and Thunderbird's
  "leave page?" confirmation.
- **The Custom Prompts table view's grid** (the five columns, the narrower minimums below 1200px) and the
  row menu's exact position: layout.
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

**setup-wizard**

- **The order of the provider cards.** Spec 05 says their ids and order "match `CONN_TYPES`", but the
  options page's `CONN_TYPES` (`chatgpt_web, chatgpt_api, ollama_api, openai_comp_api, google_gemini_api,
  anthropic_api`) and the wizard's own, derived from its `PROVIDERS` (`chatgpt_web, chatgpt_api,
  google_gemini_api, anthropic_api, ollama_api, openai_comp_api`), differ. The tests check the six ids,
  not their order.
- **The navigation chrome**: when Back is shown (not on step 0 nor on done), "Continue" hidden on done,
  the step-indicator dots, and what "Run again" (`#wiz_restart`) does.
- **The Connect step's text**: the heading (`wizard_connect_heading` with the provider name), the
  subtitle (`wizard_step_connect_sub_web` for ChatGPT Web) and the pill's provider name. The spec says
  the pill is tinted, not what it reads.

**onboarding**

- **The red permission banners' click**: requesting the provider's permission, then hiding the banner
  and showing `#integration_permission_ok`, whose click closes the tab. Spec 05 says only when the
  banners appear.
- **The documentation links** (`#link_doc_guides`, `#link_doc_tutorial`): plain links, as on the options
  page.

**popup**

- **The search and the keyboard**: filtering by label as the user types, the `1.` to `0.` prefixes and
  the digit shortcuts, arrow navigation with wrap-around, Enter, and what `dynamic_menu_force_enter`
  ("Force Enter to submit in popup", spec 05) changes in that flow.
- **The red permission banners' click** (opening the welcome page) and whether the search box hides
  under them.
- **The invitation's link closing the popup** after opening the wizard, and "Stop processing" disabling
  itself, relabelling to `batch_stopping` and closing the popup: spec 04 says only that it requests the
  cancellation.
- **No tab to answer** (`popup_menu_ready` answering nothing): the page hides the loading spinner.
- **What counts as "set"** for a credential: the page trims it, so a whitespace-only key is not
  configured.

What the area found on the earlier groups on the options page and the six feature settings pages is in spec 05
(or 08); what it found on the three prompt management pages is in spec 05 ("Manage Custom Prompts
Page": order and arrival, newlines; "Manage Data Placeholders Page": the add-form, Import and Export) and spec 02 ("Menu Order Page": prompts with no position, what marks the page unsaved),
or was fixed (the deep-link reload now calls `markSaved()`; a copy's id is made unique; the Data
Placeholders rows escape their values, Cancel no longer uppercases the id, and a row added after an import
is wired on its own element; the Menu Order drag listeners are wired once).
