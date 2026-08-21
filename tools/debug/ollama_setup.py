"""Configure the Ollama connection through ThunderAI's real options UI.

Deliberately not a storage.sync write. The connection rows are injected by
`injectConnectionUI()` and the model list is filled by ThunderAI's own
`Ollama.fetchModels()`; seeding storage directly leaves the UI unaware (the
`connection_type` select renders empty and "Prova ora" has nothing to test).
Driving the real controls also means this doubles as a test of the settings UI.
"""

import time

import ext_storage


class OllamaSetupError(RuntimeError):
    pass


def configure(marionette, page, host="http://localhost:11434", model=None,
              fetch_timeout=30, test_timeout=60):
    """Select Ollama, set the host, fetch models, pick one, and run the test.

    `page` is the TabPage for the options page. Returns the chosen model and the
    connection-test status text.
    """
    # 1. connection_type -> ollama_api, via a real change event so the page's
    #    own handlers (showConnectionOptions, refreshConnTestVisibility, ...) run.
    got = page._chrome_script("""
      const d = found.contentDocument, win = found.contentWindow;
      const s = d.getElementById('connection_type');
      if (!s) return 'no-select';
      s.value = 'ollama_api';
      s.dispatchEvent(new win.Event('change', {bubbles: true}));
      return String(s.value);
    """)
    if got != "ollama_api":
        raise OllamaSetupError("could not select ollama_api (got {!r})".format(got))
    time.sleep(2)

    # 2. The host field.
    got = page._chrome_script("""
      const d = found.contentDocument, win = found.contentWindow;
      const el = d.getElementById('ollama_host');
      if (!el) return 'no-field';
      el.focus();
      el.value = arguments[0];
      el.dispatchEvent(new win.Event('input', {bubbles: true}));
      el.dispatchEvent(new win.Event('change', {bubbles: true}));
      el.blur();
      return String(el.value);
    """, script_args=[host])
    if got != host:
        raise OllamaSetupError("could not set ollama_host (got {!r})".format(got))
    time.sleep(2)

    # 3. "Aggiorna elenco" -- ThunderAI's own fetchModels() call. This is also
    #    the first real proof that the HTTP path and host permission work.
    clicked = page._chrome_script("""
      const b = found.contentDocument.getElementById('btnUpdateOllamaModels');
      if (!b) return false;
      b.click();
      return true;
    """)
    if not clicked:
        raise OllamaSetupError("the 'update models' button is missing")

    models = []
    deadline = time.time() + fetch_timeout
    while time.time() < deadline:
        raw = page._chrome_script("""
          const s = found.contentDocument.getElementById('ollama_model');
          if (!s) return null;
          return JSON.stringify(Array.from(s.options).map(o => o.value));
        """)
        if raw:
            import json
            models = [v for v in json.loads(raw) if v]
            if models:
                break
        time.sleep(1)
    if not models:
        raise OllamaSetupError(
            "no models came back from {} within {}s. Is Ollama running, and is "
            "OLLAMA_ORIGINS=moz-extension://* set?".format(host, fetch_timeout))
    print("[ollama] models offered: {}".format(models))

    # 4. Pick the model.
    chosen = model if (model and model in models) else models[0]
    if model and model not in models:
        print("[ollama] requested {!r} not offered; using {!r}".format(model, chosen))
    got = page._chrome_script("""
      const d = found.contentDocument, win = found.contentWindow;
      const s = d.getElementById('ollama_model');
      s.value = arguments[0];
      s.dispatchEvent(new win.Event('change', {bubbles: true}));
      return String(s.value);
    """, script_args=[chosen])
    if got != chosen:
        raise OllamaSetupError("could not select model {!r}".format(chosen))
    time.sleep(2)

    # 5. "Prova ora" -- the real connection test link. Note it is the <a>
    #    #mzta_conn_test_link that is clickable, NOT the #mzta_conn_test row.
    clicked = page._chrome_script("""
      const a = found.contentDocument.getElementById('mzta_conn_test_link');
      if (!a) return false;
      a.click();
      return true;
    """)
    status = ""
    if clicked:
        deadline = time.time() + test_timeout
        while time.time() < deadline:
            status = page._chrome_script("""
              const e = found.contentDocument.getElementById('mzta_conn_test_text');
              return e ? String(e.textContent).trim() : '';
            """) or ""
            low = status.lower()
            if any(k in low for k in ("connesso", "connected", "ok", "error",
                                      "errore", "fallit", "unreachable")):
                break
            time.sleep(1)
    print("[ollama] connection test: {!r}".format(status))

    stored = ext_storage.read_sync(marionette, page, {
        "connection_type": "", "ollama_host": "", "ollama_model": ""})
    if stored.get("connection_type") != "ollama_api":
        raise OllamaSetupError("connection_type did not persist: {!r}".format(stored))
    print("[ollama] stored: {}".format(stored))

    return {"model": chosen, "status": status, "stored": stored}
