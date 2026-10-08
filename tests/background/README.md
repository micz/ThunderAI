# Tests: the background

Level-1 tests of what the add-on does **on its own, with no page open**: the special commands and
their worker, the automatic processing of incoming mail, batches and their cancellation, the
per-message storage, the preference snapshot and the menus. Everything here runs on the **real
code of `mzta-background.js`**, cut out of the file and run verbatim (see below), against seeded
preferences, a modelled mail store and a scripted model worker.

The contract is the spec, as everywhere in the suite:

- [`claude-spec/01-architecture.md`](../../claude-spec/01-architecture.md): the data flows
  "Background Summary on Email Receive", "Auto-Summarize by Sender Address List", "Spam filter
  sender rules", "Background Translation on Email Receive", the background side of the two "Inline
  … on Message Display" flows; "Per-message pipelines in `processEmails()`", "Resolving a message",
  "Stale-result guard", "In-flight jobs (`taJobRegistry`)", "Context-menu actions", "Unreachable
  message pane", "Batch cancellation (`taBatchController`)"; "Background Preference Snapshot and
  Menu Invalidation" (its four invariants) and "Per-Message Data Storage";
- [`claude-spec/02-prompts.md`](../../claude-spec/02-prompts.md): "Menu System" ("Popup Menu",
  "Context Menu", "Special Prompt Visibility Dependencies"), "Missing special prompts", "Add tags:
  extra prompt statements" (which tags land where), "Summarize" and "Translate";
- [`claude-spec/04-api-integrations.md`](../../claude-spec/04-api-integrations.md): "Worker Lifecycle
  & Timeout", "Thinking in special commands", "Configuration Validation" (the callers' side),
  "Batch cancellation (user-triggered stop)" and its rate-limit stop;
- [`claude-spec/05-options.md`](../../claude-spec/05-options.md): the rows of the preferences these
  flows read (`spamfilter_threshold`, `add_tags_exclusions`, `batch_max_concurrency`,
  `summarize_max_messages`, …).

How to run the suite, the two levels, the core mock and the known-issue mechanism are in the
general [`tests/README.md`](../README.md). Paths below are relative to `tests/`. Everything runs
with **no managed policy**.

## Running

```sh
node --test "tests/background/*.test.mjs"     # this area only, from the repository root
```

Level 1 only: nothing to install, no jsdom. The area imports only `helpers/core/` (and its own
`helpers/known-issues/background.mjs`), and has **no plugin**: the APIs the core mock lacks are added
per context (see "The API models"). The run takes about 16 s (353 tests); nothing waits for real
time: the debounce, the worker timeout and the batch yield points run on node:test's mock timers.

## Layout

