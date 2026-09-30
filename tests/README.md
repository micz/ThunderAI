# Tests

Automated tests for the enterprise managed configuration. The contract they check is
[`claude-spec/08-managed-configuration.md`](../claude-spec/08-managed-configuration.md) and its
topic files `08a-managed-prompts.md`, `08b-managed-connections.md`, `08c-managed-ui.md`: each
test file names the spec section it covers (as `spec 08 "<section>"`, whichever file holds it).

There are two levels:

| Level | Where | What it loads | Needs |
|---|---|---|---|
| **1** | `tests/managed/*.test.mjs` | the shipped modules, imported as they are | Node 21+, **nothing to install** |
| **DOM** | `tests/dom/<page>/*.dom.mjs` | each page's real HTML and script, in [jsdom](https://github.com/jsdom/jsdom) | Node 22.22+ / 24.15+, `npm ci` |

Both use only Node's built-in runner (`node:test`, `node:assert/strict`). jsdom is the
project's **only** dependency, a dev dependency pinned to an exact version in the root
`package.json`; no shipped code imports anything from `node_modules`. The different suffix
(`.dom.mjs`) is what keeps the level-1 glob from ever picking up a DOM test.

## Running

```sh
node --test "tests/**/*.test.mjs"     # level 1 only: no install

npm ci                                # once: installs jsdom from package-lock.json
npm test                              # both levels
npm run test:dom                      # DOM tests only
```

Run it from the repository root. Level 1 needs **Node 21 or later** (22/24 LTS
recommended), because the runner expands the quoted glob itself only from Node 21 on. An
older Node reports `Could not find '...\tests\**\*.test.mjs'`: upgrade it. The DOM tests need
what jsdom 30 needs: Node 22.22+ or 24.15+. Don't run a bare `node --test` either: its
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
and the worker threads of `helpers/restart.mjs` / `helpers/dom-probe.mjs` reject when they exit
without an answer or give none within their own timeout (`99-harness-workers`).

