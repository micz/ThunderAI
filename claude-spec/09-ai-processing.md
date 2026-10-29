# AI processing API v1

Authoritative working contract for companion testing, subject to maintainer review.
ThunderAI supports Thunderbird
140+, but the companion currently requires **Thunderbird 153+, 64-bit**.

## Trust and ownership

ThunderAI (`thunderai@micz.it`) talks only to
`thunderai-privacy@micz.it`, with exact sender-ID validation in both directions.
Internal broker requests accept only ThunderAI extension pages, not content scripts.
No model/runtime, placeholder parser or restoration map lives in ThunderAI; model
management, diagnostics and mappings belong solely to the companion.

## Activation switch

The one activation switch is ThunderAI's `ai_processing_enabled` preference ("Use
ThunderAI Privacy", advanced section of the options page, right before Debug). It is an
ordinary `prefs_default` boolean, so a policy can set or lock it. The companion's own
switch is a mirror: it reads and writes this preference through `getSetting` /
`setSetting`, and is kept in step by `settingChanged`. Both switches can be turned on
only once the companion's model is ready (see "Model readiness"); both can always be
turned off. A policy that forces the switch on is not gated: without the model, requests
block with the companion's `MODEL_NOT_READY` error.

The options page row is shown when `probe` finds a compatible companion, and also while
the switch is on, so a missing companion can still be switched off. Otherwise a notice
(`#no_privacy`, "not installed" or "incompatible") links to the add-on, as `#no_sparks`
does for Sparks. The page probes again on focus and follows the preference through
`storage.onChanged`.

While the switch is on (policy-resolved value, read at startup and on every
`storage.onChanged` of the key) ThunderAI shows it in two places:

- **Toolbar buttons.** The message display and compose buttons show the companion's icon
  (`images/privacy-icon-32px.png`, a copy of the companion's `icon-32px.png`) instead of
  ThunderAI's. `mzta-background.js` (`syncPrivacyIcon()`) calls
  `taWorkingStatus.setPrivacy()`, which sets the idle icon both buttons return to; the
  loading icon still wins while anything works, and the new idle icon shows once
  `WorkingLevel` drops back to zero.
- **API chat window.** A shield badge (`#appHeaderShield`, `buildShieldIcon()`: a
  17px dark green shield with a white check and a 1.5px white halo) covers the top-right half
  of the header logo and spills past its corner; the whole brand (`#appHeaderBrand`,
  logo and name) carries the `apiwebchat_privacy_active` tooltip, removed when the switch
  is off.
  The window follows the switch for as long as it stays open.

## Model readiness

The companion keeps a cached readiness (64-bit platform and complete model cache, no
deletion running), checked at its startup, after a download and after a deletion, so
discovery never starts a model worker. An evicted cache still blocks at the first mask,
with `MODEL_NOT_READY` and the companion's localized "download the model" message (a
cache lost between its check and the model load included); the companion then checks
its cache again and announces `ready: false`, so the options page and the autodownload
policy follow.
Status and `readinessChanged` carry `{ready, downloading, progress, error}` (`progress`
an integer percent while downloading, `error` the companion's localized message of the
last failed download).

The download runs in the companion's background: its Hugging Face hosts are required
manifest permissions, so no user gesture is needed and either add-on can start it. In
ThunderAI's row (`renderPrivacyCompanion()` in `options/mzta-options.js`), while the
companion is installed without its model: the switch is disabled unless already on, a
note (`#ai_processing_model`) and a "Download the model" button (`downloadModel`) show,
then the progress relayed by the background (`ai_processing_readiness`, from
`readinessChanged`). "Open ThunderAI Privacy settings" (`openSettings`) shows whenever a
compatible companion answers. The companion refuses to delete its model while the switch
is on or a download runs.

`ai_processing_model_autodownload` (policy-oriented, no UI) asks the companion for the
download when it reports `ready: false` and is not downloading: at ThunderAI startup
(one `hello`) and on every `readinessChanged`, which the companion sends at its own
startup too. One attempt per companion `instanceId`: a failed download is retried only
after either add-on restarts, while a `ready: true` announcement allows a new attempt, so
a model lost after it was ready (an evicted cache) is downloaded again. Each machine downloads the model from Hugging Face.
Combined with `ai_processing_enabled` locked on, requests block until the model is ready.

## Session facade