| File | Covers | Spec |
|---|---|---|
| `01-job-registry` | `taJobRegistry`: one entry per kind and message, synchronous registration, the job body not run inside `start()`, the promise never rejecting (thrown, rate-limited, synchronous throw, no outcome), the entry removed on every path, a retry in the same session, joiners sharing the outcome, `invalidate()` / `revive()`, the log lines | 01 "In-flight jobs" |
| `02-batch-controller` | `taBatchController`: tokens, `endBatch()`'s snapshot and the reset on the last exit, a cancel flagging the active batches only, later batches unaffected, overlapping batches and one notice, `rate_limit` never overwritten, the longest `retryAfterMs`, `getStatus()`, independence from `WorkingLevel` | 01 "Batch cancellation", 04 "Batch cancellation" |
| `03-working-status-exclusions` | `taWorkingStatus` (level, icons, never negative); `checkExcludedTag()` and the exclusion list preference | 01 "Working indicator", 05 `add_tags_exclusions` |
| `04-storage` | `taStorage`: the `msg:<id>` key and schema, the three fields in one record, force / no force, deleting a field and the last field, `deleteRecord()`, `getAll*Records()`, age-based `cleanup()`, `clearAllRecords()`, the preferences never touched, the per-record write queue (concurrent fields, delete + write, two instances, order, other messages in parallel) | 01 "Per-Message Data Storage" |
| `05-stores` | `taSummaryStore`, `taTranslationStore`, `taSpamReport`: round trips, error states, records written by older versions, removal, the 100-entry truncation (as methods: the background calls only the spam one), `saveError()` metadata, `getAllReportData()` → `{}`, clearing one field only, no `storage.session` state | 01 "Per-Message Data Storage", 02 "Missing special prompts" |
| `10-special-command` | `mzta_specialCommand` after `initWorker()`: the prompt posted, the answer accumulated, `newRetryAttempt` / `messageSent` ignored, thinking tokens and `<think>` blocks (closed, leading whitespace, unterminated), errors with `rateLimited` / `retryAfterMs`, a worker crash, the timeout (the preference, the default, after a 429, after a 503, never after an answer), `dispose()` on every path | 04 "Worker Lifecycle & Timeout", "Thinking in special commands", #batch-stop-on-rate-limit |
| `20-receive-summary-translation` | `summarize_auto = 3` / `translate_auto = 3`: the listener registration, what is stored on which message, the prompts, the broadcast to the displaying tabs, the ids, the sanitizer on the way out, one worker per prompt, the cache hit, the same id twice in a batch, the skipped folders and archives, several messages | 01 "Background Summary / Translation on Email Receive", "Per-message pipelines", "Shared guards", "In-flight jobs" |
| `21-sender-list` | the sender list on reception and on open: exact, domain, subdomain, other senders, no tab, skipped folders, the cached summary, both triggers = one call, an unusable connection, a legacy `['']` list | 01 "Auto-Summarize by Sender Address List" |
| `22-spam-rules` | the allow / block lists and the address book: every precedence case, never moving an allow-list report (threshold 0), the pipeline stopped by a block, a manual check, legacy `['']` lists | 01 "Spam filter sender rules" |
| `23-spam-actions` | the AI verdict: moved to junk (marked, then moved), the threshold, the panels, an account with no junk folder, the account list, skipped folders, a message gone after the analysis, `getFull()` failing, a non-JSON answer, serialized moves, the manual path, `spamfilter_only_inbox`, the outcome only after the report is stored | 01 "Per-message pipelines", "Spam filter sender rules", "Shared guards" |
| `24-add-tags` | automatic tagging and the context-menu Add tags: tags assigned (existing and new), existing tags kept, exclusions, not tagging a spam message, spam first, only-inbox and sent, one new tag from parallel pipelines, the right tags on the right message, the selection cap, force existing, include sent, an unusable connection | 01 "Per-message pipelines", "Shared guards", "Add tags selection cap"; 02 "Add tags: extra prompt statements" |
| `25-inline-summary` | `initSummary` / `triggerSummaryGeneration` / `refreshSummary` / `removeSummary` / `getDisplayedMessageId`: every `summarize_auto` mode, both display modes, the cache, stale results, a deletion while generating, delete-then-generate-again, an unreachable pane | 01 "Inline Summary on Message Display", "Stale-result guard", "In-flight jobs", "Unreachable message pane" |
| `26-inline-translation` | the same for the translation: the target language and its fallback, status `-1`, HTML / plain text through the sanitizer, no language configured | 01 "Inline Translation on Message Display", 02 "Translate" |
| `27-dedup` | joining across callers: the batch joining a manual summary, the panel joining the batch's summary and translation, the batch joining a manual spam Refresh (moved once), `checkSpamReport` joining, the context menu and the batch sharing add_tags, overlapping batches, the working level | 01 "In-flight jobs" |
| `28-batch-stop` | a Stop in the middle of a 7-message batch: `batch_status` / `cancel_batch`, what was done, what was in flight, what never started, what is stored, the blue notice, not resumed later, the button on open, the next batch | 01 "Batch cancellation", "Per-message pipelines"; 04 "Batch cancellation" |
| `29-rate-limit` | a rate limit on each feature: what ran, what is stored, the red panel, the retry-after notice, the next batch | 01 "Automatic stop on a rate limit", 04 #batch-stop-on-rate-limit |
| `30-snapshot` | invariants 1-3: the fresh read, the effective connection, `get_active_special_ids`, the 200 ms debounce, coalescing, the snapshot before the menus (and Sparks), the accumulated flags, the two gates, the menu-relevant keys, the ignored keys and areas, `_process_incoming`, the flag repair | 01 "Background Preference Snapshot and Menu Invalidation" |
| `31-menus` | the context menu (parent, `show_in`, types, order, specials, icons, titles), what the popup is handed, `popup_menu_ready` / `preparePopupMenu()`, `shortcut_do_prompt` on a special prompt, the shortcut list swap, no context prompt at all | 02 "Menu System"; 01 (the swap) |
| `32-menu-coalescing` | invariant 4: three rebuilds → one plus one trailing rerun, the newest arguments, every caller waiting for the final state, one click listener, the three real triggers together | 01 "Background Preference Snapshot and Menu Invalidation" |
| `33-context-menu` | the context-menu special actions: the selection of the clicked tab (and its fallback), the UI tab, inline / other message displayed / unreachable pane / several messages / the cap, Translate's UI tab | 01 "Context-menu actions", "Inline Summary" (context menu), "Unreachable message pane" |
| `34-config-errors` | a missing API key on every automatic feature: no worker, nothing stored, each panel (generic for add_tags), nothing in progress, the retry once fixed | 04 "Configuration Validation"; 01 "In-flight jobs" |
| `99-harness-known-issues` | the shape of `helpers/known-issues/background.mjs` | harness |
| `99-harness-scope` | the statement splitter and the cut (small cases and the real file), the fake Worker, the strict API models | harness |