Nothing here is packaged: `create_xpi_from_folder.bat`, the packaging script shared by the
add-ons (outside this repository), must exclude the root `tests\` folder, `package.json`,
`package-lock.json` and `node_modules\` (`-x!tests -x!package.json -x!package-lock.json
-x!node_modules`).

## Layout

```
package.json, package-lock.json  development tooling only: jsdom, and the npm test scripts
tests/
├── helpers/
│   ├── browser-mock.mjs        in-memory WebExtension API (one mock = one extension context)
│   ├── load.mjs                module loader, console capture, fixtures, startBackground(), startPage()
│   ├── background-handler.mjs  real background code cut out of mzta-background.js: the
│   │                           get_managed_values listener
│   ├── restart.mjs             "restart Thunderbird": run a scenario in a fresh worker thread
│   ├── feature-pages.mjs       the feature pages with a specific-integration panel, by prefix
│   │                           (no jsdom: level 1 checks it against special_prompts_with_integration)
│   │
│   ├── dom-page.mjs            DOM harness: openPage(), the strict browser proxy, settle()
│   ├── dom-probe.mjs           a page (or the allowlist) probed in a fresh worker thread
│   ├── dom-sweep.mjs           the allowlist sweep: lockedSweep(), unlockedSweep()
│   ├── dom-known-issues.mjs    potential bugs found by the DOM tests, run as TODOs
│   └── dom-*.mjs               one shared scenario each (no policy, secrets, locked model,
│                               enforced prompt texts, account selector, banner, policy
│                               connection)
├── fixtures/                   one policy per scenario (what storage.managed.get() returns)
├── managed/                    level 1: one file per policy scenario, numbered after the spec
└── dom/<page>/                 DOM: one file per page × policy scenario
```

## Why one file per scenario

`mztaManaged` is a module singleton. It reads the policy once, at `loadManaged()`, or hydrates
once in a page, and never again, just like the add-on. So a file is **one extension context
with one policy**. `node --test` runs each file in its own process, which gives each
scenario a fresh singleton. The DOM tests follow the same rule: a file is one page opened
under one policy, since the page's own modules (`managed-ui.js`, `connection-ui.js`) cache
their state too.

Two helpers work around that limit where a test needs a second context:

- `startPage()` loads a second, independent copy of `js/mzta-managed.js` (imported with a
  query string) as the **background**. The page talks to it only through
  `runtime.sendMessage`, answered by the real listener from `mzta-background.js`.
- `restart(mockOpts, scenario, args)` runs a named scenario from `helpers/restart.mjs` in a
  worker thread, with its own module graph and the storage you hand it. Use it to check
  what is left once the policy is removed ("no residue", "the user's text comes back").
  `helpers/dom-probe.mjs` does the same for a whole page.

## The mock

`installBrowserMock(opts)` must run **before** the modules are imported, because
`js/mzta-prefs.js` reads `browser.storage.local` at import time. That is why the tests load
modules with a dynamic `import()` (`loadModules()`, `startBackground()`, `startPage()`) and
never with a static one.

It models what the managed configuration depends on:

- `storage.local` / `storage.sync` / `storage.session` with the real `get()` semantics:
  `get({key: default})` substitutes a default only for a **missing** key, so a stored
  `null` comes back as `null`. Values are structured-cloned in and out, and `set()` fires
  `storage.onChanged`;
- `storage.managed.get()`, which **rejects** when no policy is set (`policy: null`), as
  Thunderbird does;
- `runtime.sendMessage` (to the `remote` you pass, else rejecting with "Receiving end does
  not exist"; the two-argument form `sendMessage(extensionId, message)`, to another add-on,
  goes to `external`), `runtime.onMessage`, `runtime.getURL`;
- `i18n.getMessage`, backed by the real `_locales/en/messages.json`;
- `accounts.list`, from the accounts you pass (`setAccounts()`, `failAccounts()`).

The controller it returns records every storage call (`calls`) and every message sent
(`sent`), and gives the raw storage content (`localData()`).

## Adding a scenario

1. Put the policy in `tests/fixtures/<name>.json`, exactly as it would appear under
   `3rdparty → Extensions → thunderai@micz.it` in `policies.json`. A policy that has to follow
   `prefs_default` can be a `.mjs` builder instead (see `every-pref-key.mjs`).
2. Create `tests/managed/NN-<name>.test.mjs`. Start it with a comment quoting the spec
   section it checks, then set it up in `before()`:

   ```js
   import { test, before } from 'node:test';
   import assert from 'node:assert/strict';
   import { startBackground, loadFixture } from '../helpers/load.mjs';

   let ctx;
   before(async () => {
       ctx = await startBackground({ policy: loadFixture('<name>.json'), local: { /* storage */ } });
   });

   test('what the spec says happens', async () => {
       assert.equal(await ctx.mztaPrefs.getPref('connection_type'), 'chatgpt_api');
   });
   ```

   `ctx` holds `ctl` (the mock controller), `con` (captured console: `warnings()`,
   `entries`, `clear()`), `mztaManaged`, `mztaPrefs`, `prompts`, `utils`, `prefs_default` and
   `MANAGED_SECRET_MARKER`. For a settings page or the chat window use
   `startPage({ policy, local, sender: SENDERS.options })` instead.
3. Write the assertions **from the spec, not from the implementation**. If a test fails,
   do not change the source to make it pass: the failure is a potential bug, so report it
   together with the spec section it contradicts (see [Potential bugs](#potential-bugs-todo-tests)).
4. Name any new scenario that needs a fresh context in `SCENARIOS` in `helpers/restart.mjs`.

## The DOM tests

### How a page is loaded

jsdom does not execute `<script type="module">`, so `openPage(page, opts)` in
`helpers/dom-page.mjs` does what the browser does, in the browser's order:

1. parses the page's **real HTML file** at its `moz-extension://` URL;
2. exposes the jsdom window's globals (`window`, `document`, `navigator`, `Event` and the
   other event classes, `HTMLElement` and friends, `DOMParser`, `XPathResult`, `Option`…) on
   `globalThis`, where the page's module code looks them up. The list is explicit: copying
   the whole window would shadow Node's own `URL`, timers and so on;
3. installs the browser mock through `startPage()`, extended with the page-side APIs
   (`permissions`, `tabs`, `windows`, `commands`, `downloads`, `runtime.getPlatformInfo` /
   `openOptionsPage`) and **wrapped in a Proxy that throws on any API it does not model**;
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

### Where the background's answers come from

- the code is cut out by `segments()` in `helpers/background-handler.mjs`, a small tokenizer
  that knows strings, template literals, comments and regex literals (a quote or backtick inside
  a regex must not open a string); `tests/managed/99-harness-tokenizer` pins it down, on small
  cases and on the real files;
- `get_managed_values`: the real listener, as in level 1, evaluated against the background
  instance of `mztaManaged`. It is the only channel a page gets the policy through (values,
  locks, org prompts, restrictions, banner state), so the page hydrates, and sees exactly the
  state, it would in Thunderbird;
- `reload_menus`, `get_active_special_ids`, `popup_menu_ready`: a fixed minimal answer
  (`defaultCommands()` in `dom-page.mjs`), overridable with `opts.commands`. These are not
  managed-configuration code;
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

### The allowlist sweep

`02-sweep-locked` and `03-sweep-unlocked`, on every page with managed controls, are generated,
not written by hand (`helpers/dom-sweep.mjs`):

1. the allowlist comes from the real `js/mzta-managed.js` (every-key policy, `loadManaged()`,
   `hasManagedValue()`), in a worker;
2. the page is probed unmanaged, in a worker: every `.option-input` / `[data-mzta-pref]`
   control whose key is on the allowlist is a case;
