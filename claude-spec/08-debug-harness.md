# Debug Harness (`tools/debug/`)

An **opt-in** Marionette harness that launches Thunderbird with ThunderAI
installed, drives the UI from Python, captures logs/screenshots/DOM dumps, and
verifies option persistence across a restart.

It is deliberately **not** a test framework: no pytest, no `conftest.py`, one new
dependency (`marionette_driver`) confined to a venv, and **no build step for the
extension** — the add-on is installed as the unpacked repo directory, so the
"no build tools, no npm" rule in CLAUDE.md is unaffected. Manual testing in
Thunderbird remains the norm for feature work.

## Requirements

- **Thunderbird Beta 140+.** Pinned to `C:\Program Files\Mozilla Thunderbird Beta`
  (verified against **154.0**). `config.py` **hard-rejects**
  `C:\Program Files (x86)\Mozilla Thunderbird` with an explanatory message: it is
  **v138.0**, below `manifest.json`'s `strict_min_version: 140.0`, so the add-on
  cannot install there. Override with `THUNDERAI_TB_BIN` if needed.
- Python 3.11 (developed against `E:\Python\Python311`).

## Setup and running

```bash
E:\Python\Python311\python.exe -m venv tools/debug/.venv
tools/debug/.venv/Scripts/python.exe -m pip install -r tools/debug/requirements.txt

# The E2E test: set an option, restart, verify it persisted.
tools/debug/.venv/Scripts/python.exe tools/debug/run_options_persistence.py

# Prove the test can actually fail (see "Negative control" below).
tools/debug/.venv/Scripts/python.exe tools/debug/run_negative_control.py

# Print the resolved paths/URL without launching anything.
tools/debug/.venv/Scripts/python.exe tools/debug/config.py
```

Both scripts exit `0` on success, `1` on failure. Artifacts go to
`tools/debug/{logs,screenshots,dom}/` (git-ignored except `.gitkeep`).

## Files

| File | Role |
|---|---|
| `config.py` | Single source of truth: paths, port, prefs, pinned UUID, binary resolution |
| `tb_harness.py` | `TBHarness` — owns the process and session; profile, restart, teardown |
| `ui_driver.py` | `UIDriver` — chrome-window waits, screenshots, DOM dumps |
| `tab_page.py` | `TabPage` — drives an extension page in a real content tab |
| `ext_storage.py` | UUID resolution + `storage.sync` read/write through the page's own API |
| `run_options_persistence.py` | The E2E example |
| `run_negative_control.py` | Proves the E2E test is capable of failing |

## Non-obvious facts

These cost real time to establish. Read before changing the harness.

### ThunderAI saves to `storage.sync`, not `storage.local`

`options/mzta-options.js:86`. Anything asserting against `storage.local` would
silently always see nothing and every check would be vacuous.

### `saveOptions` is fire-and-forget

`options/mzta-options.js:52-87` is a *synchronous* function ending in a bare
`browser.storage.sync.set(options)` — no `await`, no `.then()`. There is no
promise to await and no DOM signal that the write landed, so the harness
**polls** `storage.sync` until the value appears
(`ext_storage.wait_for_sync_value`).

### `change` is the only save trigger

Listeners bind to every `.option-input` on `change` (`mzta-options.js:558`),
*after* `await restoreOptions()` (line 541). For `<input type="text">` Gecko
fires `change` only on blur or Enter — **a bare `element.value = x` assignment
fires nothing at all**, so the save never happens. `TabPage.set_value` therefore
assigns the value and dispatches `input` + `change` explicitly, using the page's
own `Event` constructor.

This is not a cheat: `saveOptions(e)` reads only `e.preventDefault()`,
`e.target.type`, `e.target.id` and `e.target.value` — there is no `isTrusted`
check — so it drives the identical code path.

### Marionette's content context is unusable in Thunderbird

The single biggest obstacle, and the reason `tab_page.py` exists at all. Against
TB 154:

- `marionette.window_handles` is **always empty** — there is no content browsing
  context to switch to, so `marionette.navigate()` raises
  *"Browsing context has been discarded"*.
- `switch_to_frame()` on a tab's `XULFrameElement` raises `NoSuchFrameException`.
- `Services.ww.openWindow` on the options URL yields an `about:blank` chrome
  wrapper, not a reachable page.

What works: open a real `contentTab` via `tabmail.openTab` (what a user's click
does) and reach its document through `browser.contentDocument` from the **chrome**
context.

### Extension pages must run in-process

`contentDocument` is `null` for an out-of-process browser, so these prefs are
**load-bearing**, not cosmetic:

```
fission.autostart                    = false
extensions.webextensions.remote      = false
browser.tabs.remote.autostart        = false
```