Helpers, named without the test suffix so the level-1 glob never runs them:

- `scope.mjs`: cuts and runs the background's code (see below);
- `context.mjs`: `bgContext()` (a background started the way the background starts) and
  `moduleContext()` (the modules alone), `ROOTS`, `STARTUP`, the stand-ins;
- `apis.mjs`: the API models; `fake-worker.mjs`: the scripted Worker;
- `flows.mjs`: what the flow files share (`receive()`, `fromTab()`, `clickContextMenu()`,
  `setPrefs()`, `drive()`, `featureResponder()`, `assertClean()`…).

No fixture file: each test seeds what it needs in the context's options.

## How the background's code is cut and run

`processEmails()`, `newEmailListener()`, the snapshot (`prefs_init`, `reload_pref_init()`, the
debounced `storage.onChanged` handling), `_computeActiveSpecialIds()`, the generators and the main
`runtime.onMessage` listener all live at the **top level of `mzta-background.js`**, which cannot be
imported. The tests never copy any of it. `scope.mjs`:

1. splits the top level into statements on the core tokenizer (`segments()` / `stripComments()`
   of `helpers/core/background-source.mjs`): a statement ends at a top-level `;`, at the closing
   brace of a block statement (`if`, `function`, `export function`, `try`…) not followed by `else` /
   `catch` / `finally`, or at a brace after which automatic semicolon insertion applies (the
   `const newEmailListener = (…) => {…}` with no semicolon);
2. classifies each one: an import, a declaration (`function`, `export function`, `const` / `let` /
   `var`), or another statement;
3. picks the declarations the **roots** name (`ROOTS` in `context.mjs`), the statements the
   **guards** name (`STARTUP`: the text a statement starts with), and, to a fixed point, every
   top-level declaration their code references (an identifier, not a property name: `browser.menus`
   does not pull in the `menus` constant; template literal substitutions count);
4. runs them **verbatim, in file order**, as the body of one async function whose parameters are
   the names the code takes from the file's own `import` statements, imported from the real
   modules, plus the names the test **injects**. A declaration whose initializer awaits a startup
   step at the top level is refused unless it is injected.

The scope hands back the roots by name and `$eval(source)`, a direct eval inside it, to read or set
a module-level binding (`prefs_init`, `_process_incoming`, `menus`).

The startup a context runs is `STARTUP`, in file order: `loadManaged()` (no policy), the flag
repair, `reload_pref_init()`, the three `taLog` assignments, the main `runtime.onMessage` listener,
the `onMessageExternal` listener, `setupStorageChangeListener()`, the initial menu build, the
background's `menus.onClicked` listener and the `onNewMailReceived` registration. So a test sends a
content script's message through `ctl.dispatchMessage()` to the **real listener**, fires the **real
registered** `onNewMailReceived` listener, clicks through the **real** `menus.onClicked` listener.
`99-harness-scope` fails by name when a root or a guard no longer exists, before any flow test.

**Every piece the flows need could be cut.** What a context does not run is left out on purpose:
the migrations (the migration area), the startup policy warnings (managed), the content script
registrations and the injection loop into open tabs (`let openTabs = await messenger.tabs.query()`,
a top-level await), `onInstalled`, the permissions and keyboard-command listeners.

### What is injected instead of the real module (the stand-ins)

Each is a part of ThunderAI **another area owns** that needs a DOM, which level 1 does not have.
Each records what it was given in `ctx.standIns`:

| Name | Real | Stand-in |
|---|---|---|
| `window` | the background page's window | `{markdownit, screen}`: the real markdown-it (the summary job renders with it) and a 1920 × 1080 screen (`openChatGPT()` sizes its window) |
| `sanitizeBlockHtml` | `js/mzta-richtext.js`, the one sanitizer (DOMParser; compose area) | prefixes `<!--sanitized-->`: the tests assert the payload crossed it, and that the stored object did not |
| `htmlBodyToPlainText` | `js/mzta-utils.js` (DOMParser; compose area) | turns the model's `<br>` back into `\n` |
| `taPromptUtils` | `js/mzta-utils-prompt.js` | the real object, but for `buildSummaryPrompt()` (it reads the body through `htmlBodyToPlainText()` inside the module): it records the `{message, fullMessage}` entries and returns `SUMMARIZE <ids>` with the real `prompt_summarize` |

