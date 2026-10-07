# Tests: the one-time storage migrations

Level-1 tests of the migrations that run at every background start, and above all of **the startup
sequence as a whole**. These migrations run once, on the real data of every user upgrading to 5.1.0.
A mistake cannot be corrected afterwards, because the data it damaged is gone. So the invariant
these tests hold above everything else is that **the user's settings survive**: every preference,
the connection settings, the custom menu order, `show_in` and the prompt payloads.

The contract is the spec, as everywhere in the suite:

- [`claude-spec/05-options.md`](../../claude-spec/05-options.md): "Overview" (the move to
  `storage.local`, local wins, the sync copy left in place, the `_prefs_migrated_from_sync` marker,
  `isSyncDrained()`), the `dynamic_menu_order_alphabet` and `calendar_no_selection` rows, and
  "Preference access";
- [`claude-spec/01-architecture.md`](../../claude-spec/01-architecture.md) "Storage";
- [`claude-spec/02-prompts.md`](../../claude-spec/02-prompts.md): "Alphabetic-to-Position Migration"
  and "Enabled-to-show_in Migration" (here only as steps of the sequence; see below);
- [`claude-spec/04-api-integrations.md`](../../claude-spec/04-api-integrations.md): the Ollama `think`
  paragraphs (`migrateOllamaThinkLevel()`), and "When a policy locks the override off" (the migration
  block runs before `loadManaged()`, so the background must not message itself);
- [`claude-spec/08-managed-configuration.md`](../../claude-spec/08-managed-configuration.md)
  "Interaction points": only its unmanaged statement about `migrateCalendarNoSelection()`.

The modules under test are `js/mzta-prefs-migration.js` (`migratePrefsToLocal()`, `isSyncDrained()`,
`migrateOllamaThinkLevel()`), the two #129 migrations of `js/mzta-utils.js`
(`migrateCustomPromptsStorage()`, `migrateDefaultPromptsPropStorage()`), and
`migrateCalendarNoSelection()`, `migrateEnabledToShowIn()` and `migrateMenuOrderAlphabetic()` of
`js/mzta-prompts.js`, together with **their order and guards in `mzta-background.js`**. How to run
the suite, the two levels, the mock and the known-issue mechanism are in the general
[`tests/README.md`](../README.md). Paths below are relative to `tests/`.

Everything here runs with **no managed policy**.

## Running

```sh
node --test "tests/migration/*.test.mjs"     # this area only, from the repository root
```

Level 1 only: nothing to install, no jsdom. The area imports only `helpers/core/` and its own
`helpers/known-issues/migration.mjs`, and has **no plugin**: storage is seeded through the core
mock's options. The run takes about 15 s, most of it spent in the interruption tests of
`12-sequence-partial`, which start about 70 fresh contexts.

## Layout

