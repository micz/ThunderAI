# Enterprise Managed Configuration: Restrictions and Prompts

The restrictions, the organization prompts and the enforced special prompt texts. Part of the
enterprise managed configuration specification: the mechanism these build on - resolution
order, write guard, hydration, validation - is in
[08-managed-configuration.md](08-managed-configuration.md).

## Restrictions

The last three are **restrictions**: policy-only switches that take something away rather
than set a value. They are structural keys, not entries in `prefs_default`, because there
is no user-facing setting behind them — nothing to show in the options page, nothing to
store in `storage.local`, and therefore nothing for the lock convention to act on. A
restriction is simply on (`true`) or absent.

`readRestriction()` accepts only a boolean. `false` is allowed, and means the same as
absent, so an administrator can write the key out explicitly. Anything else is warned about
and treated as off — never coerced, because a restriction silently misread as *on* would
lock a fleet out of its own prompts.

A policy that only restricts — no preference, no prompt — still counts as **active**: the
banner and the disabled controls have to be explained.

They travel to pages in the `get_managed_values` reply as `disablePromptManagement`,
`disableDefaultPrompts` and `disableSetupWizard`. They cannot ride in `lockedKeys`, which holds preference keys.

### `_disable_prompt_management`

The organization takes prompt management away entirely: nothing can be created, copied,
imported or exported, and the user's **existing** prompts become read-only and stop being
available anywhere they could be invoked. Built-in and organization prompts are untouched —
they remain fully usable, which is the point: the user keeps working, with the prompt set
the organization decided on.

Export is included on purpose — an exported file carries the prompt bodies, and with
*include API settings* it can carry provider credentials too, so an organization that locks
prompt management does not want that file produced either.

**The user's prompts are never deleted.** They stay in `_custom_prompt`, are still listed
(read-only, with an explanation) on both prompt pages, are still saved, and come back
exactly as they were the moment the policy is lifted.

#### Where it is enforced

| Site | Treatment |
|---|---|
| `pages/customprompts/` `btnNew` ("New prompt") | disabled in place |
| `pages/customprompts/` `#import_export` | **hidden** rather than greyed — a greyed Export/Import pair invites clicking. `#managed_restriction_note` is revealed in its place, so the missing buttons read as policy, not as a bug |
| `pages/customprompts/` detail editor and row menu | the user's own prompts are `rowState().locked`: every field is read-only, Save/Delete are not offered and the banner shows `customPrompts_policy_inert_note`; **Duplicate / Duplicate and edit / Export are disabled on every prompt**, built-in and org included, because a copy always produces a new prompt |
| `pages/menu_order/` rows | dimmed, undraggable, badged `menu_order_badge_policy_inactive` |
| menus, popup, `loadPrompt()` | filtered out by `getPrompts()` |
| `exportPrompts()`, `importPrompts()`, `duplicatePrompt()`, `startNewPrompt()`, `commitDetail()` (new mode), `deletePrompt()` | early-return guards — the control being disabled or out of sight is not the same as the action being unavailable |

This is also why that page uses `pages/_lib/managed-ui.js` instead of its own raw
`sendMessage`: it needs the restriction accessors, and the state belongs in one cache. The
page captures it once into `prompt_mgmt_disabled` before the first row renders, because the
List.js row template is synchronous and cannot await.

#### The three prompt views, and why the filter is not global

`js/mzta-prompts.js` builds the merged prompt set once in `buildPromptSet()`, which
**marks** the three reasons a prompt can be inactive instead of dropping them:
`_shadowed_by_org`, `_inert_by_policy` and `_default_inert_by_policy`. Three views sit on
top of it:

| View | Drops inactive? | Special prompts | Used by |
|---|---|---|---|
| `getPrompts()` | yes | per arguments | menus, popup, `loadPrompt()` |
| `getPromptsForManagement()` | no | no | `pages/customprompts/`, import, export |
| `getPromptsForMenuOrder()` | no | yes | `pages/menu_order/`, `migrateMenuOrderAlphabetic()` |

The split is a **data-safety rule, not a style choice**. Both prompt pages rewrite the
whole `_custom_prompt` store from the list they were handed, so a prompt missing from that
list is a prompt *deleted* on the next Save. Filtering inside `getPrompts()` alone would
therefore have made the menu order page erase every custom prompt the moment a user
reordered anything under the policy. Any future caller that writes back to storage must
use a non-dropping view for the same reason.

