# Tests

Automated tests for the enterprise managed configuration. The contract they check is
[`claude-spec/08-managed-configuration.md`](../claude-spec/08-managed-configuration.md): each
test file names the spec section it covers.

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

CI runs on every push and pull request
([`.github/workflows/tests.yml`](../.github/workflows/tests.yml), Node 22 and 24): level 1
first, **before** installing anything (which proves it still needs no install), then
`npm ci && npm test`.

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
│   │                           get_managed_values listener, the get_managed_state /
│   │                           get_org_prompts cases
│   ├── restart.mjs             "restart Thunderbird": run a scenario in a fresh worker thread
│   │
│   ├── dom-page.mjs            DOM harness: openPage(), the strict browser proxy, settle()
│   ├── dom-probe.mjs           a page (or the allowlist) probed in a fresh worker thread
│   ├── dom-sweep.mjs           the allowlist sweep: lockedSweep(), unlockedSweep()
│   ├── dom-known-issues.mjs    potential bugs found by the DOM tests, run as TODOs
│   └── dom-*.mjs               one shared scenario each (no policy, secrets, locked model,
│                               enforced prompt texts, account selector, banner)
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
"did not settle", naming what is pending, after 5 s. `ctx.fire(el, type)` and
`ctx.click(el)` settle after the event too.

Every file ends with `assertHarnessClean(ctx)`: no unmocked API or background command was
touched, no promise rejection went unhandled, jsdom reported no error. The Proxy **records**
before it throws, because page code often wraps browser calls in `try`/`catch`: a swallowed
"unmocked API" still fails that test. So a page the harness cannot run shows up as a
failure with the reason, never as fewer tests passing.

### Where the background's answers come from

- `get_managed_values`: the real listener, as in level 1;
- `get_managed_state` and `get_org_prompts`: the real `case`s of the main background listener,
  cut out by `extractBackgroundCase()` in `helpers/background-handler.mjs` and evaluated
  against the background instance of `mztaManaged` - so the page hydrates, and sees exactly
  the state, it would in Thunderbird. If one of those cases is restructured (no longer a bare
  `return Promise.resolve(...)`), the locator throws: update it, not the tests;
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
and what the code does instead - and the test runs with `{ todo: reason }`: node:test still
executes the assertion and prints it as `# TODO`, without failing the run. Remove the entry
once the code is fixed (node:test reports a passing TODO as well), or once the maintainer
rules the behaviour correct and the spec is updated.

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
- The API chat window (`api_webchat/`) as a page: its hydration is level 1 (`05b`).
