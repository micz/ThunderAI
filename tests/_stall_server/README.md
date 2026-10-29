# The stall server

`stall-server.mjs` is a small local AI server that sends a few tokens and then **goes silent**
in the middle of the answer. It is the tool for testing by hand, in Thunderbird, what the
automated tests can only simulate with mock timers: the stream idle timeout and a Stop during a
stall (spec 04 "Stream idle timeout" and "Workers and UI", #999). With `--redirect` it also answers
every request with a redirect, for testing how the two custom endpoints handle one (spec 04
"Redirects", #1000).

It is not a test: `npm test` never runs it (its name is not `*.test.mjs`), and like the whole
`tests/` folder it is never packaged. It needs Node only, no dependency. When the behaviour it
exercises changes (a new provider protocol, a new keep-alive form, a new stall scenario), update
this server and this README rather than writing a new one.

## Start it

From the repository root:

```
node tests/_stall_server/stall-server.mjs --chunks 3
```

| Option | Default | Meaning |
|---|---|---|
| `--port N` | `8787` | the port it listens on |
| `--chunks N` | `3` | tokens sent (one every 300 ms) before the stream stalls |
| `--ping S` | `0` | while stalled, send a keep-alive every S seconds (`0`: none, a real stall) |
| `--resume S` | `0` | after S seconds of stall, send the rest of the answer and end it (`0`: never) |
| `--redirect CODE` | `0` | answer every request with this 3xx status (`301`, `302`, `303`, `307`, `308`; `0`: no redirect) |
| `--redirect-to URL` | this server | the origin the redirect points to; with none, a redirect of the path only |

The redirect points to the same path under `/_redirected` (for example `/v1/models` to
`/_redirected/v1/models`), which the server answers normally and never redirects again. So with no
`--redirect-to`, or with `--redirect-to` naming this same server under another origin (such as
`http://127.0.0.1:8787` while ThunderAI uses `localhost`), the redirect can be followed.

It logs every request, token, keep-alive and the moment the client closes the connection
(`client closed the connection (aborted after N tokens)`: the abort reached the server). Stop it
with Ctrl+C.

## Point ThunderAI at it

It speaks two protocols, so it can stand in for two connections:

| Connection | Host | Model | Endpoints | Keep-alive |
|---|---|---|---|---|
| OpenAI Comp API | `http://localhost:8787` (the `/v1` option on, its default) | `stall-model` | `POST /v1/chat/completions` (SSE), `GET /v1/models` | the SSE comment `: OPENROUTER PROCESSING` |
| Ollama API | `http://localhost:8787` | `stall-model` | `POST /api/chat` (NDJSON), `GET /api/tags`, `GET /api/version` | an empty line |

The model lists and the connection test work, so the model can be picked from the list. Any API
key is accepted (none is checked).

To wait less than the default 120 s, set **API stream idle timeout (ms)** in the advanced options
of the options page, for example to `10000`. Turn on debug to see the worker's logs.

## What to check

| Start | Do | Expected |
|---|---|---|
| `--chunks 3` | wait | after the timeout, one error: "The server stopped responding: no data received for 10 seconds"; the server logs the closed connection |
| `--chunks 3` | press Stop during the stall | the turn ends **at once**, with no error: the partial answer stays, the Stop button leaves "Stopping..."; with debug on, `AI full response [STOPPED]` |
| as above | ask another question | the new turn is not stopped, and the partial answer is in the history it sends |
| `--chunks 3 --ping 3` | wait well past the timeout | the answer stays open, no error |
| `--chunks 3 --ping 3 --resume 30` | wait | the answer completes normally |
| `--chunks 3` | a special command (e.g. summarize) on this connection | the idle error after the timeout, before `special_command_timeout` if that is longer |

The second and third rows are the ones the mock fetch cannot prove: that in Firefox aborting the
request after the headers makes the pending read of the body fail at once.

## What to check: redirects

Host `http://localhost:8787`, on either connection. `--resume 1` makes the answers complete
quickly. The note is the amber one under the host field of the connection panel. It shows after a
request has been made, so reopen the panel or the options page after the request.

| Start | Do | Expected |
|---|---|---|
| `--redirect 307 --chunks 3 --resume 1` | connection test, then a chat | both work; the note says the server redirects to `http://localhost:8787/_redirected/...` (a redirect of the path only shows the whole address) |
| `--redirect 308 --redirect-to http://127.0.0.1:8787 --chunks 3 --resume 1` | as above | both work; the note shows only the origin, `http://127.0.0.1:8787` |
| `--redirect 302` | connection test | it works (a `GET` stays a `GET`); the note shows the redirect |
| as above | a chat, or a special command | the `POST` turns into a `GET` and the target answers 404: at once, with no retry, the error "The server answered with a redirect that could not be followed..."; the note turns into the failed one, with the address |
| `--redirect 307 --redirect-to http://127.0.0.1:1` | connection test, or a chat | the target cannot be reached: the probe finds the redirect, and the same error shows after the first failure, with no retry; the failed note shows no address |
| restart with no `--redirect` | any request | it works, and the note goes away |
| any of the above | change the host field | the note goes away at once |

The server logs every redirect it sends (`redirect 307 -> ...`), and for the unreachable target
also the probe: a `GET` with no API key and no body.