Without them `TabPage.wait_until_ready` fails with an explicit
"out-of-process browser" message rather than a bare timeout.

### Reaching `storage.sync` across the sandbox boundary

The harness goes through the page's **own** `browser.storage.sync` object, not
`ExtensionStorageSync` internals — the internals work, but bypass the API layer
ThunderAI uses, so a test built on them could pass while the real path is broken.

Two Gecko rules make this fiddly, and both are load-bearing:

- A sandbox object cannot be handed to a page function
  (*"Permission denied to pass object to exported function"*), so query objects
  are built with `Cu.cloneInto` and callbacks with `Cu.exportFunction`.
- The page's **CSP blocks `eval()`**, so the promise cannot be driven with
  `win.eval()`. The page's own `then()` stashes a plain string on its `window`
  and the harness polls for it.

### `keepStorageOnUninstall` does NOT do what you would expect

**Corrected finding — the harness's original design assumed otherwise.**

The reasoning "a `temp=True` add-on is uninstalled at shutdown, so
`clearOnUninstall` wipes `storage.sync` and the persistence test fails
spuriously" is **wrong for TB 154**. Verified behaviour:

| Scenario (`keepStorageOnUninstall=false`) | `storage.sync` |
|---|---|
| In-app restart, temp add-on torn down at shutdown | **survives** |
| Explicit `addon.uninstall()` | **wiped** |

`clearOnUninstall` fires on an *explicit* uninstall, not on shutdown teardown.
`extensions.webextensions.keepStorageOnUninstall=true` is still set in
`config.PREFS` as a safety belt, but **it is not what makes the E2E test pass** —
do not use it as a way to break the test on purpose.

### Negative control

A green test proves nothing unless it can fail. `run_negative_control.py` breaks
persistence the way that genuinely works (explicit uninstall with the pref off)
and asserts the value is gone afterwards. Because of the finding above, flipping
`keepStorageOnUninstall` alone does **not** break the test.

### Pass a Profile OBJECT, never a profile path

Given a **path string**, mozprofile's `_update_profile()` does
`Profile.clone()` into a `tempfile.mkdtemp()` and runs Thunderbird against the
*copy*. Everything written at runtime — `prefs.js`, `storage-sync-v2.sqlite`,
the account setup — lands in that clone and is deleted at shutdown, so
`reset_profile=False` preserves nothing and the profile directory holds only
`user.js` and `Mail`.

`tb_harness` therefore passes `Profile(profile=..., restore=False)`, an object,
which mozprofile uses in place. `restore=False` stops it reverting the directory
on cleanup.

### Reusable profile for fast iteration

`run_setup_profile.py` builds a profile with the Ollama connection configured
(through the real options UI) and the host permission granted. After that:

```bash
HARNESS_KEEP_PROFILE=1 tools/debug/.venv/Scripts/python.exe tools/debug/<script>.py
```

`HARNESS_KEEP_PROFILE=1` forces `reset_profile=False` — it can only ever
*preserve* a profile, never wipe one. Startup drops to a few seconds.

What survives a restart, and what does not:

| State | Survives? |
|---|---|
| `storage.sync` prefs (connection type, host, model) | **yes** |
| Granted optional permissions (`<all_urls>`) | **yes** |
| Mail account + identity | **no** — `MailServices.accounts` writes to `prefs.js` lazily |

`mail_setup.ensure_compose_account()` covers the last row: it reuses an existing
usable default account and only creates one when there is none.

### The action popup cannot be opened from automation

**A real limitation, not a bug in the harness or in ThunderAI.**
`prompt_rewrite_formal` is normally launched from the popup that the
`compose_action` toolbar button opens. That popup cannot be driven here:

| Attempt | Result |
|---|---|
| `.click()` / synthetic `command` event on `thunderai_micz_it-composeAction-toolbarbutton` | button found, no popup |
| `browser.composeAction.openPopup()` from the background page | returns **`true`**, yet no popup view is ever created |
| `Ctrl+Alt+A` (the `_thunderai__do_action` command) via `send_keys` | keys delivered, no popup |
| Enumerating `panel` / `menupopup` elements, and `ext.views`, afterwards | nothing found |

