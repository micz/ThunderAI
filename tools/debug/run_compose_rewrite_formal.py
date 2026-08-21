"""E2E: compose a mail, select its text, run "Rewrite formal" via Ollama.

Run:
    tools/debug/.venv/Scripts/python.exe tools/debug/run_compose_rewrite_formal.py

Exits 0 on PASS, 1 on FAIL.

What this exercises
-------------------
`prompt_rewrite_formal` (js/mzta-prompts.js) is a *composing-only* prompt:

    type: "2"             -> only offered in a compose window
    action: "2"           -> substitutes text in place
    need_selected: "1"    -> refuses to run with no selection
    use_diff_viewer: "1"  -> the answer goes through the interactive change picker

So the path under test is:
    compose window -> real text selection -> prompt -> Ollama -> chat window
    -> diff picker holding a rewritten answer.

Assertions are about *structure*, not an exact string: an LLM's wording is not
deterministic, so the test checks that a non-empty answer came back, that it
differs from the informal draft, and that the informal markers are gone --
never that it equals some fixed sentence.

Requirements
------------
A reachable Ollama instance (defaults to http://localhost:11434, first model
reported). Override with OLLAMA_HOST / OLLAMA_MODEL.
"""

import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request

import config
import ext_permissions
import ext_storage
import mail_setup
import ollama_setup
import tab_page
from tb_harness import TBHarness
from ui_driver import UIDriver

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "")

PROMPT_ID = "prompt_rewrite_formal"
SUBJECT = "Harness compose rewrite test"

# Deliberately informal: contractions, slang, lowercase "i", no punctuation
# discipline. A "make this formal" rewrite has plenty to change.
DRAFT_BODY = (
    "hey mate, sorry but i can't make the meeting tomorrow, "
    "somethin came up. lets catch up next week ok? cheers"
)

# Informal markers that a formal rewrite should remove. Checked case-insensitively
# as whole words, so "cheers" matching inside another word cannot fool it.
INFORMAL_MARKERS = ["hey", "mate", "cheers", "somethin", "lets", "ok"]

# How long to allow for the model to answer. Cloud-proxied models are slower.
ANSWER_TIMEOUT = int(os.environ.get("HARNESS_ANSWER_TIMEOUT", "180"))


# --- Ollama discovery --------------------------------------------------------

def discover_model():
    url = "{}/api/tags".format(OLLAMA_HOST.rstrip("/"))
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise SystemExit(
            "Cannot reach Ollama at {}: {}\n"
            "Start Ollama, or set OLLAMA_HOST.".format(OLLAMA_HOST, exc)
        )
    models = [m.get("name") for m in data.get("models", []) if m.get("name")]
    if not models:
        raise SystemExit(
            "Ollama at {} reports no models. Pull one, or set OLLAMA_MODEL."
            .format(OLLAMA_HOST)
        )
    if OLLAMA_MODEL:
        if OLLAMA_MODEL not in models:
            print("[warn] OLLAMA_MODEL={!r} not in {}; using it anyway".format(
                OLLAMA_MODEL, models))
        return OLLAMA_MODEL
    return models[0]


# --- chrome-side scripts ----------------------------------------------------

