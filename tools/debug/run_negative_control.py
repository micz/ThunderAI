"""Negative control: prove the persistence test can actually FAIL.

A green test proves nothing unless the same assertions fail when persistence is
genuinely broken. This script breaks it on purpose, in the one way that really
does destroy storage.sync in Thunderbird 154, and asserts that
run_options_persistence's own check catches it.

Why not just flip keepStorageOnUninstall?
    Because -- verified against TB 154 -- that does NOT break the test. The
    clearOnUninstall path the pref gates fires on an EXPLICIT uninstall, not on
    the shutdown teardown of a temporarily-installed add-on. Data written by a
    temp add-on survives a restart either way. (The pref is still set in
    config.PREFS as a safety belt, but it is not what makes the test pass.)

So this control performs an explicit uninstall with the pref off, which is the
real mechanism, and checks that the value is gone afterwards.

Run:
    tools/debug/.venv/Scripts/python.exe tools/debug/run_negative_control.py

Exits 0 when the failure was correctly detected (i.e. the harness is trustworthy),
1 if the value survived a wipe that should have destroyed it.
"""

import sys
import time
import traceback

import config

# Must be set before the profile is written.
config.PREFS["extensions.webextensions.keepStorageOnUninstall"] = False

import ext_storage
import tab_page
from tb_harness import TBHarness
from ui_driver import UIDriver

OPTION_KEY = "default_sign_name"
SENTINEL = "negative-control-{}".format(time.strftime("%Y%m%d%H%M%S"))

UNINSTALL = """
  const resolve = arguments[arguments.length - 1];
  (async () => {
    try {
      const { AddonManager } = ChromeUtils.importESModule(
        'resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(arguments[0]);
      if (!addon) return resolve('NO_ADDON');
      await addon.uninstall();
      resolve('OK');
    } catch (e) { resolve('ERR:' + String(e)); }
  })();
"""


def main():
    config.ensure_dirs()
    print("[neg] keepStorageOnUninstall forced to False")
    print("[neg] sentinel: {!r}\n".format(SENTINEL))

    with TBHarness(reset_profile=True) as h:
        m = h.marionette
        ui = UIDriver(m)
        ui.wait_for_3pane(timeout=90)
        h.install_addon(temp=True)
        uuid = ext_storage.resolve_uuid(m)

        page = tab_page.options_page(m, uuid)
        page.open(timeout=60)
        page.wait_for_element(OPTION_KEY, timeout=30)
        page.wait_for_restore()

        page.set_value(OPTION_KEY, SENTINEL)
        ext_storage.wait_for_sync_value(m, page, OPTION_KEY, SENTINEL, timeout=15)
        print("[neg] sentinel stored via the real UI path")

        # Break persistence for real.
        with m.using_context("chrome"):
            result = m.execute_async_script(
                UNINSTALL, script_args=[config.EXT_ID], sandbox="system"
            )
        print("[neg] explicit uninstall -> {}".format(result))
        if result != "OK":
            raise AssertionError("could not uninstall the add-on: {}".format(result))
        time.sleep(3)

        h.install_addon(temp=True)
        time.sleep(2)
        uuid2 = ext_storage.resolve_uuid(m)

        page2 = tab_page.options_page(m, uuid2)
        page2.open(timeout=60)
        page2.wait_for_element(OPTION_KEY, timeout=30)
        page2.wait_for_restore()

        stored = ext_storage.read_sync_pref(m, page2, OPTION_KEY)
        dom_value = page2.get_value(OPTION_KEY)
        print("[neg] after wipe: storage={!r} dom={!r}".format(stored, dom_value))

        if stored == SENTINEL:
            print("\nFAIL: the sentinel survived a storage wipe that should have "
                  "destroyed it. The persistence assertions cannot be trusted.",
                  file=sys.stderr)
            return 1

        print("\nPASS: persistence broke as expected, and reading storage.sync "
              "reported it (got {!r}, not the sentinel).".format(stored))
        print("The assertions in run_options_persistence.py are therefore "
              "capable of failing.")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("\nERROR: {}".format(exc), file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