The two classic scripts `mzta-background.html` loads before the module run as classic scripts:
`api_webchat/markdown-it.min.js` and `js/lib/mzta-html-lines.js` (whose `mztaLinesToHtml()` builds
the HTML twin of a text/plain part). Everything else is real: the stores, the job registry, the
batch controller, the prompts and their placeholders (spam filter, add tags and translation prompts
are the shipped texts), `mzta_specialCommand`, `mzta_Menus`, the preferences.

## The fake Worker

`fake-worker.mjs` installs a fake `Worker` on `globalThis`, where `js/mzta-special-commands.js` finds
it. It accepts only the five model workers of `js/workers/`, as modules, and **throws** on any other
construction (recorded in `unexpected`); records every message posted (cloned); refuses a post or a
delivery after `terminate()`; delivers worker messages with `w.deliver(...)`, in order, through the
caller's own `onmessage`. A context's `workers.respond` answers each `chatMessage`: `answering(fn)`
(tokens, then `tokensDone`, or an `error`), `holding()` (the test releases each answer when it wants:
how a job is caught "in flight"), or `featureResponder()` in `flows.mjs`, which tells the feature
from the shipped prompt text and the message from its body.

The same idea as `tests/webchat/fake-worker.mjs` (an area never imports another area's helpers):
that one drives a page and settles it after each message; this one drives a module directly.

## The API models

`apis.mjs` adds what the core mock lacks, on one context, right after the mock is installed and
before any module is imported (the `decorate` step of `bgContext()`; `startBackground()` has no
`decorate` option, so the context installs the core mock itself, then the models, then the core
modules, then loads the policy with no policy installed, as the background does):

- a **mail store**: accounts, folders (`f-inbox`, `f-junk`, `f-trash`, `f-sent`, `f-drafts`,
  `f-templates`, `f-outbox`, `f-archives`, `f-lists`), messages with a text/plain part whose body
  names the message (`Body of <id>`), tags; `messages.get` / `getFull` / `listInlineTextParts` /
  `query` / `continueList` (paged `MessageList`s) / `update` / `move` (a moved message gets a **new
  id**, as in Thunderbird) / `tags.list` / `tags.create`, `folders.query`;
- **tabs**: `{id, type, windowId, active, displayed, reachable, selected}`; `tabs.query`,
  `tabs.sendMessage` (recorded in `tabSends`; rejects with the #901 `TypeError` on an unreachable
  pane, "Invalid tab ID" on a missing tab), `messageDisplay.getDisplayedMessage`,
  `mailTabs.getSelectedMessages`, the two action icons, `windows.create` (the chat window opening);
- **menus**: `removeAll`, `create` (with its callback; a duplicate id is recorded in `menuErrors`,
  which is how an interleaved rebuild would show), `onClicked`;
- `permissions.contains`, `contacts.quickSearch`.

Every namespace added is **strict**: reading a property it does not model throws and is recorded
in `unmodelled`; every flow file ends with `assertClean()` (no worker alive, no unexpected worker,
no unmodelled API, no unhandled rejection). Sparks is the core mock's `external` answer: absent by
default; `30-snapshot` makes it appear.

## Contexts and time

One test file is **one background context**: one `bgContext()` (or `moduleContext()`) at the top,
module singletons never reset. A file that needs other preferences mid-way writes them the way a
settings page does and lets the background's own debounced listener refresh its snapshot
(`setPrefs()`, on the mock clock). `drive()` runs a batch under mock timers, firing the
`setTimeout(0)` yields between chunks of five messages; `28-batch-stop` uses seven messages for
that.

## Known issues: TODO tests

A test that fails against the shipped code is not changed to pass, and neither is the source. Its
reason goes in `helpers/known-issues/background.mjs` and it runs as a `# TODO` until fixed, then fails
the run ("stale known issue") so the entry is removed. The shape of an entry (a file × a case id ×
a reason naming the spec section) is validated by `99-harness-known-issues`.

None today.

## What is not covered

- **ChatGPT Web** (`js/mzta-chatgpt.js`, its loader): a content script driving the provider's page.
- **The content script's rendering** (`js/mzta-compose-script.js`): what it draws with what the
  background sends is the compose area's; here only what is sent, to which tab.
- **Sparks' side of the integration**: the calendar event and task dialogs; only the presence check
  (which shows or hides their prompts) is modelled.
- **The managed branches**: policy locks in the storage listener, organization prompts in the menus,
  policy account lists, enforced connections (the managed area).
- **The model workers and `fetchWithRetry()`** (the api area): here the worker is scripted.
- **What the prompts say** (the prompts area): the prompt texts and placeholders are real, but only
  which message a prompt is built from is asserted.
- **The HTML body path**: `htmlBodyToPlainText()`, the HTML branch of `getMailInlineTextParts()`,
  the sanitizer and `buildSummaryPrompt()`'s own body reading need a DOM (compose area). The model's
  messages have a text/plain part only.
- **The chat window** (`openChatGPT()` past `windows.create`, `api_webchat/`): the webchat area; here
  only that the window opens, for which messages. The regular prompts' menu actions
  (`executeMenuAction()`) and the popup's Add tags dialog path (`act()` in `js/mzta-menus.js`, the
  `getTags` confirmation) are not run.
