"""Account setup for the debug profile, and compose-window helpers.

Why an account has to be created through the API
-----------------------------------------------
The pref-seeded "Local Folders" account in config.PREFS is enough to suppress
the first-run wizard, but **not** enough to compose a mail:

  * A Local Folders account has no identity, so there is no From: to send from.
  * Assigning one as `defaultAccount` fails outright with NS_ERROR_ILLEGAL_VALUE
    -- Thunderbird refuses a `type: "none"` server as the default account.
  * With no default account, `OpenComposeWindowWithParams` reports success and
    then silently opens nothing, which is a confusing failure to chase.

So `ensure_compose_account()` creates a **dummy POP3 account** and makes it the
default. It never connects anywhere (host localhost:110, never polled) -- it
exists purely so an identity exists and compose can open. This deliberately
avoids needing real credentials or network access in the harness.
"""

import json
import time

CREATE_ACCOUNT = """
  try {
    const { MailServices } = ChromeUtils.importESModule(
      'resource:///modules/MailServices.sys.mjs');
    const mgr = MailServices.accounts;
    const email = arguments[0];
    const fullName = arguments[1];

    // Reuse an existing usable default if a previous run left one behind
    // (relevant with reset_profile=False).
    try {
      if (mgr.defaultAccount && mgr.defaultAccount.defaultIdentity) {
        return JSON.stringify({
          reused: true,
          account: mgr.defaultAccount.key,
          identity: mgr.defaultAccount.defaultIdentity.email
        });
      }
    } catch (e) { /* no usable default yet */ }

    // A pop3 account can be the default; a 'none' (Local Folders) one cannot.
    const acct = mgr.createAccount();
    const srv = mgr.createIncomingServer('harness', 'localhost', 'pop3');
    srv.prettyName = 'ThunderAI Harness';
    srv.port = 110;
    // Never poll it -- there is no server there.
    srv.doBiff = false;
    srv.downloadOnBiff = false;
    acct.incomingServer = srv;

    const ident = mgr.createIdentity();
    ident.email = email;
    ident.fullName = fullName;
    acct.addIdentity(ident);
    mgr.defaultAccount = acct;

    return JSON.stringify({
      reused: false,
      account: acct.key,
      identity: mgr.defaultAccount.defaultIdentity.email
    });
  } catch (e) { return 'ERR:' + String(e); }
"""

OPEN_COMPOSE = """
  try {
    const { MailServices } = ChromeUtils.importESModule(
      'resource:///modules/MailServices.sys.mjs');
    const params = Cc['@mozilla.org/messengercompose/composeparams;1']
      .createInstance(Ci.nsIMsgComposeParams);
    const fields = Cc['@mozilla.org/messengercompose/composefields;1']
      .createInstance(Ci.nsIMsgCompFields);
    fields.to = arguments[0];
    fields.subject = arguments[1];
    fields.body = arguments[2];
    params.composeFields = fields;
    params.format = Ci.nsIMsgCompFormat.HTML;
    params.type = Ci.nsIMsgCompType.New;
    params.identity = MailServices.accounts.defaultAccount.defaultIdentity;
    MailServices.compose.OpenComposeWindowWithParams(null, params);
    return 'opened';
  } catch (e) { return 'ERR:' + String(e); }
"""

COMPOSE_STATE = """
  const en = Services.wm.getEnumerator('msgcompose');
  let count = 0, ready = false;
  while (en.hasMoreElements()) {
    const w = en.getNext();
    count++;
    try {
      const ed = w.GetCurrentEditorElement && w.GetCurrentEditorElement();
      if (ed && ed.contentDocument && ed.contentDocument.body) ready = true;
    } catch (e) {}
  }
  return JSON.stringify({count: count, ready: ready});
"""

READ_BODY = """
  const en = Services.wm.getEnumerator('msgcompose');
  while (en.hasMoreElements()) {
    const w = en.getNext();
    try {
      const doc = w.GetCurrentEditorElement().contentDocument;
      if (doc && doc.body) {
        return JSON.stringify({
          text: String(doc.body.textContent || ''),
          html: String(doc.body.innerHTML || '')
        });
      }
    } catch (e) {}
  }
  return JSON.stringify({text: '', html: ''});
"""

# Select the whole body, so prompts with need_selected: "1" will run.
SELECT_ALL_BODY = """
  const en = Services.wm.getEnumerator('msgcompose');
  while (en.hasMoreElements()) {
    const w = en.getNext();
    try {
      const ed = w.GetCurrentEditorElement();
      const doc = ed.contentDocument, win = ed.contentWindow;
      if (!doc || !doc.body) continue;
      w.focus();
      const range = doc.createRange();
      range.selectNodeContents(doc.body);
      const sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return JSON.stringify({selected: String(sel.toString())});
    } catch (e) { return 'ERR:' + String(e); }
  }
  return JSON.stringify({selected: ''});
"""

CLOSE_COMPOSE = """
  const en = Services.wm.getEnumerator('msgcompose');
  const wins = [];
  while (en.hasMoreElements()) wins.push(en.getNext());
  for (const w of wins) {
    try {
      // Drop the "unsaved changes" prompt, which would block the close.
      const ed = w.GetCurrentEditorElement();
      if (ed && ed.contentDocument && ed.contentDocument.body) {
        ed.contentDocument.body.innerHTML = '';
      }
      if (w.gMsgCompose) { w.gMsgCompose.bodyModified = false; }
      w.close();
    } catch (e) {}
  }
  return wins.length;
"""


class MailSetupError(RuntimeError):
    pass


def _js(marionette, script, args=None):
    with marionette.using_context("chrome"):
        return marionette.execute_script(
            script, script_args=args or [], sandbox="system"
        )


def ensure_compose_account(marionette, email="harness@example.invalid",
                           full_name="ThunderAI Harness"):
    """Make sure a default account with an identity exists."""
    raw = _js(marionette, CREATE_ACCOUNT, [email, full_name])
    if isinstance(raw, str) and raw.startswith("ERR:"):
        raise MailSetupError("could not create a compose account: {}".format(raw[4:]))
    info = json.loads(raw)
    print("[mail] default account {} identity {} ({})".format(
        info["account"], info["identity"],
        "reused" if info.get("reused") else "created"))
    return info


def open_compose(marionette, subject, body, to="someone@example.invalid",
                 timeout=60):
    """Open a compose window with the given draft and wait for its editor."""
    result = _js(marionette, OPEN_COMPOSE, [to, subject, body])
    if result != "opened":
        raise MailSetupError("OpenComposeWindowWithParams failed: {}".format(result))

    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = json.loads(_js(marionette, COMPOSE_STATE))
        if last.get("ready"):
            # The editor exists; give the body a moment to be filled in.
            time.sleep(1.5)
            return last
        time.sleep(0.5)

    raise MailSetupError(
        "no compose window became ready within {}s (last state: {}). If count is "
        "0, there is probably no default account with an identity -- call "
        "ensure_compose_account() first.".format(timeout, last)
    )


def compose_body(marionette):
    return json.loads(_js(marionette, READ_BODY))


def select_all_body(marionette):
    raw = _js(marionette, SELECT_ALL_BODY)
    if isinstance(raw, str) and raw.startswith("ERR:"):
        raise MailSetupError("could not select the compose body: {}".format(raw[4:]))
    return json.loads(raw)


def close_compose_windows(marionette):
    return _js(marionette, CLOSE_COMPOSE)
