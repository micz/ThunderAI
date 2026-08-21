"""Single source of truth for the ThunderAI debug harness.

Paths, ports, prefs and the pinned extension UUID all live here so that the
launcher, the UI driver and the example scripts cannot disagree with each other.
"""

import os
import sys
from pathlib import Path

# --- Paths -------------------------------------------------------------------

# tools/debug/config.py -> parents[2] is the repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = Path(__file__).resolve().parent
LOG_DIR = DEBUG_DIR / "logs"
SHOT_DIR = DEBUG_DIR / "screenshots"
DOM_DIR = DEBUG_DIR / "dom"
GECKO_LOG = LOG_DIR / "tb.log"

# The dev profile lives OUTSIDE the repo, so it can never be committed and
# needs no .gitignore entry.
PROFILE_DIR = Path(os.environ.get("LOCALAPPDATA", os.environ.get("TEMP", "."))) \
    / "Temp" / "thunderai-debug-profile"

# The literal token that must appear in any profile path we are willing to
# delete. See tb_harness._guard_profile_path.
PROFILE_GUARD_TOKEN = "thunderai-debug-profile"

# --- Extension ---------------------------------------------------------------

EXT_ID = "thunderai@micz.it"

# A fixed UUID we pre-seed into extensions.webextensions.uuids, so that the
# options URL below is a constant a human can paste into Thunderbird to
# reproduce a failure by hand.
PINNED_UUID = "7c9e6a41-2b8d-4f3a-9c1e-5d8b6a4f2e70"

OPTIONS_PATH = "options/mzta-options.html"


def options_url(uuid=PINNED_UUID):
    """The moz-extension:// URL of the ThunderAI options page."""
    return "moz-extension://{}/{}".format(uuid, OPTIONS_PATH)


# --- Thunderbird binary ------------------------------------------------------

MARIONETTE_PORT = 2828

# Hard-pinned: this is the only install new enough for the add-on.
TB_BIN = Path(r"C:\Program Files\Mozilla Thunderbird Beta\thunderbird.exe")

# Explicitly rejected: v138.0, below manifest.json strict_min_version 140.0.
TB_BIN_REJECTED = Path(r"C:\Program Files (x86)\Mozilla Thunderbird\thunderbird.exe")


def resolve_tb_bin():
    """Return the Thunderbird binary to drive, or raise with a useful message."""
    override = os.environ.get("THUNDERAI_TB_BIN")
    if override:
        p = Path(override)
        if not p.is_file():
            raise SystemExit(
                "THUNDERAI_TB_BIN is set to {!r} but that file does not exist.".format(override)
            )
        return p

    if TB_BIN.is_file():
        return TB_BIN

    if TB_BIN_REJECTED.is_file():
        raise SystemExit(
            "Thunderbird Beta was not found at:\n"
            "  {}\n\n"
            "An older Thunderbird DOES exist at:\n"
            "  {}\n"
            "but it is version 138.0, which is below the strict_min_version of 140.0\n"
            "declared in manifest.json. The add-on cannot install there, so the\n"
            "harness deliberately refuses to use it -- do not 'fix' this by pointing\n"
            "TB_BIN at that path.\n\n"
            "Install Thunderbird Beta (140+), or set THUNDERAI_TB_BIN to a 140+ binary."
            .format(TB_BIN, TB_BIN_REJECTED)
        )

    raise SystemExit(
        "Thunderbird Beta not found at {}.\n"
        "Install it, or set THUNDERAI_TB_BIN to a Thunderbird 140+ binary.".format(TB_BIN)
    )


# --- Preferences -------------------------------------------------------------
#
# Written to the profile's user.js (not prefs.js): user.js is re-asserted on
# every startup and survives Gecko rewriting prefs.js, which matters across the
# in-app restart the persistence test performs.

