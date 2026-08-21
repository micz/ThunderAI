"""UIDriver: chrome-window waiting, clicking, screenshots and DOM dumps.

Scope note: everything here operates in the CHROME context, because that is the
only context Marionette usefully exposes in Thunderbird (window_handles is
always empty -- see tab_page.py). For driving an extension page's DOM, use
TabPage; this class covers the application chrome around it.
"""

import base64
import time
from contextlib import contextmanager
from pathlib import Path

from marionette_driver import By, Wait
from marionette_driver.errors import (
    ElementNotInteractableException,
    NoSuchElementException,
    TimeoutException,
)

import config

CHROME = "chrome"
CONTENT = "content"


class UIDriver:
    def __init__(self, marionette, shot_dir=None, dom_dir=None, default_timeout=20):
        self.m = marionette
        self.shot_dir = Path(shot_dir) if shot_dir else config.SHOT_DIR
        self.dom_dir = Path(dom_dir) if dom_dir else config.DOM_DIR
        self.default_timeout = default_timeout
        self.shot_dir.mkdir(parents=True, exist_ok=True)
        self.dom_dir.mkdir(parents=True, exist_ok=True)
        # Shared prefix + counter so artifacts sort chronologically and
        # successive runs never overwrite each other.
        self.run_stamp = time.strftime("%Y%m%d-%H%M%S")
        self._seq = 0

    # -- context switching ----------------------------------------------------

    def set_context(self, ctx):
        self.m.set_context(ctx)

    @contextmanager
    def chrome(self):
        with self.m.using_context(CHROME):
            yield self

    # -- chrome element helpers -----------------------------------------------

    def wait_for_element(self, element_id=None, *, css=None, timeout=None,
                         visible=True):
        """Wait for an element in the chrome document and return it.

        ignored_exceptions is required: without it the very first poll raises
        NoSuchElementException instead of retrying.
        """
        if not element_id and not css:
            raise ValueError("wait_for_element needs element_id or css")

        by, target = ((By.ID, element_id) if element_id else (By.CSS_SELECTOR, css))
        timeout = self.default_timeout if timeout is None else timeout

        def _present(m):
            try:
                el = m.find_element(by, target)
            except NoSuchElementException:
                return None
            if visible and not el.is_displayed():
                return None
            return el

        with self.chrome():
            try:
                return Wait(self.m, timeout=timeout, interval=0.25).until(
                    _present,
                    message="waiting for {}={!r} (visible={})".format(
                        by, target, visible),
                )
            except TimeoutException:
                label = "timeout-{}".format(
                    str(element_id or css).replace("#", "").replace(" ", "-")[:40]
                )
                self._safe_artifacts(label)
                raise

    def click_by_id(self, element_id, *, timeout=None):
        with self.chrome():
            el = self.wait_for_element(element_id, timeout=timeout)
            try:
                el.click()
            except ElementNotInteractableException:
                # Fall back to a scripted click for elements Marionette
                # considers un-interactable (offscreen, zero-size wrappers).
                self.m.execute_script("arguments[0].click();", script_args=[el])
            return el

    # -- artifacts ------------------------------------------------------------

    def _next_name(self, name, ext):
        self._seq += 1
        safe = "".join(c if (c.isalnum() or c in "-_") else "-" for c in name)
        return "{}_{:03d}_{}.{}".format(self.run_stamp, self._seq, safe, ext)

    def screenshot(self, name, *, full=True, element_id=None):
        """Save a PNG of the current chrome window."""
        path = self.shot_dir / self._next_name(name, "png")

        with self.chrome():
            element = None
            if element_id:
                try:
                    element = self.m.find_element(By.ID, element_id)
                except NoSuchElementException:
                    element = None
            try:
                data = self.m.screenshot(element=element, format="binary", full=full)
            except Exception:
                # Some builds/paths only produce base64.
                data = self.m.screenshot(element=element, format="base64", full=full)

        if isinstance(data, str):
            data = base64.b64decode(data)

        # Binary mode always -- text mode would corrupt the PNG on Windows.
        path.write_bytes(data)
        print("[ui] screenshot -> {}".format(path))
        return path

    def dump_chrome_dom(self, name):
        """Serialize the chrome document (not an extension page -- see TabPage).

        encoding="utf-8" is not optional on Windows: the default cp1252 raises
        UnicodeEncodeError on ThunderAI's localized strings.
        """
        path = self.dom_dir / self._next_name(name, "html")
        with self.chrome():
            try:
                html = self.m.execute_script(
                    "return document.documentElement.outerHTML;"
                )
            except Exception:
                html = ""
        path.write_text(html or "", encoding="utf-8")
        print("[ui] chrome dom -> {}".format(path))
        return path

    def dump_page_dom(self, page, name):
        """Dump an extension page's DOM, using the harness artifact naming."""
        return page.dump_dom(self._next_name(name, "html")[:-5], dom_dir=self.dom_dir)

    def _safe_artifacts(self, label):
        """Best-effort screenshot + DOM dump on a failure path."""
        for fn in (lambda: self.screenshot(label), lambda: self.dump_chrome_dom(label)):
            try:
                fn()
            except Exception as exc:
                print("[ui] could not capture {}: {}".format(label, exc))

    # -- window readiness -----------------------------------------------------

    def wait_for_3pane(self, timeout=90):
        """Wait until Thunderbird's main mail window really exists.

        Done before anything else: a startup dialog would otherwise silently
        swallow every later interaction, producing a confusing failure far from
        the real cause.
        """
        script = (
            "const w = Services.wm.getMostRecentWindow('mail:3pane');"
            "return !!(w && w.document && w.document.readyState === 'complete');"
        )
        with self.chrome():
            try:
                Wait(self.m, timeout=timeout, interval=0.5).until(
                    lambda m: m.execute_script(script, sandbox="system") is True,
                    message="waiting for a ready mail:3pane window",
                )
            except TimeoutException:
                self._safe_artifacts("timeout-3pane")
                raise
        return True
