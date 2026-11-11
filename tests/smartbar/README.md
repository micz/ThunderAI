# Tests: SmartBar (operation registry, router, records)

Level-1 tests of the SmartBar's own modules, written from
[`claude-spec/10-smartbar.md`](../../claude-spec/10-smartbar.md): each test file names the spec sections
it covers in its opening comment. How to run the suite, the two levels, the mock and the known-issue
mechanism are in the general [`tests/README.md`](../README.md). Paths below are relative to `tests/`.

The modules under test:

- `js/mzta-smartbar-registry.js`: the eleven operations (`deliver_draft`, the three deletions, the spam check and the Sparks ones among them), their availability, the
  parameter checks, the plan of an instruction (runLast, the dependency sort) and how its lines run
  (limit, dependencies, confirmation, abort, a drafted outcome);
- `js/mzta-smartbar-router.js`: the router prompt (never the email body), the placeholder allow list,
  the context, the reading of the answer and the one correction attempt;
- `js/mzta-smartbar-execute.js`: the prompt of the compose operation (the email delimited as data,
  the fixed order of its sections), the email cut to the length limit (quoted part first), the typed
  placeholders as references, the language rule, the reading of the answer with its correction
  attempt, the signature the add-on adds, the body as HTML;
- `js/mzta-smartbar-store.js` with the `smartbar` store of `js/mzta-storage.js`: the record, its
  derived state, the caps, the non-mirrored store, the startup interruption, the three retention rules,
  a session's records and the current draft of the chat;
- `js/mzta-smartbar-chat.js`: the conversation of a chat session and the prompt of the free answer;
- what the Activity tab and the badge read: the store's `list()`, `byState()`, `remove()`,
  `removeErrors()`, `badgeCounts()`, and the Activity tab's `defaultFilter()`
  (`pages/smartbar/mzta-smartbar-activity.js`, importable at level 1: it touches the DOM only in
  its functions).

What the background does with them (routing through the special command, replacement of an
instruction, the jobs it starts) is the background area's ([`background/README.md`](../background/README.md));
the chat's flow too (`background/45-smartbar-chat`); the bar in the message pane is the compose area's
([`compose/README.md`](../compose/README.md)); the chat window in SmartBar mode is the webchat
area's (`dom/webchat/webchat-24-smartbar`); the
settings page (`pages/smartbar/`) is tested in `dom/smartbar/` (the no-policy, sweep and connection
files the managed area generates, and the ui area's files).

## Running

```sh
node --test "tests/smartbar/*.test.mjs"     # this area only, from the repository root
```

Level 1 only, no network, no real waiting. The area's plugin
([`helpers/plugins/smartbar.mjs`](../helpers/plugins/smartbar.mjs)) declares the feature page for the DOM
harness and answers, by default, the commands it sends with no test asking (an empty Activity list,
`smartbar_open_page`).

## Layout

```
tests/
├── helpers/known-issues/smartbar.mjs   the known issues, their shape (validateKnown()), and caseTests()
├── helpers/plugins/smartbar.mjs        the settings page, for openPage()
└── smartbar/
    ├── context.mjs                     smartbarContext(): the core background plus the SmartBar modules
    ├── 01-registry.test.mjs            registry, availability, params, plan, runPlanned()
    ├── 02-router.test.mjs              prompt, allow list, context, answer, correction attempt
    ├── 03-store.test.mjs               records, states, caps, the smartbar store and its cleanup
    ├── 04-router-test-set.test.mjs     claude-spec/10-smartbar-router-tests.md against the registry
    ├── 05-execute.test.mjs             the compose prompt, the email cut, the answer, the signature
    ├── 06-chat.test.mjs                the conversation of a chat session, the free answer's prompt
    ├── 07-activity.test.mjs            the Activity tab's store queries, the badge counts, the default filter
    └── 99-harness-known-issues.test.mjs   the known-issue entries themselves
```

## Writing a test

Every test is declared through `caseTests('<file stem>')` with a case id unique in its file, and each
file ends with `k.coverage()`. A failing test is a potential bug to report, never a reason to bend the
source: until it is fixed, add an entry to `helpers/known-issues/smartbar.mjs` with a reason that names
the spec section it contradicts (`spec 10 "..."`).

The store tests open the real IndexedDB code on fake-indexeddb. The database must be created by the
module before a test touches it with the raw API (`await taStorage.getStats()` at the top of the file),
or the raw open creates an empty database the module then has to replace. Running records are kept by
every bulk removal, `clear()` included: a test that needs an empty store empties it with the raw API.