| File | Covers | Spec |
|---|---|---|
| `01-prefs-to-local` | `migratePrefsToLocal()` alone: an upgrade from 5.0.x, a fresh install, the steady state (one single-key read), a key in both areas, every value type, keys absent from `prefs_default`, the one-shot flags carried across, the payloads left to #129, the marker withheld and then set, settings changed while downgraded not carried back, a failing `sync.get()` / `local.set()` / `local.get()` | 05 "Overview", 01 "Storage", 05 `dynamic_menu_order_alphabet` row |
| `02-sync-drained` | `isSyncDrained()`, including a marker that is not `true` and one that cannot be read | 05 "Overview" |
| `03-ollama-think` | `migrateOllamaThinkLevel()`: boolean to level, level kept, unset kept, global only, its flag, idempotence | 04 (Ollama `think`) |
| `04-prompts-129` | the two #129 migrations: copy then remove, a local copy kept with the stale sync copy removed, nothing to do | 01 "Storage", 05 "Preference access" |
| `05-calendar-no-selection` | `migrateCalendarNoSelection()`: the stored `need_selected` × the stored preference, with the behaviour read back through `getSpecialPrompts()`; its flag | 05 `calendar_no_selection` row, 08 "Interaction points" |
| `10-sequence-upgrade` | **the sequence** on a 5.0.x profile: the upgrade end to end, then a second and a third start (nothing written, `storage.sync` never touched) | all of the above |
| `11-sequence-failure` | the sequence when storage fails: the copy failing (the guarded migrations skipped), `storage.sync` unreadable at every call, every write after the copy failing. Each time the sequence completes (the add-on starts), nothing is lost, and the next starts end where clean starts end | 05 "Overview" / 02 (the one-shot flags) |
| `12-sequence-partial` | the sequence from partial states: the oldest (pre-#129) profile over three starts, a payload in both areas, and **Thunderbird closing at each storage write of the first start in turn**, followed by normal starts | 05 "Overview", 01, 02 |
| `20-captured` | the sequence on every real `storage.sync` dump of `fixtures/migration/captured/` | as `10` |
| `99-harness-known-issues` | the shape of `helpers/known-issues/migration.mjs` | harness |
| `99-harness-sequence` | the statement splitter, the cut, the injected faults and the fresh contexts | harness |

Helpers, named without the test suffix so the level-1 glob never runs them:

- `sequence.mjs`: cuts the sequence out of `mzta-background.js` (see below);
- `context.mjs`: `startup()`, one Thunderbird start in a fresh context;
- `expect.mjs`: what the spec says storage must hold afterwards (`expectedPrefs()`,
  `PAYLOAD_KEYS`, `MARKER`, the `enabled` → `show_in` rule), and the profile fixtures;
- `captures.mjs`: reads the captured dumps, checks that their secrets are fakes.

Fixtures (`fixtures/migration/`): `profile-5.0.json` (what 5.1.0 finds on a 5.0.x profile: the
preferences and one-shot flags in sync, the payloads with a custom menu order and custom `show_in` in
local), `profile-pre-129.json` (everything in sync, `enabled` still on the prompts, no flag set), and
`captured/`.

## How the sequence is cut and run

The order of the migrations and the guards between them (`_prefs_migration_ok`, `isSyncDrained()`)
live at the **top level of `mzta-background.js`**, which cannot be imported. The tests never write
that order themselves, because they would then test the copy. Instead, `sequence.mjs`:

1. splits the top level of the file into statements, on the core tokenizer (`segments()` /
   `stripComments()` of `helpers/core/background-source.mjs`), so nothing inside a comment, a string
   or a regex literal counts. A statement ends at a top-level `;`, or, for a block statement
   (`if`, `function`, `try`…), at its closing brace when no `else` / `catch` / `finally` follows;
2. picks the statements that reference a name the file imports from a migration module (a path
   containing `migration`) or named `migrate<Something>`, then, to a fixed point, the statements
   that reference a name those declare (`const _prefs_migration_ok`), so a guarded call is picked
   wherever it is. It also picks the policy load, `mztaManaged.loadManaged()`: spec 08 places it
   after the migration block, and `migrateMenuOrderAlphabetic()`, which runs after it, reads prompt
   views that await it. With no policy it changes nothing;
3. compiles them **verbatim, in file order**, as the body of one async function whose free names
   are resolved from the file's own `import` statements and imported, in the worker, from the real
   modules.

Today the cut is seven statements: the migration block near the top (the copy, the
`isSyncDrained()`-guarded #129 pair, the three `_prefs_migration_ok`-guarded migrations), the policy
load, and the guarded `migrateMenuOrderAlphabetic()` just before the menus are loaded. Each
migration that can reject is awaited with a `.catch()` that logs (spec 05 "Overview"); the cut runs
that too, so a failure inside one shows as a completed sequence, as in Thunderbird. A migration added, moved or re-guarded in the
file is run as it then stands. `99-harness-sequence` pins the splitter on small cases and checks that
the cut of the real file calls each migration exactly once.

What runs **between** those statements in the real file is skipped: see "What is not covered".

## Contexts

Every start runs in its own **worker thread** (`context.mjs` on `helpers/core/worker.mjs`), which
gives it its own globals and its own module cache. That is needed, not a convenience: the modules
the sequence touches keep module-level state (`_orgPromptsCache` in `js/mzta-prompts.js`, the
`_loadPromise` / `_hydratePromise` of `js/mzta-managed.js`), so a second run of the cut block in the
same process would not be a restart. `js/mzta-prefs.js` and `js/mzta-prefs-migration.js` cache
nothing that matters here (the former only its logger's debug flag). Storage is handed to a start
and back explicitly, the way it survives a restart, and nothing is ever reset by hand.

A start installs the core mock with the given `sync` / `local`, wraps `storage.local` /
`storage.sync` for the injected faults, loads the modules, runs the function or the sequence, takes
the storage snapshot, and only then performs the optional reads (through `mztaPrefs.getPrefs()` and
`getSpecialPrompts()`, after `loadManaged()`, as the background reads). The reads come after the
snapshot because `getSpecialPrompts()` may write back.

- `faults: [{area, op, nth, count}]`: the matching calls reject and have no effect.
- `crashAtWrite: n`: the nth storage write of the run and every later write reject with no effect.
  This models Thunderbird closing in the middle of a start: nothing after that point reaches
  storage. `12-sequence-partial` uses it at every write of a clean first start in turn.

The starts of a file are launched together when it loads and awaited by its tests, so they run in
parallel.

## Adding a captured dump

`20-captured` runs on every file of `fixtures/migration/captured/` whose name contains `.sync.`:

1. In Thunderbird, open the add-on's debugger console (`about:debugging` → ThunderAI → Inspect) and
   run `JSON.stringify(await browser.storage.sync.get(null), null, 2)`.
2. Paste the output into `fixtures/migration/captured/<name>.sync.txt`. Console noise after the
   object (`debugger eval code:6:11`) is tolerated: the object is read from the first `{` to the
   last `}`.
3. **Replace every API key with zeros** (any `*_api_key`, including inside prompt objects).
   `fake-secrets` fails on anything that is not empty, one character repeated, or starting with
   `fake` / `test`.
4. Optionally, add that profile's `storage.local` as `<name>.local.txt` (same command with
   `storage.local`, same scrubbing). Without one, the 5.0.x fixture's `storage.local` is used, so the
   payload checks still run.

Every preference must then read back, through the real `js/mzta-prefs.js`, with the value it had in
sync, except for the conversions the spec documents (`ollama_think` to level form, spec 04;
`calendar_no_selection` aligned to the stored calendar prompt, spec 05). Keys absent from
`prefs_default` are compared on the raw `storage.local`. Every prompt payload must be intact.

## Known issues: TODO tests

A test that fails against the shipped code is not changed to pass, and neither is the source. Its
reason goes in `helpers/known-issues/migration.mjs` and it runs as a `# TODO` until fixed, then fails
the run ("stale known issue") so the entry is removed. The shape of an entry (a file × a case id ×
a reason naming the spec section) is validated by `99-harness-known-issues`, the same rules as the
prompts area.

None today.

## What is not covered

- **What runs between the cut statements** in `mzta-background.js`: the listener registrations,
  `PREFS_INIT_KEYS`, `_reconcileFeatureFlags()` (which can switch a feature flag off at every start,
  after the migrations), `reload_pref_init()`, the startup warnings and the menu setup. They are not
  migrations; `_reconcileFeatureFlags()` is the one that can change a preference.
- **A managed policy.** Every start runs with none. The policy interactions of the migrations are
  spec 08 and belong to the managed area. Spec 08 "Why the migration is not guarded" states that a
  pre-5.0 profile not yet migrated, with a policy installed, gets the user's prior value back when
  the policy is removed. **The managed area does not test that today**; it is reported here, not
  tested.
- The per-function behaviour of `migrateEnabledToShowIn()` and `migrateMenuOrderAlphabetic()`: the
  prompts area's (`prompts/13a`, `13b`, `14`). Here they are only steps of the sequence: whether
  they run, and that the user's prompts survive them.
- The real Thunderbird storage: quota errors, the real serialisation and concurrency. The core mock
  is atomic per `set()`, as Thunderbird's storage is believed to be.
- The organization prompts in `migrateMenuOrderAlphabetic()` (spec 08a, the managed area).

## Under-specified

Where the spec says nothing, the behaviour is listed here, not pinned by a test:

- **A stored calendar prompt with no `need_selected` field.** Which behaviour it had before the
  upgrade, and so what the alignment should give, is not stated.
- **The fields the alphabetic migration adds.** `migrateMenuOrderAlphabetic()` saves the prompts from
  the normalized view, so a custom prompt gains fields at their defaults (`api_type: ''`,
  `use_diff_viewer: '0'`…). No stored value changes, and `12-sequence-partial` checks exactly that.
  Whether the stored shape may grow is not stated.
- **"The first statement".** Spec 01 calls `migratePrefsToLocal()` "the first statement of
  `mzta-background.js`". Two listener registrations come before it; it is the first `await` and the
  first storage access, which is what the spec's reason needs.
