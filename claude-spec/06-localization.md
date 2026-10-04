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

### In JavaScript
```javascript
const text = browser.i18n.getMessage('key_name');
```

### In HTML
```html
<span>__MSG_key_name__</span>
```

The `__MSG_key__` tokens in a page's text nodes and attribute values are substituted at load
time by `js/mzta-i18n.js` — a classic script (not an ES module, loaded before the page's module
script) that defines the global `i18n` object with `updateString()` and `updateDocument()`. Every
page calls `i18n.updateDocument()` in its startup — and again whenever it injects markup
dynamically that carries its own `__MSG_…__` tokens (e.g. the connection panels, see
`pages/_lib/connection-ui.js`).

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
