"""Grant ThunderAI's optional permissions inside the throwaway debug profile.

Why this is needed
------------------
The AI connections are reached over HTTP, and `manifest.json` lists those hosts
as **optional** permissions. At runtime ThunderAI asks for them with
`messenger.permissions.request()`, which opens a doorhanger the user clicks --
and for a localhost host (`js/mzta-connection-test.js:_requestHostPermission`)
the requested origin is `<all_urls>`.

An automated run has nobody to click that doorhanger, so the grant is written
directly into the profile's permission store instead. This is the same state the
profile would be in after a user clicked "Allow" once.

Scope: this only ever affects the harness's throwaway profile
(`%LOCALAPPDATA%\\Temp\\thunderai-debug-profile`), which is recreated from
scratch on every run with `reset_profile=True`. It grants nothing in the user's
real Thunderbird profile.
"""

import time

import config

_ADD = """
  const resolve = arguments[arguments.length - 1];
  (async () => {
    try {
      const { ExtensionPermissions } = ChromeUtils.importESModule(
        'resource://gre/modules/ExtensionPermissions.sys.mjs');
      const id = arguments[0];
      const origins = arguments[1];
      const permissions = arguments[2];
      const policy = WebExtensionPolicy.getByID(id);
      if (!policy) return resolve('ERR:extension is not running');
      await ExtensionPermissions.add(
        id, {permissions: permissions, origins: origins}, policy.extension);
      resolve('OK');
    } catch (e) { resolve('ERR:' + String(e)); }
  })();
"""

_LIST = """
  const resolve = arguments[arguments.length - 1];
  (async () => {
    try {
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      if (!policy) return resolve('ERR:extension is not running');
      const ext = policy.extension;
      const pats = ext.allowedOrigins ? ext.allowedOrigins.patterns : [];
      resolve(JSON.stringify(Array.from(pats).map(p => p.pattern)));
    } catch (e) { resolve('ERR:' + String(e)); }
  })();
"""


class PermissionError_(RuntimeError):
    pass


def grant(marionette, origins=("<all_urls>",), permissions=(), settle=1.5):
    """Grant optional origins/permissions to ThunderAI in this profile."""
    with marionette.using_context("chrome"):
        result = marionette.execute_async_script(
            _ADD,
            script_args=[config.EXT_ID, list(origins), list(permissions)],
            sandbox="system",
        )
    if result != "OK":
        raise PermissionError_(
            "could not grant {} to {}: {}".format(origins, config.EXT_ID, result)
        )
    # The extension re-reads its permission set asynchronously.
    time.sleep(settle)
    print("[perm] granted origins={} permissions={}".format(
        list(origins), list(permissions)))
    return True


def allowed_origins(marionette):
    """The origin patterns the extension currently holds (for diagnostics)."""
    import json
    with marionette.using_context("chrome"):
        raw = marionette.execute_async_script(
            _LIST, script_args=[config.EXT_ID], sandbox="system"
        )
    if isinstance(raw, str) and raw.startswith("ERR:"):
        raise PermissionError_(raw[4:])
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return []