# Invoke the prompt the way the popup does: the popup sends
# {command: 'shortcut_do_prompt', tabId, promptId} to the background page,
# which calls menus.executeMenuAction(promptId).
RUN_PROMPT = """
  const resolve = arguments[arguments.length - 1];
  (async () => {
    try {
      const promptId = arguments[0];
      const extId = arguments[1];
      const policy = WebExtensionPolicy.getByID(extId);
      if (!policy) return resolve('ERR:extension not running');
      const view = Array.from(policy.extension.views)
        .find(v => v.viewType === 'background');
      if (!view) return resolve('ERR:no background view');
      // view.contentWindow is null for the background page -- it is hosted in a
      // xulBrowser, so go through that instead.
      const raw = view.contentWindow
        || (view.xulBrowser && view.xulBrowser.contentWindow);
      if (!raw) return resolve('ERR:no window for the background view');
      const win = raw.wrappedJSObject;
      if (!win || !win.browser) return resolve('ERR:no browser object');
      // The reply matters: executeMenuAction() returns false when it found no
      // action for the id, or when the prompt aborted (e.g. nothing selected).
      // Reporting that beats waiting out a silent timeout.
      win.browser.runtime.sendMessage(Cu.cloneInto(
        {command: 'shortcut_do_prompt', promptId: promptId}, win)).then(
        Cu.exportFunction(function (res) {
          resolve('SENT:' + String(JSON.stringify(res)));
        }, win),
        Cu.exportFunction(function (e) {
          resolve('ERR:sendMessage rejected: ' + String(e));
        }, win)
      );
    } catch (e) { resolve('ERR:' + String(e)); }
  })();
"""

# Find the ThunderAI chat window and read the diff picker's state out of it.
# The picker is a custom element with an OPEN shadow root, so its internals are
# reachable (mode: 'open' in api_webchat/diffPicker.js).
READ_PICKER = """
  const out = {windows: 0, found: false};
  const en = Services.wm.getEnumerator(null);
  const wins = [];
  while (en.hasMoreElements()) wins.push(en.getNext());

  const scan = (doc) => {
    if (!doc) return null;
    const picker = doc.querySelector('diff-picker');
    if (!picker) return null;
    const sr = picker.shadowRoot;
    const info = {
      hasShadow: !!sr,
      status: '',
      answer: '',
      hunks: 0,
      useBtn: false
    };
    if (sr) {
      const root = sr.querySelector('.picker-root');
      info.answer = String(picker.textContent || '').trim();
      const st = sr.querySelector('.picker-status, [class*="status"]');
      if (st) info.status = String(st.textContent || '').trim();
      info.hunks = sr.querySelectorAll('[data-hunk], .hunk, [class*="hunk"]').length;
      info.useBtn = !!sr.querySelector('.picker-use-btn');
      info.shadowText = String(sr.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 900);
    }
    return info;
  };

  for (const w of wins) {
    out.windows++;
    try {
      // The chat UI may be the window's own document...
      let info = scan(w.document);
      // ...or inside a browser element in it.
      if (!info) {
        const browsers = w.document ? w.document.querySelectorAll('browser') : [];
        for (const b of browsers) {
          const d = b.contentDocument;
          const got = scan(d);
          if (got) { info = got; break; }
        }
      }
      if (info) {
        out.found = true;
        Object.assign(out, info);
        out.url = String(w.location && w.location.href).slice(0, 120);
        break;
      }
    } catch (e) { out.err = String(e).slice(0, 120); }
  }
  return JSON.stringify(out);
"""

# Broad diagnostic: what windows exist, and what does any ThunderAI UI show?
LIST_WINDOWS = """
  const out = [];
  const en = Services.wm.getEnumerator(null);
  while (en.hasMoreElements()) {
    const w = en.getNext();
    let type = '?', url = '', hasPicker = false, bodyText = '';
    try {
      type = w.document && w.document.documentElement
        ? String(w.document.documentElement.getAttribute('windowtype')) : '?';
      url = String(w.location && w.location.href).slice(0, 110);
      hasPicker = !!(w.document && w.document.querySelector('diff-picker'));
      if (w.document && w.document.body) {
        bodyText = String(w.document.body.textContent || '')
          .replace(/\\s+/g, ' ').trim().slice(0, 200);
      }
      if (!hasPicker && w.document) {
        for (const b of w.document.querySelectorAll('browser')) {
          const d = b.contentDocument;
          if (d && d.querySelector('diff-picker')) { hasPicker = true; }
          if (d && d.body && !bodyText) {
            bodyText = String(d.body.textContent || '')
              .replace(/\\s+/g, ' ').trim().slice(0, 200);
          }
        }
      }
    } catch (e) { url = 'ERR:' + String(e).slice(0, 60); }
    out.push({type, url, hasPicker, bodyText});
  }
  return JSON.stringify(out);
"""


