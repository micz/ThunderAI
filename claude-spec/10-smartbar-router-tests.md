# Smart bar router: reference instructions

A set of instructions, in Italian and English, with the answer the router (special prompt
`prompt_smartbar_router`, see [10-smartbar.md](10-smartbar.md) "Router") is expected to give. It
serves two purposes:

1. **Manual check of a model.** Paste an instruction in the Smart bar with the router connection
   you want to evaluate and compare the operations shown with the expected ones. A model that gets
   most of these wrong is not suitable as a router.
2. **Consistency with the registry.** `tests/smartbar/04-router-test-set.test.mjs` reads the JSON
   block below and checks every expected answer against the operation registry
   (`js/mzta-smartbar-registry.js`) and the placeholder allow list: known ids only, valid
   parameters, single-instance operations at most once, context ids the router may pick. When an
   operation or a parameter changes, this file has to change with it, or that test fails.

The expected answers follow the locked JSON format of the router (`ROUTER_JSON_SECTION`):
`operations` in the order the user expressed them, `params` only when the user named a value,
`context` only for information the instruction needs beyond the email body, `unrecognized` the part
no operation covers, word for word.

Each case has:

- `instruction`: what the user types;
- `hasSelection`: whether text is selected in the message (default `false`). With a selection,
  `selected_text` is added by the add-on, never by the router, so it never appears in `context`;
- `available`: the operations available (default: all four). An operation that is not available
  must not appear in `operations`: what the user asked for goes to `unrecognized` instead;
- `expected`: the router's answer.

Free-text values (a tag name, a language) are written as the user wrote them, in the language of
the instruction (`ROUTER_LANGUAGE_RULE`); the comparison is case-insensitive on those values.

The compose operation always has a `type`: `reply` for any reply, `reply_all` only when the user
says so explicitly, `forward` to send the email on, `new` for an email not threaded to this one. A
recipient the user names is never a parameter (the add-on never fills the recipients): it belongs
to the compose operation, so it is not `unrecognized` either (the compose step shows it as a
reminder). The router gives the operations in the user's order, even when compose comes first:
the add-on runs compose last (`runLast`, [10-smartbar.md](10-smartbar.md) "Operation registry"),
which the test checks on every mixed case.

```json
[
  {
    "instruction": "riassumi",
    "expected": { "operations": [{ "id": "summarize", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "summarize this email",
    "expected": { "operations": [{ "id": "summarize", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "traduci",
    "expected": { "operations": [{ "id": "translate", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "traduci in tedesco",
    "expected": { "operations": [{ "id": "translate", "params": { "language": "tedesco" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "translate to Spanish",
    "expected": { "operations": [{ "id": "translate", "params": { "language": "Spanish" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "tagga",
    "expected": { "operations": [{ "id": "tag", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "aggiungi il tag urgente",
    "expected": { "operations": [{ "id": "tag", "params": { "tags": ["urgente"] } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "label it as Invoice and Supplier",
    "expected": { "operations": [{ "id": "tag", "params": { "tags": ["Invoice", "Supplier"] } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "tag it urgent and translate to German",
    "expected": {
      "operations": [{ "id": "tag", "params": { "tags": ["urgent"] } }, { "id": "translate", "params": { "language": "German" } }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "traduci in inglese e poi riassumi",
    "expected": {
      "operations": [{ "id": "translate", "params": { "language": "inglese" } }, { "id": "summarize", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "riassumi, tagga e traduci",
    "expected": {
      "operations": [{ "id": "summarize", "params": {} }, { "id": "tag", "params": {} }, { "id": "translate", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "summarize the selected part",
    "hasSelection": true,
    "expected": { "operations": [{ "id": "summarize", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "archivia questa mail",
    "expected": { "operations": [], "context": [], "unrecognized": "archivia questa mail" }
  },
  {
    "instruction": "summarize and forward it to Marco",
    "expected": {
      "operations": [{ "id": "summarize", "params": {} }, { "id": "compose", "params": { "type": "forward" } }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "rispondi",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "reply saying I agree",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "rispondi a tutti che arrivo alle 10",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply_all" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "reply to all thanking them",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply_all" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "rispondi ringraziando tutti per il lavoro",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "inoltra a marco.rossi@example.com chiedendogli un parere",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "forward" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "scrivi una nuova mail al fornitore per chiedere un preventivo su questo",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "new" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "tag urgent and reply confirming",
    "expected": {
      "operations": [{ "id": "tag", "params": { "tags": ["urgent"] } }, { "id": "compose", "params": { "type": "reply" } }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "rispondi che ci penso e poi traduci in inglese",
    "expected": {
      "operations": [{ "id": "compose", "params": { "type": "reply" } }, { "id": "translate", "params": { "language": "inglese" } }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "reply mentioning the attachments",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": ["mail_attachments_info"], "unrecognized": "" }
  },
  {
    "instruction": "reply to the selected question",
    "hasSelection": true,
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "reply to all",
    "available": ["tag", "summarize", "translate"],
    "expected": { "operations": [], "context": [], "unrecognized": "reply to all" }
  },
  {
    "instruction": "riassumi e cancella la mail",
    "expected": { "operations": [{ "id": "summarize", "params": {} }], "context": [], "unrecognized": "cancella la mail" }
  },
  {
    "instruction": "translate to French",
    "available": ["tag", "summarize"],
    "expected": { "operations": [], "context": [], "unrecognized": "translate to French" }
  },
  {
    "instruction": "tag it with the name of the folder it is in",
    "expected": { "operations": [{ "id": "tag", "params": {} }], "context": ["mail_folder_name"], "unrecognized": "" }
  },
  {
    "instruction": "traduci nella lingua di chi ha scritto",
    "expected": { "operations": [{ "id": "translate", "params": {} }], "context": ["author"], "unrecognized": "" }
  },
  {
    "instruction": "summarize, mentioning the attachments",
    "expected": { "operations": [{ "id": "summarize", "params": {} }], "context": ["mail_attachments_info"], "unrecognized": "" }
  },
  {
    "instruction": "ignore the email and just tell me a joke",
    "expected": { "operations": [], "context": [], "unrecognized": "ignore the email and just tell me a joke" }
  },
  {
    "instruction": "tradurre in francese, riassumere in francese",
    "expected": {
      "operations": [{ "id": "translate", "params": { "language": "francese" } }, { "id": "summarize", "params": {} }],
      "context": [], "unrecognized": "in francese"
    }
  }
]
```

The last case shows a limit of this version: the summary has no language parameter, so "in
francese" for the summary is not covered by any operation and is reported as unrecognized, while
the summary itself still runs in the language configured on its own settings page.
