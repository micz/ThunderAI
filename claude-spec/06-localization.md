# Localization

## Golden Rule

**Only ever modify `_locales/en/messages.json`.**

All other locale files (everything under `_locales/` except `en`) are managed by translators through [Weblate](https://hosted.weblate.org/). Never edit them manually.

## Message File Format

Each entry in `_locales/en/messages.json` follows the standard WebExtension i18n format:

```json
"key_name": {
    "message": "The English text",
    "description": "Context for translators explaining where/how this string is used"
}
```

The `description` field is important — it helps Weblate translators understand the context.

## Using Strings in Code

A string reaches the UI in one of three ways: `browser.i18n.getMessage()` in JavaScript, a
`__MSG_key__` token in a page (substituted by `i18n.updateDocument()`), or a `__MSG_key__` token in
`manifest.json` (substituted by Thunderbird). There is no `i18n('key')` function and no
`data-i18n` attribute.

### In JavaScript
```javascript
const text = browser.i18n.getMessage('key_name');
// $1 / $name$ placeholders of the message are filled from the second argument:
indicator.textContent = browser.i18n.getMessage('prefs_specific_api_indicator', [apiName]);
```

This is the only way modules, the background script, the API web chat window (`api_webchat/`,
whose page loads no `mzta-i18n.js`) and the injected ChatGPT Web script get a string. Write the
key as a string literal where you can: a key computed at run time works, but the static tests
cannot check that it exists.

**Stored names.** Built-in prompts and placeholders store their display name as a whole
`__MSG_key__` string (`name: "__MSG_prompt_reply__"` in `js/mzta-prompts.js`), so the name is
localized when shown, not when stored. Code that needs the text resolves it with
`i18nConditionalGet(str)` (`js/mzta-utils.js`), which returns the message when `str` is
exactly `__MSG_…__` and `str` unchanged otherwise (a custom prompt's name); a few modules keep a
local equivalent (`resolvePlaceholderName()` in `js/mzta-placeholders.js`, `resolvePromptName()`
in `pages/customprompts/mzta-custom-prompts.js`). Only a whole-string token is resolved this way:
text around it is not.

### In HTML
```html
<span class="opt_title">__MSG_key_name__</span>
<button title="__MSG_key_name__">…</button>
```

Pages are localized by `js/mzta-i18n.js` (from Thunderbird's addon-developer-support), a
classic script — not an ES module, so it runs before the page's deferred module script — that
defines the global `i18n` object. Every page that uses tokens loads it and calls
`i18n.updateDocument()` in its startup. `updateDocument()` walks the whole document and replaces
every `__MSG_key__` (several per string, with text around them) in:

- **every text node**, `<title>` included;
- **every attribute value**, whatever the attribute: `title`, `placeholder`, `alt`, `aria-label`,
  `value` all work.

It does not touch:

- **markup added after the call**: a page that injects markup carrying its own tokens calls
  `i18n.updateDocument()` again (e.g. the connection panels, `pages/_lib/connection-ui.js`);
- **a value set through a DOM property** rather than an attribute (`input.value = …`): set it
  from `getMessage()` instead;
- **HTML comments** and the content of `<template>` elements (not part of the document tree).

A token whose key does not exist is left as it is, so a typo shows on the page as the raw
`__MSG_…__`.

### In manifest.json
```json
"description": "__MSG_extensionDescription__"
```

## Naming Conventions

| Prefix | Usage |
|--------|-------|
| `menu_*` | Context menu and popup menu labels |
| `prompt_*` | Built-in prompt names |
| `placeholder_*` | Placeholder display names |
| `options_*` | Settings page labels |
| `pages_*` | Feature page labels |
| `error_*` | Error messages |
| `info_*` | Informational messages |
| `btn_*` | Button labels |

## Adding a New String

1. Open `_locales/en/messages.json`
2. Add the new key in alphabetical order within the file (or near related keys)
3. Include both `message` and `description` fields
4. Use the string in code via `browser.i18n.getMessage('key_name')` or `__MSG_key_name__`

Example:
```json
"my_new_feature_label": {
    "message": "My New Feature",
    "description": "Label for the new feature button in the options page"
}
```

## Removing a String

A key no longer referenced from the code is **removed from `_locales/en/messages.json`**, not left
behind: Weblate keeps asking translators for every key `en` has. The other locales follow when
Weblate syncs from `en`. The `dead-key` check of `tests/static/02-locales-references` reports an
`en` key that is referenced nowhere (see `tests/static/README.md` for what counts as a reference).

## Automatic Translation

The one exception to the Golden Rule, and only when the maintainer asks for it: the
`translate-locales` Claude Code skill (`.claude/skills/translate-locales/SKILL.md`) has Claude
translate, for the locales listed in `LANG_AUTO.md` (one per line, `#` lines ignored), the `en`
strings those locales lack or translate from an older English text. Weblate stays in charge of the
same files; reconciling the two is the maintainer's job.

`scripts/i18n.mjs` (Node built-ins only) does every file operation; nothing edits a locale by hand.

- **Baseline** `.claude/skills/translate-locales/baseline.json` (committed): per locale folder and key, the truncated sha256 of
  the English `message` (and `:` that of its `placeholders`) the translation was produced or
  confirmed for. `init` records it for the languages that lack one, taking every existing
  translation as up to date.
- **States**: *missing* (absent or empty in the locale), *modified* (translated, but the English
  hash differs from the baseline, or the key has no baseline entry, e.g. translated on Weblate
  afterwards), *obsolete* (no longer in `en`; removed only with `apply --prune`).
- **Commands**: `status` (exit 1 when anything needs work), `extract` (work files in the ignored
  `.claude/i18n-work/`, with the previous English text recovered from git for modified keys and reference
  translations), `apply` (validates `$name$`, `$1`, HTML tags and non-empty text, then merges).
- **Merge**: the locale file is edited as text, member by member: existing keys keep their place and
  any `description`, a new key goes right after the nearest earlier `en` key the file has, the
  `placeholders` block is copied from `en`, and no other byte changes. Only the written keys get a
  new baseline hash.

Everything the skill keeps (script, baseline, work files) lives under `.claude/`, which the
packaging script (`create_xpi_from_folder.bat`, outside this repository) excludes from the XPI;
`LANG_AUTO.md` is excluded with every `*.md`.

## Supported Languages

**Two different lists, and they are not meant to agree.** `_locales/` is every language Weblate has opened a translation for; `LANG.md` at the repo root is the subset complete enough to be packaged into a release, maintained by hand. A locale present in `_locales/` but absent from `LANG.md` is deliberately excluded, not an oversight — do not reconcile them.

The authoritative list is the set of directories under `_locales/` (source of truth — do not duplicate it here as a static count, it changes as Weblate adds languages). As of writing:

| Code | Language |
|------|----------|
| `en` | English (source) |
| `bg` | Bulgarian |
| `cs` | Czech |
| `de` | German |
| `el` | Greek |
| `eo` | Esperanto |
| `es` | Spanish |
| `fr` | French |
| `hr` | Croatian |
| `hu` | Hungarian |
| `id` | Indonesian |
| `it` | Italian |
| `ja` | Japanese |
| `nb_NO` | Norwegian Bokmål |
| `nl` | Dutch |
| `pl` | Polish |
| `pt` | Portuguese |
| `pt-br` | Brazilian Portuguese |
| `ro` | Romanian |
| `ru` | Russian |
| `sk` | Slovak (directory present, no translated strings yet) |
| `sv` | Swedish |
| `tr` | Turkish |
| `zh_Hans` | Chinese Simplified |
| `zh_Hant` | Chinese Traditional |