All three flags describe the *current* policy state, never the
prompt, so they must not be persisted: a stored `_inert_by_policy` would outlive the policy
that set it. They are stripped in `setCustomPrompts()` and `setSpecialPrompts()` — the two
gates into storage — and in `preparePromptsForExport()`, so a backup restored elsewhere
carries no stale policy state.

The restriction fails **open**: `isPromptManagementDisabled()` in `js/mzta-prompts.js`
returns `false` on any error, matching `managed-ui.js`. A restriction misread as *on* would
make the user's own prompts vanish from every menu, which is far worse than one briefly not
applied — the policy is re-read at the next start anyway.

Custom *data placeholders* are deliberately **not** covered. They are text fragments, not
prompts, and carry no provider credentials — a separate restriction can be added if an
organization ever asks for one.

### `_disable_default_prompts`

The organization takes the **built-in** prompts out of the menus. They stop being available
anywhere they could be invoked — popup, reading, composing and context menus, `loadPrompt()`
by id — while staying listed, read-only and explained, on both prompt pages.

It is meant for an organization that ships its own prompt set through `_org_prompts` and
wants only that set to be reachable. It is fully independent of `_disable_prompt_management`:
the two cover **disjoint** sets of prompts — the built-in ones here, the user's own ones
there — and can be on together, each with its own explanation.

What it does **not** touch:

- **special prompts** (Add Tags, Summarize, Translate, Spam Filter, Calendar Event, Task).
  They back features of their own, which stay switched on. They carry `is_default: "1"` as
  well, because their display properties are stored the same way, so `isBuiltInDefaultPrompt()`
  tests `is_default === '1' && is_special !== '1'` — a plain `is_default` check would
  silently disable those features too.
- the user's own prompts, and the organization's.

#### Where it is enforced

| Site | Treatment |
|---|---|
| menus, popup, `loadPrompt()` | filtered out by `getPrompts()` |
| `pages/customprompts/` rows | already read-only as built-ins; dimmed in the list (`.is_dimmed`), with `customPrompts_policy_default_inert_note` in the detail editor's banner and `#managed_restriction_defaults_note` once for the page — without them a prompt that has silently vanished from every menu reads as a bug |
| `pages/menu_order/` rows | dimmed, undraggable, badged `menu_order_badge_policy_inactive` (shared with the restriction above: "Disabled by policy" is exactly right for both) |

The built-in prompts are **kept in the merged set**, never filtered out of it, for the same
data-safety reason as above: `pages/menu_order/` rewrites `_default_prompts_properties` from
the list it was handed, so dropping them would erase the user's menu positions and custom
icons on the next Save. `_default_inert_by_policy` rides in `TRANSIENT_PROMPT_FLAGS`, so it
cannot be persisted. (`setDefaultPromptsProperties()` needs no change — it writes an
explicit whitelist of fields, so no transient flag can leak through it.)

Fails **open**, like the restriction above: `areDefaultPromptsDisabled()` in
`js/mzta-prompts.js` returns `false` on any error, because a restriction misread as *on*
would empty the menus of an unmanaged installation.

### `_disable_setup_wizard`

The wizard writes connection preferences as the user steps through it, and the write guard
only covers the keys the policy actually locks. So this is enforced at **four** entry
points plus the page itself:

| Site | Treatment |
|---|---|
| `options/` `btn_setup_wizard`, `btn_options_setup_wizard` | disabled in place |
| `pages/onboarding/` `wizard_banner` | hidden — it exists only to lead there |
| `popup/` `setup_wizard_prompt` | link replaced by the explanation text |
| `pages/setup-wizard/` itself | renders `#wiz_blocked` instead of the wizard |

The page check is not redundant. Every link to it is disabled, so reaching the wizard means
it was opened by its direct URL; the check runs before anything is built or injected.

The popup case is the odd one: that panel replaces the prompt list when no connection is
configured, so it cannot simply be hidden. The link text becomes the explanation, so the
user learns the connection is configured centrally rather than clicking a dead end.

`openSetupWizard()` in the options page also returns early — a restriction must not depend
on a control staying disabled.

## Organization prompts