3. `sweepValues()` gives each case a policy value and a different stored user value, both
   valid for the control (select options, number ranges) and for the `prefs_default` type;
4. the page is probed again, unmanaged, with the user values stored: the **baseline**;
5. the page is opened under the policy (all cases locked, or all `":locked": false`) and one
   `test()` per key and aspect is declared.

A new preference with a control on a swept page is therefore covered the moment it exists.

The policy-connection scenarios (`13-connection-enforced`, `14-connection-unlocked`, spec 08
"Enforced per-feature connections") are generated the same way, from the feature list
rather than the allowlist. Every page in `helpers/feature-pages.mjs` has the two three-line
files calling `connectionScenario(page, mode)` (`helpers/dom-connection.mjs`).
`tests/managed/10h` fails when that map no longer matches `special_prompts_with_integration`,
or when a page lacks either file. A new feature therefore needs an entry there and the two
files (copy another page's). The same map generates `15-text-save-keeps-connection`
(`helpers/dom-text-save.mjs`, no policy): a text Save must not revert a connection change the
panel saved after page open. So does `16-mandatory-connection-blank`
(`helpers/dom-mandatory-blank.mjs`, no policy): with a ChatGPT Web global connection the
mandatory integration opens with a blank connection type and stores nothing until the user
chooses. And `17-locked-on-switch` (`helpers/dom-locked-on-switch.mjs`): with
`{prefix}_use_specific_integration` locked on and no policy connection, the switch shows the
managed marker and not the mandatory badge, and turned off by hand it goes back on and clears
nothing. `10h` requires all of them.

When the spec derives what a locked control shows from the *other* locked keys rather than
from its own policy value, the sweep file passes `expected: {key: {value, why}}` to
`lockedSweep()`, and that value is asserted instead (today only `summarize_display_mode`, which
the policy loader resolves to `'inline'` because the sweep locks `summarize_auto` to 3). It is a spec rule, not a known bug: those go in
`dom-known-issues.mjs`.

### Adding a page

1. Add it to `PAGES` in `helpers/dom-page.mjs`.
2. Create `tests/dom/<page>/01-no-policy.dom.mjs` with `noPolicyScenario()`, and, for a page
   with managed controls, the two sweep files (copy an existing pair: they are three lines).
3. If `assertHarnessClean()` fails with an unmocked API, model it in `addPageApis()`; an
   unmocked background command goes in `defaultCommands()` (if it is not managed code) or is
   cut out of `mzta-background.js` like the managed ones.

### Adding a DOM scenario

Create `tests/dom/<page>/NN-<name>.dom.mjs`, starting with a comment quoting the spec section:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';

const ctx = await openPage('options', { policy: { default_sign_name: 'ACME' }, local: {} });
after(() => ctx.close());

test('what the spec says happens', () => {
    assert.equal(ctx.$('#default_sign_name').disabled, true);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
```

`ctx` holds `window`, `document`, `$`/`$$`, `fire()`, `click()`, `settle()`, `ctl` (the mock
controller: `localData()`, `calls`, `sent`), `con`, `mods` (the page's own `mztaManaged`,
`mztaPrefs`, …), `apiCalls(api)`, `fetchCalls`, `dialogs` and `localWrites(since)`. The page is
opened at the top level, with `await`, because node:test must know the generated tests before
it runs them.

## Potential bugs: TODO tests

A test that fails against the shipped code is **not** changed to pass, and neither is the
source. Its reason goes in `helpers/dom-known-issues.mjs` - which spec section it contradicts
and what the code does instead - and the test runs through `knownTest(name, reason, fn)`:
the assertion still executes, and while it fails the test is printed as `# TODO` with the
reason and the actual failure, without failing the run. **Once it passes the run fails**
("stale known issue"): remove the entry, so it cannot go on hiding a later regression of the
same test. The same once the maintainer rules the behaviour correct and the spec is updated.

What an entry may cover is limited (`validateKnown()`, checked by `99-harness-known-issues`): a
per-key sweep aspect names its key - there is no `'*'` fallback that would hide a whole page -,
`'*'` is only for the page-wide `writes` test, and the harness check ("the page ran on modelled
APIs only") is never a known issue.

## What is not covered

- The parts of `mzta-background.js` that only run inside its startup: the startup warnings
  and `processEmails()`. It cannot be imported under a mock, because its top level awaits every
  startup step against the whole Thunderbird API, so they are covered only through the
  functions they call. The managed-configuration message handlers are the exception (see
  above): they are cut out and run verbatim, so moving or restructuring them means updating
  the locators in `helpers/background-handler.mjs`.
- Real layout and CSS. jsdom has no layout engine: the DOM tests check **where** a marker is
  inserted, not the flex overrides in `mzta-design.css` that make it look right, and not what
  a disabled control looks like.
- The API chat window (`api_webchat/`) as a page: its hydration is level 1 (`05b`; `10g` for a
  policy connection).