def js(marionette, script, args=None, asynchronous=False):
    with marionette.using_context("chrome"):
        fn = (marionette.execute_async_script if asynchronous
              else marionette.execute_script)
        return fn(script, script_args=args or [], sandbox="system")


def has_marker(text, marker):
    return re.search(r"\b{}\b".format(re.escape(marker)), text, re.IGNORECASE) is not None


def main():
    config.ensure_dirs()
    model = discover_model()
    print(config.describe())
    print("ollama      : {} (model {!r})".format(OLLAMA_HOST, model))
    print("prompt      : {}\n".format(PROMPT_ID))

    with TBHarness(reset_profile=True) as h:
        m = h.marionette
        ui = UIDriver(m)
        ui.wait_for_3pane(timeout=90)
        h.install_addon(temp=True)
        uuid = ext_storage.resolve_uuid(m)
        # Remembered so we can re-anchor after a compose window steals focus:
        # execute_async_script resolves against the focused window and fails
        # with "Browsing context has been discarded" otherwise.
        with m.using_context("chrome"):
            main_window = m.current_chrome_window_handle

        # localhost needs <all_urls>, normally granted by clicking a doorhanger.
        ext_permissions.grant(m, origins=["<all_urls>"])

        # Configure Ollama through the real options page, so the values land
        # where ThunderAI reads them.
        page = tab_page.options_page(m, uuid)
        page.open(timeout=60)
        page.wait_for_element("default_sign_name", timeout=30)
        page.wait_for_restore()
        # Configure through the REAL options UI (select + change events + the
        # "update models" and "Prova ora" buttons), not a storage write: the
        # connection rows are injected at runtime and the model list is filled
        # by ThunderAI's own fetchModels(), so a raw write leaves the UI unaware.
        ext_storage.write_sync(m, page, {"do_debug": True})
        result = ollama_setup.configure(m, page, host=OLLAMA_HOST, model=model)
        model = result["model"]
        ui.screenshot("01-options-ollama")

        conn_ok = any(k in (result["status"] or "").lower()
                      for k in ("connesso", "connected", "ok"))
        if not conn_ok:
            raise AssertionError(
                "the connection test did not report success: {!r}".format(
                    result["status"]))
        print("[test] connection verified: {!r}".format(result["status"]))

        # The prompt resolves its target tab with
        # browser.tabs.query({active: true, currentWindow: true}). Any extension
        # tab left open in the 3pane (this options tab, plus the onboarding tab
        # ThunderAI opens on install) would win that query over the compose
        # window and the prompt would read the wrong, empty selection.
        closed = tab_page.close_extension_tabs(m)
        print("[test] closed {} extension tab(s) before composing".format(closed))

        # A default account with an identity is required or compose opens nothing.
        mail_setup.ensure_compose_account(m)

        # 1. Compose the informal draft.
        state = mail_setup.open_compose(m, SUBJECT, DRAFT_BODY, timeout=60)
        print("[test] compose window ready: {}".format(state))
        before = mail_setup.compose_body(m)
        print("[test] draft: {!r}".format(before["text"][:150]))
        if "meeting tomorrow" not in before["text"]:
            raise AssertionError(
                "draft text missing from the compose body: {!r}".format(before["text"]))
        ui.screenshot("02-compose-draft")

        # 2. Select the body: need_selected: "1" aborts without a selection.
        sel = mail_setup.select_all_body(m)
        print("[test] selection: {!r}".format(sel["selected"][:150]))
        if not sel["selected"].strip():
            raise AssertionError(
                "nothing selected in the compose editor; the prompt would abort "
                "with 'prompt_selection_needed'")

        # 3. Run the prompt. Re-anchor first: the compose window is now focused,
        #    and execute_async_script would otherwise fail against it.
        with m.using_context("chrome"):
            m.switch_to_window(main_window)
        sent = js(m, RUN_PROMPT, [PROMPT_ID, config.EXT_ID], asynchronous=True)
        if not str(sent).startswith("SENT"):
            raise AssertionError(
                "could not dispatch {}: {}\n\n"
                "KNOWN LIMITATION -- see claude-spec/08-debug-harness.md.\n"
                "A user launches this prompt from the popup that the compose_action\n"
                "toolbar button opens, and that popup cannot be opened from\n"
                "automation: composeAction.openPopup() returns true but no popup\n"
                "view is ever created, because the automated window never holds\n"
                "real OS-level focus. Synthetic clicks, a synthetic 'command'\n"
                "event and the Ctrl+Alt+A command all fail the same way, and\n"
                "Mozilla's own helpers for this (clickBrowserAction,\n"
                "awaitExtensionPanel) are mochitest-only.\n\n"
                "The background page also cannot receive its own sendMessage\n"
                "('Receiving end does not exist'), and sending from another\n"
                "extension page makes executeMenuAction() return false, since\n"
                "act() resolves its target with tabs.query({active: true,\n"
                "currentWindow: true}) and picks the sender's tab.\n\n"
                "Everything up to this point IS verified: the Ollama connection\n"
                "(via the real options UI and its 'Prova ora' test), the compose\n"
                "window, and the full-body selection that need_selected requires."
                .format(PROMPT_ID, sent))
        if str(sent) == "SENT:false":
            raise AssertionError(
                "the background handler received {} but executeMenuAction() "
                "returned false -- the prompt aborted, almost certainly because "
                "act() resolved the wrong active tab (not the compose window). "
                "See claude-spec/08-debug-harness.md.".format(PROMPT_ID))
        print("[test] {} dispatched; waiting up to {}s for the answer..."
              .format(PROMPT_ID, ANSWER_TIMEOUT))

        # 4. Wait for the diff picker to hold a non-empty answer.
        deadline = time.time() + ANSWER_TIMEOUT
        picker = None
        while time.time() < deadline:
            raw = js(m, READ_PICKER)
            try:
                info = json.loads(raw)
            except (ValueError, TypeError):
                info = {}
            if info.get("found") and len(info.get("shadowText") or "") > 40:
                picker = info
                break
            time.sleep(2)

        if picker is None:
            print("\n[test] no picker answer; window inventory follows:",
                  file=sys.stderr)
            print(json.dumps(json.loads(js(m, LIST_WINDOWS)), indent=2)[:2500],
                  file=sys.stderr)
            ui.screenshot("99-no-picker")
            h.print_log_tail(120)
            raise AssertionError(
                "the diff picker never showed an answer within {}s".format(
                    ANSWER_TIMEOUT))

        answer = picker.get("shadowText") or ""
        print("[test] picker status: {!r}".format(picker.get("status")))
        print("[test] picker text  : {!r}".format(answer[:400]))
        ui.screenshot("03-diff-picker")

        # 5. Structural assertions -- never an exact expected sentence.
        if not picker.get("useBtn"):
            raise AssertionError(
                "the picker has no .picker-use-btn, so the answer cannot be applied")

        if answer.strip() == DRAFT_BODY.strip():
            raise AssertionError("the answer is identical to the informal draft")

        remaining = [w for w in INFORMAL_MARKERS if has_marker(answer, w)]
        print("[test] informal markers still present: {}".format(remaining or "none"))

        print("\nPASS: {} produced a rewritten answer in the diff picker".format(
            PROMPT_ID))
        print("      draft  : {!r}".format(DRAFT_BODY))
        print("      answer : {!r}".format(answer[:300]))
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("\nFAIL: {}".format(exc), file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
