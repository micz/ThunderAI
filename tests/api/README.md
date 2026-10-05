# Tests: API integrations (provider clients, retry, workers)

Level-1 tests of what ThunderAI sends to the AI providers and what it makes of their answers: request
construction, response and stream parsing, the error contract, automatic retry, token usage, and the
message protocol of the five model workers. The contract is
[`claude-spec/04-api-integrations.md`](../../claude-spec/04-api-integrations.md), as everywhere in the
suite: each test file names the spec 04 sections it covers in its opening comment.

The modules under test are everything in `js/api/` and `js/workers/`, plus the `mzta_specialCommand`
half of "Configuration Validation" (`js/mzta-special-commands.js`) and `supportsUsageData()` of
`js/mzta-utils.js`. How to run the suite, the two levels, the mock and the known-issue mechanism are in
the general [`tests/README.md`](../README.md). Paths below are relative to `tests/`.

Everything here runs with **no managed policy**. Policy-supplied keys, locked providers and the policy
branches of "Per-feature provider override" are spec 08b, covered by the managed area
([`managed/README.md`](../managed/README.md)).

## Running

```sh
node --test "tests/api/*.test.mjs"     # this area only, from the repository root
```

Level 1 only: nothing to install, no jsdom, **no network and no real waiting**. The area has **no
plugin**: the fetch model and the worker realm live in the area (a plugin is loaded into every context,
the managed area's DOM pages included, and would change what they detect).

## Layout

```
tests/
├── helpers/known-issues/api.mjs   the known issues, their shape (validateKnown()), and caseTests()
├── fixtures/api/
│   ├── <provider>.json            documented provider inputs, one entry each with its `source`
│   └── captured/*.txt             real captures (Thunderbird debug console), trimmed to the worker lines
└── api/
    ├── harness.mjs                areaFile(): fetch model + caseTests + console capture; fakeTime(), drive()
    ├── fetch-model.mjs            the scripted global fetch (see below)
    ├── worker-realm.mjs           the Web Worker realm: loadWorker(), startTurn(), shape()
    ├── wire.mjs                   responses and streams (SSE, NDJSON, manual), fixture and capture readers
    └── NN-*.test.mjs              the tests (table below)
```

Helper modules have no `.test.mjs` suffix, so the level-1 glob never runs them.

| File | Spec 04 section(s) |
|---|---|
| `01-api-utils` | "Extra body data" (`parseExtraBody()`, worker-safe) |
| `02-anthropic-capabilities` | "Anthropic / Claude": capability table, boundary-aware matching, fallback |
| `03-openai-capabilities` | "OpenAI API": capability table, prefix matching, permissive fallback |
| `04-openai-comp-configs` | "OpenAI-Compatible": the presets, no per-preset extra body |
| `05-usage-data` | "Token usage data", "Per-provider support" (every `extractUsage()`) |
| `06-usage-support-by-type` | "Per-provider support": `supportsUsageData(connection_type)` agrees with the modules |
| `07-retry-helpers` | "Automatic Retry Handling": constants, `parseRetryAfter()`, `classifyRateLimitBody()`; "Logging": `extractErrorMessage()` |
| `10-fetch-with-retry` | "Automatic Retry Handling": `fetchWithRetry()` whole (the retried body read only with debug on, the 5 s limit of that read and of the 429 inspection, a user abort during a body read), "Logging" |
| `20-anthropic-request` | "Anthropic / Claude": request body construction |
| `21-anthropic-400-retry` | "Anthropic / Claude": one-shot retry on a 400, 400 error hints |
| `22-gemini-request` | "Google Gemini", "Extra body data" (two-level merge), includeThoughts |
| `23-ollama-request` | "Ollama": think levels, keep_alive, options, Bearer on every endpoint; 300 s timeout |
| `24-openai-comp-request` | "OpenAI-Compatible", "Extra body data", stream_options; 300 s timeout |
| `25-openai-responses-request` | "OpenAI API": reasoning, text, sampling, limits, pass-through, extra-body gating |
| `26-client-error-contract` | "Error contract between js/api/* and workers" (the classes); fetchModels through the retry |
| `27-config-validation` | "Configuration Validation", "Web Worker Pattern" (module worker per provider) |
| `30`/`31-worker-anthropic-*` | "Web Worker Pattern", "Thinking output…", "Per-provider support", "Wiring in the workers", "Emitting to the chat window", "Workers and UI", "Error contract…" |
| `32`/`33-worker-gemini-*` | the same, Gemini (turn 1 replays the capture) |
| `34`/`35-worker-ollama-*` | the same, Ollama (system prompt once; turn 1 replays the capture) |
| `36`/`37-worker-openai-comp-*` | the same, OpenAI-compatible (reasoning field priority, no-usage servers) |
| `38`/`39-worker-openai-responses-*` | the same, OpenAI Responses (turn 1 replays the capture; reasoning item fallback; store off: the whole history) |
| `40-worker-openai-responses-store` | "OpenAI API", "Chaining turns (`chatgpt_store`)": store on, previous_response_id |
| `99-harness-known-issues` | the known-issue shape |
| `99-harness-fetch-model` | the fetch model (including an abort after the `Response`) and the realm themselves |

Each worker has two files, because a worker module is a singleton: `-stream` runs the successful turns
with debug **on** and the usage display **on** (and checks the key never reaches the console); `-errors`
runs the failure paths with the usage display **off** (and checks nothing is emitted then).

## The fetch model

`installFetchModel()` (`api/fetch-model.mjs`) replaces the global `fetch`, which `fetchWithRetry()`
and the direct probes call at call time. A test scripts the calls it expects, **in order**:

```js
const { k, net } = areaFile('20-anthropic-request');
k.test('case-id', 'what spec 04 says', async () => {
    net.expect({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' },
               () => jsonResponse(body, { status: 400, statusText: 'Bad Request' }));
    net.expect(/:streamGenerateContent\?/, () => streamResponse(chunks));   // a RegExp, or a predicate
    net.expect(url, NET.networkError());   // a rejected fetch (Firefox's TypeError)
    net.expect(url, NET.hang);             // never answers; rejects with the reason once aborted
    ...
    net.calls[0].json();                   // the recorded request: url, method, headers (lower-cased), body, signal, t
});
```

A call is matched against the **head** of the script only and consumes it; the answer is a function
returning a fresh `Response` (bodies are single-use). **A call nothing was scripted for is recorded as a
violation, then rejected with an `UnscriptedFetchError` naming the URL.** Recording comes first because
the clients catch fetch failures, and `fetchWithRetry()` even retries them after a backoff. Every
`k.test()` runs inside `net.guard()`, which fails the test **at once** on a violation (it does not wait
for a retry) and, at the end, if a violation was swallowed or a scripted answer was never consumed. Like
the real fetch, an already aborted signal rejects with its reason, and **an abort after the `Response`
was returned errors its body** with the reason: a pending `text()` or `reader.read()` rejects, and the
scripted stream is cancelled (a body already read to the end is unaffected). The model hands the
scripted `Response` over with its body piped through a stream the signal can error, same status,
statusText and headers. So a test of an abort during a body read passes because of the abort, never
because of a timeout racing it.

Responses are built with Node's own `Response`, `Headers`, `ReadableStream` and `TextEncoder`
(`api/wire.mjs`): `jsonResponse()`, `textResponse()`, `streamResponse(chunks, {errorAfter})` (the
chunks exactly as they should arrive, `errorAfter` to cut the connection), `manualStream()` (the test
pushes chunks and decides when a `reader.read()` resolves: a user stop, a slow body), `sse()`,
`ndjson()`, `cutAt()`.

## Time

Retry backoff, `Retry-After` and per-attempt timeouts run on node:test's **mock timers**: `fakeTime(t)`
mocks `setTimeout` and `Date` for that test only (`t.mock`, restored when it ends) and pins
`Math.random` (the jitter). `drive(promise, timers)` lets the microtasks run, fires the next timer and
repeats until the promise settles. `setImmediate` stays real, so `drive()`, `until()` and `flush()` can
turn the event loop. Level 1 has no harness of its own counting pending timers (that is the DOM
harness's `settle()`), and node:test's own per-test timeout is unaffected by `t.mock.timers`. A test
that does not call `fakeTime()` never reaches a backoff: it scripts no retryable failure, or passes
`maxRetries: 0`. The abort tests of `10` (`abort-during-*`) put the test on mock timers but never fire one: they
turn the event loop, abort, and the request must settle on the abort alone. The 5 s body read limit
is reached only where a test fires it on purpose (`debug-on-body-timeout`, `429-body-timeout-*`).

## The worker realm

`api/worker-realm.mjs` runs ThunderAI's Web Workers (`js/workers/*`) **in-process**, in a realm shaped
like a module worker's (not to be confused with `helpers/core/worker.mjs`, which runs an extension
context in a Node worker *thread*):

- `self` is the global object; the workers assign `self.onmessage`, and `send(data)` calls it;
- `postMessage` is the **global** function the workers call, a spy that records every message
  (structured-cloned) in `posted`;
- `fetch` is the fetch model;
- **there is no `browser` and no `messenger` global**: a Web Worker has no WebExtension API, so any
  access fails the test with a ReferenceError. `loadWorker()` refuses to start if either exists, and
  each worker file ends with `assertNoBrowser()`. No worker file installs the core browser mock.

One file is one worker instance, its tests are the turns of one chat window, in order. `startTurn(w,
text)` posts a `chatMessage` without awaiting it (for a Stop mid-stream); `shape(messages)` reduces a
turn to `[type, the field that matters]` and leaves `messageSent` out (spec 04 does not fix its place).

## Fixtures

**Inputs come from the providers, expectations from the spec.**

- **Captured** (`fixtures/api/captured/*.txt`, read by `capturedLines()` / `capturedEntry()`): three
  real exchanges logged by ThunderAI 5.1.0 with debug on, 2026-10-06, trimmed to the model worker's own
  entries (a `#` header says what each is). Gemini: a 503 with its body, retried, then the SSE stream;
  Ollama: a thinking stream ending with a final chunk without `eval_duration` (a cloud model); OpenAI
  Responses: a stream without reasoning. They are preferred wherever they cover the case.
- **Documented** (`fixtures/api/<provider>.json`): every entry carries a `source`, the provider
  documentation page whose wire format it follows. Values (ids, texts, counts) are illustrative; no field
  a provider does not send was added. One entry is marked as taken from spec 04 itself rather than the
  provider's docs (Anthropic's `enforced_spend_limit_reached` body). Every API key is an obvious fake.
