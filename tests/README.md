# Tests

Automated tests for the enterprise managed configuration. The contract they check is
[`claude-spec/08-managed-configuration.md`](../claude-spec/08-managed-configuration.md): each
test file names the spec section it covers.

No dependencies, no `package.json`, no build step: only Node's built-in runner
(`node:test`, `node:assert/strict`) and the shipped modules, imported as they are.

## Running

```sh
node --test "tests/**/*.test.mjs"
```

Run it from the repository root. It needs **Node 21 or later** (22/24 LTS recommended),
because the runner expands the quoted glob itself only from Node 21 on. An older Node
reports `Could not find '...\tests\**\*.test.mjs'`: upgrade it. Don't run a bare
`node --test` either: its default discovery also picks up `js/mzta-connection-test.js`,
which is shipped code, not a test.

- One file: `node --test tests/managed/03-write-guard.test.mjs`
- To see the modules' console output (it is captured and hidden by default), set
  `TEST_VERBOSE=1`.

CI runs the suite on every push and pull request
([`.github/workflows/tests.yml`](../.github/workflows/tests.yml), Node 22 and 24).

The folder is never packaged: `create_xpi_from_folder.bat`, the packaging script shared by
the add-ons (outside this repository), excludes the root `tests\` folder with `-x!tests`.

## Layout

```
tests/
├── helpers/
│   ├── browser-mock.mjs        in-memory WebExtension API (one mock = one extension context)
│   ├── load.mjs                module loader, console capture, fixtures, startBackground(), startPage()
│   ├── background-handler.mjs  the real get_managed_values listener, cut out of mzta-background.js
│   └── restart.mjs             "restart Thunderbird": run a scenario in a fresh worker thread
├── fixtures/                   one policy per scenario (what storage.managed.get() returns)
└── managed/                    one file per policy scenario, numbered after the spec checklist
```

## Why one file per scenario

`mztaManaged` is a module singleton. It reads the policy once, at `loadManaged()`, or hydrates
once in a page, and never again, just like the add-on. So a file is **one extension context
with one policy**. `node --test` runs each file in its own process, which gives each
scenario a fresh singleton.

Two helpers work around that limit where a test needs a second context:

- `startPage()` loads a second, independent copy of `js/mzta-managed.js` (imported with a
  query string) as the **background**. The page talks to it only through
  `runtime.sendMessage`, answered by the real listener from `mzta-background.js`.
- `restart(mockOpts, scenario, args)` runs a named scenario from `helpers/restart.mjs` in a
  worker thread, with its own module graph and the storage you hand it. Use it to check
  what is left once the policy is removed ("no residue", "the user's text comes back").

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
  not exist"), `runtime.onMessage`, `runtime.getURL`;
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
   together with the spec section it contradicts.
4. Name any new scenario that needs a fresh context in `SCENARIOS` in `helpers/restart.mjs`.

## What is not covered

The DOM side: `pages/_lib/managed-ui.js`, `pages/_lib/connection-ui.js` and the pages that
use them (disabled controls, markers, padlocks, the setup wizard blocking itself). The same
goes for the rest of `mzta-background.js`: it cannot be imported under a mock, because its
top level awaits every startup step against the whole Thunderbird API. So the startup
warnings, `get_managed_state`, `get_org_prompts` and `processEmails()` are covered only
through the functions they call. The one exception is the `get_managed_values` listener,
which `helpers/background-handler.mjs` locates by its command guard and evaluates verbatim.
If that listener is moved or restructured, update the locator there.
