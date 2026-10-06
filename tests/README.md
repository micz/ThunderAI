# Tests

Automated tests for ThunderAI. Today they cover the enterprise managed configuration
([`managed/README.md`](managed/README.md)), the static consistency of the locales and the
preferences ([`static/README.md`](static/README.md)), the prompt and placeholder systems
([`prompts/README.md`](prompts/README.md)), the API integrations ([`api/README.md`](api/README.md)), and what the settings pages do with no policy ([`ui/README.md`](ui/README.md), the options page, the six feature settings pages, the three prompt management pages, the setup wizard, the welcome page and the popup); the infrastructure is built to extend to the whole
add-on, one **area** at a time. Each area adds its own files - tests, fixtures, a plugin, its
known issues - and never edits the shared ones.

The contract a test checks is the spec in [`claude-spec/`](../claude-spec/): each test file
names the spec section it covers.

There are two levels:

| Level | Where | What it loads | Needs |
|---|---|---|---|
| **1** | `tests/<area>/*.test.mjs` (today `tests/managed/`, `tests/static/`, `tests/prompts/`, `tests/api/`, `tests/ui/`) | the shipped modules, imported as they are | Node 22+, **nothing to install** |
| **DOM** | `tests/dom/<page>/*.dom.mjs` | each page's real HTML and script, in [jsdom](https://github.com/jsdom/jsdom) | Node `^22.22.2 \|\| ^24.15.0 \|\| >=26`, `npm ci` |

Both use only Node's built-in runner (`node:test`, `node:assert/strict`). jsdom is the
project's **only** dependency, a dev dependency pinned to an exact version in the root
`package.json`; no shipped code imports anything from `node_modules`. The different suffix
(`.dom.mjs`) is what keeps the level-1 glob from ever picking up a DOM test, and no file a
`.test.mjs` imports, directly or not, may import jsdom: level 1 must keep running with nothing
installed.

## Running

```sh
node --test "tests/**/*.test.mjs"     # level 1 only: no install

npm ci                                # once: installs jsdom from package-lock.json
npm test                              # both levels
npm run test:dom                      # DOM tests only
```

Run it from the repository root. Level 1 needs **Node 22 or later**, the oldest release CI
runs it on (22 and 24). The hard floor is Node 21, the first whose runner expands the quoted
glob itself - an older Node reports `Could not find '...\tests\**\*.test.mjs'` - but 21 is out
of support and never tested. The DOM tests need what jsdom 30.1.1 needs, `^22.22.2 || ^24.15.0
|| >=26.0.0`, which is also `engines.node` in `package.json`: `npm ci` warns on another Node
(`npm config set engine-strict true` makes it refuse). Don't run a bare `node --test` either: its
default discovery also picks up `js/mzta-connection-test.js`, which is shipped code, not a
test.

- One file: `node --test tests/managed/03-write-guard.test.mjs`, or
  `node --test tests/dom/options/02-sweep-locked.dom.mjs`
- To see the modules' console output (it is captured and hidden by default), set
  `TEST_VERBOSE=1`.

CI runs on demand, never on every commit
([`.github/workflows/tests.yml`](../.github/workflows/tests.yml), Node 22 and 24): by hand
(Actions → Tests → Run workflow, or `gh workflow run tests.yml --ref <branch>`, on any
branch), or by adding the `run-tests` label to a pull request. The label is removed when
the run ends, so adding it again runs the suite again (except on a pull request from a fork,
whose token is read-only: there the label stays, and only that step is allowed to fail). Level 1 runs first, **before**
installing anything (which proves it still needs no install), then `npm ci && npm test`.

Nothing waits forever: node:test has no default timeout, so `npm test`, `npm run test:dom` and
the CI level-1 step pass `--test-timeout=120000` (per test), the CI job has `timeout-minutes: 20`,
and the worker threads (`helpers/core/worker.mjs`, used by `helpers/restart.mjs` and
`helpers/dom-probe.mjs`) reject when they exit without an answer or give none within their own
timeout (`99-harness-workers`).

