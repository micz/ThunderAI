"""TabPage: drive an extension page opened in a real Thunderbird content tab.

Why this exists instead of Marionette's normal content-context API:

Marionette in Thunderbird never populates window_handles -- there is no content
browsing context to switch to, so marionette.navigate() raises
"Browsing context has been discarded" and switch_to_frame() on the tab's
XULFrameElement raises NoSuchFrameException. Both were verified against
Thunderbird 154.

What does work is opening a real contentTab via tabmail (exactly what a user's
click does) and then reaching its document through browser.contentDocument from
the chrome context. That requires the browser to be in-process, which is what
the fission/remote prefs in config.PREFS are for.
"""

import time

import config

# Locate the tab's <browser> element by URL substring. Injected into other
# scripts, which then use the `found` binding.
#
# Every mail:3pane window is scanned rather than just getMostRecentWindow():
# opening a compose window (or any other window) makes it the most recent, and
# the tab we want lives in the 3pane behind it. Relying on "most recent" made
# scripts fail with "Browsing context has been discarded" as soon as a compose
# window was in play.
_FIND_TEMPLATE = """
  let found = null;
  const _en = Services.wm.getEnumerator('mail:3pane');
  while (_en.hasMoreElements() && !found) {
    const w = _en.getNext();
    const tabmail = w.document && w.document.getElementById('tabmail');
    if (!tabmail || !tabmail.tabInfo) continue;
    for (const t of tabmail.tabInfo) {
      const b = tabmail.getBrowserForTab(t);
      const u = b && b.currentURI ? b.currentURI.spec : null;
      if (u && u.includes(%(needle)s)) { found = b; break; }
    }
  }
"""

_OPEN_TAB = """
  const w = Services.wm.getMostRecentWindow('mail:3pane');
  w.document.getElementById('tabmail').openTab('contentTab', {url: arguments[0]});
"""


class PageError(RuntimeError):
    pass


