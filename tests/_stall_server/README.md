# The stall server

`stall-server.mjs` is a small local AI server that sends a few tokens and then **goes silent**
in the middle of the answer. It is the tool for testing by hand, in Thunderbird, what the
automated tests can only simulate with mock timers: the stream idle timeout and a Stop during a
stall (spec 04 "Stream idle timeout" and "Workers and UI", #999).

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
