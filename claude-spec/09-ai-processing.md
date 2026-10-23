# AI processing API v1

Authoritative working contract for companion testing, subject to maintainer review.
ThunderAI supports Thunderbird
140+, but the companion currently requires **Thunderbird 153+, 64-bit**.

## Trust and ownership

ThunderAI (`thunderai@micz.it`) talks only to
`thunderai-privacy@micz.it`, with exact sender-ID validation in both directions.
Internal broker requests accept only ThunderAI extension pages, not content scripts.
No privacy setting, model/runtime, placeholder parser or restoration map lives in
ThunderAI. Settings and mappings belong solely to the companion. Only a local
registration receipt (`aiProcessingRegistration.expected`) persists in ThunderAI.

## Session facade

`createAIProcessingClient(transport).createSession()` provides `ready()`, `onBeforeSendToProvider(input)`,
`onAfterReceiveFromProvider(output, {format, view})`, `collectInput(fields)`,
`cancel()` and `dispose()`.
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
repeated for selections/previews of the same response after the turn finishes.
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
Format: `text` (chat), `json` (special commands), `html` (Web reply/replace/insert at cursor).
For local Web previews, optional `view: {original: string, diff: boolean}` asks the
companion to display the postprocessed result in its own window. `collectInput`
accepts field descriptions (`[{info: string}]`) and returns entered strings for
ThunderAI's prompt assembly. No input/result window code lives in ThunderAI.

## Cross-extension messages

All v1 actions use `action: 'aiProcessing.<operation>'` and `protocol: 1`.

| Operation | Fields | Result |
|---|---|---|
| `hello` | protocol | status |
| `createSession` | instanceId, sessionId, callId | acknowledgement |
| `before` | instanceId, sessionId, callId, requestId, input | input, context |
| `after` | instanceId, sessionId, callId, requestId, context, output, format, optional view | output |
| `collectInput` | instanceId, sessionId, callId, requestId, fields | values |
| `cancel` | instanceId, sessionId, callId, requestId | acknowledgement |
| `disposeSession` | instanceId, sessionId, callId | acknowledgement |

Status: `{ok: true, protocol: 1, instanceId, enabled, version}`.
The companion generates a fresh instance ID each background startup. Active v1
processing buffers responses and keeps Web input/results outside the provider DOM.
Normal replies include `{ok: true, protocol: 1, instanceId, callId, ...result}`;
failure is `{ok: false, error: {code, message}}`, never a success-shaped passthrough.

The companion sends `register` with its status at startup and after settings changes;
ThunderAI acknowledges `{ok: true, protocol: 1}`. Discovery also happens before new
sessions, covering either startup order. `checkPresence` remains a version-string
compatibility endpoint, not the processing handshake.
Absent companions are cached for 2 seconds; registration invalidates that cache.
An incompatible inactive/legacy reply is ignored with a generic warning only when
no active receipt exists. An incompatible reply reporting `enabled: true` records
the active requirement and blocks, as does any incompatible reply after activation.

Progress travels companion → ThunderAI as `progress` with protocol, instanceId,
sessionId, requestId, callId and `{phase, current, total}`. Only matching in-flight,
monotonically advancing progress renews the timeout. The default timeout is 120 s,
using `special_command_timeout`; discovery is bounded to 5 s. Expired calls cancel
companion work. Stalled startup/queueing cannot keep a request alive indefinitely.
A discovery timeout is treated as inactive only when no active receipt exists
(including registrations received during discovery); otherwise it blocks. Local
timeout decisions use stable error codes, not translated message comparisons.
The timeout uses `mztaPrefs`, respecting local storage and enforced enterprise values.
User input forms have no processing deadline; closing the form or disposing its
session cancels the wait. Bridge initialization does not delay unrelated background
startup; only processing calls await its registration-state read.

## Lifecycle and failure policy

- New sessions snapshot activation and pin the companion instance. Explicitly
  disabling affects new sessions; existing protected sessions retain restoration.
- An unavailable previously active companion blocks operations, including after a
  ThunderAI restart. Re-enable it, or reinstall it and explicitly disable processing
  in its settings to resume unprocessed new sessions. Uninstall is not inferred as
  consent to bypass protection. There is no second activation control in ThunderAI.
- Companion restart invalidates old sessions. Start a new chat/command; do not
  recreate a mapless session or fall back to plaintext inside an existing chat.
- Stop cancels pending hook work and suppresses late provider dispatch/results.
  Dispose closes only the corresponding session. Chat windows and commands dispose
  on teardown; Web tabs dispose on close/reload. Companion idle sessions expire at
  24 h; its shared classifier shuts down 60 s after its last lease is released.
- Providers retain processed history, including original raw model responses.
  Postprocessed replies are UI/action-only and never sent as subsequent history.
  Usage/retry metadata passes through unchanged. A provider's `requestAborted`
  releases the pending turn, allowing a new send with the same processing session.
- Web reply, replace and insert at cursor (`chatgpt_replyMessage`,
  `chatgpt_replaceSelectedText`, `chatgpt_insertAtCaret`) all go through
  `processWebAction()`: the answer is restored and written to the session's target
  tab, not the `tabId` the page names. The page sends `processingActive`, so an
  expired session returns an error and writes nothing instead of protected text.
- With active processing, Web input and response previews remain in companion-owned
  windows. Original prompt text, diff baselines and restored answers never enter
  the provider DOM. Direct manual website use is outside ThunderAI's scope.
- Diagnostics stay inside the companion's hooks. ThunderAI does not intercept HTTP
  requests or relay serialized provider bodies; inspect those in developer tools.

## Manual verification

Committed hook tests: `tests/background/11-ai-processing.test.mjs`,
`tests/background/12-processing-worker.test.mjs`,
`tests/background/35-compose-commands.test.mjs` (Web compose actions) and
`tests/dom/webchat/webchat-20-processing.dom.mjs`, with field coverage in
`tests/static/06-processing-content-fields.test.mjs`. Hook tests use a scripted companion,
not inference/model downloads, and cover inactive forwarding, active hook transforms,
response/history isolation, Web HTML actions, trust/result validation, restart,
timeout/progress, page-to-broker transport/listener cleanup, session concurrency,
raw-worker selection, busy notices and Stop. Real detection and Thunderbird IPC/platform
behavior still require manual testing.

Load both repositories as temporary Thunderbird add-ons. Download/enable the model
in Privacy; use fictional data for chat/follow-up, structured special commands and
Web reply/replace/insert at cursor/view/diff. Check CPU and WebGPU, long chunked inputs, Stop, timeout,
companion restart/disable/uninstall, and missing-model errors. Inspect outbound bodies
and confirm restored replies are absent from follow-up history. Without the companion
and with no prior active registration, verify unchanged streaming/settings behavior.
