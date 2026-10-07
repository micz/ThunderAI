# Options & Settings System

## Overview

Extension preferences are stored in **`browser.storage.local`** — defaults and the full list of valid keys are defined in `options/mzta-options-default.js`. Every preference **read** goes through the accessor module `js/mzta-prefs.js` (see [Preference access](#preference-access-jsmzta-prefsjs) below); direct storage calls are no longer the norm. The large-payload keys (`_custom_prompt`, `_default_prompts_properties`, `_special_prompts`, `_custom_placeholder`) live in the same area. `add_tags_exclusions` used to be one of them, read and written directly; it is now a declared preference (see the Add Tags table), with the same storage key.

**Preferences used to live in `browser.storage.sync`** and were moved for the same reason the prompt payloads were moved in [#129](https://github.com/micz/ThunderAI/issues/129): `storage.sync` has a narrow quota. The consequence is deliberate and is the one behavioural change of that move — **preferences no longer follow the user across profiles or devices.** The one-time copy is `migratePrefsToLocal()` (`js/mzta-prefs-migration.js`), which runs first at the top of `mzta-background.js`; it never overwrites a key already present in local and **deliberately leaves the `sync` copy in place**, so a downgrade to an older version still finds the user's settings. Once `storage.sync` holds nothing any migration still needs, it writes the marker **`_prefs_migrated_from_sync`** into `storage.local`; every later startup returns on that single read instead of enumerating both storage areas, and `isSyncDrained()` lets `mzta-background.js` skip the two #129 migrations, which would otherwise each pay a `storage.sync.get()` forever. The marker means *"sync is drained"*, not merely *"the preferences were copied"*: it is withheld while a #129 payload is still in sync (a pre-#129 profile), so those migrations are never skipped before they have run, and the marker is set on the following startup. It is deliberately **not** used to skip `migrateEnabledToShowIn()` or `migrateMenuOrderAlphabetic()`, which act on `storage.local` data and own their own flags. The marker is not a preference (no UI, no `prefs_default` entry, leading underscore), so it never surfaces in `getAllPrefs()` or `restoreOptions()`. On the run that copies, it is written **inside the same `set()`** as the preferences, so the whole migration lands atomically — a partial write would otherwise leave the one-shot flags behind and let `migrateMenuOrderAlphabetic()` destroy the user's custom menu ordering. **A failed migration never stops the add-on from starting**: at the top level of `mzta-background.js`, where a rejection would abort the rest of the startup (menus, listeners) at every start, every migration that can reject is awaited with a `.catch()` that only logs, and `migratePrefsToLocal()`, `isSyncDrained()` and `migrateOllamaThinkLevel()` catch their own failures. A one-shot flag is written only when its migration succeeds, so a failed one runs again at the next start; a failed copy (`migratePrefsToLocal()` returns `false`) only skips, for that start, the migrations guarded by it. **`isSyncDrained()` answers `false` whenever the marker cannot be confirmed**: absent, not `true`, or the read itself failing. On doubt the two #129 migrations therefore run and decide for themselves (each finds nothing to do once sync is drained); it never answers `true` on a failure, which would skip them for good. **Settings changed while downgraded are not carried back, deliberately**: once the marker is set `storage.sync` is never read again, so what an older version writes there after the upgrade stays there, and a re-upgrade keeps what `storage.local` holds. See [01-architecture.md](01-architecture.md#storage).

## Key Exports from `mzta-options-default.js`

| Export | Description |
|--------|-------------|
| `prefs_default` | All preference keys with their default values |
| `integration_options_config` | Per-provider API settings structure |
| `getDynamicSettingsDefaults(keysFilter)` | Returns per-special-prompt integration defaults |
| `getDynamicSettingValue(prefs, prefix, settingName)` | Reads a prefixed setting for a special prompt |

## Settings Structure

### Global Integration Settings

Stored flat in `prefs_default` with `{provider}_{key}` naming:

```
chatgpt_api_key, chatgpt_model, chatgpt_developer_messages, chatgpt_temperature, chatgpt_store, chatgpt_reasoning_summary, chatgpt_reasoning_effort, chatgpt_extra_body, chatgpt_max_output_tokens, chatgpt_verbosity, chatgpt_text_format, chatgpt_text_format_schema_name, chatgpt_text_format_schema, chatgpt_top_p, chatgpt_truncation, chatgpt_prompt_cache_key, chatgpt_service_tier, chatgpt_safety_identifier, chatgpt_include_encrypted_reasoning
ollama_host, ollama_api_key, ollama_model, ollama_num_ctx, ollama_temperature, ollama_think, ollama_format_json, ollama_keep_alive, ollama_system_prompt, ollama_extra_options
openai_comp_host, openai_comp_model, openai_comp_api_key, openai_comp_use_v1, openai_comp_chat_name, openai_comp_temperature, openai_comp_extra_body
google_gemini_api_key, google_gemini_model, google_gemini_system_instruction, google_gemini_thinking_budget, google_gemini_temperature, google_gemini_max_output_tokens, google_gemini_top_p, google_gemini_top_k, google_gemini_extra_body
anthropic_api_key, anthropic_model, anthropic_version, anthropic_max_tokens, anthropic_system_prompt, anthropic_temperature, anthropic_top_p, anthropic_top_k, anthropic_stop_sequences, anthropic_extended_thinking_budget, anthropic_effort
```

**`*_extra_body` and `ollama_extra_options` hold raw JSON.** These three prefs are the only ones storing a JSON string in a
free-text field. The UI validates advisorily (`warn_InvalidJson` → red border) but `saveOptions`
persists the value regardless, so the consumer must tolerate malformed input: `parseExtraBody()`
(`js/api/api-utils.js`) falls back to `{}`. See
[Extra body data](04-api-integrations.md#extra-body-data).

Plus the global connection selector:
```
connection_type   (default: '' — no connection selected yet)
use_specific_integration   (default: false)
```

**No connection selected (default).** `connection_type` intentionally defaults to the **empty
string**: a new user is not given a provider they never chose. Instead the three entry points
(popup, welcome page, options page) show a **blue** banner inviting them to run the
[Setup Wizard](#setup-wizard-pagessetup-wizard). The shared predicate is
`hasNoConnectionSelected(connection_type)` (`js/mzta-utils.js`) — use it instead of comparing to
`''` inline. Consequences of the empty state:

- **No special prompt is advertised**, unless the feature carries its own integration.
  `getActiveSpecialPromptsIDs()` receives an `effective_conn` map (one resolved connection type per
  feature prefix) and emits a prompt only when `isApiUsableConnection()` accepts that feature's
  connection. An empty type must never read as "some API is configured" (a check comparing only
  against `chatgpt_web` would do exactly that) and would otherwise surface features that cannot run.
- **The connection select shows a placeholder.** `populateConnectionTypeOptions()`
  (`pages/_lib/connection-ui.js`) prepends a **disabled** `<option value="">`
  (`prefs_Connection_type_none`) for the *global* select only — the per-prompt selects
  (`no_chatgpt_web: true`) already use an empty value to mean "inherit the global connection".
  The placeholder is required because the select otherwise has no empty option, so an empty pref
  would display the first provider (ChatGPT Web) and saving would silently persist it.
  Accordingly `restoreOptions()` in `options/mzta-options.js` no longer falls back to
  `'chatgpt_web'`, and its `selectedIndex = -1` branch excludes `connection_type`.
- **Custom prompts require a specific integration**, exactly as with `chatgpt_web`
  (`connection-ui.js`, the `use_specific_integration` force-check).
- **The API-driven features are shown as unavailable**, but for a *different reason* than with
  `chatgpt_web` — see "Feature Rows — Disabled vs. API-Needed" below. `disable_GetCalendarEvent()`
  (which also covers `get_task`) and `disable_MaxPromptLength()` apply the same "ChatGPT Web or
  nothing selected" rule to the raw select value; the two Sparks rows already hide themselves
  entirely when disabled, and their `no_sparks` message is about Sparks, not about ChatGPT Web.
- **Running a prompt alerts the user.** The `default:` case of `openChatGPT()`
  (`mzta-background.js`) distinguishes "no connection" from "unknown type" and sends
  `msg_no_connection_selected` via `sendAlert` instead of only logging.
- **Feature flags left enabled are healed in the background.** `_reconcileFeatureFlags()`
  (`mzta-background.js`) is the authoritative self-healer: it walks
  `special_prompts_with_integration` and writes `false` for any flag that is `true` while its
  effective connection is **absent** (`hasNoConnectionSelected()`). Note this is deliberately
  narrower than `isApiUsableConnection()`: `chatgpt_web` is left alone, for the reason given under
  "Feature Rows — Disabled vs. API-Needed". A flag the enterprise policy enforces is skipped entirely: the repair works by writing
  `false` to `storage.local`, which the write guard would refuse anyway, so without the
  skip the only effect would be a warning logged on every startup. If a policy enables a
  feature whose connection cannot drive it, the feature stays on and does nothing — a
  misconfiguration for the administrator to fix, not something to override silently.
  It runs at startup and at the head of
  the debounced `storage.onChanged` handler, so it covers the writers that have no feature UI of
  their own — the setup wizard (which writes `connection_type` through the generic `saveOptions()`
  and never touches the flags) and a prefs import. (A sync from another profile used to be a third writer; it no longer exists, since preferences moved to `storage.local`.) `disable_ApiFeature()`
  in the options page remains, but is now only the immediate-feedback path: it runs solely while
  that page is open, which is why a background pass is needed at all. The reconciliation is
  **one-directional** (`true → false` only) — restoring a flag when a usable connection returns
  would silently re-enable a feature the user may have turned off on purpose.
  **A feature that has opted into its own integration is skipped entirely**
  (`hasSpecificIntegration()`): its connection does not depend on the global one, so an unusable
  value there means "still being configured", not "cannot run". Combined with the one-directional
  rule, disabling it would strand the user — the mandatory-integration flow forces
  `use_specific_integration` on precisely when the global connection is ChatGPT Web or empty, so
  the user would finish configuring the integration, watch the menus come back, and still find the
  feature switched off with no indication why.
- **The red permission banners are unaffected**: they are keyed on an explicitly chosen
  `chatgpt_web` / `anthropic_api` / `chatgpt_api`, so none of them can fire in the empty state.

Existing installs are unaffected — the empty default only applies to users who never saved the pref.

### Special Prompt Integration Overrides

The 6 special prompts (`add_tags`, `spamfilter`, `summarize`, `get_calendar_event`, `get_task`, `translate`) each get their own `use_specific_integration` and `connection_type` keys:

```
{prefix}_use_specific_integration   (default: false)
{prefix}_connection_type            (default: 'chatgpt_api')
```

These are generated programmatically at the bottom of `mzta-options-default.js` using `special_prompts_with_integration` array.

**The "Using \<provider\>" pill.** Each feature row in the options page carries an empty
`<span class="specific_api_indicator" id="{prefix}_specific_api_indicator">`, filled by
`updateSpecificApiIndicators()` (`options/mzta-options.js`) at init and from the
`storage.onChanged` handler. Two rules:

- The provider name comes from `getConnectionTypeLabel()` **exported by
  `pages/_lib/connection-ui.js`**, which resolves it through the shared
  `CONNECTION_TYPE_OPTIONS` catalogue. Do not re-derive the label by reading the global
  `#connection_type` select's `<option>` text: that select carries the disabled
  `value=""` placeholder (`prefs_Connection_type_none`, "— Select an AI connection —"), so an
  empty type resolves to that placeholder and the pill reads `Using — Select an AI connection —`.
  It is also wiped by `populateConnectionTypeOptions()`'s `replaceChildren()` on every
  repopulation.
- The pill is shown only when `use_specific_integration` is on **and**
  `!hasNoConnectionSelected(connection_type)`. The flag alone is not sufficient, because
  flag `true` + empty type is a **legitimate in-progress state**, not a corrupt one: when the
  global connection is `chatgpt_web` or empty the integration is mandatory, so
  `initializeSpecificIntegrationUI()` forces the checkbox on while
  `_persistMandatoryIntegration()` withholds the stored flag until a usable type is picked
  (`pages/_lib/connection-ui.js`). Unchecking the box also clears `{prefix}_connection_type`
  while leaving the flag (see below). In both cases `getConnectionType()` falls back to the
  global connection, so there is no per-feature provider to announce.

**Clearing on uncheck is centralized.** `initializeSpecificIntegrationUI()`'s checkbox handler
calls `clearPromptAPI(promptId)` — which empties the prompt's `api_type` and its per-integration
options — and, in the same branch, writes `{prefix}_connection_type: ''`. Both halves must go
together: `api_type` is what actually runs, while the pref is what the `prompt = null` call sites
read (the menu gating in `mzta-background.js`, the feature row in `mzta-options.js`). Leaving the
pref behind would strand a value that no longer matches the prompt and that nothing restores —
each page's seeding block only runs for a *non-empty* `api_type`, so the provider is not recovered
on re-check either. This lived as four copy-pasted per-page handlers (`addtags`,
`get_calendar_event`, `get_task`, `spamfilter`) while `summarize` and `translate` had none; do not
reintroduce a per-page copy.

**Turning the box on persists the shown connection.** Each page's `restoreOptions()` pre-fills
`{prefix}_connection_type` in the DOM with the global connection when that one is API-usable
(`isApiUsableConnection(getting['connection_type'])`, else `''` — `chatgpt_web` has no `<option>`
in a per-prompt select). That is a *display* default only: a user who accepts it without opening
the menu fires no `change`, so nothing would reach storage. `_persistSelectedConnection()` writes
it — from the checkbox handler's on-branch and from the initial-state apply (which also covers the
mandatory case, where the box is forced on at load) — skipping empty values and no-op writes.
Without it the panel shows a provider while the pref stays empty, and the options page's pill,
which reads the pref, stays hidden on a feature that looks configured.

That is why the `''` pre-fill must reach the DOM **as a blank select** on every page
(`selectedIndex = -1` for a closed-catalogue connection select, `isClosedCatalogueSelect()`).
In the mandatory case the box is forced on at load, so whatever the select shows is persisted
there and then: a select falling back to its first option would store OpenAI API as the
feature's connection, a choice the user never made, just by opening the page. `summarize` and
`translate` did exactly that (`selectedIndex = 0`) until 5.1; their other selects, which always
have a value, still fall back to their first option.

**The same label rule applies to the per-feature panel pill** (`#mzta_conn_pill_name`, set by
`bindConnPanelTint(prefix)` in `pages/_lib/feature-page.js`, which all six feature pages call):
it uses `getConnectionTypeLabel()` rather than reading the select's `<option>` text. Their selects are
per-prompt (`no_chatgpt_web: true`) and so carry no `value=""` placeholder, but the
`replaceChildren()` hazard applies to them just as much. The options page's own
`updateConnPanelTint()` is the one exception that still needs an explicit empty-state string:
its panel is always visible, so it prints `prefs_Connection_type_none` instead of the helper's
`''`, which would leave a bare dot.

### UI & Feature Preferences

| Key | Default | Description |
|-----|---------|-------------|
| `do_debug` | `false` | Enable debug logging |
| `chatgpt_win_height` | `800` | ChatGPT window height |
| `chatgpt_win_width` | `700` | ChatGPT window width |
| `chatgpt_win_top` | `''` | Window top position. `''` means no saved position. Written as a number by the options page (`type="number"` input) and by the background when the chat window closes with `chatgpt_win_save_position` on. **Any finite number is a position, 0 and negatives included** (the screen edge, a monitor left of the primary one); anything else (`''`, the `null` Thunderbird stores for a cleared number input) means "not saved". Read through `toWindowCoordinate()` / `getSavedWindowPosition()` (`js/mzta-utils.js`): the position is applied to a new chat window only when **both** coordinates are set. A loose `!= ''` test must not be used, as it reads 0 as empty (a window closed at the screen edge then came back elsewhere, until 5.1). The options page shows a value that is not a coordinate as an empty field, never as `0`. |
| `chatgpt_win_left` | `''` | Window left position: same rules as `chatgpt_win_top`. |
| `chatgpt_win_save_position` | `false` | Remember window position |
| `default_chatgpt_lang` | `''` | Force response language |
| `default_sign_name` | `''` | Default signature name |
| `reply_type` | `'reply_all'` | Default reply type |
| `chatgpt_web_model` | `''` | ChatGPT Web model override |
| `chatgpt_web_tempchat` | `false` | Use temporary chat |
| `chatgpt_web_project` | `''` | ChatGPT Web project |
| `chatgpt_web_custom_gpt` | `''` | Custom GPT URL |
| `chatgpt_web_load_wait_time` | `1000` | Wait time (ms) for ChatGPT page |
| `dynamic_menu_force_enter` | `false` | Force Enter to submit in popup |
| `dynamic_menu_order_alphabet` | `true` | Internal migration flag only; no UI. **Not declared in `prefs_default`** — unlike every other preference, its default (`true`) is hardcoded in the `browser.storage.local.get()` call in `js/mzta-prompts.js`, not in `options/mzta-options-default.js`. **Because that default means "not yet run", the flag has to be carried across by `migratePrefsToLocal()`** — reading it from an area the migration did not populate would re-run `migrateMenuOrderAlphabetic()` and overwrite the user's custom menu ordering. Set to `false` by `migrateMenuOrderAlphabetic()` on first boot after upgrade to bootstrap position-based ordering. It is therefore also one of the two deliberate **bypasses** of `js/mzta-prefs.js` — see [Preference access](#preference-access-jsmzta-prefsjs). See `claude-spec/02-prompts.md` for details. |
| `placeholders_use_default_value` | `false` | Use placeholder defaults when empty |
| `hide_thinking` | `true` | Controls the initial state of the thinking `<details>` block prepended above the answer: `true` = collapsed by default, `false` = open by default. The user can always toggle with a click; thinking content is never discarded. |
| `chat_show_usage_data` | `true` | Show the token counts the API reports as a chip in each answer's action bar in the chat window, whose detail popover also shows the context used and the session total. **Row visibility is conditional**: `disable_ChatShowUsageData()` in `options/mzta-options.js` hides `#chat_show_usage_data_tr` unless at least one *currently configured* integration reports usage — the global `connection_type` or any `special_prompts_with_integration` prefix resolved through `getConnectionType()`, tested with `supportsUsageData()` from `js/mzta-utils.js`. A web-only setup never sees the row. The nested `#chat_show_usage_data_openai_comp_note` is shown only when one of those types is `openai_comp_api`, because availability then depends on the specific server. Both are `display:none` in the markup so there is no flash before the function runs, and the function is called at load, on every `connection_type` change, and from the `storage.onChanged` handler that also refreshes the feature rows. |
| `diff_granularity` | `'words'` | Comparison unit the proofreading change picker **opens with**: `'words'` or `'sentences'`. The picker's own toolbar toggle changes it for the current review; there is no per-prompt override — see [07-diff-picker.md](07-diff-picker.md). Rendered as a `<select>` in the advanced section; needs an explicit entry in `restoreOptions()`'s `select-one` branch, since a select restoring to `''` would render blank. |
| `max_prompt_length` | `30000` | Max prompt string length |
| `special_command_timeout` | `120000` | Timeout (ms) before a hung special-command API worker is aborted (`js/mzta-special-commands.js`). Exposed in the main options page as a number input; **always shown** (not hidden for ChatGPT Web), because a single special prompt may use a specific API even when the global `connection_type` is `chatgpt_web`. Has no effect on ChatGPT Web connections, which use no API worker. |
| `batch_max_concurrency` | `1` | Maximum messages processed at once by one `processEmails()` call (auto add tags, spam filter, summarize and translate — on receive and from the context menu). Each message runs its features in series (spam, add_tags, summary, translate), so this is also the maximum number of AI requests in flight. There are no per-feature caps. Overlapping calls (several accounts) can exceed it. A value that is not a finite number ≥ 1 (a cleared field is saved as `NaN`) falls back to the default. Number input (`min="1"`) in the advanced section of the main options page, with its default wired into `restoreOptions()`. Does not affect the context-menu summarize flow. See [01-architecture.md](01-architecture.md#per-message-pipelines-in-processemails). |

### Feature Flags

| Key | Default | Description |
|-----|---------|-------------|
| `add_tags` | `false` | Enable auto-tagging feature |
| `add_tags_maxnum` | `3` | Max tags to apply: asked of the model as `prompt_add_tags_maxnum N.` when `> 0` (see [02-prompts.md](02-prompts.md#add-tags-extra-prompt-statements)). `0` = no limit, no statement. Number input with `min="0"`. |
| `add_tags_max_messages` | `0` | Maximum number of messages tagged at once from the **context menu**. Above this limit `processEmails()` (`mzta-background.js`) blocks the run and shows the `add_tags_too_many_messages` warning. `0` = no limit. Automatic tagging of incoming mail is never capped. Exposed in the add tags settings page as a number input (`min="0"`, no reset button: the page's restore fallback for number inputs is already `0`). Meant for providers with a daily quota (#901), where a large selection cannot fit anyway. |
| `add_tags_hide_exclusions` | `false` | Hide excluded tags from menu |
| `add_tags_exclusions_exact_match` | `false` | Exact match for exclusions |
| `add_tags_exclusions` | `[]` | Tags never assigned: array of strings, substring match unless `add_tags_exclusions_exact_match`. Read and written through `mztaPrefs` by `js/mzta-addtags-exclusion-list.js` (background and the Add Tags page) and, for the tag dialog in `js/mzta-compose-script.js`, through the `addtags_get_exclusion_prefs` / `addtags_set_exclusions` background commands. Entries are stored lowercase by both writers (the page via `normalizeStringList()`, the dialog's exclude icon by lowercasing), and the dialog adds and removes them case-insensitively. The storage key predates its declaration, so existing lists carry over with no migration. Policy-settable. |
| `add_tags_first_uppercase` | `true` | Capitalize first letter of tags |
| `add_tags_force_lang` | `true` | Force language for tags |
| `add_tags_auto` | `false` | Auto-tag on message open |
| `add_tags_auto_force_existing` | `false` | Only use existing tags. The prompt gets the existing tags list (or its intersection with the use list), and force_lang is not appended. Non-existing tags in the response are dropped. See [02-prompts.md](02-prompts.md#add-tags-extra-prompt-statements) |
| `add_tags_auto_only_inbox` | `true` | Auto-tag only inbox messages |
| `add_tags_auto_include_sent` | `false` | Also auto-tag sent messages (opts back into the `sent` folder, which the automatic processing skips by default) |
| `add_tags_auto_uselist` | `false` | Use tag allow-list |
| `add_tags_auto_uselist_list` | `''` | Tag allow-list content |
| `add_tags_enabled_accounts` | `[]` | Accounts where auto-tag is active: account ids, per profile, so **not** policy-settable. `[]` = all accounts. Replaced at read time — never overwritten — by the ids resolved from `add_tags_enabled_accounts_match` when a policy sets it (`resolveEnabledAccounts()`, `js/mzta-utils.js`). |
| `add_tags_enabled_accounts_match` | `[]` | **Policy-only**, no control of its own: account matchers (`user@domain`, `@domain` / `*@domain`, `local` for Local Folders) resolved to account ids on every automatic batch; the result replaces `add_tags_enabled_accounts`, and an empty result means **no** account. `[]` = not managed. Always enforced, validated entry by entry. See [08b-managed-connections.md](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match). |
| `get_calendar_event` | `true` | Enable calendar event extraction |
| `get_calendar_event_from_clipboard` | `false` | Enable calendar from clipboard (the clipboard prompt is shown only with `get_calendar_event` on too, see [02-prompts.md](02-prompts.md#special-prompt-visibility-dependencies)). On the Calendar Event page, switching it **on** first requests the optional `clipboardRead` permission: granted, `true` is stored and the menus are reloaded; refused, the switch goes back off, an `alert()` says why (`clipboard_permission_denied`, or `clipboard_permission_error` when the request throws) and the stored value is `false`, never a `true` the permission does not back. Switching it **off** stores `false`, requests nothing and reloads the menus. |
| `get_task` | `true` | Enable task creation |
| `calendar_enforce_timezone` | `false` | Force specific timezone |
| `calendar_timezone` | `''` | IANA timezone id to enforce (see note below) |
| `calendar_no_selection` | `false` | Skip selection prompt. **The single source of truth**: `need_selected` of `prompt_get_calendar_event` is derived from it on every read by `applyCalendarNoSelection()` in `getSpecialPrompts()` (see [02-prompts.md](02-prompts.md)), never written from it. A change reloads the menus (`MENU_RELEVANT_KEYS`). `migrateCalendarNoSelection()` aligned it once to the stored `need_selected` on upgrade, or, with no calendar prompt stored, to the shipped one (`"1"`: a preference stored `true` becomes `false`). A stored `need_selected` that is missing or out of domain (anything but `"0"`/`0`/`"1"`/`1`/`true`: `""`, `null`, `false`...) counts as the shipped `"1"`, which is how every 5.0.x read it (`normalizePromptFlags()` with the built-in fallback): only `"0"`/`0` means the prompt ran without a selection. On the Calendar Event page the option only makes sense with a prompt that reads the whole body, i.e. one holding `{%mail_text_body_or_selected%}` or `{%mail_html_body_or_selected%}`. Two guards keep it so: **switching it on** while the prompt text **in the editor** (saved or not) holds neither shows an `alert()` (`prefs_OptionText_calendar_no_selection_missing_placeholder`), turns the switch back off and stores `false` again (the page's `saveOptions()` has already stored `true`); and **while it is on, Save refuses** such a text with an `alert()` (`prefs_OptionText_calendar_no_selection_save_missing_placeholder`), storing nothing and leaving Save enabled. Reset needs no check: the shipped text has the placeholder. |
| `calendar_append_email_link` | `false` | Append a `mid:` link to the source email to the event description (added by code after the response, never sent to the AI — see [02-prompts.md](02-prompts.md#calendar-event--task-link-to-the-original-email)). Deliberately **not** prefixed `get_calendar_event_`, which is the per-feature integration prefix |
| `task_append_email_link` | `false` | Same, for the task description. Deliberately **not** prefixed `get_task_` |
| `calendar_reminder_enabled` | `false` | "Let the AI set a reminder" for events: ask for `reminderMinutes` and send `-1` (no reminder) when the AI returns none/invalid; Thunderbird's default when the AI answers `"default"` (no rules given at all). It is the **single switch**: when false, `reminderMinutes` is always dropped from the AI response (Thunderbird's default), even if the main prompt asks for it — see [02-prompts.md](02-prompts.md#calendar-event--task-reminder-887). Not prefixed `get_calendar_event_` (integration prefix) |
| `calendar_reminder_rules` | `''` | Optional natural-language reminder rules, appended to the event prompt (after `prompt_reminder_rules_intro`) only when `calendar_reminder_enabled` is true |
| `task_reminder_enabled` | `false` | Same as `calendar_reminder_enabled`, for tasks (reference: due date, or initial date) |
| `task_reminder_rules` | `''` | Same as `calendar_reminder_rules`, for tasks |
| `spamfilter` | `false` | Enable spam filter |
| `spamfilter_threshold` | `70` | Spam confidence threshold (%). The settings page warns next to the field (`#spamfilter_threshold_too_low`): below 50 with `spamfilter_threshold_too_low`, at 0 with `spamfilter_threshold_zero` (larger), hidden from 50 up. Refreshed at load and on every `input`. A warning only: any value from 0 to 100 is stored, 0 included ("flag everything", see `getSpamThreshold()`). |
| `spamfilter_enabled_accounts` | `[]` | Accounts where the automatic spam filter is active: account ids, per profile, so **not** policy-settable. `[]` = all accounts. Replaced at read time — never overwritten — by the ids resolved from `spamfilter_enabled_accounts_match` when a policy sets it. |
| `spamfilter_enabled_accounts_match` | `[]` | **Policy-only**, same as `add_tags_enabled_accounts_match`, for the automatic spam filter. |
| `spamfilter_skip_addresses` | `[]` | Allow list: senders never sent to the AI for spam filtering (report with spamValue 0). Entries are exact addresses, `@domain.com` or `*@domain.com`, matched by `matchAddressListType()` like `summarize_auto_senders_list`. Lists saved before domain support hold exact addresses only, which match exactly as before. Tested with `hasAddressListEntries()` (see the note below the table). |
| `spamfilter_block_addresses` | `[]` | Block list: senders always reported as spam (spamValue 100) without an AI call; in automatic mode (`autoMove`) the message is also marked junk and moved to the account's junk folder. Same entry syntax as `spamfilter_skip_addresses`. On a sender in both lists the more specific entry wins (exact beats domain), and on equal specificity the allow list wins. Both lists are checked before `spamfilter_skip_addressbook`. Saved by its own Save button through `normalizeStringList(value, 2)`. See [01-architecture.md](01-architecture.md#data-flow-spam-filter-sender-rules). |
| `spamfilter_skip_addressbook` | `true` | Skip senders found in any address book (`browser.contacts.quickSearch`). On the settings page the switch is saved by its own handler, not by the page's `saveOptions()`: switching it **on** first requests the optional `addressBooks` permission and stores `true` only once it is granted; refused, the switch goes back off, an `alert()` says why (`addressbook_permission_denied`, or `addressbook_permission_error` when the request throws) and nothing is stored. Switching it **off** stores `false` and requests nothing. |
| `spamfilter_show_msg_panel` | `true` | Show info panel on spam detection |
| `spamfilter_only_inbox` | `false` | Auto spam filter runs only on inbox messages |
| `summarize` | `false` | Enable email summarization |
| `summarize_auto` | `1` | Auto-summarize mode: `0` = disabled, `1` = manual (show "click to generate" button), `2` = automatic (generate on message open), `3` = generate on email receive (background pre-cache via `onNewMailReceived`, no UI during generation) |
| `summarize_display_mode` | `'inline'` | Where to display summaries: `'inline'` = message pane banner, `'webchat'` = AI chat window. Note: `summarize_auto = 2` and `summarize_auto = 3` always use inline regardless of this setting. |
| `summarize_max_display_length` | `0` | Maximum characters shown in inline summary before truncation. `0` = no limit (show full text). When set, text is truncated at a word boundary and a "See more"/"See less" toggle link is shown. |
| `summarize_max_messages` | `20` | Maximum number of messages summarized at once in webchat mode. Above this limit `processEmails()` (`mzta-background.js`) blocks the operation and shows the `summarize_too_many_messages` warning. `0` = no limit. Only applies to the webchat/multi-message flow; inline single-message summaries are unaffected. Exposed in the summarize settings page. |
| `summarize_strip_formatting` | `false` | Strip HTML and Markdown formatting from AI-generated summaries, showing plain text only. |
| `summarize_force_lang` | `false` | Force the summary language. When on, `buildSummaryPrompt()` appends `prompt_summarize_force_lang + " " + lang + "."` once, on its own line, at the end of the whole prompt (see [02-prompts.md](02-prompts.md)). Off = exactly the previous behaviour (`getDefaultLang(prompt_summarize)`). Cached summaries are not regenerated. |
| `summarize_lang` | `''` | Summary language used when `summarize_force_lang` is on. Falls back to `default_chatgpt_lang`; if both are empty nothing is appended (the `reply_same_lang` fallback of `getDefaultLang()` is never used). Plain `type="text"` input, not a textarea, so `saveOptions()` does not run `normalizeStringList()` on it. |
| `summarize_auto_senders` | `false` | Auto-summarize emails whose sender matches `summarize_auto_senders_list`. **Independent of `summarize_auto`** — it works even when `summarize_auto = 0`. See [01-architecture.md](01-architecture.md#data-flow-auto-summarize-by-sender-address-list) for the two triggers. |
| `summarize_auto_senders_list` | `[]` | Sender addresses / domain patterns matched by `matchAddressList()` (`js/mzta-utils.js`): exact address, `@domain.com`, or `*@domain.com`. Stored as an array via `normalizeStringList(value, 2)`; tested with `hasAddressListEntries()` (see the note below the table). |
| `translate` | `true` | Enable email translation |
| `translate_auto` | `0` | Auto-translate mode: `0` = disabled, `1` = manual (show button), `2` = automatic (translate on message open), `3` = generate on email receive (background pre-cache via `onNewMailReceived`, no UI during generation) |
| `translate_max_display_length` | `0` | Maximum characters shown in inline translation before truncation. `0` = no limit (show full text). When set, text is truncated at a word boundary and a "See more"/"See less" toggle link is shown. |
| `translate_lang` | `''` | Target language for translation. Falls back to `default_chatgpt_lang` if empty. |
| `translate_exclude_lang` | `''` | Languages the translation skips: free text, typically comma-separated language codes (`en, fr, it`), stored trimmed as typed (not normalized). **No code reads it**: it only fills `{%thunderai_translate_exclude_lang%}` in `prompt_translate_this`, whose shipped text asks the AI to answer `status: -1` when the email is in one of those languages (or already in the target one), which the banner shows as "skipped" (see [02-prompts.md](02-prompts.md#translate-inline-only-prompt-system)). So the decision is the AI's, after the request: the manual button is still shown, and an automatic translation still makes the call. Empty = no exclusion (the placeholder resolves to `""`). A user prompt without the placeholder ignores it. |

#### Address-list preferences and the empty-string trap

The user-typed lists (`spamfilter_skip_addresses`, `spamfilter_block_addresses`, `summarize_auto_senders_list`,
`add_tags_exclusions`, `add_tags_auto_uselist_list`) all go through `normalizeStringList()`
(`js/mzta-utils.js`), which splits on newlines **and** commas, trims, lowercases, dedupes,
**drops the empty entries** and sorts. `returnType` selects the shape: `0` comma-separated
string (default), `1` newline-separated string, `2` array.

Dropping the empty entries is what keeps the saved value honest. Before, an emptied textarea
persisted as `['']` and a trailing newline left a stray `''` behind, so a plain `list.length > 0`
read as "the user configured a list" when they configured nothing — and with `returnType 1`
(`add_tags_auto_uselist_list`, which is stored as a *string*) the `''` was joined back into a
**leading blank line** that reappeared in the textarea on every save and reload. It also accepts
a non-string argument (`null`/`undefined` → empty list) rather than throwing on `.split`.

**`hasAddressListEntries(list)` is still required** for every "is this list configured?" test:
lists saved by previous versions keep their stray `''` until the user next saves that page, and
the helper is also what makes the check safe against a value that is not an array. It is used by
the spam filter's skip-address check, by `_process_incoming`, by `processEmails()`, by
`matchAddressList()` itself, and by the summarize page's conditional notice.

Neither change alters any *matching* outcome, and that is by design — both consumers of a
possibly-blank entry already neutralized it: the spam filter's `['']` fell through to a
`.includes(senderEmail)` that an empty string can never satisfy, and `checkExcludedTag()`
(`js/mzta-addtags-exclusion-list.js`) opens with an explicit `excluded_word === ''` → `false`
guard, without which `''.includes('')` would have excluded *every* tag.

#### Account selector (Spam Filter and Add Tags pages)

`spamfilter_enabled_accounts` and `add_tags_enabled_accounts` are edited by the same selector on their
pages: one checkbox per account (`accounts.list()`), checked as stored (`[]` checks them all).

- **Every change is stored at once**, the selection the boxes show: `[]` when every account is
  checked, the checked ids otherwise.
- **At least one account stays selected.** Unchecking the last checked box is refused (the box comes
  back on, nothing is stored).
- **"Select all"** checks every box and stores `[]`. **"Deselect all"** keeps only the **first**
  account checked and stores its id (or `[]` when it is the only account): a start from which to add
  the others, never an empty selection. Both store what they show, like a single box: setting
  `checked` from code fires no `change`, so the buttons save explicitly. Until 5.1 they only ticked the
  boxes, and the selection shown was not the one stored until a box itself was clicked.
- With a policy `*_enabled_accounts_match` the selector is read-only and nothing is stored (see
  [08b-managed-connections.md](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match)).

### Timezone Select (`pages/_lib/mzta-timezones.js`)

The timezone `<select>` shown on the Calendar Event (`pages/get-calendar-event/`) and Task
(`pages/get-task/`) pages is **not** hardcoded in the HTML. Both pages ship an empty
`<select id="calendar_timezone" class="option-input">` containing only the empty option, and call
`initTimezoneSelect(document.getElementById('calendar_timezone'))` to fill it.

- The list is generated at runtime from `Intl.supportedValuesOf('timeZone')` (~418 zones), so it always
  matches the tzdata of the running Thunderbird and needs no manual maintenance.
- Each option's label is `(UTC±HH:MM) Area/City`, e.g. `(UTC+05:30) Asia/Calcutta`. The offset is computed
  with `Intl.DateTimeFormat(..., {timeZoneName: 'longOffset'})` against the **current date**, because offsets
  are DST-dependent. The label always ends with the option value, so the fallback option that
  `restoreOptions()` injects for an unknown stored value looks consistent with the generated ones.
- Options are sorted by UTC offset, then by id.
- `Intl.supportedValuesOf()` returns ICU's **legacy canonical** ids: `Asia/Calcutta` (not `Asia/Kolkata`),
  `Asia/Rangoon` (not `Asia/Yangon`), `Asia/Katmandu`, `Europe/Kiev`. This is intentional — no alias layer.
- The select is wrapped in Tom Select for search. Three config values are load-bearing: `maxOptions: null`
  (the default caps the dropdown at 50), `sortField: null` (sorting by label would move every negative
  offset after the positive ones, since `-` sorts after `+`), and `closeAfterSelect: true` (see below).
- Both Tom Select instances — this one and the model dropdowns in `pages/_lib/connection-ui.js` — combine
  `closeAfterSelect: true` with a `this.blur()` in the `change` handler, so the control returns to its compact
  state as soon as an option is picked. Neither is enough alone: Tom Select only hides the search input in
  `inputState()` when the control is not focused, so without the `blur()` the caret stays on its own line until
  the user clicks elsewhere; without `closeAfterSelect` the dropdown would linger open. Because the handler
  blurs, the initial `setValue()` that seeds the stored value is passed `true` (silent) — the border is set by
  the explicit `setTomSelectBorder()` call right after it.
- **The `blur()` applies to a *selection* only.** `change` also fires when Backspace/Delete clear the current
  value (`onKeyDown` → `deleteSelection()` → `removeItem()` → `change`), and there blurring is wrong: the user
  wants to delete the value and immediately type a new search, not lose the caret and have to click the control
  again. Both instances therefore pass an `onDelete` callback — Tom Select calls it from `shouldDelete()`
  *before* the item is removed, so it runs ahead of `change` — which sets a `deleting` flag that the `change`
  handler checks: when set, it clears the flag, calls `open()` and focuses `control_input` instead of blurring.
  The explicit `open()` matters because `deleteSelection()` ends with `refreshOptions(false)`, which does not
  force the dropdown open, so a Backspace on a focused-but-closed control would otherwise stay closed. Do not
  swap the focus call for `ts.focus()`: that defers `onFocus()` through a `setTimeout` and sets `ignoreFocus`,
  needless churn when the control never lost focus. Returning anything but `false` from `onDelete` lets the
  deletion proceed.
- **The caret must share the line with the selected value.** `.ts-control` is `display:flex; flex-wrap:wrap`,
  and in a single select the chosen value is a sibling `div.item`, not the input's own text. The vendored
  build is the **plugin-free** one, which styles `.item` only under `plugin-*` selectors — so here `.item` is
  an unstyled block flex item. Its `min-width` therefore resolves to `auto`, i.e. its **min-content width**,
  and a model id like `claude-sonnet-4-5-20250929` is a single unbreakable token: the item cannot shrink, item
  plus input overflow the control, and `flex-wrap` drops the input — and the caret — onto a second row.
  The fix is `min-width: 0` **on the item** (plus `flex-wrap: nowrap` and an ellipsis), applied in both
  stylesheets that theme Tom Select: `pages/_lib/mzta-design.css` under `#mzta_card`, and
  `pages/customprompts/mzta-custom-prompts.css` under `.api_panel` (the detail editor's API section).
  Two traps worth remembering: `max-width` alone does nothing, because the automatic minimum wins over it in
  flex sizing; and the input must keep a non-zero basis (`flex: 1 1 4px`) or the caret collapses to zero width
  and becomes invisible. Note the vendored `min-width:7rem` on `.ts-control > input` is *not* the cause — it
  is not `!important` and both overrides outrank it on specificity.
- Tom Select theming lives in `pages/_lib/mzta-design.css`, scoped to `#mzta_card` so it covers every select on
  the design-system pages (it used to be scoped to `#connection_ui_table`/`#connection_ui_adv_table`, which left
  other Tom Selects unstyled). The vendored `tom-select.default.min.css` hardcodes light colors, so the control,
  the inner `<input>` that renders the selected item, and the dropdown each have to be pointed at the theme
  tokens — otherwise the text stays dark on a dark field in the dark theme. The legacy Custom Prompts page is
  not part of this design system (no `#mzta_card`, does not link `mzta-design.css`) and is unaffected.
- `initTimezoneSelect()` must be called **before** `initializeSpecificIntegrationUI()`, which invokes
  `restoreOptions()` via its `restoreOptionsCallback`. Populating later would make restore inject a bare
  unlabelled option that the populate step would then duplicate. Population is idempotent
  (`select.dataset.tzPopulated`).
- The stored pref value stays a plain IANA id, so the JSON payload sent to the external Sparks add-on
  (`js/mzta-menus.js`) is unchanged. Values stored by older versions still work through the existing
  `restoreOptions()` fallback.
- **The timezone is optional.** The empty value is a legitimate choice meaning "no timezone enforced",
  and it is the factory default (`calendar_timezone: ''`). The `<select>` therefore carries a
  `data-empty-ok` attribute, which tells `setTomSelectBorder()` (`js/mzta-utils.js`) not to paint the
  red "missing value" border when nothing is selected — otherwise every fresh profile would open the
  page with the field already flagged as an error. For every other Tom Select, which has no such
  attribute, an empty value keeps being highlighted in red.

### Summarize Settings Page (`pages/summarize/`)

The summarize settings page provides:

1. **Specific integration checkbox** — enables per-feature API override (like other special prompts)
2. **Auto-summarize dropdown** (`summarize_auto`) — three modes:
   - `0` (Disabled) — no inline summaries
   - `1` (Manual) — shows a "Click to generate summary" button in message display
   - `2` (Automatic) — generates summary immediately when message is opened
3. **Display mode dropdown** (`summarize_display_mode`) — controls where summaries are shown:
   - `'inline'` — summary banner in the message pane (default)
   - `'webchat'` — opens the AI chat window
   - Note: `summarize_auto = 2` and `summarize_auto = 3` always generate inline regardless of this setting. Context menu summarize with multiple messages always falls back to webchat.
4. **Max display length** (`summarize_max_display_length`) — number input, limits inline summary text to N characters. `0` = no limit. When truncated, a "See more"/"See less" toggle link is appended.
5. **Max messages** (`summarize_max_messages`) — number input (`min="0"`, so `0` can be picked as well as typed), caps how many messages can be summarized at once in webchat mode. Above the limit the operation is blocked with the `summarize_too_many_messages` warning. `0` = no limit. Its **Reset** button (`#reset_summarize_max_messages`, `data-mzta-companion-of` the field) puts the `prefs_default` value (20) back in the field and stores it with `setPref()`, as a number, firing no `change`; for a policy-locked key it does nothing (`isLockedKey()`), as the options page's Reset buttons.
6. **Strip formatting** (`summarize_strip_formatting`) — checkbox, removes HTML/Markdown formatting from AI summary responses, displaying plain text only. Default: off.
   - **Force summary language** (`summarize_force_lang`) — checkbox, followed by the `summarize_lang` text field inside `#summarize_lang_container`, which `updateForceLangState()` hides while the toggle is off (on load, on toggle change, at the end of `restoreOptions()`). Below the main prompt editor, `#summarize_info_additional_statements` previews the statement that will be appended, computed by the same `taPromptUtils.getSummaryLang()` used by `buildSummaryPrompt()`, and is hidden when nothing is appended. It is refreshed from `browser.storage.onChanged` (keys `summarize_force_lang`, `summarize_lang`, `default_chatgpt_lang`), not from the controls' `change` event, because `saveOptions()` does not await `setPref()`. The two other `.summarize_info_additional_statements` divs (email template, separator) are unused.
7. **Automatic summary sender list** — its own `.mzta_section` card (see the visual-design note below), holding the `summarize_auto_senders` toggle and the `summarize_auto_senders_list` textarea. The textarea carries **no** `.option-input` class: like the spamfilter skip list it is saved explicitly by its own Save button through `normalizeStringList(value, 2)`, with the `#auto_senders_unsaved` indicator handled exactly as in `pages/spamfilter/mzta-spamfilter.js`. `updateAutoSendersState()` disables the textarea and its Save button when the toggle is off, and disables the **whole card** (plus showing an explanatory note) when `summarize_auto === 3`, since that mode already summarizes every incoming message; it is called on load, on every toggle change, and from `updateDisplayModeConstraint()`.
8. **Three editable prompts** (used by context menu summarize and webchat mode):
   - Summarize instruction prompt (`prompt_summarize`)
   - Email template prompt (`prompt_summarize_email_template`)
   - Email separator prompt (`prompt_summarize_email_separator`)
   - Each has Save/Reset buttons and placeholder autocomplete
   - Default text comes from i18n strings (`prompt_summarize_full_text`, etc.)

### Manage Custom Prompts Page (`pages/customprompts/`)

The prompt CRUD screen, **design "2a": one list, two views**. A single card (`#prompts_card`) holds a toolbar, one List.js list and a detail editor. Data model, storage routing, and the "Menu position" deep-link to the Menu Order page are documented in `claude-spec/02-prompts.md`.

**Theme.** Colors are CSS custom properties on `:root` (light default) with a `@media (prefers-color-scheme: dark)` override; the dark values are the design's palette. No manual toggle. The page keeps its own private token block and does not use `pages/_lib/mzta-design.css`.

**Layout.**
- Header (eyebrow, title, description, Custom Data PH button) with the `#import_export` stack on the right, then the two managed-restriction notes, then the card.
- The card fills the viewport height (`calc(100vh - 48px)`, min 520px), so the list and the detail pane scroll on their own.
- **Toolbar** (`#command_palette`): search, `#prompts_count` (`customPrompts_promptsCount` / `customPrompts_promptsCount_filtered`), `#filter_badge`, `#msgDisplay`, the view switch (`#view_switch`, a segmented control of `aria-pressed` buttons) and `#btnNew` ("New prompt"). There is **no Save All**: every change is written to storage as soon as it is made (see *Saving* below), and the page header says so (`customPrompts_autosave_info`).
- The detail inputs are styled under `#detail_body .detail_input`: `connection-ui.css` (linked after this stylesheet) sets `input[type="text"] { padding: 2px }`, which would otherwise outrank a bare class.
- `#card_body` is a grid: `340px | 1fr` in split view (list + `#detail_pane`), a single column in table view (the pane is `display:none`).

**One list, two views.**
- There is exactly **one** List.js instance, `new List('prompts_card', …)`, on `<div class="list" id="prompts_list">`. The card's class, `view-split` or `view-table`, only changes how the *same* row DOM is laid out with CSS grid. Search, count and selection therefore carry across a switch with no List.js work. `setView()` also closes the row menu.
- The choice is persisted in the `custom_prompts_view` pref (`'split'` default | `'table'`), read at load and written with `mztaPrefs.setPref()`.
- **Split view**: a 3-line master row — padlock icon (read-only prompts, inline SVG in `currentColor`) + name + type badge / id (mono) / 1-line text preview. Click or Enter selects; ArrowUp/Down move focus. The selected row has `--sel-bg` and a 3px `--sel-bar` left border. The menu/action value is intentionally not shown here.
- **Table view**: `#table_head` plus the rows on a shared 5-column grid (Prompt · Text · Menu · Options · Actions). *Options* shows read-only chips: every active flag plus the first inactive one (`● Label` on `--ok-*`, `○ Label` muted), with the full flag label as `title`. Below 1200px the grid switches to narrower minimums with a shrinkable text column: `#table_head` sits outside the scrolling list, so horizontal scrolling would misalign it. *Actions* is "Edit" ("Open" on read-only prompts), which calls `openInDetail()` — select it and switch to split view — and a ⋯ button.
- **Row menu (⋯)**: one shared popover appended to the card on open (`openRowMenu()`), with a transparent full-screen overlay catching the outside click. It is right-aligned under the button, opens **upward** for the last two visible rows (when more than three are visible), and closes on overlay click, Esc, list scroll, window resize, search input and view switch. Items: personal prompts get Duplicate · Export · divider · Delete (danger, confirmed); read-only prompts (built-ins included) get Duplicate and edit only. No shortcut hints and no "Copy ID", by design.

**Order and arrival.** The list is in the order `getPromptsForManagement()` returns, by id (`localeCompare`); a prompt created on the page is appended at the end until the next load. On arrival the detail pane shows the first visible row, so it is never empty (if the user picked a prompt while the connection UI was still loading, that one is reloaded instead).

**Newlines in the text.** The editor works on real newlines: `textForEditor()` turns a stored `<br>` (the form older versions wrote) into `
`, and Save stores the textarea's value, so `
`. The one-line preview and the search collapse either form into a space.

**Rows are painted by `refreshRow(item)`, not by List.js.** `valueNames` is only `[{ data: ['idnum'] }]`: List.js' templater owns nothing but `data-idnum`, which the delegated row handlers use to find an item. The item template (`rowTemplate()`) is a static skeleton, and `refreshRow()` writes every visible value with `textContent` / DOM nodes — resolved name, id, type badge, preview text with placeholder chips, menu/action labels, chips, button labels, selection and dim classes. This is why:
- a built-in's `__MSG_` name survives an `item.values()` write (the templater used to reset `.name` to the raw token);
- no prompt value is ever parsed as markup;
- rows need no re-wiring after add, import or a List.js re-render — all row interaction goes through **delegated** listeners on `#prompts_list` (`bindListEvents()`, bound once).

`refreshRow()` is called after the list is built, after every `values()` write, after `add()`, and for every row once `activePlaceholders` has loaded (`refreshAllRows()`).

**Type badges and read-only state** come from `rowState(values)`:
- **System** (`is_default`), **Personal**, or the organization badge (`is_org`, labelled with the policy's organization name, falling back to `customPrompts_org_badge`).
- `locked` = built-in, org, shadowed, `_inert_by_policy` or `_default_inert_by_policy`. Shadowed and inert rows are also dimmed (`.is_dimmed`).

**Search** (`#prompts_search`, class `prompts_search_input`): filters on prompt **name, ID and text**, through `promptsList.search(str, ['name','id','text'], promptsSearch)`.
- The custom function is required, not a refinement: built-in names are `__MSG_` tokens, so `resolvePromptName()` unwraps them first, and the text is matched in its one-line preview form (`<br>` → space).
- The input deliberately does **not** carry List.js' default `searchClass` of `search`: it lives inside the List container, so List.js would auto-bind a second, competing plain-text filter on the same field.
- Filtering is display-only and cannot lose data: `writePrompts()` iterates `promptsList.items`. The detail pane keeps showing its prompt, pending edits included, even when the search filters that row out.
- Matches in the visible name and id are wrapped in `<mark class="search_hit">` (`--hit-*` tokens; metric-neutral). `highlightSearchMatchesIn()` reads the text back with `textContent`, so it is idempotent and marks never nest. `refreshRow()` repaints its own row, and the input handler repaints all rows, because narrowing a needle within an unchanged result set fires no `updated`.
- **`#filter_badge`** states that the list is filtered (`customPrompts_filter_active`, or `customPrompts_filter_noMatches` + `.filter_badge_empty`), with `#btnClearFilter`. It is `role="status" aria-live="polite"`. It is **not** routed through `#msgDisplay`, which is owned by `setMessage()` / `clearMessage()`: "filtered" and the save status are independent states that must be able to show at the same time. `#filter_badge.hiddendata` is declared explicitly, since the badge's own `display` would otherwise tie with `.hiddendata`.
- `setupPromptsSearch()` runs again after an import (a new List instance), so its listener is guarded by `promptsSearchBound`; the field value is reset on every call.

**Detail editor (`#detail_pane`).** A single static editor, never a List.js item. `detailMode` is `'none' | 'edit' | 'new'`, and `selectedIdnum` identifies the item in edit mode.
- `loadDetail(item)` → `fillDetail(values)` + `applyDetailState(rowState(values))`.
- **Header**: title + read-only badge + id on the left, the action buttons on the right, and the **Menu position** button (edit mode only) centred between them by two `.toolbar_spacer`s.
- **Fields**: ID and Name inputs (one per row, full width, `.field_stack`), the highlighted prompt textarea, Add to menu / Action selects, and two disclosures for the per-prompt connection override:
  - **[API]**: `injectConnectionUI()` runs **once**, with prefix `detail_prompt_`, into `#detail_api_panel`. Its `.conn_adv` rows are relocated behind `.conn_adv_btn` by `relocateConnAdvRows()` and kept in sync by `showAdvConnectionOptions()`. `populateConnectionUI()` falls back to the global pref for an unset value, restores TomSelect values, and re-runs `updateWarnings()` / `checkJsonFieldsByPrefix()` because `.value` writes fire no `input`. The Reset button (`resetApiSettings()`) only clears the pane, as a pending edit.
  - **[ChatGPT Web]**: model / project / custom GPT, shown only while the global connection is `chatgpt_web`, the prompt sets no `api_type` and the prompt is editable (`updateChatGPTWebVisibility()`, re-run on every api_type change). Both disclosures auto-open when the prompt already carries an override: [API] only when it has an `api_type` (`hasApiOverrideValues()`; every save stores all the integration fields, seeded from the global prefs, so their presence alone means nothing and nothing reads them without an `api_type`), [ChatGPT Web] when it has a model, project or custom GPT. `setDisclosure()` opens and closes both, keeping `aria-expanded` and the toggle's tooltip in step: `customPrompts_show_additional_info` while closed (also the markup's initial `title`), `customPrompts_hide_additional_info` while open.
- **ID from the name**: when `fillDetail()` finds the ID empty (a blank new prompt), `detailIdAuto` links it to the name: every `input` on `#detail_name` rewrites `#detail_id` with `promptIdFromName()` — accents dropped (NFD), lowercased, each run of characters outside `[a-z0-9]` collapsed into `_` and trimmed, made unique among the other prompts with `_2`, `_3`, …; a name with no Latin letters or digits gives `''`. Typing in the ID breaks the link, emptying it restores it. A copy's seed has an ID, so it is never linked.
- **Options** column: the five flags as 34×20 switches (`.flag_switch` in `.flag_row`).
  - `use_diff_viewer` is only selectable when the action is "substitute text" (`updateDiffViewerState()`), with `#detail_diff_hint` explaining why.
  - `checkPromptsConfigForPlaceholders()` rings (`.invalid_flag`) `need_custom_text` / `need_selected` when the text uses `{%additional_text%}` / `{%selected_text%}` / `{%selected_html%}` but the flag is off.
- **Read-only prompts** (`locked`):
  - The ID, name, selects and connection sections are disabled or hidden, and an existing override is summarized in `#detail_conn_readonly`.
  - The textarea is `readOnly`, not disabled, so its text stays selectable. The `.editor-wrap.is_readonly` style is dashed and muted.
  - The header shows a "Read-only" badge.
  - `#detail_banner` explains why, most specific reason first: `customPrompts_shadowed_note` / `customPrompts_policy_inert_note` (amber, `.banner_warn`), `customPrompts_org_banner` (+ `customPrompts_org_shadowing_note`), `customPrompts_system_banner`, `customPrompts_policy_default_inert_note`.
  - Flags follow the data model, not a "local preferences" idea: **on a built-in only `need_custom_text` stays editable**, because it is the only one of the five flags persisted in `_default_prompts_properties` (see [02-prompts.md](02-prompts.md)). The other four render as `.is_fixed` rows with the `customPrompts_flag_fixed_suffix` suffix. A built-in's `need_custom_text` toggle is applied straight to the item and marks the page unsaved; there is no Save on a read-only prompt.
- **Header buttons**:

  | Prompt | Buttons |
  |---|---|
  | Personal | Duplicate · Delete · Save (plus Cancel while dirty) |
  | Built-in / org / shadowed / inert | Duplicate and edit |

  Duplicate, Duplicate and edit, and Export are disabled whenever the management policy is on (see [08a-managed-prompts.md](08a-managed-prompts.md#_disable_prompt_management)).
- **Save** (`commitDetail()`) validates the fields and applies them to the List.js item with `item.values()`, then calls `savePrompts()`. Validation: the id is non-empty, has no whitespace and is unique among the other prompts; name and text are required; the name cannot contain `%` (`customPrompts_error_name_percent`: the name travels in the chat window's url as `prompt_name`, see [01-architecture.md](01-architecture.md#component-structure)); errors show in `#detail_error` and as `.input_error` borders. Flags are written as numbers `1`/`0`, which `normalizePromptFlags()` collapses on the next read.
- **New prompt** (`startNewPrompt()`) puts the pane in `'new'` mode, with empty fields and the global API defaults. Save creates the item with the same shape as before (`position_*Max + 1`, next `idnum`, `is_default: 0`, `show_in: 'popup'`), after clearing the search so the new row is visible, and selects it. Cancel returns to the previous selection.
- **Duplicate / Duplicate and edit** (`duplicatePrompt()`) seed `'new'` mode from a copy. The id becomes `id_<copy_text>`, made unique among the listed prompts with `_2`, `_3`, … like the ID derived from a name (`uniquePromptId()`), so a second copy of the same prompt is not refused by Save; the name becomes `<resolved name> (<copy_text>)`, API values included. Ownership and policy markers (`is_default`, `is_org`, `_shadowed_by_org`, …) are stripped from the seed.
- **Delete** confirms (`customPrompts_btnDelete_confirmText`), removes the item and selects the next visible one.
- **Export** (row menu) runs `exportPrompts([values])`, the same function as Export All, so a single-prompt file has the full format and re-imports like any backup.
- **Dirty guard**: `detailDirty` is set by any user input in the pane, ignoring programmatic fills (`detailLoading`). Before the pane is repointed — selecting another prompt, Edit/Open from the table, New, Duplicate, Import — `confirmLeaveDetail()` shows `showChoiceDialog()` with Cancel / Discard / Apply. Apply runs `commitDetail()`, and a failed validation keeps the user in place. `beforeunload` also warns while `detailDirty` is set.
- **Saving** is immediate. Every mutation of the list — Save in the pane, Delete, a built-in's `need_custom_text` toggle, Import — ends with `savePrompts()`, which chains `writePrompts()` on `saveQueue` so writes never interleave and the last one holds the latest list (each snapshots `promptsList.items` when its turn comes). `writePrompts()` splits the items (`is_default`/`is_org` → `setDefaultPromptsProperties()`, the rest → `setCustomPrompts()`), sends `reload_menus`, and reports in `#msgDisplay`: `customPrompts_start_saving`, then `customPrompts_saved` (cleared after 5 s) or `customPrompts_save_error` in red. `saveUnconfirmed` is set while a write is in flight and stays set after a failure, and `beforeunload` warns on it too. Import asks first (its confirmation includes `customPrompts_import_saved_now`), since it replaces the stored prompts with no way back; on success it shows `customPrompts_import_completed_saved`.
- The table view's Edit button and the view switch do not discard pending edits: Edit goes through the dirty guard, and the switch keeps the pane's state intact.

**Prompt text highlighting.**
- **Edit mode**: the detail textarea is a `.autocomplete-container.editor-wrap` with a backdrop mirror (`attachEditorHighlight()`, `js/mzta-editor-highlight.js`), attached **once** after `activePlaceholders` has loaded. Its token resolver and `textareaAutocomplete()` both read the prompt type through a getter on `#detail_type`, and a `change` on that select calls the handle's `refresh()`.
  - **Programmatic writes must go through `setEditorValue()`**: the mirror only repaints on `input`, which a `.value =` write does not fire.
  - Type is written **before** text in `fillDetail()`, because validity depends on it.
  - Metrics are the `--ed-*` properties on `.editor-wrap` (14px padding, `var(--font-mono)`, 1.65), and the structure is the shared `pages/_lib/editor-highlight.css`. Never set a metric on only one of textarea/mirror. `.editor-active` gates the mirror, as on the other pages.
- **Preview in the list**: `renderPreviewText()` wraps `{%…%}` tokens in `.ph_chip`, with the same two invalid tiers as edit mode: red `.ph_chip_invalid_read.ph_chip_error_read` + `editor_placeholder_missing` for an unknown id, amber `.ph_chip_invalid_read` with `classifyPlaceholderType()`'s title for a wrong-type id. It uses the **same** `PLACEHOLDER_RE` and `placeholdersUtils.findPlaceholder()` as the editor and the runtime. Before `activePlaceholders` has loaded it emits plain chips (classifying against an empty list would flag everything), and `refreshAllRows()` repaints afterwards.

### Manage Data Placeholders Page (`pages/customdataplaceholders/`)

The custom data placeholder CRUD screen — a List.js table with a hidden `#formNew` add-form, Import/Export/Save All and placeholder autocomplete. It is the structural sibling of the *previous* Manage Custom Prompts page, which has since moved to the list + detail design "2a". Data model and storage (`browser.storage.local`, key `_custom_placeholder`) are documented in `claude-spec/03-placeholders.md`.

**It keeps the visual design "1b"** that the custom prompts page used before its "2a" redesign, with its own copy of the tokens in `mzta-custom-dataplaceholders.css` (the two pages deliberately keep private token blocks; neither uses `pages/_lib/mzta-design.css`):

- Same `:root` token block + `@media (prefers-color-scheme: dark)` override, `.page_wrap` centered column, eyebrow + `.page_title` header, and `#import_export` flex-column stack.
- Same card pattern on **`#all_custom_dataplaceholders`**: sticky `#command_palette` toolbar as the first child (rounded top corners), `thead` sticking at `top: 54px`, and a `#list_footer` with `#ph_count` (i18n key `customDataPH_placeholdersCount`, `$COUNT$` placeholder) rounding the bottom corners. No `overflow:hidden` on the card — it would break the sticky toolbar/header.
- Same button system: accent `#btnNew`/`#btnAddNew`, quiet-until-dirty `#btnSaveAll`, and full-width icon+label row buttons in a `td.actions_cell` (`.btnEditItem`/`.btnConfirmItem` tinted, `.btnCancelItem` neutral outline, `.btnDeleteItem` danger outline). Because those buttons are flex containers, the JS shows Confirm/Cancel with `display = 'flex'` and restores Edit/Delete with `display = ''` (**not** `'inline'`), and `pointer-events:none` on button children keeps the `e.target.parentNode.parentNode` row lookup working.
- `{%placeholder%}` tokens are highlighted in **both** modes, exactly as on the prompts page. Read mode: `decoratePlaceholderText()` chips the `.text_show` spans, using the shared `PLACEHOLDER_RE` and a `data-phDecorated` guard that holds the decorated HTML (so it self-invalidates when the span is rewritten), re-run on the List.js `updated` event. Unlike the prompts page, `handleConfirmClick` here already updated the row in place instead of going through `List.values()`, and re-ran the decoration explicitly. `sanitizeHtml()` strips the chip markup on the cancel-restore path, so stored text stays clean. Edit mode: the backdrop mirror from `pages/_lib/editor-highlight.css`, with this page's `--ed-*` values (7px 10px, `var(--font-mono)`, 1.55) and the same `.editor-active` gating; `showItemRowEditor()` sets the textarea to `display:block` and attaches, `hideItemRowEditor()` destroys both the mirror and the autocomplete instance. `--warn-*` tokens were added to both theme blocks for invalid tokens.
- The `thunderai_custom_` ID prefix (`<i>` before the ID, in both the row and the add-form) is styled like `.id_show` (monospace, muted, non-italic).
- The **`enabled` checkbox** renders as the same **toggle switch** as the prompt properties (`appearance:none` track + `::after` knob, `--accent` when on) — **CSS only**, the `.enabled input_mod` classes and `handleInputChange` are unchanged. Unlike the prompts page there is **no read-only status-icon variant**: this checkbox is never disabled by the row editor, so it stays clickable straight from the row (no Edit/OK round-trip) and only the interactive switch look exists. Default rows (`is_default == 1`) keep the switch look but are dimmed and inert via `:disabled`. A row added in the session gets its switch's `change` handler too, so unticking it marks the page unsaved like a loaded row.

**What Save All stores.** `saveAll()` still calls `reIndex()` to pick up the rows edited in place, but builds what it stores with `itemToSave(item)`, a **new** object read from the row: the id, name and text as plain text (the text from `getTextShowSource()`), the type from the hidden `.type` span, and `enabled` from the switch's live `checked` state. Two List.js behaviours make this necessary: `reIndex()` reads every class value with `innerHTML`, which for the decorated `.text_show` span returns the chip markup (and `&` as `&amp;`), and it reads `enabled` from the `checked_val` attribute, which ticking the switch never changes. It is a copy because `setCustomPlaceholders()` writes the `thunderai_custom_` prefix into what it is given: handed `item.values()` itself, the list would hold prefixed ids after a save, and Delete (which matches the unprefixed id the row shows) and the add-form's "already used" check would stop matching until the page was reloaded. The pending state is cleared (`setNothingChanged()`) only once the write has landed: a failed `setCustomPlaceholders()` shows `customDataPH_save_error` and the error in red, enables `#btnSaveAll` again and keeps `somethingChanged`, so `beforeunload` still warns.

**The add-form.** `#btnNew` shows `#formNew` (`display = 'block'`) and is disabled while the form is open. `checkFields()` runs on every `input` of the form and enables `#btnAddNew` only when the id is non-empty, has no whitespace and is not the id of a listed row, and the name and the text are not blank; each field gets a red border when it fails and a green one when it passes. The "already used" test compares the id **as typed** with the listed ids (which are lowercase), so `Sig` passes next to `sig`; Add then stores the id lowercased and trimmed, with `enabled: 1` and `is_default: 0`, appends the row, hides and empties the form and marks the page unsaved. Save All also hides and empties the form (`clearFields()`), discarding a placeholder being typed.

**Import and Export.** Import asks first (`confirm()`), replaces the list with `prepareCustomDataPHsForImport()` (the stored placeholders merged with the file's, see [03-placeholders.md](03-placeholders.md)) and marks the page unsaved, with `importCustomDataPH_import_completed` in orange: unlike the Custom Prompts page, nothing is written until Save All. Export All writes what is **stored** (`getCustomPlaceholders()`), not the list on screen, so a pending edit is not in the file; the file is `{id: 'thunderai-custom-data-placeholders', addon_version, customdataplaceholders}`.

**The values in the row markup.** No value is ever parsed as markup, as on the Custom Prompts page. The row template concatenates the values into markup (`value="…"` for the id and the name, the text between `<textarea>` tags) and List.js writes every class value into its cell with `innerHTML`, so `toListValues()` escapes the id, name, text, type and `is_default` (`&`, `<`, `>`, `"`, `'`) as they enter the list: at load, on Add and on Import. It also strips the `thunderai_custom_` prefix from the id and turns a legacy `<br>` into a newline. A quote, a `</textarea>`, a tag or an entity is therefore shown and edited literally, and stored back unchanged, because Save All reads the cells as text (`itemToSave()`, below). Since the list holds the values escaped, nothing compares them with the text a row shows: Delete finds its item by the row element, and the add-form's "already used" check compares with the ids the rows show. Cancel in the row editor restores the editor's fields from the row as shown, the id included, unchanged. Every row also gets a numeric `idnum` as it enters the list (a placeholder imported from a file has none, since the export drops it), and Add wires the new row's buttons and switch on the row element it just created, never by looking the row up by `idnum`: a missing number used to turn every later row's into `NaN`, so a second row added after an import found the first one's buttons, wiring them twice and leaving its own dead.

**What it deliberately does not share:** no Copy or "Menu position" row button, no ChatGPT Web / API provider panels, and no `<dialog>` — export/import confirmations still use `confirm()`/`alert()`.
**Visual design.** The page uses the shared design system (see "Shared Design System CSS" below): it is wrapped in `#mzta_card` / `#mzta_body`, settings are `.mzta_field` / `.feature_row` blocks, the two checkboxes render as `.mzta_switch` toggles, and Save/Reset buttons use `.btn_primary` / `.btn_secondary`. Because the page opens in its own full-width browser tab, its `<body>` carries the opt-in **`mzta_feature_page`** class (see "Feature-Page Shell" below), which centers all content in a capped ~760px column on the light `--desk` background and renders each `.mzta_section` as a white rounded card with per-row dividers, a 3px blue section-header accent bar, larger label/help typography, blue focus rings on inputs/selects/textareas, and the two number inputs (`summarize_max_display_length`, `summarize_max_messages`) laid out as compact right-aligned controls (label/description left) via the `.mzta_field_num` wrapper. No form field id/name/value, listener, or persistence logic changes — the page still saves options on `change` and each prompt editor keeps its own Save/Reset buttons (there is no page-level save bar). The two number fields wrap their control in `.mzta_field_num_ctrl` (the max-messages one reuses `.mzta_inline_row` for the reset button + input group). The specific-integration connection UI is injected (via `initializeSpecificIntegrationUI()`) into a `<table id="connection_ui_table">` inside `#mzta_conn_panel`. `bindConnPanelTint('summarize')` (`pages/_lib/feature-page.js`, shared by the six feature pages; it mirrors the options-page `updateConnPanelTint()`, scoped to the prefix) colours the panel to the selected provider (`tint_*` class + `#mzta_conn_pill_name`) and hides the whole panel (`display:none`) when `summarize_use_specific_integration` is off, so no empty bordered box shows; it runs on load and on `change` of `summarize_connection_type` / the checkbox. The connection-type select stays a native `<select>` (only the model selects become TomSelect), so the `change` listeners fire normally. Because `_updateVisibility()` sets an inline `display:table-row` on visible connection rows, `mzta-summarize.css` re-asserts `#connection_ui_table tr[style*="table-row"] { display:block !important; }` so those rows still render as stacked fields — no change to the shared `connection-ui.js` is needed.

**Automatic summary sender list card.** The sender allow-list lives in its own `.mzta_section` card (`#summarize_auto_senders_container`), placed **after** the settings card and **before** the prompts section. It needs to be a separate card because the first settings card deliberately has no heading, so the list could not be titled inside it; the markup mirrors the SKIP ADDRESSES section of `pages/spamfilter/mzta-spamfilter.html` — a `.mzta_prompt_title` carrying the `#auto_senders_unsaved` indicator, two `p.mzta_help` blocks (description, then a bold API-usage/cost warning, since generation is automatic), a `.feature_row` + `.mzta_switch` toggle, and a `.mzta_field` holding the `rows="7"` textarea plus a `.btn_div` with a `.btn_primary` Save button. `#summarize_auto_senders_disabled_note` closes the card and is unhidden when the card is inert. **No CSS was added**: the design system already covers every component, and `.unsaved` was already declared in `pages/summarize/mzta-summarize.css`.

**Conditional notice under the auto-summarize select.** `#summarize_auto_senders_notice` sits inside the existing `summarize_auto` `.mzta_field`, directly below the select and its help text, styled with the shared red `.warning` class and `hidden` by default. `updateAutoSendersNotice()` unhides it only when **all** of: `summarize_auto === 0`, `summarize_auto_senders` is on, and the stored list has at least one non-blank entry (`hasAddressListEntries()`); it explains that auto-summarize is off in general but still active for the listed senders. It is called on page load, on `summarize_auto` change (via `updateDisplayModeConstraint()`), on the toggle change, and after the list is saved — the select's `change` alone is not enough, since the toggle and the list can both change without it.

### Shared Design System CSS (`pages/_lib/mzta-design.css`)

The design-system tokens and reusable components ("variant 2a") live in `pages/_lib/mzta-design.css`, linked by both `options/mzta-options.html` and `pages/summarize/mzta-summarize.html` (**before** each page's own stylesheet, so the page CSS can still override). It defines: the `:root` token block + dark-mode overrides (`--panel`, `--text`, `--dim`, `--line`, `--field`, `--fieldLine`, `--accent`, stats/warn tints), the card shell (`#mzta_card`, `#mzta_body`), header block, `.mzta_section` / `.mzta_eyebrow` / `.mzta_field` / `.mzta_help`, `#mzta_card`-scoped input/select/textarea/button styles (`.btn_primary`, `.btn_secondary`, `.btn_small`), the connection panel + injected-table restyle (`#mzta_conn_panel`, `#connection_ui_table`/`#connection_ui_adv_table`, `#mzta_conn_adv_btn`, `.conn_test_*`, and the provider setup note `#miczDescription` + `#mzta_info_guide` that closes the panel), the `.mzta_switch` toggle and `.feature_row`, the advanced-options disclosure (`#mzta_adv_toggle`/`#mzta_adv_panel`), the options-page bottom block (`#mzta_info_row` stacking `#mzta_disclaimer` above `#mzta_shortcut_strip`, `#mzta_footer` — see "Options Page Bottom Block" below), `.warning`, and the per-provider `tint_*` custom-property blocks (plus the legacy `tr.conntype_*` row-shading colours that `getConnectionTypeColor()` reads). `options/mzta-options.css` now holds only options-specific rules (`#btn_custom_prompts`, `#btnMenuOrder`, footer link ids, `#owl_warning`/`#hyprland_warning`, `#no_sparks`). Adding the design system to another feature page means: link this file first, wrap the page in `#mzta_card`/`#mzta_body`, and use the component classes.

#### Feature-Page Shell (opt-in `body.mzta_feature_page`)

Feature settings pages open in their own full-width browser tab, where stretching controls edge-to-edge hurts readability. Adding `class="mzta_feature_page"` to a page's `<body>` opts into a **shell** whose rules all live at the end of `pages/_lib/mzta-design.css`, every one scoped under `body.mzta_feature_page`. The **main options page does not carry this class**, so it is intentionally excluded and keeps its full-width layout — the shell is reusable across feature pages without touching the options page.

All six special-prompt feature pages now adopt the shell: `pages/summarize/`, `pages/addtags/`, `pages/spamfilter/`, `pages/translate/`, `pages/get-calendar-event/`, and `pages/get-task/`. Each links `../_lib/mzta-design.css` **first**, wraps its content in `#mzta_card` / `#mzta_top_links` (icon + `.mzta_page_title` + `.mzta_page_subtitle`) / `#mzta_body`, renders every settings group as a `.mzta_section` card headed by **`.mzta_prompt_title`** (see the typography note below) — every card title on these pages uses that one class, so "Current prompt text", "Exclusions list", "Accounts", "Skip addresses" and "Spam report" are all the same size. The only remaining `.mzta_eyebrow` on a feature page is the `<span>` inside `#mzta_conn_panel_header` (the "Connection settings" label next to the provider pill), which is a sub-header *inside* the connection panel rather than a section-card title and deliberately keeps the smaller 12px look. The **first (settings) card has no heading at all**. That first card's former `*_prompt_prefs_title` eyebrow ("Summarization Options", "Add Tags Options", …) was removed from all six pages: the page title already names the feature, so the heading was redundant, and at 12px it sat visually below the 15px `.mzta_prompt_title` further down the page. The six now-unused keys (`Summarize_prompt_prefs_title`, `AddTags_prompt_prefs_title`, `SpamFilter_prompt_prefs_title`, `Translate_prompt_prefs_title`, `get_calendar_event_prompt_prefs_title`, `get_task_prompt_prefs_title`) were deleted from `_locales/en/messages.json`; the other locale files are Weblate-managed and drop them on the next sync. Each page uses `.feature_row` + `.mzta_switch` toggles for checkboxes, `.mzta_field` (or `.mzta_field_num` for number inputs) for other controls, and `.btn_secondary`/`.btn_primary` for the per-editor Reset/Save buttons. The specific-integration connection UI is wrapped in `#mzta_conn_panel` / `<table id="connection_ui_table">` (preserving the `connection_ui_anchor` / `connection_ui_end` IDs required by `connection-ui.js`), and each page's JS calls the shared, prefix-scoped `bindConnPanelTint(prefix)` (`pages/_lib/feature-page.js`) that tints the panel to the selected provider, sets `#mzta_conn_pill_name`, and hides the whole panel when the page's `<prefix>_use_specific_integration` checkbox is off. Each page's own CSS was slimmed to page-specific rules only (autocomplete dropdown, button row, one `#connection_ui_table tr[style*="table-row"]` override, plus genuinely unique bits such as spamfilter's `#report_data` grid / `#spamfilter_threshold_too_low`, addtags's account-selector and use-list styling). No element `id`/`name`/`.option-input` class changed, so all save-on-`change` and prompt persistence logic is intact.

**addtags auto-toggle change.** In the old table layout, `mzta-add-tags.js` revealed the auto-tagging sub-rows (`add_tags_auto_only_inbox_tr`, `add_tags_auto_include_sent_tr`, `add_tags_auto_uselist_tr`) with `style.display = 'table-row'`. Those rows are now `.feature_row` flex blocks inside a card, and they are hidden by default through an **ID-based rule in `mzta-add-tags.css`** (`display: none`) so nothing flashes before the JS runs, then toggled on when `add_tags_auto` is checked.

Revealing them must use an **explicit** display value, never `style.display = ''`. Assigning `''` only *removes* the inline declaration, so the element falls back to the stylesheet — which is the very `display: none` rule that hides it, leaving the row permanently invisible. All reveals go through a single `toggleAutoSubRows(visible)` helper (used both by the `click` listener and for the initial state) that assigns the display each element's layout actually needs: `'flex'` for the `.feature_row` rows and for the `.mzta_field` allow-list wrapper (a column flexbox — `'block'` would collapse its `flex-direction: column` layout), `'block'` for the `.mzta_section` `account_selector_container` card, and `'inline'` for the infoline.

**Adding another sub-row** therefore means touching three places in step: the `.feature_row` markup in the HTML, the ID in the CSS hide-rule, and a line in `toggleAutoSubRows()`. Omitting the CSS ID makes the row flash (and appear even when auto-tagging is off); omitting the helper line leaves it hidden forever.

The shell provides: a light `--desk` page background; a centered, `max-width: 760px` column (`#mzta_card` with `margin: 0 auto` + 24px side padding — below the cap it is naturally full-width-minus-padding, no media query needed); each `.mzta_section` rendered as a white rounded **card** (`--panel`, 12px radius, 24px padding, subtle shadow, 24px vertical gap); section headers (`.mzta_section > .mzta_eyebrow`) get a **3px vertical `--accent` bar**; stacked settings inside a card are separated by thin `--line` **row dividers** (the first row after the header/intro has none — and, since the settings card is headerless, a `.mzta_field:first-child` / `.feature_row:first-child` pair covers the case where the row itself opens the card, so no stray divider appears above it); up-sized **typography** (`.opt_title` 15px/600, `.opt_title_small` 13.5px/normal, help/`.feature_desc` 13.5px with `text-wrap: pretty`) — **including the injected connection rows**, so descriptions inside `#mzta_conn_panel` no longer render larger than the ones outside it (see "Connection Panel Typography on Feature Pages" below); a **`.mzta_prompt_title`** class used for **every section-card heading** on the feature pages — same accent-bar treatment as `.mzta_eyebrow` but sized like `.opt_title` (15px/600 instead of 12px/700), since a heading smaller than the labels beneath it read as less important; it is a standalone class (not combined with `.mzta_eyebrow`) and is included in the `+ .mzta_help` / `+ .mzta_field` / `+ .feature_row` sibling selectors so the intro pull-up and first-row no-divider rules still apply. `.mzta_eyebrow` itself is now used on these pages only for the connection-panel sub-header; a header block with a 25px page title, one-line subtitle, and a small app-icon tile (`.mzta_page_icon` / `.mzta_page_title` / `.mzta_page_subtitle`); **compact number fields** via `.mzta_field_num` (label/description left, ~96px centered input — or reset+input group — right); and **focus rings** (`--accent` border + a 3px `color-mix` accent glow, white background) on inputs/selects/textareas — the only focus styling in the design system, deliberately scoped so the options page is unaffected. All rules reuse existing tokens, so dark mode is inherited. It adds no save bar: pages persist on `change` and keep their per-editor Save/Reset buttons. A new feature page adopts the look by adding the class, giving the header the `.mzta_page_*` markup, and putting its settings in `.mzta_section` cards (number fields in `.mzta_field_num`).

**Wide sections (`.mzta_section_wide`).** The 760px column suits forms but not genuinely wide content, so a single card can opt out of it by carrying `.mzta_section_wide` alongside `.mzta_section`; every other card on the page keeps the column. The rule (end of the shell block, scoped to `body.mzta_feature_page`) widens the card with **symmetric negative side margins** computed from three local custom properties — `--mzta_wide_cap` (760px, restated because a custom property cannot read another rule's used values), `--mzta_wide_pad` (24px) and `--mzta_wide_max` (1600px) — as `max(0px, min((100vw - 2*pad - cap)/2, (max - cap)/2))`. The `max(0px, …)` floor is what makes it degrade: on a window narrower than the column the bleed resolves to zero and the card renders exactly like every other one, so no media query is needed and the page never gains a horizontal scrollbar. It deliberately avoids the usual `margin-left: 50%` + `transform: translateX(-50%)` idiom, because a transform establishes a containing block for positioned descendants and would trap the autocomplete dropdown that `#mzta_card`'s `overflow: visible` exists to let escape. **Only the spam report card (`#spamfilter_reports_container`) opts in** — its eight-column table was unreadable at ~664px of card content width [<a href="https://github.com/micz/ThunderAI/issues/895">#895</a>]. Adding the class to another card is the whole opt-in; nothing else changes.

#### Connection Panel Typography on Feature Pages

The injected connection rows used to render at three different text sizes, none of which matched the
rest of the feature page. `connection-ui.js` emits most field description text as a **bare text node**
inside `<label>` (after a `<br>`), not wrapped in `.small_info`/`<i>`, so the
`body.mzta_feature_page .mzta_help` rule never reached it and it fell back to the browser default
(~16px) — visibly *larger* than the 13.5px descriptions outside the panel. The descriptions that *are*
wrapped rendered at 11.5px, and `#connection_ui_table .opt_title` (1-1-0) beat
`body.mzta_feature_page .opt_title` (0-2-1), shrinking panel labels to 12px/700 against 15px/600 outside.

The shell therefore re-asserts the feature-page scale inside the panel, in the `body.mzta_feature_page`
block at the end of `pages/_lib/mzta-design.css`:

- `#connection_ui_table tr:not([id$="_cors_warning"]) td` / same for `#connection_ui_adv_table` — 13.5px,
  `line-height: 1.5`, `color: var(--dim)`, `text-wrap: pretty`. Setting this on the **cell** is what lets
  the un-wrapped text nodes inherit the right scale.
- `.opt_title` inside both tables — back to 15px/600, `color: var(--text)`, matching labels outside the panel.
- `.small_info` / `<i>` inside both tables — 13.5px, so wrapped and un-wrapped descriptions agree.

Two constraints the selectors encode:

- **The CORS-warning rows are excluded.** Their amber note styling (`#connection_ui_table tr[id$="_cors_warning"] td`)
  is only 1-1-1, so a `body.…` two-ID selector would override its `color: var(--warning)` with the muted
  description colour. This mirrors the identical exclusion in the setup wizard.
- **Form controls are unaffected** — the shared sheet sizes inputs/selects/textarea directly and TomSelect
  sizes `.ts-control` directly, so neither inherits from the cell.

Scoped to `body.mzta_feature_page`, so the **options page and the setup wizard are untouched** (the wizard
keeps its own one-step-down 11.5px override in `mzta-setup-wizard.css`, deliberately smaller to suit its
432px card). `connection-ui.css` loads *after* `mzta-design.css` and sets `span.opt_title{font-weight:bold}`,
which wins on weight for panel labels — but it does so equally for the labels outside the panel, so the two
still match. If `connection-ui.js` is ever changed to wrap its description text properly, the `td` rule here
(and the wizard's) can be dropped.

### Menu Order Page (`pages/menu_order/`)

Entry point from the options page via the "Menu Order" button (next to "Manage your prompts"). Provides drag-and-drop reordering and toggle-based visibility control for both the popup and the context menu. See `claude-spec/02-prompts.md` ("Menu Order Page") for the full behaviour, data flow, and exclusion rules.

### Translate Settings Page (`pages/translate/`)

The translate settings page provides:

1. **Specific integration checkbox** — enables per-feature API override (like other special prompts)
2. **Auto-translate dropdown** (`translate_auto`) — three modes:
   - `0` (Disabled) — no inline translations
   - `1` (Manual) — shows a "Get AI Translation" button in message display
   - `2` (Automatic) — generates translation immediately when message is opened
3. **Max display length** (`translate_max_display_length`) — number input, limits inline translation text to N characters. `0` = no limit. When truncated, a "See more"/"See less" toggle link is appended.
4. **Target language** (`translate_lang`) — text input for the destination language. If empty, falls back to `default_chatgpt_lang`.
5. **Exclude languages** (`translate_exclude_lang`) — text input, stored trimmed: the languages the prompt asks the AI to skip (see its row in "Feature Flags").
6. **One editable prompt** — the translation instruction prompt (`prompt_translate_this`) with Save/Reset buttons and placeholder autocomplete. Default text comes from i18n string `prompt_translate_this_full_text`.

Like the other feature pages, this page uses the shared design system + feature-page shell (see "Feature-Page Shell" above): two `.mzta_section` cards (settings + prompt), `.mzta_switch` toggle, `#mzta_conn_panel` connection UI tinted by `bindConnPanelTint()`, and `.mzta_field_num` for the max-display-length number input.

### Connection Settings Panel — Advanced Options Disclosure

The main options page (`options/mzta-options.html`) wraps the injected connection
fields in `#mzta_conn_panel`. Each provider's fields are tiered into **core** and
**advanced**:

- **Core** fields (always visible) — the minimum for a working connection: API key /
  host, model, and API version. Rendered normally.
- **Advanced** fields (hidden by default) — fine-tuning such as temperature, system
  prompt, max tokens, context window, thinking budget, JSON format, store-on-server,
  `/v1` suffix, ChatGPT Web model/project/etc.

**Field tiering.** In the shared template inside `injectConnectionUI()`
(`pages/_lib/connection-ui.js`), every advanced field row carries the marker class
`conn_adv` in addition to its `conntype_<provider>` class. Core rows carry no marker.
Every page hosting the connection UI hides the `conn_adv` rows behind an "Advanced
options" disclosure: options page and setup wizard (static markup, see below), the 6
feature pages (built at runtime, see **Feature pages** below) and custom prompts.
The **custom prompts page renders one**, in its single detail editor (`.conn_adv_btn` +
`.conn_adv_table` inside `#detail_api_panel`). The button carries the same markup as the
options page one (gear + label, `.chev` chevron) and is restyled in `mzta-custom-prompts.css`
with that page's own tokens (`--accent`, `--border2`), since the page does not link
`mzta-design.css`. The same file also neutralises the saturated legacy `tr.conntype_*` row
shading from `connection-ui.css`. Rows go transparent with thin separators, and the whole
panel (`.api_panel`) takes the soft options-page provider tint. That tint is selected with
`:has(tr[id$="_tr"].conntype_<provider>)`, because the connection-type row is the only one
whose class follows the select. Those rules also set `--tint-border` / `--tint-accent`, which
the `.conn_adv_btn` uses for its border and text, as on the options page. With no provider
selected it falls back to `--border2` / `--accent`.
Its relocation helper `relocateConnAdvRows(scopeEl)` and
`showAdvConnectionOptions(scopeEl, connType)` stay **scoped** to that panel rather than
using the options page's document-wide `querySelectorAll('#connection_ui_table tr.conn_adv')`,
and the disclosure is one delegated `click` listener at module scope. Rows that left
the main table are no longer reachable from `showConnectionOptions()` (which walks up
from the select), hence the separate per-provider sync.
Note that the ChatGPT Web `conn_adv` rows are not merely inert on those pages — they
are **not injected at all**, because they pass `no_chatgpt_web: true` (see
[04-api-integrations.md](04-api-integrations.md), ChatGPT Web section, for why those
rows must keep unprefixed ids and therefore exist only once per page).

**Toggle inside the shared template.** The `chatgpt_web_tempchat` row renders its
checkbox as the design-system `.mzta_switch` toggle (the only checkbox in the shared
template; every other injected checkbox is still a plain one). The switch label is
wrapped in a flex `<div>` shared with the info text, not left inline: the
connection-table restyle sets `label { display: block }` on every label inside
`#connection_ui_table` / `#connection_ui_adv_table`, and that selector (1 id + 1 type)
outranks `.mzta_switch`'s own `display: inline-flex` (1 class). Inside the flex wrapper
the label is a flex item — `block` is what a flex item gets anyway — and
`.mzta_switch`'s `width: auto !important` keeps it at the 38px track width, so only
the switch is clickable. Without the wrapper the block label would stretch across the
whole cell and toggle from a click anywhere in the row. Both pages that ever show the
row (options + setup wizard) link `mzta-design.css`, so the toggle styles are always
present.

**Prefix propagation invariant.** `showConnectionOptions(conntype_select, modelId_prefix)`
ends by calling `updateCORSWarnings(modelId_prefix)`, and `modelId_prefix` defaults to
`''`. Every call site on a prefixed page must therefore pass the prefix explicitly —
omitting it does not fail loudly, it silently targets the *unprefixed* elements (on the
custom prompts page's old per-row editors that meant a row's provider change toggling the
add-form's CORS warning and mutating the shared `varConnectionUI.permission_*` state from
the wrong form's host values). The two calls inside `injectConnectionUI()` pass their own
`modelId_prefix`. The custom prompts page now injects exactly once, with `detail_prompt_`,
and every call there passes that prefix; a page that injects more than once must give each
injection a distinct prefix so no two forms ever share an element id.

**JSON field validation on restore.** The `*_extra_body` textareas carry `.check-json`
and are validated live by an `input` listener. Restoring a saved value assigns
`.value`, which fires **no** input event, so a previously saved malformed JSON would
show no red border or error message until the user touched the field. Every code path
that writes values into a connection form must therefore validate afterwards. On the
options page and the wizard `checkJsonFields()` (document-wide) is correct because
they host a single form; pages hosting several forms at once must use
`checkJsonFieldsByPrefix(prefix)` instead — validating document-wide from one form
repaints, and on empty fields *clears*, the other open forms' error state. Custom
prompts calls it after all four write paths: the add-form defaults fill, `handleCopyClick`,
`populateConnectionUI`, and `resetApiSettings` (clearing needs it too, or a stale red
border survives on a now-empty, valid field).

**Per-injection binding scope.** The `.check-json` / `.check-number` `input` listeners
inside `injectConnectionUI()` are bound over the rows **that call injected**, not via a
document-wide `querySelectorAll`. With a document-wide query, a page injecting N times
re-binds every previously injected field on each new injection, so listener count grows
quadratically (1 add-form + 3 edited rows ⇒ 4 listeners per add-form field, each
keystroke running the validator 4×). All `.check-json`/`.check-number` fields originate
from the injected template — none are declared in page HTML — so the narrower scope
loses no coverage.

**The toggle.** A full-width button `#mzta_conn_adv_btn` sits directly below the core
`#connection_ui_table`, inside the tinted panel. It mirrors the app-level
`#mzta_adv_toggle`: gear icon + a static **"Advanced options"** label
(`prefs_advanced_options`) on the left, chevron on the right (`justify-content:
space-between`). Its style is defined in `pages/_lib/mzta-design.css` (keeps the
per-provider `--tint-border` / `--tint-accent`, falling back to `--fieldLine` /
`--accent`); its chevron rotates 180° when expanded via the `[aria-expanded="true"]`
attribute.

**Show/hide mechanism.** The advanced rows are **moved at runtime** (on the options page
right after `injectConnectionUI()` in `options/mzta-options.js`; the wizard and feature pages
do the same, see their sections) out of
`#connection_ui_table` and into a second table `#connection_ui_adv_table` that sits
**below** the button. Because that table follows the button in the DOM, expanding it
opens the advanced fields *below* the button (the button stays fixed) — exactly like the
app-level disclosure. Collapsing is CSS-driven: `#connection_ui_adv_table.hidden {
display: none; }`. Both tables share the same field-restyle CSS (the selectors list
`#connection_ui_table` and `#connection_ui_adv_table` together).

Per-provider visibility of the advanced rows is handled by an **options-page-only**
helper `showAdvConnectionOptions()` (`options/mzta-options.js`). This is required because
`showConnectionOptions()` (`connection-ui.js`) scopes its `conntype_*` toggling to the
core table's tbody only (`select → label → td → tr → tbody`), so it does **not** reach
rows moved into `#connection_ui_adv_table`. `showAdvConnectionOptions()` hides every
`conntype_*` row in the advanced table and shows only the selected provider's; it is
called at init (after `restoreOptions()` + `showConnectionOptions()`) and on every
`connection_type` `change`. The shared `connection-ui.js` is intentionally left unchanged
— widening its scope would break any page that hosts more than one connection block
(and the feature pages' own panels).

**JS wiring** (`options/mzta-options.js`): `resetConnAdv()` sets `aria-expanded="false"`
and adds `.hidden` to `#connection_ui_adv_table`. It is called once after injection
(start collapsed) and on every `connection_type` `change` event (reset to collapsed on
provider switch). The button's `click` handler flips `aria-expanded` and toggles
`.hidden` on the advanced table; the label is static (no swap). State is **purely local
UI** — no preference is persisted, so reopening the options page always starts collapsed.
The connection-test "back to idle" `input`/`change` listeners are bound to **both** tables
so editing an advanced field also invalidates a prior test result.

**Feature pages.** The 6 feature pages (addtags, spamfilter, summarize, translate,
get-calendar-event, get-task) carry no disclosure markup. `initializeSpecificIntegrationUI()`
(`pages/_lib/connection-ui.js`) calls `setupFeatureConnAdv()` right after
`injectConnectionUI()`. That helper builds `#mzta_conn_adv_btn` (same gear/chevron SVGs,
parsed with `DOMParser`, label from `prefs_advanced_options`) and `#connection_ui_adv_table`
right after `#connection_ui_table`, reusing them if the page already has them. It then moves the
`tr.conn_adv` rows there; a document-wide query is safe because a feature page hosts a single
form. No separate per-provider sync is needed: the moved rows keep `.specific_integration_sub`
+ `conntype_*`, so `_updateVisibility()` (document-wide) still shows/hides them. The same holds
for the document-wide `.specific_integration_sub .option-input` save listeners. `_updateVisibility()`
also shows the button only when the specific integration is on **and** a provider is selected;
otherwise it hides and collapses it. The disclosure collapses on every connection type change.
Because `_updateVisibility()` sets an inline `display:table-row`, `mzta-design.css` re-asserts
`display:block !important` on `body.mzta_feature_page #connection_ui_adv_table tr[style*="table-row"]`,
the same override each feature page CSS applies to `#connection_ui_table`.
`setupFeatureConnAdv()` also builds the connection test strip right after
`#connection_ui_adv_table` — see the next section.

### Connection Settings Panel — Connection Test Status Strip

Below the advanced-options button, inside `#mzta_conn_panel`, a status strip
(`#mzta_conn_test`, class `conn_test_strip`) offers a lightweight, **non-persistent**
connectivity check for the selected provider. It is static markup in
`options/mzta-options.html` and in the setup wizard. The other hosts build it at runtime with
`attachConnTestStrip({ afterEl, scopeEls, getConnType, idPrefix, id })` from
`pages/_lib/connection-ui.js`. It inserts the strip after `afterEl`, resets it to idle on any
`input`/`change` inside `scopeEls`, and makes its link call `runConnectionTest(type, idPrefix)`
(and, after an Ollama success, `updateOllamaModelCapabilityUI(idPrefix)`).
`setConnTestStripVisible(strip, connType, visible)` shows it only for a testable type and
resets it to idle.
- **Feature pages:** `setupFeatureConnAdv()` builds one strip with id `#mzta_conn_test` right
  after `#connection_ui_adv_table`, scoped to both tables.
- **Custom Prompts:** one strip **per form** (add form and each row in edit mode), without an
  id, after that form's `.conn_adv_table` and scoped to that form only, so editors that are
  open at the same time never share a result. `attachFormConnTest()` builds it right after
  `relocateConnAdvRows()`, and `showAdvConnectionOptions()` toggles it with the provider. It
  stays hidden while the prompt inherits the global connection (empty `api_type`). The page
  does not link `mzta-design.css`, so `mzta-custom-prompts.css` restates the strip styles
  with that page's tokens (`--panel2`, `--border2`, `--ok-text`, `--err-text`,
  `--tint-accent`), plus its own `conn_test_spin` keyframe.

**Visibility.** Shown only for connection types with a testable endpoint — every type
except `chatgpt_web` (which has no API endpoint). `refreshConnTestVisibility()` toggles
`display` on load and on every `connection_type` change.

**States** (driven by `data-state` on the `.conn_test_strip`, styled in
`pages/_lib/mzta-design.css`): `idle` (grey dot, "Connection not tested yet", link "Test
now"), `loading` (dot becomes a spinner via the `mztaspin` keyframe, "Testing
connection…", link hidden), `ok` (green dot, "Connected — <API> reachable", link
"Re-test"), `error` (red dot + red text with the error detail, link "Retry").
`setConnTestState(state, message, strip)`, exported by `js/mzta-connection-test.js` and
shared by every host, updates dot/text/link of `strip` (found via `.conn_test_text` /
`.conn_test_link`; it defaults to `#mzta_conn_test`); i18n keys are `connTest_*` in
`_locales/en/messages.json`.

**Feature pages.** `_updateVisibility()` in `initializeSpecificIntegrationUI()` shows the strip
only when the specific integration is on **and** the selected type is testable (an empty
"inherit" value is not), through `setConnTestStripVisible()`. When the specific
integration is off there is nothing to test here: the global connection is tested on the
options page.

**Reset to idle** happens on `connection_type` change and on any `input`/`change` inside
`#connection_ui_table` (editing key/host/model/version invalidates a prior result).

**Test logic** lives in `js/mzta-connection-test.js` (shared helper). It **reuses the
provider classes' existing methods** (the same calls the "Fetch models" buttons use)
— no URL/header/auth logic is duplicated. `getTestableConnection(connType)` returns a
registry entry (`makeClient` reading current form fields, `nameKey`, `requestPermission`
— both callbacks receive the field-id prefix, `''` on the options page and in the wizard,
`<feature>_` on the feature pages —
plus the two optional fields below); `runConnectionTest(connType, idPrefix = '')` requests the needed host
permission (mirroring the fetch-models / CORS buttons), calls the probe with a ~10s
`Abort`-style timeout (`Promise.race`), and maps the `{ok, error, is_exception}` result to
auth / network / timeout messages. It reads current (possibly unsaved) form values and
**saves nothing**.

One optional registry field keeps a provider quirk out of the shared runner:

- **`testMethod`** names the probe, defaulting to `'fetchModels'`. Every such method shares
  the same `{ok, error, is_exception}` contract. **Ollama sets it to `'fetchVersion'`**
  (`GET /api/version`) because `/api/tags` conflates *"server unreachable / CORS not
  configured"* with *"reachable but no models pulled"* — it answers with an empty list in
  the second case and not at all in the first. `/api/version` answers whatever is installed,
  so a success means exactly "reachable and speaking Ollama". `fetchModels()` still uses
  `/api/tags`: it is what populates the model dropdown.

A successful Ollama test also re-runs `updateOllamaModelCapabilityUI()`, because granting the
host permission through the test is often what makes `/api/show` reachable in the first place
— see [04-api-integrations.md](04-api-integrations.md#ollama-ollama_api).

### Connection Settings Panel — "Update list" Model Fetch Buttons

Each API provider's model row in `injectConnectionUI()` (`.models_fetch_row`) holds the model
select, the `btnUpdate<Provider>Models` button (refresh icon `MODELS_REFRESH_SVG` + text in a
`<span>`) and a `<provider>_model_fetch_loading` span (class `.models_fetch_loading`); below the
row sits a `<provider>_model_fetch_status` box. All ids carry the `modelId_prefix`.

The status box (`.models_fetch_status`) is a `role="status"` / `aria-live="polite"` region, hidden
when empty. It is right-aligned text in plain inline flow (not flex: with flex the wrapped text
becomes one full-width item and the icon ends up far left), so it sits under the button and wraps
naturally. The leading `::before` is an inline-block icon drawn as a CSS mask filled with
`currentColor` (alert-circle, or check-circle with `.is_ok`), so it stays next to the first word
of the text and follows the red/green state colour.

**OpenAI Comp label row.** The label cell of the OpenAI Comp models field is a
`.models_label_row` flex row: the label on the left and, in `.models_label_actions`, two small
ghost buttons separated by a `.models_action_divider`, "+ Add manually"
(`btnOpenAICompForceModel`, `.models_action_add`, accent colour, prompts for a model name) and
"Clear list" (`btnOpenAICompClearModelsList`, `.models_action_clear`, muted, turning to the
error colour on hover, asks for a native `confirm()` first). On narrow widths the actions wrap
below the label, still right-aligned. Their colours come from the provider tint
(`--tint-accent` / `--tint-border`, set on `#mzta_conn_panel.tint_<provider>` or by the Custom
Prompts page) with the base tokens of either design system as fallback; the base rules are in
`connection-ui.css`, and `mzta-design.css` undoes the bordered `#connection_ui_table button`
style for them.

The click handlers drive the row through `modelsFetchUI(modelId_prefix, btnId, provider)`:

- **loading** — the button is hidden (`display:none`) and the loading label takes its place, so
  it cannot be clicked twice; any previous status message is cleared. (`setStatus()` unhides the
  box before writing its text, so the live region announces the change.) The label holds the same
  `MODELS_REFRESH_SVG` icon as the button, spinning (`models_fetch_spin`, off under
  `prefers-reduced-motion`), and is shown as `inline-flex`. Just before hiding the button, its
  `offsetWidth` and computed `font` / `letter-spacing` / `color` are copied onto the label
  (centred, not italic), so the label looks like the button text and the row does not shift.
  This is read at runtime because every host page styles its buttons differently.
- **done** (success) — the list is merged into the select, the button comes back and the status
  box shows `Models_Fetch_Done` in green (`.is_ok`). After `MODELS_FETCH_OK_VISIBLE_MS` (30 s)
  `.is_fading` fades it out (1 s opacity transition, `MODELS_FETCH_OK_FADE_MS`) and it is then
  hidden. The timers are stored on the status element, because `modelsFetchUI()` builds a new
  object per click: a new click cancels the pending fade.
- **error** — the button comes back immediately and the reason is written in red in the status
  box, with no timer: it stays until the next click. This replaces the old `alert()`s and
  covers HTTP errors, a denied optional host permission (ChatGPT, Claude), Ollama's "no
  models" and network exceptions.

The fetch goes through `fetchModelsWithTimeout(client)`, the same `Promise.race` as the
connection test. The providers go through `fetchWithRetry()`, which has its own per-attempt
timeout and retries; this call passes `{ maxRetries: 0, timeoutMs: MODELS_FETCH_TIMEOUT_MS }` on
purpose, because the user is waiting on the button, so after `MODELS_FETCH_TIMEOUT_MS` (20 s)
the row reports `connTest_error_timeout` and no retry keeps running in the background. It always resolves
to an `{ok, error|response}` result, also when `fetchModels()` throws. Every implementation,
OpenAIComp included, catches its own network errors and resolves `{ok:false, is_exception:true,
error}`, so the `catch` there is only a safety net. OpenAIComp also accepts a bare-array
`/models` answer besides `{data:[...]}`, and turns any other shape into an empty list.
`parseModelsFetchError()` extracts `error.message` from a JSON error body. The `warn_*()` helpers
still manage the button's `disabled` state, independently of its visibility.

**A missing credential disables, never clears.** While a provider's key (or host, for Ollama and
OpenAI Comp; or the Anthropic version) is empty, its `warn_*Empty()` check disables the "Update list"
button and the model select (`toggleTomSelectDisabled()`), but leaves the selected model as it is:
shown in the select and untouched in storage. So emptying a key and typing it back never loses the
model, and opening a page with an empty credential writes nothing. `toggleTomSelectDisabled()` must
never call Tom Select's `clear()` (nor set `selectedIndex = -1`): `clear()` fires a `change`, and the
page's save-on-change listener would store `''`, erasing the user's model just by opening the page.
That is what happened from the Tom Select migration (#603) until 5.1. The select gets its red
"missing model" border only once the credential is there again and no model is selected.

### Setup Wizard (`pages/setup-wizard/`)

A guided **first-run flow** that walks a new user through the minimum needed to get
working: **Choose your AI → Connect → Pick your tools → Done**. It does not replace the
informational welcome page (`pages/onboarding/`); it complements it. The defining idea is
that **each AI integration carries its own colour, applied from the very first choice** —
picking a provider on step 0 tints the connection panel, the provider pill, and the finish
badge through the rest of setup.

**Files:** `pages/setup-wizard/mzta-setup-wizard.{html,js,css}`. It is a standalone
WebExtension page (its own browser tab), not registered in `manifest.json`
(`options_ui`/`default_popup` are unchanged); it is opened via `browser.tabs.create` from
the entry points below.

**Reuse over rebuild.** The wizard is an orchestration layer over existing pieces:
- **Connection UI** — the Connect step injects the shared `injectConnectionUI()`
  (`pages/_lib/connection-ui.js`) into `<table id="connection_ui_table">` inside
  `#mzta_conn_panel`, exactly as the options page does (including moving the `.conn_adv`
  rows into `#connection_ui_adv_table` and the `#mzta_conn_adv_btn` disclosure). The
  injected `<select id="connection_type">` is **hidden** (`#connection_type_tr{display:none}`)
  — the provider is chosen through the step-0 cards — but stays in the DOM because
  `showConnectionOptions()` walks up from it.
  **Text scale caveat:** `connection-ui.js` emits most field description text as a **bare
  text node** inside `<label>` (after a `<br>`), not wrapped in `.small_info`/`<i>`, so the
  sizing rule in `mzta-design.css` never reaches it and it falls back to the browser default
  (~16px). In the wide options column this is barely noticeable; in the wizard's 432px card
  it broke the layout. The wizard therefore sets `font-size`/`color` on
  `#wiz_step_connect #connection_ui_table td` / `#connection_ui_adv_table td`, letting those
  un-wrapped nodes inherit the small-text scale. Form controls are unaffected — the shared
  sheet sizes inputs/selects/textarea directly, and TomSelect sizes `.ts-control` directly,
  so neither inherits from the cell. Scoped to `#wiz_step_connect` so the options page and
  feature pages are untouched. If `connection-ui.js` is ever changed to wrap that text
  properly, this override can be dropped.
- **Connection test strip** — the same `#mzta_conn_test` markup + `refreshConnTestVisibility()`
  / `setConnTestState()` logic as the options page, calling `isTestableConnection()` /
  `runConnectionTest()` from `js/mzta-connection-test.js`.
- **Tint system + toggles** — the per-provider `tint_*` classes / `--tint-*` tokens, the
  provider pill, and the `.mzta_switch` feature toggles all come from
  `pages/_lib/mzta-design.css` + `connection-ui.css`. The wizard CSS adds its own
  scaffold (432px card, step indicator, nav bar, provider cards, done badge),
  `.wiz_provider_card.tint_<id>` rules mirroring the existing token values, and the
  connection-row typography override described in the Connection UI bullet above. Its type
  scale is deliberately one step down from the feature pages to suit the narrow card:
  16px step title / 12px subtitle / 13px provider name / 11.5px descriptions.

**Step 0 — Choose your AI:** six provider cards built in JS from a local `PROVIDERS` array, in
this order: ChatGPT Web, OpenAI API, Google Gemini, Claude, Ollama, OpenAI Compatible
(`chatgpt_web`, `chatgpt_api`, `google_gemini_api`, `anthropic_api`, `ollama_api`,
`openai_comp_api`). The wizard's own `CONN_TYPES` is derived from it; it is not the options page's
`CONN_TYPES`, whose order differs. Names reuse `prefs_Connection_type_*`, tags use the
`wizard_provider_tag_*` keys. Selecting a card sets the hidden select's value and dispatches
`change` (so the shared UI reacts and `connection_type` persists via the same
save-on-`change` path), then re-tints panel/badge/pill and recomputes the step sequence.

**Nothing is preselected.** Because `connection_type` now defaults to empty, `state.provider`
starts empty too and **no card is marked selected**. Critically, the boot handler must **not** call
`selectProvider()` when there is no saved provider: that function dispatches a `change` on the
hidden select, which would persist a `connection_type` the user never picked — merely *opening* the
wizard would choose a provider for them. Step 0 shows only the provider cards, so no connection-UI
setup is needed until the first card click, which calls `selectProvider()` itself. While
`state.provider` is empty, **"Continue"** stays disabled and `goNext()` refuses to advance,
so a provider-less wizard can never reach the Connect step. `restoreOptions()` leaves the hidden
select unset (`selectedIndex = -1`) in this state, again persisting nothing.

The disabled state is owned by `refreshNextEnabled()`, called from **both** `renderStep()` and the
end of `selectProvider()`. The second call is what unlocks the button on the very first card click:
step 0 triggers no re-render of its own (`renderStep()` runs only from `goNext()`/`goBack()`/restart/
boot), so if only `renderStep()` set `next.disabled`, a fresh install would dead-end with the card
selected but "Continue" permanently greyed out. Keep the enabling rule in that one helper.

**Provider-dependent sequence:** `chatgpt_web` skips the "Pick your tools" step
(`[provider, connect, done]`); every other provider is `[provider, connect, tools, done]`.
Nav walks sequence *positions*, never raw indices, so skipped steps are never landed on.
"Finish setup" is the label on the second-to-last position, "Continue" otherwise.

**Navigation chrome** (`renderStep()`, run by `goNext()` / `goBack()` / "Run again" / boot):
- **Back** (`#wiz_back`) is shown on every position except the first and the done step; while it is
  hidden, `#wiz_nav` carries `.wiz_nav_back_hidden`. On the done step **"Continue"** (`#wiz_next`)
  is hidden too: the done step has no navigation of its own.
- **Step indicator** (`#wiz_steps`): one `.wiz_dot` per position of the current sequence (so three
  for ChatGPT Web, four otherwise), numbered `1`, `2`, … and `✓` on the last; the dots up to the
  current position carry `.wiz_dot_on`. Each dot is followed by a `.wiz_line`, `.wiz_line_on`
  before the current position.
  `selectProvider()` redraws it too (`renderSteps()`), so picking or changing the provider on step 0
  updates the number of dots at once instead of at the next navigation.
- **"Run again"** (`#wiz_restart`, `wizard_run_again`) on the done step returns to step 0. It resets
  nothing: the chosen provider stays selected (and "Continue" enabled), and what was stored stays.

**Connect step header.** Picking a provider also writes the Connect step's text: the heading
`#wiz_connect_heading` is `wizard_connect_heading` with the provider's name, the subtitle
`#wiz_connect_sub` is `wizard_step_connect_sub_web` for ChatGPT Web and `wizard_step_connect_sub`
for every API, and the pill `#mzta_conn_pill_name` reads the provider's name
(`prefs_Connection_type_*`).

**Step 2 — Pick your tools:** only the four API-driven features (`add_tags`, `spamfilter`,
`summarize`, `translate`) — the two Sparks features are omitted. Same toggle markup / ids as
the options page, so they persist via the shared save-on-`change`.

**Persistence:** the wizard writes the **same** storage keys as the options page
(`connection_type`, the per-provider `*` fields, and the four feature flags) via
`saveOptions`/`restoreOptions` copied from `options/mzta-options.js`. **No new preference.**
Every value is saved on its own `change`; there is no final save, so navigating ("Continue",
"Finish setup", Back, "Run again") writes nothing.

**Entry points:**
- **Onboarding banner** — a `#wizard_banner` at the top of `pages/onboarding/onboarding.html`
  with a link (`#btn_launch_wizard`) that opens the wizard. It shares its `.content` parent
  with `#onboarding_doc_panel`, which is `position: absolute` (top-right, `z-index: 100`),
  opaque, and therefore reserves no layout space. The banner is styled with a 4px `#0a84ff`
  accent edge on **both** inline sides (1px border top/bottom), so its whole box — borders
  included — must stay clear of the panel: it uses `margin-inline-end: 230px` plus
  `width: auto` + `align-self: stretch` (needed because `.content` is a centering flex column,
  where dropping `width: 100%` alone would shrink-wrap the banner) and start-aligned content.
  A mere `padding-inline-end` would clear the text but leave the right accent edge hidden
  behind the panel. An `@media (max-width: 700px)` block drops the margin and re-centers. Keep
  that margin in sync if the doc panel's width or offsets change.
  The banner is **always visible**; when no connection is selected at all, `onboarding.js` adds
  `.wizard_banner_urgent` to give it more prominence (bold + a soft blue glow — still blue, since
  nothing is broken). No permission banner can apply in that state.
  The page's red permission banner (below) is also its way to grant the permission: a click
  requests the provider's host permission (`https://*.chatgpt.com/*`, `https://*.anthropic.com/*`,
  `https://*.openai.com/*`). Granted, the banner hides and `#integration_permission_ok` shows; a
  click on that closes the welcome tab. Refused, nothing changes and the banner stays clickable.
  The doc panel's two links (`#link_doc_guides`, `#link_doc_tutorial`) point to the guides and the
  custom-prompt tutorial on micz.it, localized by `getMiczItUrl()`.
- **Options banner** — `#no_connection_banner`, with `#btn_options_setup_wizard`. It is the **first
  child of `#mzta_card`, above `#mzta_top_links`** (the documentation block), so it is the first thing
  a new user sees. Because `#mzta_card` has no padding of its own, the banner carries explicit
  `margin: 20px 22px 0` matching the header block's horizontal padding, plus a `min-height: 64px` for
  presence. Styled blue in `mzta-design.css` from the `--accent` / `--accentLight` tokens (so dark
  mode is inherited) and deliberately **not** using `.warning`, which is red.
  `display: none` by default; `updateNoConnectionBanner()` in `options/mzta-options.js` toggles the
  `.shown` class on load and on every `connection_type` change. Both this link and the doc-card share
  the local `openSetupWizard()` helper. The same function also **hides the per-connection "Advanced
  options" disclosure** (`#mzta_conn_adv_btn`) while nothing is selected — every row it would reveal
  belongs to a specific provider, so there is nothing to disclose — and calls `resetConnAdv()` so the
  panel is collapsed (and `#connection_ui_adv_table` hidden) when a provider is eventually picked. It
  is registered *after* the existing `resetConnAdv` / `refreshConnTestVisibility` change listeners, so
  its re-hide always runs last.
- **Options doc-card** — a fourth `.mzta_doc_card` (`#btn_setup_wizard`) in `.mzta_doc_cards`,
  right of "Open Welcome Page". The grid is an explicit `repeat(4, minmax(0,1fr))` in
  `mzta-design.css` so all four cards stay on one row, with an `@media (max-width: 500px)`
  block dropping to `repeat(2, minmax(0,1fr))` (2×2) on narrow panes. It deliberately does
  **not** use `auto-fit`, which produced unpredictable 3+1 splits and one-per-row stacking;
  the `minmax(0, …)` floor keeps the longest label (`prefs_doc_setup_wizard_launch`) wrapping
  inside its card instead of widening the track past the container. If a fifth card is ever
  added, update both column counts.
- **Popup menu** — when the popup opens and the selected connection has no credentials,
  `mzta-popup.js`'s `isConnectionConfigured(prefs)` returns false and the popup shows
  `#setup_wizard_prompt` (a button opening the wizard) instead of the prompt list. The button opens
  the wizard in a new tab and closes the popup.
  "Configured" = the required credential is set, ignoring surrounding blanks (a key of spaces is
  not set): `*_api_key` for the cloud APIs, `*_host`
  for Ollama / OpenAI-compatible; `chatgpt_web` is always considered configured (its host
  permission is handled by the existing permission banner). The function **first** returns
  false when no connection is selected at all — otherwise the empty value would fall through
  to the permissive `default:` case and the blue banner would never show.

**Blue wizard banner vs. red permission banner.** They are mutually exclusive by construction:
the blue banners mean *"you haven't chosen an AI yet"*, the red ones mean *"you chose this
provider but haven't granted its host permission"*. The red banners
(`#ask_chatgpt_web_perm` / `#ask_anthropic_api_perm` / `#ask_openai_api_perm` in the popup,
`#chatgpt_web_permission` / `#anthropic_api_permission` / `#openai_api_permission` in onboarding)
are keyed on an explicitly selected provider, so an empty `connection_type` never triggers them,
and their behaviour is unchanged by the empty default.

i18n keys for the wizard are `wizard_*` in `_locales/en/messages.json`; entry-point copy is
`onboarding_wizard_banner_*`, `prefs_doc_setup_wizard_launch`, `popup_setup_wizard_*`,
`options_no_connection_*`, plus `prefs_Connection_type_none` (select placeholder) and
`msg_no_connection_selected` (runtime alert).

### Feature Rows — Disabled vs. API-Needed

The six API-driven feature rows on the main options page (Add Tags, Spam Filter, Summarize,
Translate, Get Calendar Event, Get Task) are unusable in **two distinct** situations, which must be
presented differently:

| Effective connection | Toggle | `warn_API_needed` hint |
|---|---|---|
| `chatgpt_web` | **untouched, clickable** | **shown** |
| *nothing selected* (`''`) | unchecked **and `disabled`** (greyed) | **hidden** |
| any API | untouched | hidden |

Get Calendar Event and Get Task obey the same table, but carry an **orthogonal** second requirement:
both features live in the ThunderAI Sparks add-on. `disable_GetCalendarEvent()` therefore hides their
rows outright (`.get_calendar_event_tr` / `.get_task_tr` → `display:none`) when Sparks is missing or
the wrong version, *or* when no connection is selected — the only case where the shared table hides a
row rather than greying it. With ChatGPT Web the rows stay visible and show the hint exactly like the
other four. These two rows long lacked the `warn_API_needed` span entirely, so the hint could never
appear for them; the span now exists (`get_calendar_event_warn_API_needed`, `get_task_warn_API_needed`)
and `disable_GetCalendarEvent()` reads `show_api_warning` from both states.

**ChatGPT Web must not clear the flag.** The row used to force the toggle off (and persist that
`false`) whenever the effective connection was `chatgpt_web`, while simultaneously showing a hint
telling the user to go configure a per-feature API. Those two behaviours contradict each other: that
API is configured from the feature's **own settings page, reachable only while the feature is on**,
so clearing the flag closed the only route to fixing the situation — the feature switched itself
back off between being enabled and the setup being finished, and the user was left with a valid
per-feature connection and a silently disabled feature. Only the "nothing selected at all" state
still clears it, and there the toggle is `disabled` too, so nothing is being contradicted. The hint
now carries the whole message, and the real enforcement lives downstream where it belongs: the menus
(`getActiveSpecialPromptsIDs`), the body buttons (`initSummary` / `initTranslation`) and the
execution guards all judge the *effective* connection at the moment they run.
`_reconcileFeatureFlags()` in the background follows the identical rule — it repairs only a
genuinely absent connection — so the two can never disagree.

The `warn_API_needed` string explicitly says *"you need an API integration rather than the ChatGPT
Web Integration"* — advice that only makes sense once ChatGPT Web has actually been chosen. With no
connection selected it would be misleading (the blue setup-wizard banner already explains the real
situation), so it stays hidden and the toggle is greyed out instead: there is nothing to enable the
feature against yet.

Because a greyed-out toggle alone doesn't say *why*, a note (`#features_no_connection_note`,
`prefs_FeaturesNoConnection` — "Select an AI connection above to enable these features.") sits
directly under the `prefs_FeaturesSubtitle` line and is shown by `updateNoConnectionBanner()` — the
same function that drives the top banner and the advanced-options toggle — via a `.shown` class, so
all three stay in sync on load and on every `connection_type` change. It is styled in `--accent`
blue (informational, matching `#no_connection_banner`), not with the amber `.warn_API_needed`
treatment.

`getFeatureConnState(prefs_opt, prefix)` in `options/mzta-options.js` returns
`{no_connection, disabled, show_api_warning}` from the *effective* connection (i.e. after
`getConnectionType()` applies any per-feature `use_specific_integration` override — so a feature
pointing at its own API stays enabled even when the global connection is empty).
`disable_ApiFeature(prefs_opt, prefix, manageBtnId)` consumes it and does all the row work; the four
`disable_AddTags` / `disable_SpamFilter` / `disable_Summarize` / `disable_Translate` functions are now
one-line wrappers over it (they previously held four copies of the same body). `disable_GetCalendarEvent()`
stays a separate path because of the Sparks gate and the two-rows-in-one-function shape, but shares the
hint logic: `setApiWarnVisibility(prefix, show)` is the **single** place that flips a
`{prefix}_warn_API_needed` span, used by both, so the six rows cannot drift apart again. It sets an
explicit `inline-block` because `.warn_API_needed` is `display:none` in the stylesheet (which avoids a
flash before the JS runs), so `''` would leave the span hidden. The greyed-out look
needs no new CSS — `.mzta_switch input[type="checkbox"]:disabled + .track` already sets
`opacity: .5`. The per-feature `click` handlers (which request Thunderbird permissions) need no guard
either: a disabled checkbox fires no `click`.

It builds its `tempPrefs` as `{...prefs_opt, connection_type: conntype_select.value}` — **the live
select value must come last**. It is the not-yet-persisted choice the call is reacting to, while
`prefs_opt` is the storage snapshot; with the spread the other way round a `prefs_opt` carrying
`connection_type` would silently discard it. (Today `prefs_opt` is built from
`getDynamicSettingsDefaults()`, which only ever emits *prefixed* keys and never the global
`connection_type` — the ordering is defensive, not currently load-bearing.)

**Calendar/Task rows.** `disable_GetCalendarEvent(prefs_opt)` follows the same per-feature rule,
via `getFeatureConnState(prefs_opt, 'get_calendar_event')` and `…, 'get_task')` — both prefixes are
in `special_prompts_with_integration`, so they take specific integrations like the other four. It
previously read the global select directly, which made the UI *more* restrictive than the execution
path (`mzta-menus.js` already honoured the override). Sparks presence (`checkSparksPresence()`)
stays an orthogonal, additional requirement. `sparks_min` is `'3.1.0'` since v5.1.0, because the
payloads may carry `reminderMinutes` (#887); an older Sparks returns `0` from `checkSparksPresence()`,
so both rows (and with them the "Manage" buttons opening the two settings pages) are hidden, the
`wrong_sparks_text` banner is shown and `doGetSparkFeature()` drops the menu entries — an old Sparks
never receives the new field. The "Sparks missing" notice (`#no_sparks`) is hidden
when **both** features are unusable on their own connection — with a per-feature judgement, keying
it on a single global flag would hide a genuinely missing add-on.

`#no_sparks` is hidden by default through `#no_sparks { display: none }` in `options/mzta-options.css`
(so it cannot flash before the script runs), so revealing it needs the **explicit** `'block'` — the
same rule as the addtags sub-rows above: `style.display = ''` only removes the inline declaration and
falls back to that very hide-rule, leaving the notice permanently invisible. This is what broke it in
v5.0.0: the v4.1.1 line assigned `'table-row'`, and the `<table>`→`<div>` markup change turned it
into `''`. The notice also deliberately **does not** carry the `get_calendar_event_tr` class, even
though it sits with those rows: the `querySelectorAll('.get_calendar_event_tr')` loop just above
would otherwise write a `display` to it from the calendar-event toggle state, which is not the rule
this notice follows.

### Mandatory Specific Integration (feature settings pages)

When the global connection cannot drive a feature (ChatGPT Web, or nothing selected),
`initializeSpecificIntegrationUI()` (`pages/_lib/connection-ui.js`) forces
`use_specific_integration` on, because a specific integration is the only way that feature can run.
Four rules make that forcing actually stick:

- **The checkbox stays `enabled`, made read-only via `preventDefault()` on `click`** (plus a
  `data-mandatory` marker). A `disabled` checkbox is skipped by each page's `saveOptions()` sweep
  over `.option-input` and fires no `change`, so the forced value never reached storage.
- **The lock is made visible**, otherwise the toggle reads as an ordinary switch that silently
  ignores clicks — the user sees no reason why it will not turn off. Three markers, all driven from
  the same `if (mandatory_integration)` branch: the `[data-mandatory="true"]` attribute gives the
  track `cursor: not-allowed` and a light dim (`pages/_lib/mzta-design.css`, deliberately lighter
  than the `:disabled` rule above it, which stays reserved for the genuinely inert case); a
  `🔒 Required` badge (`.feature_locked_badge`) is revealed next to the row title; and
  `.feature_locked_note` is filled with the reason and shown under the description. The badge and
  the note are inert markup present on all six feature pages, with fixed ids
  (`specific_integration_locked_badge` / `_note`, unprefixed — one per page) so the shared
  `connection-ui.js` can find them. The note text is chosen at runtime, and only there, because it
  distinguishes the two cases: `specific_integration_mandatory_chatgpt_web` vs
  `specific_integration_mandatory_no_connection`. The same text is also set as the `title`.
- **The flag is persisted only once a usable connection type is chosen**, by
  `_persistMandatoryIntegration()` (on the select's `change`, and once on load to repair earlier
  visits). Writing it earlier would be worse than not writing it: `hasSpecificIntegration()` requires
  a non-empty connection type, so the pref pair would read as "enabled" while resolving back to the
  unusable global connection — the feature would look on in the UI and vanish from the menus.
- **The per-prompt select never shows `chatgpt_web`.** It is built with `no_chatgpt_web: true`, so
  the value has no `<option>`. Two places used to smuggle it in anyway: the pages inherited the
  global connection wholesale as the fallback for `<prefix>_connection_type` (now guarded by
  `isApiUsableConnection()`, falling back to `''`), and `restoreOptions()` synthesized a missing
  option for any unmatched stored value. That synthesis exists for **model** selects, where a saved
  model legitimately may not be in the fetched list; connection selects have a *closed* catalogue, so
  it is suppressed for them via `isClosedCatalogueSelect()` (`pages/_lib/connection-ui.js`).
  `populateConnectionTypeOptions()` likewise validates the previous value against the options it
  actually rendered, not the full catalogue. An unmatched value leaves the select blank
  (`selectedIndex = -1`), which is the intended "nothing chosen yet" state — no provider is ever
  silently preselected.
- **Models, by contrast, may be auto-selected — but only when the choice is forced.** After a
  "Fetch models" run, `autoSelectSingleModel()` (`pages/_lib/connection-ui.js`) selects the model
  when the select has no current value *and* the fetched list yields exactly one option, then
  dispatches `change` so the pref is saved by the normal `saveOptions` listener. This spares the
  user a pointless trip through a one-entry dropdown (typical of Ollama and self-hosted
  OpenAI-compatible endpoints). Note the option count is taken over **non-empty** values only: each
  provider seeds the select with the stored model before fetching, and an empty pref still yields a
  `value=""` option, so a raw `options.length === 1` test would never fire. An existing selection is
  never overwritten.

**Consistency with the background.** The same effective-connection judgement gates the menus:
`_computeActiveSpecialIds()` resolves one connection per prefix and `getActiveSpecialPromptsIDs()`
filters on it. Options rows and menu entries must agree — they used to disagree, leaving a feature
enabled in the UI but absent from the menus. The shared predicate is `isApiUsableConnection()`
(`js/mzta-utils.js`): `!hasNoConnectionSelected(ct) && ct !== 'chatgpt_web'`. **Always feed it an
effective connection** (`getConnectionType(prefs, null, prefix)`), never the global one.

Three details keep that agreement holding in the background:

- **Reconciliation runs first.** In the debounced `storage.onChanged` handler
  `_reconcileFeatureFlags()` precedes `reload_pref_init()` and the menu rebuild, so
  `_process_incoming`, the menus and the options rows all derive from the same healed values rather
  than a stale `true`. Both it and `_computeActiveSpecialIds()` read through
  `_readFeatureConnPrefs()`, so the key set cannot drift between them. The reconciliation writes to
  `storage.local` from inside a `storage.onChanged` listener, which is bounded rather than a loop:
  flags only ever go `true → false`, so the follow-up pass finds nothing to disable — and that pass
  is wanted anyway, being the one that refreshes `prefs_init`.
- **Reconciliation judges the connection only.** Sparks presence is deliberately excluded: it is
  transient (the add-on may merely be restarting), `doGetSparkFeature()` already gates every read
  site, and with no restoration path a `false` persisted on a boot race would be irreversible. This
  matches `disable_GetCalendarEvent()`, which hides the rows without persisting anything.
- **`MENU_RELEVANT_KEYS` is generated, not hand-written.** It spreads
  `Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))`. It
  previously listed only `add_tags`' pair, so changing any other feature's specific integration
  never triggered a menu rebuild.

**Execution guards are the backstop** for the window between a connection change and the
reconciliation, and for callers that bypass the menus. `isApiUsableConnection()` is checked in
`_generateSpamReportForMessage()` (which had no check at all — the resolved type flowed straight
into `mzta_specialCommand`), in `resolveAddTagsSetup()`, the once-per-batch add_tags setup of `processEmails()` (the menu-path guard
in `mzta-menus.js` does not cover auto/batch), and in `_generateSummaryForMessage()`,
`_generateTranslationForMessage()` and `_openSummaryWebchat()` — the latter three previously tested
`connectionType === 'chatgpt_web'`, which let an *empty* connection through. Each guard reports
through the channel its caller already owns (`spamReport` / `summaryStore` / `translationStore`,
`skipAddTags` for add_tags), so no state is left marked "in progress".

`_summarizeConnectionMissing()` applies the same predicate **ahead** of those guards, for the two
automatic summarize triggers (the sender-list branch of `initSummary` and the summarize-on-receive
branch of `processEmails()`). It is not redundant with the guard inside
`_generateSummaryForMessage()`: that one runs inside the summary job and persists the error into
`summaryStore`, which is the right behaviour for a user-initiated run but wrong for an automatic
one. The pre-check keeps automatic triggers silent. It used `hasNoConnectionSelected()` until it
was aligned here, so `chatgpt_web` slipped past it and produced exactly that spurious cached error.

**The message-body buttons need the same gate.** The Summarize / Translate buttons injected into the
message display (`js/mzta-compose-script.js`, drawn on the `showSummaryButton` /
`showTranslationButton` commands) are decided by `initSummary` / `initTranslation` in
`mzta-background.js`. Those handlers used to gate on the boolean flag alone, so a button could be
drawn on an unusable connection and fail only once clicked — and, unlike the menus, they never
consulted `getConnectionType()`. They now apply `isApiUsableConnection()` on the effective
connection, **after** the cached-result and in-progress branches: a summary or translation already
stored stays readable no matter what the connection is now. Note these handlers run **once per
message-display script injection** (the content script fires `initSummary` / `initTranslation` at
top level); there is no `onMessageDisplayed` listener and no `storage.onChanged` in the content
script, so a message already open does not pick up a settings change until it is reopened.

**Deleting a result redraws its button.** The "Delete" entry of the summary / translation banner
menu sends `removeSummary` / `removeTranslation`; after clearing the stored field the background
calls `_restoreSummaryButton()` / `_restoreTranslationButton()`, which send `showSummaryButton` /
`showTranslationButton` again under the same gates (`summarize` / `translate` enabled, `*_auto`
not `0`, `isApiUsableConnection()`). Without this the banner vanished and the only way back was the
menu. Auto mode (`2`) also gets the button, not a regeneration: re-running the automatic branch
would immediately undo the delete.

**`summarize_auto` / `translate_auto` must never be stored as `null`.** Their `saveOptions()` cases
run `parseInt(element.value, 10)`, and an empty select (`selectedIndex === -1`, which
`restoreOptions()` can produce) parses to `NaN` — storage serializes that as `null`. A stored
`null` is **not** replaced by the default in `storage.get({key: default})`, since that only
substitutes *missing* keys, so the value stays permanently outside the documented `0..3` range and
every `=== 0` / `=== 2` comparison in `initSummary` / `initTranslation` silently falls through. Both
ends are now guarded: the pages fall back to `prefs_default` on `NaN`, and the two handlers coerce
with `Number.isInteger()` before comparing, which also repairs profiles that already stored a
`null`. Any new numeric-enum pref read with `===` needs the same treatment at both ends.

**Numeric prefs must not fall back with `||`.** `spamfilter_threshold` used
`prefs.spamfilter_threshold || prefs_init.spamfilter_threshold` at three sites, which discards a
legitimate **0** ("flag everything") along with the genuinely missing values and silently applies
the default 70 instead. `getSpamThreshold()` in `mzta-background.js` now guards with
`Number.isFinite()`, so only an absent or non-numeric value — including the `null` an emptied
number input stores — falls back. The other numeric prefs (`add_tags_maxnum`, `add_tags_max_messages`,
`summarize_max_messages`, `summarize_max_display_length`, `translate_max_display_length`) are
already safe at their consumers, either via `Number.isFinite()` or because `|| 0` / `> 0` is the
intended behaviour for them; their `saveOptions()` cases are deliberately left untouched.

**No user-facing notification** is emitted when a flag is auto-disabled — only a `console.log`.
`disable_ApiFeature()` is likewise silent; notifying only from the background would make the same
event noisy or quiet depending on whether an options tab happened to be open. The resulting state is
already visible in the greyed rows and the missing menu entries.

### The Prompt Is Authoritative For API Parameters

At execution time the **special prompt**, not the prefixed prefs, supplies the API parameters.
`mzta_specialCommand.initWorker()` (`js/mzta-special-commands.js`) sets `use_specific_api = true`
whenever `config.api_type` is non-empty — and `config` **is the prompt object**; all seven call
sites pass it (`js/mzta-menus.js` for add_tags / calendar / task, `mzta-background.js` for
summarize / translate / spamfilter / auto-add-tags). From then on each key prefers
``config[`${integration}_${key}`]``, i.e. `prompt.anthropic_model`, `prompt.anthropic_api_key`, …; the
values read from storage are the **global** ones (`anthropic_model`), used only as fallback.
The `<prefix>_<integration>_<key>` prefs are never read on any execution path.

They are UI state, and they are re-derived from the prompt on every page load: `restoreOptions()`
overwrites `getting['<prefix>_connection_type']` and each `getting['<prefix>_<integration>_<key>']`
from the prompt before `setCurrentChoice()`, and the `DOMContentLoaded` block at the top of each
feature page mirrors the same values back into storage. Both directions therefore agree by
construction: **the page reads prefs, execution reads the prompt, and both trace back to the
prompt.** Do not add a migration for these keys — there is no legacy format to convert, and
`_updatePrompt()` keeps `prompt.api_type` populated for as long as the checkbox is on, so any
unguarded derivation would simply re-run forever rather than settle.

**`<prefix>_connection_type` and `<prefix>_use_specific_integration` must always be written
together.** The connection type alone is inert: `getConnectionType()` only reads it when the flag
is on. This is the one key neither mechanism above maintains — `restoreOptions()` has no branch for
it — so the `DOMContentLoaded` block must set it explicitly (guarded by `isApiUsableConnection()`,
so a `chatgpt_web` `api_type` never switches it on). It matters specifically for the two call sites
that pass `prompt = null` — `_computeActiveSpecialIds()` (menu gating) and `getFeatureConnState()`
(options row): with no prompt there is no `prompt.api_type` fallback, so the pref pair is the only
thing standing between them and the global connection. Writing just one half is what made a feature
configured for its own API vanish from the menus while still executing correctly.

### Connection Settings Panel — Provider Setup Note (`#miczDescription`)

The per-provider setup note is the **last element inside `#mzta_conn_panel`**, directly
below the connection-test strip. It used to sit at the very bottom of the page (inside
`#mzta_bottom`) under an "Important information" heading; it was moved next to the
connection fields it describes, and **the heading was dropped** — the panel header already
titles the whole block, so a second title was redundant. The element id is deliberately
unchanged so `updateDescription()` keeps working.

The note itself is **untinted**: only the body text carries the provider colour, as a 3px
`--tint-accent` left bar on the `.conntype_<provider> .info_specific` spans
(`prefsInfoDesc_1/2/3/4/7/8`). The single `#mzta_info_guide` link (`prefs_full_guide`) is
**moved inside the active provider's span** by `updateDescription()`, so it reads inline at
the end of that sentence instead of breaking onto its own line below the accent bar.

**Provider reactivity.** `updateDescription()` (`options/mzta-options.js`) does three
things per provider, all driven by the existing `change` listener on `#connection_type`
(plus one call at init): toggles the `.conntype_*` span visibility via inline `display`,
toggles the `tint_*` class on `#miczDescription`, and moves `#mzta_info_guide` into the
active span (idempotent — it only re-appends when the parent differs) while pointing it at
`getMiczItUrl(CONN_GUIDE_PATH[conntype])`. `CONN_GUIDE_PATH` is **sparse on purpose** —
only `chatgpt_web` (status page) and `ollama_api` (CORS page) have a dedicated
documentation page, and the link is hidden (`display:none`) for the other four rather
than falling back to a generic page.

Note `.info_specific` must keep `display: block` in CSS, because `updateDescription()`
reveals the active provider's text with `style.display = ""`, which falls back to the
stylesheet value.

**Tint tokens.** `#mzta_conn_panel` declares all four per-provider tint custom properties
(`--tint-bg`/`--tint-border`/`--tint-pill`/`--tint-accent`); `#miczDescription` declares
only `--tint-accent`, since the note is untinted apart from its left accent bar
(`pages/_lib/mzta-design.css`). Now that the note is nested inside the panel it would also
*inherit* the panel's `--tint-accent`, but its own `tint_*` class still wins and both
resolve to the same provider colour, so the accent bar is unaffected either way.

### Options Page Bottom Block (`#mzta_bottom`)

Everything below the app-level "Advanced options" row is one wrapper `div#mzta_bottom`
holding two parts in a vertical stack. It replaced five loose blocks (an "Important
Information" `<h1>` eyebrow, the provider setup note with a bracketed `[More info]` link,
a `CTRL+ALT+A` reminder sentence, the boxed LLM disclaimer, and a stacked footer) — the
provider setup note has since moved into `#mzta_conn_panel` (see "Provider Setup Note"
above). The wrapper takes the `#mzta_body > * { margin-bottom: 24px }` rhythm; the parts
inside space themselves with their own `margin-top`.

1. **Disclaimer + shortcut stack** (`#mzta_info_row`) — a centered flex **column**
   (`flex-direction: column; align-items: center`), so neither child is stretched to the
   full card width:
   - **LLM disclaimer** (`#mzta_disclaimer`) on the first line, sized to its own content
     (`width: fit-content; max-width: 100%`) with `align-items: center` so the glyph
     centres against the single line of text. It reads as one line whenever the card is
     wide enough and still **wraps** rather than overflowing on narrow windows (no hard
     `white-space: nowrap`, since the sentence is ~145 characters). Borderless (no
     `--warnBorder`/`--warnBg`; those tokens are consequently unused, though still
     defined) — just the amber `--warnColor` triangle glyph + `prefs_disclaimer_short` +
     the privacy link.
   - **Keyboard-shortcut strip** (`#mzta_shortcut_strip`) **below** the disclaimer, kept
     at its natural shrink-to-fit width (`flex: 0 0 auto; align-self: center`) so it never
     spans the full width: a `--field` box with the `prefs_shortcut_label` label and the
     `#mzta_shortcut_keys` `<kbd>` chips.
2. **Footer** (`#mzta_footer`) — three **plain `<a>` links** on one centered `flex-wrap`
   row (was a stacked column of `<div>`s, each with an introductory sentence before the
   link). The lead-in sentences are gone: `TranslateText` + `TranslateLink` and
   `prefsDonation_1` + `prefsDonation_2` are replaced by the single-label keys
   `prefs_footer_translate` ("Translate the addon") and `prefs_footer_donate`
   ("Make a donation"); release notes keeps `prefs_OptionText_release_notes`. The ids
   `#miczTranslate` / `#miczDonation` / `#miczRelNotes` are preserved (now on the anchors),
   and the donation URL was corrected from `http://` to `https://`.

**Live keyboard shortcut.** `updateShortcutChips()` calls `browser.commands.getAll()`,
finds `_thunderai__do_action`, and splits its `.shortcut` on `+` into one `<kbd>` per key,
so the chips follow a user rebinding instead of showing a hard-coded string. This is the
only `browser.commands` use in the codebase; the permission is implicit in the manifest
`commands` key, so no manifest change was needed. The static `Ctrl`/`Alt`/`A` chips in the
HTML are the fallback kept when the API throws, the command is missing, or the user has
cleared the binding (empty `.shortcut`). It runs once at init — rebinding happens outside
this page.

**Retired i18n keys.** `prefsInfoTitle`, `prefs_status_page`, `prefsInfoDesc_5`,
`prefsInfoDesc_6`, `prefs_disclaimer`, `TranslateText`, `TranslateLink`, `prefsDonation_1`,
and `prefsDonation_2` are no longer referenced by this page but are **left in the locale
files** — deleting them would churn all the Weblate-managed locales. New keys (English only,
per the localization rule): `prefs_full_guide`, `prefs_shortcut_label`,
`prefs_disclaimer_short`, `prefs_footer_translate`, `prefs_footer_donate`.

`prefs_info_pill` ("Important information") was also introduced here, but it was
**deleted from `_locales/en/messages.json`** when the provider setup note moved into the
connection panel and lost its heading. Only the English file was edited (the other locales
are Weblate-managed and drop the key on the next sync) — note this differs from
the "leave retired keys in place" handling of the older keys above.

### Options Page Advanced Section (`#mzta_adv_panel`)

The app-level "Advanced options" disclosure is the `#mzta_adv_toggle` button and the
`#mzta_adv_panel` it opens below itself (the connection panel's own disclosure mirrors it, see
"Connection Settings Panel — Advanced Options Disclosure"). The panel holds the chat window size and
position, `max_prompt_length`, `special_command_timeout`, `batch_max_concurrency`, the behaviour
switches, `diff_granularity`, `do_debug` and the cache block below.

- **Collapsed on every open.** The page opens with `aria-expanded="false"` and `.hidden` on the
  panel; a click flips both. The state is purely local UI: **no preference is persisted**.
- **`max_prompt_length` follows the connection.** `disable_MaxPromptLength()` disables the field and
  hides its row (`#max_prompt_length_tr`) while the global select holds `chatgpt_web` or nothing,
  and shows and enables it for any API; it runs at load and on every `connection_type` change. The
  row follows *relevance*, not the field's `disabled` flag: a policy lock disables the field too, and
  that must grey it out, never hide the row it explains. `special_command_timeout` is always shown
  (see its row in "UI & Feature Preferences").
- **Reset buttons.** `#reset_max_prompt_length` and `#reset_special_command_timeout` (each marked
  `data-mzta-companion-of` its field) put the `prefs_default` value back in the field and store it
  with `setPref()`, as a number. They fire no `change`. For a policy-locked key they do nothing
  (`isLockedKey()`), without relying on the button being disabled. `batch_max_concurrency` has none.
- **Cache block.** `#cache_storage_size` shows the space taken by the per-message records (the
  `msg:` keys of `storage.local`, see [01-architecture.md](01-architecture.md#per-message-data-storage)),
  as computed by `getCacheStorageUsedSpace()` (`js/mzta-utils.js`) and read once at load.
  `#btnClearCache` asks a native `confirm()` (`prefs_storage_clear_confirm`): cancelled, nothing
  happens; confirmed, `taStorage.clearAllRecords()` removes every `msg:` record - never a preference
  or any other key - then an `alert()` reports the count (`prefs_storage_clear_done`) and the size is
  read again.

### Owl for Exchange Warning (`#owl_warning`)

At load the options page lists the accounts (`accounts.list(false)`) and, when any account's type
contains `owl` (case-insensitive: the Owl for Exchange add-on), shows `#owl_warning`
(`prefs_OptionText_owl_warning`) with `display: block`; `options/mzta-options.css` keeps it hidden
otherwise. It is informational only: nothing on the page is disabled because of it.

### Feature "Manage settings" Links — Hidden vs. Disabled

Each feature block on the main options page (Add Tags, Spam Filter, Summarize,
Translate, Calendar Event, Task) has a "Manage settings" link/button (e.g.
`btnManageTagsInfo`, `btnManageSpamFilterInfo`, ...) that opens the feature's dedicated
settings page. When the feature's checkbox is unchecked, the button is fully **hidden**
(`display: none`) rather than merely greyed out/disabled, via the shared helper
`setFeatureManageVisibility(btn, visible)` in `options/mzta-options.js`. The helper sets
both `style.display` and the `disabled` attribute together, and replaces all prior
inline `btn.disabled = ...` toggling for these six buttons (on checkbox `click`, on
`disable_*()` re-evaluation, and on permission-request denial).

### Unsaved-Changes Guard (`pages/_lib/unsaved-guard.js`)

The six feature settings pages (Add Tags, Spam Filter, Summarize, Translate, Calendar
Event, Task) mix two kinds of controls: plain `.option-input` fields, written to storage
on `change` (never pending), and **textareas saved explicitly** by a companion Save
button. Only the latter can hold unsaved text when the tab is closed.

`initUnsavedGuard()` registers a `beforeunload` handler that calls
`event.preventDefault()` while `hasUnsavedChanges()` is true, so Thunderbird shows its
native "leave page?" confirmation. [Thunderbird 128+ only]

`hasUnsavedChanges()` derives the dirty state from the DOM instead of a separate flag:
it returns true when any `button[id^="btn_save"]` is **not** disabled. This works because
every explicitly saved textarea on these pages follows the same convention — its Save
button ships `disabled` in the HTML, the textarea's `input` handler enables it when the
value differs from the stored one, and the click handler disables it again after saving.
No change to those existing handlers is needed.

The selector deliberately matches only the snake_case `btn_save*` ids used by the feature
pages. The Data Placeholders and Menu Order pages use a single camelCase `btnSaveAll`
button and keep their own `somethingChanged`-based `beforeunload` handler, and the Custom
Prompts page saves every change immediately with its own `beforeunload` handler, so they
are unaffected.

Each page calls `initUnsavedGuard()` as the first statement of its `DOMContentLoaded`
handler, so the guard is armed even if later async setup fails.

### Reminder Section (Calendar Event / Task pages, `pages/_lib/reminder-ui.js`)

Both pages carry the same "Let the AI set a reminder" section (#887), placed **after** the prompt
section (its help text refers to "the main prompt above"), with the same ids on both pages except the
checkbox, whose id is the pref (`calendar_reminder_enabled` / `task_reminder_enabled`).
`initReminderUI({feature, promptTextarea, statementsEl})` is called right after the prompt text is
loaded (so after `restoreOptions()`, which sets the checkbox state), and **before** the editor
decoration (placeholders, highlight, autocomplete), so a failure there cannot leave the section
uninitialized. A missing page element is logged and the setup is skipped. A failure loading the saved
rules is logged and the setup continues with an empty textarea: the listeners and the first
`refresh()` always run. A failed save is logged and leaves the Save button enabled. It does the following:
- The checkbox is a plain `.option-input`, saved by the page's `saveOptions()`. It shows or hides
  `#reminder_rules_block`, which is hidden by default in the page CSS.
- The rules textarea `#reminder_rules` uses the **explicit Save** pattern (`#btn_save_reminder_rules`,
  `#reminder_rules_unsaved`), the same one as `summarize_auto_senders_list`, so the unsaved-changes guard
  above covers it. The value is stored trimmed. It is a **plain** textarea without placeholder
  highlighting, because the rules are appended after placeholder resolution (see
  [02-prompts.md](02-prompts.md#calendar-event--task-reminder-887)).
- The non-blocking warning `#reminder_prompt_warning` (`.feature_warn_note`, amber, shared in
  `mzta-design.css`) is shown while the **live** prompt text contains `reminderMinutes` and the
  checkbox is off. In that case the main prompt's reminder instructions are ignored (the AI value is
  discarded, Thunderbird's default applies) until the option is checked.
  It is refreshed on the prompt textarea's `input` and on the checkbox's `change`.
- The existing `#{prefix}_info_additional_statements` div previews exactly what `finalizePrompt_*()`
  will append, from `taPromptUtils.getReminderPromptParts()` on the live values (the same pieces
  `getReminderPromptStatements()` joins for the real prompt), with the
  `addtags_info_additional_statements` label. No quotes: the text sits in a boxed
  `.reminder_statements_box` (shared in `mzta-design.css`), with the fixed format instruction dimmed
  (`.reminder_statements_format`) and the user's rules, with their bold intro, set apart by an
  accent left border (`.reminder_statements_rules`). Built through the DOM, since the rules are user text.

## Adding a New Preference

1. Add the key and default value to `prefs_default` in `options/mzta-options-default.js`.
   **The default must be the conservative choice: feature off, nothing new sent anywhere.** An
   organization in enterprise-policy strict mode gets the new key locked at that default (see
   [08 "Strict mode"](08-managed-configuration.md#strict-mode-_lock_unlisted-_user_editable))
2. Add UI control to `options/mzta-options.html`
3. Add load/save logic to `options/mzta-options.js`
4. Add i18n label to `_locales/en/messages.json`
5. Read the pref in the relevant module through `mztaPrefs` (see below) — **not** with a
   direct `browser.storage.local.get()`

## Preference access (`js/mzta-prefs.js`)

Every preference **read and write** goes through the single accessor module
`js/mzta-prefs.js`, which exports the `mztaPrefs` singleton. It is adapted from
[Thunderbird Addon Options Manager](https://github.com/micz/Thunderbird-Addon-Options-Manager)
(same author) and keeps that project's MPL-2.0 header; only the accessors were taken. It was
introduced by [#163](https://github.com/micz/ThunderAI/issues/163) as a pure refactor, and is
the prerequisite for anything that needs to intercept a preference read.

**It is also the one place that decides which storage area preferences live in.** The module
opens with `const PREFS_AREA = browser.storage.local;` and every accessor goes through it, so
moving areas is a single edit here — which is exactly how the sync→local move was done. The
call sites that read storage directly (listed at the end of this section) must be kept in step
by hand, and each carries a comment saying so.

```javascript
import { mztaPrefs } from '../js/mzta-prefs.js';

const value = await mztaPrefs.getPref('my_pref');            // one value
const prefs = await mztaPrefs.getPrefs(['a', 'b']);          // {a: ..., b: ...}
const all   = await mztaPrefs.getAllPrefs();                 // every declared pref
await mztaPrefs.setPref('my_pref', value);                   // single-key write
await mztaPrefs.setPrefs({a: 1, b: 2});                      // multi-key write
```

**Defaults come from `prefs_default` and from nowhere else.** A call site never passes its own
default; that is the point of the choke point. An id with no `prefs_default` entry logs a
warning through `taLogger` and is read with `undefined` as its default, so the mistake is
visible instead of silent.

**`storage.get()` semantics are preserved exactly.** A default is substituted only for a
key that is **missing** from storage. A stored `null` — which is what an emptied number input
serializes to (`NaN` → `null`) — comes through as `null`, untouched. Several call sites depend
on this and guard with `Number.isInteger()` / `Number.isFinite()` (the `summarize_auto`,
`translate_auto`, `max_prompt_length` and `special_command_timeout` reads). The accessor adds
**no** null coercion, and must not start doing so.

**Logging** uses `taLogger`, never `console` directly, and masks any `*_api_key` value — the
same rule `isAPIKeyValue()` applies in the options page. The `do_debug` flag is read once,
lazily, and refreshed from `storage.onChanged`; it cannot be fetched through `getPref()`
without recursing on every read.

### The managed layer sits in front of the accessor

An enterprise policy (`js/mzta-managed.js`, see
[08-managed-configuration.md](08-managed-configuration.md)) resolves through this module,
which is why the whole mechanism touches no call site. Every read resolves as:

```
locked policy value  >  user value in storage.local  >  unlocked policy value  >  prefs_default
```

implemented in two private helpers:

- **`_defaultsFor()`** hands an *unlocked* policy value to `storage.get()` as that key's
  default. That is exactly the "initial value the user may change" semantics: a stored
  user value still wins, and the policy value is only what they see until they change it.
- **`_applyLocked()`** runs *after* the read and overwrites every locked key. A default
  cannot beat a stored value, and an enforced value must — including one written before
  the policy was installed.

**The write guard is the point of the whole design.** `setPref()` and `setPrefs()` skip a
locked key, logging a warning. If an enforced value ever reached `storage.local` it would
outlive the policy, so removing the policy would leave the user silently stuck with what
it used to impose. `setPrefs()` skips per key rather than rejecting the whole object: its
callers seed an entire provider block at once, and one locked key must not block the rest.

With no policy installed every one of these checks is false and the behaviour is
byte-for-byte what it was before — `storage.managed.get()` rejects, which is the normal
case for nearly every user and is swallowed silently.

### What deliberately does *not* go through the accessor

- **Multi-key writes go through `setPrefs(obj)`**, not a direct
  `browser.storage.local.set()`. `setPref()` is single-key by design, and before
  `setPrefs()` existed that forced eight writers to bypass the module: the per-feature
  integration seeding (`set(update_prefs)`) on the six feature pages,
  `_reconcileFeatureFlags()`'s `set(to_disable)`, and the
  `{chatgpt_win_top, chatgpt_win_left}` pair. All of them now use `setPrefs()`, so the
  module is the choke point for **writes** as well as reads — which is what lets a single
  write guard cover every preference write.
- **The options page keeps its own `saveOptions()` / `restoreOptions()`.** Only their
  `get`/`set` calls were migrated. The upstream project's versions were *not* ported: ThunderAI's
  handle password inputs, API key masking, TomSelect, `hasEmptyValueOption()` and the
  `connection_type` empty state, so replacing them would be a regression.
- **The two one-shot migration flags** in `js/mzta-prompts.js`
  (`dynamic_menu_order_alphabet`, `_migrated_enabled_to_showin`) are not preferences: no UI, no
  `prefs_default` entry. Declaring them would make them surface in `getAllPrefs()` and in every
  page's `restoreOptions()`. Both still have to sit in the **same area** as `PREFS_AREA`, and
  `migratePrefsToLocal()` carries them across — see the `dynamic_menu_order_alphabet` row above
  for what breaks otherwise.
- **`js/mzta-compose-script.js`** is registered as a *classic* content script, so it has no
  module context and cannot import. It no longer reads storage at all: the tag dialog gets
  `add_tags_exclusions`, `add_tags_hide_exclusions` and `add_tags_exclusions_exact_match`
  from the `addtags_get_exclusion_prefs` background command, resolved by `mztaPrefs` (so the
  enterprise policy applies), and writes the list with `addtags_set_exclusions` (so the write
  guard applies). Any preference it needs in future must go the same way.
- **`migrateCalendarNoSelection()`** in `js/mzta-prompts.js` reads the raw stored
  `calendar_no_selection` and `_special_prompts` on purpose: it compares the user's own
  stored values, before the policy is loaded.
- **One read in `pages/_lib/connection-ui.js`** (`_persistSelectedConnection`) keeps a
  hardcoded `''` default, which differs from `prefs_default`'s `'chatgpt_api'` for
  `{prefix}_connection_type`. It is a no-op guard comparing the stored value against what the
  select shows; with the `prefs_default` value a first-time write of exactly `chatgpt_api`
  would compare equal to the substituted default and be skipped, leaving the pref unwritten.
  Only the *default* is special: the area follows `PREFS_AREA` like everything else. Because
  that raw read cannot see the enterprise policy, the function returns early when the key has
  a policy-supplied value: a locked one is refused by the write guard anyway, and an initial
  one must not be stored as a user choice the user never made.
- **The `storage.local` / `storage.session` record stores** (`taStorage`, `taSummaryStore`,
  `taTranslationStore`, `taSpamReport`, the custom prompt/placeholder payloads) are not
  preferences and are out of scope. They now share an area with the preferences, which is safe
  by construction: every key they own is prefixed (`msg:`, or a leading `_`), no `prefs_default`
  key uses either prefix, and each of the five `storage.local.get(null)` enumerations in
  `js/mzta-storage.js` filters on `msg:` before touching a record — including
  `clearAllRecords()`, which would otherwise delete every preference.
- **The two #129 legacy reads** in `js/mzta-utils.js` (`migrateCustomPromptsStorage()`,
  `migrateDefaultPromptsPropStorage()`) keep pointing at `storage.sync` on purpose: their job is
  to drain old data *out* of it. They always end with the key removed from sync: when
  `storage.local` already holds it (a move interrupted between its copy and its remove), the local
  copy is the user's and is kept, and only the stale sync copy is removed. Leaving it there would
  withhold `_prefs_migrated_from_sync` forever.
