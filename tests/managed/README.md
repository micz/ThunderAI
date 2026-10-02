# Tests: the managed configuration

The tests of the enterprise managed configuration. The contract they check is
[`claude-spec/08-managed-configuration.md`](../../claude-spec/08-managed-configuration.md) and its
topic files `08a-managed-prompts.md`, `08b-managed-connections.md`, `08c-managed-ui.md`: each
test file names the spec section it covers (as `spec 08 "<section>"`, whichever file holds it).

How to run the suite, the two levels, the mock, the DOM harness and the plugin contract are in
the general [`tests/README.md`](../README.md). This file covers what is specific to the managed
configuration. Paths are relative to `tests/`.

## Layout

```
tests/
├── helpers/
│   ├── plugins/managed.mjs     the managed plugin: js/mzta-managed.js in every context,
│   │                           loadManaged(), the background instance of a page
│   ├── known-issues/managed.mjs  the managed known issues and their shape (validateKnown())
│   │
│   ├── load.mjs                the core loader, plus js/mzta-managed.js in loadModules()
│   ├── browser-mock.mjs        re-export of core/browser-mock.mjs
│   ├── background-handler.mjs  real background code cut out of mzta-background.js: the
│   │                           get_managed_values listener
│   ├── restart.mjs             "restart Thunderbird": run a scenario in a fresh worker thread
│   ├── feature-pages.mjs       the feature pages with a specific-integration panel, by prefix
│   │                           (no jsdom: level 1 checks it against special_prompts_with_integration)
│   │
│   ├── dom-page.mjs            the core DOM harness, plus the managed control helpers
│   ├── dom-probe.mjs           a page (or the allowlist) probed in a fresh worker thread
│   ├── dom-sweep.mjs           the allowlist sweep: lockedSweep(), unlockedSweep()
│   ├── dom-known-issues.mjs    the core known-issue mechanism with the managed entries
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
  `runtime.sendMessage`, answered by the real listener from `mzta-background.js`. This is the
  managed plugin's `remoteBackground()` (`helpers/plugins/managed.mjs`), and the ctx gets that
  instance as `bgManaged`.
- `restart(mockOpts, scenario, args)` runs a named scenario from `helpers/restart.mjs` in a
  worker thread, with its own module graph and the storage you hand it. Use it to check
  what is left once the policy is removed ("no residue", "the user's text comes back").
  `helpers/dom-probe.mjs` does the same for a whole page. Both run their worker through the core
  `helpers/core/worker.mjs`; the scenarios and probe modes stay here, because they are managed.

## The managed plugin

`helpers/plugins/managed.mjs` is what the core does for the managed configuration:

- `modules()`: `js/mzta-managed.js`, as `mztaManaged`, `MANAGED_SECRET_MARKER` and
  `managedModule`;
- `startBackground()`: `loadManaged()`, the one call `mzta-background.js` makes before its first
  preference read;
- `remoteBackground()`: the background instance of a page (above), imported before the page's
  modules; its `start()` builds the `get_managed_values` listener and runs `loadManaged()` on it.

So the background's answers to a page are:

- `get_managed_values`: the real listener, as in level 1, evaluated against the background
  instance of `mztaManaged`. It is the only channel a page gets the policy through (values,
  locks, org prompts, restrictions, banner state), so the page hydrates, and sees exactly the
  state, it would in Thunderbird;
- `reload_menus`, `get_active_special_ids`, `popup_menu_ready`: the core's fixed minimal answer
  (`defaultCommands()`). These are not managed-configuration code;
- anything else: a recorded violation.

The listener is located by `helpers/background-handler.mjs` (its command guard), with the core
tokenizer.

## Adding a scenario

1. Put the policy in `tests/fixtures/<name>.json`, exactly as it would appear under
   `3rdparty → Extensions → thunderai@micz.it` in `policies.json`. A policy that has to follow
   `prefs_default` can be a `.mjs` builder instead (see `every-pref-key.mjs`).
2. Create `tests/managed/NN-<name>.test.mjs`. Start it with a comment quoting the spec
   section it checks, then set it up in `before()`:

   ```js
   import { test, before } from 'node:test';
   import assert from 'node:assert/strict';
   import {
       startBackground,
       loadFixture,
   } from '../helpers/load.mjs';

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

## The allowlist sweep

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
`known-issues/managed.mjs`.

## Adding a page

On top of the general steps ([`tests/README.md`](../README.md#adding-a-page)):

1. Add it to `PAGES`: the pages managed tests open today are all core pages (`CORE_PAGES` in
   `helpers/core/dom-harness.mjs`); a page only the managed configuration needs would go in
   the `pages` of `helpers/plugins/managed.mjs`.
2. Create `tests/dom/<page>/01-no-policy.dom.mjs` with `noPolicyScenario()`, and, for a page
   with managed controls, the two sweep files (copy an existing pair: they are three lines).
3. If `assertHarnessClean()` fails with an unmocked API, model it in `addPageApis()`; an
   unmocked background command goes in `defaultCommands()` (if it is not managed code) or is
   cut out of `mzta-background.js` like the managed ones.

## Adding a DOM scenario

Create `tests/dom/<page>/NN-<name>.dom.mjs`, starting with a comment quoting the spec section:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/dom-page.mjs';

const ctx = await openPage('options', { policy: { default_sign_name: 'ACME' }, local: {} });
after(() => ctx.close());

test('what the spec says happens', () => {
    assert.equal(ctx.$('#default_sign_name').disabled, true);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
```

`ctx` holds `window`, `document`, `$`/`$$`, `fire()`, `click()`, `settle()`, `ctl` (the mock
controller: `localData()`, `calls`, `sent`), `con`, `mods` (the page's own `mztaManaged`,
`mztaPrefs`, …), `bgManaged` (the background's), `apiCalls(api)`, `fetchCalls`, `dialogs` and
`localWrites(since)`. The page is opened at the top level, with `await`, because node:test must
know the generated tests before it runs them.

## Potential bugs: TODO tests

A test that fails against the shipped code is **not** changed to pass, and neither is the
source. Its reason goes in `helpers/known-issues/managed.mjs` - which spec section it contradicts
and what the code does instead - and the test runs through `knownTest(name, reason, fn)`
(`helpers/dom-known-issues.mjs`, the core mechanism naming this file):
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
