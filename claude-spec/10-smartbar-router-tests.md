# SmartBar router: reference instructions

A set of instructions, in Italian and English, with the answer the router (special prompt
`prompt_smartbar_router`, see [10-smartbar.md](10-smartbar.md) "Router") is expected to give. It
serves two purposes:

1. **Manual check of a model.** Paste an instruction in the SmartBar with the router connection
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
- `available`: the operations available (default: those whose requirements hold with every
  feature, permission and connection on, in the case's `source` with its `draft`). An operation
  that is not available must not appear in `operations`: what the user asked for goes to
  `unrecognized` instead;
- `source`: `"bar"` (default) or `"chat"`, where the message is typed;
- `draft`: the chat only, the type of the session's current draft (`draft_exists` / `draft_type` of
  the router's metadata); absent when there is none. `deliver_draft` is available only with one;
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

**Deleting and the other features.** `delete_summary` / `delete_translation` remove the stored
summary or translation of the email, never the email: "cancella la mail" is not covered. Asked
together with a new summary (translation), the deletion runs first whatever the user's order
(`summarize` / `translate` wait for it: `dependsOn`, checked by the test). `spam_check` checks the
email with the spam filter. `calendar_event` / `task` read an event or a task from the email and
open Thunderbird's dialog through ThunderAI Sparks; Sparks is not a requirement (a missing one is
said by the line when it runs), so they are available here with their feature and connection, and
they run last like compose (`runLast`, also checked).

**The chat** ([10-smartbar.md](10-smartbar.md) "Chat"). A question about the email ("chi è il
mittente?") is no operation and nothing unrecognized: the chat answers it freely. With a draft, a
change of it ("più breve", "make it more formal", "aggiungi che…") is a `compose` of the draft's
type, an approval ("crea l'email", "ok vai", "that's fine, create the email") is `deliver_draft`,
and "make it shorter and create it" is both: the add-on runs `deliver_draft` after the `compose`
whatever their order (its `dependsOn`, also checked). Without a draft the approval is not covered:
`unrecognized` from the bar, the free answer in the chat.

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
  },
  {
    "instruction": "cancella il riassunto",
    "expected": { "operations": [{ "id": "delete_summary", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "delete the translation",
    "expected": { "operations": [{ "id": "delete_translation", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "cancella il riassunto e rifallo",
    "expected": {
      "operations": [{ "id": "delete_summary", "params": {} }, { "id": "summarize", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "traduci in spagnolo dopo aver eliminato la traduzione",
    "expected": {
      "operations": [{ "id": "translate", "params": { "language": "spagnolo" } }, { "id": "delete_translation", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "è spam?",
    "expected": { "operations": [{ "id": "spam_check", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "check whether this is spam",
    "expected": { "operations": [{ "id": "spam_check", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "aggiungi al calendario",
    "expected": { "operations": [{ "id": "calendar_event", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "create a task to pay this invoice",
    "expected": { "operations": [{ "id": "task", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "crea un evento e riassumi",
    "expected": {
      "operations": [{ "id": "calendar_event", "params": {} }, { "id": "summarize", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "crea un'attività",
    "available": ["tag", "summarize", "translate"],
    "expected": { "operations": [], "context": [], "unrecognized": "crea un'attività" }
  },
  {
    "instruction": "più breve",
    "source": "chat",
    "draft": "reply",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "make it more formal",
    "source": "chat",
    "draft": "forward",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "forward" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "aggiungi che arrivo alle 10",
    "source": "chat",
    "draft": "reply_all",
    "expected": { "operations": [{ "id": "compose", "params": { "type": "reply_all" } }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "crea l'email",
    "source": "chat",
    "draft": "reply",
    "expected": { "operations": [{ "id": "deliver_draft", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "ok vai",
    "source": "chat",
    "draft": "new",
    "expected": { "operations": [{ "id": "deliver_draft", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "that's fine, create the email",
    "source": "chat",
    "draft": "reply",
    "expected": { "operations": [{ "id": "deliver_draft", "params": {} }], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "crea l'email",
    "source": "chat",
    "expected": { "operations": [], "context": [], "unrecognized": "crea l'email" }
  },
  {
    "instruction": "ok go",
    "expected": { "operations": [], "context": [], "unrecognized": "ok go" }
  },
  {
    "instruction": "make it shorter and create it",
    "source": "chat",
    "draft": "reply",
    "expected": {
      "operations": [{ "id": "compose", "params": { "type": "reply" } }, { "id": "deliver_draft", "params": {} }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "creala dopo averla resa più breve",
    "source": "chat",
    "draft": "reply",
    "expected": {
      "operations": [{ "id": "deliver_draft", "params": {} }, { "id": "compose", "params": { "type": "reply" } }],
      "context": [], "unrecognized": ""
    }
  },
  {
    "instruction": "chi è il mittente?",
    "source": "chat",
    "expected": { "operations": [], "context": [], "unrecognized": "" }
  },
  {
    "instruction": "what is he asking me?",
    "source": "chat",
    "draft": "reply",
    "expected": { "operations": [], "context": [], "unrecognized": "" }
  }
]
```

The last case shows a limit of this version: the summary has no language parameter, so "in
francese" for the summary is not covered by any operation and is reported as unrecognized, while
the summary itself still runs in the language configured on its own settings page.