- **The compose-window commands** (`chatgpt_replaceSelectedText`, `chatgpt_replyMessage`,
  `compose_reloadBody`), `chatgpt_close`, `chatgpt_saveSummary`, `assign_tags`,
  `addtags_get_exclusion_prefs` / `addtags_set_exclusions` (compose and ui areas' callers).
- What the background does at startup besides `STARTUP` (see above), the keyboard shortcut and the
  `permissions.onRemoved` listener.
- **The real Thunderbird storage and its timing**: the core mock resolves at once; the write races of
  a slow storage are tested with direct concurrent calls (`04-storage`), not through a flow.

## Under-specified

Where the spec says nothing, or says two things, the behaviour is listed here, not pinned by a test.
Input for the spec:

1. **A rate limit stops every overlapping batch.** Spec 01 says "Only the current batch stops", but
   the mechanism it documents (`stopForRateLimit()` -> `requestCancel('rate_limit')`, which "flags
   every batch active at that moment") also stops a batch running beside it, e.g. another account
   receiving at the same time: that batch's queued messages are never screened, tagged or
   summarized. *Decided:* the target is to stop only the features that use the connection that hit
   the rate limit, in every batch; a separate job, not pinned by a test here until then.
2. *(resolved: concurrent writes to one `msg:` record used to drop each other's field, and the spam
   job did not await its report. `taStorage` now queues the writes of each record, and the job
   awaits the save; spec 01 "Per-Message Data Storage" says so, `04-storage` `concurrent-*` /
   `queue-*` and `23-spam-actions` `outcome-after-save` test it.)*
3. *(resolved: the messages a Stop or a rate limit left unprocessed are not resumed, by design; spec 01
   "Batch cancellation", "What a stop leaves behind", says what stays available. `28-batch-stop`
   `not-resumed` / `button-on-open` test it.)*
4. *(resolved: `_process_incoming` was woken by `add_tags_auto` alone, a batch with nothing to do;
   it now gates `add_tags && add_tags_auto` like `newEmailListener()`. Spec 01 "Background Preference
   Snapshot" lists the gate of each feature; `30-snapshot` `process-incoming` tests it.)*
5. *(documented as it is: spec 01 "Per-message pipelines", "De-duplication", says what happens to a
   message present twice in a batch. One AI call per copy when they are processed one after the
   other; with `batch_max_concurrency` > 1 the second copy joins the first one's spam / add_tags job
   and is left where it is, untagged. Not pinned by a test.)*
6. *(documented as it is: spec 01 "Per-Message Data Storage", "Cleanup and truncation, as of today":
   `taStorage.cleanup()` unused, the spam reports truncated only after an incoming batch with the
   spam filter on, summaries and translations never. The policy is a separate job.)*
7. *(documented as it is: spec 04 "Configuration Validation", the spam filter routing: a check first
   removes the previous report, so a configuration error leaves the message with none.)*
8. *(resolved: spec 01 "In-flight jobs" now writes the `[taJobs]` lines as the code logs them, and
   `01-job-registry` `logs` asserts them exactly.)*
9. *(resolved: a job body resolving to nothing can only be a missing `return`; the registry used to
   turn it into a silent `skipped`, it now resolves `error` and logs `[taJobs] <kind>:<id> returned
   no outcome`. Spec 01 "In-flight jobs" says so; `01-job-registry` `no-outcome` tests it.)*
10. *(documented as it is: spec 01 "Stale-result guard" says when the same tab gets the generating
    panel more than once - the panel buttons, Refresh, the context-menu inline Summarize, a click
    joining a running job - and that the content script draws one. `33-context-menu` asserts the
    two sends of the context-menu path.)*
