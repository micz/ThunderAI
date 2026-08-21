"""E2E: change a ThunderAI option, restart Thunderbird, prove it persisted.

Run:
    tools/debug/.venv/Scripts/python.exe tools/debug/run_options_persistence.py

Exits 0 on PASS, 1 on FAIL. Artifacts land in tools/debug/{screenshots,dom,logs}.

Target option: default_sign_name -- a plain text input in "Basic settings" that
is always visible and never gated. Most other interesting options (add_tags,
spamfilter, summarize, translate, get_calendar_event, max_prompt_length) are
force-disabled by disable_*() while connection_type is '' (the default), and
do_debug is hidden inside the collapsed advanced panel.

The value is written by typing into the real options page and letting
ThunderAI's own saveOptions() handle it -- not by writing storage directly --
so the test covers the actual code path a user exercises.
"""

import random
import sys
import time
import traceback

import config
import ext_storage
import tab_page
from tb_harness import TBHarness
from ui_driver import UIDriver

OPTION_KEY = "default_sign_name"


def unique_value():
    """A per-run unique, whitespace-free value.

    Whitespace-free so the .trim() in saveOptions is a no-op and the DOM value
    and the stored value are identical. Unique so the test cannot pass
    spuriously against a leftover from an earlier run.
    """
    return "harness-{}-{:04d}".format(time.strftime("%Y%m%d%H%M%S"),
                                      random.randint(0, 9999))


def open_options(marionette, uuid):
    page = tab_page.options_page(marionette, uuid)
    page.open(timeout=60)
    page.wait_for_element(OPTION_KEY, timeout=30)
    page.wait_for_restore()
    return page


def write_option(marionette, page, value):
    """Set the value via the UI, then confirm the write actually landed.

    saveOptions() is fire-and-forget (a bare storage.sync.set with no await and
    no .then()), so there is nothing to await and no DOM signal -- hence the
    poll. If restoreOptions() won the race and overwrote us, retry once.
    """
    for attempt in (1, 2):
        page.set_value(OPTION_KEY, value)
        try:
            ext_storage.wait_for_sync_value(
                marionette, page, OPTION_KEY, value, timeout=15
            )
            return True
        except ext_storage.StorageError:
            if attempt == 2:
                raise
            print("[test] write did not land (likely lost the restoreOptions "
                  "race); retrying once")
            time.sleep(2)
    return False


def main():
    config.ensure_dirs()
    print(config.describe())
    value = unique_value()
    print("[test] target: {} = {!r}\n".format(OPTION_KEY, value))

    with TBHarness(reset_profile=True) as h:
        ui = UIDriver(h.marionette)

        # 1. Launch and confirm the main window is genuinely up.
        ui.wait_for_3pane(timeout=90)
        ui.screenshot("01-3pane-ready")

        addon_id = h.install_addon(temp=True)
        print("[test] installed add-on: {}".format(addon_id))

        uuid = ext_storage.resolve_uuid(h.marionette)
        print("[test] extension uuid: {}".format(uuid))

        # 2-4. Open the options page, type the value, poll until it is stored.
        page = open_options(h.marionette, uuid)
        write_option(h.marionette, page, value)
        print("[test] storage.sync now holds the value (pre-restart)")

        # 5. Evidence before the restart.
        ui.screenshot("02-options-before-restart")
        ui.dump_page_dom(page, "02-options-before-restart")

        # 6. Graceful in-app restart.
        print("[test] restarting Thunderbird (in-app)...")
        h.restart()
        ui = UIDriver(h.marionette)
        ui.wait_for_3pane(timeout=90)

        uuid2 = ext_storage.resolve_uuid(h.marionette)
        if uuid2 != uuid:
            raise AssertionError(
                "extension UUID changed across the restart ({} -> {}).\n"
                "keepUuidOnUninstall is not holding, so the moz-extension URL "
                "is no longer valid and the test's premise is broken."
                .format(uuid, uuid2)
            )

        # A temp add-on is uninstalled at shutdown and not reinstalled, so it
        # must be installed again. keepStorageOnUninstall is what preserves the
        # data across that uninstall -- which makes this the STRONGER assertion:
        # the value outlives a full add-on lifecycle, not just a process restart.
        addon_id = h.install_addon(temp=True)
        print("[test] re-installed add-on after restart: {}".format(addon_id))

        # 7. Assert two independent ways.
        page2 = open_options(h.marionette, uuid2)
        stored = ext_storage.read_sync_pref(h.marionette, page2, OPTION_KEY)
        dom_value = page2.get_value(OPTION_KEY)

        ui.screenshot("03-options-after-restart")
        ui.dump_page_dom(page2, "03-options-after-restart")

        print("[test] after restart: storage={!r} dom={!r}".format(stored, dom_value))

        # Both checks matter: storage-only would pass even if the UI failed to
        # render the persisted value; DOM-only would pass if restore read from
        # some cache. Together they cover the round trip a user experiences.
        if stored != value:
            raise AssertionError(
                "storage.sync[{}] did not persist: expected {!r}, got {!r}.\n"
                "If this is empty, extensions.webextensions.keepStorageOnUninstall "
                "is not in effect -- the temp add-on's uninstall wiped storage at "
                "shutdown.".format(OPTION_KEY, value, stored)
            )
        if dom_value != value:
            raise AssertionError(
                "the options page did not render the persisted value: "
                "expected {!r}, got {!r} (storage held {!r}, so this is a UI "
                "restore failure, not a storage failure)."
                .format(value, dom_value, stored)
            )

        print("\nPASS: {} persisted across restart as {!r}".format(OPTION_KEY, value))
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("\nFAIL: {}".format(exc), file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
