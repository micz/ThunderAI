"""Extension UUID resolution and browser.storage.sync access.

ThunderAI saves to browser.storage.sync (options/mzta-options.js:86), NOT
storage.local. Anything reading storage.local would silently always see nothing
and every assertion would be meaningless -- this is the single easiest mistake
to make here.

How we reach storage.sync
-------------------------
Marionette's content context is unusable in Thunderbird: window_handles is
always empty, because there is no content browsing context to switch to. So
everything below runs in the CHROME context and reaches the options page
through the tab's <browser> element (see tab_page.py).

We still go through the page's OWN `browser.storage.sync` object rather than
calling ExtensionStorageSync internals directly. That matters: the internals
would work, but they bypass the very API layer ThunderAI uses, so a test built
on them could pass while the real code path is broken.

Two Gecko boundary rules make this fiddly, and both are load-bearing:
  * A sandbox object cannot be handed to a page function ("Permission denied to
    pass object to exported function"), so the query object is built with
    Cu.cloneInto and the callbacks with Cu.exportFunction.
  * The page's CSP blocks eval(), so the promise cannot be driven with
    win.eval(); the page's own then() stashes a plain string on its window and
    we poll for it.
"""

import json
import time

import config

# Chrome-context scripts want the system sandbox, for Services /
# WebExtensionPolicy / Cu.
UUID_FROM_POLICY = """
  try {
    const p = WebExtensionPolicy.getByID(arguments[0]);
    return p ? p.mozExtensionHostname : null;
  } catch (e) { return null; }
"""

UUID_FROM_PREF = """
  try {
    return Services.prefs.getStringPref('extensions.webextensions.uuids', '');
  } catch (e) { return ''; }
"""


class StorageError(RuntimeError):
    pass


def resolve_uuid(marionette, ext_id=config.EXT_ID, verbose=True):
    """Resolve the moz-extension:// hostname, in three descending layers.

    1. WebExtensionPolicy.mozExtensionHostname -- definitive: it *is* the
       hostname, with no transformation to get wrong.
    2. The extensions.webextensions.uuids pref map -- works even before the
       extension has started up.
    3. config.PINNED_UUID -- the value we seeded.

    If layer 1 disagrees with the pinned value we warn rather than fail: Gecko
    is free to ignore our seed, and the real hostname is the one that works.
    """
    with marionette.using_context("chrome"):
        found = marionette.execute_script(
            UUID_FROM_POLICY, script_args=[ext_id], sandbox="system"
        )
        if found:
            if found != config.PINNED_UUID and verbose:
                print("[storage] NOTE: live UUID {} != pinned {} "
                      "(using the live one)".format(found, config.PINNED_UUID))
            return found

        raw = marionette.execute_script(UUID_FROM_PREF, sandbox="system")

    if raw:
        try:
            mapped = json.loads(raw).get(ext_id)
            if mapped:
                if verbose:
                    print("[storage] UUID from uuids pref: {}".format(mapped))
                return mapped
        except (ValueError, AttributeError):
            pass

    if verbose:
        print("[storage] falling back to pinned UUID {}".format(config.PINNED_UUID))
    return config.PINNED_UUID


# --- storage.sync via the options page's own browser object -------------------

_START_GET = """
  %(find)s
  if (!found) throw new Error('options page browser not found');
  const win = found.contentWindow.wrappedJSObject;
  if (!win.browser || !win.browser.storage) {
    throw new Error('the page has no browser.storage (is it an extension page?)');
  }
  const query = Cu.cloneInto(JSON.parse(arguments[0]), win);
  win.__harness_done = false;
  win.__harness_val = '';
  win.browser.storage.sync.get(query).then(
    Cu.exportFunction(function (d) {
      win.__harness_val = JSON.stringify(d);
      win.__harness_done = true;
    }, win),
    Cu.exportFunction(function (e) {
      win.__harness_val = 'ERR:' + String(e);
      win.__harness_done = true;
    }, win)
  );
"""

_POLL = """
  %(find)s
  if (!found) return null;
  const win = found.contentWindow.wrappedJSObject;
  return win.__harness_done === true ? String(win.__harness_val) : null;
"""

_START_SET = """
  %(find)s
  if (!found) throw new Error('options page browser not found');
  const win = found.contentWindow.wrappedJSObject;
  const items = Cu.cloneInto(JSON.parse(arguments[0]), win);
  win.__harness_done = false;
  win.__harness_val = '';
  win.browser.storage.sync.set(items).then(
    Cu.exportFunction(function () {
      win.__harness_val = 'OK';
      win.__harness_done = true;
    }, win),
    Cu.exportFunction(function (e) {
      win.__harness_val = 'ERR:' + String(e);
      win.__harness_done = true;
    }, win)
  );
"""


def _await_result(marionette, page, timeout):
    """Poll the page-side stash until the promise settles."""
    script = _POLL % {"find": page.find_snippet()}
    deadline = time.time() + timeout
    while time.time() < deadline:
        with marionette.using_context("chrome"):
            raw = marionette.execute_script(script, sandbox="system")
        if raw is not None:
            if raw.startswith("ERR:"):
                raise StorageError(raw[4:])
            return raw
        time.sleep(0.25)
    raise StorageError("storage.sync call did not settle within {}s".format(timeout))


def read_sync(marionette, page, keys, timeout=20):
    """Read storage.sync through the options page's own API.

    `keys` should be a default-shaped dict ({key: default}), mirroring how
    restoreOptions() calls get(prefs_default): an absent key then comes back as
    its default rather than undefined.
    """
    with marionette.using_context("chrome"):
        marionette.execute_script(
            _START_GET % {"find": page.find_snippet()},
            script_args=[json.dumps(keys)],
            sandbox="system",
        )
    raw = _await_result(marionette, page, timeout)
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise StorageError("could not parse storage.sync result {!r}: {}".format(raw, exc))


def write_sync(marionette, page, items, timeout=20):
    """Write storage.sync directly.

    This is what makes the harness reusable beyond the one persistence test:
    future debug scripts can seed arbitrary state (e.g. set connection_type to
    un-gate the add_tags/summarize controls) without clicking through the UI.
    """
    with marionette.using_context("chrome"):
        marionette.execute_script(
            _START_SET % {"find": page.find_snippet()},
            script_args=[json.dumps(items)],
            sandbox="system",
        )
    _await_result(marionette, page, timeout)
    return True


def read_sync_pref(marionette, page, key, default="", timeout=20):
    """Read a single key, with the ThunderAI default shape."""
    return read_sync(marionette, page, {key: default}, timeout=timeout).get(key, default)


def wait_for_sync_value(marionette, page, key, expected_value, timeout=20, default=""):
    """Poll storage.sync until a key holds the expected value.

    Polling is mandatory, not defensive: saveOptions() ends in a bare
    browser.storage.sync.set(options) with no await and no .then(), so there is
    no page-side promise to wait on and no DOM signal that the write landed.
    """
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = read_sync_pref(marionette, page, key, default)
        if last == expected_value:
            return True
        time.sleep(0.5)
    raise StorageError(
        "storage.sync[{!r}] never became {!r}; last read was {!r}".format(
            key, expected_value, last)
    )