- **Expected values** are written by hand in the tests, from spec 04, and the comment next to a
  computed number shows the arithmetic. None was produced by running the code. Where spec 04 does not
  determine a value, it is not asserted, and it is listed below.

## Known issues: TODO tests

The general rule is in [`tests/README.md`](../README.md#known-issues-todo-tests). Every test of the area
is declared with `caseTests(file).test(caseId, name, fn)` (through `areaFile()` in most files), so a known
issue names exactly one test:

```js
KNOWN = { '<file stem>': { '<case id>': REASONS.<name> } }
// a reason:  spec 04 "<section>" [<provider>]: <what the spec says>; <what the code does>
```

`<provider>` is one of `anthropic`, `google_gemini`, `ollama`, `openai_comp`, `openai_responses`, or
`shared` (code every provider runs). `validateKnown()` (run by `99-harness-known-issues`) refuses a file
that is not in `tests/api/`, a case id that is not a plain slug, a malformed reason, an unknown provider
and a reason not in `REASONS`; an unused reason fails too. Each file ends with `k.coverage()`.

Today: none. The three known issues of the first run were fixed in the code, and spec 04 was
aligned where it contradicted itself:

- `27-config-validation` `before-worker-created`: `mzta_specialCommand` now creates its Worker in
  `initWorker()`, after the validation (spec 04 "Worker Lifecycle & Timeout" said "in its
  constructor", against "Configuration Validation");
- `35-worker-ollama-errors` `http-404-string-error`: the Ollama worker reads the string `error` of
  Ollama's error body;
- `38-worker-openai-responses-stream` `turn2-history`: with `chatgpt_store` off the Responses worker
  sends the whole history (spec 04 "Chaining turns (`chatgpt_store`)", tested on both sides by `38`
  and `40`).

## What is not covered

- **ChatGPT Web** (`js/mzta-chatgpt.js` and its loader): a content script driving the provider's page.
- **The chat window** (`api_webchat/`): rendering of thinking (block, live indicator), the usage chip
  and popover, the retry countdown, font zoom, the context-window lookup. DOM, and not in this area.
- **The settings UI** of spec 04 (capability notes, the Ollama/Claude selects, `checkJsonField()`,
  `checkAnthropicThinkingBudget()`): `pages/_lib/connection-ui.js`, DOM.
- **"Optional Permissions"**: manifest and runtime permission requests.
- **The rest of `mzta_specialCommand`**: `sendPrompt()`, its timeout, `dispose()`, the copy of
  `rateLimited` / `retryAfterMs` onto the rejected error, thinking stripping. Reachable the same way as
  `27` (a fake global `Worker`, which would then have to answer like a worker), not done in this pass.
  Only "Configuration Validation" and the worker file and type are covered.
- **Batch cancellation** (`js/mzta-batch-controller.js`, `processEmails()`): background code. From that
  section only the worker side of a stop is covered (`stop` before and during streaming).
- **The managed branches** (spec 08b): policy keys, locked providers, enforced per-feature connections.
- **`fetchModelInfo()` of Gemini and Claude**, and the shape of every `fetchModels()` result: spec 04
  only says they go through `fetchWithRetry()`, which `26` checks.
- **Anything requiring a live provider.**

## Under-specified

Spec 04 leaves these open, or the tests found them and spec 04 has no sentence to test them against. They
are not asserted (or only the part the spec fixes is), and they are input for spec 04:

1. **`messageSent`**: every worker posts it after `fetchResponse()` returns, before any token. Spec 04
   never names it, nor its place in the protocol.
2. **The provider and model values of a usage object**, and whether "`createUsageData()` defaults every
   absent key to `null`" includes `provider` (the code defaults it to `''`).
3. **`parseRetryAfter()` beyond the two valid forms**: the default cap of the function, decimals
   (`"1.5"` is accepted as 1500 ms, not in RFC 9110), and V8's lenient `Date.parse()`, which reads
   `"-5"` as a date in 2001, so such a header becomes a wait of 0.
4. **The cut of `extractErrorMessage()`**: "cut at 500 characters". The code appends `...`.
5. **The joint of `describeAnthropicError()`** (hint, space, detail) and the form of `errorDetail` in the
   worker's error text (the code puts `JSON.stringify(body)`).
6. *(resolved: spec 04 "Failures in the middle of the stream" now covers Claude's `event: error`, the Ollama
   error line, `response.failed` and a connection cut while reading, for every worker: one `error`, no
   `tokensDone`; the `-errors` files test them.)*
7. *(resolved: the Ollama error line now gives the server's message, spec 04 "Failures in the middle of
   the stream"; `35` tests it.)*
8. *(resolved: spec 04 "Workers and UI" now says a failed request removes the unanswered message and
   drops the partial answer, like an abort; `history-after-errors` in every `-errors` file, and `40`
   for the Responses chain.)*
9. **Tokens after Stop**: the chunk whose read was pending when Stop arrived is still processed (its
   tokens are posted) before the turn closes.
10. *(resolved: spec 04 "Reading the stream" now requires `decode(chunk, { stream: true })`; `utf8-split`
    in every `-stream` file.)*
11. *(resolved: spec 04 "Worker Lifecycle & Timeout" now says what `initWorker()` sends; `27` tests it.)*
12. **Debug logging beyond URLs, headers and `config`**: with debug on the workers log every stream line
    and the full answer and reasoning. Spec 04 only forbids the URL, headers and `config`, which the
    tests check (no key, no Gemini URL in the console).
13. *(resolved: spec 04 "OpenAI API" now describes how the Responses worker chains turns, "Chaining
    turns (`chatgpt_store`)"; `38` and `40` test both cases.)*
14. **Configuration Validation**: the message of the thrown error.