Nothing here is packaged: `create_xpi_from_folder.bat`, the packaging script shared by the
add-ons (outside this repository), must exclude the root `tests\` folder, `package.json`,
`package-lock.json` and `node_modules\` (`-x!tests -x!package.json -x!package-lock.json
-x!node_modules`).

## The rule: tests are written from the spec

Write the assertions **from the spec, not from the implementation**. If a test fails, do not
change the source to make it pass, and do not bend the test to the code: the failure is a
potential bug, so report it together with the spec section it contradicts, and run it as a
known issue until it is fixed (see [Known issues](#known-issues-todo-tests)). Never modify
shipped code just to make it testable: the harness adapts to the code, not the other way round.

## Layout

```
package.json, package-lock.json  development tooling only: jsdom, and the npm test scripts
tests/
├── helpers/
│   ├── core/                   generic: never imports js/mzta-managed.js, never names an area
│   │   ├── load.mjs            REPO, repoPath, captureConsole, loadFixture(), loadModules(),
│   │   │                       startBackground(), startPage()
│   │   ├── plugins.mjs         plugin discovery and the plugin contract
│   │   ├── browser-mock.mjs    in-memory WebExtension API (one mock = one extension context)
│   │   ├── background-source.mjs  real background code cut out of mzta-background.js: the
│   │   │                       tokenizer, locateListener(), evalListener()
│   │   ├── worker.mjs          a fresh extension context in a worker thread (runWorker())
│   │   ├── known-issues.mjs    the known-issue mechanism: knownTest(), runKnown()
│   │   └── dom-harness.mjs     DOM harness: openPage(), the strict browser proxy, settle()
│   │                           (the only core file that imports jsdom)
│   ├── plugins/<area>.mjs      an area's hooks into the core (today: managed.mjs)
│   ├── known-issues/<area>.mjs an area's known issues and their shape (today: managed.mjs,
│   │                           static.mjs, prompts.mjs, api.mjs, ui.mjs)
│   │
│   └── *.mjs                   the managed layer: load.mjs, dom-page.mjs, browser-mock.mjs,
│                               dom-known-issues.mjs re-export the core with the managed
│                               additions; the rest are managed helpers (managed/README.md)
├── fixtures/                   managed fixtures; another area's go in fixtures/<area>/
├── managed/                    level 1 of the managed configuration, and its README
├── static/                     level 1 of the static consistency checks, and its README
├── prompts/                    level 1 of the prompt and placeholder systems, and its README
├── api/                        level 1 of the API integrations, and its README
├── ui/                         the ui area (its DOM files are dom/<page>/ui-*): README, helpers, level-1 harness test
├── <area>/                     level 1 of another area
└── dom/<page>/                 DOM: one file per page × scenario, shared by every area
```

## Conventions for a new area

So that two branches extending the suite never create or edit the same file:

- **Level 1:** `tests/managed/` stays as it is; another area goes in `tests/<area>/*.test.mjs`.
- **DOM:** `tests/dom/<page>/` is shared. A file from another area carries the area as a
  prefix in its name (`<area>-NN-<scenario>.dom.mjs`, e.g. `core-01-open.dom.mjs`), so its
  name can never collide with the managed files (`NN-<scenario>.dom.mjs`) or another area's.
- **Fixtures:** the managed fixtures stay in `tests/fixtures/`; another area's go in
  `tests/fixtures/<area>/`, read with `loadFixture(name, '<area>')`.
- **Plugins:** `tests/helpers/plugins/<area>.mjs`, when the area needs modules, background
  state or background answers the core does not have.
- **Known issues:** `tests/helpers/known-issues/<area>.mjs`.

A test of the core itself (one that needs no area) imports only `helpers/core/`, and keeps
working whichever plugins exist.

## Contexts

The modules under test keep module-level state (singletons that read their configuration
once), just like the add-on. So a test file is **one extension context with one scenario**,
and `node --test` runs each file in its own process, which gives each a fresh set of modules.
A test that needs a second context gets it from a separate module instance in the same
process (a page's background, see the plugins) or from a worker thread
(`helpers/core/worker.mjs`), never from resetting a singleton.

## The mock

`installBrowserMock(opts)` (`helpers/core/browser-mock.mjs`) must run **before** the modules are
imported, because `js/mzta-prefs.js` reads `browser.storage.local` at import time. That is why
the tests load modules with a dynamic `import()` (`loadModules()`, `startBackground()`,
`startPage()`) and never with a static one.

It models the WebExtension APIs the shipped modules use:

- `storage.local` / `storage.sync` / `storage.session` with the real `get()` semantics:
  `get({key: default})` substitutes a default only for a **missing** key, so a stored
  `null` comes back as `null`. Values are structured-cloned in and out, and `set()` fires
  `storage.onChanged`. Each area starts with the content of the option of the same name
  (`local`, `sync`, `session`; `openPage()` takes `local` and `session`);
- `storage.managed.get()`, resolving to the `policy` option and **rejecting** when there is
  none (`policy: null`), as Thunderbird does;
- `runtime.sendMessage` (to the `remote` you pass, else rejecting with "Receiving end does
  not exist"; the two-argument form `sendMessage(extensionId, message)`, to another add-on,
  goes to `external`), `runtime.onMessage`, `runtime.getURL`;
- `i18n.getMessage`, backed by the real `_locales/en/messages.json`;
- `accounts.list`, from the accounts you pass (`setAccounts()`, `failAccounts()`).

The controller it returns records every storage call (`calls`) and every message sent
(`sent`), and gives the raw storage content (`localData()`).

## The loader

`helpers/core/load.mjs`:

- `loadModules()` imports the modules every branch has: `js/mzta-prefs.js`,
  `js/mzta-prompts.js`, `js/mzta-utils.js`, `options/mzta-options-default.js`
  (`mztaPrefs`, `prompts`, `utils`, `prefs_default`, `defaults`);
- `startBackground(mockOpts)`: a background context. Mock, console capture, modules, then
  each plugin's background startup;
- `startPage({policy, local, session, accounts, sender, remote, onOtherMessage, external, decorate})`:
  a non-background page, with its background started by the plugins in the same process;
- `loadFixture(name, dir = '')` reads `tests/fixtures/[<dir>/]<name>`; `captureConsole()`,
  `repoPath()`, `REPO`.

The ctx they return holds `ctl` (the mock controller), `con` (captured console: `warnings()`,
`entries`, `clear()`), the modules, and whatever the plugins add.

## Plugins

A plugin is how an area hooks into the core loader and the DOM harness without the core
naming it: a file `tests/helpers/plugins/<area>.mjs` whose default export is an object of
optional hooks. The core imports every such file, in alphabetical order of file name, the first
time it starts a context; a missing or empty directory means no plugins, and the core then runs
the shipped modules alone (that is what lets it run on a branch where an area does not exist).
The contract, also documented in `helpers/core/plugins.mjs`:

| Hook | When | What for |
|---|---|---|
| `name` | - | the plugin's name in error messages (default: the file name) |
| `extendMock(browser, {context, opts})` | right after the mock is installed, before the caller's `decorate` and before any module is imported; `context` is `'background'` or `'page'` | new `browser.*` APIs |
| `modules(imp)` → object | after the core modules | the area's own modules, added to `mods` and the ctx |
| `startBackground(ctx)` → fields? | a background context, once the modules are loaded | the area's background state |
| `remoteBackground({browser, ctl, imp})` → `{start(mods)}` | a page context, **before** the page's modules are imported; `start(mods)` after them, resolving to `{fields, listeners, commands}` | the page's background: `fields` are added to the ctx, `listeners` / `commands` answer the page's messages |
| `pages` (object) | DOM harness, merged into `PAGES` when the harness loads | the area's own pages, `{name: HTML path}`; a name already defined (by the core or another plugin) is an error |
| `pageApis(browser, opts)` | DOM harness, after the core page-side APIs, before the strict proxy | page-side APIs |
| `pageCommands(mods)` → map | DOM harness, after the core default commands | fixed answers to background commands |

The order in `startPage()`: mock → `extendMock` → `decorate` → console capture →
`remoteBackground` → the page's modules (`loadModules()` + `modules`) → `start(mods)` →
`con.clear()`.

A page's `runtime.sendMessage` is answered (unless `startPage({remote})` replaces it all) by:

1. the plugins' `listeners`, in plugin order: the first that returns neither `false` nor
   `undefined` answers (WebExtension semantics);
2. the plugins' `commands` maps, in plugin order. Two plugins answering the same command is an
   error at start, never a silent shadowing;
3. the caller's `onOtherMessage(message, sender, fields)`, else `undefined`. In the DOM harness
   that is the core `defaultCommands()`, then each plugin's `pageCommands()`, then
   `opts.commands`, later entries overriding earlier ones; anything else is a violation.

## The DOM tests

### How a page is loaded

jsdom does not execute `<script type="module">`, so `openPage(page, opts)` in
`helpers/core/dom-harness.mjs` (re-exported by `helpers/dom-page.mjs`) does what the browser
does, in the browser's order:

1. parses the page's **real HTML file** at its `moz-extension://` URL;
2. exposes the jsdom window's globals (`window`, `document`, `navigator`, `Event` and the
   other event classes, `HTMLElement` and friends, `DOMParser`, `XPathResult`, `Option`…) on
   `globalThis`, where the page's module code looks them up. The list is explicit: copying
   the whole window would shadow Node's own `URL`, timers and so on;
3. installs the browser mock through `startPage()`, extended with the page-side APIs
   (`permissions`, `tabs`, `windows`, `commands`, `downloads`, `runtime.getPlatformInfo` /
   `openOptionsPage`, then the plugins' `pageApis()`) and **wrapped in a Proxy that throws on
   any API it does not model**;
4. runs the page's **classic** scripts in document order with `vm.runInThisContext`
   (`js/mzta-i18n.js` → `i18n`, `pages/_lib/list.js` → `List`): classic scripts run during
   parsing, before the deferred module;
5. `import()`s the page's own module script;
6. dispatches `DOMContentLoaded` and `await`s `settle()`.

`settle()` does not sleep for a fixed time: it turns the event loop until three consecutive
turns pass with no browser-mock promise in flight, no pending `setTimeout` (both realms'
timers are tracked; ones longer than 1 s are not waited for) and no DOM mutation. It throws
"did not settle", naming what is pending, after 30 s (a safety net: the time includes the page's whole init, which a loaded machine stretches). `ctx.fire(el, type)` and
`ctx.click(el)` settle after the event too.

Every file ends with `assertHarnessClean(ctx)`: no unmocked API or background command was
touched, no promise rejection went unhandled, jsdom reported no error. The Proxy **records**
before it throws, because page code often wraps browser calls in `try`/`catch`: a swallowed
"unmocked API" still fails that test. So a page the harness cannot run shows up as a
failure with the reason, never as fewer tests passing.

`ctx` holds `window`, `document`, `$`/`$$`, `fire()`, `click()`, `settle()`, `ctl` (the mock
controller: `localData()`, `calls`, `sent`), `con`, `mods` (the page's own modules),
`apiCalls(api)`, `fetchCalls`, `dialogs`, `localWrites(since)` and the plugins' remote fields.
The page is opened at the top level, with `await`, because node:test must know the generated
tests before it runs them.

### Where the background's answers come from

- the real background code wherever it can run without starting `mzta-background.js`: a
  plugin cuts its listener out of the file and runs it verbatim. The code is cut out by
  `segments()` in `helpers/core/background-source.mjs`, a small tokenizer that knows strings,
  template literals, comments and regex literals (a quote or backtick inside a regex must not
  open a string); `tests/managed/99-harness-tokenizer` pins it down, on small cases and on the
  real files;
- `reload_menus`, `get_active_special_ids`, `popup_menu_ready`: a fixed minimal answer
  (`defaultCommands()` in `helpers/core/dom-harness.mjs`), which plugins extend and
  `opts.commands` overrides;
- anything else: a recorded violation.

### Stubs

jsdom lacks a few browser features the pages touch. They are stubbed minimally, and nothing
else is:

| Stub | Why |
|---|---|
| `fetch` | records the call and rejects: no network. The secret tests assert on it |
| `alert`, `confirm` (→ `true`), `prompt` (→ `''`), `window.close` | not implemented by jsdom; recorded in `ctx.dialogs` |
| `Element.prototype.scrollIntoView`, `window.scrollTo` | not implemented by jsdom |
| Sparks (the other add-on) | `sendMessage('thunderai-sparks@micz.it', …)` answers `null`: not installed |

The third-party libraries run for real: **Tom Select** loads itself through the page's own
`import './tom-select.base.js'` (its UMD wrapper sets `globalThis.TomSelect`), and **List.js**
is evaluated as the classic script it is.

### Adding a page

1. Add it to `CORE_PAGES` in `helpers/core/dom-harness.mjs` if every branch has it, or to the
   `pages` of the area's plugin (`helpers/plugins/<area>.mjs`) if it belongs to one area: either
   way it ends up in `PAGES`, the key `openPage()` takes.
2. Create its first file in `tests/dom/<page>/` (named after the convention above), ending
   with `assertHarnessClean(ctx)`.
3. If `assertHarnessClean()` fails with an unmocked API, model it in `addPageApis()` (or in
   the area's plugin, `pageApis()`, if only that area needs it); an unmocked background command
   goes in `defaultCommands()` / `pageCommands()` if it is not the code under test, or is cut
   out of `mzta-background.js` like the managed listener.

What a managed page needs on top of that is in [`managed/README.md`](managed/README.md#adding-a-page).

## Known issues: TODO tests

A test that fails against the shipped code is **not** changed to pass, and neither is the
source. Its reason goes in the area's `helpers/known-issues/<area>.mjs` - which spec section it
contradicts and what the code does instead - and the test runs through
`knownTest(name, reason, fn, {file})` (`helpers/core/known-issues.mjs`; an area's helper passes
its own file, as `helpers/dom-known-issues.mjs` does for managed): the assertion still executes,
and while it fails the test is printed as `# TODO` with the reason and the actual failure,
without failing the run. **Once it passes the run fails** ("stale known issue", naming the file
that holds the entry): remove the entry, so it cannot go on hiding a later regression of the
same test. The same once the maintainer rules the behaviour correct and the spec is updated.

What an entry may cover is up to the area's file, which also validates its shape: the managed
rules are in [`managed/README.md`](managed/README.md#potential-bugs-todo-tests).

## What is not covered

- The parts of `mzta-background.js` that only run inside its startup. It cannot be imported
  under a mock, because its top level awaits every startup step against the whole Thunderbird
  API, so they are covered only through the functions they call. The message handlers an area
  cuts out are the exception: they run verbatim, so moving or restructuring them means
  updating that area's locators.
- Real layout and CSS. jsdom has no layout engine: the DOM tests check **where** an element is
  inserted, not what it looks like.
- Everything outside the areas listed above is still tested by hand in Thunderbird. What the
  managed configuration leaves out is in [`managed/README.md`](managed/README.md#what-is-not-covered),
  what the static checks leave out in [`static/README.md`](static/README.md#what-is-not-covered),
  what the prompts area leaves out in [`prompts/README.md`](prompts/README.md#what-is-not-covered),
  what the api area leaves out in [`api/README.md`](api/README.md#what-is-not-covered),
  what the ui area leaves out in [`ui/README.md`](ui/README.md#what-is-not-covered).