Full treatment in [02-prompts.md](02-prompts.md#organization-prompts-the-fourth-set). The
parts that belong here:

**Ids are composed, not taken verbatim**: `org_<_org_id>_<id>`. `_org_id` may not contain
an underscore, or `org_acme_foo_bar` would be ambiguous between org `acme`/prompt `foo_bar`
and org `acme_foo`/prompt `bar` — and two organizations could collide through that
ambiguity. Without a valid `_org_id` the whole prompt set is refused rather than given
ambiguous ids.

Because every composed id starts with `org_` and every shipped id starts with `prompt_`,
collision with a built-in is **structurally impossible** and is not checked for.

**A colliding custom prompt is shadowed, not rejected.** If the user owns a prompt with an
org prompt's id, the org prompt wins wherever a prompt can be invoked. The reverse would
let a user disable an organization prompt just by creating one with its id, with nothing
visible to explain the disappearance. The user's prompt is **not** deleted — it stays in
`_custom_prompt`, is still saved, and returns when the policy stops supplying that id.

This is deliberately **not** paired with UI validation forbidding an `org_` prefix: that
would be bypassable by writing to storage directly, adds nothing to a runtime rule that is
not, and would forbid a prefix a user may already be using legitimately.

## Enforced special prompt texts (`_special_prompts_text`)

Replaces and enforces the **text** of special prompts (Spam Filter, Add Tags, Summarize,
Translate, Calendar Event, Task). Neither of the other two mechanisms can do it: the text
lives in `_special_prompts`, not in `prefs_default`, so the allowlist cannot reach it, and
`_org_prompts` only creates new `org_<org_id>_*` prompts.

```json
"_special_prompts_text": {
  "prompt_spamfilter": "… {%mail_html_body%} … {\"explanation\": …, \"spamValue\": …}"
}
```

**Enforced only — there is no `:locked` variant.** There is no preference behind a prompt
text, so nothing for the lock convention to downgrade to an initial value. A
`"_special_prompts_text:locked"` key is warned about and ignored; the texts stay enforced.
Only the text is covered: every other property of the special prompt (icon, menu visibility,
provider override) stays the user's - the provider override has a key of its own,
[`_special_prompts_connection`](08b-managed-connections.md#enforced-per-feature-connections-_special_prompts_connection).

### Validation

`validateSpecialPromptsText()` in [`js/mzta-managed.js`](../js/mzta-managed.js), same style
as `validateOrgPrompts()`: the value must be a plain object, and each entry is checked on its
own — an invalid one is skipped with a `taLogger.warn()` naming it, the rest still apply.

- the key must be the id of an entry in `specialPrompts` ([js/mzta-prompts.js](../js/mzta-prompts.js),
  `getSpecialPromptIds()`), **including the non-menu ones**: `prompt_summarize_email_template`,
  `prompt_summarize_email_separator` and `prompt_get_calendar_event_from_clipboard`;
- the value must be a non-empty string, and not whitespace only — except
  `prompt_summarize_email_separator`, for which whitespace is a legitimate text;
- the text must satisfy the **response contract** below.

`js/mzta-prompts.js` owns the ids and the contract; `mzta-managed.js` imports it
**dynamically** inside `_doLoad()`, because `mzta-prompts.js` statically imports
`mzta-managed.js`.

The calendar page edits `prompt_get_calendar_event` and `…_from_clipboard` through **one**
textarea and always saves both. So an enforced `prompt_get_calendar_event` also applies to
the clipboard variant, unless the policy names that id too (even with an invalid value — an
administrator who named it did not ask for the copy).

### Output-format safety: the response contract

Every special prompt whose answer is parsed carries its output format **inside the text**
(`prompt_spamfilter_full_text` itself asks for `{"explanation", "spamValue"}`); the code
only appends extras (`finalizePrompt_add_tags()`: tag count, language, allowed list). An
administrator's text without that format would silently break the parser for the whole
fleet, and the user could do nothing about it — which is the difference from the same
mistake made by a user on their own feature page.

The chosen approach is **validate and reject**, not "move the format into code":

- moving the format out of the text would change the text every user edits today, need a
  migration of every stored user text (which already contains the format) and new
  translatable strings — a behaviour change for unmanaged users, which this mechanism must
  never cause;
- rejecting keeps the feature working: the user's own text stays in effect, and the
  warning tells the administrator exactly which field is missing. Enforcing and warning
  would have left a fleet with a feature that fails on every message.

`SPECIAL_PROMPT_TEXT_CONTRACT` in `js/mzta-prompts.js`, checked by `checkSpecialPromptText()`:

| Id | `responseKeys` (reject if missing) | Message placeholder (warn if missing) |
|---|---|---|
| `prompt_spamfilter` | `spamValue`, `explanation` | any body placeholder¹, or none at all² |
| `prompt_add_tags` | `tags` | any body placeholder¹, or none at all² |
| `prompt_get_calendar_event`, `…_from_clipboard` | `startDate`, `endDate`, `summary` | `selected_text`, `selected_html` or a body placeholder¹, or none at all² |
| `prompt_get_task` | `summary` | as calendar |
| `prompt_translate_this` | `subject`, `body`, `status` | `mail_html_body` or `mail_text_body`, **and** `thunderai_translate_lang` |
| `prompt_summarize_email_template` | — | any body placeholder¹, or none at all² |
| `prompt_summarize`, `prompt_summarize_email_separator` | — | — (free text) |

¹ `mail_text_body`, `mail_html_body`, `mail_text_body_or_selected`, `mail_html_body_or_selected`.
² `preparePrompt()` appends the message itself to a text with no placeholder at all.
`buildTranslationPrompt()` never appends, hence the stricter translate row.

A response key is matched as a whole, case-sensitive word — the parser's property access. It
is a heuristic: it catches the likely mistake (an instruction rewritten without its output
format), not a subtly malformed one. Only the keys without which the result is unusable are
listed; the ones the shipped text itself calls optional (location, description,
attendees…) are not. Every shipped text passes the contract.

### Application: a read-time overlay, never persisted

`applyEnforcedTexts()` runs at the end of `getSpecialPrompts()`, after
`applyCalendarNoSelection()`, `applyLockedOffIntegrations()` and `applyPolicyConnections()`: it replaces `text` and sets
`_text_by_policy: true`. In pages the texts arrive with the hydration
(`specialPromptsText` in the `get_managed_values` reply), and the overlay awaits
`managedReady()`, so every context sees the same text.

It must **never** reach storage: the feature pages rewrite the whole `_special_prompts`
array, and a stored enforced text would replace the user's own and outlive the policy. Two
gates, as for the provider override:

- `_text_by_policy` is in `TRANSIENT_PROMPT_FLAGS`, so `setSpecialPrompts()` and
  `preparePromptsForExport()` strip it;
- `setSpecialPrompts()` runs `keepStoredTexts()`: for every enforced id it puts back the
  **stored** text, or the shipped (i18n) text for a prompt never stored — what
  `getSpecialPrompts()` would have handed out without the policy. The decision is by id,
  from `mztaManaged`, synchronously, not by the marker, so it holds even for a caller that
  dropped the marker. Before `loadManaged()` (the migration block) nothing is enforced and
  it is a no-op.

Removing the policy therefore restores the user's text **exactly**, including a legacy
stored value that is still the raw i18n key.

### UI

`lockEnforcedPromptText(textarea, promptIds, companions)` in
[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), called by `bindSpecialPromptEditor()`
in [`pages/_lib/feature-page.js`](../pages/_lib/feature-page.js) — the one wiring of a special
prompt editor (textarea, Save, Reset, "unsaved" note) the six feature pages share — after it
has filled the textarea and set its buttons' initial state (summarize binds three editors, one
per textarea; calendar one, with both calendar ids). It follows [Controls with their
own load/save logic](08c-managed-ui.md#controls-with-their-own-loadsave-logic-data-mzta-pref), without a
preference key:

- the textarea already shows the enforced text (the overlay), and becomes **`readOnly`**,
  not disabled, so the text can still be scrolled, selected and copied — a user may want to
  start a custom prompt from it; it gets `data-mzta-managed="1"` and the
  `managed_prompt_text_tooltip` title. `#mzta_card .editor-wrap .editor[data-mzta-managed="1"]`
  in `mzta-design.css` hides the caret, since no `:disabled` styling applies;
- the Save and Reset buttons are disabled and marked like `lockCompanions()` does;
- the marker, padlock included, goes right of the group title heading the textarea's
  `.mzta_field` (see "Group titles win over the column" in
  [Marker placement and inertness](08c-managed-ui.md#marker-placement-and-inertness)) — the same placement the list
  textareas get. `markManaged()` takes the `.mzta_field` anchor explicitly: the textarea's
  own parent is the editor-highlight wrapper.

The editor's Save and Reset handlers also **return early** on `isEnforcedPromptText(id)` for
any of its prompt ids (the calendar Save on either calendar id), and its input handler sets the
buttons through `setDisabledRespectingManaged()`, so not even a dispatched `input` re-enables
them. Both helpers read `mztaManaged` after hydration.

### Startup warning

The feature pages' placeholder checks never see an enforced text, so the background
`taLogger.warn()`s at startup for each enforced text that fails the placeholder column of
the contract (`getEnforcedTextPlaceholderProblems()`). The text is still enforced — the
administrator asked for it, and it runs. The existing `calendar_no_selection` startup check
reads `getSpecialPrompts()`, so it covers an enforced calendar text on its own.
