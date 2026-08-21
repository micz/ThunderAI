"""One-time setup of a REUSABLE debug profile: Ollama configured and saved.

Run this once:
    tools/debug/.venv/Scripts/python.exe tools/debug/run_setup_profile.py

Then run other scripts with reset_profile=False (or HARNESS_KEEP_PROFILE=1) and
they start with the connection already configured -- no re-running the whole
options-UI dance on every launch.

The profile lives at %LOCALAPPDATA%\\Temp\\thunderai-debug-profile and persists
on disk between runs; it is only wiped when a harness is constructed with
reset_profile=True (the default for the other scripts, so they stay
self-contained).

Note the storage/add-on interaction: the add-on is installed with temp=True, so
it is uninstalled at shutdown. storage.sync survives that in TB 154 (verified --
see claude-spec/08-debug-harness.md), which is what makes this reuse work.
"""

import os
import sys
import traceback

import config
import ext_permissions
import ext_storage
import mail_setup
import ollama_setup
import tab_page
from tb_harness import TBHarness
from ui_driver import UIDriver

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "glm-5.2:cloud")


def main():
    config.ensure_dirs()
    print(config.describe())
    print("\n[setup] building a REUSABLE profile at {}".format(config.PROFILE_DIR))

    # reset_profile=True here on purpose: this script *creates* the baseline.
    with TBHarness(reset_profile=True) as h:
        m = h.marionette
        ui = UIDriver(m)
        ui.wait_for_3pane(timeout=90)
        h.install_addon(temp=True)
        uuid = ext_storage.resolve_uuid(m)

        # Optional host permission, normally granted by clicking a doorhanger.
        ext_permissions.grant(m, origins=["<all_urls>"])

        # A default account with an identity, so compose windows can open.
        mail_setup.ensure_compose_account(m)

        page = tab_page.options_page(m, uuid)
        page.open(timeout=60)
        page.wait_for_element("default_sign_name", timeout=30)
        page.wait_for_restore()

        result = ollama_setup.configure(m, page, host=OLLAMA_HOST,
                                        model=OLLAMA_MODEL)
        ui.screenshot("setup-ollama-configured")

        low = (result["status"] or "").lower()
        if not any(k in low for k in ("connesso", "connected", "ok")):
            print("\n[setup] WARNING: the connection test did not report success: "
                  "{!r}".format(result["status"]), file=sys.stderr)

        print("\nPASS: profile configured and saved.")
        print("      profile : {}".format(config.PROFILE_DIR))
        print("      model   : {}".format(result["model"]))
        print("\nReuse it with reset_profile=False, e.g.:")
        print("      HARNESS_KEEP_PROFILE=1 "
              "tools/debug/.venv/Scripts/python.exe tools/debug/<script>.py")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("\nFAIL: {}".format(exc), file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