`createAIProcessingClient(transport).createSession()` provides `ready()`, `onBeforeSendToProvider(input)`,
`onAfterReceiveFromProvider(output, {format})`, `cancel()` and `dispose()`.
The facade generates a conversation `sessionId`, individual `requestId`s and
per-message `callId`s. Its opaque `context` is returned to the companion, never
interpreted. No processor: input/output are returned unchanged. Active processor:
every hook is awaited and any failure blocks the operation.
The background explicitly creates the broker in `mzta-ai-processing-broker.js`
and injects its dispatch transport into the client in `mzta-ai-processing-client.js`.
Pages use the runtime transport; neither module registers listeners at import time.
The page progress listener exists only while a progress-aware call is pending.
`createProviderWorker()` awaits discovery and returns the raw provider Worker when
inactive, or an active-only `ProcessingWorker` otherwise. Initialization errors are
displayed before any provider Worker is constructed. Provider messages remain
separate from the adapter's `onprocessingstatus` callback.
An active send while busy displays a localized unsent-message notice. A session
allows one pending provider turn and no overlapping hooks; violations reject with
`ai_processing_busy` without replacing its request/context. Restoration may be
repeated for the same response after the turn finishes.
Cancellation invalidates that context and suppresses late results.

Input: `{message: string, instructions: {[key]: string}, extraBody: {[key]: string}}`.
The latter two maps contain only relevant provider instruction/extra-body fields;
connection credentials/configuration are not part of this envelope.
Content includes provider system/developer prompts, stop sequences, user-provided
schema names/cache keys/safety identifiers, and JSON extra-body/options/schema fields.
Hosts, model selection, credentials and numeric/provider-control settings stay out.
`integration_content_fields` explicitly classifies every provider string option as
text, JSON or non-content. Static coverage rejects missing/duplicate/stale decisions;
the active adapter also blocks encountered unclassified string options at runtime.
Privacy pseudonymizes nonempty cache/safety identifiers with installation-keyed HMAC
instead of session placeholders, including top-level extra-body overrides. They stay
stable across sessions/restarts without transmitting originals. Invalid JSON blocks
in the companion, independent of ThunderAI's provider parsers.
Output: `{content: string, thinking: string, error?: string}`.
Format: `text` (chat) or `json` (special commands). Protocol 1 has no HTML format,
input form or result window: see "ChatGPT Web" below.

## ChatGPT Web

ThunderAI Privacy covers only the API connections, where the restored answer can be
shown in ThunderAI's own chat window. ChatGPT Web cannot be covered acceptably: the
restored text must never be written into the site's DOM, so the page would show the
masked placeholders and the originals only in a separate window, with a different
custom-input flow, on the most fragile integration. The integration was built and then
removed from both add-ons before 5.2.0, with its `html` format, the `view` option of
`after` and the `collectInput` operation, which the companion now rejects.

What ThunderAI does instead is fail-closed, like a missing companion on the API
workers: `openChatGPT()` (`mzta-background.js`), on the `chatgpt_web` branch, reads
the policy-resolved `ai_processing_enabled` and, while it is on, shows the
`ai_processing_chatgpt_web_unsupported` alert in the current tab (the same `sendAlert`
path as `msg_prompt_too_long`) and returns: no ChatGPT tab is opened and nothing is sent.
The switch is never bypassed silently. Special prompts that use an API through their
own integration are processed as usual even when the global connection is ChatGPT Web.

## Cross-extension messages

All v1 actions use `action: 'aiProcessing.<operation>'` and `protocol: 1`.

| Operation | Fields | Result |
|---|---|---|
| `hello` | protocol | status |
| `settingChanged` | protocol, enabled, locked | acknowledgement |
| `downloadModel` | protocol | `{ready, downloading, progress, error}`, the download running in the companion |
| `openSettings` | protocol | acknowledgement; the companion opens its settings page |
| `createSession` | instanceId, sessionId, callId | acknowledgement |
| `before` | instanceId, sessionId, callId, requestId, input | input, context |
| `after` | instanceId, sessionId, callId, requestId, context, output, format | output |
| `cancel` | instanceId, sessionId, callId, requestId | acknowledgement |
| `disposeSession` | instanceId, sessionId, callId | acknowledgement |

Status: `{ok: true, protocol: 1, instanceId, version, ready, downloading, progress, error}`.
Activation is not part of it; `ready` and `downloading` are required boolean fields.
The companion generates a fresh instance ID each background startup. Active v1
processing buffers responses and keeps Web input/results outside the provider DOM.
Normal replies include `{ok: true, protocol: 1, instanceId, callId, ...result}`;
failure is `{ok: false, error: {code, message}}`, never a success-shaped passthrough.

The companion sends ThunderAI, with `protocol: 1`:

