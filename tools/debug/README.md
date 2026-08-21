# ThunderAI debug harness

An opt-in Marionette harness that launches Thunderbird with ThunderAI installed,
drives the UI from Python, and captures logs, screenshots and DOM dumps.

Not a test framework: no pytest, one dependency in a venv, and **no build step**
— the add-on is installed as the unpacked repo directory, so your edits are
picked up on the next run with zero packaging.

Full design notes and the non-obvious Gecko/Thunderbird findings live in
[`claude-spec/08-debug-harness.md`](../../claude-spec/08-debug-harness.md).

## Setup

```bash
E:\Python\Python311\python.exe -m venv tools/debug/.venv
tools/debug/.venv/Scripts/python.exe -m pip install -r tools/debug/requirements.txt
```

Requires **Thunderbird Beta 140+** at `C:\Program Files\Mozilla Thunderbird Beta`
(developed against 154.0). The old `Program Files (x86)` install is v138 and is
rejected on purpose — it is below `manifest.json`'s `strict_min_version: 140.0`,
so the add-on cannot install there. Override with `THUNDERAI_TB_BIN` if your
binary is elsewhere.

## Running

```bash
# Show resolved paths and the options URL; launches nothing.
tools/debug/.venv/Scripts/python.exe tools/debug/config.py

# E2E: type an option into the real options page, restart, verify it persisted.
tools/debug/.venv/Scripts/python.exe tools/debug/run_options_persistence.py

# Prove the E2E test is capable of failing.
tools/debug/.venv/Scripts/python.exe tools/debug/run_negative_control.py
```

Exit `0` = pass, `1` = fail.

### Fast iteration: reuse a configured profile

Configuring Ollama through the options UI on every launch is slow. Do it once:

```bash
tools/debug/.venv/Scripts/python.exe tools/debug/run_setup_profile.py
```

then run anything with the profile kept (startup drops to a few seconds):

```bash
HARNESS_KEEP_PROFILE=1 tools/debug/.venv/Scripts/python.exe tools/debug/<script>.py
```

`HARNESS_KEEP_PROFILE=1` forces `reset_profile=False`; it can only ever preserve
a profile, never wipe one. `storage.sync` prefs and granted permissions survive;
the mail account does not, but `mail_setup.ensure_compose_account()` recreates it
in a moment.

### Ollama-backed prompt test

```bash
tools/debug/.venv/Scripts/python.exe tools/debug/run_compose_rewrite_formal.py
```

Needs a running Ollama (`OLLAMA_HOST`, `OLLAMA_MODEL` to override) with
`OLLAMA_ORIGINS=moz-extension://*` set. It configures the connection through the
real options UI, opens a compose window with an informal draft and selects it —
then **fails at the last step**, because the popup that dispatches the prompt
cannot be opened from automation. See "Known limitation" below.

## Artifacts

| Path | Contents |
|---|---|
| `logs/tb.log` | Thunderbird's stdout/stderr, including ThunderAI's own `taLog` lines. **Truncated at every session start.** |
| `screenshots/` | `{timestamp}_{seq}_{name}.png`, chronologically sorted |
| `dom/` | Serialized page DOM, with live form values mirrored into attributes |

All git-ignored except the `.gitkeep` placeholders.

## Writing your own script

```python
import config, ext_storage, tab_page
from tb_harness import TBHarness
from ui_driver import UIDriver

with TBHarness(reset_profile=True) as h:      # stop() is guaranteed on exit
    ui = UIDriver(h.marionette)
    ui.wait_for_3pane(timeout=90)             # do this before anything else
    h.install_addon(temp=True)
    uuid = ext_storage.resolve_uuid(h.marionette)

    page = tab_page.options_page(h.marionette, uuid)
    page.open()
    page.wait_for_restore()                   # restoreOptions() races with you

    page.set_value("default_sign_name", "hello")
    ext_storage.wait_for_sync_value(h.marionette, page, "default_sign_name", "hello")

    ui.screenshot("my-check")
```

Seed state directly to reach options gated behind `connection_type`:

```python
ext_storage.write_sync(h.marionette, page, {"connection_type": "chatgpt_api"})
```

## Things worth knowing before you debug the harness itself

- **Use `TabPage`, not `marionette.navigate()`.** Marionette's content context is
  unusable in Thunderbird — `window_handles` is always empty and `navigate()`
  raises *"Browsing context has been discarded"*. Extension pages are reached
  through the tab's `<browser>` from the chrome context.
- **`storage.sync`, never `storage.local`.** ThunderAI uses `storage.sync`;
  reading `storage.local` silently returns nothing.
- **Setting `.value` alone saves nothing.** ThunderAI saves on `change`, which
  Gecko fires only on blur/Enter for text inputs. `TabPage.set_value` dispatches
  the events for you.
- **Writes must be polled, not awaited.** `saveOptions` is fire-and-forget, with
  no promise and no DOM signal.
- **`keepStorageOnUninstall` is not the load-bearing pref it looks like.** In
  TB 154 `storage.sync` survives a temp add-on's shutdown teardown either way; it
  is only wiped on an *explicit* uninstall. Do not use that pref to break the
  test on purpose — use `run_negative_control.py`.
- The fission / `extensions.webextensions.remote` prefs in `config.py` are
  **required**, not tuning: without them the extension page is out-of-process and
  its document is unreachable.

## Known limitation: the action popup

A user launches a compose prompt (e.g. `prompt_rewrite_formal`) from the popup
that the `compose_action` toolbar button opens. **That popup cannot be opened
from automation.** `composeAction.openPopup()` returns `true` yet no popup view
is ever created; synthetic clicks, a synthetic `command` event and the
`Ctrl+Alt+A` command all behave the same. The automated window never holds real
OS-level focus, so the panel is dismissed immediately. Mozilla's own helpers for
this (`clickBrowserAction`, `awaitExtensionPanel`) are mochitest-only and out of
Marionette's reach.

Working around it by messaging the background page directly does not reproduce
the user's path: the background page cannot receive its own `sendMessage`, and
sending from another extension page makes `executeMenuAction()` return `false`,
because the prompt's `act()` resolves its target with
`tabs.query({active: true, currentWindow: true})` and picks the sender's tab.

Verified working regardless: the Ollama connection through the real options UI
(with "Prova ora" reporting *Connesso*), `fetchModels()` reaching the server, the
compose window, and the full-body selection `need_selected: "1"` requires.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Port 2828 is already listening` | A previous run or another Marionette Thunderbird is up. `taskkill /IM thunderbird.exe /F` |
| Message about the v138 install | Install Thunderbird Beta 140+, or set `THUNDERAI_TB_BIN` |
| `out-of-process browser` error | The fission / remote prefs in `config.py` are not being applied |
| `Browsing context has been discarded` | Something is calling `marionette.navigate()`; use `TabPage` |
| `tb.log` empty | Run aborted before the options page loaded; check the screenshots |
| Startup hangs, no 3pane | A modal is blocking. The `timeout-3pane` screenshot shows which |
| `permission denied to pass object` | A sandbox object crossed into page code; use `Cu.cloneInto` / `Cu.exportFunction` |
| Value not saved | The `change` event never fired, or `restoreOptions()` overwrote it |

## Tradeoff: temporary install

The add-on is installed with `temp=True`, which needs no signing and no XPI. The
cost is that it is uninstalled at shutdown and must be re-installed after a
restart (the E2E script does this). A permanent install would avoid that but
generally requires building and signing an XPI — a packaging step this harness
deliberately does not add.