class TabPage:
    """A single extension page living in a Thunderbird content tab."""

    def __init__(self, marionette, url, needle):
        self.m = marionette
        self.url = url
        # A substring that identifies this page's tab, e.g. "mzta-options".
        self.needle = needle

    # -- script plumbing ------------------------------------------------------

    def find_snippet(self):
        """JS that binds `found` to this page's <browser>, or null."""
        return _FIND_TEMPLATE % {"needle": _js_string(self.needle)}

    def _chrome_script(self, body, script_args=None):
        script = self.find_snippet() + body
        with self.m.using_context("chrome"):
            return self.m.execute_script(
                script, script_args=script_args or [], sandbox="system"
            )

    # -- lifecycle ------------------------------------------------------------

    def open(self, timeout=45):
        """Open the page in a new content tab and wait for it to be usable."""
        with self.m.using_context("chrome"):
            self.m.execute_script(
                _OPEN_TAB, script_args=[self.url], sandbox="system"
            )
        self.wait_until_ready(timeout=timeout)
        return self

    def is_open(self):
        return bool(self._chrome_script("return !!found;"))

    def close(self):
        """Close this page's tab.

        Needed before invoking a prompt: the prompt's act() resolves its target
        with browser.tabs.query({active: true, currentWindow: true}), and an open
        options tab in the 3pane wins that query over a compose window in its own
        window -- so the prompt would read the options page's (empty) selection
        and abort.
        """
        closed = self._chrome_script("""
          if (!found) return false;
          const _en2 = Services.wm.getEnumerator('mail:3pane');
          while (_en2.hasMoreElements()) {
            const w = _en2.getNext();
            const tabmail = w.document && w.document.getElementById('tabmail');
            if (!tabmail || !tabmail.tabInfo) continue;
            for (const t of tabmail.tabInfo) {
              const b = tabmail.getBrowserForTab(t);
              if (b === found) { tabmail.closeTab(t); return true; }
            }
          }
          return false;
        """)
        return bool(closed)

    def wait_until_ready(self, timeout=45):
        """Wait until the document is parsed and reachable in-process.

        A null contentDocument here means the browser is out-of-process, which
        is a config problem rather than a timing one -- so say so explicitly
        instead of timing out with no explanation.
        """
        deadline = time.time() + timeout
        saw_remote = False
        while time.time() < deadline:
            state = self._chrome_script("""
              if (!found) return 'no-tab';
              if (found.isRemoteBrowser && !found.contentDocument) return 'remote';
              const d = found.contentDocument;
              if (!d) return 'no-doc';
              return String(d.readyState);
            """)
            if state == "remote":
                saw_remote = True
            if state in ("interactive", "complete"):
                return True
            time.sleep(0.25)

        if saw_remote:
            raise PageError(
                "the tab for {!r} is an out-of-process browser, so its document "
                "cannot be reached from the chrome context. The fission / "
                "extensions.webextensions.remote prefs in config.PREFS are not "
                "in effect.".format(self.needle)
            )
        raise PageError(
            "the tab for {!r} never became ready within {}s".format(self.needle, timeout)
        )

    def wait_for_element(self, element_id, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._chrome_script(
                "return !!(found && found.contentDocument && "
                "found.contentDocument.getElementById(arguments[0]));",
                script_args=[element_id],
            ):
                return True
            time.sleep(0.25)
        raise PageError("#{} never appeared in {!r} within {}s".format(
            element_id, self.needle, timeout))

    # -- DOM access -----------------------------------------------------------

    def get_value(self, element_id):
        value = self._chrome_script("""
          if (!found || !found.contentDocument) return null;
          const el = found.contentDocument.getElementById(arguments[0]);
          return el ? String(el.value) : null;
        """, script_args=[element_id])
        if value is None:
            raise PageError("#{} not found in {!r}".format(element_id, self.needle))
        return value

    def set_value(self, element_id, value):
        """Set a text input and fire the events ThunderAI listens for.

        ThunderAI binds saveOptions to 'change' (mzta-options.js:558). For
        <input type=text> Gecko fires 'change' only on blur or Enter -- a bare
        value assignment fires nothing at all, so the save would never happen.

        The synthetic events are not a cheat: saveOptions(e) reads only
        e.preventDefault(), e.target.type, e.target.id and e.target.value --
        there is no isTrusted check -- so this drives the identical code path.
        The events are constructed with the page's own Event constructor so they
        are same-origin objects rather than sandbox ones.
        """
        ok = self._chrome_script("""
          if (!found || !found.contentDocument) return false;
          const d = found.contentDocument, win = found.contentWindow;
          const el = d.getElementById(arguments[0]);
          if (!el) return false;
          el.focus();
          el.value = arguments[1];
          el.dispatchEvent(new win.Event('input', {bubbles: true}));
          el.dispatchEvent(new win.Event('change', {bubbles: true}));
          el.blur();
          return true;
        """, script_args=[element_id, value])
        if not ok:
            raise PageError("could not set #{} in {!r}".format(element_id, self.needle))
        return True

    def click(self, element_id):
        ok = self._chrome_script("""
          if (!found || !found.contentDocument) return false;
          const el = found.contentDocument.getElementById(arguments[0]);
          if (!el) return false;
          el.click();
          return true;
        """, script_args=[element_id])
        if not ok:
            raise PageError("could not click #{} in {!r}".format(element_id, self.needle))
        return True

    def wait_for_restore(self, timeout=20, settle=1.5):
        """Wait out restoreOptions(), which races with our writes.

        restoreOptions() runs inside DOMContentLoaded and writes into every
        .option-input. Writing before it finishes means restore overwrites us --
        and it leaves no completion flag to wait on. So we wait on a post-restore
        side effect (connection_type populated) and then settle briefly, while
        the caller additionally verifies its write and retries once.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            populated = self._chrome_script("""
              if (!found || !found.contentDocument) return false;
              const el = found.contentDocument.getElementById('connection_type');
              return !!(el && el.options && el.options.length > 0);
            """)
            if populated:
                break
            time.sleep(0.25)
        else:
            print("[page] WARNING: connection_type never populated; "
                  "continuing with the settle delay only")
        time.sleep(settle)
        return True

    def outer_html(self):
        """Serialize the page, with live form state reflected into attributes.

        outerHTML alone is misleading evidence for this harness: a text input's
        current value lives in the .value *property*, and is not serialized as a
        value= attribute. A dump taken right after a successful save would show
        no value at all, which reads as a failure. So mirror the live state of
        every input/select/textarea into attributes on a clone first.
        """
        return self._chrome_script("""
          if (!found || !found.contentDocument) return '';
          const d = found.contentDocument;
          const clone = d.documentElement.cloneNode(true);
          const src = d.querySelectorAll('input, select, textarea');
          const dst = clone.querySelectorAll('input, select, textarea');
          for (let i = 0; i < src.length && i < dst.length; i++) {
            const s = src[i], t = dst[i];
            if (s.type === 'checkbox' || s.type === 'radio') {
              if (s.checked) { t.setAttribute('checked', 'checked'); }
              else { t.removeAttribute('checked'); }
            } else if (s.tagName === 'TEXTAREA') {
              t.textContent = s.value;
            } else if (s.tagName === 'SELECT') {
              t.setAttribute('data-live-value', String(s.value));
            } else {
              t.setAttribute('value', String(s.value));
            }
          }
          return String(clone.outerHTML);
        """) or ""

    def dump_dom(self, name, dom_dir=None):
        """Write the page's DOM. utf-8 is mandatory on Windows: the cp1252
        default raises UnicodeEncodeError on ThunderAI's localized strings."""
        from pathlib import Path
        target_dir = Path(dom_dir) if dom_dir else config.DOM_DIR
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / "{}.html".format(name)
        path.write_text(self.outer_html(), encoding="utf-8")
        print("[page] dom -> {}".format(path))
        return path


def options_page(marionette, uuid=None):
    """A TabPage for the ThunderAI options page."""
    url = config.options_url(uuid) if uuid else config.options_url()
    return TabPage(marionette, url, "mzta-options")


def close_extension_tabs(marionette):
    """Close every moz-extension:// content tab in the 3pane.

    Call this before invoking a prompt that targets a compose window. A prompt's
    act() resolves its target with
    browser.tabs.query({active: true, currentWindow: true}); any extension tab
    left open in the 3pane (the options page, and the onboarding tab ThunderAI
    opens on install) wins that query and the prompt reads the wrong selection.
    """
    with marionette.using_context("chrome"):
        return marionette.execute_script("""
          let closed = 0;
          const en = Services.wm.getEnumerator('mail:3pane');
          while (en.hasMoreElements()) {
            const w = en.getNext();
            const tabmail = w.document && w.document.getElementById('tabmail');
            if (!tabmail || !tabmail.tabInfo) continue;
            for (const t of Array.from(tabmail.tabInfo)) {
              const b = tabmail.getBrowserForTab(t);
              const u = b && b.currentURI ? b.currentURI.spec : '';
              if (u && u.startsWith('moz-extension://')) {
                try { tabmail.closeTab(t); closed++; } catch (e) {}
              }
            }
          }
          return closed;
        """, sandbox="system")


def _js_string(value):
    """Quote a Python string as a JS string literal."""
    escaped = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return "'{}'".format(escaped)