Per the [composeAction docs](https://webextension-api.thunderbird.net/en/latest/composeAction.html),
`openPopup()` returns false only when the action has no popup, is a menu, is
disabled, or was removed from the toolbar — none apply. So the panel does open
and is dismissed immediately, because the automated window never holds real
OS-level focus. Mozilla's own tests use mochitest-only helpers
(`clickBrowserAction`, `awaitExtensionPanel`) that Marionette cannot reach.

Consequence: **`shortcut_do_prompt` cannot be delivered the way a user delivers
it.** Sending it from another extension page does reach the background handler,
but `executeMenuAction()` then returns `false`, because the prompt's `act()`
resolves its target with `browser.tabs.query({active: true, currentWindow: true})`
and picks the sender's tab instead of the compose window. Opening the popup page
as an ordinary tab does not help — it is still the wrong `currentWindow`, and it
is not what a user does.

What *is* verified working, without the popup:

- Ollama configured through the real options UI, and **"Prova ora" reporting
  `Connesso — API Ollama (LLM Locale) raggiungibile`** — so the provider module,
  the HTTP path and the host permission all function.
- `Ollama.fetchModels()` reaching the server and populating the model select.
- A compose window opened with a draft, and its body fully selected (satisfying
  `need_selected: "1"`).

The gap is only the popup click that dispatches the prompt.

### The pinned UUID

`extensions.webextensions.uuids` is pre-seeded to a fixed UUID so the options URL
is a constant a human can paste into Thunderbird to reproduce by hand:

```
moz-extension://7c9e6a41-2b8d-4f3a-9c1e-5d8b6a4f2e70/options/mzta-options.html
```

`ext_storage.resolve_uuid` still resolves in three layers
(`WebExtensionPolicy.mozExtensionHostname` → the `uuids` pref map → the pinned
value) and warns rather than fails if the live UUID differs; Gecko is free to
ignore the seed. The E2E test asserts the UUID is **unchanged across the restart**
so a `keepUuidOnUninstall` failure reports itself instead of surfacing as a
confusing "element not found".

### Windows log capture

`thunderbird.exe` is a GUI-subsystem binary with no attached console, so shell
piping (`2>&1 | tee`) yields nothing. `GeckoInstance` sets
`process_args["logfile"] = gecko_log` and mozprocess passes that handle to the
child — which is what a GUI binary needs. The log is **truncated at every session
start**, so archive it if history matters.

`devtools.console.stdout.content=true` is what makes ThunderAI's own
`taLog`/`console.log` output land in `tb.log` (verified: `Saving option:
default_sign_name = ...` appears). Without it the log holds only Gecko chatter.

`GeckoInstance` takes **no `env=` parameter** — it builds the child environment
from `os.environ.copy()`, so `MOZ_DISABLE_AUTO_SAFE_MODE` /
`MOZ_DISABLE_SAFE_MODE_KEY` are set on the harness process before `Marionette` is
constructed. (Those two matter because a hard kill can otherwise trip the Safe
Mode prompt and block every later launch.)

### Safety

- **Profile lives outside the repo**, at
  `%LOCALAPPDATA%\Temp\thunderai-debug-profile` — it can never be committed.
- Two independent guards before any `rmtree`
  (`tb_harness._guard_profile_path`): the path must **not** be under
  `AppData\Roaming\Thunderbird\Profiles`, and it **must** contain the literal
  `thunderai-debug-profile`.
- `-no-remote` is essential: without it, launching while the user's normal
  Thunderbird is running would hand off to that instance and **drive the real
  profile**.
- `restart(clean=False)` always — `clean=True` wipes the profile.
- `stop()` falls back to `taskkill /T /F` so a crashed run cannot leave a zombie
  holding port 2828. `start()` pre-flight-checks that port and aborts with a
  clear message.

### Options-page startup notes

- `restoreOptions()` runs inside `DOMContentLoaded` and writes into every
  `.option-input`, racing with harness writes, and leaves **no completion flag**.
  Mitigated on both sides: `TabPage.wait_for_restore()` waits for a post-restore
  side effect (`connection_type` populated) plus a short settle, **and** the
  caller verifies its write and retries once.
- ThunderAI opens its **onboarding tab** on install, so the options tab is not
  the only extension tab; `TabPage` matches its browser by URL substring.
- `default_sign_name` is the E2E target because it is always visible and never
  gated. Avoid `add_tags`, `spamfilter`, `summarize`, `translate`,
  `get_calendar_event` and `max_prompt_length` — all force-disabled by
  `disable_*()` while `connection_type` is `''` (the default) — and `do_debug`,
  which hides inside the collapsed advanced panel.
- DOM dumps mirror live form state into attributes before serializing. A text
  input's current value lives in the `.value` **property** and is not serialized
  as `value=`, so a raw `outerHTML` dump taken after a successful save would show
  no value and read as a failure.

## Extending it

Seed state without clicking through the UI — useful for options gated behind
`connection_type`:

```python
page = tab_page.options_page(marionette, uuid)
page.open()
ext_storage.write_sync(marionette, page, {"connection_type": "chatgpt_api"})
```