PREFS = {
    # -- Install permissions: allow an unsigned, unpacked add-on -------------
    "xpinstall.signatures.required": False,
    "extensions.install.requireBuiltInCerts": False,
    "extensions.autoDisableScopes": 0,
    "extensions.strictCompatibility": False,
    "extensions.langpacks.signatures.required": False,

    # -- THE PERSISTENCE FIX -------------------------------------------------
    # A temp-installed add-on is auto-uninstalled at shutdown. Extension.sys.mjs
    # clearOnUninstall() would then wipe storage.sync -- unless this pref is set,
    # which is what gates it. Without this the persistence test fails spuriously.
    "extensions.webextensions.keepStorageOnUninstall": True,
    # Keep the moz-extension:// host stable across the restart.
    "extensions.webextensions.keepUuidOnUninstall": True,
    # Pre-seed the UUID map so options_url() is a constant.
    "extensions.webextensions.uuids": '{"%s":"%s"}' % (EXT_ID, PINNED_UUID),

    # -- Keep extension pages in-process -------------------------------------
    # Not cosmetic: this is what makes the options page drivable at all.
    # Marionette in Thunderbird never populates window_handles (there is no
    # content browsing context to switch to), so the only way to reach the
    # options page is through the tab's <browser> element from the chrome
    # context -- and that requires browser.contentDocument, which is null for
    # an out-of-process browser. With these three prefs the extension page runs
    # in the parent process, contentDocument works, and the page's own
    # `browser.storage.sync` object becomes reachable via contentWindow.
    # Without them, both switch_to_frame() and contentDocument fail.
    "fission.autostart": False,
    "extensions.webextensions.remote": False,
    "browser.tabs.remote.autostart": False,

    # -- Marionette ----------------------------------------------------------
    "marionette.port": MARIONETTE_PORT,
    # Must be explicit: the default would block startup waiting on a modal.
    "marionette.prefs.clickToStart": False,
    "marionette.log.level": "Info",

    # -- Startup unblocking --------------------------------------------------
    "mail.shell.checkDefaultClient": False,
    "mail.shell.checkDefaultMail": False,
    "mail.provider.suppress_dialog_on_startup": True,
    "mail.accountwizard.quit_on_cancel": False,
    "mail.rights.version": 999,
    "mail.spotlight.firstRunDone": True,
    "mail.winsearch.firstRunDone": True,
    "mailnews.start_page.enabled": False,

    # Stop the "what's new / beta notes" page from being opened in the user's
    # DEFAULT BROWSER on every launch. Thunderbird does that whenever it sees a
    # version change, and a fresh profile always looks like one.
    #   - mstone "ignore" is the documented way to say "no milestone change".
    #   - override_url empty + assume_external_browser suppress the fallbacks.
    "startup.homepage_override_url": "",
    "startup.homepage_welcome_url": "",
    "startup.homepage_welcome_url.additional": "",
    "mailnews.start_page_override.mstone": "ignore",
    "mailnews.start_page.override_url": "",
    "browser.startup.homepage_override.mstone": "ignore",
    "app.update.postupdate": False,
    # Never hand a URL to an external browser on startup.
    "network.protocol-handler.external.http": False,
    "network.protocol-handler.external.https": False,
    "mail.biff.show_alert": False,
    "mail.server.default.check_new_mail": False,
    "datareporting.policy.dataSubmissionEnabled": False,
    "datareporting.policy.firstRunURL": "",
    "datareporting.healthreport.uploadEnabled": False,
    "toolkit.telemetry.enabled": False,
    "toolkit.telemetry.unified": False,
    "toolkit.telemetry.reportingpolicy.firstRun": False,
    "app.update.enabled": False,
    "app.update.auto": False,
    "app.update.checkInstallTime": False,
    "extensions.blocklist.enabled": False,
    "extensions.update.enabled": False,
    "extensions.getAddons.cache.enabled": False,
    "browser.dom.window.dump.file": "",
    "network.dns.offline-localhost": False,
    "mail.tabs.drawInTitlebar": False,

    # -- A Local Folders-only account suppresses the first-run wizard --------
    "mail.account.account1.server": "server1",
    "mail.server.server1.type": "none",
    "mail.server.server1.hostname": "Local Folders",
    "mail.server.server1.name": "Local Folders",
    "mail.server.server1.directory-rel": "[ProfD]Mail/Local Folders",
    "mail.accountmanager.accounts": "account1",
    "mail.accountmanager.defaultaccount": "account1",
    "mail.accountmanager.localfoldersserver": "server1",

    # -- Log visibility ------------------------------------------------------
    "browser.dom.window.dump.enabled": True,
    "devtools.console.stdout.chrome": True,
    # This one is what makes ThunderAI's own taLog/console.log land in tb.log.
    # Without it the log holds only Gecko chatter.
    "devtools.console.stdout.content": True,
}


def ensure_dirs():
    """Create the artifact directories if they are missing."""
    for d in (LOG_DIR, SHOT_DIR, DOM_DIR):
        d.mkdir(parents=True, exist_ok=True)


def describe():
    """Human-readable summary, printed by the example scripts on startup."""
    return "\n".join([
        "repo root   : {}".format(REPO_ROOT),
        "thunderbird : {}".format(resolve_tb_bin()),
        "profile     : {}".format(PROFILE_DIR),
        "gecko log   : {}".format(GECKO_LOG),
        "options url : {}".format(options_url()),
    ])


if __name__ == "__main__":
    try:
        print(describe())
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        raise
