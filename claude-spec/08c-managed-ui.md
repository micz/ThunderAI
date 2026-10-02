# Enterprise Managed Configuration: UI

How the settings pages present what the policy enforces: `pages/_lib/managed-ui.js`, the
controls with their own load/save logic, the setup wizard, the marker. Part of the enterprise
managed configuration specification: the mechanism these build on - resolution order, write
guard, hydration, validation - is in
[08-managed-configuration.md](08-managed-configuration.md).

## UI

[`pages/_lib/managed-ui.js`](../pages/_lib/managed-ui.js), shared by the options page, the
six feature settings pages and the setup wizard. It sends **no message of its own**: the page
state is read from the hydrated `mztaManaged` (see
[Hydration in every other context](08-managed-configuration.md#hydration-in-every-other-context)), which the first
preference read has already filled:

```javascript
await getManagedState()
// -> { active, orgName, lockedKeys, disablePromptManagement, disableDefaultPrompts, disableSetupWizard }
```

**No page ever calls `browser.storage.managed` itself**, and `runtime.getBackgroundPage()`
is not used.

The values come with the same hydration, through the normal preference read; a
policy-supplied API key arrives only as `MANAGED_SECRET_MARKER`. So an input restored from
`mztaPrefs` already holds the enforced or initial value by the time `applyManagedUI()`
disables it. `isLockedKey()` and `isEnforcedPref()` are both `mztaManaged.isManagedLocked()`:
the page's guards and the write guard can never disagree.

Control matching relies on the invariant `saveOptions()`/`restoreOptions()` already depend
on: **an `.option-input` element's `id` IS its preference key.** So no mapping table is
needed. The implementation walks the controls once testing against a `Set`, rather than
running a selector per locked key — an id-suffix selector would also catch unrelated
controls whose id merely ends with the key (`translate` would match `auto_translate`).

A matched select turned into a **Tom Select** (`calendar_timezone`, the model selects) also gets
`tomselect.disable()`: the widget reads the native `disabled` only when it is built, so without it
the user could still pick another value, which the write guard would refuse while the page shows
it. (The model selects are kept disabled by `toggleTomSelectDisabled()` as well, see
[Locked model selects](08b-managed-connections.md#locked-model-selects).)

`applyManagedUI()` must run **after** the connection panel has injected its provider rows,
and after `restoreOptions()` has populated the inputs - and after the page has built its Tom
Selects, which `initTimezoneSelect()` does before `initializeSpecificIntegrationUI()`.

### Controls with their own load/save logic: `data-mzta-pref`

Some preferences are edited by a control that must **not** be an `.option-input`, because
`saveOptions()` / `restoreOptions()` would then handle it generically and break its own
serialisation: `spamfilter_skip_addresses`, `spamfilter_block_addresses`,
`summarize_auto_senders_list` and `add_tags_exclusions` (textareas saved as normalised lists
by their Save buttons),
`calendar_reminder_rules` / `task_reminder_rules` (the shared `#reminder_rules` textarea of
`pages/_lib/reminder-ui.js`, saved trimmed by its Save button), and
`spamfilter_skip_addressbook` (a checkbox whose change handler requests the `addressBooks`
permission). They opt in explicitly with `data-mzta-pref="<preference key>"`.
`applyManagedUI()` walks `.option-input, [data-mzta-pref]` in the same single pass against the
same `Set`, taking the key from `data-mzta-pref` when present and from the `id` otherwise, and
gives the match exactly the `.option-input` treatment. Two ids are not the key:
`addtags_excl_list`, and `reminder_rules` (one id on both pages, each carrying its own pref).

Their companion controls are the page's: `lockCompanions(key, elements)` marks each one
`data-mzta-managed="1"`, disables it and titles it `managed_marker_tooltip` when the key is
locked, so `setDisabledRespectingManaged()` — which the pages' "unsaved changes" input
handlers now use — keeps it disabled. Every save function, the Save click handlers and the
`spamfilter_skip_addressbook` change handler also **return early** when the key is locked, so
neither a write nor the permission prompt can be triggered from a control re-enabled in the
developer tools. `updateAutoSendersState()` on the summarize page, which reassigns `disabled`
on every `summarize_auto` change, uses the respecting setter too: it could previously
re-enable a locked `summarize_auto_senders` toggle.

**A plain `.option-input` can have companions too**: a number input's "Reset to default" button
(`reset_max_prompt_length`, `reset_special_command_timeout` on the options page,
`reset_summarize_max_messages` on the summarize page) refills the input and writes the default.
Such a button carries `data-mzta-companion-of="<preference key>"` in the markup, and
`applyManagedUI()` locks it together with its key, exactly as `lockCompanions()` would, with no
code in the page. Its click handler returns early on `isLockedKey()` as well: re-enabled by hand,
it would otherwise show a default the write guard then refuses to store.

The marker lands right of the textarea's group title (see "Group titles win over the
column" below; the `.mzta_field` column is only the fallback), and in the checkbox's
`.feature_row` (before the `.mzta_switch`). No new CSS was needed.

The account checkboxes of the spam filter and Add Tags pages are the same pattern with a
twist — the locked key (`*_enabled_accounts_match`) is not the one the checkboxes save — and
have their own helper, `lockAccountSelector()`; see [Account lists by policy](08b-managed-connections.md#account-lists-by-policy-_enabled_accounts_match).

`applyManagedUI()` covers locked *preferences*, plus the connection-panel fields a policy
connection enforces, which are matched by their `${prefix}_${field}` id in the same pass (see
[The connection panel](08b-managed-connections.md#the-connection-panel)). A restriction has no preference behind
it, and its controls are plain buttons and links rather than `.option-input` fields, so
there is an explicit counterpart: `disableForManagedRestriction()`, called at the few sites
a restriction covers. It marks the element with the same `data-mzta-managed` attribute, so
`setDisabledRespectingManaged()` keeps it disabled if page logic later reassigns
`disabled`, and applies the same `lockControl()` inertness. For an `<a>` — which has no
`disabled` property the browser honours — it also strips the `href` and adds
`.managed_disabled`.

`isPromptManagementDisabled()` and `isSetupWizardDisabled()` are synchronous, like
`isLockedKey()`: the policy must have been hydrated first (`getManagedState()`, or any awaited
preference read). A caller that has not gets `false`, which is the safe default for a page
that could not reach the background at all — the same fallback the rest of this module takes.

### The setup wizard

[`pages/setup-wizard/`](../pages/setup-wizard/) writes the same connection preferences as
the options page, through the same `mztaPrefs.setPref()` path, so the write guard has
always covered it. What it lacked was the presentation layer: every field was fully
editable, and a user could walk the whole wizard entering an API key the guard then
silently refused to persist — the policy held, but the UI said otherwise.

It now calls `showManagedBanner()` and `applyManagedUI()` in the same position as the
options page: after `injectConnectionUI()` and `restoreOptions()`, before the `change`
listeners are attached. The connection rows are covered for free by the
id-IS-the-preference-key invariant, and `showConnectionOptions()` only toggles `display`
on rows that already exist, so nothing is injected after the marking pass.

**The provider cards are the one wizard-specific case.** They are `<button>` elements, not
`.option-input` controls, so `applyManagedUI()` cannot reach them and a locked
`connection_type` would otherwise still be switchable by clicking a card — which dispatches
a `change` on the hidden select and drives the entire wizard onto a provider the policy
does not allow. Two guards, mirroring the toggle treatment above:

- `selectProvider()` returns early when `connection_type` is locked and the requested id
  differs from the current one. The `id !== state.provider` condition is what still lets
  the boot call through, so the enforced provider is selected and tinted normally.
- `buildProviderCards()` disables every card and adds `.wiz_provider_card_managed`. All
  cards are greyed out, including the enforced one — the policy chose it and it cannot be
  changed here either — but the selected card keeps full opacity so the administrator's
  choice stays readable.

Cards are built *after* `applyManagedUI()`, which is what populates the state
`isLockedKey()` reads synchronously.

### Marker placement and inertness

A feature toggle is an `<input type="checkbox">` visually hidden **inside**
`<label class="mzta_switch">`. Two consequences the implementation has to handle:

- **Placement.** `markManaged()` anchors on `closest('td') || closest('label') ||
  parentElement`. On the options page the feature rows are flex `div`s, not tables, so the
  label branch wins and appending would drop the badge *inside* the switch — left of the
  track and inside its click target. When the control is inside a `.mzta_switch`, the
  marker is therefore inserted **before that label**, as a sibling in `.feature_row`, so
  the row reads `… [Managed by Org] (toggle)`. One marker per host: `markManaged()` skips a
  host that already has a `.managed_marker` as a **direct child** - a marker further down
  belongs to another control (a `.mzta_field` can hold a nested switch row with its own), and
  does not say this one is locked.
- **Two layout contexts.** Wherever it lands, the marker ends up a *flex item*, and the base
  `.managed_marker` rule — an `inline-flex` chip sized by its content — is not enough on its
  own, because a flex parent's `align-items: stretch` overrides that sizing. Each context
  needs its own override in `pages/_lib/mzta-design.css`:
  - a flex **row** (`.feature_row`, marker inserted before `.mzta_switch`) — the chip must
    not stretch to the row height and needs the switch's top offset to line up with it;
  - a flex **column** (`.mzta_field`, marker appended as the last child, under the control's
    `.mzta_help` text) — without an override the chip stretches to the *full field width*,
    and `margin-inline-start`, being horizontal, gives it no separation from the help text
    above.

  Both overrides are `flex: none; align-self: flex-start` plus context-appropriate margins.
  A new field layout that hosts the marker needs the same treatment.
- **Group titles win over the column.** When the resolved anchor is a `.mzta_field`,
  `groupTitleFor()` looks for the title heading it: the field's own direct
  `.opt_title_small` (a section with several fields, e.g. the three summarize prompts), or
  else the section's `.mzta_prompt_title` when the field is the section's only direct
  `.mzta_field`. If one is found the marker is appended inside that title, i.e. right of it
  (the base inline chip, no override needed). Only when no unambiguous title exists — a
  section title over several untitled fields would not say which one is locked — does the
  marker fall back to the `.mzta_field` column above.
- **Padlock.** The badge carries a padlock glyph via `.managed_marker::before` in
  `pages/_lib/mzta-design.css`, the same one `#managed_config_banner` and
  `.managed_restriction_note` use, so every managed surface reads alike. It is CSS, not
  text, so it stays out of the localised string and out of the accessible name. The badge
  is an `inline-flex` row with `flex-wrap: nowrap`: the glyph is the icon *for* the
  label, not a word in it, and must never come apart from it.
- **Inertness.** `disabled` on the input is not sufficient on its own. `disable_ApiFeature()`
  and friends reassign `.disabled` unconditionally, and they run again from the
  `storage.onChanged` listener — i.e. *after* `applyManagedUI()`. Two defences:
  - `setDisabledRespectingManaged(element, disabled)` — the exported setter those call
    sites use instead of assigning `.disabled` directly. It ORs in
    `dataset.mztaManaged === '1'`, so a policy-locked control can never be re-enabled by
    page logic. Call sites that previously read back `.disabled` to decide **row
    visibility** were changed to test their own condition instead: a lock must grey a row
    out, never hide it. Every page-logic assignment that can run after `applyManagedUI()`
    goes through it, including `updateAnthropicModelCapabilityUI()`,
    `updateOpenAIModelCapabilityUI()` / `updateOpenAITextFormatUI()` and `_applyOllamaCaps()`
    (the fields the selected model, or output format, does not support),
    `updateDisplayModeConstraint()` on the summarize page and the
    `add_tags_auto_uselist` toggle on the Add Tags page. `disable_ApiFeature()` also leaves a
    locked flag's `checked` alone: a policy-enabled feature with an unusable connection stays
    on (see [Interaction points](08-managed-configuration.md#interaction-points)), so the toggle keeps showing it.
  - `lockControl()` — a capturing `click`/`keydown` swallower on the `.mzta_switch` label,
    so even a re-enabled input cannot be flipped by clicking the track or the row label.

Both are presentation only; the authoritative block remains the write guard in
`js/mzta-prefs.js`.