| Action | Fields | Result |
|---|---|---|
| `getSetting` | protocol | `{ok, protocol, enabled, locked}` |
| `setSetting` | protocol, enabled (boolean) | `{ok, protocol, enabled, locked}`, or `ai_processing_setting_locked` when a policy locks it |
| `readinessChanged` | protocol, instanceId, ready, downloading, progress, error | `{ok, protocol}`; relayed to pages as `ai_processing_readiness` |
| `progress` | see below | `{ok}` |

`settingChanged` goes the other way whenever `ai_processing_enabled` changes in
`storage.local`, whoever wrote it (options page, companion, settings import), carrying
the policy-resolved value. It is fire-and-forget: an absent companion is ignored.
`checkPresence` remains a version-string compatibility endpoint, not the processing
handshake.

Discovery (`status`, and before every new session) never contacts the companion while
the switch is off. While it is on, an absent companion (`ai_processing_unavailable`), a
discovery timeout or an incompatible reply (`ai_processing_incompatible`) blocks.
`probe` (the options page only) sends `hello` whatever the switch and returns
`{installed, compatible}`, plus `version` and the model fields when compatible; it
never throws. The page's `downloadModel` and `openSettings` operations are bounded to 5 s
like discovery.

Progress travels companion → ThunderAI as `progress` with protocol, instanceId,
sessionId, requestId, callId and `{phase, current, total}`. Only matching in-flight,
monotonically advancing progress renews the timeout. The default timeout is 120 s,
using `special_command_timeout`; discovery is bounded to 5 s. Expired calls cancel
companion work. Stalled startup/queueing cannot keep a request alive indefinitely.
Local timeout decisions use stable error codes, not translated message comparisons.
The timeout uses `mztaPrefs`, respecting local storage and enforced enterprise values.
User input forms have no processing deadline; closing the form or disposing its
session cancels the wait. Bridge initialization does not delay unrelated background
startup; only processing calls await its registration-state read.

## Lifecycle and failure policy

- New sessions snapshot activation and pin the companion instance. Explicitly
  disabling affects new sessions; existing protected sessions retain restoration.
- While the switch is on, an unavailable companion blocks operations, including after
  a ThunderAI restart. Re-enable or reinstall it, or switch processing off in
  ThunderAI's options to resume unprocessed new sessions. Uninstall is not inferred as
  consent to bypass protection.
- Companion restart invalidates old sessions. Start a new chat/command; do not
  recreate a mapless session or fall back to plaintext inside an existing chat.
- Stop cancels pending hook work and suppresses late provider dispatch/results.
  Dispose closes only the corresponding session. Chat windows and commands dispose
  on teardown. Companion idle sessions expire at
  24 h; its shared classifier shuts down 60 s after its last lease is released.
- Providers retain processed history, including original raw model responses.
  Postprocessed replies are UI/action-only and never sent as subsequent history.
  Usage/retry metadata passes through unchanged; `usage` is held with the buffered
  turn and emitted after the restored content, right before `tokensDone`, because
  the chat opens the answer's turn on its first token and drops a usage that
  arrives with no turn open. A provider's `requestAborted`
  releases the pending turn, allowing a new send with the same processing session.
- ChatGPT Web is not covered: while the switch is on, a prompt on that connection is
  blocked with an alert before any tab opens (see "ChatGPT Web").
- Diagnostics stay inside the companion's hooks. ThunderAI does not intercept HTTP
  requests or relay serialized provider bodies; inspect those in developer tools.

## Manual verification

Committed hook tests: `tests/background/11-ai-processing.test.mjs`,
`tests/background/12-processing-worker.test.mjs` and
`tests/dom/webchat/webchat-22-processing.dom.mjs`, with field coverage in
`tests/static/06-processing-content-fields.test.mjs`. Hook tests use a scripted companion,
not inference/model downloads, and cover inactive forwarding, active hook transforms,
response/history isolation, trust/result validation, restart,
timeout/progress, page-to-broker transport/listener cleanup, session concurrency,
raw-worker selection, busy notices and Stop. Real detection and Thunderbird IPC/platform
behavior still require manual testing.

Load both repositories as temporary Thunderbird add-ons. Check that neither switch can
be turned on before the model is downloaded; download it from ThunderAI's row and from
Privacy (progress in both pages), check the autodownload policy, then switch it on from
either settings page (check that the other follows) and that deletion is refused while on; use fictional data for chat/follow-up and structured special commands.
With the switch on and ChatGPT Web as the global connection, check that a prompt shows the
alert and opens no tab. Check CPU and WebGPU, long chunked inputs, Stop, timeout,
companion restart/disable/uninstall, and missing-model errors. Inspect outbound bodies
and confirm restored replies are absent from follow-up history. Without the companion
and with the switch off, verify unchanged streaming/settings behavior and the
"not installed" notice; with the switch on, verify that requests block.
